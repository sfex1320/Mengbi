import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { register, ok, err, parseModelRef } from './helpers';
import { SaveSettingsSchema, TestConnectionSchema, TestProtocolSchema, PlanUpsertSchema, ApplyOverridesSchema } from './schemas';
import { getDb } from '../services/db';
import { encryptString, decryptString } from '../services/safeStorage';
import { buildModelsEndpointCandidates, joinApiUrl, httpStatusHint } from '../services/apiUrl';
import { applyBodyOverrides } from './imageBody';
import { applyHeaderOverrides } from './headerOverrides';
import { extractModelEntries, buildModelProtocols } from './modelList';
import { chromiumFetch } from '../services/httpClient';
import { logger, maskKey } from '../services/logger';
import { makeError } from '@shared/error';
import type {
  ApiConfig,
  ApiConfigInput,
  ApiPlan,
  PromptCategory,
  SettingsBundle
} from '@shared/domain';
import { normalizeVideoKind } from '@shared/domain';
import type { TestConnectionResult, TestProtocolResult } from '@shared/ipc';
import { z } from 'zod';
import { runMockTestConnection, isMockMode } from './mocks/runtime';

// ─────────────────────────────────────────────────────
// 注册 settings / plan handlers
// ─────────────────────────────────────────────────────

