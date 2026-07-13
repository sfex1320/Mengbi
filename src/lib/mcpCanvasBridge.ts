/**
 * MCP 画布桥（渲染端）：执行主进程转发来的智能体画布工具调用。
 *
 *   main --push 'mcp:tool-request' {id,tool,args}--> 这里 dispatch
 *   这里 --invoke 'api:mcp:respond' {id,result|error}--> main resolve → MCP 客户端
 *
 * 注册遵守铁律 17：App 级挂载（registerMcpBridge），绝不挂进会被路由切换
 * unmount 的页面组件。操作复用既有单一真相：节点目录 = agentCatalog、
 * 连线规则 = canvasConnectRules、运行 = smartCanvasRunner、多文档 = smartDocStorage。
 */

import type { Node, Edge, Connection } from '@xyflow/react';
import type { SmartNodeKind, SmartNodeData } from '@shared/smartCanvas';
import type { McpToolRequestPayload } from '@shared/ipc';
import { useSmartCanvasStore, useSmartResultStore } from '@/store/smartCanvasStore';
import { useSmartDocsStore } from '@/store/smartDocsStore';
import { readDocContent, saveCurrentDoc, switchDoc } from '@/lib/smartDocStorage';
import { canConnectKinds, invalidReason } from '@/lib/canvasConnectRules';
import { CATALOG, isNodeKind, consumeKinds, produceKinds } from '@/lib/agentCatalog';
import { runWithUpstream, runAllNodes } from '@/lib/smartCanvasRunner';

// ─── 小工具 ────────────────────────────────────────────────

const TEXT_CAP = 4000;

function cap(s: string, n = 160): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/** 节点 data → 智能体可读摘要（截断长文本、屏蔽 dataUri，防止回包爆炸） */
function summarizeData(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const one = (v: unknown): unknown => {
    if (typeof v === 'string') {
      if (v.startsWith('data:')) return `[dataUri ≈${Math.round(v.length / 1024)}KB]`;
      return cap(v);
    }
    if (typeof v === 'number' || typeof v === 'boolean' || v === null) return v;
    if (Array.isArray(v)) return v.slice(0, 8).map(one);
    if (typeof v === 'object') return cap(JSON.stringify(v), 200);
    return undefined;
  };
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || k === 'logs') continue;
    out[k] = one(v);
  }
  return out;
}

/** 节点文本输出（与 CanvasViewport.textOutputOf 同口径的精简版） */
function textOutputOf(n: Node): string {
  const d = n.data as Record<string, unknown>;
  switch (n.type) {
    case 'prompt':
      return String(d.text ?? '').trim();
    case 'llm':
    case 'storyboard':
    case 'character-card':
      return String(d.resultText ?? '').trim();
    case 'angle-prompt':
    case 'light':
    case 'palette':
      return String(d.generatedPrompt ?? '').trim();
    case 'proof':
      return String(d.reportText ?? '').trim();
    case 'comfy': {
      const texts = (d.result as { texts?: string[] } | undefined)?.texts ?? [];
      return texts.join('\n').trim();
    }
    case 'result': {
      const acc = useSmartResultStore.getState().accum[n.id] ?? [];
      return acc.flatMap((r) => r.texts ?? []).join('\n').trim();
    }
    default:
      return '';
  }
}

/** 节点产出图片列表（路径/dataUri），read_canvas / get_node_status 用 */
function imagesOf(n: Node): string[] {
  const d = n.data as Record<string, unknown>;
  switch (n.type) {
    case 'image':
      return typeof d.src === 'string' && d.src ? [d.src] : [];
    case 'work':
    case 'comfy':
      return (d.result as { images?: string[] } | undefined)?.images ?? [];
    case 'result': {
      const acc = useSmartResultStore.getState().accum[n.id] ?? [];
      return acc.flatMap((r) => r.images);
    }
    default:
      return [];
  }
}

// 可经 runWithUpstream 直接运行的节点类型（与 CanvasViewport.RUN_TYPES 保持一致）
const RUN_TYPES = new Set([
  'work',
  'comfy',
  'llm',
  'video',
  'storyboard',
  'character-card',
  'frame-interp',
  'video-clip',
  'image-reverse',
  'prompt-mall',
  'segment',
  'proof'
]);

function requireActiveDoc(): string {
  const id = useSmartDocsStore.getState().activeDocId;
  if (!id) {
    throw new Error('当前在画布启动页，没有打开的画布——先 create_canvas 新建或 open_canvas 打开一张');
  }
  return id;
}

function requireNode(nodeId: string): Node {
  const n = useSmartCanvasStore.getState().nodes.find((x) => x.id === nodeId);
  if (!n) throw new Error(`当前画布上没有节点 ${nodeId}（用 read_canvas 查看现有节点）`);
  return n;
}

