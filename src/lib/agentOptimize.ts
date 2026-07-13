/**
 * 智能体「选区优化」：审查画布上已选中的一段流程 → LLM 出诊断建议 → 可逐条应用。
 * 架构对齐既有三件套（agentBlueprint 纯 / agentPlanner 调 LLM / agentBuilder 动 store）：
 *  - 纯函数（可单测）：collectSelectionContext / parseSuggestions / buildSuggestions / normalizeParamPatch。
 *  - 半纯（依赖注入）：applySuggestion —— store 动作由调用方注入（不 import store，避免测试拖入 zustand/xyflow）。
 *  - impure：optimizeSelection —— 复用 agentPlanner 的 callAgentTextModel（api:chat:optimize-prompt，零新 IPC）。
 * 为什么参数走 sanitizeNodeParams / clampWorkForModel 二次收口：LLM 给的 field/newValue 不可盲信，
 * 必须过既有白名单 + 枚举校验 + family 钳制，才能安全 updateNodeData（与建图路径同一套收口，单一真相）。
 */
import type { SmartNodeKind } from '@shared/smartCanvas';
import { extractJsonBlock } from '@/lib/jsonPrompt';
import { isNodeKind } from '@/lib/agentCatalog';
import { sanitizeNodeParams, clampWorkForModel } from '@/lib/agentBlueprint';
import { callAgentTextModel } from '@/lib/agentPlanner';

// ───────────────────────── 类型 ─────────────────────────

/** 结构化最小节点/连线形状（与 @xyflow/react 的 Node/Edge 结构兼容，避免 lib 直接依赖 xyflow）。 */
export interface SelNodeLike {
  id: string;
  type?: string;
  parentId?: string;
  selected?: boolean;
  data?: unknown;
}
export interface SelEdgeLike {
  source: string;
  target: string;
}

/** 喂给 LLM 的紧凑选区快照（节点摘要 + 选区内部连线）。 */
export interface SelectionContext {
  nodes: Array<Record<string, unknown>>;
  edges: Array<{ from: string; to: string }>;
}

export type AgentSuggestionKind = 'prompt-rewrite' | 'param' | 'structure';

/** LLM 返回的原始建议条目（parseSuggestions 的产物）。 */
export interface RawSuggestion {
  /** 目标节点真实 id（structure 类可为空串 = 整体建议） */
  nodeId: string;
  /** 一句话标题 */
  title: string;
  kind: AgentSuggestionKind;
  /** kind=param 时的参数名（白名单内） */
  field?: string;
  /** prompt-rewrite=改写后的完整提示词；param=新参数值 */
  newValue?: unknown;
  reason: string;
}

/** 带可应用性标记的建议（buildSuggestions 的产物，UI 直接渲染）。 */
export interface AgentSuggestion extends RawSuggestion {
  /** 内部编号 s1/s2…（渲染 key + 应用状态跟踪） */
  id: string;
  /** 是否可一键自动应用（structure / 列表模式提示词 / 白名单外参数 = false） */
  applicable: boolean;
  /** 不可应用时的原因说明（UI 展示） */
  applyNote?: string;
  /** kind=param 且合法时：已按白名单 + 钳制归一后的字段与值（UI 预览用；应用时会再收口一次） */
  patch?: { field: string; value: unknown } | null;
}

export interface SuggestionParseResult {
  ok: boolean;
  items: RawSuggestion[];
  warnings: string[];
  reason?: string;
}

// ───────────────────────── 选区快照（纯函数）─────────────────────────

/** 文本截断上限：LLM 只需要「看个大概」，完整提示词不必全量上传（控制 token 与总长）。 */
const TRUNC_LEN = 80;
const MAX_LIST_ITEMS = 8;
const MAX_NODES = 30;
/** 快照总长上限（~4KB）：超出则从尾部丢节点，保证提示词不会爆长。 */
const MAX_JSON_LEN = 4096;
const MAX_SUGGESTIONS = 12;

