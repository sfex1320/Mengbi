/**
 * 智能体「蓝图」纯函数层（无 store / 无 electron / 无 @xyflow，可单测）：
 *  - parseBlueprint：把 LLM 文本回复解析 + 校验成规范蓝图（丢弃非法节点 / 连线，收集 warnings）。
 *  - sanitizeNodeParams：只保留目录暴露的参数字段 + 校验枚举 / 钳值。
 *  - clampWorkForModel：按所选绘画模型的 family 校正 比例 / 档位 / 质量 / 张数。
 *  - pickModelName：从可用模型里挑显示名（尊重覆盖、否则首个 usable）。
 * builder（impure）在这之上做建点 / 连线 / 接图 / 运行。
 */
import type { SmartNodeKind } from '@shared/smartCanvas';
import {
  WORK_TYPE_LABELS,
  LLM_OP_LABELS,
  REVERSE_TYPE_LABELS,
  VIDEO_MODE_LABELS,
  LIGHT_OCCLUSION_LABELS,
  LIGHT_EFFECT_LABELS,
  LIGHT_SOURCE_LABELS,
  CAMERA_TYPE_LABELS,
  APERTURE_LABELS,
  MOVEMENT_LABELS,
  FOCAL_LABELS,
  COMPOSITION_LABELS,
  PALETTE_SCHEME_LABELS
} from '@shared/smartCanvas';
import type { InputControl } from '@shared/comfyui';
import { extractJsonBlock } from '@/lib/jsonPrompt';
import { CATALOG, isNodeKind } from '@/lib/agentCatalog';
import { detectFamily } from '@/types/imageModelFamilies';
import { RATIO_ASPECTS, SIZE_TIERS } from '@/lib/sizeSpec';
import type { MappedModel } from '@/lib/modelMapping';

export type AgentImageSource = 'attached' | 'selected' | 'gallery';

export interface BlueprintNode {
  id: string;
  kind: SmartNodeKind;
  params: Record<string, unknown>;
  rationale?: string;
}
export interface BlueprintEdge {
  from: string;
  to: string;
  fromHandle?: string;
  toHandle?: string;
}
export interface BlueprintImageBinding {
  node: string;
  source: AgentImageSource;
  indexes?: number[];
}
export interface AgentBlueprint {
  summary: string;
  nodes: BlueprintNode[];
  edges: BlueprintEdge[];
  imageBindings: BlueprintImageBinding[];
}
export interface BlueprintParseResult {
  ok: boolean;
  spec?: AgentBlueprint;
  warnings: string[];
  reason?: string;
}

// ───────────────────────── 小工具 ─────────────────────────

