import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
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
  useSmartPreviewStore,
  useSmartResultStore,
  useSmartTextStore,
  comboFromEvent,
  absPosition,
  registerViewCenterProvider,
  getSmartViewCenter,
  hasNodeClipboard
} from '@/store/smartCanvasStore';
import { useSmartViewStore } from '@/store/smartViewStore';
import { useThemeStore } from '@/store/themeStore';
import { exportCanvasToFile } from '@/lib/smartCanvasApi';
import { canConnectKinds, invalidReason } from '@/lib/canvasConnectRules';
import { runWithUpstream } from '@/lib/smartCanvasRunner';
import { localPathToImageUrl } from '@/lib/imageUrl';
import { toast } from '@/store/toastStore';
import { confirmDialog } from '@/components/ConfirmDialog';
import { openContextMenu, type ContextMenuEntry } from '@/components/ContextMenu';
import { buildShortcutSendMenuItems } from '@/lib/mediaActions';
import { makePromptNodeFrom, imageSaveAs, imageToGallery, openVideoPreview, copyText, copyImage } from './nodeArea';
import { useVaultExportStore, suggestedVaultTitle } from './VaultExportDialog';
import { useGalleryPickerStore } from './GalleryPickerDialog';
import { runOptimizeSelection } from './AgentSuggestions';
import { usePromptMallStudioStore } from './PromptMallStudio';
import { useSegmentStudioStore } from './SegmentStudio';
import { useProofStudioStore } from './ProofStudio';
import type {
  SmartNodeKind,
  SmartNodeData,
  ImageNodeData,
  WorkNodeData,
  ComfyNodeData,
  LlmNodeData,
  PromptNodeData,
  AnglePromptNodeData,
  LightNodeData,
  PaletteNodeData,
  SegmentNodeData,
  ProofNodeData
} from '@shared/smartCanvas';
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
import { TextNode } from './nodes/TextNode';
import { LightNode } from './nodes/LightNode';
import { PaletteNode } from './nodes/PaletteNode';
import { CompareNode } from './nodes/CompareNode';
import { VideoNode } from './nodes/VideoNode';
import { ImageReverseNode } from './nodes/ImageReverseNode';
import { VideoSourceNode } from './nodes/VideoSourceNode';
import { FrameInterpNode } from './nodes/FrameInterpNode';
import { VideoClipNode } from './nodes/VideoClipNode';
import { UpscaleNode } from './nodes/UpscaleNode';
import { VectorizeNode } from './nodes/VectorizeNode';
import { StoryboardNode } from './nodes/StoryboardNode';
import { CharacterCardNode } from './nodes/CharacterCardNode';
import { PromptMallNode } from './nodes/PromptMallNode';
import { LoopNode } from './nodes/LoopNode';
import { FolderInputNode, FolderOutputNode } from './nodes/FolderNodes';
import { SegmentNode } from './nodes/SegmentNode';
import { ProofNode } from './nodes/ProofNode';
import { DeletableEdge } from './DeletableEdge';
import { CreateMenu } from './CreateMenu';
import { ArrangePanel } from './ArrangePanel';
import { ViewPrefsPanel } from './ViewPrefsPanel';
import { KeybindingsDialog } from './KeybindingsDialog';
import { NodeSearch, nodeSearchText } from './NodeSearch';
import { TemplatePanel } from './TemplatePanel';
import { isVideoFile, electronFilePath } from '@/lib/mediaFile';

// 模块级稳定引用，否则 React Flow 每次渲染都重建节点/连线类型。
// memo 包装：props（id/data/selected…）不变时跳过节点重渲（性能规范——大画布拖动/缩放的重渲压力主要来自这里）。
const nodeTypes: NodeTypes = {
  image: memo(ImageNode),
  prompt: memo(PromptNode),
  work: memo(WorkNode),
  result: memo(ResultNode),
  group: memo(GroupNode),
  llm: memo(LlmNode),
  comfy: memo(ComfyNode),
  'angle-prompt': memo(AnglePromptNode),
  scale: memo(ScaleNode),
  ratio: memo(RatioNode),
  text: memo(TextNode),
  light: memo(LightNode),
  palette: memo(PaletteNode),
  compare: memo(CompareNode),
  video: memo(VideoNode),
  'image-reverse': memo(ImageReverseNode),
  'video-source': memo(VideoSourceNode),
  'frame-interp': memo(FrameInterpNode),
  'video-clip': memo(VideoClipNode),
  storyboard: memo(StoryboardNode),
  'character-card': memo(CharacterCardNode),
  'prompt-mall': memo(PromptMallNode),
  loop: memo(LoopNode),
  upscale: memo(UpscaleNode),
  vectorize: memo(VectorizeNode),
  'folder-input': memo(FolderInputNode),
  'folder-output': memo(FolderOutputNode),
  segment: memo(SegmentNode),
  proof: memo(ProofNode)
};
const edgeTypes: EdgeTypes = { deletable: DeletableEdge };
const defaultEdgeOptions = { type: 'deletable' };

// 连线规则已抽到 @/lib/canvasConnectRules（单一真相，被 CanvasViewport / agentCatalog / agentBuilder 共用）。

/** 取节点「最新一张图」（用于右键「预览 / 另存 / 入资产库」）。无图返回 undefined。 */
function latestImageOf(cur: Node): string | undefined {
  switch (cur.type) {
    case 'image':
      return (cur.data as unknown as ImageNodeData).src;
    case 'work':
    case 'comfy': {
      const imgs = (cur.data as unknown as WorkNodeData | ComfyNodeData).result?.images;
      return imgs && imgs.length ? imgs[imgs.length - 1] : undefined;
    }
    case 'result': {
      const acc = useSmartResultStore.getState().accum[cur.id] ?? [];
      const imgs = acc.flatMap((r) => r.images);
      return imgs.length ? imgs[imgs.length - 1] : undefined;
    }
    case 'segment':
      return (cur.data as unknown as SegmentNodeData).composedSrc ?? undefined;
    default:
      return undefined;
  }
}