function trunc(s: unknown, n = TRUNC_LEN): string | undefined {
  if (typeof s !== 'string') return undefined;
  const t = s.trim();
  if (!t) return undefined;
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

/** 剔除 undefined 值，让快照 JSON 更紧凑（LLM 读起来干净、也省 token）。 */
function compact(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function dataOf(n: SelNodeLike): Record<string, unknown> {
  return n.data && typeof n.data === 'object' && !Array.isArray(n.data) ? (n.data as Record<string, unknown>) : {};
}

/** 按节点类型提取「关键参数」摘要（截断长文本；绝不带 data:URI / 图片字节）。 */
function summarizeNode(kind: string, d: Record<string, unknown>): Record<string, unknown> {
  switch (kind) {
    case 'work':
      return compact({
        model: trunc(d.modelId as string, 60),
        type: typeof d.workType === 'string' ? d.workType : undefined,
        aspect: typeof d.aspect === 'string' && d.aspect ? d.aspect : undefined,
        resolution: typeof d.imageSize === 'string' && d.imageSize ? d.imageSize : undefined,
        quality: typeof d.quality === 'string' && d.quality ? d.quality : undefined,
        n: typeof d.n === 'number' ? d.n : undefined,
        seed: typeof d.seed === 'number' ? d.seed : undefined,
        negativePrompt: trunc(d.negativePrompt)
      });
    case 'prompt': {
      if (d.listMode) {
        const items = Array.isArray(d.items) ? (d.items as unknown[]) : [];
        return compact({
          list: true,
          count: items.length,
          items: items.slice(0, MAX_LIST_ITEMS).map((x) => trunc(x) ?? ''),
          unifiedPrompt: trunc(d.unifiedPrompt)
        });
      }
      return compact({ text: trunc(d.text), unifiedPrompt: trunc(d.unifiedPrompt) });
    }
    case 'llm':
      return compact({ op: typeof d.op === 'string' ? d.op : undefined, instruction: trunc(d.instruction) });
    case 'comfy':
      return compact({ template: trunc(d.templateName as string, 60) });
    case 'video':
      return compact({
        model: trunc(d.modelId as string, 60),
        mode: typeof d.mode === 'string' ? d.mode : undefined,
        duration: typeof d.duration === 'string' && d.duration ? d.duration : undefined,
        aspect: typeof d.aspect === 'string' && d.aspect ? d.aspect : undefined,
        resolution: typeof d.resolution === 'string' && d.resolution ? d.resolution : undefined,
        prompt: trunc(d.prompt),
        negativePrompt: trunc(d.negativePrompt)
      });
    case 'image': {
      const srcs = Array.isArray(d.srcs) ? (d.srcs as unknown[]) : [];
      return compact({
        image: d.listMode ? `列表 ${srcs.length} 张` : d.src ? '已设图' : '空',
        inpaintMask: d.inpaintMaskSrc ? true : undefined
      });
    }
    case 'ratio':
      return compact({
        aspect: typeof d.aspect === 'string' ? d.aspect : undefined,
        tier: typeof d.tier === 'string' ? d.tier : undefined,
        emit: typeof d.emit === 'string' ? d.emit : undefined
      });
    case 'scale':
      return compact({ mode: typeof d.mode === 'string' ? d.mode : undefined });
    case 'storyboard':
      return compact({
        videoDurationSec: typeof d.videoDurationSec === 'number' ? d.videoDurationSec : undefined,
        secPerShot: typeof d.secPerShot === 'number' ? d.secPerShot : undefined
      });
    case 'group':
      return compact({ title: trunc(d.title) });
    default:
      return {};
  }
}

function dedupCap(arr: string[], cap: number): string[] {
  return [...new Set(arr.filter(Boolean))].slice(0, cap);
}

/**
 * 把选中节点压成给 LLM 看的紧凑 JSON：
 *  - nodes：每个选中节点的 类型 + 关键参数摘要（长文本截 80 字）+ 上/下游邻居类型（含选区外，供结构诊断，
 *    如「生图节点没接结果节点」需要知道下游有没有 result）。
 *  - edges：仅选区内部连线（from/to）。
 *  - 总长控制 ~4KB：先截文本 / 限列表条数 / 限节点数，仍超则从尾部丢节点（连带其内部连线）。
 * 纯函数，可单测。
 */
export function collectSelectionContext(nodes: SelNodeLike[], edges: SelEdgeLike[], selectedIds: string[]): SelectionContext {
  const idSet = new Set(selectedIds);
  const kindById = new Map<string, string>();
  for (const n of nodes) kindById.set(n.id, n.type ?? 'unknown');

  const selNodes = nodes.filter((n) => idSet.has(n.id)).slice(0, MAX_NODES);

  const entries: Array<Record<string, unknown>> = selNodes.map((n) => {
    const kind = n.type ?? 'unknown';
    const upstream = dedupCap(
      edges.filter((e) => e.target === n.id).map((e) => kindById.get(e.source) ?? ''),
      6
    );
    const downstream = dedupCap(
      edges.filter((e) => e.source === n.id).map((e) => kindById.get(e.target) ?? ''),
      6
    );
    return compact({
      id: n.id,
      kind,
      ...summarizeNode(kind, dataOf(n)),
      upstream: upstream.length ? upstream : undefined,
      downstream: downstream.length ? downstream : undefined
    });
  });

  const internalEdges = (ids: Set<string>): Array<{ from: string; to: string }> =>
    edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map((e) => ({ from: e.source, to: e.target }));

  let keep = entries;
  let ids = new Set(keep.map((e) => String(e.id)));
  let out: SelectionContext = { nodes: keep, edges: internalEdges(ids) };
  // 超预算就从尾部丢节点：宁可少分析几个节点，也不给 LLM 发一坨超长上下文（截断 JSON 会破坏结构）
  while (JSON.stringify(out).length > MAX_JSON_LEN && keep.length > 1) {
    keep = keep.slice(0, keep.length - 1);
    ids = new Set(keep.map((e) => String(e.id)));
    out = { nodes: keep, edges: internalEdges(ids) };
  }
  return out;
}

// ───────────────────────── 建议解析（纯函数）─────────────────────────

const SUGGESTION_KINDS = new Set<AgentSuggestionKind>(['prompt-rewrite', 'param', 'structure']);

function asStr(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/**
 * 把 LLM 文本回复解析成建议数组：
 *  - extractJsonBlock 去围栏取首个平衡 JSON 块 → JSON.parse。
 *  - 兼容「裸数组」与「{ suggestions: [...] }」两种输出形态（模型经常自作主张包一层）。
 *  - 丢弃未知 kind / 缺 reason 且缺 title 的条目，记 warnings；空数组 = ok（流程没问题）。
 */
export function parseSuggestions(text: string): SuggestionParseResult {
  let json: unknown;
  try {
    json = JSON.parse(extractJsonBlock(text));
  } catch {
    return { ok: false, items: [], warnings: [], reason: '模型返回的不是有效 JSON' };
  }
  let arr: unknown[];
  if (Array.isArray(json)) arr = json;
  else if (json && typeof json === 'object' && Array.isArray((json as Record<string, unknown>).suggestions)) {
    arr = (json as Record<string, unknown>).suggestions as unknown[];
  } else {
    return { ok: false, items: [], warnings: [], reason: '模型返回的 JSON 结构不对（应是建议数组）' };
  }

  const warnings: string[] = [];
  const items: RawSuggestion[] = [];
  for (const raw of arr) {
    if (items.length >= MAX_SUGGESTIONS) break;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const o = raw as Record<string, unknown>;
    const kind = asStr(o.kind);
    if (!kind || !SUGGESTION_KINDS.has(kind as AgentSuggestionKind)) {
      warnings.push(`丢弃了一条未知类型的建议：${String(o.kind ?? '')}`);
      continue;
    }
    const title = asStr(o.title)?.trim();
    const reason = asStr(o.reason)?.trim() ?? '';
    if (!title && !reason) {
      warnings.push('丢弃了一条既无标题也无理由的建议');
      continue;
    }
    items.push({
      nodeId: asStr(o.nodeId)?.trim() ?? '',
      title: title || (reason.length > 40 ? `${reason.slice(0, 40)}…` : reason),
      kind: kind as AgentSuggestionKind,
      field: asStr(o.field)?.trim() || undefined,
      newValue: o.newValue,
      reason
    });
  }
  return { ok: true, items, warnings };
}

// ───────────────────────── 参数白名单归一（纯函数）─────────────────────────

/**
 * 每类节点允许智能体建议修改的参数字段（白名单）。
 * 为什么不放开全部字段：modelId/seed/provider/status/结果等由系统管理，text 走 prompt-rewrite 专用通道；
 * LLM 编造的字段直接拒掉，避免脏写 node data。
 */
const PARAM_FIELDS: Partial<Record<SmartNodeKind, ReadonlySet<string>>> = {
  work: new Set(['aspect', 'imageSize', 'quality', 'n', 'negativePrompt', 'strength', 'workType']),
  video: new Set(['mode', 'duration', 'aspect', 'resolution']),
  llm: new Set(['op', 'instruction']),
  ratio: new Set(['aspect', 'tier', 'emit']),
  scale: new Set(['mode', 'factor', 'edge', 'fitW', 'fitH', 'keepAspect', 'noUpscale', 'format']),
  storyboard: new Set(['videoDurationSec', 'secPerShot'])
};

/**
 * 把 LLM 给的 (field, newValue) 归一成可安全落盘的补丁：
 *  - 字段别名归一（work 的 resolution/size → imageSize、negative_prompt → negativePrompt 等）。
 *  - 白名单校验（PARAM_FIELDS）→ 不在名单返回 null。
 *  - 复用 sanitizeNodeParams 做枚举校验 / 钳值（与建图路径同一套收口）→ 被剔除也返回 null。
 * 注意：work 的 family 钳制（clampWorkForModel）需要模型 actualId，留在 applySuggestion 里做。
 */
export function normalizeParamPatch(kind: string, field: string, value: unknown): { field: string; value: unknown } | null {
  if (!isNodeKind(kind)) return null;
  let f = field.trim();
  const lower = f.toLowerCase();
  if (kind === 'work') {
    // LLM 习惯用 resolution / size 指分辨率档，统一归到 imageSize
    if (lower === 'resolution' || lower === 'size' || lower === 'imagesize') f = 'imageSize';
    else if (lower === 'negative_prompt' || lower === 'negative' || lower === 'negativeprompt') f = 'negativePrompt';
    else if (lower === 'worktype' || lower === 'type') f = 'workType';
  }
  const allowed = PARAM_FIELDS[kind];
  if (!allowed || !allowed.has(f)) return null;
  const cleaned = sanitizeNodeParams(kind, { [f]: value });
  if (!(f in cleaned)) return null;
  return { field: f, value: cleaned[f] };
}

// ───────────────────────── 可应用性标注（纯函数）─────────────────────────

/**
 * 给原始建议标注可应用性（UI 据此渲染「应用」按钮或「仅提醒」说明）：
 *  - structure：永不自动应用（只展示 reason）。
 *  - prompt-rewrite：目标必须是「非列表模式」的提示词节点，且 newValue 是非空字符串。
 *  - param：目标节点存在 + 白名单归一通过（patch 供 UI 预览「field → value」）。
 */
export function buildSuggestions(raw: RawSuggestion[], nodes: SelNodeLike[]): AgentSuggestion[] {
  const byId = new Map<string, SelNodeLike>();
  for (const n of nodes) byId.set(n.id, n);

  return raw.map((r, i) => {
    const base: AgentSuggestion = { ...r, id: `s${i + 1}`, applicable: false };
    if (r.kind === 'structure') {
      return { ...base, applyNote: '结构建议：请在画布上手动调整' };
    }
    const node = byId.get(r.nodeId);
    if (!node) {
      return { ...base, applyNote: '目标节点不存在（可能已删除）' };
    }
    const kind = node.type ?? '';
    if (r.kind === 'prompt-rewrite') {
      if (kind !== 'prompt') return { ...base, applyNote: '提示词改写只支持提示词节点' };
      if (dataOf(node).listMode) return { ...base, applyNote: '列表模式的提示词节点请手动更新对应条目' };
      if (typeof r.newValue !== 'string' || !r.newValue.trim()) return { ...base, applyNote: '模型没有给出改写文本' };
      return { ...base, applicable: true };
    }
    // param
    const patch = normalizeParamPatch(kind, r.field ?? '', r.newValue);
    if (!patch) return { ...base, applyNote: '参数不在白名单内或取值非法', patch: null };
    return { ...base, applicable: true, patch };
  });
}

// ───────────────────────── 应用（半纯：store 动作依赖注入）─────────────────────────

/** applySuggestion 的运行上下文：节点快照 + 现有 store 动作（依赖注入，lib 不 import store、测试传 stub）。 */
export interface ApplyContext {
  nodes: SelNodeLike[];
  /** 现有 store 动作 updateNodeData 的包装（不新增 store action） */
  updateNodeData: (id: string, patch: Record<string, unknown>) => void;
  /** 绘画模型清单（work 参数按 family 钳制用；省略 = 不做 family 钳制） */
  imageModels?: Array<{ name: string; actualId: string }>;
}

/**
 * 应用一条建议到节点（全部走注入的现有 store 动作）：
 *  - prompt-rewrite → updateNodeData(nodeId, { text })（仅非列表模式提示词节点）。
 *  - param → normalizeParamPatch 白名单归一；work 再过 clampWorkForModel（按节点当前模型的 family 钳制，
 *    比例/档位越界自动校正、不支持 quality 直接拒绝——与建图路径同一套收口）。
 *  - structure → 不可应用（只展示）。
 * 应用时重新校验（不信任 buildSuggestions 时刻的快照）：节点可能在弹层打开期间被删 / 改模式。
 */
export function applySuggestion(s: AgentSuggestion, ctx: ApplyContext): { ok: boolean; reason?: string } {
  if (s.kind === 'structure') return { ok: false, reason: '结构建议需要手动调整' };
  const node = ctx.nodes.find((n) => n.id === s.nodeId);
  if (!node) return { ok: false, reason: '目标节点不存在（可能已删除）' };
  const kind = node.type ?? '';

  if (s.kind === 'prompt-rewrite') {
    if (kind !== 'prompt') return { ok: false, reason: '提示词改写只支持提示词节点' };
    if (dataOf(node).listMode) return { ok: false, reason: '列表模式的提示词节点请手动更新对应条目' };
    const text = typeof s.newValue === 'string' ? s.newValue.trim() : '';
    if (!text) return { ok: false, reason: '模型没有给出改写文本' };
    ctx.updateNodeData(node.id, { text });
    return { ok: true };
  }

  // param
  const patch = normalizeParamPatch(kind, s.field ?? '', s.newValue);
  if (!patch) return { ok: false, reason: '参数不在白名单内或取值非法' };
  let obj: Record<string, unknown> = { [patch.field]: patch.value };
  if (kind === 'work') {
    const modelName = typeof dataOf(node).modelId === 'string' ? (dataOf(node).modelId as string) : '';
    const actualId = ctx.imageModels?.find((m) => m.name === modelName)?.actualId ?? '';
    obj = clampWorkForModel(obj, actualId);
    if (!(patch.field in obj)) return { ok: false, reason: '当前绘画模型不支持该参数，已拒绝应用' };
  }
  ctx.updateNodeData(node.id, obj);
  return { ok: true };
}

// ───────────────────────── 诊断（impure：调 LLM）─────────────────────────

/** 诊断型系统提示词：审查一段节点流程 → 输出建议 JSON 数组。 */
export function buildOptimizeSystemPrompt(): string {
  return [
    '你是「梦笔智能画布」的 AI 绘画工作流专家。用户会给你一段现有节点流程的紧凑 JSON 快照：',
    'nodes = 选中节点及其关键参数（长文本已截断）；每个节点的 upstream / downstream 是其上下游邻居的节点类型（含选区外）；edges = 选区内部连线。',
    '请审查这段流程，找出可以改进的地方，输出优化建议。',
    '',
    '# 输出格式（只输出 JSON 数组，不要任何解释、不要 markdown 围栏）',
    '[{ "nodeId": "节点id", "title": "一句话建议", "kind": "prompt-rewrite | param | structure", "field": "参数名（仅 param）", "newValue": "新值", "reason": "为什么这样改" }]',
    '',
    '# 三类建议',
    '1. prompt-rewrite：提示词改进。仅针对 kind=prompt 的节点；newValue 必须是改写后的【完整】提示词（不是修改说明）。改写要保留原意，补齐 主体/风格/光线/构图/画质 等要素。',
    '2. param：参数建议。field 只能取下列白名单（按节点类型）：',
    '   - work（生图）：aspect（比例，如 16:9）/ imageSize（分辨率档 1K/2K/4K，也可写 resolution）/ quality / n（张数 1-4）/ negativePrompt / strength / workType',
    '   - video（视频）：mode / duration / aspect / resolution',
    '   - llm：op / instruction；ratio（尺寸）：aspect / tier / emit；scale（缩放）：mode / factor / edge / fitW / fitH / keepAspect / noUpscale / format；storyboard：videoDurationSec / secPerShot',
    '3. structure：结构提醒。只写 reason 建议文字（例：「生图节点没接结果节点」「没有负向提示词，建议补一条」），系统不会自动改；nodeId 填相关节点 id，没有就填 ""。',
    '',
    '# 规则',
    '1. 只提有价值的建议，最多 8 条；流程已经很好就输出 []。',
    '2. nodeId 必须取自快照里的节点 id；param 的 field 必须在白名单内，否则会被系统丢弃。',
    '3. 不要建议修改 modelId / seed / provider（由系统管理）。',
    '4. title / reason 用中文；提示词改写正文的语言跟随原提示词。'
  ].join('\n');
}

export interface OptimizeSelectionInput {
  planId: number;
  /** 诊断用的文本模型显示名 */
  textModel: string;
  nodes: SelNodeLike[];
  edges: SelEdgeLike[];
  selectedIds: string[];
}

export interface OptimizeSelectionResult {
  ok: boolean;
  suggestions: AgentSuggestion[];
  warnings: string[];
  reason?: string;
}

/**
 * 选区诊断主流程：压快照 → 调文本模型（复用 api:chat:optimize-prompt，免费的「一发一收」）→
 * 解析建议（失败按 agentPlanner 惯例做一次「只输出 JSON」严格重试）→ 标注可应用性。
 */
export async function optimizeSelection(input: OptimizeSelectionInput): Promise<OptimizeSelectionResult> {
  const ctx = collectSelectionContext(input.nodes, input.edges, input.selectedIds);
  if (!ctx.nodes.length) return { ok: false, suggestions: [], warnings: [], reason: '没有可分析的选中节点' };

  const sys = buildOptimizeSystemPrompt();
  const user = `请审查这段智能画布节点流程，给出优化建议：\n${JSON.stringify(ctx)}`;

  try {
    const a = await callAgentTextModel(input.planId, input.textModel, user, sys);
    if (!a.ok) return { ok: false, suggestions: [], warnings: [], reason: a.reason };

    let parsed = parseSuggestions(a.text ?? '');
    if (!parsed.ok) {
      const b = await callAgentTextModel(
        input.planId,
        input.textModel,
        `${user}\n\n（上次输出无法解析为 JSON）请严格只输出符合规范的 JSON 数组，不要任何解释、不要 markdown 围栏。`,
        sys
      );
      if (!b.ok) return { ok: false, suggestions: [], warnings: [], reason: b.reason };
      parsed = parseSuggestions(b.text ?? '');
    }
    if (!parsed.ok) return { ok: false, suggestions: [], warnings: parsed.warnings, reason: parsed.reason ?? '无法解析优化建议' };

    return { ok: true, suggestions: buildSuggestions(parsed.items, input.nodes), warnings: parsed.warnings };
  } catch (e) {
    // IPC 基础设施层异常（正常业务错误走 Result，不会 throw）
    return { ok: false, suggestions: [], warnings: [], reason: e instanceof Error ? e.message : String(e) };
  }
}