function asString(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return undefined;
}
function asInt(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.round(n) : undefined;
}
function asNum(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

const WORK_TYPE_KEYS = new Set(Object.keys(WORK_TYPE_LABELS));
const LLM_OP_KEYS = new Set(Object.keys(LLM_OP_LABELS));
const REVERSE_KEYS = new Set(Object.keys(REVERSE_TYPE_LABELS));
const VIDEO_MODE_KEYS = new Set(Object.keys(VIDEO_MODE_LABELS));
const RATIO_ASPECT_SET = new Set(RATIO_ASPECTS);
const SIZE_TIER_SET = new Set(SIZE_TIERS);
const SCALE_MODES = new Set(['factor', 'longest', 'shortest', 'width', 'height', 'fit', 'pixels', 'exact']);
const SCALE_FORMATS = new Set(['png', 'jpeg', 'webp']);
const RATIO_EMIT = new Set(['both', 'aspect', 'resolution']);
const PALETTE_MODES = new Set(['extract', 'scheme']);
const PALETTE_SCHEMES = new Set(Object.keys(PALETTE_SCHEME_LABELS));
const CAM_MODES = new Set(['photo', 'video']);
const LOOP_SOURCES = new Set(['images', 'prompts', 'folder', 'sizes', 'range', 'count']);
const LIGHT_OCC = new Set(Object.keys(LIGHT_OCCLUSION_LABELS));
const LIGHT_EFF = new Set(Object.keys(LIGHT_EFFECT_LABELS));
const LIGHT_SRC = new Set(Object.keys(LIGHT_SOURCE_LABELS));
const CAMERA_TYPES = new Set(Object.keys(CAMERA_TYPE_LABELS));
const APERTURES = new Set(Object.keys(APERTURE_LABELS));
const MOVEMENTS = new Set(Object.keys(MOVEMENT_LABELS));
const FOCALS = new Set(Object.keys(FOCAL_LABELS));
const COMPOSITIONS = new Set(Object.keys(COMPOSITION_LABELS));
/** ComfyUI 控件里属于「图片/文件」类（由上游喂入，不由 LLM 设值）。 */
export const COMFY_NON_VALUE_KINDS = new Set(['image', 'multi_image', 'mask', 'video', 'audio', 'file']);

// ───────────────────────── 参数收口 ─────────────────────────

/**
 * 只保留目录声明的参数字段 + 按节点类型校验枚举 / 钳值。LLM 编造的字段一律丢弃。
 * 注意：不在此注入 modelId / seed / provider（那是 builder 的确定性收口）；
 * work 的 比例 / 档位 / 质量 / 张数 还需 clampWorkForModel 二次按模型校正。
 */
export function sanitizeNodeParams(kind: SmartNodeKind, raw: unknown): Record<string, unknown> {
  const spec = CATALOG[kind];
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const allowed = new Set(spec.params.map((p) => p.key));
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(src)) {
    if (!allowed.has(key)) continue;
    out[key] = src[key];
  }

  // 通用：text / prompt / 各类字符串字段统一成字符串
  for (const k of ['text', 'prompt', 'negativePrompt', 'instruction', 'title', 'desc', 'styleType', 'promptLines', 'prefix', 'baseHex']) {
    if (k in out) {
      const s = asString(out[k]);
      if (s === undefined) delete out[k];
      else out[k] = s;
    }
  }

  switch (kind) {
    case 'work': {
      if ('workType' in out && !WORK_TYPE_KEYS.has(String(out.workType))) delete out.workType;
      if ('aspect' in out) {
        const s = asString(out.aspect);
        if (s) out.aspect = s;
        else delete out.aspect;
      }
      if ('imageSize' in out) {
        const s = asString(out.imageSize);
        if (s) out.imageSize = s;
        else delete out.imageSize;
      }
      if ('quality' in out) {
        const s = asString(out.quality);
        if (s) out.quality = s;
        else delete out.quality;
      }
      if ('strength' in out) {
        const n = asNum(out.strength);
        if (n === undefined) delete out.strength;
        else out.strength = clamp(n, 0, 1);
      }
      if ('n' in out) {
        const n = asInt(out.n);
        if (n === undefined) delete out.n;
        else out.n = clamp(n, 1, 4);
      }
      break;
    }
    case 'comfy': {
      if ('template' in out) {
        const s = asString(out.template);
        if (s) out.template = s;
        else delete out.template;
      }
      // controls：保留为对象（键=控件名/id，值=要设的值），builder 再按真实模板校验映射
      if ('controls' in out && !(out.controls && typeof out.controls === 'object' && !Array.isArray(out.controls))) {
        delete out.controls;
      }
      break;
    }
    case 'ratio': {
      if ('aspect' in out && !RATIO_ASPECT_SET.has(String(out.aspect))) delete out.aspect;
      if ('tier' in out && !SIZE_TIER_SET.has(String(out.tier))) delete out.tier;
      if ('emit' in out && !RATIO_EMIT.has(String(out.emit))) delete out.emit;
      break;
    }
    case 'llm': {
      if ('op' in out && !LLM_OP_KEYS.has(String(out.op))) delete out.op;
      break;
    }
    case 'image-reverse':
    case 'video-reverse': {
      if ('reverseType' in out && !REVERSE_KEYS.has(String(out.reverseType))) delete out.reverseType;
      if ('frameCount' in out) {
        const n = asInt(out.frameCount);
        if (n === undefined || n <= 0) delete out.frameCount;
        else out.frameCount = clamp(n, 1, 32);
      }
      break;
    }
    case 'video': {
      if ('mode' in out && !VIDEO_MODE_KEYS.has(String(out.mode))) delete out.mode;
      for (const k of ['duration', 'aspect', 'resolution']) {
        if (k in out) {
          const s = asString(out[k]);
          if (s) out[k] = s;
          else delete out[k];
        }
      }
      break;
    }
    case 'scale': {
      if ('mode' in out && !SCALE_MODES.has(String(out.mode))) delete out.mode;
      if ('format' in out && !SCALE_FORMATS.has(String(out.format))) delete out.format;
      if ('keepAspect' in out) out.keepAspect = !!out.keepAspect;
      if ('noUpscale' in out) out.noUpscale = !!out.noUpscale;
      if ('factor' in out) {
        const n = asNum(out.factor);
        if (n === undefined) delete out.factor;
        else out.factor = clamp(n, 0.1, 8);
      }
      for (const k of ['edge', 'fitW', 'fitH'] as const) {
        if (k in out) {
          const n = asInt(out[k]);
          if (n === undefined) delete out[k];
          else out[k] = clamp(n, 16, 8192);
        }
      }
      if ('megapixels' in out) {
        const n = asNum(out.megapixels);
        if (n === undefined) delete out.megapixels;
        else out.megapixels = clamp(n, 0.1, 64);
      }
      break;
    }
    case 'palette': {
      if ('mode' in out && !PALETTE_MODES.has(String(out.mode))) delete out.mode;
      if ('scheme' in out && !PALETTE_SCHEMES.has(String(out.scheme))) delete out.scheme;
      if ('count' in out) {
        const n = asInt(out.count);
        if (n === undefined) delete out.count;
        else out.count = clamp(n, 2, 12);
      }
      break;
    }
    case 'angle-prompt': {
      if ('camMode' in out && !CAM_MODES.has(String(out.camMode))) delete out.camMode;
      if ('cameraType' in out && !CAMERA_TYPES.has(String(out.cameraType))) delete out.cameraType;
      if ('aperture' in out && !APERTURES.has(String(out.aperture))) delete out.aperture;
      if ('movement' in out && !MOVEMENTS.has(String(out.movement))) delete out.movement;
      if ('focal' in out && !FOCALS.has(String(out.focal))) delete out.focal;
      if ('composition' in out && !COMPOSITIONS.has(String(out.composition))) delete out.composition;
      break;
    }
    case 'light': {
      if ('sourceType' in out && !LIGHT_SRC.has(String(out.sourceType))) delete out.sourceType;
      if ('occlusion' in out && !LIGHT_OCC.has(String(out.occlusion))) delete out.occlusion;
      if ('effect' in out && !LIGHT_EFF.has(String(out.effect))) delete out.effect;
      if ('intensity' in out) {
        const n = asInt(out.intensity);
        if (n === undefined) delete out.intensity;
        else out.intensity = clamp(n, 0, 100);
      }
      if ('warmth' in out) {
        const n = asInt(out.warmth);
        if (n === undefined) delete out.warmth;
        else out.warmth = clamp(n, -100, 100);
      }
      break;
    }
    case 'storyboard': {
      if ('shotCount' in out) {
        const n = asInt(out.shotCount);
        if (n === undefined) delete out.shotCount;
        else out.shotCount = clamp(n, 2, 20);
      }
      break;
    }
    case 'loop': {
      if ('sourceType' in out && !LOOP_SOURCES.has(String(out.sourceType))) delete out.sourceType;
      if ('count' in out) {
        const n = asInt(out.count);
        if (n === undefined) delete out.count;
        else out.count = clamp(n, 1, 1000);
      }
      break;
    }
    case 'frame-interp': {
      if ('targetFps' in out) {
        const n = asInt(out.targetFps);
        if (n === undefined) delete out.targetFps;
        else out.targetFps = clamp(n, 24, 120);
      }
      break;
    }
    default:
      break;
  }
  return out;
}

