import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  ControlButton,
  MiniMap,
  MarkerType,
  SelectionMode,
  ViewportPortal,
  useReactFlow,
  type Node,
  type Edge,
  type Connection,
  type NodeTypes,
  type EdgeTypes,
  type FinalConnectionState
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  useSmartCanvasStore,
  useSmartCanvasUiStore,
  useSmartKeybindStore,
  comboFromEvent,
  absPosition,
  registerViewCenterProvider,
  getSmartViewCenter,
  hasNodeClipboard
} from '@/store/smartCanvasStore';
import { useSmartViewStore } from '@/store/smartViewStore';
import { exportCanvasToFile } from '@/lib/smartCanvasApi';
import { toast } from '@/store/toastStore';
import { confirmDialog } from '@/components/ConfirmDialog';
import { openContextMenu, type ContextMenuEntry } from '@/components/ContextMenu';
import type { SmartNodeKind } from '@shared/smartCanvas';
import { ImageNode } from './nodes/ImageNode';
import { PromptNode } from './nodes/PromptNode';
import { WorkNode } from './nodes/WorkNode';
import { ResultNode } from './nodes/ResultNode';
import { GroupNode } from './nodes/GroupNode';
import { LlmNode } from './nodes/LlmNode';
import { ComfyNode } from './nodes/ComfyNode';
import { AnglePromptNode } from './nodes/AnglePromptNode';
import { ScaleNode } from './nodes/ScaleNode';
import { RatioNode } from './nodes/RatioNode';
import { DeletableEdge } from './DeletableEdge';
import { CreateMenu } from './CreateMenu';
import { ArrangePanel } from './ArrangePanel';
import { ViewPrefsPanel } from './ViewPrefsPanel';
import { KeybindingsDialog } from './KeybindingsDialog';
import { NodeSearch, nodeSearchText } from './NodeSearch';
import { LayoutIcon, SlidersIcon, KeyboardIcon } from './icons';

// 模块级稳定引用，否则 React Flow 每次渲染都重建节点/连线类型
const nodeTypes: NodeTypes = {
  image: ImageNode,
  prompt: PromptNode,
  work: WorkNode,
  result: ResultNode,
  group: GroupNode,
  llm: LlmNode,
  comfy: ComfyNode,
  'angle-prompt': AnglePromptNode,
  scale: ScaleNode,
  ratio: RatioNode
};
const edgeTypes: EdgeTypes = { deletable: DeletableEdge };
const defaultEdgeOptions = { type: 'deletable' };

// 能产出（可作连线起点）/ 能接收（可作连线终点）的节点类型。
// result/scale 也是 producer：结果（图/文）、缩放（图）可继续连到下游节点。
const PRODUCERS = new Set(['image', 'prompt', 'llm', 'work', 'comfy', 'group', 'angle-prompt', 'result', 'scale']);
const CONSUMERS = new Set(['work', 'comfy', 'result', 'llm', 'group', 'angle-prompt', 'scale', 'ratio']);
// 只吃图片来源的输入（视角/缩放/比例分析节点）：图片/分组/生成/ComfyUI/结果/缩放 产出的图
const IMAGE_SOURCES = new Set(['image', 'group', 'work', 'comfy', 'result', 'scale']);
// 只吃图片来源做输入的节点（视角 / 缩放 / 比例分析）
const IMAGE_INPUT_ONLY = new Set(['angle-prompt', 'scale', 'ratio']);
// 能连进结果节点的来源：生成/ComfyUI/LLM 写运行结果；图片/提示词/分组/缩放/视角=组合「实时预览」
// （分组连结果 → 预览组内多段提示词/图片如何组合）。result→result 由同类型校验挡掉。
const RESULT_SOURCES = new Set(['work', 'comfy', 'llm', 'group', 'prompt', 'image', 'scale', 'angle-prompt']);

/** 纯类型级连线校验（不依赖具体节点存在；插入连线时新节点尚未建，需用类型判断）。 */
function canConnectKinds(sk: string | undefined, tk: string | undefined): boolean {
  if (!sk || !tk) return false;
  if (!PRODUCERS.has(sk) || !CONSUMERS.has(tk)) return false;
  if (tk === 'result' && !RESULT_SOURCES.has(sk)) return false;
  if (IMAGE_INPUT_ONLY.has(tk) && !IMAGE_SOURCES.has(sk)) return false;
  return true;
}

