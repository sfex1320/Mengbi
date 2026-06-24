/**
 * 模型配置智能体——对话式信息抽取层（纯函数）。
 * 用户在对话框里随意描述（地址 / Key / 名称可能分多次、格式不一），LLM 逐轮抽取这些字段、
 * 缺什么就友好追问；本模块提供：给 LLM 的系统提示词、LLM 回合 JSON 解析、无 LLM 时的正则回退抽取、
 * 字段合并 / 缺项判断 / 由地址自动起名。
 */
import { extractJsonBlock } from '@/lib/jsonPrompt';

export interface ConfigFields {
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  /** 自定义请求头 JSON 文本（卡密会员等非 Bearer 鉴权才需要） */
  headerOverrides?: string;
}

export interface ConfigChatTurn {
  /** 给用户看的话（友好、中文） */
  reply: string;
  /** 本轮抽取/更新到的字段 */
  fields: ConfigFields;
  /** 信息是否齐全（有 地址 + Key）可以开跑 */
  ready: boolean;
  /** 还缺的字段（中文标签） */
  missing: string[];
}

const FIELD_KEYS = ['name', 'baseUrl', 'apiKey', 'headerOverrides'] as const;

/** 给 LLM 的系统提示词：从对话里抽取配置字段、缺啥追问、只输出 JSON。 */
export function buildChatSystemPrompt(have: ConfigFields): string {
  const haveLines = [
    `名称：${have.name || '（未提供）'}`,
    `API 地址：${have.baseUrl || '（未提供）'}`,
    `API Key：${have.apiKey ? '已提供' : '（未提供）'}`,
    `自定义请求头：${have.headerOverrides ? '已提供' : '（无）'}`
  ].join('\n');
  return [
    '你是「梦笔模型配置助手」，正通过对话帮用户配置一个 AI 中转站 / 官方接口。',
    '你的任务：从用户每句话里抽取 名称(name)、API 地址(baseUrl，形如 https://xxx/v1)、API Key、可选自定义请求头(headerOverrides，JSON 文本)。',
    '',
    '# 目前已收集',
    haveLines,
    '',
    '# 规则',
    '- 地址 与 Key 是必须的；名称可选（缺名称不要追问，后续会自动用域名生成）。',
    '- 用户这轮提供了什么就抽进 fields；没提供的字段留空字符串，绝不要编造或臆测 Key/地址。',
    '- 若仍缺 地址 或 Key：ready=false，在 reply 里用中文、友好且具体地说明还缺什么、给一个格式示例，请用户补上。',
    '- 若 地址 与 Key 都齐了：ready=true，reply 里说「信息齐了，我开始拉取模型并自动配置」。',
    '- 用户可能更正之前的信息（如换了 Key / 改了地址）：以最新提供的为准。',
    '- reply 简短、中文、友好；不要把 Key 原文复述出来。',
    '',
    '# 只输出 JSON（不要解释、不要 markdown 围栏）',
    '{"reply":"给用户的话","fields":{"name":"","baseUrl":"","apiKey":"","headerOverrides":""},"ready":false,"missing":["API 地址"]}'
  ].join('\n');
}

/** 解析 LLM 一回合输出。永不抛。 */
export function parseConfigChatTurn(text: string): { ok: boolean; turn?: ConfigChatTurn; reason?: string } {
  const block = extractJsonBlock(text ?? '');
  if (!block) return { ok: false, reason: '空输出' };
  let raw: unknown;
  try {
    raw = JSON.parse(block);
  } catch {
    return { ok: false, reason: '无法解析为 JSON' };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'JSON 顶层不是对象' };
  const o = raw as Record<string, unknown>;
  const fieldsRaw =
    o.fields && typeof o.fields === 'object' && !Array.isArray(o.fields) ? (o.fields as Record<string, unknown>) : {};
  const fields: ConfigFields = {};
  for (const k of FIELD_KEYS) {
    const v = fieldsRaw[k];
    if (typeof v === 'string' && v.trim()) fields[k] = v.trim();
  }
  const reply = typeof o.reply === 'string' ? o.reply : '';
  const ready = o.ready === true;
  const missing = Array.isArray(o.missing) ? o.missing.filter((x): x is string => typeof x === 'string') : [];
  return { ok: true, turn: { reply, fields, ready, missing } };
}

const URL_RE = /https?:\/\/[^\s"'<>]+/i;
const KEY_LABELED_RE = /\b((?:sk|om|gsk|xai|key|tok|pat|api)[-_][A-Za-z0-9_-]{8,})\b/i;

/** 无 LLM 时的正则回退：从一段文本里抽 baseUrl / apiKey（名称难以正则，留给自动起名）。 */
export function extractConfigFromText(text: string): ConfigFields {
  const f: ConfigFields = {};
  const t = text ?? '';
  const urlMatch = t.match(URL_RE);
  let url = '';
  if (urlMatch) {
    url = urlMatch[0].replace(/[)\]>.,;，。、]+$/, '');
    f.baseUrl = url;
  }
  const labeled = t.match(KEY_LABELED_RE);
  if (labeled) {
    f.apiKey = labeled[1];
  } else {
    // 去掉 URL 后找一个长 token 当 Key（避免把地址当 Key）
    const rest = url ? t.replace(url, ' ') : t;
    const generic = rest.match(/\b[A-Za-z0-9_-]{24,}\b/);
    if (generic) f.apiKey = generic[0];
  }
  return f;
}

/** 合并字段：b 里非空的值覆盖 a（用户更正以最新为准）。 */
export function mergeFields(a: ConfigFields, b: ConfigFields): ConfigFields {
  const out: ConfigFields = { ...a };
  for (const k of FIELD_KEYS) {
    const v = b[k];
    if (typeof v === 'string' && v.trim()) out[k] = v.trim();
  }
  return out;
}

/** 还缺的必填字段（地址 / Key）。名称不算必填（可自动起名）。 */
export function missingFields(f: ConfigFields): string[] {
  const m: string[] = [];
  if (!f.baseUrl?.trim()) m.push('API 地址');
  if (!f.apiKey?.trim()) m.push('API Key');
  return m;
}

export function isReady(f: ConfigFields): boolean {
  return missingFields(f).length === 0;
}

/** 缺名称时按地址域名自动起一个（api.openmodel.ai → OpenModel）。 */
export function deriveNameFromUrl(baseUrl: string): string {
  try {
    const host = new URL(baseUrl).host.toLowerCase().replace(/^api\./, '').replace(/^www\./, '');
    const parts = host.split('.').filter(Boolean);
    const core = parts.length >= 2 ? parts[parts.length - 2] : parts[0] || '';
    return core ? core.charAt(0).toUpperCase() + core.slice(1) : '中转站';
  } catch {
    return '中转站';
  }
}

/** 无 LLM 时的模板化回复（规则回退也能「对话」）。 */
export function templatedReply(f: ConfigFields): { reply: string; missing: string[] } {
  const missing = missingFields(f);
  if (missing.length === 0) {
    return { reply: '信息齐了，我开始拉取模型并自动配置…', missing };
  }
  const got: string[] = [];
  if (f.baseUrl) got.push('地址');
  if (f.apiKey) got.push('Key');
  if (f.name) got.push('名称');
  const gotStr = got.length ? `已经收到${got.join('、')}。` : '';
  return {
    reply: `${gotStr}还差 ${missing.join(' 和 ')}，发我一下吧（地址形如 https://xxx/v1，Key 直接粘贴）。`,
    missing
  };
}