/**
 * 按所选绘画模型的 family 二次校正 work 节点参数：
 *  - 比例不在 family.supportedAspects → 退回 1:1（或该 family 首个支持比例）。
 *  - 档位不在 family.supportedTiers → 退回 2K（或首个支持档）。
 *  - family 不支持 quality → 删除 quality。
 *  - n 钳到 [1, family.maxN]。
 * actualId 空时（没选到模型）不校正，原样返回。
 */
export function clampWorkForModel(params: Record<string, unknown>, actualId: string): Record<string, unknown> {
  if (!actualId) return { ...params };
  const fam = detectFamily(actualId);
  const out: Record<string, unknown> = { ...params };
  if (typeof out.aspect === 'string' && !fam.supportedAspects.includes(out.aspect)) {
    out.aspect = fam.supportedAspects.includes('1:1') ? '1:1' : fam.supportedAspects[0] ?? '1:1';
  }
  if (typeof out.imageSize === 'string' && fam.supportedTiers.length && !fam.supportedTiers.includes(out.imageSize as never)) {
    out.imageSize = (fam.supportedTiers as string[]).includes('2K') ? '2K' : (fam.supportedTiers as string[])[0];
  }
  if ('quality' in out && !fam.supportsQuality) delete out.quality;
  if (typeof out.n === 'number') out.n = clamp(out.n, 1, fam.maxN);
  return out;
}