export function registerSettingsHandlers(): void {
  register('api:settings:get', null, async () => ok(loadBundle()));

  register('api:settings:save', SaveSettingsSchema, async (input) => {
    // zod transform 会把 kimi/minimax/glm/deepseek 归一到 openai-compat，
    // 但 zod 推导的输入类型是 union，要 cast 到 ApiConfigInput 才能传给 saveBundle
    saveBundle(input as { configs?: ApiConfigInput[]; prefs?: Record<string, string> });
    return ok(loadBundle());
  });

  register('api:settings:test-connection', TestConnectionSchema, async (input) => {
    if (isMockMode()) {
      const r = await runMockTestConnection(input);
      return ok(r);
    }
    return testConnection(input);
  });

  register('api:settings:test-protocol', TestProtocolSchema, async (input) => {
    if (isMockMode()) {
      return ok<TestProtocolResult>({ ok: true, status: 200, message: 'Mock：协议测试通过。' });
    }
    return ok(await testProtocol(input));
  });

  // 一键修复：把请求体/请求头覆盖片段合并进某绘画模型配置（通知中心「一键修复」按钮调用）。
  register('api:settings:apply-overrides', ApplyOverridesSchema, async (input) => {
    if (!input.bodyMerge && !input.headerMerge) {
      return err(makeError('VALIDATION_FAILED', '没有要应用的覆盖内容', { severity: 'toast' }));
    }
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, provider_name, model_mapping, body_overrides_json, header_overrides_json FROM api_configs WHERE type = 'image' ORDER BY id`
      )
      .all() as Array<{
      id: number;
      provider_name: string | null;
      model_mapping: string;
      body_overrides_json: string | null;
      header_overrides_json: string | null;
    }>;
    type Row = (typeof rows)[number];
    const mapOf = (r: Row): Record<string, string> => {
      try {
        return JSON.parse(r.model_mapping || '{}');
      } catch {
        return {};
      }
    };
    // 复合标识「中转站 / 名」精确命中，回退按裸名首个命中（与 generate.ts findImageConfig 同套）
    const { provider, name } = parseModelRef(input.modelId);
    let target: Row | undefined;
    if (provider) target = rows.find((r) => (r.provider_name ?? '').trim() === provider && mapOf(r)[name]);
    if (!target) target = rows.find((r) => mapOf(r)[name]);
    if (!target) {
      return err(
        makeError('VALIDATION_FAILED', `没找到绘画模型「${input.modelId}」对应的配置（可能已删除）`, { severity: 'toast' })
      );
    }
    // 合并：解析现有 JSON（坏的当空），用补丁顶层覆盖，回写。null 值保留（applyBodyOverrides 据此删字段）。
    const mergeJson = (existing: string | null, patch?: Record<string, unknown>): string | null => {
      if (!patch || Object.keys(patch).length === 0) return existing;
      let cur: Record<string, unknown> = {};
      try {
        cur = existing ? (JSON.parse(existing) as Record<string, unknown>) : {};
        if (!cur || typeof cur !== 'object' || Array.isArray(cur)) cur = {};
      } catch {
        cur = {};
      }
      return JSON.stringify({ ...cur, ...patch }, null, 2);
    };
    const newBody = mergeJson(target.body_overrides_json, input.bodyMerge);
    const newHeader = mergeJson(target.header_overrides_json, input.headerMerge);
    db.prepare(`UPDATE api_configs SET body_overrides_json = ?, header_overrides_json = ? WHERE id = ?`).run(
      newBody,
      newHeader,
      target.id
    );
    logger.info('apply-overrides 已写入', { configId: target.id, modelId: input.modelId, bodyMerge: input.bodyMerge });
    return ok({ configId: target.id, providerName: target.provider_name ?? '', bodyOverrides: newBody });
  });

  register('api:plan:list', null, async () => ok(listPlans()));

  register('api:plan:upsert', PlanUpsertSchema, async (input) => {
    const row = upsertPlan(input);
    return ok(row);
  });

  register('api:plan:delete', z.number().int(), async (id) => {
    const r = getDb().prepare(`DELETE FROM api_plans WHERE id = ?`).run(id);
    if (r.changes === 0) {
      return err(
        makeError('VALIDATION_FAILED', '方案不存在或已被删除', { severity: 'toast' })
      );
    }
    return ok(true as const);
  });

  register('api:plan:configs', z.number().int(), async (planId) => ok(listConfigs(planId)));

  register('api:plan:config:delete', z.number().int(), async (id) => {
    const r = getDb().prepare(`DELETE FROM api_configs WHERE id = ?`).run(id);
    if (r.changes === 0) {
      return err(makeError('VALIDATION_FAILED', '配置不存在或已被删除', { severity: 'toast' }));
    }
    return ok(true as const);
  });
}

// ─────────────────────────────────────────────────────
// DB 实现
// ─────────────────────────────────────────────────────

function loadBundle(): SettingsBundle {
  const db = getDb();
  const plans = db.prepare(`SELECT * FROM api_plans ORDER BY id`).all() as ApiPlan[];
  const configsRaw = db
    .prepare(`SELECT * FROM api_configs ORDER BY id`)
    .all() as Array<
      Omit<
        ApiConfig,
        | 'model_mapping'
        | 'is_official'
        | 'supports_web_search'
        | 'supports_vision'
        | 'body_overrides_json'
        | 'header_overrides_json'
        | 'comfyui_workflow_json'
        | 'local_model_path'
        | 'supports_thinking'
        | 'thinking_effort'
        | 'icon'
        | 'proxy_timeout_seconds'
        | 'video_kind'
      > & {
        model_mapping: string;
        is_official: number;
        supports_web_search: number;
        supports_vision: number;
        body_overrides_json: string | null;
        header_overrides_json: string | null;
        comfyui_workflow_json: string | null;
        local_model_path: string | null;
        supports_thinking: number | null;
        thinking_effort: string | null;
        icon: string | null;
        proxy_timeout_seconds: number | null;
        video_kind: string | null;
      }
    >;

  const configs: ApiConfig[] = configsRaw.map((row) => ({
    ...row,
    model_mapping: safeParseJSON<Record<string, string>>(row.model_mapping, {}),
    is_official: !!row.is_official,
    supports_web_search: !!row.supports_web_search,
    supports_vision: !!row.supports_vision,
    body_overrides_json: row.body_overrides_json ?? null,
    header_overrides_json: row.header_overrides_json ?? null,
    comfyui_workflow_json: row.comfyui_workflow_json ?? null,
    local_model_path: row.local_model_path ?? null,
    supports_thinking: !!row.supports_thinking,
    // 任何不在白名单的旧值（包括 NULL）都归一为 null，下游统一判定
    thinking_effort:
      row.thinking_effort === 'low' ||
      row.thinking_effort === 'medium' ||
      row.thinking_effort === 'high' ||
      row.thinking_effort === 'max'
        ? row.thinking_effort
        : null,
    icon: row.icon ?? null,
    proxy_timeout_seconds: row.proxy_timeout_seconds ?? null,
    video_kind: normalizeVideoKind(row.video_kind),
    api_key_plain: decryptString(row.api_key_encrypted)
  }));

  const categories = db
    .prepare(`SELECT * FROM prompt_categories ORDER BY sort_order, id`)
    .all() as PromptCategory[];

  const prefRows = db.prepare(`SELECT key, value FROM settings`).all() as Array<{
    key: string;
    value: string;
  }>;
  const prefs = Object.fromEntries(prefRows.map((r) => [r.key, r.value]));

  return { plans, configs, categories, prefs };
}

function saveBundle(input: { configs?: ApiConfigInput[]; prefs?: Record<string, string> }): void {
  const db = getDb();
  db.transaction(() => {
    if (input.prefs) {
      const stmt = db.prepare(
        `INSERT INTO settings(key, value) VALUES(?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      );
      for (const [k, v] of Object.entries(input.prefs)) stmt.run(k, v);
    }

    if (input.configs) {
      for (const cfg of input.configs) upsertConfig(cfg);
    }
  })();
  // GPU 加速开关需要在 app ready **之前**生效（DB 此时尚未初始化），
  // 所以额外同步写一份旁路文件 userData/boot-flags.json，main.ts 启动最早读它。
  if (input.prefs && 'boot_disable_gpu' in input.prefs) {
    try {
      const flagPath = path.join(app.getPath('userData'), 'boot-flags.json');
      let flags: Record<string, string> = {};
      try {
        flags = JSON.parse(fs.readFileSync(flagPath, 'utf-8')) as Record<string, string>;
      } catch {
        /* 不存在/损坏 → 重建 */
      }
      flags.disableGpu = input.prefs.boot_disable_gpu === '1' ? '1' : '0';
      fs.writeFileSync(flagPath, JSON.stringify(flags));
    } catch (e) {
      logger.warn('settings.bootflags.write-failed', { error: String(e) });
    }
  }
}

