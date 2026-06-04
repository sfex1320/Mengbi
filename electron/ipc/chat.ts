import { z } from 'zod';
import type { WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import { register, ok, appendNotification } from './helpers';
import { ChatSendSchema } from './schemas';
import { getDb } from '../services/db';
import { decryptString } from '../services/safeStorage';
import { joinApiUrl } from '../services/apiUrl';
import { logger } from '../services/logger';
import { isMockMode } from './mocks/runtime';
import { runMockChatStream } from './mocks/chat';
import {
  searchDdg,
  searchTavily,
  searchSearxng,
  searchBocha,
  searchZhipu,
  searchJina,
  searchSerper,
  renderSearchContext,
  type SearchBackend,
  type SearchHit
} from '../services/searchBackends';

interface ConvRow {
  id: string;
  title: string;
  model_id: string;
  plan_id: number;
  created_at: string;
  updated_at: string;
}

interface ConfigRow {
  id: number;
  base_url: string;
  api_key_encrypted: string;
  model_mapping: string;
  official_kind: string | null;
  /** 0 / 1，DB 整数列；主流程消费用来决定是否注入 web_search 工具 */
  supports_web_search: number;
  /** 0 / 1，DB 整数列；vision 已通过 attachedImages 自动多模态拼装，本字段当前用于 UI 标签 */
  supports_vision: number;
  /** official_kind='local' 时指向 .gguf 文件路径；其它情况为 null */
  local_model_path: string | null;
  /** 0 / 1：是否启用思考模式（按家族注入 thinking / reasoning_effort 字段） */
  supports_thinking: number;
  /** 'low' / 'medium' / 'high' / 'max' / null（上游默认） */
  thinking_effort: string | null;
}

/**
 * 把 effort 档位映射到具体数值（Anthropic budget_tokens / Gemini thinkingBudget 用）。
 * Deepseek/Kimi/GLM/OpenAI 用字符串档位直接传，不走这里。
 */
function thinkingBudgetForEffort(effort: string | null | undefined): number {
  switch (effort) {
    case 'low':
      return 1024;
    case 'medium':
      return 2048;
    case 'max':
      return 8192;
    case 'high':
    default:
      return 4096;
  }
}

/**
 * 按 official_kind / base_url 给请求体注入 thinking 字段。
 * 不支持的家族不注入（fail-safe，避免发出无法 deserialize 的字段引发 400）。
 *
 * 各家协议：
 *   - openai-compat (Deepseek V4 / Kimi K1.5 / GLM-Z1)：`thinking: { type:'enabled', reasoning_effort }`
 *   - openai (o-系列)：仅 `reasoning_effort: <effort>`
 *   - anthropic：`thinking: { type:'enabled', budget_tokens }`
 *   - gemini：`thinkingConfig: { thinkingBudget }`（OpenAI 兼容入口对此字段可能不识，但发了不会 400）
 *   - local / 其他：不注入
 */
function injectThinkingIntoOpenAICompat(
  body: Record<string, unknown>,
  cfg: ConfigRow & { actualModelId: string }
): void {
  if (!cfg.supports_thinking) return;
  const effort = cfg.thinking_effort;
  if (cfg.official_kind === 'openai') {
    // o1/o3/o4 系列才认这个字段；非推理模型会被上游忽略或回 400 透出
    if (effort) body.reasoning_effort = effort;
  } else {
    // openai-compat 默认 Deepseek V4 风格；effort 为 null 时让上游默认（不发 reasoning_effort）
    const thinking: Record<string, unknown> = { type: 'enabled' };
    if (effort) thinking.reasoning_effort = effort;
    body.thinking = thinking;
  }
}

/**
 * 按 official_kind / base_url 决定要不要 + 该注入哪个 native web_search tool。
 * 白名单：只对**已知支持** native web 工具的家族注入；其他全部跳过（让用户走代搜）。
 * 这避免了对未知中转站 / Deepseek 等不支持 native 的上游发出 web_search_preview 而 400。
 */
function injectNativeWebSearchTool(
  body: Record<string, unknown>,
  cfg: ConfigRow & { actualModelId: string }
): void {
  const baseLower = (cfg.base_url ?? '').toLowerCase();
  if (baseLower.includes('minimaxi') || baseLower.includes('minimax.io')) {
    body.tools = [{ type: 'web_search' }];
    return;
  }
  if (baseLower.includes('bigmodel.cn')) {
    // 智谱 GLM
    body.tools = [{ type: 'web_search', web_search: { enable: true } }];
    return;
  }
  if (baseLower.includes('moonshot.cn')) {
    // Kimi / Moonshot
    body.tools = [{ type: 'builtin_function', function: { name: '$web_search' } }];
    return;
  }
  // 仅当家族明确是 OpenAI 官方 Responses 协议才发 web_search_preview
  if (cfg.official_kind === 'openai' && baseLower.includes('api.openai.com')) {
    body.tools = [{ type: 'web_search_preview' }];
    return;
  }
  // 其它（含 Deepseek、各类中转站、未知）：不发 native tool，由用户改用全局代搜
}

const inflight = new Map<string, AbortController>();

export function registerChatHandlers(): void {
  register('api:chat:send', ChatSendSchema, async (input, event) => {
    const messageId = randomUUID();
    const sender = event.sender;
    handleSend(
      input.conversationId,
      input.content,
      input.attachedImages ?? [],
      messageId,
      sender,
      input.forceWebSearch === true
    ).catch((e) => {
      logger.error('chat.send fatal', e);
    });
    return ok({ messageId });
  });

  register('api:chat:cancel', z.string(), async (id) => {
    const ctrl = inflight.get(id);
    if (ctrl) {
      ctrl.abort();
      inflight.delete(id);
      return ok(true as const);
    }
    return ok(true as const);
  });

  register(
    'api:chat:create',
    z.object({ title: z.string().min(1), planId: z.number().int(), modelId: z.string().min(1) }),
    async (input) => {
      const id = randomUUID();
      const now = new Date().toISOString();
      getDb()
        .prepare(
          `INSERT INTO conversations(id, title, model_id, plan_id, created_at, updated_at)
           VALUES(?, ?, ?, ?, ?, ?)`
        )
        .run(id, input.title, input.modelId, input.planId, now, now);
      return ok({ id });
    }
  );

  register('api:chat:list', null, async () => {
    const rows = getDb()
      .prepare(
        `SELECT id, title, updated_at FROM conversations ORDER BY datetime(updated_at) DESC`
      )
      .all() as Array<{ id: string; title: string; updated_at: string }>;
    return ok(rows);
  });

  register('api:chat:history', z.string(), async (id) => {
    const rows = getDb()
      .prepare(
        `SELECT role, content, reasoning_content, timestamp
           FROM messages WHERE conversation_id = ? ORDER BY id ASC`
      )
      .all(id) as Array<{
        role: string;
        content: string;
        reasoning_content: string | null;
        timestamp: string;
      }>;
    return ok(rows);
  });

  register(
    'api:chat:rename',
    z.object({ id: z.string(), title: z.string().min(1) }),
    async (input) => {
      getDb()
        .prepare(`UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?`)
        .run(input.title, new Date().toISOString(), input.id);
      return ok(true as const);
    }
  );

  register('api:chat:delete', z.string(), async (id) => {
    getDb().prepare(`DELETE FROM conversations WHERE id = ?`).run(id);
    return ok(true as const);
  });

  // 一键清空所有会话（含消息）。FK ON DELETE CASCADE 帮我们带走 messages
  register('api:chat:clear-all', null, async () => {
    const r = getDb().prepare(`DELETE FROM conversations`).run();
    logger.info('chat.clear-all', { removed: r.changes });
    return ok({ removed: r.changes });
  });

  // 用 LLM 把用户的口语化提示改写成图像生成提示词（非流式，立即返回）
  // 可选 systemPrompt：前端可以塞自定义优化指令（来自 optimizePresets.ts 的不同分类）
  register(
    'api:chat:optimize-prompt',
    z.object({
      planId: z.number().int(),
      modelId: z.string().min(1),
      userInput: z.string().min(1).max(20_000),
      systemPrompt: z.string().max(20_000).optional()
    }),
    async (input) => {
      const cfg = findConfigForModel(input.planId, input.modelId);
      if (!cfg) {
        return ok({ optimized: input.userInput, optimizedBy: null as string | null });
      }
      try {
        const optimized = await optimizePromptOnce({
          cfg,
          userInput: input.userInput,
          systemOverride: input.systemPrompt,
          supportsWebSearch: !!(cfg as ConfigRow & { supports_web_search?: number })
            .supports_web_search
        });
        return ok({ optimized, optimizedBy: input.modelId });
      } catch (e) {
        // 优化失败回退到原文，不让用户白等
        logger.warn('chat.optimize-prompt failed', e);
        return ok({ optimized: input.userInput, optimizedBy: null });
      }
    }
  );
}

const SYSTEM_OPTIMIZER_BASE = `你是图像生成提示词优化助手。把用户输入改写为高质量、信息密度高的图像生成提示词，要求：
- 保留用户原意，不要丢核心主体；
- 补充：主体、风格、构图、镜头、光影、材质、色彩、氛围；
- 真实品牌 / 产品 / 人物 / 地标——基于你的知识写出真实视觉特征（包装颜色、Logo 形状、典型外观），不要瞎编；
- 中文输入可保留中文输出，必要时穿插标准英文风格关键词；
- 直接输出改写后的提示词，不要解释、不要标点符号包裹。`;

const SYSTEM_OPTIMIZER_WITH_WEB = `${SYSTEM_OPTIMIZER_BASE}

你支持联网搜索：如果主体是真实存在的品牌 / 产品 / 人物，请先 web search 一次确认其真实视觉外观（包装、配色、字体、Logo 比例），再写进提示词；不确定的视觉细节宁可省略也别瞎编。`;

async function optimizePromptOnce(opts: {
  cfg: ConfigRow & { actualModelId: string };
  userInput: string;
  systemOverride?: string;
  supportsWebSearch?: boolean;
}): Promise<string> {
  const url = joinApiUrl(opts.cfg.base_url, 'chat/completions');
  const apiKey = decryptString(opts.cfg.api_key_encrypted);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60_000);
  const sysPrompt =
    opts.systemOverride && opts.systemOverride.trim()
      ? opts.systemOverride
      : opts.supportsWebSearch
        ? SYSTEM_OPTIMIZER_WITH_WEB
        : SYSTEM_OPTIMIZER_BASE;
  const reqBody: Record<string, unknown> = {
    model: opts.cfg.actualModelId,
    stream: false,
    messages: [
      { role: 'system', content: sysPrompt },
      { role: 'user', content: opts.userInput }
    ]
  };
  // Web search：复用 streamOpenAICompat 的白名单分流。未知家族不注入 native tool，
  // 让用户通过全局代搜（ddg/tavily）拿到联网能力；不再无脑发 web_search_preview。
  if (opts.supportsWebSearch) {
    injectNativeWebSearchTool(reqBody, opts.cfg);
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(reqBody),
      signal: ctrl.signal
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    // 部分上游不认 stream:false，一旦回 SSE 就别让 res.json() 炸
    const text = await res.text();
    let assembled = '';
    let parsed: { choices?: Array<{ message?: { content?: string } }> } | null = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      // SSE 兜底：拼所有 delta.content
      for (const line of text.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const j = JSON.parse(payload) as {
            choices?: Array<{
              delta?: { content?: string };
              message?: { content?: string };
            }>;
          };
          const c =
            j.choices?.[0]?.delta?.content ?? j.choices?.[0]?.message?.content ?? '';
          if (c) assembled += c;
        } catch {
          /* 心跳行/注释跳过 */
        }
      }
    }
    const out =
      parsed?.choices?.[0]?.message?.content?.trim() ?? assembled.trim();
    return out && out.length > 0 ? out : opts.userInput;
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────
// Send: 走 OpenAI 兼容协议（含 Kimi / DeepSeek / 中转站）或 Mock
// ─────────────────────────────────────────────────────