/**
 * 从可用模型里挑显示名：尽量按 override 模糊匹配（处理「同名不同中转站」——用户配了多个中转站、
 * 同一基础模型名带不同前缀，如「gpt-image-2（FHL）」「gpt-image-2（Now Coding）」；用户/LLM 说
 * 「gpt-image-2」或「FHL 的 gpt-image-2」都能命中正确那条）。匹配不到才退回首个 usable。
 * 匹配顺序：精确显示名 → 精确标签 → 名/标签互相包含 → 词级全包含（override 的每个词都在标签里）。
 */
export function pickModelName(models: MappedModel[], override?: string): string {
  const usable = models.filter((x) => x.usable);
  const q = (override ?? '').trim().toLowerCase();
  if (q) {
    let m =
      usable.find((x) => x.name.toLowerCase() === q) ??
      usable.find((x) => x.label.toLowerCase() === q) ??
      usable.find((x) => x.name.toLowerCase().includes(q) || q.includes(x.name.toLowerCase())) ??
      usable.find((x) => x.label.toLowerCase().includes(q) || q.includes(x.label.toLowerCase()));
    if (!m) {
      // 词级：「FHL 的 gpt-image-2」→ 命中标签里同时含 fhl + gpt-image-2 的那条
      const words = q.split(/[\s,，、/（）()的]+/).filter(Boolean);
      if (words.length) m = usable.find((x) => { const L = x.label.toLowerCase(); return words.every((w) => L.includes(w)); });
    }
    if (m) return m.name;
  }
  return usable[0]?.name ?? '';
}

// ───────────────────────── 蓝图解析 ─────────────────────────

/**
 * 把 LLM 文本回复解析成规范蓝图：
 *  - extractJsonBlock 去围栏取首个平衡 JSON 块 → JSON.parse。
 *  - 丢弃非法 kind / 重复 id / 指向不存在节点的连线 / 自连，全部记 warnings。
 *  - 无任何合法节点 → ok:false。
 */