/** 取节点「最新一个视频」（用于右键「放大播放视频」）。无视频返回 undefined。 */
function latestVideoOf(cur: Node): string | undefined {
  const d = cur.data as unknown as { videoPath?: string | null; src?: string | null; outputVideo?: string | null };
  switch (cur.type) {
    case 'video':
      return d.videoPath ?? undefined;
    case 'video-source':
      return d.src ?? undefined;
    case 'scale':
    case 'frame-interp':
    case 'video-clip':
      return d.outputVideo ?? undefined;
    case 'result': {
      const acc = useSmartResultStore.getState().accum[cur.id] ?? [];
      const vids = acc.flatMap((r) => r.videos ?? []);
      return vids.length ? vids[vids.length - 1] : undefined;
    }
    default:
      return undefined;
  }
}

/** 取节点「文本输出」（用于右键「用文本建提示词节点」）。无文本返回空串。 */
function textOutputOf(cur: Node): string {
  switch (cur.type) {
    case 'prompt':
      return ((cur.data as unknown as PromptNodeData).text ?? '').trim();
    case 'llm':
      return ((cur.data as unknown as LlmNodeData).resultText ?? '').trim();
    case 'angle-prompt':
      return ((cur.data as unknown as AnglePromptNodeData).generatedPrompt ?? '').trim();
    case 'light':
      return ((cur.data as unknown as LightNodeData).generatedPrompt ?? '').trim();
    case 'palette':
      return ((cur.data as unknown as PaletteNodeData).generatedPrompt ?? '').trim();
    case 'comfy':
      return ((cur.data as unknown as ComfyNodeData).result?.texts ?? []).join('\n').trim();
    case 'result': {
      const acc = useSmartResultStore.getState().accum[cur.id] ?? [];
      return acc.flatMap((r) => r.texts ?? []).join('\n').trim();
    }
    case 'storyboard':
    case 'character-card':
      return ((cur.data as unknown as { resultText?: string }).resultText ?? '').trim();
    case 'proof':
      return ((cur.data as unknown as ProofNodeData).reportText ?? '').trim();
    default:
      return '';
  }
}

// 可经 runWithUpstream 直接运行的节点类型（与 runner 的 runOne 分发保持一致）。
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

