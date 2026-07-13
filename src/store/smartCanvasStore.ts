/**
 * 智能画布（AI 创作）状态：React Flow 的 nodes / edges / viewport + CRUD。
 * 这是「当前打开文档」的工作缓冲区 —— 本身不持久化；多文档的存取由 lib/smartDocStorage.ts +
 * store/smartDocsStore.ts 负责（CanvasWorkspace 挂载时 load、改动时 500ms 去抖写回对应文档）。
 * 与 /canvas（画板）物理隔离。
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type Node,
  type Edge,
  type Connection,
  type NodeChange,
  type EdgeChange,
  type Viewport
} from '@xyflow/react';
import type { SmartNodeKind, SmartNodeData, WorkResult } from '@shared/smartCanvas';
import type { PreviewItem } from '@/components/Lightbox';
import { buildCameraPrompt } from '@/lib/cameraPrompt';
import { buildLightPrompt } from '@/lib/lightPrompt';
import { loadVideoNodeDefaults } from '@/lib/videoNodeDefaults';

/** 新节点初始 data：默认值 + （视频节点）继承上次成功提交的参数（模型/模式/时长/画幅/分辨率）。 */
function dataForNewNode(kind: SmartNodeKind): Record<string, unknown> {
  const base = { ...(defaultNodeData(kind) as object) } as Record<string, unknown>;
  if (kind === 'video') Object.assign(base, loadVideoNodeDefaults() ?? {});
  base.createdAt = Date.now();
  return base;
}