export function parseBlueprint(text: string): BlueprintParseResult {
  let json: unknown;
  try {
    json = JSON.parse(extractJsonBlock(text));
  } catch {
    return { ok: false, warnings: [], reason: '模型返回的不是有效 JSON' };
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return { ok: false, warnings: [], reason: '模型返回的 JSON 结构不对（应是对象）' };
  }
  const obj = json as Record<string, unknown>;
  const warnings: string[] = [];

  const rawNodes = Array.isArray(obj.nodes) ? obj.nodes : [];
  if (!rawNodes.length) return { ok: false, warnings, reason: '规划结果里没有任何节点' };

  const nodes: BlueprintNode[] = [];
  const seenIds = new Set<string>();
  for (const rn of rawNodes) {
    if (!rn || typeof rn !== 'object') continue;
    const o = rn as Record<string, unknown>;
    const id = asString(o.id);
    const kind = o.kind;
    if (!id) {
      warnings.push('丢弃了一个缺少 id 的节点');
      continue;
    }
    if (seenIds.has(id)) {
      warnings.push(`丢弃了重复 id 的节点：${id}`);
      continue;
    }
    if (!isNodeKind(kind)) {
      warnings.push(`丢弃了未知类型的节点：${String(kind)}`);
      continue;
    }
    seenIds.add(id);
    const params = o.params && typeof o.params === 'object' && !Array.isArray(o.params) ? (o.params as Record<string, unknown>) : {};
    nodes.push({ id, kind, params, rationale: asString(o.rationale) });
  }
  if (!nodes.length) return { ok: false, warnings, reason: '规划结果里没有合法节点' };

  const ids = new Set(nodes.map((n) => n.id));
  const rawEdges = Array.isArray(obj.edges) ? obj.edges : [];
  const edges: BlueprintEdge[] = [];
  const edgeSeen = new Set<string>();
  for (const re of rawEdges) {
    if (!re || typeof re !== 'object') continue;
    const o = re as Record<string, unknown>;
    const from = asString(o.from);
    const to = asString(o.to);
    if (!from || !to || from === to || !ids.has(from) || !ids.has(to)) {
      warnings.push('丢弃了一条无效连线');
      continue;
    }
    const key = `${from}>${to}`;
    if (edgeSeen.has(key)) continue;
    edgeSeen.add(key);
    edges.push({ from, to, fromHandle: asString(o.fromHandle), toHandle: asString(o.toHandle) });
  }

  const rawBinds = Array.isArray(obj.imageBindings) ? obj.imageBindings : [];
  const imageBindings: BlueprintImageBinding[] = [];
  for (const rb of rawBinds) {
    if (!rb || typeof rb !== 'object') continue;
    const o = rb as Record<string, unknown>;
    const node = asString(o.node);
    const source = asString(o.source);
    if (!node || !ids.has(node) || (source !== 'attached' && source !== 'selected' && source !== 'gallery')) continue;
    let indexes: number[] | undefined;
    if (Array.isArray(o.indexes)) {
      indexes = o.indexes.map((x) => asInt(x)).filter((x): x is number => x !== undefined && x >= 0);
    }
    imageBindings.push({ node, source, indexes });
  }

  return {
    ok: true,
    warnings,
    spec: { summary: asString(obj.summary) ?? '', nodes, edges, imageBindings }
  };
}

// ───────────────────────── 布局：以画布中心为锚的分层排布 ─────────────────────────

export interface XY {
  x: number;
  y: number;
}

/**
 * 给蓝图节点算位置：按连线拓扑分层，上游在左、下游在右，整簇以 center 为中心。
 * 不触碰画布上已有节点（避免「适应全部」打乱用户现有布局）。返回 localId → 坐标。
 */
export function layoutBlueprint(nodes: BlueprintNode[], edges: BlueprintEdge[], center: XY): Map<string, XY> {
  const COL = 320;
  const ROW = 210;
  const ids = nodes.map((n) => n.id);
  const adj = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  ids.forEach((id) => indeg.set(id, 0));
  for (const e of edges) {
    if (!indeg.has(e.from) || !indeg.has(e.to)) continue;
    (adj.get(e.from) ?? adj.set(e.from, []).get(e.from)!).push(e.to);
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  }
  // 最长路径分层（Kahn + relax）
  const layer = new Map<string, number>();
  ids.forEach((id) => layer.set(id, 0));
  const queue = ids.filter((id) => (indeg.get(id) ?? 0) === 0);
  const work = new Map(indeg);
  const visited = new Set<string>();
  while (queue.length) {
    const u = queue.shift();
    if (u === undefined) break;
    visited.add(u);
    for (const v of adj.get(u) ?? []) {
      if ((layer.get(v) ?? 0) < (layer.get(u) ?? 0) + 1) layer.set(v, (layer.get(u) ?? 0) + 1);
      work.set(v, (work.get(v) ?? 0) - 1);
      if ((work.get(v) ?? 0) === 0) queue.push(v);
    }
  }
  // 环里没遍历到的节点：保底放在 layer 0
  for (const id of ids) if (!visited.has(id)) layer.set(id, layer.get(id) ?? 0);

  const byLayer = new Map<number, string[]>();
  for (const id of ids) {
    const l = layer.get(id) ?? 0;
    (byLayer.get(l) ?? byLayer.set(l, []).get(l)!).push(id);
  }
  const maxLayer = Math.max(0, ...[...layer.values()]);
  const startX = center.x - (maxLayer * COL) / 2;
  const pos = new Map<string, XY>();
  for (const [l, layerIds] of byLayer) {
    const colH = (layerIds.length - 1) * ROW;
    const startY = center.y - colH / 2;
    layerIds.forEach((id, i) => pos.set(id, { x: startX + l * COL, y: startY + i * ROW }));
  }
  return pos;
}