/** 节点右键菜单的「类型专属操作」（运行 / 工作台 / 选图 / 预览 / 复制 / 另存 / 入资产库 / 文本放大 / 建提示词节点），置顶展示。 */
function nodeTypeActions(cur: Node): ContextMenuEntry[] {
  const items: ContextMenuEntry[] = [];
  const id = cur.id;
  if (RUN_TYPES.has(cur.type ?? '')) {
    items.push({ label: '运行此节点', onClick: () => void runWithUpstream(id) });
  }
  // 提示词商城：进一步设置都在工作台弹窗里（卡片只留摘要）
  if (cur.type === 'prompt-mall') {
    items.push({ label: '打开提示词商城', onClick: () => usePromptMallStudioStore.getState().open(id) });
  }
  if (cur.type === 'segment') {
    items.push({ label: '打开切分工作台', onClick: () => useSegmentStudioStore.getState().open(id) });
  }
  if (cur.type === 'proof') {
    items.push({ label: '打开对稿工作台', onClick: () => useProofStudioStore.getState().open(id) });
  }
  if (cur.type === 'image') {
    items.push({ label: '从资产库选图', onClick: () => useGalleryPickerStore.getState().open(id) });
  }
  const img = latestImageOf(cur);
  if (img) {
    const u = img.startsWith('data:') ? img : localPathToImageUrl(img);
    items.push({ label: '放大预览', onClick: () => useSmartPreviewStore.getState().open(u) });
    items.push({ label: '复制图片', onClick: () => void copyImage(u) });
    items.push({ label: '另存图片…', onClick: () => void imageSaveAs(img, 'smart-canvas.png') });
    items.push({ label: '入资产库', onClick: () => void imageToGallery(img) });
    if (!img.startsWith('data:')) {
      items.push({ label: '打开文件所在目录', onClick: () => void window.electronAPI.storage.showInFolder(img) });
    }
    items.push(...buildShortcutSendMenuItems({ kind: 'image', src: img }));
  }
  const vid = latestVideoOf(cur);
  if (vid) {
    items.push({ label: '放大播放视频', onClick: () => openVideoPreview([vid]) });
    if (!vid.startsWith('data:')) {
      items.push({ label: '打开文件所在目录', onClick: () => void window.electronAPI.storage.showInFolder(vid) });
    }
    items.push(...buildShortcutSendMenuItems({ kind: 'video', src: vid }));
  }
  const txt = textOutputOf(cur);
  if (txt) {
    items.push({ label: '放大查看文本', onClick: () => useSmartTextStore.getState().open(txt, '节点文本') });
    items.push({ label: '复制文本', onClick: () => void copyText(txt) });
    items.push({ label: '用文本建提示词节点', onClick: () => makePromptNodeFrom(id, txt) });
    items.push({
      label: '存入 Obsidian 库',
      onClick: () => useVaultExportStore.getState().openWith({ title: suggestedVaultTitle(cur), content: txt })
    });
    items.push(...buildShortcutSendMenuItems({ kind: 'text', text: txt }));
  }
  return items;
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
  const flowAnimation = useSmartViewStore((s) => s.flowAnimation);
  const perfMode = useThemeStore((s) => s.perfMode);
  // 连线流动动画降级：off=始终停；auto=节点>80 或连线>120 时自动停（大画布掉帧主因之一）；性能模式=低配 时始终停
  const noFlowAnim =
    perfMode === 'low' ||
    flowAnimation === 'off' ||
    (flowAnimation === 'auto' && (nodes.length > 80 || rawEdges.length > 120));
  const dimFilter = useSmartCanvasUiStore((s) => s.dimFilter);
  const panel = useSmartCanvasUiStore((s) => s.panel);
  const setPanel = useSmartCanvasUiStore((s) => s.setPanel);
  const { screenToFlowPosition, fitView } = useReactFlow();
  // 拖动时的对齐参考线（世界坐标；undefined = 不显示）
  const [guides, setGuides] = useState<{ x?: number; y?: number }>({});
  // 拖一个节点到另一个节点上时的「上游/下游」落点提示（目标节点世界坐标盒 + 当前半区 + 该方向是否可连）
  const [dropHint, setDropHint] = useState<
    { x: number; y: number; w: number; h: number; half: 'up' | 'down'; valid: boolean } | null
  >(null);
  // 「分组」武装态的框选矩形（flow 坐标；null = 未在框选）
  const [groupMarquee, setGroupMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  // Alt 拖动复制中的预览框（flow 坐标；被拖整组的外接框 = 副本将落下的位置）
  const [altGhost, setAltGhost] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
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

  // 画布筛选（搜索不匹配 → mb-sc-dim 变暗）+ 跳过态（Alt+点击 → mb-sc-skipped 灰显）。
  // 类名没变的节点原样返回（保持对象引用，不触发 React Flow 无谓重渲染）。
  const displayNodes = useMemo(() => {
    const q = dimFilter.trim().toLowerCase();
    return nodes.map((n) => {
      const parts: string[] = [];
      if ((n.data as { skipped?: boolean } | undefined)?.skipped) parts.push('mb-sc-skipped');
      if (q && !nodeSearchText(n).includes(q)) parts.push('mb-sc-dim');
      const cls = parts.length ? parts.join(' ') : undefined;
      return n.className === cls ? n : { ...n, className: cls };
    });
  }, [nodes, dimFilter]);

  // Alt+点击节点 = 切换「跳过」：灰显 + 运行全部/链式补跑/循环驱动绕过（已有输出仍喂下游）。
  // 点在交互控件或九宫格格子上不劫持（格子的 Alt+点击 = 跳过单张图，语义不同）。
  const onNodeClick = useCallback((e: React.MouseEvent, node: Node) => {
    if (!e.altKey) return;
    if (node.type === 'group') return; // 分组容器不参与单节点跳过
    const t = e.target as HTMLElement;
    if (t.closest('button, input, textarea, select, video, a, [contenteditable="true"], .mb-sc-img9-cell')) return;
    const st = useSmartCanvasStore.getState();
    const cur = !!(st.nodes.find((x) => x.id === node.id)?.data as { skipped?: boolean } | undefined)?.skipped;
    st.updateNodeData(node.id, { skipped: !cur });
    if (cur) toast.success('已恢复参与运行', '节点重新加入 运行全部/链式补跑');
    else toast.success('已跳过此节点', '运行全部/链式补跑/循环会绕过它；Alt+点击恢复');
  }, []);

  // 拖动中：计算对齐参考线（与其它顶层节点的 左/中/右 · 上/中/下 对齐）。
  // rAF 节流：拖动事件每帧可触发多次，对齐/落点提示每帧最多算一次（大画布拖动不掉帧）。
  const dragArgRef = useRef<{ e: unknown; node: Node } | null>(null);
  const dragRafRef = useRef(0);
  const onNodeDrag = useCallback(
    (e: unknown, node: Node) => {
      dragArgRef.current = { e, node };
      if (dragRafRef.current) return;
      dragRafRef.current = requestAnimationFrame(() => {
        dragRafRef.current = 0;
        const a = dragArgRef.current;
        if (a) processNodeDrag(a.e, a.node);
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [alignGuides, screenToFlowPosition]
  );
  const processNodeDrag = useCallback(
    (_e: unknown, node: Node) => {
      // Alt 拖动复制中：画「整组外接框」虚线预览（副本将落下的位置），并抑制「上/下游落点」高亮
      // （复制不参与拖到节点上自动连线；对齐参考线继续算，方便对齐落位）
      if (altDupRef.current) {
        const st = useSmartCanvasStore.getState();
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const ent of altDupRef.current.entries) {
          const n = st.nodes.find((x) => x.id === ent.id);
          if (!n) continue;
          const abs = absPosition(n, st.nodes);
          const w = n.measured?.width ?? (typeof n.width === 'number' ? n.width : 220);
          const h = n.measured?.height ?? (typeof n.height === 'number' ? n.height : 120);
          minX = Math.min(minX, abs.x);
          minY = Math.min(minY, abs.y);
          maxX = Math.max(maxX, abs.x + w);
          maxY = Math.max(maxY, abs.y + h);
        }
        if (Number.isFinite(minX)) {
          const PAD = 10;
          setAltGhost((prev) => {
            const next = { x: minX - PAD, y: minY - PAD, w: maxX - minX + PAD * 2, h: maxY - minY + PAD * 2 };
            return prev && prev.x === next.x && prev.y === next.y && prev.w === next.w && prev.h === next.h ? prev : next;
          });
        }
        setDropHint((prev) => (prev ? null : prev));
      } else if (node.type !== 'group' && !node.parentId) {
        // 拖到另一个节点上 → 在目标节点上显示「上游 / 下游」分区高亮（鼠标落点左半=上游、右半=下游）
        const st = useSmartCanvasStore.getState();
        const cur = st.nodes.find((n) => n.id === node.id);
        if (cur) {
          // 命中判定用鼠标位置（与松手时一致）；无 clientX 回退到节点中心
          const cb = topLevelBox(cur);
          const me = _e as { clientX?: number; clientY?: number } | null;
          const mp =
            me && typeof me.clientX === 'number' && typeof me.clientY === 'number'
              ? screenToFlowPosition({ x: me.clientX, y: me.clientY })
              : { x: cb.x + cb.w / 2, y: cb.y + cb.h / 2 };
          const cx = mp.x;
          const cy = mp.y;
          const hit = st.nodes.find((t) => {
            if (t.id === node.id || t.type === 'group' || t.parentId) return false;
            const b = topLevelBox(t);
            return cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h;
          });
          if (hit) {
            const b = topLevelBox(hit);
            const half: 'up' | 'down' = cx < b.x + b.w / 2 ? 'up' : 'down';
            const valid = half === 'up' ? canConnectKinds(cur.type, hit.type) : canConnectKinds(hit.type, cur.type);
            setDropHint((prev) =>
              prev && prev.x === b.x && prev.y === b.y && prev.w === b.w && prev.h === b.h && prev.half === half && prev.valid === valid
                ? prev
                : { x: b.x, y: b.y, w: b.w, h: b.h, half, valid }
            );
          } else {
            setDropHint((prev) => (prev ? null : prev));
          }
        }
      } else {
        setDropHint((prev) => (prev ? null : prev));
      }

      // 对齐参考线（原有）
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
    [alignGuides, screenToFlowPosition]
  );

  // 分组容器化：拖动结束时，若节点中心落在某分组框内 → 归入该分组；否则移出。
  const onNodeDragStop = useCallback(
    (_e: unknown, node: Node) => {
      document.querySelector('.mb-sc-root')?.classList.remove('is-node-dragging');
      // 取消还在排队的拖动帧计算（避免松手后迟到的参考线/落点提示闪现）
      if (dragRafRef.current) {
        cancelAnimationFrame(dragRafRef.current);
        dragRafRef.current = 0;
      }
      setGuides({});
      setDropHint(null);
      setAltGhost(null);
      const st = useSmartCanvasStore.getState();
      const cur = st.nodes.find((n) => n.id === node.id);
      if (!cur) return;

      // Alt 拖动复制：被拖的整组节点（单个或多选整套工作流）各自回到起点（连线不动），
      // 整套副本「拉出来」留在松手处。复制操作不参与「落到节点上自动连线」和「落进分组归组」。
      const altDup = altDupRef.current;
      altDupRef.current = null;
      if (altDup && altDup.entries.some((x) => x.id === node.id)) {
        st.altDragDuplicate(altDup.entries.map((x) => ({ id: x.id, originPos: x.pos })));
        return;
      }

      if (node.type === 'group') return;
      const dim = (n: Node, dw: number, dh: number): { w: number; h: number } => ({
        w: n.measured?.width ?? (typeof n.width === 'number' ? n.width : dw),
        h: n.measured?.height ?? (typeof n.height === 'number' ? n.height : dh)
      });
      const abs = absPosition(cur, st.nodes);
      const { w, h } = dim(cur, 220, 120);
      const cx = abs.x + w / 2;
      const cy = abs.y + h / 2;
      // 命中判定用「鼠标松手位置」（而非被拖节点中心）——更符合直觉：松在哪个节点上就连哪个。
      // 触摸等无 clientX 的情况回退到节点中心。
      const me = _e as { clientX?: number; clientY?: number } | null;
      const hp =
        me && typeof me.clientX === 'number' && typeof me.clientY === 'number'
          ? screenToFlowPosition({ x: me.clientX, y: me.clientY })
          : { x: cx, y: cy };

      // 「拖一个节点落到另一个节点上」→ 自动连线：鼠标落目标左半 = 作上游(拖→目标)，右半 = 作下游(目标→拖)，
      // 并把拖动的节点贴到目标旁（上游在左 / 下游在右）。仅两个顶层非分组节点之间生效；落进分组容器仍走下方归组。
      if (!cur.parentId) {
        const hit = st.nodes.find((t) => {
          if (t.id === node.id || t.type === 'group' || t.parentId) return false;
          const ta = absPosition(t, st.nodes);
          const td = dim(t, 220, 120);
          return hp.x >= ta.x && hp.x <= ta.x + td.w && hp.y >= ta.y && hp.y <= ta.y + td.h;
        });
        if (hit) {
          const ta = absPosition(hit, st.nodes);
          const td = dim(hit, 220, 120);
          const onLeft = hp.x < ta.x + td.w / 2;
          const GAP = 48;
          const source = onLeft ? node.id : hit.id;
          const dest = onLeft ? hit.id : node.id;
          const sk = onLeft ? cur.type : hit.type;
          const tk = onLeft ? hit.type : cur.type;
          if (canConnectKinds(sk, tk)) {
            const newPos = onLeft ? { x: ta.x - w - GAP, y: ta.y } : { x: ta.x + td.w + GAP, y: ta.y };
            st.linkAndMove(source, dest, node.id, newPos);
            toast.success(onLeft ? '已连为上游' : '已连为下游', '拖到节点上 → 自动连线');
          } else {
            toast.error('该连接不允许', invalidReason(sk, tk));
          }
          return; // 已按「落到节点上」处理，跳过归组
        }
      }

      // —— 分组容器化（原有）——
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
    [setNodeParent, screenToFlowPosition]
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

  // 「武装」某类型后点现有节点 → 在点击的左/右半区一侧建新节点并自动连线（左=作上游、右=作下游）。
  // 关键（修「点图片节点会顺带放大图片」）：React Flow 的 onNodeClick 在**冒泡阶段**触发，
  // 晚于节点内 <img>/<video> 等元素自身的 onClick（事件目标先冒泡），故 onNodeClick 里的
  // stopPropagation 来不及拦——内层 onClick 已经把图放大了。改在 .react-flow 根上挂**原生捕获**
  // 监听：武装态下点到节点即 stopPropagation 掐掉内层 onClick + onNodeClick，再自行建邻居连线。
  // 见下方 useEffect（onArmedNodeClickCapture）。

  // 按住 Alt 拖动节点 = 复制：只在「拖动开始」记下意图 + **整组被拖节点**的起点（多选整套工作流一起复制），
  // 真正复制留到「拖动结束」做（历史 bug：在 dragStart 当场克隆会中途改 nodes 数组 → React Flow 拖动态错乱）。
  // 同时给根容器挂 is-node-dragging：拖动期间 CSS 降级（停阴影/过渡/连线动画），防节点多时的果冻感。
  const altDupRef = useRef<{ entries: Array<{ id: string; pos: { x: number; y: number } }> } | null>(null);
  const onNodeDragStart = useCallback((event: React.MouseEvent, node: Node, dragged: Node[]) => {
    document.querySelector('.mb-sc-root')?.classList.add('is-node-dragging');
    // React Flow v12 第三参 = 本次被拖的全部节点（多选拖动时是整个选区）；兜底只含被拖节点自身
    const list = dragged?.length ? dragged : [node];
    altDupRef.current = event.altKey
      ? { entries: list.map((n) => ({ id: n.id, pos: { x: n.position.x, y: n.position.y } })) }
      : null;
  }, []);

  // 「分组」武装态：在画布空白按下并拖动 = 框选建组（分组大小=框选区域、框中节点自动归入网格排布）；
  // 点一下不动 = 保持旧行为放置空分组。document 捕获阶段拦下 pane 上的 pointerdown，
  // 抢在 React Flow 之前 stopPropagation —— 否则 pane 拖动会触发画布平移、框根本画不出来。
  useEffect(() => {
    if (pendingKind !== 'group') return;
    const onDown = (e: PointerEvent): void => {
      if (e.button !== 0) return;
      const t = e.target as HTMLElement | null;
      // 只接管画布空白：xyflow v12 里 pane **包含**节点/连线容器，closest 会误命中——
      // 空白区按下的真实 target 就是 pane 元素本身，故用「直接命中」判定；
      // 点在节点/连线上仍走既有「武装点节点左右半区快速建组 / 点连线插入」逻辑
      if (!t || !t.classList.contains('react-flow__pane')) return;
      e.preventDefault();
      e.stopPropagation();
      const start = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const startScreen = { x: e.clientX, y: e.clientY };
      let moved = false;
      const onMove = (me: PointerEvent): void => {
        if (Math.abs(me.clientX - startScreen.x) + Math.abs(me.clientY - startScreen.y) > 6) moved = true;
        const cur = screenToFlowPosition({ x: me.clientX, y: me.clientY });
        setGroupMarquee({
          x: Math.min(start.x, cur.x),
          y: Math.min(start.y, cur.y),
          w: Math.abs(cur.x - start.x),
          h: Math.abs(cur.y - start.y)
        });
      };
      const onUp = (ue: PointerEvent): void => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        setGroupMarquee(null);
        const store = useSmartCanvasStore.getState();
        if (!moved) {
          store.addNode('group', start); // 单击不拖 = 放空分组（旧行为）
        } else {
          const end = screenToFlowPosition({ x: ue.clientX, y: ue.clientY });
          store.createGroupFromRect({
            x: Math.min(start.x, end.x),
            y: Math.min(start.y, end.y),
            w: Math.abs(end.x - start.x),
            h: Math.abs(end.y - start.y)
          });
        }
        useSmartCanvasUiStore.getState().setPendingKind(null);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [pendingKind, screenToFlowPosition]);

  // 工具栏「武装」后点画布 → 在点击处落位；否则取消选择 + 关菜单。
  const onPaneClick = useCallback(
    (event: React.MouseEvent) => {
      // 刚结束连线产生的合成 click：跳过，别把刚弹的快捷菜单关掉
      if (Date.now() - lastConnectEndRef.current < 350) return;
      const ui = useSmartCanvasUiStore.getState();
      if (ui.pendingKind) {
        // 分组武装由框选逻辑（pointerdown 捕获）全权接管——这里若再落位会双建
        if (ui.pendingKind === 'group') return;
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
          const payload = JSON.parse(scRaw) as { kind?: string; src?: string; text?: string; name?: string; srcs?: string[] };
          const store = useSmartCanvasStore.getState();
          if (payload.kind === 'image' && payload.src) {
            const id = store.addNode('image', pos);
            store.updateNodeData(id, { src: payload.src, name: payload.name ?? '结果图' });
          } else if (payload.kind === 'image-list' && Array.isArray(payload.srcs) && payload.srcs.length) {
            // 结果节点「合集卡」拖出 → 自动生成图片列表节点（九宫格），批次内全部图按序摆入
            const srcs = payload.srcs.filter((s): s is string => typeof s === 'string' && !!s);
            const id = store.addNode('image', pos);
            store.updateNodeData(id, { listMode: true, srcs, name: payload.name ?? '合集图片' });
            toast.success(`已生成图片列表（${srcs.length} 张）`, '合集卡拖出 → 九宫格列表节点，可直接喂下游');
          } else if (payload.kind === 'prompt' && payload.text) {
            const id = store.addNode('prompt', pos);
            store.updateNodeData(id, { text: payload.text });
          }
        } catch {
          /* 非法载荷忽略 */
        }
        return;
      }
      const allFiles = Array.from(event.dataTransfer.files);
      // 1) 视频文件 → 视频上传节点（存本地路径不内联——视频转 dataURI 会撑爆内存/存储）
      const videoFiles = allFiles.filter(isVideoFile);
      if (videoFiles.length) {
        const store = useSmartCanvasStore.getState();
        let made = 0;
        videoFiles.forEach((f, i) => {
          const p = electronFilePath(f);
          if (!p) return;
          const id = store.addNode('video-source', { x: pos.x + i * 40, y: pos.y + i * 32 });
          store.updateNodeData(id, { src: p, name: f.name });
          made++;
        });
        if (made) toast.success(`已创建 ${made} 个视频上传节点`, '拖入视频文件 → 自动建节点');
        else toast.error('拿不到视频文件路径', '请改用视频上传节点上的「上传本地视频」按钮');
      }
      // 2) 图片文件 → 图片节点（多图自动成组）
      const files = allFiles.filter((f) => f.type.startsWith('image/'));
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
      if (videoFiles.length) return;
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
      // 落在某个节点上（非源节点）→ 整个节点体都作判定区（无需精准对准连接口，加大命中范围）。
      // 方向由「拖出的端口」决定：从输出口拖出 → from→over（over 作下游，对准它左侧输入口）；
      // 从输入口拖出 → over→from（over 作上游，对准它右侧输出口）。多输出口端口号 sourceHandle 保留。
      const over = connectionState.toNode;
      if (over && over.id !== from.id) {
        const down = connectionState.fromHandle?.type === 'source';
        const sk = down ? from.type : over.type;
        const tk = down ? over.type : from.type;
        if (canConnectKinds(sk, tk)) {
          const source = down ? from.id : over.id;
          const target = down ? over.id : from.id;
          const sourceHandle = down ? connectionState.fromHandle?.id ?? 'out' : 'out';
          const targetHandle = down ? 'in' : connectionState.fromHandle?.id ?? 'in';
          lastConnectEndRef.current = Date.now(); // 标记刚连过：抑制紧随的 pane click 等副作用
          useSmartCanvasStore.getState().onConnect({ source, target, sourceHandle, targetHandle });
          toast.success(down ? '已连为下游' : '已连为上游', '松开在节点区域即可连接，无需对准连接口');
        } else {
          toast.error('该连接不允许', invalidReason(sk, tk));
        }
        return;
      }
      lastConnectEndRef.current = Date.now();
      // 输入口(target)拖出 → 建上游；输出口(source)拖出 → 建下游（多输出口节点记住具体哪个口）
      const dir = connectionState.fromHandle?.type === 'target' ? 'up' : 'down';
      const anchorHandle = dir === 'down' ? connectionState.fromHandle?.id ?? undefined : undefined;
      const { x, y } = clientXY(event);
      const p = screenToFlowPosition({ x, y });
      useSmartCanvasUiStore
        .getState()
        .openCreateMenu({ screenX: x, screenY: y, flowX: p.x, flowY: p.y, anchorId: from.id, dir, anchorHandle });
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
          // AI 审查选中的这段流程（提示词改进 / 参数建议 / 结构提醒）；免费，只分析不生成
          label: '🤖 AI 优化这段流程',
          onClick: () => {
            void runOptimizeSelection();
          }
        },
        { separator: true },
        {
          label: `群组所选 (${groupable.length})`,
          onClick: () => {
            if (useSmartCanvasStore.getState().groupSelection()) toast.success('已群组并自动排布');
          }
        },
        { label: '复制所选', onClick: () => st.copySelection() },
        { separator: true },
        {
          label: '对齐',
          children: [
            { label: '左对齐', onClick: () => st.alignSelected('left') },
            { label: '水平居中', onClick: () => st.alignSelected('hcenter') },
            { label: '右对齐', onClick: () => st.alignSelected('right') },
            { label: '顶对齐', onClick: () => st.alignSelected('top') },
            { label: '垂直居中', onClick: () => st.alignSelected('vcenter') },
            { label: '底对齐', onClick: () => st.alignSelected('bottom') }
          ]
        },
        {
          label: '分布',
          children: [
            { label: '水平均分', onClick: () => st.distributeSelected('h') },
            { label: '垂直均分', onClick: () => st.distributeSelected('v') }
          ]
        },
        { label: '智能排布', onClick: () => st.arrangeSmart(40) }
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
      const items: ContextMenuEntry[] = [];
      // 类型专属操作置顶（运行 / 选图 / 预览 / 另存 / 入资产库 / 建提示词节点）
      if (cur) {
        const typeActions = nodeTypeActions(cur);
        if (typeActions.length) {
          items.push(...typeActions, { separator: true });
        }
      }
      items.push(
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
        },
        { label: '粘贴', onClick: () => st.pasteClipboard() },
        { label: '选择同类节点', onClick: () => st.selectByType(node.type ?? '') }
      );
      if (st.edges.some((e) => e.source === node.id || e.target === node.id)) {
        items.push({ label: '断开所有连线', onClick: () => st.disconnectNode(node.id) });
      }
      // 手动调过尺寸的节点：恢复自适应（清 manualSize，让节点重新按内容自动放缩）
      if ((cur?.data as { manualSize?: boolean } | undefined)?.manualSize) {
        items.push({ label: '恢复自适应大小', onClick: () => st.updateNodeData(node.id, { manualSize: false } as Partial<SmartNodeData>) });
      }
      if (cur?.parentId) {
        // 子节点：可靠地移出分组（拖不出大分组时用），移出后即顶层节点可正常删除
        items.push({ label: '移出分组', onClick: () => st.setNodeParent(node.id, null) });
      }
      if (node.type === 'group') {
        items.push({ label: '解散分组（保留子节点）', onClick: () => st.removeNode(node.id) });
      }
      items.push({ separator: true });
      items.push({ label: '删除节点', variant: 'danger', onClick: () => st.removeNode(node.id) });
      openContextMenu({ x: e.clientX, y: e.clientY, items });
    },
    [openGroupMenu]
  );

  // 右键空白画布 → 快捷创建 / 粘贴 / 全选 / 智能排布 / 适应视图
  const onPaneContextMenu = useCallback(
    (e: React.MouseEvent | MouseEvent) => {
      e.preventDefault();
      const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const st = useSmartCanvasStore.getState();
      openContextMenu({
        x: e.clientX,
        y: e.clientY,
        items: [
          {
            label: '快捷创建…',
            onClick: () =>
              useSmartCanvasUiStore
                .getState()
                .openCreateMenu({ screenX: e.clientX, screenY: e.clientY, flowX: p.x, flowY: p.y })
          },
          { label: '粘贴', onClick: () => st.pasteClipboard(p) },
          { separator: true },
          { label: '全选', onClick: () => st.selectAll() },
          { label: '智能排布', onClick: () => st.arrangeSmart(40) },
          { label: '适应视图', onClick: () => void fitView({ duration: 300 }) }
        ]
      });
    },
    [screenToFlowPosition, fitView]
  );

  // 右键连线 → 删除连线
  const onEdgeContextMenu = useCallback((e: React.MouseEvent, edge: Edge) => {
    e.preventDefault();
    openContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: '删除连线',
          variant: 'danger',
          onClick: () => useSmartCanvasStore.getState().onEdgesChange([{ type: 'remove', id: edge.id }])
        }
      ]
    });
  }, []);

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
        case 'arrange-smart':
          useSmartCanvasStore.getState().arrangeSmart(48);
          break;
        case 'align-left':
          useSmartCanvasStore.getState().alignSelected('left');
          break;
        case 'align-right':
          useSmartCanvasStore.getState().alignSelected('right');
          break;
        case 'align-top':
          useSmartCanvasStore.getState().alignSelected('top');
          break;
        case 'align-bottom':
          useSmartCanvasStore.getState().alignSelected('bottom');
          break;
        case 'align-hcenter':
          useSmartCanvasStore.getState().alignSelected('hcenter');
          break;
        case 'align-vcenter':
          useSmartCanvasStore.getState().alignSelected('vcenter');
          break;
        case 'distribute-h':
          useSmartCanvasStore.getState().distributeSelected('h');
          break;
        case 'distribute-v':
          useSmartCanvasStore.getState().distributeSelected('v');
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
          useSmartCanvasUiStore.getState().togglePanel('search');
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
      // 方向键微调选中节点（输入框内不抢；Shift = 10px，否则 1px）。
      // 带 Alt/Ctrl/Meta 的方向键放行给下方组合键查找（Alt+方向 = 对齐），不在此微调。
      if (
        !inEditable() &&
        !e.altKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')
      ) {
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

  // 空格 = 临时抓手（纯平移）：按住期间给根容器挂 is-space-pan——CSS 让节点/连线不吃指针，
  // 指针落到节点上也直接穿透到 pane → 只平移画布，不选中/不拖动节点（松开即恢复）。
  // 输入框里打空格不劫持；窗口失焦 / 卸载兜底摘除类名防「卡在抓手态」。
  useEffect(() => {
    const cls = 'is-space-pan';
    const clear = (): void => document.querySelector('.mb-sc-root')?.classList.remove(cls);
    const down = (e: KeyboardEvent): void => {
      if (e.code !== 'Space' || e.repeat || inEditable()) return;
      e.preventDefault(); // 防聚焦按钮被空格触发 / 页面滚动
      document.querySelector('.mb-sc-root')?.classList.add(cls);
    };
    const up = (e: KeyboardEvent): void => {
      if (e.code === 'Space') clear();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', clear);
      clear();
    };
  }, []);

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

  // 武装态点节点：捕获阶段拦截（修「点图片/结果等节点会顺带触发其放大」）。
  // 捕获在内层元素 onClick 之前触发；stopPropagation 后内层 onClick / onNodeClick 都不再跑，
  // 由本监听自行在左/右半区建邻居并连线（类型不兼容则在点击处直接创建）。
  useEffect(() => {
    const el = document.querySelector('.mb-sc-root .react-flow') as HTMLElement | null;
    if (!el) return;
    function onArmedNodeClickCapture(e: MouseEvent): void {
      const ui = useSmartCanvasUiStore.getState();
      if (!ui.pendingKind) return; // 未武装：放行（正常选中 + 内层点击行为）
      const nodeEl = (e.target as HTMLElement | null)?.closest('.react-flow__node') as HTMLElement | null;
      if (!nodeEl) return; // 点空白：交给 onPaneClick 落位
      e.stopPropagation(); // 掐掉内层 <img>/<video> onClick 与 React Flow 的 onNodeClick
      e.preventDefault();
      const id = nodeEl.getAttribute('data-id');
      const kind = ui.pendingKind;
      ui.setPendingKind(null);
      if (!id) return;
      const st = useSmartCanvasStore.getState();
      const cur = st.nodes.find((n) => n.id === id);
      const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      if (!cur || cur.type === 'group') {
        addNode(kind, p); // 分组容器不参与连线语义：按点画布处理
        return;
      }
      const abs = absPosition(cur, st.nodes);
      const w = cur.measured?.width ?? (typeof cur.width === 'number' ? cur.width : 220);
      const onLeft = p.x < abs.x + w / 2;
      const sk = onLeft ? kind : cur.type;
      const tk = onLeft ? cur.type : kind;
      if (canConnectKinds(sk, tk)) {
        st.addLinkedNode(kind, cur.id, onLeft ? 'left' : 'right');
        toast.success(onLeft ? '已创建并连为上游' : '已创建并连为下游', '点节点左/右半区 = 建邻居并自动连线');
      } else {
        addNode(kind, p);
        toast.info('已创建节点（未连线）', invalidReason(sk, tk));
      }
    }
    el.addEventListener('click', onArmedNodeClickCapture, true);
    return () => el.removeEventListener('click', onArmedNodeClickCapture, true);
  }, [screenToFlowPosition, addNode]);

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
      // 0) 系统剪贴板里的视频文件（资源管理器复制 → 粘贴）→ 视频上传节点（存路径不内联）
      const vidFiles = Array.from(dt.files).filter(isVideoFile);
      if (vidFiles.length) {
        e.preventDefault();
        const store = useSmartCanvasStore.getState();
        const center = getSmartViewCenter();
        let made = 0;
        vidFiles.forEach((f, i) => {
          const p = electronFilePath(f);
          if (!p) return;
          const id = store.addNode('video-source', { x: center.x - 120 + i * 40, y: center.y - 110 + i * 32 });
          store.updateNodeData(id, { src: p, name: f.name });
          made++;
        });
        if (made) toast.success(`已粘贴 ${made} 个视频`, '建为视频上传节点');
        else toast.error('拿不到视频文件路径', '请改用视频上传节点上的「上传本地视频」按钮');
        return;
      }
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
        className={[pendingKind ? 'mb-sc-armed' : '', noFlowAnim ? 'mb-sc-noflow' : ''].filter(Boolean).join(' ') || undefined}
        nodes={displayNodes}
        edges={edges}
        onlyRenderVisibleElements
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        onEdgeClick={onEdgeClick}
        onNodeClick={onNodeClick}
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onSelectionContextMenu={onSelectionContextMenu}
        onNodeContextMenu={onNodeContextMenu}
        onPaneContextMenu={onPaneContextMenu}
        onEdgeContextMenu={onEdgeContextMenu}
        onSelectionStart={() => useSmartCanvasUiStore.getState().setBoxSelecting(true)}
        onSelectionEnd={() => useSmartCanvasUiStore.getState().setBoxSelecting(false)}
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
        onMoveStart={() => document.querySelector('.mb-sc-root')?.classList.add('is-panning')}
        onMoveEnd={(_e, vp) => {
          document.querySelector('.mb-sc-root')?.classList.remove('is-panning');
          setViewport(vp);
        }}
        deleteKeyCode={['Delete', 'Backspace']}
        selectionKeyCode={['Control', 'Meta']}
        multiSelectionKeyCode={['Shift']}
        selectionMode={SelectionMode.Partial}
        selectionOnDrag={false}
        panOnDrag
        selectNodesOnDrag={false}
        zoomOnDoubleClick={false}
        connectionRadius={60}
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
        {groupMarquee && (
          <ViewportPortal>
            <div
              className="mb-sc-group-marquee"
              style={{
                position: 'absolute',
                left: groupMarquee.x,
                top: groupMarquee.y,
                width: groupMarquee.w,
                height: groupMarquee.h
              }}
            />
          </ViewportPortal>
        )}
        {altGhost && (
          <ViewportPortal>
            <div
              className="mb-sc-altdup-ghost"
              style={{ position: 'absolute', left: altGhost.x, top: altGhost.y, width: altGhost.w, height: altGhost.h }}
            />
          </ViewportPortal>
        )}
        {dropHint && (
          <ViewportPortal>
            <div
              className={`mb-sc-drophint ${dropHint.valid ? '' : 'is-invalid'}`}
              style={{ position: 'absolute', left: dropHint.x, top: dropHint.y, width: dropHint.w, height: dropHint.h }}
            >
              <div className={`mb-sc-drophint-half ${dropHint.half === 'up' ? 'is-active' : ''}`}>
                <span>上游</span>
              </div>
              <div className={`mb-sc-drophint-half ${dropHint.half === 'down' ? 'is-active' : ''}`}>
                <span>下游</span>
              </div>
            </div>
          </ViewportPortal>
        )}
        <Background gap={18} />
        <MiniMap
          position="top-right"
          pannable
          zoomable
          className="mb-sc-minimap"
          ariaLabel="画布缩略导航"
          nodeClassName={(n) => `mb-sc-mm-${n.type ?? 'node'}`}
          nodeStrokeWidth={2}
        />
      </ReactFlow>
      {panel === 'arrange' && <ArrangePanel onClose={() => setPanel(null)} />}
      {panel === 'viewPrefs' && <ViewPrefsPanel onClose={() => setPanel(null)} />}
      {panel === 'keys' && <KeybindingsDialog onClose={() => setPanel(null)} />}
      {panel === 'search' && <NodeSearch onClose={() => setPanel(null)} />}
      {panel === 'template' && <TemplatePanel onClose={() => setPanel(null)} />}
      <CreateMenu />
    </>
  );
}
