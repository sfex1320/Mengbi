/**
 * 解析中转站 /models 响应：抽取模型 ID 与每个模型声明的协议（supported_protocols）。
 * 纯函数、无 electron / better-sqlite3 依赖，便于单测（vitest 只跑纯函数）。
 *
 * 兼容多种中转站返回形态：
 *   OpenAI:   { data: [{ id }] }
 *   其它:     { models: [...] } / { result: [...] } / 顶层数组
 *   数组项可能是字符串，或 { id|model|name, supported_protocols?: string[] }。
 *
 * 「按模型原生协议路由」的中转（如 openmodel.ai）会在每个模型上带
 *   supported_protocols: ["messages"|"gemini"|"responses"|"images"|...]，
 * 据此可自动判定该模型在梦笔里该选哪种「对话 API 协议」。
 */

export interface ModelEntry {
  id: string;
  /** 该模型支持的原生协议（如 ["messages"]）；中转未声明时为 undefined */
  protocols?: string[];
}

function pickArray(body: unknown): unknown[] | null {
  if (Array.isArray(body)) return body;
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    if (Array.isArray(b.data)) return b.data as unknown[];
    if (Array.isArray(b.models)) return b.models as unknown[];
    if (Array.isArray(b.result)) return b.result as unknown[];
  }
  return null;
}

function toStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === 'string' && x.length > 0);
  return out.length ? out : undefined;
}

/** 抽取模型条目（id + 可选协议）。最多 64 条，与旧 extractModelIds 上限一致。 */
export function extractModelEntries(body: unknown): ModelEntry[] | undefined {
  const arr = pickArray(body);
  if (!arr) return undefined;
  const entries: ModelEntry[] = [];
  for (const m of arr) {
    if (typeof m === 'string') {
      if (m.length > 0) entries.push({ id: m });
      continue;
    }
    if (m && typeof m === 'object') {
      const o = m as Record<string, unknown>;
      const v = o.id ?? o.model ?? o.name;
      if (typeof v === 'string' && v.length > 0) {
        const protocols = toStringArray(o.supported_protocols ?? o.supportedProtocols);
        entries.push(protocols ? { id: v, protocols } : { id: v });
      }
    }
  }
  return entries.length ? entries.slice(0, 64) : undefined;
}

/** 仅抽模型 ID（向后兼容旧调用）。 */
export function extractModelIds(body: unknown): string[] | undefined {
  const entries = extractModelEntries(body);
  return entries ? entries.map((e) => e.id) : undefined;
}

/** 由模型条目构造「实际模型 ID → 协议数组」映射（仅含声明了协议的模型）。 */
export function buildModelProtocols(
  entries: ModelEntry[] | undefined
): Record<string, string[]> | undefined {
  if (!entries) return undefined;
  const map: Record<string, string[]> = {};
  for (const e of entries) if (e.protocols && e.protocols.length) map[e.id] = e.protocols;
  return Object.keys(map).length ? map : undefined;
}
