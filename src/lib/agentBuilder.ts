/**
 * 智能体建图层（impure，操作 store）：把规范蓝图确定性地搭成节点图。
 * 确定性收口（不盲信 LLM）：参数白名单收口（sanitizeNodeParams）+ family 校正（clampWorkForModel）、
 * modelId/seed/provider 系统注入、连线前自校验（canConnectKinds，因 store.onConnect 本身不校验）+ 去重 + 防环、
 * ComfyUI 模板匹配 + 控件值映射、三路接图（含「复用画布已选中的图片节点、不复制」）、自动补结果节点。
 * 布局：以画布中心为锚分层排布，不触碰已有节点（不再「适应全部」打乱用户布局）。运行交给调用方（runAllNodes）。
 */
import type { SmartNodeKind, SmartNodeData } from '@shared/smartCanvas';
import { useSmartCanvasStore, getSmartViewCenter } from '@/store/smartCanvasStore';
import { useSettingsStore } from '@/store/settingsStore';
import { listMappedModels, type MappedModel } from '@/lib/modelMapping';
import { canConnectKinds, IMAGE_SOURCES } from '@/lib/canvasConnectRules';
import { CATALOG } from '@/lib/agentCatalog';
import {
  sanitizeNodeParams,
  clampWorkForModel,
  pickModelName,
  layoutBlueprint,
  matchComfyTemplate,
  resolveComfyControls,
  type AgentBlueprint,
  type AgentImageSource,
  type AgentComfyTemplate,
  type XY
} from '@/lib/agentBlueprint';

/** 三路图片来源（对话框上传 / 画布已选中 / 资产库选取）+ 已选中图片节点的真实 id（复用不复制）+ 可用 ComfyUI 模板。 */
export interface AgentBuildSources {
  attached: string[];
  /** 已选中图片节点的 src（与 selectedNodeIds 一一对应，顺序一致） */
  selected: string[];
  /** 已选中图片节点的真实节点 id（source='selected' 时复用这些现成节点，不再复制一份） */
  selectedNodeIds: string[];
  gallery: string[];
  comfyTemplates: AgentComfyTemplate[];
}

export interface AgentBuildOptions {
  imageModelOverride?: string;
  textModelOverride?: string;
  videoModelOverride?: string;
  /** 测试 / 干跑：work 节点用 mock 后端，不烧 API */
  forceMock?: boolean;
}

export interface AgentBuildResult {
  createdIds: string[];
  /** 首个可运行节点（生图/视频/ComfyUI）的真实 id，用于选中 */
  firstRunId?: string;
  warnings: string[];
}

/** 会消费图片作主要输入的节点（用于 LLM 漏写 imageBindings 时的兜底接图）。 */
const IMAGE_WANTERS = new Set<SmartNodeKind>([
  'work',
  'compare',
  'image-reverse',
  'angle-prompt',
  'light',
  'palette',
  'ratio',
  'scale'
]);
const RUN_KINDS = new Set<SmartNodeKind>(['work', 'video', 'comfy']);
const IMG_COL = 300;

function dedup(arr: string[]): string[] {
  return [...new Set(arr.filter(Boolean))];
}

/**
 * 确定性地把蓝图搭成节点图。返回创建的真实 id、首个可运行节点、累积 warnings。
 * 不在此运行任何节点（付费步骤由调用方在确认后 runAllNodes）。
 */