function upsertConfig(cfg: ApiConfigInput): void {
  const db = getDb();
  const now = new Date().toISOString();
  const mapping = JSON.stringify(cfg.model_mapping ?? {});
  const hasNewKey = !!cfg.api_key_plain;
  const encryptedKey = hasNewKey ? encryptString(cfg.api_key_plain) : '';
  logger.info('settings.config.save', {
    id: cfg.id,
    provider: cfg.provider_name,
    keyChanged: hasNewKey,
    keyMasked: hasNewKey ? maskKey(cfg.api_key_plain) : '(unchanged)'
  });

  // 思考相关字段统一归一（schema 校验后再防一层），UI 可能漏传 thinking_effort
  const supportsThinking = cfg.supports_thinking ? 1 : 0;
  const thinkingEffort: string | null =
    cfg.thinking_effort === 'low' ||
    cfg.thinking_effort === 'medium' ||
    cfg.thinking_effort === 'high' ||
    cfg.thinking_effort === 'max'
      ? cfg.thinking_effort
      : null;

  // 图标：空串归一为 NULL；DB 行允许 lobehub slug 或 data:image dataURI
  const iconCell: string | null =
    typeof cfg.icon === 'string' && cfg.icon.trim() !== '' ? cfg.icon : null;

  // 视频协议变种（仅 type='video' 用）；其它类型恒为 NULL
  const videoKind: string | null = cfg.type === 'video' ? (cfg.video_kind ?? null) : null;

  // 自定义请求头 JSON：空串归一为 NULL（与 body_overrides 同处理）
  const headerOverrides = normalizeOverrides(cfg.header_overrides_json ?? null);

  if (cfg.id !== undefined) {
    // 编辑：若 api_key_plain 为空，保留原 api_key_encrypted 不动
    if (hasNewKey) {
      db.prepare(
        `UPDATE api_configs
            SET plan_id=?, type=?, provider_name=?, base_url=?, api_key_encrypted=?,
                model_mapping=?, is_official=?, supports_web_search=?, supports_vision=?,
                official_kind=?, image_kind=?, video_kind=?, body_overrides_json=?, header_overrides_json=?, comfyui_workflow_json=?,
                local_model_path=?, supports_thinking=?, thinking_effort=?, icon=?
          WHERE id = ?`
      ).run(
        cfg.plan_id,
        cfg.type,
        cfg.provider_name,
        cfg.base_url,
        encryptedKey,
        mapping,
        cfg.is_official ? 1 : 0,
        cfg.supports_web_search ? 1 : 0,
        cfg.supports_vision ? 1 : 0,
        cfg.official_kind,
        cfg.image_kind ?? null,
        videoKind,
        normalizeOverrides(cfg.body_overrides_json),
        headerOverrides,
        normalizeOverrides(cfg.comfyui_workflow_json ?? null),
        cfg.local_model_path?.trim() ? cfg.local_model_path : null,
        supportsThinking,
        thinkingEffort,
        iconCell,
        cfg.id
      );
    } else {
      db.prepare(
        `UPDATE api_configs
            SET plan_id=?, type=?, provider_name=?, base_url=?,
                model_mapping=?, is_official=?, supports_web_search=?, supports_vision=?,
                official_kind=?, image_kind=?, video_kind=?, body_overrides_json=?, header_overrides_json=?, comfyui_workflow_json=?,
                local_model_path=?, supports_thinking=?, thinking_effort=?, icon=?
          WHERE id = ?`
      ).run(
        cfg.plan_id,
        cfg.type,
        cfg.provider_name,
        cfg.base_url,
        mapping,
        cfg.is_official ? 1 : 0,
        cfg.supports_web_search ? 1 : 0,
        cfg.supports_vision ? 1 : 0,
        cfg.official_kind,
        cfg.image_kind ?? null,
        videoKind,
        normalizeOverrides(cfg.body_overrides_json),
        headerOverrides,
        normalizeOverrides(cfg.comfyui_workflow_json ?? null),
        cfg.local_model_path?.trim() ? cfg.local_model_path : null,
        supportsThinking,
        thinkingEffort,
        iconCell,
        cfg.id
      );
    }
  } else {
    if (!hasNewKey) {
      throw new Error('新增模型配置必须填写 API Key');
    }
    db.prepare(
      `INSERT INTO api_configs(
        plan_id, type, provider_name, base_url, api_key_encrypted, model_mapping,
        is_official, supports_web_search, supports_vision, official_kind, image_kind,
        video_kind, body_overrides_json, header_overrides_json, comfyui_workflow_json, local_model_path,
        supports_thinking, thinking_effort, icon, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      cfg.plan_id,
      cfg.type,
      cfg.provider_name,
      cfg.base_url,
      encryptedKey,
      mapping,
      cfg.is_official ? 1 : 0,
      cfg.supports_web_search ? 1 : 0,
      cfg.supports_vision ? 1 : 0,
      cfg.official_kind,
      cfg.image_kind ?? null,
      videoKind,
      normalizeOverrides(cfg.body_overrides_json),
      headerOverrides,
      normalizeOverrides(cfg.comfyui_workflow_json ?? null),
      cfg.local_model_path?.trim() ? cfg.local_model_path : null,
      supportsThinking,
      thinkingEffort,
      iconCell,
      now
    );
  }
}

/**
 * UI 端 textarea 即使被清空也会发空字符串过来。落库时统一把空字符串归一成 NULL，
 * 让"没有覆盖"在 DB 层只有一种表示，避免读回时还要判 `'' || null`。
 */
function normalizeOverrides(s: string | null | undefined): string | null {
  if (s == null) return null;
  return s.trim() === '' ? null : s;
}

function listPlans(): ApiPlan[] {
  return getDb().prepare(`SELECT * FROM api_plans ORDER BY id`).all() as ApiPlan[];
}

function listConfigs(planId: number): ApiConfig[] {
  const rows = getDb()
    .prepare(`SELECT * FROM api_configs WHERE plan_id = ? ORDER BY id`)
    .all(planId) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    ...(r as unknown as ApiConfig),
    model_mapping: safeParseJSON<Record<string, string>>(r.model_mapping as string, {}),
    is_official: !!r.is_official,
    supports_web_search: !!r.supports_web_search,
    supports_vision: !!r.supports_vision,
    body_overrides_json: (r.body_overrides_json as string | null) ?? null,
    comfyui_workflow_json: (r.comfyui_workflow_json as string | null) ?? null,
    local_model_path: (r.local_model_path as string | null) ?? null,
    icon: (r.icon as string | null) ?? null,
    proxy_timeout_seconds: (r.proxy_timeout_seconds as number | null) ?? null,
    video_kind: normalizeVideoKind(r.video_kind),
    api_key_plain: decryptString(r.api_key_encrypted as string)
  }));
}

function upsertPlan(input: { id?: number; name: string }): ApiPlan {
  const db = getDb();
  const now = new Date().toISOString();
  if (input.id !== undefined) {
    db.prepare(`UPDATE api_plans SET name = ?, updated_at = ? WHERE id = ?`).run(
      input.name,
      now,
      input.id
    );
    return db.prepare(`SELECT * FROM api_plans WHERE id = ?`).get(input.id) as ApiPlan;
  }
  const result = db
    .prepare(`INSERT INTO api_plans(name, created_at, updated_at) VALUES(?, ?, ?)`)
    .run(input.name, now, now);
  return db
    .prepare(`SELECT * FROM api_plans WHERE id = ?`)
    .get(result.lastInsertRowid) as ApiPlan;
}

// ─────────────────────────────────────────────────────
// 测试连通（真实 HTTP）
// ─────────────────────────────────────────────────────

/**
 * 协议测试：真实发一次最小调用，验证「地址 + Key + 协议 + 请求体/请求头」整套能否跑通。
 * 「测试连接」只 GET /models（地址可达 + Key 有效），抓不到 response_format 被拒、字段不支持
 * 这类只有真实生成才暴露的协议错误——这里就是补这一环。
 * 范围：text → /chat/completions（max_tokens:1，近乎免费）；image(openai 兼容) → /images/generations
 * （会真实出 1 张图，绘画模型可能产生少量费用）。video / 专有图像协议（grsai/gemini/comfyui）跳过，
 * 因异步、按量计费或格式特殊，提示用户直接生成一次验证。
 */
async function testProtocol(input: {
  base_url: string;
  api_key_plain: string;
  type: 'image' | 'text' | 'video';
  model_id: string;
  official_kind?: string | null;
  image_kind?: string | null;
  body_overrides_json?: string | null;
  header_overrides_json?: string | null;
}): Promise<TestProtocolResult> {
  if (input.type === 'video') {
    return { ok: false, skipped: true, message: '视频为异步且按量计费，未做一键协议测试。请直接用「视频」节点生成一次验证。' };
  }
  if (input.type === 'image' && input.image_kind && input.image_kind !== 'openai' && input.image_kind !== 'openai-compat') {
    return {
      ok: false,
      skipped: true,
      message: `「${input.image_kind}」为专有/异步协议，未做一键协议测试。请直接生成一次验证（请求体覆盖仍会生效）。`
    };
  }

  // 对话协议按 official_kind 分流，与 chat.ts 实际路由一致（anthropic→streamAnthropic /v1/messages，
  // 其余 openai/openai-compat/gemini/local/null→streamOpenAICompat /v1/chat/completions）。
  // 否则给 Anthropic 中转测协议会永远去打 /chat/completions 而误报 404（route not found）。
  const isAnthropicText = input.type === 'text' && input.official_kind === 'anthropic';

  // 鉴权头按协议分支：Anthropic 用 x-api-key + anthropic-version（与 chat.ts:streamAnthropic 逐字段一致，
  // 不是 Bearer）；其余仍用 Authorization: Bearer。再过 applyHeaderOverrides 让自定义鉴权生效。
  const baseHeaders: Record<string, string> = isAnthropicText
    ? {
        'Content-Type': 'application/json',
        'x-api-key': input.api_key_plain,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        Accept: 'application/json'
      }
    : {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.api_key_plain}`,
        Accept: 'application/json'
      };
  const headers = applyHeaderOverrides(baseHeaders, input.header_overrides_json, {
    key: input.api_key_plain,
    model: input.model_id
  });

  let url: string;
  let body: Record<string, unknown>;
  if (isAnthropicText) {
    // 镜像 streamAnthropic：POST /v1/messages，Anthropic 请求体。不发 stream、不开 thinking（保持便宜、避开 budget>max_tokens 约束）。
    url = joinApiUrl(input.base_url, '/messages');
    body = { model: input.model_id, max_tokens: 16, messages: [{ role: 'user', content: 'ping' }] };
  } else if (input.type === 'text') {
    url = joinApiUrl(input.base_url, '/chat/completions');
    body = { model: input.model_id, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1, stream: false };
  } else {
    url = joinApiUrl(input.base_url, '/images/generations');
    const prompt = 'a small red circle on a white background';
    body = { model: input.model_id, prompt, n: 1, size: '1024x1024', response_format: 'b64_json' };
    applyBodyOverrides(body, input.body_overrides_json ?? null, {
      model: input.model_id,
      prompt,
      size: '1024x1024',
      n: 1,
      quality: null,
      aspect: null,
      image_size: null,
      negative_prompt: null
    });
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), input.type === 'image' ? 120_000 : 30_000);
  try {
    // 与生图/对话同一套网络栈（chromiumFetch）——代理 / 自签证书 / TLS 一致，避免「生成能跑、协议测试却网络错误」
    const res = await chromiumFetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal });
    clearTimeout(timer);
    const text = await res.text();
    if (res.ok) {
      return { ok: true, status: res.status, message: `协议通过（HTTP ${res.status}）。这套 地址 / Key / 协议 / 请求体 可正常调用。` };
    }
    return { ok: false, status: res.status, message: protocolErrorHint(res.status, text), detail: text.slice(0, 800) };
  } catch (e) {
    clearTimeout(timer);
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('aborted')) return { ok: false, message: '请求超时。上游响应过慢或被代理掐断——检查网络 / base_url，或稍后重试。' };
    return { ok: false, message: `网络错误：${msg}。检查 base_url 是否可达。` };
  }
}