// ───────────────────────── ComfyUI：模板匹配 + 控件值映射 ─────────────────────────

/** 智能体用的精简 ComfyUI 模板（含可设控件）。 */
export interface AgentComfyTemplate {
  workflowId: string;
  name: string;
  typeTags?: string[];
  controls: InputControl[];
}

/**
 * 按 LLM 给的关键词/名称从可用模板里挑一个：精确名(忽略大小写) → 名称含关键词 → 关键词含名称 → 标签命中 → null。
 */
export function matchComfyTemplate(templates: AgentComfyTemplate[], query: string | undefined): AgentComfyTemplate | null {
  if (!templates.length) return null;
  if (!query || !query.trim()) return templates[0];
  const q = query.trim().toLowerCase();
  const exact = templates.find((t) => t.name.toLowerCase() === q);
  if (exact) return exact;
  const nameHas = templates.find((t) => t.name.toLowerCase().includes(q));
  if (nameHas) return nameHas;
  const qHasName = templates.find((t) => t.name && q.includes(t.name.toLowerCase()));
  if (qHasName) return qHasName;
  const tagHit = templates.find((t) => (t.typeTags ?? []).some((tag) => tag.toLowerCase().includes(q) || q.includes(tag.toLowerCase())));
  if (tagHit) return tagHit;
  return null;
}

/**
 * 把 LLM 给的 controls（键=控件名称/id）映射成 controlValues（键=控件 id）：
 *  - 先用模板控件的 default 填底。
 *  - 图片/文件类控件跳过（由上游喂入）。
 *  - 按 id 或 label（忽略大小写、含匹配）找控件，按控件类型 coerce 值（数字/开关/下拉项校验）。
 * 纯函数，可单测。
 */
export function resolveComfyControls(
  controls: InputControl[],
  llmControls: Record<string, unknown> | undefined
): Record<string, unknown> {
  const cv: Record<string, unknown> = {};
  for (const c of controls) {
    if (c.default !== undefined && !COMFY_NON_VALUE_KINDS.has(c.type)) cv[c.id] = c.default;
  }
  if (!llmControls || typeof llmControls !== 'object') return cv;

  const settable = controls.filter((c) => !COMFY_NON_VALUE_KINDS.has(c.type));
  for (const [rawKey, rawVal] of Object.entries(llmControls)) {
    const key = rawKey.trim().toLowerCase();
    const ctrl =
      settable.find((c) => c.id.toLowerCase() === key) ??
      settable.find((c) => (c.label ?? '').toLowerCase() === key) ??
      settable.find((c) => (c.label ?? '').toLowerCase().includes(key) || key.includes((c.label ?? '').toLowerCase()));
    if (!ctrl) continue;
    cv[ctrl.id] = coerceControlValue(ctrl, rawVal);
  }
  return cv;
}

function coerceControlValue(c: InputControl, v: unknown): unknown {
  switch (c.type) {
    case 'number':
    case 'seed':
    case 'slider': {
      let n = asNum(v);
      if (n === undefined) return c.default ?? 0;
      if (typeof c.min === 'number') n = Math.max(c.min, n);
      if (typeof c.max === 'number') n = Math.min(c.max, n);
      return n;
    }
    case 'switch':
      return typeof v === 'boolean' ? v : v === 'true' || v === 1 || v === '1';
    case 'select': {
      const s = asString(v);
      if (s === undefined) return c.default ?? '';
      const opts = c.options ?? [];
      const byVal = opts.find((o) => o.value === s || o.value.toLowerCase() === s.toLowerCase());
      if (byVal) return byVal.value;
      const byLabel = opts.find((o) => o.label.toLowerCase() === s.toLowerCase() || o.label.toLowerCase().includes(s.toLowerCase()));
      return byLabel ? byLabel.value : (c.default ?? s);
    }
    default:
      return asString(v) ?? c.default ?? '';
  }
}