export function buildGraphFromSpec(
  spec: AgentBlueprint,
  sources: AgentBuildSources,
  opts: AgentBuildOptions = {}
): AgentBuildResult {
  const store = useSmartCanvasStore.getState();
  const sset = useSettingsStore.getState();
  const planId = sset.activePlanId;
  const warnings: string[] = [];

  const imageModels = listMappedModels(sset.configs, planId, 'image');
  const textModels = listMappedModels(sset.configs, planId, 'text');
  const videoModels = listMappedModels(sset.configs, planId, 'video');

  function modelFor(needs: 'image' | 'text' | 'video'): { name: string; actualId: string } {
    const listM: MappedModel[] = needs === 'image' ? imageModels : needs === 'text' ? textModels : videoModels;
    const override = needs === 'image' ? opts.imageModelOverride : needs === 'text' ? opts.textModelOverride : opts.videoModelOverride;
    const name = pickModelName(listM, override);
    const actualId = listM.find((m) => m.name === name)?.actualId ?? '';
    return { name, actualId };
  }

  // 本地 id → 类型（连线校验用） + 布局坐标（以画布中心为锚）
  const kindOf = new Map<string, SmartNodeKind>();
  spec.nodes.forEach((n) => kindOf.set(n.id, n.kind));
  const layout = layoutBlueprint(spec.nodes, spec.edges, getSmartViewCenter());

  // ── 1. 建节点 + 参数收口 ──
  const idMap = new Map<string, string>();
  const createdIds: string[] = [];
  for (const n of spec.nodes) {
    const realId = store.addNode(n.kind, layout.get(n.id));
    idMap.set(n.id, realId);
    createdIds.push(realId);

    // ComfyUI：匹配模板 + 映射控件值（特殊处理，不走通用参数收口）
    if (n.kind === 'comfy') {
      const params = sanitizeNodeParams('comfy', n.params);
      const tpl = matchComfyTemplate(sources.comfyTemplates, params.template as string | undefined);
      if (tpl) {
        const controlValues = resolveComfyControls(tpl.controls, params.controls as Record<string, unknown> | undefined);
        store.updateNodeData(realId, {
          workflowId: tpl.workflowId,
          templateName: tpl.name,
          controls: tpl.controls,
          controlValues
        } as Partial<SmartNodeData>);
      } else {
        warnings.push(
          sources.comfyTemplates.length
            ? `ComfyUI 节点没匹配到模板「${String(params.template ?? '')}」，请在节点上手动选模板`
            : 'ComfyUI 节点需要先在「工作流」页配置模板，再手动选'
        );
      }
      continue;
    }

    let params = sanitizeNodeParams(n.kind, n.params);
    const ns = CATALOG[n.kind];
    if (ns.needsModel) {
      const { name, actualId } = modelFor(ns.needsModel);
      params.modelId = name;
      if (!name) warnings.push(`${ns.label} 节点没有可用的${ns.needsModel === 'image' ? '绘画' : ns.needsModel === 'text' ? '文本' : '视频'}模型，请到设置页配置`);
      if (n.kind === 'work') params = clampWorkForModel(params, actualId);
    }
    if (n.kind === 'work') {
      params.provider = opts.forceMock ? 'mock' : 'mengbi';
      params.seed = null;
    }
    if (n.kind === 'video') params.seed = null;
    store.updateNodeData(realId, params as Partial<SmartNodeData>);
  }

  // ── 2. 连线（自校验 + 去重 + 防环）──
  const adj = new Map<string, Set<string>>(); // realId → 下游 realId 集
  function canReach(start: string, target: string): boolean {
    const stack = [start];
    const seen = new Set<string>();
    while (stack.length) {
      const c = stack.pop();
      if (c === undefined) break;
      if (c === target) return true;
      if (seen.has(c)) continue;
      seen.add(c);
      for (const nx of adj.get(c) ?? []) stack.push(nx);
    }
    return false;
  }
  function addAgentEdge(su: string, tv: string, fromHandle?: string, toHandle?: string): boolean {
    if (su === tv) return false;
    if (adj.get(su)?.has(tv)) return false; // 去重
    if (canReach(tv, su)) return false; // 防环
    store.onConnect({ source: su, target: tv, sourceHandle: fromHandle ?? 'out', targetHandle: toHandle ?? 'in' });
    if (!adj.has(su)) adj.set(su, new Set());
    adj.get(su)?.add(tv);
    return true;
  }

  /** 记录哪些目标（realId）已经有图片来源上游（绑定接图 / 蓝图连线接了图片源）。 */
  const hasImageUpstream = new Set<string>();

  for (const e of spec.edges) {
    const sk = kindOf.get(e.from);
    const tk = kindOf.get(e.to);
    if (!sk || !tk) continue;
    if (!canConnectKinds(sk, tk)) {
      warnings.push(`连线被跳过：${CATALOG[sk].label} → ${CATALOG[tk].label}（不允许的连接）`);
      continue;
    }
    const su = idMap.get(e.from);
    const tv = idMap.get(e.to);
    if (!su || !tv) continue;
    if (addAgentEdge(su, tv, e.fromHandle, e.toHandle) && IMAGE_SOURCES.has(sk)) hasImageUpstream.add(tv);
  }

  // ── 3. 三路接图 ──
  function poolOf(source: AgentImageSource): string[] {
    return source === 'attached' ? sources.attached : source === 'selected' ? sources.selected : sources.gallery;
  }
  /** 复用画布上已有的图片节点（不复制）：把这些现成节点连到目标。 */
  function connectExistingNodes(targetReal: string, targetKind: SmartNodeKind, nodeIds: string[]): void {
    if (targetKind === 'image') return; // 图片节点不消费图片
    if (!canConnectKinds('image', targetKind)) {
      warnings.push(`${CATALOG[targetKind].label} 不能接收图片，已忽略`);
      return;
    }
    const live = store.nodes; // 仅连仍存在的节点
    for (const nid of dedup(nodeIds)) {
      if (!live.find((nn) => nn.id === nid)) continue;
      if (addAgentEdge(nid, targetReal)) hasImageUpstream.add(targetReal);
    }
  }
  /** 把一组图绑到某真实节点：image 节点直接写 src/srcs；其它消费图的节点则建 image 节点并连上（attached/gallery 才走这里）。 */
  function attachNewImages(targetReal: string, targetKind: SmartNodeKind, imgs: string[], anchor?: XY): void {
    const pics = dedup(imgs);
    if (!pics.length) return;
    if (targetKind === 'image') {
      if (pics.length === 1) store.updateNodeData(targetReal, { src: pics[0], name: '智能体素材' } as Partial<SmartNodeData>);
      else store.updateNodeData(targetReal, { listMode: true, srcs: pics, name: '智能体素材' } as Partial<SmartNodeData>);
      return;
    }
    if (!canConnectKinds('image', targetKind)) {
      warnings.push(`${CATALOG[targetKind].label} 不能接收图片，已忽略图片绑定`);
      return;
    }
    const imgPos = anchor ? { x: anchor.x - IMG_COL, y: anchor.y } : undefined;
    const imgReal = store.addNode('image', imgPos);
    createdIds.push(imgReal);
    if (pics.length === 1) store.updateNodeData(imgReal, { src: pics[0], name: '智能体素材' } as Partial<SmartNodeData>);
    else store.updateNodeData(imgReal, { listMode: true, srcs: pics, name: '智能体素材' } as Partial<SmartNodeData>);
    addAgentEdge(imgReal, targetReal);
    hasImageUpstream.add(targetReal);
  }

  for (const b of spec.imageBindings) {
    const targetReal = idMap.get(b.node);
    const targetKind = kindOf.get(b.node);
    if (!targetReal || !targetKind) continue;
    if (b.source === 'selected') {
      // 复用画布已选中的现成图片节点（不复制）
      const ids = b.indexes && b.indexes.length ? b.indexes.map((i) => sources.selectedNodeIds[i]).filter(Boolean) : sources.selectedNodeIds;
      if (!ids.length) {
        warnings.push('图片绑定来源「画布选中」没有可用图片，已跳过');
        continue;
      }
      connectExistingNodes(targetReal, targetKind, ids);
      continue;
    }
    const pool = poolOf(b.source);
    const picked = b.indexes && b.indexes.length ? b.indexes.map((i) => pool[i]).filter(Boolean) : pool;
    if (!picked.length) {
      warnings.push(`图片绑定来源「${b.source}」没有可用图片，已跳过`);
      continue;
    }
    attachNewImages(targetReal, targetKind, picked, layout.get(b.node));
  }

  // 兜底：有可用图但 LLM 没写任何 imageBindings → 把图接给第一个「需要图、且还没有图上游」的节点
  const totalNewPool = dedup([...sources.attached, ...sources.gallery]);
  if ((totalNewPool.length || sources.selectedNodeIds.length) && !spec.imageBindings.length) {
    for (const n of spec.nodes) {
      const real = idMap.get(n.id);
      if (!real || !IMAGE_WANTERS.has(n.kind) || hasImageUpstream.has(real)) continue;
      // 纯文生图（work + image-generation）不需要参考图，跳过
      if (n.kind === 'work') {
        const wt = (n.params as Record<string, unknown>).workType;
        if (!wt || wt === 'image-generation') continue;
      }
      if (sources.selectedNodeIds.length) connectExistingNodes(real, n.kind, sources.selectedNodeIds);
      else attachNewImages(real, n.kind, totalNewPool, layout.get(n.id));
      warnings.push('LLM 未指定图片绑定，已自动把图接到第一个需要图片的节点');
      break;
    }
  }

  // ── 4. 补结果节点（生图/ComfyUI/视频 下游若无结果节点；ensureResultNode 自带去重 + 自定位，不打乱布局）──
  for (const n of spec.nodes) {
    if (!RUN_KINDS.has(n.kind)) continue;
    const real = idMap.get(n.id);
    if (real) store.ensureResultNode(real);
  }

  // ── 5. 选中首个可运行节点（不做全局排布、不 fitView，保留用户当前视图）──
  let firstRunId: string | undefined;
  for (const n of spec.nodes) {
    if (RUN_KINDS.has(n.kind)) {
      firstRunId = idMap.get(n.id);
      break;
    }
  }
  if (firstRunId) store.selectOnly(firstRunId);

  return { createdIds, firstRunId, warnings };
}