/** 把协议测试的上游错误翻成「原因 + 怎么办」中文（重点识别 response_format 被拒）。 */
function protocolErrorHint(status: number, raw: string): string {
  const low = raw.toLowerCase();
  if (low.includes('response_format')) {
    return `该模型不支持 response_format 字段（HTTP ${status}）。修复：在本块「高级：请求体覆盖」里填 {"response_format": null} 屏蔽它（下方有一键按钮），再测一次。`;
  }
  if (low.includes('unsupported') && (low.includes('param') || low.includes('field'))) {
    return `上游拒绝了某个请求字段（HTTP ${status}）。看下方原始返回找出字段名，在「请求体覆盖」里把它设为 null 屏蔽。`;
  }
  if (status === 401 || status === 403) return `认证失败（HTTP ${status}）：Key 无效 / 无权使用此模型 / 未在中转站开通。`;
  if (status === 404) {
    if (low.includes('route not found') || low.includes('not_found') || low.includes('no route') || low.includes('not found')) {
      return `接口路径不存在（HTTP ${status}）。该中转可能按模型「原生协议」路由——Claude/DeepSeek/Kimi/MiniMax/Qwen 走 messages（把「对话 API 协议」选成 Anthropic API），Gemini 走 gemini，GPT 走 responses。把协议改成与该模型匹配的再试。`;
    }
    return `接口不存在（HTTP ${status}）：base_url 或协议可能不对（检查是否带 /v1）。`;
  }
  if (status === 429) return `被限流（HTTP ${status}）：稍后重试，或检查账户额度。`;
  if (status >= 500) return `上游服务故障（HTTP ${status}）：稍后重试或换模型。`;
  return `${httpStatusHint(status)}（HTTP ${status}）。详见下方原始返回。`;
}