function nodeSummary(n: Node): Record<string, unknown> {
  const status = String((n.data as Record<string, unknown>).status ?? 'idle');
  const txt = textOutputOf(n);
  const imgs = imagesOf(n);
  return {
    id: n.id,
    kind: n.type,
    label: CATALOG[n.type as SmartNodeKind]?.label ?? n.type,
    position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
    status,
    params: summarizeData(n.data as Record<string, unknown>),
    ...(txt ? { textOutput: cap(txt, 400) } : {}),
    ...(imgs.length ? { imageCount: imgs.length } : {})
  };
}

function edgeSummary(e: Edge): Record<string, unknown> {
  return {
    source: e.source,
    ...(e.sourceHandle ? { sourceHandle: e.sourceHandle } : {}),
    target: e.target,
    ...(e.targetHandle ? { targetHandle: e.targetHandle } : {})
  };
}

// ─── 工具实现 ──────────────────────────────────────────────

function toolListNodeKinds(): unknown {
  return {
    kinds: (Object.keys(CATALOG) as SmartNodeKind[]).map((kind) => {
      const spec = CATALOG[kind];
      return {
        kind,
        label: spec.label,
        tier: spec.tier,
        purpose: spec.purpose,
        ...(spec.needsModel ? { needsModel: spec.needsModel } : {}),
        params: spec.params,
        acceptsFrom: consumeKinds(kind),
        feedsInto: produceKinds(kind)
      };
    })
  };
}

function toolListCanvases(): unknown {
  const ds = useSmartDocsStore.getState();
  return {
    activeDocId: ds.activeDocId,
    canvases: ds.docs.map((d) => ({
      docId: d.id,
      title: d.title,
      nodeCount: d.nodeCount,
      updatedAt: d.updatedAt
    }))
  };
}

function toolCreateCanvas(args: Record<string, unknown>): unknown {
  const title = typeof args.title === 'string' && args.title.trim() ? args.title.trim() : undefined;
  saveCurrentDoc();
  const ds = useSmartDocsStore.getState();
  const docId = ds.createDoc(title);
  useSmartCanvasStore.getState().reset();
  ds.setActive(docId);
  return { docId, title: title ?? '未命名画布' };
}

function toolOpenCanvas(args: Record<string, unknown>): unknown {
  const docId = String(args.docId ?? '');
  const ds = useSmartDocsStore.getState();
  if (!ds.docs.some((d) => d.id === docId)) {
    throw new Error(`没有 docId 为 ${docId} 的画布（用 list_canvases 查看）`);
  }
  switchDoc(docId);
  return { docId, active: true };
}

function toolReadCanvas(args: Record<string, unknown>): unknown {
  const ds = useSmartDocsStore.getState();
  const docId = typeof args.docId === 'string' && args.docId ? args.docId : ds.activeDocId;
  if (!docId) throw new Error('没有打开的画布，也未指定 docId');
  if (docId === ds.activeDocId) {
    const st = useSmartCanvasStore.getState();
    return {
      docId,
      active: true,
      nodes: st.nodes.map(nodeSummary),
      edges: st.edges.map(edgeSummary)
    };
  }
  const content = readDocContent(docId);
  if (!content) throw new Error(`画布 ${docId} 内容不存在（用 list_canvases 查看）`);
  return {
    docId,
    active: false,
    nodes: content.nodes.map(nodeSummary),
    edges: content.edges.map(edgeSummary)
  };
}

function toolAddNode(args: Record<string, unknown>): unknown {
  requireActiveDoc();
  const kind = String(args.kind ?? '');
  if (!isNodeKind(kind)) {
    throw new Error(`未知节点类型 ${kind}（用 list_node_kinds 查看可用类型）`);
  }
  const st = useSmartCanvasStore.getState();
  let x = typeof args.x === 'number' ? args.x : NaN;
  let y = typeof args.y === 'number' ? args.y : NaN;
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    // 未指定位置：排到现有节点右侧，避免堆叠在视图中心
    const xs = st.nodes.map((n) => n.position.x);
    x = xs.length ? Math.max(...xs) + 360 : 0;
    y = 120;
  }
  const nodeId = st.addNode(kind, { x, y });
  const params = args.params;
  if (typeof params === 'object' && params !== null && !Array.isArray(params)) {
    st.updateNodeData(nodeId, params as unknown as Partial<SmartNodeData>);
  }
  return { nodeId, kind };
}

