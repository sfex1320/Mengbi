import { z } from 'zod';
import type { WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import { register, ok } from './helpers';
import { ChatSendSchema } from './schemas';
import { getDb } from '../services/db';
import { decryptString } from '../services/safeStorage';
import { joinApiUrl } from '../services/apiUrl';
import { logger } from '../services/logger';
import { isMockMode } from './mocks/runtime';
import { runMockChatStream } from './mocks/chat';

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
  supports_web_search?: number;
  supports_vision?: number;
}

const inflight = new Map<string, AbortController>();

export function registerChatHandlers(): void {
  register('api:chat:send', ChatSendSchema, async (input, event) => {
    const messageId = randomUUID();
    const sender = event.sender;
    handleSend(input.conversationId, input.content, messageId, sender).catch((e) => {
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
        `SELECT role, content, timestamp FROM messages WHERE conversation_id = ? ORDER BY id ASC`
      )
      .all(id) as Array<{ role: string; content: string; timestamp: string }>;
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
  // OpenAI 兼容的 web search 工具（仅支持的模型会用，不支持的中转会忽略或回 4xx）
  if (opts.supportsWebSearch) {
    reqBody.tools = [{ type: 'web_search_preview' }];
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
  messageId: string,
  sender: WebContents
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
    return;
  }

  const cfg = findConfigForModel(conv.plan_id, conv.model_id);
  if (!cfg && !isMockMode()) {
    send('chat:done', {
      id: messageId,
      cancelled: false,
      error: `没有找到对应模型「${conv.model_id}」的配置`
    });
    return;
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

  let assistant = '';
  try {
    if (isMockMode() || !cfg) {
      assistant = await runMockChatStream({
        send,
        messageId,
        signal: ctrl.signal
      });
    } else if (cfg.official_kind === 'anthropic') {
      assistant = await streamAnthropic({
        cfg,
        modelId: conv.model_id,
        history,
        send,
        messageId,
        signal: ctrl.signal
      });
    } else {
      assistant = await streamOpenAICompat({
        cfg,
        modelId: conv.model_id,
        history,
        send,
        messageId,
        signal: ctrl.signal
      });
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      send('chat:done', { id: messageId, cancelled: true });
    } else {
      logger.error('chat.send streamError', e);
      send('chat:done', {
        id: messageId,
        cancelled: false,
        error: (e as Error).message
      });
    }
    inflight.delete(messageId);
    if (assistant) {
      const ts = new Date().toISOString();
      getDb()
        .prepare(
          `INSERT INTO messages(conversation_id, role, content, timestamp) VALUES(?, ?, ?, ?)`
        )
        .run(conversationId, 'assistant', assistant + '\n\n[已中断]', ts);
    }
    return;
  }

  inflight.delete(messageId);
  // 保存助手消息
  const ts = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO messages(conversation_id, role, content, timestamp) VALUES(?, ?, ?, ?)`
    )
    .run(conversationId, 'assistant', assistant, ts);
  getDb()
    .prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`)
    .run(ts, conversationId);
  send('chat:done', { id: messageId, cancelled: false });
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
  send: (channel: string, payload: unknown) => void;
  messageId: string;
  signal: AbortSignal;
}

async function streamOpenAICompat(ctx: StreamCtx): Promise<string> {
  const url = joinApiUrl(ctx.cfg.base_url, 'chat/completions');
  const apiKey = decryptString(ctx.cfg.api_key_encrypted);

  const messages = ctx.history.map((m) => ({
    role: m.role,
    content: m.content
  }));

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: ctx.cfg.actualModelId,
      messages,
      stream: true
    }),
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
            choices?: Array<{ delta?: { content?: string } }>;
          };
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

  // Anthropic 把 system 单独抽出去
  const systemTexts = ctx.history
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const messages = ctx.history
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role, content: m.content }));

  const body: Record<string, unknown> = {
    model: ctx.cfg.actualModelId,
    messages,
    max_tokens: 4096,
    stream: true
  };
  if (systemTexts) body.system = systemTexts;

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
            delta?: { type?: string; text?: string };
          };
          if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta') {
            const delta = json.delta.text ?? '';
            if (delta) {
              assembled += delta;
              ctx.send('chat:chunk', { id: ctx.messageId, delta });
            }
          }
        } catch {
          /* 心跳 / 注释忽略 */
        }
      }
    }
  }

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
