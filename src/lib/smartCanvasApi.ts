/**
 * 智能画布 canvasApi / storage：画布序列化 + 手动保存（导出 .json）/ 打开（导入 .json）。
 * 自动保存由「文档库」负责：每个文档的内容存 localStorage `mengbi.smartCanvas.doc.<id>`，
 * 元数据存 `mengbi.smartCanvas.docs.v1`（见 store/smartDocsStore.ts + lib/smartDocStorage.ts）。
 * 运行逻辑见 smartCanvasRunner.ts。
 */
import type { Node, Edge, Viewport } from '@xyflow/react';
import type { SmartCanvasDoc, SmartNodeKind, SmartNodeData } from '@shared/smartCanvas';
import { useSmartCanvasStore } from '@/store/smartCanvasStore';

export function serialize(nodes: Node[], edges: Edge[], viewport: Viewport): SmartCanvasDoc {
  return {
    id: 'smartcanvas',
    title: '智能画布',
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.type as SmartNodeKind,
      position: n.position,
      width: typeof n.width === 'number' ? n.width : undefined,
      height: typeof n.height === 'number' ? n.height : undefined,
      ...(n.parentId ? { parentId: n.parentId } : {}),
      data: n.data as unknown as SmartNodeData
    })),
    connections: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      // 非默认输出口随文档保留（当前节点均为单输出口 out；历史 out-trans 由 sanitize 迁回 out）
      ...(e.sourceHandle && e.sourceHandle !== 'out' ? { sourceHandle: e.sourceHandle } : {})
    })),
    viewport: { x: viewport.x, y: viewport.y, scale: viewport.zoom },
    settings: {}
  };
}

export function deserialize(doc: SmartCanvasDoc): { nodes: Node[]; edges: Edge[]; viewport: Viewport } {
  // 分组节点排前面，保证 React Flow「父节点先于子节点」（分组不嵌套，故 group-first 足够）
  const ordered = [...doc.nodes].sort((a, b) => (a.type === 'group' ? -1 : 0) - (b.type === 'group' ? -1 : 0));
  return {
    nodes: ordered.map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position,
      ...(typeof n.width === 'number' ? { width: n.width } : {}),
      ...(typeof n.height === 'number' ? { height: n.height } : {}),
      ...(n.parentId ? { parentId: n.parentId } : {}),
      data: n.data as unknown as Record<string, unknown>
    })),
    edges: doc.connections.map((c) => ({
      id: c.id,
      source: c.source,
      target: c.target,
      ...(c.sourceHandle ? { sourceHandle: c.sourceHandle } : {})
    })),
    viewport: { x: doc.viewport.x, y: doc.viewport.y, zoom: doc.viewport.scale }
  };
}

export function parseDoc(text: string): SmartCanvasDoc | null {
  try {
    const j = JSON.parse(text) as Partial<SmartCanvasDoc>;
    if (!Array.isArray(j.nodes) || !Array.isArray(j.connections)) return null;
    return {
      id: j.id ?? 'smartcanvas',
      title: j.title ?? '智能画布',
      nodes: j.nodes,
      connections: j.connections,
      viewport: j.viewport ?? { x: 0, y: 0, scale: 1 },
      settings: j.settings ?? {}
    };
  } catch {
    return null;
  }
}

/** 手动保存：读当前画布 → 序列化 → 触发浏览器下载 .json（Ctrl+S 与工具栏「保存」共用）。 */
export function exportCanvasToFile(): void {
  const st = useSmartCanvasStore.getState();
  const doc = serialize(st.nodes, st.edges, st.viewport);
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `smart-canvas-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** 打开：解析文本 → 载入 store。返回是否成功。 */
export function importCanvasFromText(text: string): { ok: boolean; nodeCount: number } {
  const doc = parseDoc(text);
  if (!doc) return { ok: false, nodeCount: 0 };
  const { nodes, edges, viewport } = deserialize(doc);
  useSmartCanvasStore.getState().load(nodes, edges, viewport);
  return { ok: true, nodeCount: nodes.length };
}