async function handleSend(
  conversationId: string,
  content: string,
  attachedImages: string[],
  messageId: string,
  sender: WebContents,
  forceWebSearch: boolean
): Promise<void> {
  const send = (channel: string, payload: unknown): void => {
    if (!sender.isDestroyed()) sender.send(channel, payload);
  };

  const conv = getDb()
    .prepare(`SELECT * FROM conversations WHERE id = ?`)
    .get(conversationId) as ConvRow | undefined;
  if (!conv) {
    send('chat:done', {
      id: messageId,
      cancelled: false,
      error: '对话不存在'
    });
    appendNotification(sender, {
      channel: 'chat:done',
      kind: 'failure',
      errorCode: 'CONFIG_MISSING',
      severity: 'toast',
      message: '对话不存在',
      refId: messageId
    });
    return;
  }

  let cfg = findConfigForModel(conv.plan_id, conv.model_id);
  if (!cfg && !isMockMode()) {
    const msg = `没有找到对应模型「${conv.model_id}」的配置`;
    send('chat:done', {
      id: messageId,
      cancelled: false,
      error: msg
    });
    appendNotification(sender, {
      channel: 'chat:done',
      kind: 'failure',
      errorCode: 'CONFIG_MISSING',
      severity: 'toast',
      message: msg,
      refId: messageId
    });
    return;
  }

  // 本地大模型路由：official_kind='local'，按是否填了 base_url 决定走"嵌入式"还是"外部已运行的本地服务"。
  //   - 有 base_url（http://127.0.0.1:11434/v1 等）→ 直接当作 OpenAI 兼容站调用
  //   - 没填 → 走内嵌 llama-cpp，需 local_model_path 指向 .gguf
  if (cfg && cfg.official_kind === 'local') {
    const externalUrl = cfg.base_url?.trim();
    if (!externalUrl) {
      if (!cfg.local_model_path) {
        const msg = '本地大模型未配置：请在设置里选 .gguf 文件，或填外部本地服务 URL';
        send('chat:done', { id: messageId, cancelled: false, error: msg });
        appendNotification(sender, {
          channel: 'chat:done',
          kind: 'failure',
          errorCode: 'CONFIG_INVALID',
          severity: 'toast',
          message: msg,
          refId: messageId
        });
        return;
      }
      try {
        const { localLlmServer } = await import('../services/localLlmServer');
        const info = await localLlmServer.ensureRunning(cfg.local_model_path);
        cfg = {
          ...cfg,
          base_url: info.baseUrl,
          api_key_encrypted: 'local'
        };
      } catch (e) {
        const msg = `启动本地 llama 服务失败：${(e as Error).message}`;
        logger.error('localLlm.ensureRunning failed', e);
        send('chat:done', { id: messageId, cancelled: false, error: msg });
        appendNotification(sender, {
          channel: 'chat:done',
          kind: 'failure',
          errorCode: 'API_FAILED',
          severity: 'modal',
          message: msg,
          refId: messageId
        });
        return;
      }
    }
  }

  // 用户消息落库
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO messages(conversation_id, role, content, timestamp) VALUES(?, ?, ?, ?)`
    )
    .run(conversationId, 'user', content, now);
  getDb()
    .prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`)
    .run(now, conversationId);

  // 加载历史
  const history = getDb()
    .prepare(
      `SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY id ASC LIMIT 200`
    )
    .all(conversationId) as Array<{ role: string; content: string }>;

  const ctrl = new AbortController();
  inflight.set(messageId, ctrl);

  // 代搜触发条件:
  //   (cfg.supports_web_search === true) || (forceWebSearch === true)
  //   且 全局 search_backend ∈ {ddg, tavily, searxng}
  // forceWebSearch 是聊天框 🌐 toggle 勾上时由前端传入 —— 让用户能"本轮强制搜",
  // 不需要去方案配置里找隐藏的 supports_web_search 开关。
  // 失败 → 通过 chat:sources 推一条 error,让前端 toast 提示用户"代搜失败"。
  let injectedSystem: string | null = null;
  const wantWebSearch = !!(cfg && cfg.supports_web_search) || forceWebSearch;
  if (wantWebSearch) {
    const prefs = loadSearchPrefs();
    if (prefs.backend === 'native') {
      if (forceWebSearch) {
        // 用户强制要联网但 backend 是 'native' —— 让 UI 知道为啥没搜
        send('chat:sources', {
          id: messageId,
          backend: 'native',
          hits: [],
          error: '搜索后端为「native」,请到 设置 → 存储与系统 → 联网搜索 改成 ddg / tavily / searxng'
        });
      }
    } else if (prefs.backend !== 'off') {
      try {
        const r = await runPreSearch(content, prefs);
        if (r) {
          injectedSystem = r.injected;
          // 把检索来源推给前端,UI 上挂"📎 参考来源"卡片
          send('chat:sources', {
            id: messageId,
            backend: prefs.backend,
            hits: r.hits.map((h) => ({
              title: h.title,
              url: h.url,
              snippet: h.snippet,
              hostname: h.hostname
            }))
          });
        } else if (forceWebSearch) {
          // 用户强制要联网但 prefs 缺凭据(tavily 无 key / searxng 无 url)
          send('chat:sources', {
            id: messageId,
            backend: prefs.backend,
            hits: [],
            error: `搜索后端「${prefs.backend}」缺少凭据,请到 设置 → 存储与系统 → 联网搜索 填 key / url`
          });
        }
      } catch (e) {
        logger.warn('pre-search failed (non-fatal)', e);
        // 强制模式下让前端 toast 知道
        if (forceWebSearch) {
          send('chat:sources', {
            id: messageId,
            backend: prefs.backend,
            hits: [],
            error: `代搜出错: ${(e as Error).message}`
          });
        }
      }
    } else if (forceWebSearch) {
      send('chat:sources', {
        id: messageId,
        backend: 'off',
        hits: [],
        error: '搜索后端为「off」,请到 设置 → 存储与系统 → 联网搜索 改成 ddg / tavily / searxng'
      });
    }
  }

  let assistant = '';
  // streamCtx 在 OpenAI / Anthropic adapter 跑完后会把思考过程回填到 reasoningOut；
  // 处理函数共享同一个对象，结束后读 streamCtx.reasoningOut 即可
  const streamCtx: Partial<StreamCtx> = { reasoningOut: null };
  try {
    if (isMockMode() || !cfg) {
      assistant = await runMockChatStream({
        send,
        messageId,
        signal: ctrl.signal
      });
    } else if (cfg.official_kind === 'anthropic') {
      const ctxObj: StreamCtx = {
        cfg,
        modelId: conv.model_id,
        history,
        attachedImages,
        injectedSystem,
        send,
        messageId,
        signal: ctrl.signal
      };
      assistant = await streamAnthropic(ctxObj);
      streamCtx.reasoningOut = ctxObj.reasoningOut ?? null;
    } else {
      const ctxObj: StreamCtx = {
        cfg,
        modelId: conv.model_id,
        history,
        attachedImages,
        injectedSystem,
        send,
        messageId,
        signal: ctrl.signal
      };
      assistant = await streamOpenAICompat(ctxObj);
      streamCtx.reasoningOut = ctxObj.reasoningOut ?? null;
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      send('chat:done', { id: messageId, cancelled: true });
      appendNotification(sender, {
        channel: 'chat:done',
        kind: 'info',
        message: '对话已中断',
        refId: messageId
      });
    } else {
      logger.error('chat.send streamError', e);
      const errMsg = (e as Error).message;
      send('chat:done', {
        id: messageId,
        cancelled: false,
        error: errMsg
      });
      appendNotification(sender, {
        channel: 'chat:done',
        kind: 'failure',
        errorCode: 'API_FAILED',
        severity: 'toast',
        message: errMsg,
        refId: messageId
      });
    }
    if (assistant) {
      const ts = new Date().toISOString();
      getDb()
        .prepare(
          `INSERT INTO messages(conversation_id, role, content, reasoning_content, timestamp)
           VALUES(?, ?, ?, ?, ?)`
        )
        .run(conversationId, 'assistant', assistant + '\n\n[已中断]', streamCtx.reasoningOut ?? null, ts);
    }
    return;
  } finally {
    // 无论正常完成 / 出错 / 中断，都从在途表移除：杜绝 AbortController 泄漏，
    // 也避免下次取消拿到旧 controller。（真正"流永不 settle"的 hang 需靠用户按 Esc
    // 触发 abort 兜底——JS 无法强制结束一个永不 resolve 的 await。）
    inflight.delete(messageId);
  }

  // 保存助手消息
  const ts = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO messages(conversation_id, role, content, reasoning_content, timestamp)
       VALUES(?, ?, ?, ?, ?)`
    )
    .run(conversationId, 'assistant', assistant, streamCtx.reasoningOut ?? null, ts);
  getDb()
    .prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`)
    .run(ts, conversationId);
  send('chat:done', { id: messageId, cancelled: false });
  appendNotification(sender, {
    channel: 'chat:done',
    kind: 'success',
    refId: messageId
  });
}