// 模型列表解析（extractModelIds / extractModelEntries / buildModelProtocols）已抽到 ./modelList（纯函数，便于单测）。

async function testConnection(input: {
  base_url: string;
  api_key_plain: string;
  type: 'image' | 'text' | 'video';
  model_id?: string;
  header_overrides_json?: string | null;
}): Promise<{ ok: true; data: TestConnectionResult } | { ok: false; error: ReturnType<typeof makeError> }> {
  const candidates = buildModelsEndpointCandidates(input.base_url);
  let lastStatus: number | null = null;
  let lastUrl: string | null = null;
  let lastLatency = 0;
  let lastNetErr: string | null = null;

  // 鉴权头：默认 Bearer + 应用用户的自定义请求头/鉴权覆盖（卡密会员/特殊中转站用 x-api-key、Authorization: Token 等）。
  // 拉取模型列表必须带和生成同一套头，否则非 Bearer 鉴权的站点读不到 /models（但生成却能跑）。
  function authHeaders(): Record<string, string> {
    // applyHeaderOverrides 返回（可能新建的）头对象，不原地改入参——必须用返回值
    return applyHeaderOverrides(
      { Authorization: `Bearer ${input.api_key_plain}`, Accept: 'application/json' },
      input.header_overrides_json,
      { key: input.api_key_plain, model: input.model_id ?? '' }
    );
  }

  for (const url of candidates) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    const start = Date.now();
    try {
      // 用 chromiumFetch（Electron net 栈）—— 与生图/对话同一套网络栈：代理 / 自签证书 / TLS 指纹
      // 处理一致。原来用 Node 自带 fetch(undici)，会出现「生成能跑、拉取模型却读不到」的网络栈不一致。
      const res = await chromiumFetch(url, { method: 'GET', headers: authHeaders(), signal: ctrl.signal });
      clearTimeout(timer);
      lastStatus = res.status;
      lastUrl = url;
      lastLatency = Date.now() - start;

      // 401/403：endpoint 在但 Key/鉴权头错——立刻报
      if (res.status === 401 || res.status === 403) {
        return {
          ok: false,
          error: makeError(
            'API_KEY_INVALID',
            `认证失败（HTTP ${res.status}），请检查 API Key 是否正确并未过期；若中转站用非 Bearer 鉴权，请在「高级：自定义请求头」里配置`,
            { severity: 'inline' }
          )
        };
      }

      if (res.ok) {
        const latency = Date.now() - start;
        let models: string[] | undefined;
        let model_protocols: Record<string, string[]> | undefined;
        try {
          const entries = extractModelEntries(JSON.parse(await res.text()));
          models = entries?.map((e) => e.id);
          // 「按模型原生协议路由」的中转（如 openmodel.ai）会带 supported_protocols → 据此自动判定协议
          model_protocols = buildModelProtocols(entries);
        } catch {
          /* 非标准响应也算连通 */
        }
        logger.info(`testConnection 200 via ${url} (${latency}ms, ${models?.length ?? 0} models)`);
        return { ok: true, data: { ok: true, latency_ms: latency, models, model_protocols } };
      }
      logger.info(`testConnection ${res.status} on ${url}, trying next`);
    } catch (e) {
      clearTimeout(timer);
      const msg = e instanceof Error ? e.message : String(e);
      if (/abort/i.test(msg)) {
        return {
          ok: false,
          error: makeError('NETWORK_TIMEOUT', '请求超时（12 秒）', {
            severity: 'inline',
            hint: '请检查网络或 base_url 是否可达'
          })
        };
      }
      // 单个候选的网络/SSL 抖动不直接判死——记录后继续试下一个候选（如 /models 失败再试 /v1/models）
      lastNetErr = msg;
      logger.info(`testConnection net error on ${url}: ${msg}, trying next`);
    }
  }

  // 所有候选都没拿到 200，但拿到了 HTTP 响应（lastStatus != null）→ 主机可达，仅 endpoint 非标准
  if (lastStatus !== null) {
    logger.info(
      `testConnection host reachable but no OpenAI /models endpoint; last ${lastStatus} on ${lastUrl}`
    );
    return {
      ok: true,
      data: {
        ok: true,
        latency_ms: lastLatency,
        models: undefined
      }
    };
  }

  return {
    ok: false,
    error: makeError('API_FAILED', `主机不可达，所有候选路径无响应${lastNetErr ? `（${lastNetErr}）` : ''}`, {
      severity: 'inline',
      hint: '请检查 base_url 与本机网络'
    })
  };
}

function safeParseJSON<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}