function toolSetNodeParams(args: Record<string, unknown>): unknown {
  requireActiveDoc();
  const n = requireNode(String(args.nodeId ?? ''));
  const params = args.params;
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    throw new Error('params 必须是对象');
  }
  useSmartCanvasStore.getState().updateNodeData(n.id, params as unknown as Partial<SmartNodeData>);
  return { nodeId: n.id, applied: Object.keys(params) };
}

function toolConnectNodes(args: Record<string, unknown>): unknown {
  requireActiveDoc();
  const src = requireNode(String(args.sourceId ?? ''));
  const tgt = requireNode(String(args.targetId ?? ''));
  if (!canConnectKinds(src.type, tgt.type)) {
    throw new Error(invalidReason(src.type, tgt.type) || `${src.type} 不能连向 ${tgt.type}`);
  }
  const conn: Connection = {
    source: src.id,
    target: tgt.id,
    sourceHandle: typeof args.sourceHandle === 'string' && args.sourceHandle ? args.sourceHandle : 'out',
    targetHandle: typeof args.targetHandle === 'string' && args.targetHandle ? args.targetHandle : 'in'
  };
  useSmartCanvasStore.getState().onConnect(conn);
  return { connected: `${src.id} → ${tgt.id}` };
}

function toolDeleteNode(args: Record<string, unknown>): unknown {
  requireActiveDoc();
  const n = requireNode(String(args.nodeId ?? ''));
  useSmartCanvasStore.getState().removeNode(n.id);
  return { deleted: n.id };
}

function toolRunNode(args: Record<string, unknown>): unknown {
  requireActiveDoc();
  const n = requireNode(String(args.nodeId ?? ''));
  if (!RUN_TYPES.has(n.type ?? '')) {
    throw new Error(`节点类型 ${n.type} 不可运行（可运行：${[...RUN_TYPES].join(' / ')}）`);
  }
  void runWithUpstream(n.id);
  return { started: true, nodeId: n.id, hint: '异步执行中，用 get_node_status 轮询结果' };
}

function toolRunAll(): unknown {
  requireActiveDoc();
  void runAllNodes();
  return { started: true, hint: '按拓扑序运行全部节点，用 read_canvas / get_node_status 查看进度' };
}

function toolGetNodeStatus(args: Record<string, unknown>): unknown {
  requireActiveDoc();
  const n = requireNode(String(args.nodeId ?? ''));
  const d = n.data as Record<string, unknown>;
  const txt = textOutputOf(n);
  const imgs = imagesOf(n);
  return {
    nodeId: n.id,
    kind: n.type,
    status: String(d.status ?? 'idle'),
    ...(typeof d.error === 'string' && d.error ? { error: d.error } : {}),
    ...(txt ? { resultText: cap(txt, TEXT_CAP) } : {}),
    imageCount: imgs.length,
    ...(imgs.length ? { latestImage: imgs[imgs.length - 1].startsWith('data:') ? '[dataUri]' : imgs[imgs.length - 1] } : {})
  };
}

// ─── 分发与注册 ────────────────────────────────────────────

function dispatch(tool: string, args: Record<string, unknown>): unknown {
  switch (tool) {
    case 'list_node_kinds':
      return toolListNodeKinds();
    case 'list_canvases':
      return toolListCanvases();
    case 'create_canvas':
      return toolCreateCanvas(args);
    case 'open_canvas':
      return toolOpenCanvas(args);
    case 'read_canvas':
      return toolReadCanvas(args);
    case 'add_node':
      return toolAddNode(args);
    case 'set_node_params':
      return toolSetNodeParams(args);
    case 'connect_nodes':
      return toolConnectNodes(args);
    case 'delete_node':
      return toolDeleteNode(args);
    case 'run_node':
      return toolRunNode(args);
    case 'run_all':
      return toolRunAll();
    case 'get_node_status':
      return toolGetNodeStatus(args);
    default:
      throw new Error(`渲染端未实现的工具：${tool}`);
  }
}

let registered = false;

/** App 级注册（铁律 17）：路由切换不注销，返回统一清理函数 */
export function registerMcpBridge(): () => void {
  if (registered) return () => undefined;
  registered = true;
  const off = window.electronAPI?.on('mcp:tool-request', (payload) => {
    const req = payload as McpToolRequestPayload;
    if (!req || typeof req.id !== 'string' || typeof req.tool !== 'string') return;
    let result: unknown;
    let error: string | undefined;
    try {
      result = dispatch(req.tool, req.args ?? {});
    } catch (e) {
      error = (e as Error).message || '画布操作失败';
    }
    window.electronAPI.mcp
      .respond({ id: req.id, ...(error ? { error } : { result }) })
      .catch(() => undefined);
  });
  return () => {
    registered = false;
    off?.();
  };
}