function rid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `n-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
  }
}

/** 节点的绝对坐标（分组子节点 position 是相对父级；仅一层嵌套）。 */
export function absPosition(node: Node, nodes: Node[]): { x: number; y: number } {
  if (node.parentId) {
    const p = nodes.find((n) => n.id === node.parentId);
    if (p) return { x: p.position.x + node.position.x, y: p.position.y + node.position.y };
  }
  return { x: node.position.x, y: node.position.y };
}

function nodeW(n: Node): number {
  return n.measured?.width ?? (typeof n.width === 'number' ? n.width : 220);
}
function nodeH(n: Node): number {
  return n.measured?.height ?? (typeof n.height === 'number' ? n.height : 120);
}
/** 可被排布的节点：顶层、非分组（分组容器与其子节点保持原样）。 */
function movableNodes(nodes: Node[]): Node[] {
  return nodes.filter((n) => !n.parentId && n.type !== 'group');
}

/** 自动落位防重叠：期望位置若与现有顶层节点重叠，沿 y 轴向下顺延到第一个空位。
 *  用于 拖到节点上自动连线 / 武装态点节点建邻居 / 自动结果节点 等「程序决定位置」的场景，
 *  避免多次自动落位叠在同一坐标上。x 不动（保持上下游列对齐），只往下找空行。 */
function findFreePosition(
  desired: { x: number; y: number },
  w: number,
  h: number,
  nodes: Node[],
  excludeId?: string
): { x: number; y: number } {
  const MARGIN = 28;
  const rects = movableNodes(nodes)
    .filter((n) => n.id !== excludeId)
    .map((n) => ({ x: n.position.x, y: n.position.y, w: nodeW(n), h: nodeH(n) }));
  let y = desired.y;
  for (let i = 0; i < 100; i++) {
    const hitRect = rects.find(
      (r) =>
        !(
          desired.x + w + MARGIN <= r.x ||
          r.x + r.w + MARGIN <= desired.x ||
          y + h + MARGIN <= r.y ||
          r.y + r.h + MARGIN <= y
        )
    );
    if (!hitRect) break;
    y = hitRect.y + hitRect.h + MARGIN;
  }
  return { x: desired.x, y };
}

/** 「自动连接」邻居的槽位排布：在锚点左/右侧铺 4 列网格——一行最多 4 个、排满换下一行（向下）。
 *  取代原「贴锚点 + 纯 y 顺延」的单列堆叠（多次拖入会在一列上无限拉高，观感差）。
 *  index = 该侧已有的连接数（第 N 个邻居进第 N 个槽）；调用方再用 findFreePosition 兜底防重叠。 */
function sideSlotPosition(
  anchorAbs: { x: number; y: number },
  anchorW: number,
  side: 'left' | 'right',
  index: number,
  w: number,
  h: number
): { x: number; y: number } {
  const GAPX = 64;
  const GAPY = 40;
  const PER_ROW = 4;
  const col = index % PER_ROW;
  const row = Math.floor(index / PER_ROW);
  return {
    // 左侧：第 1 个贴锚点、往左铺列；右侧对称往右铺
    x: side === 'left' ? anchorAbs.x - (col + 1) * (w + GAPX) : anchorAbs.x + anchorW + GAPX + col * (w + GAPX),
    y: anchorAbs.y + row * (h + GAPY)
  };
}

/** 拓扑序（上游先于下游）。排布时按此顺序铺开，保留「生成 → 结果」这类先后流向。环上节点附末尾。 */
function topoSorted(nodes: Node[], edges: Edge[]): Node[] {
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of nodes) {
    indeg.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of edges) {
    if (!indeg.has(e.source) || !indeg.has(e.target)) continue;
    adj.get(e.source)?.push(e.target);
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const q = nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id);
  const order: Node[] = [];
  const seen = new Set<string>();
  while (q.length) {
    const id = q.shift() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    const n = byId.get(id);
    if (n) order.push(n);
    for (const t of adj.get(id) ?? []) {
      indeg.set(t, (indeg.get(t) ?? 1) - 1);
      if ((indeg.get(t) ?? 0) === 0) q.push(t);
    }
  }
  for (const n of nodes) if (!seen.has(n.id)) order.push(n);
  return order;
}

// ── 撤销/重做：轻量快照栈。只存 nodes/edges 引用（base64 大图按引用共享不复制），上限 50 步。 ──
interface GraphSnap {
  nodes: Node[];
  edges: Edge[];
}
const HISTORY_LIMIT = 50;
function pushSnap(stack: GraphSnap[], snap: GraphSnap): GraphSnap[] {
  const next = [...stack, snap];
  if (next.length > HISTORY_LIMIT) next.shift();
  return next;
}
/** 结构性改动前调用：把当前 nodes/edges 推入 past，清空 future。 */
function commitHistory(past: GraphSnap[], nodes: Node[], edges: Edge[]): { _past: GraphSnap[]; _future: GraphSnap[] } {
  return { _past: pushSnap(past, { nodes, edges }), _future: [] };
}

// ── 复制/粘贴：模块级剪贴板（跨文档有效——切文档会换 store 内容，但本变量留在模块级）。 ──
let clipboard: GraphSnap | null = null;
// 方向键连续微调的节流时间戳（一次连续按住只进一次撤销栈）
let lastNudgeAt = 0;

// ── 视图中心提供器 ──────────────────────────────────────────────
// 「当前视图正中心」的 flow 坐标需要 React Flow 的 screenToFlowPosition（只在
// ReactFlowProvider 内的组件里能拿）。CanvasViewport 挂载时注册一个 getter，让
// store（addNode 默认落位 / 粘贴）与各弹层（文本查看器等）在没有 hook 的地方也能取到。
let viewCenterProvider: (() => { x: number; y: number }) | null = null;
export function registerViewCenterProvider(fn: (() => { x: number; y: number }) | null): void {
  viewCenterProvider = fn;
}
/** 当前视图正中心的 flow 坐标；未注册或异常时回退一个稳妥默认值。 */
export function getSmartViewCenter(): { x: number; y: number } {
  if (viewCenterProvider) {
    try {
      const c = viewCenterProvider();
      if (Number.isFinite(c.x) && Number.isFinite(c.y)) return c;
    } catch {
      /* 容器未就绪等 → 回退 */
    }
  }
  return { x: 200, y: 160 };
}
/** 内部节点剪贴板是否有内容（Ctrl+V 时优先内部节点粘贴，其次系统剪贴板图片/文本）。 */
export function hasNodeClipboard(): boolean {
  return !!clipboard && clipboard.nodes.length > 0;
}

export type AlignEdge = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

/** 存模板前剥离运行态（结果/状态/日志/会话），让模板只保留可复用的配置。
 *  同时兜一道旧 kind 迁移：已删除的「视频反推」（video-reverse）原位转成合并后的「反推」（image-reverse），
 *  字段（modelId/reverseType/frameCount 等）同名直接沿用（与 smartDocStorage.sanitize 的旧档迁移一致）。 */
function sanitizeTemplateNode(input: Node): Node {
  const n = (input.type as string) === 'video-reverse' ? { ...input, type: 'image-reverse' } : input;
  const data: Record<string, unknown> = { ...(n.data as Record<string, unknown>) };
  delete data.skipped; // 跳过态（Alt+点击）是画布内的临时决策，模板不携带

  if (n.type === 'image-reverse' || n.type === 'storyboard' || n.type === 'character-card') {
    // 反推 / 智能分镜 / 角色卡：运行态与文本产物剥掉，模板只留配置
    data.status = 'idle';
    data.resultText = '';
    data.logs = [];
    data.error = null;
    if (n.type === 'character-card') data.analysisText = '';
  }
  if (n.type === 'work' || n.type === 'comfy' || n.type === 'llm') {
    data.status = 'idle';
    data.result = null;
    data.logs = [];
    data.error = null;
    data.taskId = undefined;
    data.runId = undefined;
    if (n.type === 'work') data.inputRefs = [];
    if (n.type === 'llm') {
      data.resultText = '';
      data.chatMessages = [];
      data.conversationId = undefined;
      data.chatStreaming = false;
    }
  }
  if (n.type === 'result') data.result = null;
  if (n.type === 'prompt-mall') {
    data.status = 'idle';
    data.assembled = undefined;
    data.logs = [];
    data.error = null;
  }
  if (n.type === 'loop') {
    data.status = 'idle';
    data.currentIndex = undefined;
    data.doneCount = 0;
    data.failCount = 0;
    data.outPrompt = undefined;
    data.outSize = undefined;
    data.outImage = undefined;
    data.logs = [];
    data.error = null;
  }
  if (n.type === 'folder-output') {
    data.savedCount = 0;
    data.failCount = 0;
    data.seq = 1;
    data.logs = [];
  }
  if (n.type === 'frame-interp') {
    data.status = 'idle';
    data.outputVideo = null;
    data.progress = undefined;
    data.phase = undefined;
    data.error = null;
    data.taskId = undefined;
  }
  if (n.type === 'video-clip') {
    data.status = 'idle';
    data.outputVideo = null;
    data.progress = undefined;
    data.error = null;
  }
  if (n.type === 'upscale') {
    data.status = 'idle';
    data.outputImage = null;
    data.error = null;
    data.logs = [];
    data.outW = undefined;
    data.outH = undefined;
    data.durationMs = undefined;
  }
  if (n.type === 'vectorize') {
    data.status = 'idle';
    data.outputSvgPath = null;
    data.error = null;
    data.logs = [];
    data.progress = undefined;
    data.batchId = undefined;
    data.taskId = undefined;
  }
  if (n.type === 'segment') {
    // 保留 模型/统一风格 配置；清运行态与识别/重绘/拼合产物
    data.status = 'idle';
    data.phase = undefined;
    data.elements = [];
    data.composedSrc = undefined;
    data.imgW = undefined;
    data.imgH = undefined;
    data.analysisSrc = undefined;
    data.inputImage = null;
    data.logs = [];
    data.error = null;
  }
  if (n.type === 'proof') {
    data.status = 'idle';
    data.elements = [];
    data.reportText = undefined;
    data.annotatedSrc = undefined;
    data.imgW = undefined;
    data.imgH = undefined;
    data.analysisSrc = undefined;
    data.inputImage = null;
    data.logs = [];
    data.error = null;
  }
  return { ...n, data };
}

export function defaultNodeData(kind: SmartNodeKind): SmartNodeData {
  switch (kind) {
    case 'image':
      return {};
    case 'prompt':
      return { text: '' };
    case 'work':
      return {
        workType: 'image-generation',
        runMode: 'single',
        provider: 'mengbi',
        modelId: '',
        prompt: '',
        negativePrompt: '',
        seed: null,
        n: 1,
        aspect: '1:1',
        imageSize: '4K',
        quality: 'high',
        strength: 0.6,
        inputRefs: [],
        status: 'idle',
        result: null,
        logs: [],
        error: null
      };
    case 'result':
      return { result: null };
    case 'group':
      return { title: '分组' };
    case 'llm':
      return {
        mode: 'node',
        op: 'optimize',
        modelId: '',
        instruction: '',
        input: '',
        reverseType: 'description',
        status: 'idle',
        resultText: '',
        logs: [],
        error: null,
        chatMessages: []
      };
    case 'comfy':
      return {
        workflowId: '',
        templateName: '',
        controls: [],
        controlValues: {},
        status: 'idle',
        result: null,
        logs: [],
        error: null
      };
    case 'angle-prompt': {
      const base = {
        camMode: 'photo' as const,
        horizontalAngle: 0,
        verticalAngle: 0,
        distance: 4,
        cameraType: 'none' as const,
        aperture: 'none' as const,
        movement: 'none' as const,
        focal: 'none' as const,
        composition: 'none' as const,
        appendConsistencyInstruction: true
      };
      return { ...base, generatedPrompt: buildCameraPrompt(base) };
    }
    case 'scale':
      return {
        mode: 'longest',
        factor: 1,
        edge: 1024,
        fitW: 1024,
        fitH: 1024,
        megapixels: 1,
        keepAspect: true,
        noUpscale: false,
        format: 'png'
      };
    case 'ratio':
      return { sizeMode: 'preset', aspect: '1:1', tier: '2K', customW: 1024, customH: 1024, emit: 'both' };
    case 'text':
      return { text: '双击编辑文字', fontFamily: '', fontSize: 22, color: '', bold: false, italic: false, align: 'left' };
    case 'light': {
      const base = { azimuth: 35, elevation: 55, intensity: 60, warmth: 30, occlusion: 'none' as const, effect: 'none' as const, sourceType: 'none' as const, appendConsistencyInstruction: true };
      return { ...base, generatedPrompt: buildLightPrompt(base) };
    }
    case 'palette':
      return {
        mode: 'extract',
        count: 6,
        colors: [],
        baseHex: '#E8734A',
        scheme: 'complementary',
        promptIncludeValues: true,
        generatedPrompt: ''
      };
    case 'compare':
      return { slider: 50 };
    case 'video':
      return {
        modelId: '',
        prompt: '',
        mode: 'text_to_video',
        duration: '5',
        aspect: 'adaptive',
        resolution: '720p',
        seed: null,
        generateAudio: false,
        returnLastFrame: true,
        status: 'idle'
      };
    case 'image-reverse':
      // 合并后的「反推」节点：新建默认输出「生图提示词」（outputMode），reverseType 仅作旧档回退字段
      return { modelId: '', reverseType: 'description', outputMode: 'prompt', frameCount: 6, status: 'idle', resultText: '', logs: [], error: null };
    case 'video-source':
      return {};
    case 'frame-interp':
      return { targetFps: 60, status: 'idle', outputVideo: null, error: null };
    case 'video-clip':
      return {
        segments: [],
        texts: [],
        brightness: 0,
        contrast: 1,
        saturation: 1,
        gamma: 1,
        hue: 0,
        fps: 30,
        status: 'idle',
        outputVideo: null,
        error: null
      };
    case 'storyboard':
      return { modelId: '', input: '', videoDurationSec: 30, secPerShot: 5, extraNote: '', resultText: '', status: 'idle', logs: [], error: null };
    case 'character-card':
      return { modelId: '', desc: '', sheetType: 'card', subjectType: 'person', cardStyle: 'magazine', analysisText: '', resultText: '', status: 'idle', logs: [], error: null };
    case 'prompt-mall':
      return {
        cart: [],
        groups: [{ id: 'g1', name: '组 1' }],
        activeGroup: 'g1',
        exclusive: true,
        lang: 'zh',
        modelId: '',
        optimize: true,
        status: 'idle',
        logs: [],
        error: null
      };
    case 'loop':
      return {
        sourceType: 'images',
        count: 3,
        rangeFrom: 1,
        rangeTo: 5,
        rangeStep: 1,
        rangeAs: 'text',
        rangeOtherEdge: 1024,
        promptLines: '',
        sizeLines: '',
        images: [],
        batchSize: 1,
        stopOnError: false,
        status: 'idle',
        logs: [],
        error: null
      };
    case 'upscale':
      return { modelName: '', scale: 4, format: 'png', status: 'idle', outputImage: null, logs: [], error: null };
    case 'vectorize':
      return { vmode: 'vtracer', status: 'idle', outputSvgPath: null, logs: [], error: null };
    case 'folder-input':
      return { dir: '', files: [], error: null };
    case 'folder-output':
      return { dir: '', nameRule: 'original', prefix: 'output', seq: 1, enabled: true, savedCount: 0, failCount: 0, logs: [], error: null };
    case 'segment':
      return { modelId: '', genModelId: '', stylePrompt: '', inputImage: null, elements: [], status: 'idle', logs: [], error: null };
    case 'proof':
      return { modelId: '', inputImage: null, elements: [], status: 'idle', logs: [], error: null };
  }
}

const DEFAULT_SIZE: Record<SmartNodeKind, { width: number; height?: number }> = {
  image: { width: 220, height: 200 },
  group: { width: 360, height: 280 },
  prompt: { width: 270, height: 280 },
  work: { width: 268 },
  result: { width: 250 },
  llm: { width: 300 },
  comfy: { width: 268 },
  'angle-prompt': { width: 264, height: 320 },
  scale: { width: 240, height: 240 },
  ratio: { width: 280, height: 360 },
  text: { width: 260, height: 120 },
  light: { width: 300, height: 470 },
  palette: { width: 300, height: 420 },
  compare: { width: 300, height: 340 },
  video: { width: 268, height: 230 },
  'image-reverse': { width: 292 },
  'video-source': { width: 240, height: 220 },
  'frame-interp': { width: 262 },
  'video-clip': { width: 480, height: 220 },
  storyboard: { width: 310 },
  'character-card': { width: 300 },
  'prompt-mall': { width: 300, height: 330 },
  loop: { width: 300, height: 380 },
  upscale: { width: 262 },
  vectorize: { width: 262 },
  'folder-input': { width: 260, height: 200 },
  'folder-output': { width: 270, height: 240 },
  segment: { width: 284, height: 300 },
  proof: { width: 284, height: 300 }
};

interface SmartCanvasState {
  nodes: Node[];
  edges: Edge[];
  viewport: Viewport;
  _spawn: number;
  /** 撤销/重做栈 + 拖动/缩放手势进行中标记（均不持久化） */
  _past: GraphSnap[];
  _future: GraphSnap[];
  _interacting: boolean;
  /** 文本编辑会话：聚焦时快照、是否已改动（用于失焦时决定是否进撤销栈） */
  _editing: boolean;
  _editDirty: boolean;
  _editSnap: GraphSnap | null;

  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (conn: Connection) => void;
  setViewport: (vp: Viewport) => void;
  addNode: (kind: SmartNodeKind, position?: { x: number; y: number }) => string;
  /** 拖入多张图：1 张→单个图片节点；多张→自动建分组容器并网格铺入其中。 */
  dropImages: (images: { src: string; name?: string }[], pos: { x: number; y: number }) => void;
  updateNodeData: (id: string, patch: Partial<SmartNodeData>) => void;
  /** 设置节点尺寸（文字自适应高度、手动调整用） */
  setNodeSize: (id: string, size: { width?: number; height?: number }) => void;
  removeNode: (id: string) => void;
  removeEdge: (id: string) => void;
  /** 分组容器化：把节点归入某分组（parentId）或移出（null），自动换算相对/绝对坐标。 */
  setNodeParent: (id: string, parentId: string | null) => void;
  /** 把选中的顶层非分组节点群组成一个新分组容器，并自动网格排布进容器内。返回新分组 id（<2 个可组节点返回 null）。 */
  groupSelection: () => string | null;
  /** 框选建组：分组大小=框选区域（不足最小值则钳制），框中（中心点落框内）的顶层非分组节点自动归入并网格排布 */
  createGroupFromRect: (rect: { x: number; y: number; w: number; h: number }) => string | null;
  /** 折叠/展开分组：隐藏其子节点 + 相关连线，收起/还原组高度。 */
  toggleGroupCollapse: (id: string) => void;
  /** 排布：网格 / 按类型分组 / 对齐选中 / 均分选中（只动顶层非分组节点） */
  arrangeGrid: (cols: number, gap: number) => void;
  arrangeByType: (gap: number) => void;
  /** 智能排布：按连线识别工作流走向，分层左→右铺开（上游在左、下游在右），层内按上游 barycenter 减少交叉并整体居中。 */
  arrangeSmart: (gap: number) => void;
  alignSelected: (edge: AlignEdge) => void;
  distributeSelected: (axis: 'h' | 'v') => void;
  /** 方向键微调选中节点位置（dx/dy px）；一次连续微调只进一次撤销栈。 */
  nudgeSelected: (dx: number, dy: number) => void;
  selectAll: () => void;
  deselectAll: () => void;
  /** 只选中某个节点（节点搜索跳转后高亮用） */
  selectOnly: (id: string) => void;
  /** 选中所有与某节点同类型的节点（右键「选择同类节点」用） */
  selectByType: (type: string) => void;
  /** 断开某节点的所有连线（右键「断开所有连线」用，一次进撤销栈） */
  disconnectNode: (id: string) => void;
  /** 撤销 / 重做（结构性改动 + 拖动手势进栈；文本编辑走 beginEdit/commitEdit 进栈） */
  undo: () => void;
  redo: () => void;
  /** 文本/属性编辑：聚焦时快照，失焦时若确有改动则把「编辑前」状态压入撤销栈。 */
  beginEdit: () => void;
  commitEdit: () => void;
  /** 复制选中节点（含内部连线）到模块剪贴板 */
  copySelection: () => void;
  /** 粘贴：新 id + 偏移 + 重映射内部连线，选中新节点 */
  pasteClipboard: (at?: { x: number; y: number }) => void;
  /** 复制并就地再制选中节点 */
  duplicateSelection: () => void;
  /** 捕获当前选区为「模板」素材（深拷贝、剥离 selected / 运行态）；无选中返回 null。 */
  captureSelection: () => { nodes: Node[]; edges: Edge[] } | null;
  /** 在指定世界坐标插入一组节点（模板实例化：重映射 id + 顶层节点平移到 pos + 选中）。 */
  insertNodes: (nodes: Node[], edges: Edge[], pos: { x: number; y: number }) => void;
  /** 在某条连线上插入新节点：删掉原连线，改连「上游→新节点→下游」。返回新节点 id。 */
  insertNodeOnEdge: (kind: SmartNodeKind, pos: { x: number; y: number }, edgeId: string) => string;
  /** 原地复制一个节点（右键 / 快捷键复制用）：克隆该节点（分组则连同子节点 + 内部连线）在原位、新 id、不选中。 */
  duplicateNodeInPlace: (id: string) => void;
  /** Alt 拖动复制（拖动结束时调用）：被拖的一组节点（单个或多选整套工作流）各自回到 originPos
   *（连线全部保留不动），副本留在松手位置（新 id；克隆整组「内部连线」——含多选节点之间的连线；
   *  不连任何组外现有节点）= 把整套副本「拉出来」。 */
  altDragDuplicate: (entries: Array<{ id: string; originPos: { x: number; y: number } }>) => void;
  /** 自动连线 + 吸附：在 source→target 间加连线（若同向尚无连线），同时把 movedId 移到 newPos。一次进撤销栈。
   *  用于「把一个节点拖到另一个节点上」自动建立上下游关系（方向 / 合法性由调用方决定）。 */
  linkAndMove: (source: string, target: string, movedId: string, newPos: { x: number; y: number }) => void;
  /** 武装态点现有节点左/右半区 → 在该侧建新节点并自动连线（左=作上游、右=作下游），落位防重叠。返回新节点 id。 */
  addLinkedNode: (kind: SmartNodeKind, anchorId: string, side: 'left' | 'right') => string;
  /** 若 work/comfy 节点下游尚无「结果」节点，自动在其右侧创建一个并连上（生成时调用，避免结果无处显示）。 */
  ensureResultNode: (sourceId: string) => void;
  load: (nodes: Node[], edges: Edge[], viewport?: Viewport) => void;
  reset: () => void;
}

export const useSmartCanvasStore = create<SmartCanvasState>()((set, get) => ({
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  _spawn: 0,
  _past: [],
  _future: [],
  _interacting: false,
  _editing: false,
  _editDirty: false,
  _editSnap: null,

  onNodesChange: (changes) =>
    set((s) => {
      // 拖动/缩放「手势开始」记一次快照（每次手势只记一次，避免每帧入栈）
      const starts = changes.some(
        (c) => (c.type === 'position' && c.dragging === true) || (c.type === 'dimensions' && c.resizing === true)
      );
      const ends = changes.some(
        (c) => (c.type === 'position' && c.dragging === false) || (c.type === 'dimensions' && c.resizing === false)
      );
      let _past = s._past;
      let _future = s._future;
      let _interacting = s._interacting;
      if (starts && !_interacting) {
        _past = pushSnap(_past, { nodes: s.nodes, edges: s.edges });
        _future = [];
        _interacting = true;
      }
      if (ends) _interacting = false;
      // 手动缩放检测：拖 NodeResizer → dimensions 变化带 resizing=true → 标记 manualSize（自适应让位手动）
      const manualIds = new Set<string>();
      for (const c of changes) {
        if (c.type === 'dimensions' && (c as { resizing?: boolean }).resizing) manualIds.add((c as { id: string }).id);
      }
      let nodes = applyNodeChanges(changes, s.nodes);
      if (manualIds.size) {
        nodes = nodes.map((n) =>
          manualIds.has(n.id) && !(n.data as { manualSize?: boolean })?.manualSize
            ? { ...n, data: { ...n.data, manualSize: true } }
            : n
        );
      }
      return { nodes, _past, _future, _interacting };
    }),
  onEdgesChange: (changes) => set((s) => ({ edges: applyEdgeChanges(changes, s.edges) })),
  onConnect: (conn) =>
    set((s) => ({ ...commitHistory(s._past, s.nodes, s.edges), edges: addEdge({ ...conn, type: 'deletable' }, s.edges) })),
  setViewport: (viewport) => set({ viewport }),

  addNode: (kind, position) => {
    const id = rid();
    const k = get()._spawn;
    const size = DEFAULT_SIZE[kind];
    // 自动创建（未显式给位置）一律落「当前视图正中心」并居中；连续创建用 _spawn 轻微错开避免完全重叠。
    let pos = position;
    if (!pos) {
      const c = getSmartViewCenter();
      const w = size.width ?? 220;
      const h = size.height ?? 120;
      const j = k % 5;
      pos = { x: c.x - w / 2 + j * 24, y: c.y - h / 2 + j * 20 };
    }
    const node: Node = {
      id,
      type: kind,
      position: pos,
      data: dataForNewNode(kind),
      width: size.width,
      selected: true, // 新建即选中 → 右侧检查器立刻显示其属性
      ...(size.height ? { height: size.height } : {})
    };
    // 新建即选中：清掉其它选中；group 放最底层避免盖住其它节点
    set((s) => {
      const cleared = s.nodes.map((n) => (n.selected ? { ...n, selected: false } : n));
      return {
        ...commitHistory(s._past, s.nodes, s.edges),
        nodes: kind === 'group' ? [node, ...cleared] : [...cleared, node],
        edges: s.edges.some((e) => e.selected) ? s.edges.map((e) => (e.selected ? { ...e, selected: false } : e)) : s.edges,
        _spawn: s._spawn + 1
      };
    });
    return id;
  },

  dropImages: (images, pos) => {
    if (!images.length) return;
    if (images.length === 1) {
      set((s) => {
        const node: Node = {
          id: rid(),
          type: 'image',
          position: pos,
          data: { src: images[0].src, name: images[0].name ?? '图片' } as unknown as Record<string, unknown>,
          width: 220,
          height: 200
        };
        return { ...commitHistory(s._past, s.nodes, s.edges), nodes: [...s.nodes, node], _spawn: s._spawn + 1 };
      });
      return;
    }
    // 多张：建分组容器 + 网格铺入子图片节点（子坐标相对分组）
    set((s) => {
      const cols = Math.min(3, Math.ceil(Math.sqrt(images.length)));
      const rows = Math.ceil(images.length / cols);
      const cell = 168;
      const gap = 14;
      const headTop = 52;
      const pad = 14;
      const gw = cols * cell + (cols - 1) * gap + pad * 2;
      const gh = rows * cell + (rows - 1) * gap + headTop + pad;
      const groupId = rid();
      const group: Node = {
        id: groupId,
        type: 'group',
        position: pos,
        data: { title: `参考图组（${images.length}）` } as unknown as Record<string, unknown>,
        width: gw,
        height: gh
      };
      const children: Node[] = images.map((im, i) => ({
        id: rid(),
        type: 'image',
        parentId: groupId,
        position: { x: pad + (i % cols) * (cell + gap), y: headTop + Math.floor(i / cols) * (cell + gap) },
        data: { src: im.src, name: im.name ?? `图片${i + 1}` } as unknown as Record<string, unknown>,
        width: cell,
        height: cell
      }));
      return {
        ...commitHistory(s._past, s.nodes, s.edges),
        nodes: [group, ...s.nodes, ...children],
        _spawn: s._spawn + 1 + children.length
      };
    });
  },

  updateNodeData: (id, patch) =>
    set((s) => ({
      nodes: s.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)),
      // 编辑会话进行中：标记「有改动」，失焦时据此把编辑前状态压栈
      ...(s._editing ? { _editDirty: true } : {})
    })),

  setNodeSize: (id, size) =>
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === id
          ? {
              ...n,
              ...(size.width != null ? { width: size.width } : {}),
              ...(size.height != null ? { height: size.height } : {})
            }
          : n
      )
    })),

  removeNode: (id) =>
    set((s) => {
      const removed = s.nodes.find((n) => n.id === id);
      // 删分组：把子节点解绑（转绝对坐标），不连带删除子节点
      const detachChildren = removed?.type === 'group';
      const nodes = s.nodes
        .filter((n) => n.id !== id)
        .map((n) => {
          if (detachChildren && n.parentId === id) {
            const abs = absPosition(n, s.nodes);
            return { ...n, parentId: undefined, position: abs };
          }
          return n;
        });
      return {
        ...commitHistory(s._past, s.nodes, s.edges),
        nodes,
        edges: s.edges.filter((e) => e.source !== id && e.target !== id)
      };
    }),

  setNodeParent: (id, parentId) =>
    set((s) => {
      const idx = s.nodes.findIndex((n) => n.id === id);
      if (idx < 0) return {};
      const node = s.nodes[idx];
      if ((node.parentId ?? null) === parentId) return {};
      const abs = absPosition(node, s.nodes);
      let position = abs;
      if (parentId) {
        const parent = s.nodes.find((n) => n.id === parentId);
        if (!parent) return {};
        const pAbs = absPosition(parent, s.nodes);
        position = { x: abs.x - pAbs.x, y: abs.y - pAbs.y };
      }
      const updated: Node = parentId
        ? { ...node, parentId, position }
        : { ...node, parentId: undefined, position };
      const remaining = s.nodes.filter((n) => n.id !== id);
      if (parentId) {
        // React Flow 要求父节点在子节点之前
        const pIdx = remaining.findIndex((n) => n.id === parentId);
        // 智能扩容：放进来的子节点若超出分组边界，自动把分组撑大以容纳它
        const parent = remaining[pIdx];
        const cw = nodeW(updated);
        const ch = nodeH(updated);
        const needW = position.x + cw + 16;
        const needH = position.y + ch + 16;
        const pw = typeof parent.width === 'number' ? parent.width : nodeW(parent);
        const ph = typeof parent.height === 'number' ? parent.height : nodeH(parent);
        remaining[pIdx] = { ...parent, width: Math.max(pw, needW), height: Math.max(ph, needH) };
        remaining.splice(pIdx + 1, 0, updated);
      } else {
        remaining.push(updated);
      }
      return { ...commitHistory(s._past, s.nodes, s.edges), nodes: remaining };
    }),

  groupSelection: () => {
    const s = get();
    // 只组顶层、非分组的选中节点（分组容器与已归组的子节点不参与）
    const sel = s.nodes.filter((n) => n.selected && !n.parentId && n.type !== 'group');
    if (sel.length < 2) return null;
    const groupId = rid();
    const cols = Math.min(3, Math.ceil(Math.sqrt(sel.length)));
    const rows = Math.ceil(sel.length / cols);
    const gap = 16;
    const headTop = 52;
    const pad = 16;
    const cellW = Math.max(...sel.map(nodeW));
    const cellH = Math.max(...sel.map(nodeH));
    // 分组左上角 = 选区外接框左上角，让新分组出现在原节点附近
    const minX = Math.min(...sel.map((n) => n.position.x));
    const minY = Math.min(...sel.map((n) => n.position.y));
    const gw = cols * cellW + (cols - 1) * gap + pad * 2;
    const gh = rows * cellH + (rows - 1) * gap + headTop + pad;
    const group: Node = {
      id: groupId,
      type: 'group',
      position: { x: minX, y: minY },
      data: { title: `分组（${sel.length}）` } as unknown as Record<string, unknown>,
      width: gw,
      height: gh
    };
    const selIds = new Set(sel.map((n) => n.id));
    // 子节点网格排布：按原位置（上→下、左→右）排，保留视觉直觉
    const ordered = [...sel].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
    const children: Node[] = ordered.map((n, i) => ({
      ...n,
      parentId: groupId,
      position: { x: pad + (i % cols) * (cellW + gap), y: headTop + Math.floor(i / cols) * (cellH + gap) },
      selected: false
    }));
    const others = s.nodes
      .filter((n) => !selIds.has(n.id))
      .map((n) => (n.selected ? { ...n, selected: false } : n));
    set({
      ...commitHistory(s._past, s.nodes, s.edges),
      // React Flow 要求父节点在子节点之前：group 最前、children 最后
      nodes: [group, ...others, ...children],
      _spawn: s._spawn + 1
    });
    return groupId;
  },

  createGroupFromRect: (rect) => {
    const s = get();
    // 分组大小忠实于框选区域（太小钳到能用的最小值）
    let gw = Math.max(240, rect.w);
    let gh = Math.max(160, rect.h);
    const headTop = 52;
    const pad = 16;
    const gap = 16;
    // 框中判定用「节点中心点」：比外接框相交更符合直觉——擦到一条边的大节点不会被误吞
    const captured = movableNodes(s.nodes).filter((n) => {
      const cx = n.position.x + nodeW(n) / 2;
      const cy = n.position.y + nodeH(n) / 2;
      return cx >= rect.x && cx <= rect.x + rect.w && cy >= rect.y && cy <= rect.y + rect.h;
    });
    const groupId = rid();
    let children: Node[] = [];
    if (captured.length) {
      const cellW = Math.max(...captured.map(nodeW));
      const cellH = Math.max(...captured.map(nodeH));
      // 列数按框宽定（框多宽排多少列）；放不下时宽度保底一列、高度向下撑（宽度尽量忠实框选）
      const cols = Math.max(1, Math.min(captured.length, Math.floor((gw - pad * 2 + gap) / (cellW + gap))));
      const rows = Math.ceil(captured.length / cols);
      gw = Math.max(gw, pad * 2 + cols * cellW + (cols - 1) * gap);
      gh = Math.max(gh, headTop + rows * cellH + (rows - 1) * gap + pad);
      // 按原位置（上→下、左→右）排进网格，保留视觉直觉
      const ordered = [...captured].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
      children = ordered.map((n, i) => ({
        ...n,
        parentId: groupId,
        position: { x: pad + (i % cols) * (cellW + gap), y: headTop + Math.floor(i / cols) * (cellH + gap) },
        selected: false
      }));
    }
    const group: Node = {
      id: groupId,
      type: 'group',
      position: { x: rect.x, y: rect.y },
      data: { title: captured.length ? `分组（${captured.length}）` : '分组' } as unknown as Record<string, unknown>,
      width: gw,
      height: gh
    };
    const capIds = new Set(captured.map((n) => n.id));
    const others = s.nodes
      .filter((n) => !capIds.has(n.id))
      .map((n) => (n.selected ? { ...n, selected: false } : n));
    set({
      ...commitHistory(s._past, s.nodes, s.edges),
      // React Flow 要求父节点在子节点之前：group 最前、children 最后
      nodes: [group, ...others, ...children],
      _spawn: s._spawn + 1
    });
    return groupId;
  },

  removeEdge: (id) =>
    set((s) => ({ ...commitHistory(s._past, s.nodes, s.edges), edges: s.edges.filter((e) => e.id !== id) })),

  toggleGroupCollapse: (id) =>
    set((s) => {
      const g = s.nodes.find((n) => n.id === id);
      if (!g || g.type !== 'group') return {};
      const collapsed = !(g.data as { collapsed?: boolean }).collapsed;
      const childIds = new Set(s.nodes.filter((n) => n.parentId === id).map((n) => n.id));
      return {
        ...commitHistory(s._past, s.nodes, s.edges),
        nodes: s.nodes.map((n) => {
          if (n.id === id) {
            const data: Record<string, unknown> = { ...(n.data as Record<string, unknown>), collapsed };
            if (collapsed) {
              data.prevHeight = typeof n.height === 'number' ? n.height : 280;
              return { ...n, data, height: 52 };
            }
            const ph = typeof data.prevHeight === 'number' ? data.prevHeight : 280;
            delete data.prevHeight;
            return { ...n, data, height: ph };
          }
          if (childIds.has(n.id)) return { ...n, hidden: collapsed };
          return n;
        }),
        // 连到被隐藏子节点的连线一并隐藏，避免悬空线
        edges: s.edges.map((e) =>
          childIds.has(e.source) || childIds.has(e.target) ? { ...e, hidden: collapsed } : e
        )
      };
    }),

  arrangeGrid: (cols, gap) =>
    set((s) => {
      // 按拓扑序铺开（上游在前），保留「生成→结果」先后关系，不打乱节点流向
      const movable = topoSorted(movableNodes(s.nodes), s.edges);
      if (!movable.length) return {};
      const c = Math.max(1, Math.floor(cols));
      const g = Math.max(0, gap);
      const maxW = Math.max(...movable.map(nodeW));
      const maxH = Math.max(...movable.map(nodeH));
      const pos = new Map<string, { x: number; y: number }>();
      movable.forEach((n, i) => {
        pos.set(n.id, { x: 60 + (i % c) * (maxW + g), y: 60 + Math.floor(i / c) * (maxH + g) });
      });
      return {
        ...commitHistory(s._past, s.nodes, s.edges),
        nodes: s.nodes.map((n) =>
          pos.has(n.id) ? { ...n, position: pos.get(n.id) as { x: number; y: number } } : n
        )
      };
    }),

  arrangeByType: (gap) =>
    set((s) => {
      const order: SmartNodeKind[] = ['image', 'prompt', 'llm', 'work', 'comfy', 'result'];
      const movable = movableNodes(s.nodes);
      if (!movable.length) return {};
      const g = Math.max(0, gap);
      const pos = new Map<string, { x: number; y: number }>();
      let y = 60;
      for (const kind of order) {
        const row = movable.filter((n) => n.type === kind);
        if (!row.length) continue;
        let x = 60;
        let rowH = 0;
        for (const n of row) {
          pos.set(n.id, { x, y });
          x += nodeW(n) + g;
          rowH = Math.max(rowH, nodeH(n));
        }
        y += rowH + g;
      }
      return {
        ...commitHistory(s._past, s.nodes, s.edges),
        nodes: s.nodes.map((n) =>
          pos.has(n.id) ? { ...n, position: pos.get(n.id) as { x: number; y: number } } : n
        )
      };
    }),

  arrangeSmart: (gap) =>
    set((s) => {
      const movable = movableNodes(s.nodes); // 顶层、非分组
      if (!movable.length) return {};
      const ids = new Set(movable.map((n) => n.id));
      const adj = new Map<string, string[]>();
      const preds = new Map<string, string[]>();
      movable.forEach((n) => {
        adj.set(n.id, []);
        preds.set(n.id, []);
      });
      for (const e of s.edges) {
        if (e.source !== e.target && ids.has(e.source) && ids.has(e.target)) {
          adj.get(e.source)?.push(e.target);
          preds.get(e.target)?.push(e.source);
        }
      }
      // 最长路径分层：上游在前（小层号=左），环节点附末尾不影响主流向
      const topo = topoSorted(movable, s.edges);
      const layer = new Map<string, number>();
      movable.forEach((n) => layer.set(n.id, 0));
      for (const n of topo) {
        const l = layer.get(n.id) ?? 0;
        for (const t of adj.get(n.id) ?? []) layer.set(t, Math.max(layer.get(t) ?? 0, l + 1));
      }
      const maxLayer = Math.max(...movable.map((n) => layer.get(n.id) ?? 0));
      const layers: Node[][] = Array.from({ length: maxLayer + 1 }, () => []);
      for (const n of movable) layers[layer.get(n.id) ?? 0].push(n);
      // 层内排序：第 0 层按当前 y；其后按「上游在上一层的序号均值」(barycenter) 减少连线交叉
      const orderIndex = new Map<string, number>();
      const bary = (n: Node): number => {
        const ps = (preds.get(n.id) ?? [])
          .map((p) => orderIndex.get(p))
          .filter((x): x is number => x != null);
        return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : n.position.y / 100;
      };
      layers.forEach((col, li) => {
        if (li === 0) col.sort((a, b) => a.position.y - b.position.y);
        else col.sort((a, b) => bary(a) - bary(b));
        col.forEach((n, i) => orderIndex.set(n.id, i));
      });
      // 列 x：每层最大宽 + 横向间距累加；层内纵向堆叠并整体居中（视觉平衡）
      const g = Math.max(0, gap);
      const gapX = g + 56;
      const gapY = Math.max(24, g);
      const colW = layers.map((col) => Math.max(1, ...col.map(nodeW)));
      const colX: number[] = [];
      let x = 80;
      for (let li = 0; li <= maxLayer; li++) {
        colX[li] = x;
        x += colW[li] + gapX;
      }
      const colH = layers.map((col) => col.reduce((a, n) => a + nodeH(n), 0) + Math.max(0, col.length - 1) * gapY);
      const maxColH = Math.max(1, ...colH);
      const pos = new Map<string, { x: number; y: number }>();
      layers.forEach((col, li) => {
        let y = 80 + (maxColH - colH[li]) / 2;
        for (const n of col) {
          pos.set(n.id, { x: colX[li], y });
          y += nodeH(n) + gapY;
        }
      });
      return {
        ...commitHistory(s._past, s.nodes, s.edges),
        nodes: s.nodes.map((n) => (pos.has(n.id) ? { ...n, position: pos.get(n.id) as { x: number; y: number } } : n))
      };
    }),

  alignSelected: (edge) =>
    set((s) => {
      const sel = movableNodes(s.nodes).filter((n) => n.selected);
      if (sel.length < 2) return {};
      let target: number;
      if (edge === 'left') target = Math.min(...sel.map((n) => n.position.x));
      else if (edge === 'right') target = Math.max(...sel.map((n) => n.position.x + nodeW(n)));
      else if (edge === 'hcenter')
        target = sel.reduce((a, n) => a + n.position.x + nodeW(n) / 2, 0) / sel.length;
      else if (edge === 'top') target = Math.min(...sel.map((n) => n.position.y));
      else if (edge === 'bottom') target = Math.max(...sel.map((n) => n.position.y + nodeH(n)));
      else target = sel.reduce((a, n) => a + n.position.y + nodeH(n) / 2, 0) / sel.length;
      const ids = new Set(sel.map((n) => n.id));
      return {
        ...commitHistory(s._past, s.nodes, s.edges),
        nodes: s.nodes.map((n) => {
          if (!ids.has(n.id)) return n;
          const p = { ...n.position };
          if (edge === 'left') p.x = target;
          else if (edge === 'right') p.x = target - nodeW(n);
          else if (edge === 'hcenter') p.x = target - nodeW(n) / 2;
          else if (edge === 'top') p.y = target;
          else if (edge === 'bottom') p.y = target - nodeH(n);
          else p.y = target - nodeH(n) / 2;
          return { ...n, position: p };
        })
      };
    }),

  distributeSelected: (axis) =>
    set((s) => {
      const sel = movableNodes(s.nodes).filter((n) => n.selected);
      if (sel.length < 3) return {};
      const sorted = [...sel].sort((a, b) =>
        axis === 'h' ? a.position.x - b.position.x : a.position.y - b.position.y
      );
      const first = axis === 'h' ? sorted[0].position.x : sorted[0].position.y;
      const last = sorted[sorted.length - 1];
      const lastV = axis === 'h' ? last.position.x : last.position.y;
      const step = (lastV - first) / (sorted.length - 1);
      const pos = new Map<string, number>();
      sorted.forEach((n, i) => pos.set(n.id, first + step * i));
      return {
        ...commitHistory(s._past, s.nodes, s.edges),
        nodes: s.nodes.map((n) => {
          if (!pos.has(n.id)) return n;
          const v = pos.get(n.id) as number;
          return {
            ...n,
            position: axis === 'h' ? { ...n.position, x: v } : { ...n.position, y: v }
          };
        })
      };
    }),

  nudgeSelected: (dx, dy) =>
    set((s) => {
      if (!s.nodes.some((n) => n.selected)) return {};
      const now = Date.now();
      const fresh = now - lastNudgeAt > 500; // 连续微调（500ms 内）只在首次进撤销栈
      lastNudgeAt = now;
      const moved = s.nodes.map((n) =>
        n.selected ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } } : n
      );
      return fresh ? { ...commitHistory(s._past, s.nodes, s.edges), nodes: moved } : { nodes: moved };
    }),

  selectAll: () =>
    set((s) => ({
      nodes: s.nodes.map((n) => ({ ...n, selected: true })),
      edges: s.edges.map((e) => ({ ...e, selected: true }))
    })),

  deselectAll: () =>
    set((s) => ({
      nodes: s.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)),
      edges: s.edges.map((e) => (e.selected ? { ...e, selected: false } : e))
    })),

  selectOnly: (id) =>
    set((s) => ({ nodes: s.nodes.map((n) => (n.selected !== (n.id === id) ? { ...n, selected: n.id === id } : n)) })),

  selectByType: (type) =>
    set((s) => ({ nodes: s.nodes.map((n) => (n.selected !== (n.type === type) ? { ...n, selected: n.type === type } : n)) })),

  disconnectNode: (id) =>
    set((s) => {
      const next = s.edges.filter((e) => e.source !== id && e.target !== id);
      if (next.length === s.edges.length) return {};
      return { edges: next, _past: pushSnap(s._past, { nodes: s.nodes, edges: s.edges }), _future: [] };
    }),

  undo: () =>
    set((s) => {
      if (!s._past.length) return {};
      const prev = s._past[s._past.length - 1];
      return {
        nodes: prev.nodes,
        edges: prev.edges,
        _past: s._past.slice(0, -1),
        _future: pushSnap(s._future, { nodes: s.nodes, edges: s.edges }),
        _interacting: false
      };
    }),
  redo: () =>
    set((s) => {
      if (!s._future.length) return {};
      const next = s._future[s._future.length - 1];
      return {
        nodes: next.nodes,
        edges: next.edges,
        _future: s._future.slice(0, -1),
        _past: pushSnap(s._past, { nodes: s.nodes, edges: s.edges }),
        _interacting: false
      };
    }),

  beginEdit: () => set((s) => ({ _editing: true, _editDirty: false, _editSnap: { nodes: s.nodes, edges: s.edges } })),
  commitEdit: () =>
    set((s) => {
      if (!s._editing) return {};
      const base = { _editing: false, _editDirty: false, _editSnap: null };
      if (s._editDirty && s._editSnap) return { ...base, _past: pushSnap(s._past, s._editSnap), _future: [] };
      return base;
    }),

  copySelection: () => {
    const s = get();
    const sel = s.nodes.filter((n) => n.selected);
    if (!sel.length) return;
    const ids = new Set(sel.map((n) => n.id));
    clipboard = {
      nodes: sel.map((n) => structuredClone({ ...n, selected: false })),
      edges: s.edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map((e) => structuredClone(e))
    };
  },

  pasteClipboard: (at) => {
    if (!clipboard || !clipboard.nodes.length) return;
    const cb = clipboard;
    // 粘贴后整体落「当前视图正中心」：以剪贴板顶层节点的包围盒中心对齐到视图中心，
    // 平移所有顶层节点（保持相对布局）；子节点保持相对父坐标不动。
    const center = at ?? getSmartViewCenter();
    const cbIds = new Set(cb.nodes.map((n) => n.id));
    const tops = cb.nodes.filter((n) => !n.parentId || !cbIds.has(n.parentId));
    const xs = tops.map((n) => n.position.x);
    const ys = tops.map((n) => n.position.y);
    const bx = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0;
    const by = ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 0;
    const dx = center.x - bx;
    const dy = center.y - by;
    set((s) => {
      const idMap = new Map<string, string>();
      cb.nodes.forEach((n) => idMap.set(n.id, rid()));
      const made: Node[] = cb.nodes.map((n) => {
        const clone = structuredClone(n);
        // 内部父子关系一并复制；指向选区外的 parentId 丢弃（变顶层）
        const parentId = clone.parentId && idMap.has(clone.parentId) ? idMap.get(clone.parentId) : undefined;
        // 仅顶层节点平移到视图中心；子节点坐标相对父，保持不变
        const position = parentId
          ? clone.position
          : { x: clone.position.x + dx, y: clone.position.y + dy };
        return {
          ...clone,
          id: idMap.get(n.id) as string,
          parentId,
          position,
          selected: true
        };
      });
      const newEdges: Edge[] = cb.edges.map((e) => ({
        ...structuredClone(e),
        id: rid(),
        source: idMap.get(e.source) as string,
        target: idMap.get(e.target) as string,
        type: 'deletable'
      }));
      // 分组父节点排前（React Flow 要求父先于子）；旧选区取消选中
      const groups = made.filter((n) => n.type === 'group');
      const rest = made.filter((n) => n.type !== 'group');
      const cleared = s.nodes.map((n) => (n.selected ? { ...n, selected: false } : n));
      return {
        ...commitHistory(s._past, s.nodes, s.edges),
        nodes: [...groups, ...cleared, ...rest],
        edges: [...s.edges, ...newEdges],
        _spawn: s._spawn + made.length
      };
    });
  },

  duplicateSelection: () => {
    get().copySelection();
    get().pasteClipboard();
  },

  linkAndMove: (source, target, movedId, newPos) =>
    set((s) => {
      // 同向已有连线则不重复加；否则按 source→target 连（handle 固定 out→in）
      const exists = s.edges.some((e) => e.source === source && e.target === target);
      const conn: Connection = { source, target, sourceHandle: 'out', targetHandle: 'in' };
      const edges = exists ? s.edges : addEdge({ ...conn, type: 'deletable' }, s.edges);
      const moved = s.nodes.find((n) => n.id === movedId);
      let free = newPos;
      if (moved) {
        // 槽位排布：被拖节点按「该侧已连邻居数」进 4 列网格槽（排满一行换行），
        // 不再纯 y 顺延——那会让多次拖入在一列上无限堆高
        const anchorId = movedId === source ? target : source;
        const side: 'left' | 'right' = movedId === source ? 'left' : 'right';
        const anchor = s.nodes.find((n) => n.id === anchorId);
        if (anchor) {
          const idx = s.edges.filter((e) =>
            side === 'left'
              ? e.target === anchorId && e.source !== movedId
              : e.source === anchorId && e.target !== movedId
          ).length;
          const desired = sideSlotPosition(
            absPosition(anchor, s.nodes),
            nodeW(anchor),
            side,
            idx,
            nodeW(moved),
            nodeH(moved)
          );
          free = findFreePosition(desired, nodeW(moved), nodeH(moved), s.nodes, movedId);
        } else {
          free = findFreePosition(newPos, nodeW(moved), nodeH(moved), s.nodes, movedId);
        }
      }
      const nodes = s.nodes.map((n) => (n.id === movedId ? { ...n, position: free } : n));
      return { ...commitHistory(s._past, s.nodes, s.edges), edges, nodes };
    }),

  addLinkedNode: (kind, anchorId, side) => {
    const id = rid();
    set((s) => {
      const anchor = s.nodes.find((n) => n.id === anchorId);
      if (!anchor) return {};
      const abs = absPosition(anchor, s.nodes);
      const aw = nodeW(anchor);
      const size = DEFAULT_SIZE[kind];
      const w = size.width ?? 220;
      const h = size.height ?? 120;
      // 槽位排布（与 linkAndMove 同规则）：第 N 个邻居进第 N 个槽，一行 4 个排满换行
      const idx = s.edges.filter((e) => (side === 'left' ? e.target === anchorId : e.source === anchorId)).length;
      const desired = sideSlotPosition(abs, aw, side, idx, w, h);
      const pos = findFreePosition(desired, w, h, s.nodes);
      const node: Node = {
        id,
        type: kind,
        position: pos,
        data: dataForNewNode(kind),
        width: size.width,
        selected: true,
        ...(size.height ? { height: size.height } : {})
      };
      // 左半区 = 新节点作上游（新 → 锚点）；右半区 = 作下游（锚点 → 新）
      const conn: Connection =
        side === 'left'
          ? { source: id, target: anchorId, sourceHandle: 'out', targetHandle: 'in' }
          : { source: anchorId, target: id, sourceHandle: 'out', targetHandle: 'in' };
      const cleared = s.nodes.map((n) => (n.selected ? { ...n, selected: false } : n));
      return {
        ...commitHistory(s._past, s.nodes, s.edges),
        nodes: [...cleared, node],
        edges: addEdge({ ...conn, type: 'deletable' }, s.edges),
        _spawn: s._spawn + 1
      };
    });
    return id;
  },

  ensureResultNode: (sourceId) =>
    set((s) => {
      const src = s.nodes.find((n) => n.id === sourceId);
      if (!src || (src.type !== 'work' && src.type !== 'comfy' && src.type !== 'video')) return {};
      // 下游已有结果节点则不重复创建
      const hasResult = s.edges.some(
        (e) => e.source === sourceId && s.nodes.find((n) => n.id === e.target)?.type === 'result'
      );
      if (hasResult) return {};
      const abs = absPosition(src, s.nodes);
      const w = typeof src.width === 'number' ? src.width : 268;
      const size = DEFAULT_SIZE.result;
      const rpos = findFreePosition(
        { x: abs.x + w + 80, y: abs.y },
        size.width ?? 260,
        size.height ?? 200,
        s.nodes
      );
      const rnode: Node = {
        id: rid(),
        type: 'result',
        position: rpos,
        data: { ...(defaultNodeData('result') as object), createdAt: Date.now() } as unknown as Record<string, unknown>,
        width: size.width,
        ...(size.height ? { height: size.height } : {})
      };
      const conn: Connection = { source: sourceId, target: rnode.id, sourceHandle: 'out', targetHandle: 'in' };
      return {
        ...commitHistory(s._past, s.nodes, s.edges),
        nodes: [...s.nodes, rnode],
        edges: addEdge({ ...conn, type: 'deletable' }, s.edges)
      };
    }),

  insertNodeOnEdge: (kind, pos, edgeId) => {
    const id = rid();
    set((s) => {
      const size = DEFAULT_SIZE[kind];
      const node: Node = {
        id,
        type: kind,
        position: pos,
        data: dataForNewNode(kind),
        width: size.width,
        selected: true,
        ...(size.height ? { height: size.height } : {})
      };
      const cleared = s.nodes.map((n) => (n.selected ? { ...n, selected: false } : n));
      const nodes = kind === 'group' ? [node, ...cleared] : [...cleared, node];
      const edge = s.edges.find((e) => e.id === edgeId);
      let edges = s.edges.map((e) => (e.selected ? { ...e, selected: false } : e));
      if (edge) {
        edges = edges.filter((e) => e.id !== edgeId);
        edges.push({ id: rid(), source: edge.source, target: id, type: 'deletable' } as Edge);
        edges.push({ id: rid(), source: id, target: edge.target, type: 'deletable' } as Edge);
      }
      return { ...commitHistory(s._past, s.nodes, s.edges), nodes, edges, _spawn: s._spawn + 1 };
    });
    return id;
  },

  duplicateNodeInPlace: (id) =>
    set((s) => {
      const node = s.nodes.find((n) => n.id === id);
      if (!node) return {};
      // 分组连子节点一起克隆（保留内部父子关系 + 内部连线）；普通节点单独克隆
      const kids = node.type === 'group' ? s.nodes.filter((n) => n.parentId === id) : [];
      const srcNodes = [node, ...kids];
      const idMap = new Map<string, string>();
      srcNodes.forEach((n) => idMap.set(n.id, rid()));
      const idset = new Set(srcNodes.map((n) => n.id));
      const made: Node[] = srcNodes.map((n) => {
        const clone = structuredClone(n);
        // 父分组也在克隆集内 → 指向新分组；否则保留原 parentId（如克隆一个分组内的子节点）
        const parentId = clone.parentId && idMap.has(clone.parentId) ? idMap.get(clone.parentId) : clone.parentId;
        return { ...clone, id: idMap.get(n.id) as string, parentId, selected: false };
      });
      const newEdges: Edge[] = s.edges
        .filter((e) => idset.has(e.source) && idset.has(e.target))
        .map((e) => ({
          ...structuredClone(e),
          id: rid(),
          source: idMap.get(e.source) as string,
          target: idMap.get(e.target) as string,
          type: 'deletable'
        }));
      const groups = made.filter((n) => n.type === 'group');
      const rest = made.filter((n) => n.type !== 'group');
      return {
        ...commitHistory(s._past, s.nodes, s.edges),
        nodes: [...groups, ...s.nodes, ...rest],
        edges: [...s.edges, ...newEdges],
        _spawn: s._spawn + made.length
      };
    }),

  altDragDuplicate: (entries) =>
    set((s) => {
      // 收集要复制的源节点：每个被拖节点（分组连子节点一起）；Set 去重（分组与其子节点可能同时被选中）
      const originById = new Map(entries.map((e) => [e.id, e.originPos]));
      const seen = new Set<string>();
      const srcNodes: Node[] = [];
      for (const ent of entries) {
        const node = s.nodes.find((n) => n.id === ent.id);
        if (!node || seen.has(node.id)) continue;
        seen.add(node.id);
        srcNodes.push(node);
        if (node.type === 'group') {
          for (const k of s.nodes.filter((n) => n.parentId === node.id)) {
            if (!seen.has(k.id)) {
              seen.add(k.id);
              srcNodes.push(k);
            }
          }
        }
      }
      if (!srcNodes.length) return {};
      const idMap = new Map<string, string>();
      srcNodes.forEach((n) => idMap.set(n.id, rid()));
      // 副本留在「松手位置」（= 节点当前位置）并**成为新选区**（用户接下来操作的对象是副本）；
      // 只克隆整组内部连线（含多选节点之间的连线），不连组外节点
      const made: Node[] = srcNodes.map((n) => {
        const clone = structuredClone(n);
        const parentId = clone.parentId && idMap.has(clone.parentId) ? idMap.get(clone.parentId) : clone.parentId;
        return { ...clone, id: idMap.get(n.id) as string, parentId, selected: true };
      });
      const newEdges: Edge[] = s.edges
        .filter((e) => seen.has(e.source) && seen.has(e.target))
        .map((e) => ({
          ...structuredClone(e),
          id: rid(),
          source: idMap.get(e.source) as string,
          target: idMap.get(e.target) as string,
          type: 'deletable'
        }));
      const groups = made.filter((n) => n.type === 'group');
      const rest = made.filter((n) => n.type !== 'group');
      // 原节点各自回到拖动起点（连线原样不动）并取消选中——选中态移交给整套副本
      const baseNodes = s.nodes.map((n) => {
        const origin = originById.get(n.id);
        if (origin) return { ...n, position: origin, selected: false };
        return n.selected ? { ...n, selected: false } : n;
      });
      return {
        ...commitHistory(s._past, s.nodes, s.edges),
        nodes: [...groups, ...baseNodes, ...rest],
        edges: [...s.edges, ...newEdges],
        _spawn: s._spawn + made.length
      };
    }),

  captureSelection: () => {
    const s = get();
    const sel = s.nodes.filter((n) => n.selected);
    if (!sel.length) return null;
    const ids = new Set(sel.map((n) => n.id));
    const nodes = sel.map((n) => sanitizeTemplateNode(structuredClone({ ...n, selected: false })));
    const edges = s.edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map((e) => structuredClone(e));
    return { nodes, edges };
  },

  insertNodes: (tplNodes, tplEdges, pos) =>
    set((s) => {
      if (!tplNodes.length) return {};
      // 平移基准取「顶层节点」外接框左上角（子节点是相对坐标，不参与求 min）
      const tops = tplNodes.filter((n) => !n.parentId);
      const minX = tops.length ? Math.min(...tops.map((n) => n.position.x)) : 0;
      const minY = tops.length ? Math.min(...tops.map((n) => n.position.y)) : 0;
      const idMap = new Map<string, string>();
      tplNodes.forEach((n) => idMap.set(n.id, rid()));
      const made: Node[] = tplNodes.map((n) => {
        const clone = structuredClone(n);
        // 仅当父分组也在模板内时才保留父子关系；否则该节点变顶层
        const parentId = clone.parentId && idMap.has(clone.parentId) ? idMap.get(clone.parentId) : undefined;
        // 有效子节点保留相对父级坐标；顶层（含被孤立的子节点）平移到 pos
        const position = parentId
          ? clone.position
          : { x: pos.x + (clone.position.x - minX), y: pos.y + (clone.position.y - minY) };
        return { ...clone, id: idMap.get(n.id) as string, parentId, position, selected: true };
      });
      const newEdges: Edge[] = tplEdges.map((e) => ({
        ...structuredClone(e),
        id: rid(),
        source: idMap.get(e.source) as string,
        target: idMap.get(e.target) as string,
        type: 'deletable'
      }));
      const groups = made.filter((n) => n.type === 'group');
      const rest = made.filter((n) => n.type !== 'group');
      const cleared = s.nodes.map((n) => (n.selected ? { ...n, selected: false } : n));
      return {
        ...commitHistory(s._past, s.nodes, s.edges),
        nodes: [...groups, ...cleared, ...rest],
        edges: [...s.edges, ...newEdges],
        _spawn: s._spawn + made.length
      };
    }),

  load: (nodes, edges, viewport) =>
    set({
      nodes,
      edges,
      viewport: viewport ?? { x: 0, y: 0, zoom: 1 },
      _past: [],
      _future: [],
      _interacting: false,
      _editing: false,
      _editDirty: false,
      _editSnap: null
    }),
  reset: () => {
    clipboard = null; // 清空模块级剪贴板，避免跨文档/共享设备残留上一份节点数据
    set({
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      _spawn: 0,
      _past: [],
      _future: [],
      _interacting: false,
      _editing: false,
      _editDirty: false,
      _editSnap: null
    });
  }
}));

/**
 * 结果节点的「累积结果」：每次生成都往对应结果节点追加一条（按节点 id）。
 * 内存态、**不持久化、不进文档** —— 切功能/切文档仍在（模块级存活），重启软件即清空。
 * 满足「未重启一直保留、重启清除」的统一集合节点语义。
 */
interface SmartResultState {
  accum: Record<string, WorkResult[]>;
  push: (nodeId: string, result: WorkResult) => void;
  clear: (nodeId: string) => void;
}
/**
 * 每个结果节点累积条数上限。超出按 FIFO 淘汰最旧的 ——
 * 累积里多是 base64 图，长会话多轮生成无上限会撑爆内存。
 */
const MAX_RESULTS_PER_NODE = 100;
export const useSmartResultStore = create<SmartResultState>((set) => ({
  accum: {},
  push: (nodeId, result) =>
    set((s) => {
      const merged = [...(s.accum[nodeId] ?? []), result];
      const capped =
        merged.length > MAX_RESULTS_PER_NODE
          ? merged.slice(merged.length - MAX_RESULTS_PER_NODE)
          : merged;
      return { accum: { ...s.accum, [nodeId]: capped } };
    }),
  clear: (nodeId) =>
    set((s) => {
      const next = { ...s.accum };
      delete next[nodeId];
      return { accum: next };
    })
}));

/** 结果图放大预览（驱动 SmartCanvasPage 顶层的 Lightbox），节点里点缩略图即开。
 *  open 接受 单个 src（兼容旧调用）或 PreviewItem 列表 + 起始下标（获得左右切换）。 */
interface SmartPreviewState {
  items: PreviewItem[];
  index: number;
  /** 兼容旧字段：当前是否打开（= items 非空） */
  src: string | null;
  open: (srcOrItems: string | PreviewItem[], index?: number) => void;
  close: () => void;
}
export const useSmartPreviewStore = create<SmartPreviewState>((set) => ({
  items: [],
  index: 0,
  src: null,
  open: (srcOrItems, index = 0) => {
    const items: PreviewItem[] =
      typeof srcOrItems === 'string' ? [{ src: srcOrItems }] : srcOrItems;
    if (!items.length) return;
    const i = Math.max(0, Math.min(index, items.length - 1));
    set({ items, index: i, src: items[i].src });
  },
  close: () => set({ items: [], index: 0, src: null })
}));

/** 长文本放大查看（LLM 输出 / 结果节点文本看不全时全屏读 + 复制）。 */
interface SmartTextState {
  text: string | null;
  title: string;
  open: (text: string, title?: string) => void;
  close: () => void;
}
export const useSmartTextStore = create<SmartTextState>((set) => ({
  text: null,
  title: '文本',
  open: (text, title = '文本') => set({ text, title }),
  close: () => set({ text: null })
}));

/** 画布交互的临时 UI 状态（不持久化）：点击放置 + 拖出/双击快捷创建菜单。 */
export interface CreateMenuState {
  /** 菜单在屏幕上的位置（fixed 定位） */
  screenX: number;
  screenY: number;
  /** 新节点要落的世界坐标 */
  flowX: number;
  flowY: number;
  /** 若由「从某节点拖出」触发：锚点节点 id + 方向（down=建下游并连出 / up=建上游并连入） */
  anchorId?: string;
  dir?: 'up' | 'down';
  /** dir='down' 时拖出的源输出口 id（预留多输出口节点；当前各节点均为默认口）；缺省 'out' */
  anchorHandle?: string;
  /** 打开时间戳：挡掉「开菜单的同一手势」尾随的合成 click 把菜单立刻关掉 */
  openedAt?: number;
}
/** 右上工具条唤起的浮层（一次一个）：排布 / 外观 / 快捷键 / 搜索 / 模板。 */
export type SmartPanel = 'arrange' | 'viewPrefs' | 'keys' | 'search' | 'template';
interface SmartUiState {
  /** 已点击工具栏、等待在画布上点一下落位的节点类型 */
  pendingKind: SmartNodeKind | null;
  setPendingKind: (k: SmartNodeKind | null) => void;
  createMenu: CreateMenuState | null;
  openCreateMenu: (m: CreateMenuState) => void;
  closeCreateMenu: () => void;
  /** 右侧节点属性栏是否收起 */
  inspectorCollapsed: boolean;
  toggleInspector: () => void;
  /** 画布筛选关键词：非空时不匹配的节点在画布上变暗（搜索框驱动） */
  dimFilter: string;
  setDimFilter: (q: string) => void;
  /** 当前打开的浮层面板（顶部工具条与画布共享，集中渲染） */
  panel: SmartPanel | null;
  setPanel: (p: SmartPanel | null) => void;
  togglePanel: (p: SmartPanel) => void;
  /** 是否正在框选（Ctrl 拖拽选区进行中）：期间不弹节点属性面板，避免遮挡、影响框选 */
  boxSelecting: boolean;
  setBoxSelecting: (v: boolean) => void;
  /** 本次选中由「点节点卡上的控件（运行按钮 / 下拉 / 输入框…）」触发：不弹属性面板。
   *  用户已在卡上设定完成，点运行再弹面板既拖慢界面又造成干扰；点节点卡空白处恢复弹出。 */
  panelSuppressed: boolean;
  setPanelSuppressed: (v: boolean) => void;
}
export const useSmartCanvasUiStore = create<SmartUiState>((set) => ({
  pendingKind: null,
  setPendingKind: (pendingKind) => set({ pendingKind, createMenu: null }),
  createMenu: null,
  openCreateMenu: (createMenu) => set({ createMenu: { ...createMenu, openedAt: Date.now() }, pendingKind: null }),
  closeCreateMenu: () => set({ createMenu: null }),
  inspectorCollapsed: false,
  toggleInspector: () => set((s) => ({ inspectorCollapsed: !s.inspectorCollapsed })),
  dimFilter: '',
  setDimFilter: (dimFilter) => set({ dimFilter }),
  panel: null,
  setPanel: (panel) => set({ panel }),
  togglePanel: (p) => set((s) => ({ panel: s.panel === p ? null : p })),
  boxSelecting: false,
  setBoxSelecting: (boxSelecting) => set({ boxSelecting }),
  panelSuppressed: false,
  setPanelSuppressed: (panelSuppressed) => set({ panelSuppressed })
}));

/** 「运行全部」进度（拓扑顺序串行跑全图工作/ComfyUI/LLM 节点）。取消=软停（停止后续，不打断已发起的）。 */
interface SmartRunState {
  running: boolean;
  total: number;
  done: number;
  abort: boolean;
  start: (total: number) => void;
  tick: () => void;
  finish: () => void;
  requestAbort: () => void;
}
export const useSmartRunStore = create<SmartRunState>((set) => ({
  running: false,
  total: 0,
  done: 0,
  abort: false,
  start: (total) => set({ running: true, total, done: 0, abort: false }),
  tick: () => set((s) => ({ done: s.done + 1 })),
  finish: () => set({ running: false }),
  requestAbort: () => set({ abort: true })
}));

/** ── 自定义快捷键 ── */
/** 快捷键分区（设置弹窗按区分组展示，与「主工具栏 / 功能视图 / 导出保存」对齐） */
export const KEYBIND_CATEGORIES: Record<string, { label: string; order: number }> = {
  create: { label: '创建节点（底部工具坞）', order: 0 },
  file: { label: '文件 / 导出保存', order: 1 },
  edit: { label: '编辑', order: 2 },
  selection: { label: '选择与清除', order: 3 },
  view: { label: '视图', order: 4 },
  arrange: { label: '排布', order: 5 },
  align: { label: '对齐 / 均分', order: 6 },
  search: { label: '查找', order: 7 }
};
export const KEYBIND_ACTIONS: Array<{ id: string; label: string; category: string }> = [
  { id: 'add-image', label: '新建图片节点', category: 'create' },
  { id: 'add-prompt', label: '新建提示词节点', category: 'create' },
  { id: 'add-llm', label: '新建 LLM 节点', category: 'create' },
  { id: 'add-work', label: '新建生图节点', category: 'create' },
  { id: 'add-comfy', label: '新建 ComfyUI 节点', category: 'create' },
  { id: 'add-angle-prompt', label: '新建镜头节点', category: 'create' },
  { id: 'add-scale', label: '新建缩放节点', category: 'create' },
  { id: 'add-ratio', label: '新建尺寸节点', category: 'create' },
  { id: 'add-result', label: '新建结果节点', category: 'create' },
  { id: 'add-group', label: '新建分组节点', category: 'create' },
  { id: 'save', label: '保存 / 导出画布', category: 'file' },
  { id: 'undo', label: '撤销', category: 'edit' },
  { id: 'redo', label: '重做', category: 'edit' },
  { id: 'copy', label: '复制选中节点', category: 'edit' },
  { id: 'paste', label: '粘贴节点', category: 'edit' },
  { id: 'duplicate', label: '再制选中节点', category: 'edit' },
  { id: 'select-all', label: '全选节点', category: 'selection' },
  { id: 'deselect', label: '取消选择', category: 'selection' },
  { id: 'group-selection', label: '群组选中节点', category: 'selection' },
  { id: 'clear', label: '清空画布', category: 'selection' },
  { id: 'fit-view', label: '适配视图', category: 'view' },
  { id: 'arrange-grid', label: '网格排布', category: 'arrange' },
  { id: 'arrange-type', label: '按类型分组', category: 'arrange' },
  { id: 'arrange-smart', label: '智能排布', category: 'arrange' },
  { id: 'align-left', label: '左对齐（选中）', category: 'align' },
  { id: 'align-hcenter', label: '水平居中对齐（选中）', category: 'align' },
  { id: 'align-right', label: '右对齐（选中）', category: 'align' },
  { id: 'align-top', label: '顶对齐（选中）', category: 'align' },
  { id: 'align-vcenter', label: '垂直居中对齐（选中）', category: 'align' },
  { id: 'align-bottom', label: '底对齐（选中）', category: 'align' },
  { id: 'distribute-h', label: '横向均分（选中）', category: 'align' },
  { id: 'distribute-v', label: '纵向均分（选中）', category: 'align' },
  { id: 'search', label: '搜索节点', category: 'search' }
];
const DEFAULT_KEYS: Record<string, string> = {
  // 创建节点（底部工具坞）：Alt+数字 —— Alt 不改数字键值（comboFromEvent 取 e.key，稳定可靠），
  // 且与 App 主导航 Ctrl+1~6、Ctrl 系编辑键、Alt 方向键对齐 全不冲突。
  'add-image': 'alt+1',
  'add-prompt': 'alt+2',
  'add-llm': 'alt+3',
  'add-work': 'alt+4',
  'add-comfy': 'alt+5',
  'add-angle-prompt': 'alt+6',
  'add-scale': 'alt+7',
  'add-ratio': 'alt+8',
  'add-result': 'alt+9',
  'add-group': 'alt+0',
  save: 'ctrl+s',
  'select-all': 'ctrl+a',
  deselect: 'escape',
  'fit-view': 'ctrl+0',
  undo: 'ctrl+z',
  redo: 'ctrl+shift+z',
  copy: 'ctrl+c',
  paste: 'ctrl+v',
  duplicate: 'ctrl+d',
  'group-selection': 'ctrl+g',
  search: 'ctrl+f',
  // 对齐 / 分布 / 排布（Alt 系，避开纯方向键的「微调」与 Ctrl 系既有快捷键）
  'align-left': 'alt+arrowleft',
  'align-right': 'alt+arrowright',
  'align-top': 'alt+arrowup',
  'align-bottom': 'alt+arrowdown',
  'align-hcenter': 'alt+h',
  'align-vcenter': 'alt+v',
  'distribute-h': 'alt+shift+h',
  'distribute-v': 'alt+shift+v',
  'arrange-smart': 'alt+l'
};

/** 把 keydown 事件标准化成组合串，如 'ctrl+s' / 'escape' / 'ctrl+shift+g'。纯修饰键返回 ''。 */
export function comboFromEvent(e: KeyboardEvent): string {
  let k = e.key.toLowerCase();
  if (k === ' ') k = 'space';
  if (k === 'control' || k === 'meta' || k === 'shift' || k === 'alt') return '';
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('ctrl');
  if (e.shiftKey) parts.push('shift');
  if (e.altKey) parts.push('alt');
  parts.push(k);
  return parts.join('+');
}

interface KeybindState {
  bindings: Record<string, string>;
  setBinding: (id: string, combo: string) => void;
  reset: () => void;
}
export const useSmartKeybindStore = create<KeybindState>()(
  persist(
    (set) => ({
      bindings: { ...DEFAULT_KEYS },
      setBinding: (id, combo) =>
        set((s) => {
          const next: Record<string, string> = {};
          // 同一组合不重复绑定：清掉别处占用
          for (const [k, v] of Object.entries(s.bindings)) next[k] = combo && v === combo ? '' : v;
          next[id] = combo;
          return { bindings: next };
        }),
      reset: () => set({ bindings: { ...DEFAULT_KEYS } })
    }),
    {
      name: 'mengbi.smartCanvas.keys.v1',
      merge: (persisted, current) => {
        const p = persisted as Partial<KeybindState> | undefined;
        return { ...current, bindings: { ...current.bindings, ...(p?.bindings ?? {}) } };
      }
    }
  )
);