function findConfigForModel(planId: number, modelDisplayId: string):
  | (ConfigRow & { actualModelId: string })
  | null {
  const configs = getDb()
    .prepare(`SELECT * FROM api_configs WHERE plan_id = ? AND type = 'text' ORDER BY id`)
    .all(planId) as ConfigRow[];

  for (const c of configs) {
    let map: Record<string, string> = {};
    try {
      map = JSON.parse(c.model_mapping || '{}');
    } catch {
      map = {};
    }
    if (map[modelDisplayId]) {
      return { ...c, actualModelId: map[modelDisplayId] };
    }
  }
  return null;
}

interface StreamCtx {
  cfg: ConfigRow & { actualModelId: string };
  modelId: string;
  history: Array<{ role: string; content: string }>;
  /** 仅作用于"最后一条 user 消息"——把这些图作为多模态内容附进去 */
  attachedImages?: string[];
  /**
   * 代搜（DDG / Tavily / SearXNG）拼好的 system 注入文本。非 null 时
   * 会在 messages 头插入 role=system 的一条；同时让本次请求**不再**注入 native web_search tool。
   */
  injectedSystem?: string | null;
  send: (channel: string, payload: unknown) => void;
  messageId: string;
  signal: AbortSignal;
  /** 输出参数：流结束后由 adapter 写入，供 handleSend 落库到 messages.reasoning_content */
  reasoningOut?: string | null;
}