/** 非法连线的具体原因（落在节点上但被 isValidConnection 拒绝时给用户解释）。 */
function invalidReason(sk: string | undefined, tk: string | undefined): string {
  if (sk && tk && sk === tk) return '不能连到自己';
  if (sk && !PRODUCERS.has(sk)) return '该节点不能作为输出来源';
  if (tk && !CONSUMERS.has(tk)) return '图片 / 提示词只能作为输入来源，不能接收输入';
  if (tk === 'result' && sk && !RESULT_SOURCES.has(sk)) return '结果节点只接 生成 / ComfyUI / LLM 的输出';
  if (tk && IMAGE_INPUT_ONLY.has(tk) && sk && !IMAGE_SOURCES.has(sk)) return '该节点的输入只接图片来源（图片 / 分组 / 生成 / ComfyUI / 结果 / 缩放）';
  return '这两个节点之间不允许连接';
}

/** 按上游节点运行状态给连线着色（statusColorEdges 开时用；颜色取主题 token）。 */
function statusStroke(status: string | undefined): string {
  if (status === 'running') return 'var(--mb-accent)';
  if (status === 'success') return 'var(--mb-success, #3fb950)';
  if (status === 'error') return 'var(--mb-danger, #f85149)';
  return 'var(--mb-text-muted)';
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** 顶层节点的世界坐标盒（对齐参考线用；忽略分组子节点的相对坐标）。 */
function topLevelBox(n: Node): Box {
  const w = n.measured?.width ?? (typeof n.width === 'number' ? n.width : 220);
  const h = n.measured?.height ?? (typeof n.height === 'number' ? n.height : 120);
  return { x: n.position.x, y: n.position.y, w, h };
}
const ALIGN_TH = 6; // 对齐吸附判定阈值（世界坐标 px）

/** 焦点是否在输入控件里（在输入框里时不抢 Ctrl+A / Escape / Backspace 等快捷键）。 */
function inEditable(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

function clientXY(event: MouseEvent | TouchEvent): { x: number; y: number } {
  if ('changedTouches' in event && event.changedTouches.length) {
    return { x: event.changedTouches[0].clientX, y: event.changedTouches[0].clientY };
  }
  const m = event as MouseEvent;
  return { x: m.clientX, y: m.clientY };
}

/**
 * React Flow 容器：无限平移 + 滚轮缩放(0.2–3) + 拖拽/多选/连线(可删)/尺寸调整 + 分组容器化。
 * 创建：工具栏点一下「武装」类型 → 点画布落位；从节点拖出或双击画布 → 快捷创建菜单。
 */
export function CanvasViewport(): JSX.Element {
  const nodes = useSmartCanvasStore((s) => s.nodes);
  const rawEdges = useSmartCanvasStore((s) => s.edges);
  const viewport = useSmartCanvasStore((s) => s.viewport);
  const onNodesChange = useSmartCanvasStore((s) => s.onNodesChange);
  const onEdgesChange = useSmartCanvasStore((s) => s.onEdgesChange);
  const onConnect = useSmartCanvasStore((s) => s.onConnect);
  const addNode = useSmartCanvasStore((s) => s.addNode);
  const setViewport = useSmartCanvasStore((s) => s.setViewport);
  const selectAll = useSmartCanvasStore((s) => s.selectAll);
  const deselectAll = useSmartCanvasStore((s) => s.deselectAll);
  const setNodeParent = useSmartCanvasStore((s) => s.setNodeParent);
  const arrangeGrid = useSmartCanvasStore((s) => s.arrangeGrid);
  const arrangeByType = useSmartCanvasStore((s) => s.arrangeByType);
  const reset = useSmartCanvasStore((s) => s.reset);
  const pendingKind = useSmartCanvasUiStore((s) => s.pendingKind);
  const showArrows = useSmartViewStore((s) => s.showArrows);
  const statusColorEdges = useSmartViewStore((s) => s.statusColorEdges);
  const snapToGrid = useSmartViewStore((s) => s.snapToGrid);
  const snapSize = useSmartViewStore((s) => s.snapSize);
  const alignGuides = useSmartViewStore((s) => s.alignGuides);
  const dimFilter = useSmartCanvasUiStore((s) => s.dimFilter);
  const { screenToFlowPosition, fitView } = useReactFlow();
  const [arrangeOpen, setArrangeOpen] = useState(false);
  const [viewPrefsOpen, setViewPrefsOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  // 拖动时的对齐参考线（世界坐标；undefined = 不显示）
  const [guides, setGuides] = useState<{ x?: number; y?: number }>({});
  // 连线结束（落空白）会合成一次 pane click，会误关刚弹出的菜单；用时间戳挡掉
  const lastConnectEndRef = useRef(0);

  // 连线渲染：可删除型 + 按偏好加箭头 / 状态着色（不改存储里的数据；节点数有限，随 nodes 重算可接受）
  const edges = useMemo(() => {
    const statusMap: Record<string, string> = {};
    for (const n of nodes) {
      const st = (n.data as { status?: string }).status;
      if (st) statusMap[n.id] = st;
    }
    return rawEdges.map((e) => {
      const out: Edge = e.type === 'deletable' ? { ...e } : { ...e, type: 'deletable' };
      // 仅给「源节点有运行状态」的连线着色（生成/ComfyUI/LLM）；图片/提示词等连线保留流动色
      const stroke = statusColorEdges && statusMap[e.source] ? statusStroke(statusMap[e.source]) : undefined;
      if (stroke) out.style = { ...(e.style ?? {}), stroke };
      if (showArrows) {
        out.markerEnd = { type: MarkerType.ArrowClosed, width: 16, height: 16, ...(stroke ? { color: stroke } : {}) };
      }
      return out;
    });
  }, [rawEdges, nodes, showArrows, statusColorEdges]);

  // 画布筛选：搜索关键词非空时，不匹配的节点变暗（加 mb-sc-dim class）
  const displayNodes = useMemo(() => {
    const q = dimFilter.trim().toLowerCase();
    if (!q) return nodes;
    return nodes.map((n) => {
      const cls = nodeSearchText(n).includes(q) ? undefined : 'mb-sc-dim';
      return n.className === cls ? n : { ...n, className: cls };
    });
  }, [nodes, dimFilter]);

  // 拖动中：计算对齐参考线（与其它顶层节点的 左/中/右 · 上/中/下 对齐）
  const onNodeDrag = useCallback(
    (_e: unknown, node: Node) => {
      if (!alignGuides || node.parentId) return;
      const drag = topLevelBox(node);
      const dXs = [drag.x, drag.x + drag.w / 2, drag.x + drag.w];
      const dYs = [drag.y, drag.y + drag.h / 2, drag.y + drag.h];
      let gx: number | undefined;
      let gy: number | undefined;
      let bestX = ALIGN_TH;
      let bestY = ALIGN_TH;
      for (const o of useSmartCanvasStore.getState().nodes) {
        if (o.id === node.id || o.parentId) continue; // 只与顶层节点对齐
        const b = topLevelBox(o);
        for (const dx of dXs) for (const ox of [b.x, b.x + b.w / 2, b.x + b.w]) {
          const diff = Math.abs(dx - ox);
          if (diff < bestX) { bestX = diff; gx = ox; }
        }
        for (const dy of dYs) for (const oy of [b.y, b.y + b.h / 2, b.y + b.h]) {
          const diff = Math.abs(dy - oy);
          if (diff < bestY) { bestY = diff; gy = oy; }
        }
      }
      setGuides((prev) => (prev.x === gx && prev.y === gy ? prev : { x: gx, y: gy }));
    },
    [alignGuides]
  );

  // 分组容器化：拖动结束时，若节点中心落在某分组框内 → 归入该分组；否则移出。
  const onNodeDragStop = useCallback(
    (_e: unknown, node: Node) => {
      setGuides({});
      if (node.type === 'group') return;
      const st = useSmartCanvasStore.getState();
      const cur = st.nodes.find((n) => n.id === node.id);
      if (!cur) return;
      const dim = (n: Node, dw: number, dh: number): { w: number; h: number } => ({
        w: n.measured?.width ?? (typeof n.width === 'number' ? n.width : dw),
        h: n.measured?.height ?? (typeof n.height === 'number' ? n.height : dh)
      });
      const abs = absPosition(cur, st.nodes);
      const { w, h } = dim(cur, 220, 120);
      const cx = abs.x + w / 2;
      const cy = abs.y + h / 2;
      let target: string | null = null;
      for (const g of st.nodes) {
        if (g.type !== 'group' || g.id === node.id) continue;
        const ga = absPosition(g, st.nodes);
        const gs = dim(g, 360, 280);
        if (cx >= ga.x && cx <= ga.x + gs.w && cy >= ga.y && cy <= ga.y + gs.h) {
          target = g.id;
          break;
        }
      }
      if ((cur.parentId ?? null) !== target) setNodeParent(node.id, target);
    },
    [setNodeParent]
  );

  // 连线校验（四边 loose 连接也靠它约束语义）：源须能产出、目标须能接收；
  // 图片/提示词不能作目标；结果不能作源；结果只接 工作/ComfyUI；禁止自连。
  const isValidConnection = useCallback((c: Connection | Edge): boolean => {
    if (!c.source || !c.target || c.source === c.target) return false;
    const st = useSmartCanvasStore.getState();
    const sk = st.nodes.find((n) => n.id === c.source)?.type;
    const tk = st.nodes.find((n) => n.id === c.target)?.type;
    return canConnectKinds(sk, tk);
  }, []);

  // 「武装」某类型后点连线 → 把新节点插入该连线（上游→新节点→下游）；类型不兼容则直接落在点击处
  const onEdgeClick = useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      const ui = useSmartCanvasUiStore.getState();
      if (!ui.pendingKind) return; // 没武装类型时点连线 = 正常选中（交给 React Flow）
      event.stopPropagation();
      const kind = ui.pendingKind;
      const st = useSmartCanvasStore.getState();
      const sk = st.nodes.find((n) => n.id === edge.source)?.type;
      const tk = st.nodes.find((n) => n.id === edge.target)?.type;
      const p = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      if (canConnectKinds(sk, kind) && canConnectKinds(kind, tk)) {
        st.insertNodeOnEdge(kind, p, edge.id);
        toast.success('已在连线中插入节点', '上游 → 新节点 → 下游');
      } else {
        addNode(kind, p);
        toast.info('已创建节点', '该类型无法插入此连线，已直接放在点击处');
      }
      ui.setPendingKind(null);
    },
    [screenToFlowPosition, addNode]
  );

  // 按住 Alt 拖动节点 = 复制：拖动开始即在原位克隆一份（原节点被拖走、副本留在原处）
  const onNodeDragStart = useCallback((event: React.MouseEvent, node: Node) => {
    if (event.altKey) useSmartCanvasStore.getState().duplicateNodeInPlace(node.id);
  }, []);

  // 工具栏「武装」后点画布 → 在点击处落位；否则取消选择 + 关菜单。
  const onPaneClick = useCallback(
    (event: React.MouseEvent) => {
      // 刚结束连线产生的合成 click：跳过，别把刚弹的快捷菜单关掉
      if (Date.now() - lastConnectEndRef.current < 350) return;
      const ui = useSmartCanvasUiStore.getState();
      if (ui.pendingKind) {
        const p = screenToFlowPosition({ x: event.clientX, y: event.clientY });
        addNode(ui.pendingKind, p);
        ui.setPendingKind(null);
        return;
      }
      ui.closeCreateMenu();
      deselectAll();
    },
    [screenToFlowPosition, addNode, deselectAll]
  );

  // 拖入图片/文字到画布空白：多图自动成组、文字自动建提示词节点
  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const pos = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      // 0) 从结果节点拖出的内置项 → 直接落成对应节点（图→图片节点 / 文本→提示词节点）
      const scRaw = event.dataTransfer.getData('application/mengbi-sc-node');
      if (scRaw) {
        try {
          const payload = JSON.parse(scRaw) as { kind?: string; src?: string; text?: string; name?: string };
          const store = useSmartCanvasStore.getState();
          if (payload.kind === 'image' && payload.src) {
            const id = store.addNode('image', pos);
            store.updateNodeData(id, { src: payload.src, name: payload.name ?? '结果图' });
          } else if (payload.kind === 'prompt' && payload.text) {
            const id = store.addNode('prompt', pos);
            store.updateNodeData(id, { text: payload.text });
          }
        } catch {
          /* 非法载荷忽略 */
        }
        return;
      }
      const files = Array.from(event.dataTransfer.files).filter((f) => f.type.startsWith('image/'));
      if (files.length) {
        void Promise.all(
          files.map(
            (f) =>
              new Promise<{ src: string; name?: string }>((resolve) => {
                const r = new FileReader();
                r.onload = () => resolve({ src: String(r.result), name: f.name });
                r.onerror = () => resolve({ src: '', name: f.name });
                r.readAsDataURL(f);
              })
          )
        ).then((imgs) => {
          const valid = imgs.filter((x) => x.src);
          if (valid.length) useSmartCanvasStore.getState().dropImages(valid, pos);
        });
        return;
      }
      const text = event.dataTransfer.getData('text/plain');
      if (text.trim()) {
        const id = useSmartCanvasStore.getState().addNode('prompt', pos);
        useSmartCanvasStore.getState().updateNodeData(id, { text: text.trim() });
      }
    },
    [screenToFlowPosition]
  );

  // 双击空白画布 → 快捷创建菜单
  const onDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      const target = event.target as HTMLElement;
      // 落在节点/连线上不弹（在空白处才弹）
      if (target.closest('.react-flow__node') || target.closest('.react-flow__edge')) return;
      const p = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      useSmartCanvasUiStore
        .getState()
        .openCreateMenu({ screenX: event.clientX, screenY: event.clientY, flowX: p.x, flowY: p.y });
    },
    [screenToFlowPosition]
  );

  // 从「输入口/输出口」拖出、落在空白处 → 弹「建上游/建下游」快捷菜单
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
      if (connectionState.isValid) return;
      const from = connectionState.fromNode;
      if (!from) return;
      // 落在某个节点上但非法 → 解释原因，不弹「创建节点」菜单（只有落空白才弹）
      const over = connectionState.toNode;
      if (over && over.id !== from.id) {
        const down = connectionState.fromHandle?.type === 'source';
        const sk = down ? from.type : over.type;
        const tk = down ? over.type : from.type;
        toast.error('该连接不允许', invalidReason(sk, tk));
        return;
      }
      lastConnectEndRef.current = Date.now();
      // 输入口(target)拖出 → 建上游；输出口(source)拖出 → 建下游
      const dir = connectionState.fromHandle?.type === 'target' ? 'up' : 'down';
      const { x, y } = clientXY(event);
      const p = screenToFlowPosition({ x, y });
      useSmartCanvasUiStore
        .getState()
        .openCreateMenu({ screenX: x, screenY: y, flowX: p.x, flowY: p.y, anchorId: from.id, dir });
    },
    [screenToFlowPosition]
  );

  // 选中 ≥2 个顶层非分组节点时弹「群组所选」菜单 → 群组并自动网格排布。返回是否弹出。
  const openGroupMenu = useCallback((clientX: number, clientY: number): boolean => {
    const st = useSmartCanvasStore.getState();
    const groupable = st.nodes.filter((n) => n.selected && !n.parentId && n.type !== 'group');
    if (groupable.length < 2) return false;
    openContextMenu({
      x: clientX,
      y: clientY,
      items: [
        {
          label: `群组所选 (${groupable.length})`,
          onClick: () => {
            if (useSmartCanvasStore.getState().groupSelection()) toast.success('已群组并自动排布');
          }
        }
      ]
    });
    return true;
  }, []);

  // 右键多选 → 群组菜单
  const onSelectionContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      openGroupMenu(e.clientX, e.clientY);
    },
    [openGroupMenu]
  );

  // 右键单个节点：若它属于一个 ≥2 的多选 → 群组菜单；否则给单节点菜单（分组可解散 / 删除）
  const onNodeContextMenu = useCallback(
    (e: React.MouseEvent, node: Node) => {
      e.preventDefault();
      const st = useSmartCanvasStore.getState();
      const cur = st.nodes.find((n) => n.id === node.id);
      const selCount = st.nodes.filter((n) => n.selected).length;
      if (cur?.selected && selCount >= 2 && openGroupMenu(e.clientX, e.clientY)) return;
      const items: ContextMenuEntry[] = [
        {
          label: '再制节点',
          onClick: () => {
            st.selectOnly(node.id);
            st.duplicateSelection();
          }
        },
        {
          label: '复制节点',
          onClick: () => {
            st.selectOnly(node.id);
            st.copySelection();
          }
        }
      ];
      if (node.type === 'group') {
        items.push({ label: '解散分组（保留子节点）', onClick: () => st.removeNode(node.id) });
      }
      items.push({ separator: true });
      items.push({ label: '删除节点', variant: 'danger', onClick: () => st.removeNode(node.id) });
      openContextMenu({ x: e.clientX, y: e.clientY, items });
    },
    [openGroupMenu]
  );

  useEffect(() => {
    function doAction(action: string): void {
      if (action.startsWith('add-')) {
        useSmartCanvasUiStore.getState().setPendingKind(action.slice(4) as SmartNodeKind);
        return;
      }
      switch (action) {
        case 'save':
          exportCanvasToFile();
          toast.success('已导出画布 JSON');
          break;
        case 'select-all':
          selectAll();
          break;
        case 'deselect':
          deselectAll();
          break;
        case 'fit-view':
          void fitView({ duration: 300 });
          break;
        case 'arrange-grid':
          arrangeGrid(4, 48);
          break;
        case 'arrange-type':
          arrangeByType(48);
          break;
        case 'group-selection':
          if (!useSmartCanvasStore.getState().groupSelection()) toast.error('先选 2 个及以上的顶层节点再群组');
          break;
        case 'clear':
          void confirmDialog({ message: '清空整块画布？（可先「保存」备份）', danger: true, okText: '清空' }).then(
            (ok) => {
              if (ok) reset();
            }
          );
          break;
        case 'undo':
          useSmartCanvasStore.getState().undo();
          break;
        case 'redo':
          useSmartCanvasStore.getState().redo();
          break;
        case 'copy':
          useSmartCanvasStore.getState().copySelection();
          break;
        // 'paste' 不在此处理：Ctrl+V 放行原生 paste 事件，由 window 'paste' 监听统一处理
        // （内部节点剪贴板优先，其次系统剪贴板图片/文本），见下方 useEffect。
        case 'duplicate':
          useSmartCanvasStore.getState().duplicateSelection();
          break;
        case 'search':
          setSearchOpen((v) => !v);
          break;
      }
    }
    function onKey(e: KeyboardEvent): void {
      // Escape 优先清「待放置 / 快捷菜单」
      if (e.key === 'Escape') {
        const ui = useSmartCanvasUiStore.getState();
        if (ui.pendingKind || ui.createMenu) {
          ui.setPendingKind(null);
          ui.closeCreateMenu();
          return;
        }
      }
      // 方向键微调选中节点（输入框内不抢；Shift = 10px，否则 1px）
      if (!inEditable() && (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        if (!useSmartCanvasStore.getState().nodes.some((n) => n.selected)) return;
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        useSmartCanvasStore.getState().nudgeSelected(dx, dy);
        return;
      }
      const combo = comboFromEvent(e);
      if (!combo) return;
      const bindings = useSmartKeybindStore.getState().bindings;
      const action = Object.keys(bindings).find((a) => bindings[a] === combo);
      if (!action) return;
      if (inEditable() && action !== 'save') return; // 输入框里只放行保存
      // Ctrl+V：不 preventDefault，让浏览器照常派发 paste 事件（preventDefault keydown 会吞掉它）
      if (action === 'paste') return;
      e.preventDefault();
      doAction(action);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectAll, deselectAll, fitView, arrangeGrid, arrangeByType, reset]);

  // 视图中心提供器：让 store（addNode 默认落位 / 粘贴）和弹层能取到「当前视图正中心」flow 坐标
  useEffect(() => {
    registerViewCenterProvider(() => {
      const el = document.querySelector('.mb-sc-root .react-flow') as HTMLElement | null;
      if (el) {
        const r = el.getBoundingClientRect();
        return screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
      }
      return { x: 200, y: 160 };
    });
    return () => registerViewCenterProvider(null);
  }, [screenToFlowPosition]);

  // 系统剪贴板粘贴：在智能画布里 Ctrl+V →
  //   · 内部节点剪贴板有内容 → 内部节点粘贴（落视图中心，保留原有复制/粘贴）
  //   · 否则系统剪贴板是图片 → 建图片节点；是文本 → 建提示词节点；都落当前视图正中心
  useEffect(() => {
    function onPaste(e: ClipboardEvent): void {
      if (inEditable()) return; // 输入框/文本域里走原生粘贴，不抢
      // 内部节点剪贴板优先（与既有 Ctrl+C/Ctrl+V 行为一致）
      if (hasNodeClipboard()) {
        e.preventDefault();
        useSmartCanvasStore.getState().pasteClipboard();
        return;
      }
      const dt = e.clipboardData;
      if (!dt) return;
      // 1) 系统剪贴板里的图片（截图/复制图片）→ 图片节点
      const imgItem = Array.from(dt.items).find(
        (it) => it.kind === 'file' && it.type.startsWith('image/')
      );
      if (imgItem) {
        const file = imgItem.getAsFile();
        if (file) {
          e.preventDefault();
          const reader = new FileReader();
          reader.onload = () => {
            const center = getSmartViewCenter();
            useSmartCanvasStore
              .getState()
              .dropImages([{ src: String(reader.result), name: '粘贴图片' }], {
                x: center.x - 110,
                y: center.y - 100
              });
          };
          reader.onerror = () => toast.error('粘贴图片失败', '无法读取剪贴板里的图片');
          reader.readAsDataURL(file);
          return;
        }
      }
      // 2) 纯文本 → 提示词节点
      const text = dt.getData('text/plain');
      if (text && text.trim()) {
        e.preventDefault();
        const store = useSmartCanvasStore.getState();
        const id = store.addNode('prompt'); // 默认落视图中心
        store.updateNodeData(id, { text: text.trim() });
      }
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  return (
    <>
      <ReactFlow
        className={pendingKind ? 'mb-sc-armed' : undefined}
        nodes={displayNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        onEdgeClick={onEdgeClick}
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onSelectionContextMenu={onSelectionContextMenu}
        onNodeContextMenu={onNodeContextMenu}
        isValidConnection={isValidConnection}
        snapToGrid={snapToGrid}
        snapGrid={[snapSize, snapSize]}
        onPaneClick={onPaneClick}
        onDoubleClick={onDoubleClick}
        onDrop={onDrop}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }}
        defaultViewport={viewport}
        onMoveEnd={(_e, vp) => setViewport(vp)}
        deleteKeyCode={['Delete', 'Backspace']}
        selectionKeyCode={['Control', 'Meta']}
        multiSelectionKeyCode={['Shift']}
        selectionMode={SelectionMode.Partial}
        selectionOnDrag={false}
        panOnDrag
        selectNodesOnDrag={false}
        zoomOnDoubleClick={false}
        connectionRadius={40}
        nodesDraggable
        nodesConnectable
        elementsSelectable
        minZoom={0.2}
        maxZoom={3}
        proOptions={{ hideAttribution: true }}
      >
        {(guides.x != null || guides.y != null) && (
          <ViewportPortal>
            {guides.x != null && (
              <div
                className="mb-sc-guide mb-sc-guide-v"
                style={{ position: 'absolute', left: guides.x, top: -100000, height: 200000 }}
              />
            )}
            {guides.y != null && (
              <div
                className="mb-sc-guide mb-sc-guide-h"
                style={{ position: 'absolute', top: guides.y, left: -100000, width: 200000 }}
              />
            )}
          </ViewportPortal>
        )}
        <Background gap={18} />
        <Controls showInteractive={false}>
          <ControlButton onClick={() => setArrangeOpen((v) => !v)} title="排布">
            <LayoutIcon size={14} />
          </ControlButton>
          <ControlButton onClick={() => setViewPrefsOpen((v) => !v)} title="外观（连线 / 对齐）">
            <SlidersIcon size={14} />
          </ControlButton>
          <ControlButton onClick={() => setKeysOpen(true)} title="快捷键">
            <KeyboardIcon size={14} />
          </ControlButton>
        </Controls>
        <MiniMap
          pannable
          zoomable
          className="mb-sc-minimap"
          ariaLabel="画布缩略导航"
          nodeClassName={(n) => `mb-sc-mm-${n.type ?? 'node'}`}
          nodeStrokeWidth={2}
        />
      </ReactFlow>
      {arrangeOpen && <ArrangePanel onClose={() => setArrangeOpen(false)} />}
      {viewPrefsOpen && <ViewPrefsPanel onClose={() => setViewPrefsOpen(false)} />}
      {keysOpen && <KeybindingsDialog onClose={() => setKeysOpen(false)} />}
      {searchOpen && <NodeSearch onClose={() => setSearchOpen(false)} />}
      <CreateMenu />
    </>
  );
}
