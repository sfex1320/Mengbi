import { register, ok, err } from './helpers';
import { SaveSettingsSchema, TestConnectionSchema, PlanUpsertSchema } from './schemas';
import { getDb } from '../services/db';
import { encryptString, decryptString } from '../services/safeStorage';
import { buildModelsEndpointCandidates } from '../services/apiUrl';
import { logger, maskKey } from '../services/logger';
import { makeError } from '@shared/error';
import type {
  ApiConfig,
  ApiConfigInput,
  ApiPlan,
  PromptCategory,
  SettingsBundle
} from '@shared/domain';
import type { TestConnectionResult } from '@shared/ipc';
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
        | 'comfyui_workflow_json'
        | 'local_model_path'
        | 'supports_thinking'
        | 'thinking_effort'
        | 'icon'
        | 'proxy_timeout_seconds'
      > & {
        model_mapping: string;
        is_official: number;
        supports_web_search: number;
        supports_vision: number;
        body_overrides_json: string | null;
        comfyui_workflow_json: string | null;
        local_model_path: string | null;
        supports_thinking: number | null;
        thinking_effort: string | null;
        icon: string | null;
        proxy_timeout_seconds: number | null;
      }
    >;

  const configs: ApiConfig[] = configsRaw.map((row) => ({
    ...row,
    model_mapping: safeParseJSON<Record<string, string>>(row.model_mapping, {}),
    is_official: !!row.is_official,
    supports_web_search: !!row.supports_web_search,
    supports_vision: !!row.supports_vision,
    body_overrides_json: row.body_overrides_json ?? null,
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

  if (cfg.id !== undefined) {
    // 编辑：若 api_key_plain 为空，保留原 api_key_encrypted 不动
    if (hasNewKey) {
      db.prepare(
        `UPDATE api_configs
            SET plan_id=?, type=?, provider_name=?, base_url=?, api_key_encrypted=?,
                model_mapping=?, is_official=?, supports_web_search=?, supports_vision=?,
                official_kind=?, image_kind=?, body_overrides_json=?, comfyui_workflow_json=?,
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
        normalizeOverrides(cfg.body_overrides_json),
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
                official_kind=?, image_kind=?, body_overrides_json=?, comfyui_workflow_json=?,
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
        normalizeOverrides(cfg.body_overrides_json),
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
        body_overrides_json, comfyui_workflow_json, local_model_path,
        supports_thinking, thinking_effort, icon, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      normalizeOverrides(cfg.body_overrides_json),
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

async function testConnection(input: {
  base_url: string;
  api_key_plain: string;
  type: 'image' | 'text';
  model_id?: string;
}): Promise<{ ok: true; data: TestConnectionResult } | { ok: false; error: ReturnType<typeof makeError> }> {
  const candidates = buildModelsEndpointCandidates(input.base_url);
  let lastStatus: number | null = null;
  let lastUrl: string | null = null;
  let lastLatency = 0;

  for (const url of candidates) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const start = Date.now();
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${input.api_key_plain}`,
          Accept: 'application/json'
        },
        signal: ctrl.signal
      });
      clearTimeout(timer);
      lastStatus = res.status;
      lastUrl = url;
      lastLatency = Date.now() - start;

      // 401/403：endpoint 在但 Key 错——立刻报
      if (res.status === 401 || res.status === 403) {
        return {
          ok: false,
          error: makeError(
            'API_KEY_INVALID',
            `认证失败（HTTP ${res.status}），请检查 API Key 是否正确并未过期`,
            { severity: 'inline' }
          )
        };
      }

      if (res.ok) {
        const latency = Date.now() - start;
        let models: string[] | undefined;
        try {
          const body = (await res.json()) as { data?: Array<{ id: string }> };
          if (Array.isArray(body.data)) models = body.data.map((m) => m.id).slice(0, 32);
        } catch {
          /* 非标准响应也算连通 */
        }
        logger.info(`testConnection 200 via ${url} (${latency}ms)`);
        return { ok: true, data: { ok: true, latency_ms: latency, models } };
      }
      logger.info(`testConnection ${res.status} on ${url}, trying next`);
    } catch (e) {
      clearTimeout(timer);
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('aborted')) {
        return {
          ok: false,
          error: makeError('NETWORK_TIMEOUT', '请求超时（8 秒）', {
            severity: 'inline',
            hint: '请检查网络或 base_url 是否可达'
          })
        };
      }
      return {
        ok: false,
        error: makeError('NETWORK_OFFLINE', `网络错误：${msg}`, { severity: 'inline' })
      };
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
    error: makeError('API_FAILED', '主机不可达，所有候选路径无响应', {
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