interface SearchPrefs {
  backend: SearchBackend;
  tavilyKey: string;
  searxngUrl: string;
  bochaKey: string;
  zhipuKey: string;
  jinaKey: string;
  serperKey: string;
}

function loadSearchPrefs(): SearchPrefs {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT key, value FROM settings WHERE key IN (
        'search_backend','search_tavily_key','search_searxng_url',
        'search_bocha_key','search_zhipu_key','search_jina_key','search_serper_key'
      )`
    )
    .all() as Array<{ key: string; value: string }>;
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const raw = (map.get('search_backend') ?? 'native') as SearchBackend;
  const allowed: SearchBackend[] = [
    'native',
    'ddg',
    'tavily',
    'searxng',
    'bocha',
    'zhipu',
    'jina',
    'serper',
    'off'
  ];
  return {
    backend: allowed.includes(raw) ? raw : 'native',
    tavilyKey: map.get('search_tavily_key') ?? '',
    searxngUrl: map.get('search_searxng_url') ?? '',
    bochaKey: map.get('search_bocha_key') ?? '',
    zhipuKey: map.get('search_zhipu_key') ?? '',
    jinaKey: map.get('search_jina_key') ?? '',
    serperKey: map.get('search_serper_key') ?? ''
  };
}

/**
 * 跑一次代搜并返回 hits + 注入文本。失败 → 返回 null（让对话照常发出，不阻塞）。
 */
async function runPreSearch(
  query: string,
  prefs: SearchPrefs
): Promise<{ hits: SearchHit[]; injected: string } | null> {
  if (!query.trim()) return null;
  try {
    let hits: SearchHit[] = [];
    if (prefs.backend === 'ddg') {
      hits = await searchDdg(query);
    } else if (prefs.backend === 'tavily') {
      if (!prefs.tavilyKey) {
        logger.warn('search backend=tavily but no key set, skipping');
        return null;
      }
      hits = await searchTavily(query, prefs.tavilyKey);
    } else if (prefs.backend === 'searxng') {
      if (!prefs.searxngUrl) {
        logger.warn('search backend=searxng but no url set, skipping');
        return null;
      }
      hits = await searchSearxng(query, prefs.searxngUrl);
    } else if (prefs.backend === 'bocha') {
      if (!prefs.bochaKey) {
        logger.warn('search backend=bocha but no key set, skipping');
        return null;
      }
      hits = await searchBocha(query, prefs.bochaKey);
    } else if (prefs.backend === 'zhipu') {
      if (!prefs.zhipuKey) {
        logger.warn('search backend=zhipu but no key set, skipping');
        return null;
      }
      hits = await searchZhipu(query, prefs.zhipuKey);
    } else if (prefs.backend === 'jina') {
      if (!prefs.jinaKey) {
        logger.warn('search backend=jina but no key set, skipping');
        return null;
      }
      hits = await searchJina(query, prefs.jinaKey);
    } else if (prefs.backend === 'serper') {
      if (!prefs.serperKey) {
        logger.warn('search backend=serper but no key set, skipping');
        return null;
      }
      hits = await searchSerper(query, prefs.serperKey);
    } else {
      return null;
    }
    if (hits.length === 0) return null;
    return { hits, injected: renderSearchContext(query, hits) };
  } catch (e) {
    logger.error('pre-search failed', e);
    return null;
  }
}

async function streamOpenAICompat(ctx: StreamCtx): Promise<string> {
  const url = joinApiUrl(ctx.cfg.base_url, 'chat/completions');
  const apiKey = decryptString(ctx.cfg.api_key_encrypted);

  const messages: Array<{ role: string; content: unknown }> = ctx.history.map((m) => ({
    role: m.role,
    content: m.content
  }));

  // 代搜结果 → 顶头插一条 system；走代搜路径时本次不再注入 native web_search tool
  if (ctx.injectedSystem) {
    messages.unshift({ role: 'system', content: ctx.injectedSystem });
  }

  // 最后一条 user 消息附加图片 → OpenAI 多模态格式
  if (ctx.attachedImages && ctx.attachedImages.length > 0 && messages.length > 0) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        const text = String(messages[i].content ?? '');
        messages[i].content = [
          ...(text.trim().length > 0
            ? [{ type: 'text', text }]
            : [{ type: 'text', text: '请分析这张图片' }]),
          ...ctx.attachedImages.map((url) => ({
            type: 'image_url',
            image_url: { url }
          }))
        ];
        break;
      }
    }
  }

  // 联网搜索：仅在"未走代搜"且方案勾了 supports_web_search 时按家族白名单注入 native tool。
  // 未知家族（含 Deepseek、各类中转站）不注入，避免发出 web_search_preview 无效字面量导致 400。
  const reqBody: Record<string, unknown> = {
    model: ctx.cfg.actualModelId,
    messages,
    stream: true
  };
  if (ctx.cfg.supports_web_search && !ctx.injectedSystem) {
    injectNativeWebSearchTool(reqBody, ctx.cfg);
  }
  // 思考模式：按家族注入 thinking 字段（Deepseek V4 / Kimi / GLM-Z1 走 thinking.*；
  // o-系列走 reasoning_effort；anthropic 走 budget_tokens 见 streamAnthropic）
  injectThinkingIntoOpenAICompat(reqBody, ctx.cfg);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(reqBody),
    signal: ctx.signal
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(humanizeChatError(res.status, text));
  }
  if (!res.body) throw new Error('no response body');

  const decoder = new TextDecoder();
  const reader = res.body.getReader();
  let buffer = '';
  let assembled = '';
  let reasoningAssembled = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE 按 \n\n 分块
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);

      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const json = JSON.parse(payload) as {
            choices?: Array<{
              delta?: { content?: string; reasoning_content?: string };
            }>;
          };
          const reasoningDelta = json.choices?.[0]?.delta?.reasoning_content;
          if (reasoningDelta) {
            reasoningAssembled += reasoningDelta;
            ctx.send('chat:reasoning-chunk', { id: ctx.messageId, delta: reasoningDelta });
          }
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            assembled += delta;
            ctx.send('chat:chunk', { id: ctx.messageId, delta });
          }
        } catch {
          // 忽略非 JSON 行（注释 / keep-alive）
        }
      }
    }
  }

  // 思考过程通过引用回写给调用方，由 handleSend 落库 messages.reasoning_content
  ctx.reasoningOut = reasoningAssembled || null;
  return assembled;
}

// ─────────────────────────────────────────────────────
// Anthropic 原生协议（POST /v1/messages，SSE 事件型）
// 文档：https://docs.anthropic.com/en/api/messages-streaming
// 区别：
//   - 鉴权头：x-api-key（不是 Authorization Bearer）
//   - 必带：anthropic-version: 2023-06-01
//   - system 消息走顶层 system 字段，messages 不带 role: 'system'
//   - 流式事件：message_start / content_block_delta / message_stop ...
// ─────────────────────────────────────────────────────
async function streamAnthropic(ctx: StreamCtx): Promise<string> {
  const url = joinApiUrl(ctx.cfg.base_url, 'messages');
  const apiKey = decryptString(ctx.cfg.api_key_encrypted);

  // Anthropic 把 system 单独抽出去；代搜注入文本拼到末尾
  const systemPieces = ctx.history.filter((m) => m.role === 'system').map((m) => m.content);
  if (ctx.injectedSystem) systemPieces.push(ctx.injectedSystem);
  const systemTexts = systemPieces.join('\n\n');
  const messages: Array<{ role: string; content: unknown }> = ctx.history
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role, content: m.content as unknown }));

  // 最后一条 user 消息附图 → Anthropic 多模态 content blocks
  if (ctx.attachedImages && ctx.attachedImages.length > 0 && messages.length > 0) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        const text = String(messages[i].content ?? '');
        const blocks: Array<Record<string, unknown>> = [];
        for (const url of ctx.attachedImages) {
          // data URI → 拆出 media_type + base64
          const m = /^data:([^;]+);base64,(.+)$/.exec(url);
          if (m) {
            blocks.push({
              type: 'image',
              source: { type: 'base64', media_type: m[1], data: m[2] }
            });
          } else {
            blocks.push({ type: 'image', source: { type: 'url', url } });
          }
        }
        blocks.push({
          type: 'text',
          text: text.trim().length > 0 ? text : '请分析这张图片'
        });
        messages[i].content = blocks;
        break;
      }
    }
  }

  const body: Record<string, unknown> = {
    model: ctx.cfg.actualModelId,
    messages,
    max_tokens: 4096,
    stream: true
  };
  if (systemTexts) body.system = systemTexts;

  // 思考模式（Claude 3.7+ extended thinking）
  if (ctx.cfg.supports_thinking) {
    const budget = thinkingBudgetForEffort(ctx.cfg.thinking_effort);
    body.thinking = { type: 'enabled', budget_tokens: budget };
    // Anthropic 要求 thinking 启用时 max_tokens > budget_tokens
    body.max_tokens = Math.max(budget + 1024, 4096);
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify(body),
    signal: ctx.signal
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(humanizeChatError(res.status, text));
  }
  if (!res.body) throw new Error('no response body');

  const decoder = new TextDecoder();
  const reader = res.body.getReader();
  let buffer = '';
  let assembled = '';
  let reasoningAssembled = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      // 一个 SSE 块里有 event: 行 + data: 行；我们只关心 data:
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        try {
          const json = JSON.parse(payload) as {
            type?: string;
            delta?: { type?: string; text?: string; thinking?: string };
          };
          if (json.type === 'content_block_delta') {
            if (json.delta?.type === 'text_delta') {
              const delta = json.delta.text ?? '';
              if (delta) {
                assembled += delta;
                ctx.send('chat:chunk', { id: ctx.messageId, delta });
              }
            } else if (json.delta?.type === 'thinking_delta') {
              // Claude 3.7+ extended thinking 流式片段
              const delta = json.delta.thinking ?? '';
              if (delta) {
                reasoningAssembled += delta;
                ctx.send('chat:reasoning-chunk', { id: ctx.messageId, delta });
              }
            }
          }
        } catch {
          /* 心跳 / 注释忽略 */
        }
      }
    }
  }

  ctx.reasoningOut = reasoningAssembled || null;
  return assembled;
}

/** 把上游 4xx/5xx 响应转成对用户更友好的文案（保留可观测信息） */
function humanizeChatError(status: number, rawText: string): string {
  let parsed: { error?: { type?: string; message?: string; code?: string } } = {};
  try {
    parsed = JSON.parse(rawText);
  } catch {
    /* 非 JSON 直接落到原文 */
  }
  const errType = parsed.error?.type ?? '';
  const errMsg = parsed.error?.message ?? '';

  if (errType === 'access_terminated_error' || /Coding Agents/i.test(errMsg)) {
    return [
      `HTTP ${status}：该模型受 Kimi 政策限制，仅对 Claude Code / Kimi CLI / Roo Code 等编码 Agent 开放。`,
      `请在设置里把模型映射改成 \`kimi-latest\` / \`moonshot-v1-8k\` / \`moonshot-v1-32k\` 等通用模型。`
    ].join('\n');
  }
  // 上游 Rust serde 把 image_url content part 拒为未知变体 = 实际路由到的模型不支持视觉。
  // 典型场景：方案显示名写成"Qwen3-VL-Plus"但 model_mapping 值映射到 qwen-plus（纯文本）。
  if (
    status === 400 &&
    /unknown variant\s*[`'"]?image_url/i.test(rawText) &&
    /expected\s*[`'"]?text/i.test(rawText)
  ) {
    return [
      `HTTP 400：上游模型不支持视觉输入（image_url 字段被拒）。`,
      `常见原因：`,
      `· 方案的「模型映射」里实际模型 ID 是纯文本模型（如 qwen-plus / qwen-turbo），不是 VL/Vision 变体`,
      `· 中转站把 VL 模型路由到了文本后端`,
      `请到「设置 → 方案 → 模型映射」核对这条对话模型的实际 ID 是否带 \`-vl-\` 或对应 vision 标识；或换用 GPT-4o / Claude / Gemini 等已知支持视觉的模型。`
    ].join('\n');
  }
  if (status === 404) {
    return [
      `HTTP 404：上游说"找不到资源"。可能原因：`,
      `· base_url 路径错（多/少 /v1）`,
      `· 模型映射里实际模型 ID 在该中转站不存在`,
      `· 该 endpoint 不是 OpenAI 兼容 (/v1/chat/completions)`,
      errMsg ? `上游原话：${errMsg}` : ''
    ]
      .filter(Boolean)
      .join('\n');
  }
  if (status === 401 || status === 403) {
    return `HTTP ${status} 鉴权失败：${errMsg || rawText.slice(0, 200)}`;
  }
  if (status === 429) {
    return `HTTP 429 限流：${errMsg || '稍后重试，或换一个 API Key / 中转站'}`;
  }
  return `HTTP ${status}: ${errMsg || rawText.slice(0, 300)}`;
}
