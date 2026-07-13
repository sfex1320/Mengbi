/**
 * 智能画布（AI 创作节点画布）—— 跨文件共享类型（@shared/smartCanvas）。
 * 节点：图片 / 提示词 / 工作 / 结果 / 分组。与 /canvas 物理隔离（独立 store / css 前缀 mb-sc-*）。
 * 工作节点 provider 两档：mengbi（复用现有 api:image:generate）/ mock（Local Mock）。
 * 命名对齐 MVP 规格：image-generation / outpainting / video-generation / batch-process / continue-from-connections。
 */
import type { InputControl } from './comfyui';
import type { VideoMode, VideoTaskStatusState } from './video';

export type SmartNodeKind =
  | 'image'
  | 'prompt'
  | 'work'
  | 'result'
  | 'group'
  | 'llm'
  | 'comfy'
  | 'angle-prompt'
  | 'scale'
  | 'ratio'
  | 'text'
  | 'light'
  | 'palette'
  | 'compare'
  | 'video'
  | 'image-reverse'
  | 'video-source'
  | 'frame-interp'
  | 'video-clip'
  | 'storyboard'
  | 'character-card'
  | 'prompt-mall'
  | 'loop'
  | 'upscale'
  | 'vectorize'
  | 'folder-input'
  | 'folder-output'
  | 'segment'
  | 'proof';

export type WorkType =
  | 'image-generation' // 图片生成
  | 'image-edit' // 图片编辑
  | 'style-transfer' // 风格转换
  | 'outpainting' // 扩图
  | 'upscale' // 放大
  | 'video-generation' // 视频生成
  | 'batch-process'; // 批量处理

export type RunMode =
  | 'single' // 单次运行
  | 'batch' // 批量运行（多张）
  | 'serial' // 串行运行（下游依次）
  | 'loop' // 循环运行
  | 'continue-from-connections'; // 沿连线继续运行下游

/** 工作节点执行后端：mengbi=真实 api:image:generate；mock=Local Mock（占位模拟）。 */
export type WorkProvider = 'mengbi' | 'mock';

export type RunStatus = 'idle' | 'running' | 'success' | 'error';

/** 运行状态中文文案（UI 一律用此，不显示英文 idle/running/…）。 */
export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  idle: '待运行',
  running: '运行中',
  success: '已完成',
  error: '失败'
};

export const WORK_TYPE_LABELS: Record<WorkType, string> = {
  'image-generation': '图片生成',
  'image-edit': '图片编辑',
  'style-transfer': '风格转换',
  outpainting: '扩图',
  upscale: '放大',
  'video-generation': '视频生成',
  'batch-process': '批量处理'
};

export const RUN_MODE_LABELS: Record<RunMode, string> = {
  single: '单次运行',
  batch: '批量运行',
  serial: '串行运行',
  loop: '循环运行',
  'continue-from-connections': '沿连线继续'
};

export const PROVIDER_LABELS: Record<WorkProvider, string> = {
  mengbi: 'mengbi 绘画模型',
  mock: 'Local Mock'
};

/** WorkResult.provider 已放宽为 string（含 'comfyui'）；安全取展示名。 */
export function providerLabel(p: string): string {
  return (PROVIDER_LABELS as Record<string, string>)[p] ?? (p === 'comfyui' ? 'ComfyUI' : p);
}

/** provider=mengbi 时，仅这些工作类型走真实 api:image:generate；其余（放大/视频/批量）先模拟。 */
export const REAL_WORK_TYPES: ReadonlySet<WorkType> = new Set<WorkType>([
  'image-generation',
  'image-edit',
  'style-transfer',
  'outpainting'
]);

// ───────────────────────── 各节点 data ─────────────────────────

/** 所有节点共享的注释/标签元数据（可选）：自定义标签文字 + 颜色标识，用于分类与一眼区分。 */
export interface NodeMeta {
  /** 节点显示名称（属性面板标题用，如 IMG_01；空则回退到类型名 + 短 id） */
  name?: string;
  /** 节点标签 / 注释文字（展示在标题条下方的彩色小条） */
  label?: string;
  /** 标签颜色（CSS 颜色值，取主题 token 之一；空 = 用默认 accent） */
  labelColor?: string;
  /** 备注（多行，属性面板展示，最长 200 字） */
  notes?: string;
  /** 创建时间戳（addNode 时打；属性面板「创建时间」展示） */
  createdAt?: number;
  /** true=用户手动调整过尺寸 → 自适应让位手动（不再自动放缩）。拖 NodeResizer 时由 onNodesChange 自动置位；
   *  右键「恢复自适应大小」清除。优先级：手动 > 自适应。 */
  manualSize?: boolean;
  /** true=节点被跳过（Alt+点击切换）：灰显；运行全部/链式补跑/循环驱动/cascade 一律绕过它，
   *  且它自己的产出**不再喂下游**——computeUpstream 走透传（= ComfyUI Bypass 语义：
   *  它的上游直接穿过去，2026-07-14 起）。卡上按钮直跑不受限。 */
  skipped?: boolean;
}

export interface ImageNodeData extends NodeMeta {
  /** 本地绝对路径或 data:URI（单图模式） */
  src?: string;
  name?: string;
  naturalW?: number;
  naturalH?: number;
  /**
   * 局部重绘/扩图遮罩（OpenAI「透明=编辑区、不透明=保留」PNG，dataURI；externalize 后为磁盘路径）。
   * 在图片编辑器里「画遮罩→设为重绘遮罩」或「AI 扩图」时产出，与 src 同尺寸。
   * 下游生图节点检测到它 → 走 /v1/images/edits 带 mask 做服务端局部重绘（见 runWorkNode）。
   * 仅单图模式有意义；任何改变像素/尺寸的编辑都应清掉它（避免与底图错位）。
   */
  inpaintMaskSrc?: string;
  /**
   * 「人类可见」的红色半透明标注层（PNG，dataURI；externalize 后为磁盘路径），与 src 同尺寸。
   * 与 inpaintMaskSrc 同时产出：画笔蒙版区 / AI 扩图的新区（边缘）显红，叠在节点封面上
   * 让用户直观看到「蒙版画了哪些区域 / 扩了多少边」。纯展示，不参与生图。清蒙版时一并清。
   */
  maskOverlaySrc?: string;
  /** AI 扩图时各边新增的像素（节点上显示「扩了多少边」的小标签）；非扩图编辑应清掉 */
  outpaintPad?: { top: number; right: number; bottom: number; left: number };
  /**
   * 最初始图片（首次进图片编辑器前的 src）。编辑器首次「保存」时写入并永不覆盖；
   * 「重置」据此回到最初状态（即使中途扩图/画笔/蒙版保存过多次）。externalize 后为磁盘路径。
   */
  originalSrc?: string;
  // ── 列表模式（2026-06-13）：一个图片节点持有多张图，可增删 / 批量导入；
  //    可设「每批向下游传入几张」并自驱逐批跑下游（也可连「循环」节点由其驱动）。──
  /** true=列表模式（多图）；缺省/false=单图模式（src） */
  listMode?: boolean;
  /** 列表模式下的多张图（本地绝对路径 / data:URI），按顺序（= 九宫格格子顺序 = 传下游的图序） */
  srcs?: string[];
  /**
   * 九宫格「跳过」的格子下标（2026-07-11，Alt+点击置灰）：这些图不传下游、不占序号
   * （角标序号 = 实际传下游的序号，由 src/lib/imageListOrder.ts 统一换算）。
   * 重排/插入/删除时下标必须跟着图重映射——一律走 imageListOrder 的纯函数改，别手写 splice。
   */
  disabledIdx?: number[];
  /** 每次向下游传入几张（逐批驱动时用；0/空 = 全部一次）。UI 已下线（2026-07-11 九宫格化），字段休眠保留 */
  batchSize?: number;
  // ── 自驱逐批运行态（与循环节点同义，复用共享迭代器；持久化无害）──
  //    2026-07-11：节点上的自驱按钮/每批张数 UI 已下线（批量驱动交给「循环」节点），字段休眠保留兼容旧档。
  runStatus?: RunStatus | 'paused';
  /** 当前批序号（0 起） */
  batchIndex?: number;
  totalBatches?: number;
  doneCount?: number;
  failCount?: number;
  runLogs?: string[];
  runError?: string | null;
  /** 自驱逐批运行中「当前批」的图（运行中 computeUpstream 优先读它，否则读全部 srcs） */
  outBatch?: string[];
}

export interface PromptNodeData extends NodeMeta {
  /** 单条模式的提示词文本 */
  text: string;
  // ── 列表模式（2026-06-13）：持有多条提示词，每条作为独立上游提示词（配合「多条提示词逐条生图」）──
  /** true=列表模式（多条）；缺省/false=单条模式（text） */
  listMode?: boolean;
  /** 列表模式下的多条提示词，按顺序 */
  items?: string[];
  /** 列表模式下每个输入框的统一高度（px）；改一个 = 所有条目一起变（Shift 拖动单独调；空=默认） */
  listItemHeight?: number;
  // ── 统一提示词 / 前置提示词（2026-06-24）：多段提示词逐条生图时，统一提示词会拼进每一段，
  //    避免在每个框里重复输入同样的内容，形成规范性。──
  /** 统一提示词文本（夹在每段提示词的前/后/两侧） */
  unifiedPrompt?: string;
  /** 统一提示词拼接位置：'prefix'=放每段前 / 'suffix'=放每段后 / 'both'=前后都放（缺省=prefix） */
  unifiedPos?: 'prefix' | 'suffix' | 'both';
}

/** 上游输入引用（运行时从连线收集的快照，仅用于展示） */
export interface InputRef {
  kind: 'image' | 'prompt' | 'result';
  /** 来源节点 id */
  from: string;
  /** 简短预览（图片名 / 提示词片段），不放大图 data:URI 以免膨胀 */
  preview?: string;
}

export interface WorkNodeData extends NodeMeta {
  workType: WorkType;
  runMode: RunMode;
  /** 执行后端：mengbi（真实）/ mock（Local Mock） */
  provider: WorkProvider;
  /** 绘画模型显示名（provider=mengbi 时用，复用 settingsStore 配置） */
  modelId: string;
  /** 当前任务提示词（与上游提示词节点合并） */
  prompt: string;
  /** 负向提示词（不想要的内容）；作为 image:generate 的 negativePrompt 顶层字段发出 */
  negativePrompt?: string;
  /** 随机种子；null/负 = 随机。loop 模式按轮次 +i 递增。文生图/图生图都透传 */
  seed?: number | null;
  /** 批量张数 1-4 */
  n: number;
  /** 比例（如 '1:1'）；空 = 不指定。按 family.supportedAspects 自适应 */
  aspect?: string;
  /** 「自动」比例的解析结果：aspect 为空且有输入图时，运行时量首张输入图（含扩图后的尺寸）得到的实际比例，回写供节点展示。 */
  autoAspect?: string;
  /** 分辨率档位 '1K'|'2K'|'4K'；空 = 默认。按 family.supportedTiers 自适应 */
  imageSize?: string;
  /** 质量 'standard'|'high'…；family.supportsQuality 时可用 */
  quality?: string;
  /** 绘画强度 0-1（img2img/重绘；仅 ComfyUI 等支持的后端生效，OpenAI 协议忽略） */
  strength?: number;
  /** 多条上游提示词连入时的执行方式：false/缺省=按连入顺序逐条生图；true=并发提交（中转站支持并发时更快）。
   *  分组内的多条提示词组合后算作一条，不受此影响。 */
  promptConcurrency?: boolean;
  /** 逐张处理输入图（2026-06-13）：true=每张上游图各跑一次生成（N 张图 = N 次结果，配合图片列表/批量改图）；
   *  缺省/false=多张图作为一组参考图喂给一次生成。仅图片编辑类工作（非纯文生图）有意义。
   *  与多条提示词配合：词数==图数时按序配对（zip），否则每张都用同一条提示词。 */
  imageEach?: boolean;
  /** 上次运行收集到的上游输入引用 */
  inputRefs: InputRef[];
  status: RunStatus;
  result?: WorkResult | null;
  /** 运行日志（与 result.logs 镜像，作为显式字段便于检查器展示） */
  logs: string[];
  /** 错误信息（与 result.error 镜像） */
  error?: string | null;
  /** 进行中任务 id（匹配 image:done） */
  taskId?: number;
  /** 输出格式偏好（''=系统自动 / 'png' / 'jpeg' / 'webp'）；属性面板控制，后续接生成管线 */
  outputFormat?: string;
  /** 最近一次运行的时间戳（runWithUpstream 起跑时打；属性面板「最后运行」展示） */
  lastRunAt?: number;
  /** Mock 真实化（provider='mock' 时生效）：随机延迟下限（ms），默认 200 */
  mockDelayMin?: number;
  /** Mock 随机延迟上限（ms），默认 800 */
  mockDelayMax?: number;
  /** Mock 随机失败概率 0-1，默认 0（用于联调错误分支 / loading 动画） */
  mockErrorRate?: number;
}

export interface ResultNodeData extends NodeMeta {
  result?: WorkResult | null;
}

export interface GroupNodeData extends NodeMeta {
  title: string;
  /** 折叠：隐藏组内子节点 + 收起高度（大图整理用） */
  collapsed?: boolean;
  /** 折叠前的高度，展开时还原（运行态字段，序列化无害） */
  prevHeight?: number;
}

// ───────────────────────── LLM / 对话节点 ─────────────────────────
// 文本模型处理：优化提示词 / 翻译 / 扩写 / 细节分解 / 对话完善 / 图片反推。
// 复用 api:chat:optimize-prompt（文本→文本）+ api:lab:reverse（图→提示词）。

export type LlmOp =
  | 'optimize' // 优化提示词
  | 'translate-en' // 翻译成英文
  | 'translate-zh' // 翻译成中文
  | 'expand' // 扩写细化
  | 'decompose' // 细节分解
  | 'refine' // 对话完善
  | 'script' // 剧本创作（多素材：人物/场景/故事 → 完整剧本，2026-07-12）
  | 'reverse' // 图片反推提示词（需 vision 文本模型）
  | 'to-json'; // 自然语言 → JSON 结构化提示词

export const LLM_OP_LABELS: Record<LlmOp, string> = {
  optimize: '优化提示词',
  'translate-en': '翻译成英文',
  'translate-zh': '翻译成中文',
  expand: '扩写细化',
  decompose: '细节分解',
  refine: '对话完善',
  script: '剧本创作',
  reverse: '图片反推提示词',
  'to-json': '转 JSON 提示词'
};

/** op 的一句话副标（图标网格的 sub / tooltip）——选择时一眼看懂每个操作做什么。 */
export const LLM_OP_SUBS: Record<LlmOp, string> = {
  optimize: '改写成高质量提示词',
  'translate-en': '中文 → 英文',
  'translate-zh': '英文 → 中文',
  expand: '补足细节更丰富',
  decompose: '拆成结构化要素',
  refine: '打磨得清晰可执行',
  script: '多素材（人物/场景/故事）→ 完整剧本',
  reverse: '图 → 提示词（视觉）',
  'to-json': '转结构化 JSON'
};

/** 需要上游图片的 LLM 操作（vision） */
export const LLM_IMAGE_OPS: ReadonlySet<LlmOp> = new Set<LlmOp>(['reverse']);

// ── 输出用途 / 意图（2026-07-11 LLM 节点重做）──
// 痛点：优化提示词时模型不知道「优化给谁用、要达到什么目的」，输出对不上路。
// purpose=输出面向的目标（生图/视频/角色/场景），intent=一句话意图；
// 二者在运行时注入 systemPrompt（仅 LLM_PURPOSE_OPS 文本类操作生效——翻译/反推保持本义不注入）。

export type LlmPurpose = 'free' | 'image' | 'video' | 'character' | 'scene';

export const LLM_PURPOSE_LABELS: Record<LlmPurpose, string> = {
  free: '自由',
  image: '生图提示词',
  video: '视频提示词',
  character: '角色设定',
  scene: '场景描述'
};

/** 吃 purpose/intent 注入的文本类操作（翻译要忠实原文、反推走 lab.reverse，均不注入用途）。 */
export const LLM_PURPOSE_OPS: ReadonlySet<LlmOp> = new Set<LlmOp>([
  'optimize',
  'expand',
  'decompose',
  'refine',
  'to-json'
]);

/** LLM 节点内置流式聊天的一条消息 */
export interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
}

export interface LlmNodeData extends NodeMeta {
  /** 节点的两块：node=单次操作（优化/翻译/反推…）；chat=流式对话 */
  mode: 'node' | 'chat';
  op: LlmOp;
  /** 文本模型显示名（复用 settingsStore type='text' 配置） */
  modelId: string;
  /** 额外指令（追加到 systemPrompt） */
  instruction: string;
  /** 开启后：上游连入的提示词文本作为「额外指令」（注入 systemPrompt），而非作为待处理文本（userInput）。 */
  instructionFromUpstream?: boolean;
  /** 本节点输入文本（与上游文本合并） */
  input: string;
  /** reverse 时的反推类型 */
  reverseType: 'description' | 'tags' | 'style';
  /** 输出用途（additive 可选，缺省 'free'=不注入用途导向，保持旧行为） */
  purpose?: LlmPurpose;
  /** 一句话意图：本次要达到什么效果（如「电商主图、突出金属质感、白底」），注入 systemPrompt 让改写围绕它 */
  intent?: string;
  status: RunStatus;
  /** 生成的文本输出（喂给下游工作/LLM 节点作提示词） */
  resultText?: string;
  logs: string[];
  error?: string | null;
  // ── 流式聊天块 ──
  /** 该节点的会话 id（懒创建） */
  conversationId?: string;
  chatMessages: ChatMsg[];
  /** 助手是否正在流式回复 */
  chatStreaming?: boolean;
}

// ───────────────────────── ComfyUI 节点 ─────────────────────────
// 绑定「工作流」模块保存的模板（api:comfyui:run-single + template:get），
// 简化成：选模板 + 在检查器里改暴露的标量控件 + 运行 → 输出图喂下游。

/** ComfyUI 节点多输入运行方式：merge=单次（现状：多提示词分发/合并到文本控件、多图按序进图片控件）；
 *  per-prompt=逐条提示词执行（每条单独跑一遍完整工作流，第一条完成后再跑第二条）；
 *  per-image=逐张图执行（工作流只有一个图片输入位时，N 张图逐张各跑一遍）。 */
export type ComfyMultiMode = 'merge' | 'per-prompt' | 'per-image';

export const COMFY_MULTI_MODE_LABELS: Record<ComfyMultiMode, string> = {
  merge: '单次（合并分发）',
  'per-prompt': '逐条提示词执行',
  'per-image': '逐张图执行'
};

/** 上游输入 → 指定控件的显式绑定（缺省 = 自动按序分发）：
 *  prompt:i = 该控件收上游第 i 条提示词；image:j = 收上游第 j 张图；
 *  all-images = 收全部上游图（multi_image 控件）；off = 不接收上游（保留手填/工作流默认）。 */
export type ComfyInputBinding =
  | { kind: 'prompt'; index: number }
  | { kind: 'image'; index: number }
  | { kind: 'mask'; index: number }
  | { kind: 'all-images' }
  | { kind: 'off' };

export interface ComfyNodeData extends NodeMeta {
  /** 绑定的工作流模板 id（comfyui_workflow_templates.workflowId） */
  workflowId: string;
  templateName: string;
  /** 模板暴露的输入控件快照（用于检查器渲染） */
  controls: InputControl[];
  /** controlId → 覆盖值 */
  controlValues: Record<string, unknown>;
  /** 多输入运行方式；缺省 'merge' = 现状单次 */
  multiMode?: ComfyMultiMode;
  /** controlId → 上游输入显式绑定；缺省 = 全自动按序分发 */
  inputBindings?: Record<string, ComfyInputBinding>;
  status: RunStatus;
  /** 进行中的 comfyui runId（匹配 comfyui:run-done） */
  runId?: string;
  result?: WorkResult | null;
  logs: string[];
  error?: string | null;
}

// ───────────────────────── 镜头节点（angle-prompt，原「视角」升级）─────────────────────────
// 接入一张图片 → 3D 预览 + 镜头语言控制（拍照：相机/光圈/视角/构图；视频：运镜/焦距/构图）
// → 实时生成镜头提示词，作文本输出喂下游。不直接生成图片；3D 预览仅用于交互展示。

/** 拍照 / 视频 两种镜头模式。 */
export type CameraMode = 'photo' | 'video';

/** 相机机型（拍照模式）。 */
export type CameraType =
  | 'none' | 'dslr' | 'mirrorless' | 'film35' | 'mediumformat' | 'polaroid' | 'phone' | 'cinema' | 'drone' | 'action';
/** 光圈（拍照模式，决定景深虚化）。 */
export type ApertureSetting = 'none' | 'f1.4' | 'f2.8' | 'f4' | 'f8' | 'f16';
/** 运镜方式（视频模式）。2026-07-14 补全：升降直移 / 光学变焦推拉 / 甩镜。 */
export type CameraMovement =
  | 'none' | 'push' | 'pull' | 'panleft' | 'panright' | 'tiltup' | 'tiltdown'
  | 'truck' | 'pedestal' | 'orbit' | 'handheld' | 'crane' | 'dollyzoom'
  | 'zoomin' | 'zoomout' | 'whippan' | 'tracking' | 'static';
/** 焦距（视频模式）。2026-07-14 补全：鱼眼 / 移轴。 */
export type FocalLength = 'none' | 'fisheye' | 'ultrawide' | 'wide' | 'standard' | 'tele' | 'macro' | 'tiltshift';
/** 构图（两种模式通用）。2026-07-14 补全：过肩 / 主观视角(POV)。 */
export type ShotComposition =
  | 'none' | 'thirds' | 'centered' | 'symmetry' | 'diagonal' | 'leadinglines' | 'frameinframe' | 'golden' | 'fill' | 'negative'
  | 'ots' | 'pov';
/** 景别 / 景构（两种模式通用）：从超远景到大特写的取景范围。 */
export type ShotSize =
  | 'none' | 'extreme-long' | 'long' | 'full' | 'full-body' | 'medium' | 'medium-close' | 'close' | 'closeup' | 'extreme-closeup';

export const CAMERA_TYPE_LABELS: Record<CameraType, string> = {
  none: '未指定',
  dslr: '单反相机',
  mirrorless: '微单',
  film35: '35mm 胶片',
  mediumformat: '中画幅',
  polaroid: '拍立得',
  phone: '手机摄影',
  cinema: '电影摄影机',
  drone: '无人机航拍',
  action: '运动相机'
};
export const CAMERA_TYPE_ICON: Record<CameraType, string> = {
  none: '○', dslr: '📷', mirrorless: '📸', film35: '🎞️', mediumformat: '🎴', polaroid: '🖼️',
  phone: '📱', cinema: '🎥', drone: '🚁', action: '🤿'
};
export const APERTURE_LABELS: Record<ApertureSetting, string> = {
  none: '未指定', 'f1.4': 'f/1.4', 'f2.8': 'f/2.8', 'f4': 'f/4', 'f8': 'f/8', 'f16': 'f/16'
};
/** 光圈副标（景深效果）。 */
export const APERTURE_SUB: Record<ApertureSetting, string> = {
  none: '', 'f1.4': '强虚化', 'f2.8': '浅景深', 'f4': '中景深', 'f8': '深景深', 'f16': '全清晰'
};
/** 光圈图标：用不同填充的圆示意光圈开口（大→小）。 */
export const APERTURE_ICON: Record<ApertureSetting, string> = {
  none: '○', 'f1.4': '◉', 'f2.8': '◎', 'f4': '⊙', 'f8': '◌', 'f16': '∘'
};
export const MOVEMENT_LABELS: Record<CameraMovement, string> = {
  none: '未指定',
  push: '推镜（推近）',
  pull: '拉镜（拉远）',
  panleft: '左摇',
  panright: '右摇',
  tiltup: '上摇',
  tiltdown: '下摇',
  truck: '横移',
  pedestal: '升降直移',
  orbit: '环绕',
  handheld: '手持跟随',
  crane: '升降摇臂',
  dollyzoom: '滑动变焦',
  zoomin: '变焦推近',
  zoomout: '变焦拉远',
  whippan: '甩镜',
  tracking: '跟拍',
  static: '固定机位'
};
export const MOVEMENT_ICON: Record<CameraMovement, string> = {
  none: '○', push: '🔎', pull: '🔭', panleft: '⬅️', panright: '➡️', tiltup: '⬆️', tiltdown: '⬇️',
  truck: '↔️', pedestal: '↕️', orbit: '🔄', handheld: '🤳', crane: '🏗️', dollyzoom: '🌀',
  zoomin: '➕', zoomout: '➖', whippan: '💨', tracking: '🏃', static: '⏹️'
};
export const FOCAL_LABELS: Record<FocalLength, string> = {
  none: '未指定', fisheye: '鱼眼', ultrawide: '超广角', wide: '广角', standard: '标准', tele: '长焦', macro: '微距', tiltshift: '移轴'
};
export const FOCAL_SUB: Record<FocalLength, string> = {
  none: '', fisheye: '8mm 球面', ultrawide: '14mm', wide: '24mm', standard: '50mm', tele: '85-200mm', macro: '微距', tiltshift: '微缩感'
};
export const FOCAL_ICON: Record<FocalLength, string> = {
  none: '○', fisheye: '🐟', ultrawide: '🌐', wide: '🏞️', standard: '👁️', tele: '🔭', macro: '🔬', tiltshift: '🏘️'
};
export const COMPOSITION_LABELS: Record<ShotComposition, string> = {
  none: '未指定',
  thirds: '三分法',
  centered: '中心构图',
  symmetry: '对称构图',
  diagonal: '对角线',
  leadinglines: '引导线',
  frameinframe: '框中框',
  golden: '黄金螺旋',
  fill: '充满画面',
  negative: '留白构图',
  ots: '过肩镜头',
  pov: '主观视角'
};
export const COMPOSITION_ICON: Record<ShotComposition, string> = {
  none: '○', thirds: '#️⃣', centered: '🎯', symmetry: '🪞', diagonal: '⤢', leadinglines: '🛤️',
  frameinframe: '🖼️', golden: '🌀', fill: '🔳', negative: '⬜', ots: '🫂', pov: '👀'
};
export const SHOT_SIZE_LABELS: Record<ShotSize, string> = {
  none: '未指定',
  'extreme-long': '超远景',
  long: '远景',
  full: '全景',
  'full-body': '全身',
  medium: '中景',
  'medium-close': '中近景',
  close: '近景',
  closeup: '特写',
  'extreme-closeup': '大特写'
};
/** 景别副标（取景范围提示）。 */
export const SHOT_SIZE_SUB: Record<ShotSize, string> = {
  none: '',
  'extreme-long': '宏大空间',
  long: '环境关系',
  full: '全身带景',
  'full-body': '头到脚',
  medium: '腰部以上',
  'medium-close': '胸部以上',
  close: '头肩部',
  closeup: '面部局部',
  'extreme-closeup': '眼睛细节'
};

export interface AnglePromptNodeData extends NodeMeta {
  /** 手动上传的图（上游图片优先；本字段为兜底）。url = 本地路径或 data:URI */
  inputImage?: { url: string; name?: string };
  /** 镜头模式：拍照 / 视频（旧数据缺省按 'photo'） */
  camMode?: CameraMode;
  /** 水平旋转 -90~90，0 默认；>0 向右 / <0 向左 */
  horizontalAngle: number;
  /** 垂直俯仰 -90~90，0 默认；>0 俯视 / <0 仰视 */
  verticalAngle: number;
  /** 镜头距离 0.1~8，4 默认；>4 广角 / <4 特写 */
  distance: number;
  /** 相机机型（拍照模式） */
  cameraType?: CameraType;
  /** 光圈（拍照模式） */
  aperture?: ApertureSetting;
  /** 运镜（视频模式） */
  movement?: CameraMovement;
  /** 焦距（视频模式） */
  focal?: FocalLength;
  /** 构图（两种模式通用） */
  composition?: ShotComposition;
  /** 景别 / 景构（两种模式通用）：超远景～大特写的取景范围 */
  shotSize?: ShotSize;
  /** 实时生成的镜头提示词（文本输出，下游可读） */
  generatedPrompt: string;
  /** 是否追加「保持主体一致，只改镜头」约束句 */
  appendConsistencyInstruction: boolean;
}

// ───────────────────────── 缩放 / 预处理节点（scale）─────────────────────────
// 对上游图片做缩小/放大预处理（非高清化）：解决模型输入图过大、或图太小达不到效果。
// 实时计算（renderer canvas），输出新图喂下游。

export type ScaleMode =
  | 'factor' // 倍数缩放（等比）
  | 'longest' // 最长边 = N px（等比）
  | 'shortest' // 最短边 = N px（等比）
  | 'width' // 按宽 = N px（等比）
  | 'height' // 按高 = N px（等比）
  | 'fit' // 限制在 宽×高 框内（等比，不放大可选）
  | 'pixels' // 总像素 ≈ N 百万像素（等比）
  | 'exact'; // 精确 宽×高（keepAspect 决定是否等比）

export const SCALE_MODE_LABELS: Record<ScaleMode, string> = {
  factor: '倍数缩放',
  longest: '最长边',
  shortest: '最短边',
  width: '按宽',
  height: '按高',
  fit: '限制框内',
  pixels: '总像素',
  exact: '精确尺寸'
};

export interface ScaleNodeData extends NodeMeta {
  mode: ScaleMode;
  /** 倍数（mode='factor'，0.1–8） */
  factor: number;
  /** 单边像素（longest/shortest/width/height） */
  edge: number;
  /** 限制/精确 宽×高 */
  fitW: number;
  fitH: number;
  /** 总像素百万（mode='pixels'） */
  megapixels: number;
  /** exact 模式是否等比（true=按 fit 内缩放，false=强制拉伸到 fitW×fitH） */
  keepAspect: boolean;
  /** 仅缩小不放大（fit/longest 等防止把小图硬拉大失真） */
  noUpscale: boolean;
  format: 'png' | 'jpeg' | 'webp';
  /** 计算输出（dataURI；不持久化，挂载/上游变化时重算） */
  outputImage?: string;
  /** 输出尺寸（展示用） */
  outW?: number;
  outH?: number;
  /** 输入尺寸（展示用） */
  inW?: number;
  inH?: number;
  // ── 视频缩放（上游为视频时；主进程 ffmpeg 重编码，异步） ──
  /** 缩放后输出视频本地路径（ffmpeg 产出，非持久化） */
  outputVideo?: string | null;
  /** 视频缩放运行状态 */
  vidStatus?: RunStatus;
  vidError?: string | null;
  /** 视频补帧目标帧率（0/缺省 = 保持原帧率；30/48/60 = minterpolate 运动补偿插帧，慢但更流畅） */
  vidFps?: number;
}

// ───────────────────────── 尺寸来源节点（ratio）─────────────────────────
// 可选接一张图 → 显示其比例 + 各分辨率档（1K/2K/4K）下的实际像素（分析参考）；
// 同时作为「尺寸来源」：选预设尺寸 / 填自定义宽高 → 输出 SizeSpec 给 生图/ComfyUI/视频 节点统一驱动尺寸。

/** 尺寸来源节点的输出意图：both=比例+尺寸都喂下游；aspect=只喂比例；resolution=只喂尺寸/分辨率。 */
export type RatioEmit = 'both' | 'aspect' | 'resolution';

/** 尺寸来源节点的统一输出：比例 + 精确宽高（像素）+ 输出意图。下游各取所需：
 *  生图取比例(+能精确宽高的模型用宽高/否则映射档位)、视频取比例+最近分辨率档、ComfyUI 取宽×高；
 *  emit 决定只喂比例 / 只喂尺寸 / 两者。 */
export interface SizeSpec {
  aspect: string;
  width: number;
  height: number;
  emit?: RatioEmit;
}

export type RatioSizeMode = 'preset' | 'custom' | 'original';

export interface RatioNodeData extends NodeMeta {
  /** 尺寸来源：预设（比例 + 分辨率档）/ 自定义宽高 / 原尺寸（取连接图的原始宽高与比例，默认 preset）。 */
  sizeMode: RatioSizeMode;
  /** preset 模式：选中的比例（如 '16:9'）。 */
  aspect: string;
  /** preset 模式：选中的分辨率档（'1K'…'8K'，最长边约定）。 */
  tier: string;
  /** custom 模式：自定义宽（px）。 */
  customW: number;
  /** custom 模式：自定义高（px）。 */
  customH: number;
  /** 输出意图：只比例 / 只分辨率 / 两者。 */
  emit: RatioEmit;
  /** original 模式用：上游连接图的原始宽（px）。由 RatioNode 分析图片后回写持久化；无图时缺省。 */
  origW?: number;
  /** original 模式用：上游连接图的原始高（px）。 */
  origH?: number;
}

// ───────────────────────── 文字节点（text）─────────────────────────
// 画布上的自由文字元素（标题 / 备注 / 标注），可调字体、字号、颜色、粗细、对齐。
// 纯画布注释，不参与生成（无输入 / 输出连接口）。

export type TextAlign = 'left' | 'center' | 'right';

export interface TextNodeData extends NodeMeta {
  text: string;
  /** 字体（CSS font-family；预设见 TEXT_FONTS） */
  fontFamily: string;
  /** 字号 px */
  fontSize: number;
  /** 颜色（CSS 颜色；空 = 跟随主题文字色） */
  color?: string;
  bold?: boolean;
  italic?: boolean;
  align?: TextAlign;
}

/** 文字节点字体预设（值即 CSS font-family）。 */
export const TEXT_FONTS: Array<{ label: string; value: string }> = [
  { label: '系统默认', value: '' },
  { label: '无衬线 Sans', value: "'Inter', system-ui, -apple-system, sans-serif" },
  { label: '衬线 Serif', value: "Georgia, 'Times New Roman', serif" },
  { label: '等宽 Mono', value: "'JetBrains Mono', 'Consolas', monospace" },
  { label: '黑体', value: "'Microsoft YaHei', 'PingFang SC', sans-serif" },
  { label: '宋体', value: "'SimSun', 'Songti SC', serif" },
  { label: '楷体', value: "'KaiTi', 'Kaiti SC', serif" }
];

// ───────────────────────── 光源节点（light）─────────────────────────
// 接入一张图 → 圆顶预览 + 拖光点调光照方位/高度 + 强度/色温/遮挡/光效 → 实时生成光照提示词喂下游。
// 与视角节点同类（不直接生成图片，输出文本）。

export type LightOcclusion =
  | 'none' | 'leaves' | 'window' | 'blinds' | 'branches' | 'curtain'
  | 'caustics' | 'lace' | 'foliage' | 'grid' | 'smoke';
export type LightEffect =
  | 'none' | 'tyndall' | 'fog' | 'godrays' | 'backlight' | 'flare'
  | 'bokeh' | 'bloom' | 'hardshadow' | 'dappled' | 'silhouette';

export const LIGHT_OCCLUSION_LABELS: Record<LightOcclusion, string> = {
  none: '无遮挡',
  leaves: '树叶光斑',
  window: '窗格',
  blinds: '百叶窗',
  branches: '树枝',
  curtain: '薄纱窗帘',
  caustics: '水面波光',
  lace: '蕾丝镂空',
  foliage: '密林剪影',
  grid: '几何格栅',
  smoke: '烟雾缝隙'
};
/** 遮挡图标（直观示意，下拉/按钮里带图标，小白也能看懂视觉感觉）。 */
export const LIGHT_OCCLUSION_ICON: Record<LightOcclusion, string> = {
  none: '○',
  leaves: '🌳',
  window: '🪟',
  blinds: '🎚️',
  branches: '🌿',
  curtain: '🎐',
  caustics: '💧',
  lace: '🕸️',
  foliage: '🌲',
  grid: '🔲',
  smoke: '🌫️'
};
export const LIGHT_EFFECT_LABELS: Record<LightEffect, string> = {
  none: '无',
  tyndall: '丁达尔体积光',
  fog: '穿过雾气',
  godrays: '上帝之光',
  backlight: '逆光轮廓',
  flare: '镜头光晕',
  bokeh: '背景散景',
  bloom: '柔光辉光',
  hardshadow: '硬朗阴影',
  dappled: '斑驳光影',
  silhouette: '强逆光剪影'
};
export const LIGHT_EFFECT_ICON: Record<LightEffect, string> = {
  none: '○',
  tyndall: '🔆',
  fog: '🌫️',
  godrays: '⛅',
  backlight: '🌓',
  flare: '✨',
  bokeh: '🟡',
  bloom: '💫',
  hardshadow: '◐',
  dappled: '🍃',
  silhouette: '🌑'
};

/** 光源类型（这束光从何而来：阳光 / 朝阳夕阳 / 烛光灯笼 / 霓虹影棚 …）。 */
export type LightSourceType =
  | 'none' | 'sunlight' | 'sunrise' | 'sunset' | 'goldenhour' | 'overcast'
  | 'moonlight' | 'candle' | 'lantern' | 'firelight' | 'neon' | 'studio' | 'daylight' | 'street' | 'screen';

export const LIGHT_SOURCE_LABELS: Record<LightSourceType, string> = {
  none: '未指定',
  sunlight: '阳光（直射）',
  sunrise: '朝阳 / 晨光',
  sunset: '夕阳 / 黄昏',
  goldenhour: '黄金时刻',
  overcast: '阴天柔光',
  moonlight: '月光',
  candle: '烛光',
  lantern: '灯笼光',
  firelight: '火光 / 篝火',
  neon: '霓虹灯',
  studio: '影棚灯',
  daylight: '窗边自然光',
  street: '路灯',
  screen: '屏幕光'
};
export const LIGHT_SOURCE_ICON: Record<LightSourceType, string> = {
  none: '○',
  sunlight: '☀️',
  sunrise: '🌅',
  sunset: '🌇',
  goldenhour: '🌄',
  overcast: '☁️',
  moonlight: '🌙',
  candle: '🕯️',
  lantern: '🏮',
  firelight: '🔥',
  neon: '💡',
  studio: '🎬',
  daylight: '🪟',
  street: '🛣️',
  screen: '📱'
};

/** 光位快捷预设：一键设好方位角 + 高度角（常见布光），节点上以带图标的按钮呈现。 */
export interface LightPositionPreset {
  key: string;
  label: string;
  icon: string;
  azimuth: number;
  elevation: number;
}
export const LIGHT_POSITION_PRESETS: LightPositionPreset[] = [
  { key: 'front', label: '正面光', icon: '🔦', azimuth: 0, elevation: 30 },
  { key: 'left', label: '左侧光', icon: '◀️', azimuth: -75, elevation: 28 },
  { key: 'right', label: '右侧光', icon: '▶️', azimuth: 75, elevation: 28 },
  { key: 'rembrandt', label: '伦勃朗 45°', icon: '🎭', azimuth: -45, elevation: 52 },
  { key: 'top', label: '顶光', icon: '🔝', azimuth: 0, elevation: 85 },
  { key: 'butterfly', label: '蝴蝶光', icon: '🦋', azimuth: 0, elevation: 68 },
  { key: 'back', label: '逆光', icon: '🌗', azimuth: 180, elevation: 25 },
  { key: 'rim', label: '轮廓侧逆光', icon: '⭐', azimuth: 140, elevation: 32 },
  { key: 'bottom', label: '底光（脚光）', icon: '🔻', azimuth: 0, elevation: 6 }
];

export interface LightNodeData extends NodeMeta {
  /** 手动上传的图（上游图片优先；本字段为兜底）。 */
  inputImage?: { url: string; name?: string };
  /** 方位角 -180~180（0=正前 / 90=右 / 180=正后逆光 / -90=左） */
  azimuth: number;
  /** 高度角 0~90（0=地平线 / 90=头顶） */
  elevation: number;
  /** 强度 0~100 */
  intensity: number;
  /** 色温 -100(冷)~100(暖) */
  warmth: number;
  occlusion: LightOcclusion;
  effect: LightEffect;
  /** 光源类型（阳光 / 朝阳夕阳 / 烛光灯笼 …）；旧数据缺省按 'none' 处理 */
  sourceType?: LightSourceType;
  /** 实时生成的光照提示词（文本输出，下游可读） */
  generatedPrompt: string;
  /** 是否追加「保持主体一致，只改光照」约束句 */
  appendConsistencyInstruction: boolean;
  /** 光点在预览图上的可视位置（0~1，相对图片左上角）。用于直接「在图上拖光点」交互；
   *  azimuth/elevation 由它推导出来喂提示词。旧数据缺省时按 azimuth/elevation 反推渲染。 */
  posX?: number;
  posY?: number;
}

// ───────────────────────── 配色工具节点（palette）─────────────────────────
// 提取模式：接上游图（或卡上上传）→ 中位切分提取 N 个主色；调色模式：基准色 + 配色方案推导。
// 每个色给 HEX/RGB/CMYK/HSL/HSB 可复制，可导出 .ase/.aco 直接进 PS/AI/CorelDRAW，
// 并实时生成配色提示词文本喂下游（与 视角/光源 同类，本地纯计算零成本）。

export type PaletteMode = 'extract' | 'scheme';
export type PaletteScheme = 'complementary' | 'contrast' | 'analogous' | 'split' | 'tetradic' | 'monochrome';

export const PALETTE_MODE_LABELS: Record<PaletteMode, string> = {
  extract: '提取配色',
  scheme: '调色方案'
};
export const PALETTE_SCHEME_LABELS: Record<PaletteScheme, string> = {
  complementary: '互补色',
  contrast: '对比色（三角）',
  analogous: '邻近色',
  split: '分裂互补',
  tetradic: '四角配色',
  monochrome: '单色深浅'
};

export interface PaletteColorEntry {
  /** '#RRGGBB' */
  hex: string;
  /** 占比 0-100（仅提取模式有） */
  pct?: number;
}

export interface PaletteNodeData extends NodeMeta {
  mode: PaletteMode;
  /** 提取数量 2~12（提取模式）；邻近/单色方案的取色数（调色模式） */
  count: number;
  /** 手动上传图（上游图片优先；本字段为兜底，仅提取模式用） */
  inputImage?: { url: string; name?: string };
  /** 当前色板（提取结果 / 方案推导结果） */
  colors: PaletteColorEntry[];
  /** 调色模式：基准色 HEX */
  baseHex: string;
  /** 调色模式：配色方案 */
  scheme: PaletteScheme;
  /** 提示词里是否附 HEX 色值（指令跟随型模型能直接吃 HEX） */
  promptIncludeValues: boolean;
  /** 实时生成的配色提示词（文本输出，下游可读） */
  generatedPrompt: string;
}

/** 对比节点：左右两图 + 对比滑块（wipe）。两图优先取上游图片（A=上游[0] / B=上游[1]），
 *  也可往左/右半区拖图手动指定（srcA/srcB 覆盖上游）。纯查看，不生成、不输出。 */
export interface CompareNodeData extends NodeMeta {
  /** 手动指定的 A 图（覆盖上游[0]）；data:URI 或本地路径 */
  srcA?: string;
  /** 手动指定的 B 图（覆盖上游[1]）；data:URI 或本地路径 */
  srcB?: string;
  /** 对比分隔线位置 0-100（左侧露 A、右侧露 B） */
  slider: number;
}

// 视频模式统一到 @shared/video（7 档）；此处 re-export 兼容旧 import 路径。
export type { VideoMode };
export { VIDEO_MODE_LABELS } from './video';

/**
 * 视频节点：复用 type='video' 的设置配置，按 video_kind 走 kling/sora/unified 协议（异步）。
 * 上游接提示词（文本）→ prompt；接图片 → 图生视频首帧（自动切 image-to-video）。
 * 运行结果是本地 mp4 路径（已自动入资产库），节点卡上直接播放。
 */
export interface VideoNodeData extends NodeMeta {
  /** 视频模型显示名（复用 settingsStore type='video' 配置） */
  modelId: string;
  prompt: string;
  negativePrompt?: string;
  /** 统一 7 模式（旧 'text-to-video'/'image-to-video' 由 normalizeVideoMode 兼容） */
  mode: VideoMode;
  /** 时长（秒，字符串，如 '5' / '10' / '8'） */
  duration: string;
  /** 画幅，如 '16:9' / '9:16' / '1:1' / 'adaptive'；空 = 自动（跟随首张上游图比例） */
  aspect: string;
  /** 「自动」画幅运行后解析出的实际比例（跟随首张上游图），仅作节点上展示 */
  autoAspect?: string;
  /** 分辨率/档位：seedance 用 480p/720p/1080p；kling 用 std|pro；sora 可填 size 如 1280x720 */
  resolution: string;
  /** 随机种子；空 = 随机（部分协议忽略） */
  seed?: number | null;
  /** 生成音频（仅模型支持时） */
  generateAudio?: boolean;
  /** 返回最后一帧（连续视频默认开） */
  returnLastFrame?: boolean;
  // ── 参考素材（adapter 路径用；URL 或 data:URI）──
  firstFrameUrl?: string | null;
  lastFrameUrl?: string | null;
  referenceImageUrls?: string[];
  referenceVideoUrls?: string[];
  referenceAudioUrls?: string[];
  /** 连续视频：上一段最后一帧（作本段首帧） */
  previousLastFrameUrl?: string | null;
  status: RunStatus;
  /** 细分任务状态（adapter 路径） */
  taskState?: VideoTaskStatusState;
  /** 生成结果：本地 mp4 绝对路径 */
  videoPath?: string | null;
  /** 结果最后一帧 URL（供「继续生成下一段」） */
  outLastFrameUrl?: string | null;
  /** 最近一次费用预估说明 */
  costNote?: string;
  error?: string | null;
  logs?: string[];
  durationMs?: number;
  /** 进行中的 video taskId（匹配 video:done） */
  taskId?: string;
  /** 进度 0-100 + 阶段中文 */
  progress?: number;
  phase?: string;
}

// ───────────────────────── 反推 / 视频来源节点 ─────────────────────────
// 反推（kind 仍为 image-reverse，避免迁移既有旧档）：接图 或 视频（自动抽帧）→ 视觉模型反推 → 文本喂下游。
// 复用 api:lab:reverse（三档固定模式）与 api:lab:vision-analyze（prompt 模式 / 多帧），零新 IPC。
// 原独立「视频反推」节点（video-reverse）已于 2026-07-11 合并进本节点；旧档在 smartDocStorage.sanitize 原位迁移。
// 视频来源：上传本地视频 / URL → 输出视频给下游（反推 / 缩放 / 结果）。

export type ReverseType = 'description' | 'tags' | 'style';
export const REVERSE_TYPE_LABELS: Record<ReverseType, string> = {
  description: '自然语言描述',
  tags: '标签词',
  style: '风格分析'
};

/** 反推节点输出模式：prompt=可直接喂生图的中文提示词（新默认）；character=角色反推
 *（照片或角色文字素材 → 五官/发色/衣着/妆容/配饰等极详细角色外观描述，2026-07-12 加入）；
 *  其余三档沿用 api:lab:reverse 的 result_type。 */
export type ReverseOutputMode = 'prompt' | 'character' | ReverseType;
export const REVERSE_OUTPUT_LABELS: Record<ReverseOutputMode, string> = {
  prompt: '生图提示词',
  character: '角色反推',
  description: '详细描述',
  tags: '标签词',
  style: '风格分析'
};

/** 反推节点：接图 或 视频（自动抽帧）→ 视觉模型反推 → 文本，喂下游。 */
export interface ImageReverseNodeData extends NodeMeta {
  modelId: string;
  /** 旧字段（三档），outputMode 缺省时作回退——旧档不迁移字段也能跑 */
  reverseType: ReverseType;
  /** 输出模式（additive，涵盖并取代 reverseType）：缺省按 reverseType 回退，新建节点默认 'prompt' */
  outputMode?: ReverseOutputMode;
  /** 上游是视频时的抽帧数量（默认 6；沿自旧「视频反推」节点，合并后保留同名字段供旧档迁移） */
  frameCount?: number;
  /** 手动上传图（上游图片/视频优先；本字段兜底） */
  inputImage?: { url: string; name?: string };
  status: RunStatus;
  resultText?: string;
  logs?: string[];
  error?: string | null;
}

/** 视频上传/来源节点：本地视频路径 / http(s) URL（不存 data:URI，视频过大易爆 localStorage）。 */
export interface VideoSourceNodeData extends NodeMeta {
  src?: string;
  name?: string;
}

/** 插帧节点：接一个视频 → 本地 RIFE AI 运动插帧（24fps→60fps）→ 输出 mp4 喂下游。 */
export interface FrameInterpNodeData extends NodeMeta {
  /** 目标帧率（需高于源帧率），默认 60 */
  targetFps: number;
  /** RIFE 模型目录名（缺省用引擎默认 rife-v4.6） */
  model?: string;
  status: RunStatus;
  /** 总进度 0-100（主进程三阶段定额推送） */
  progress?: number;
  /** 中文阶段说明（拆帧 N/M、AI 插帧 N/M、合成编码…） */
  phase?: string;
  /** 探测到的源帧率（展示「源 24fps → 60fps」） */
  srcFps?: number;
  /** 输出视频本地路径（mp4，非持久化运行态以外的产物路径，可持久化） */
  outputVideo?: string | null;
  error?: string | null;
  /** 主进程任务 id（取消用，运行中才有） */
  taskId?: string;
  durationMs?: number;
}

// ───────────────────────── 保真放大节点（upscale，本地 Real-ESRGAN ncnn）─────────────────────────
// 1:1 复刻工具箱「保真放大」：接上游图 → api:upscale:run-single（同步等完成）→ 输出放大图喂下游。
// 引擎不随包，首次在卡上一键安装（与插帧同款 ncnn 引擎模式）。

export interface UpscaleNodeData extends NodeMeta {
  /** Real-ESRGAN 模型名（引擎扫到的，如 realesrgan-x4plus / realesrgan-x4plus-anime） */
  modelName: string;
  /** 放大倍数 2/3/4 */
  scale: 2 | 3 | 4;
  /** 输出格式 */
  format: 'png' | 'jpg' | 'webp';
  status: RunStatus;
  /** 输出图本地路径（可持久化） */
  outputImage?: string | null;
  /** 输出实际分辨率（角标展示） */
  outW?: number;
  outH?: number;
  durationMs?: number;
  logs?: string[];
  error?: string | null;
}

// ───────────────────────── 图像转矢量节点（vectorize，本地 VTracer/Potrace）─────────────────────────
// 1:1 复刻工具箱「图像转矢量」：接上游图 → api:vec:run-vtracer / run-potrace（异步，vec:progress 回结果路径）→ 输出 SVG。
// SVG 为终端产物（查看 / 另存 / 连结果节点），不喂栅格管线。

export type VectorizeMode = 'vtracer' | 'potrace';

export interface VectorizeNodeData extends NodeMeta {
  /** 矢量化模式：vtracer=彩色（logo/美陈）/ potrace=单色（线稿） */
  vmode: VectorizeMode;
  status: RunStatus;
  /** 输出 SVG 本地路径 */
  outputSvgPath?: string | null;
  /** 进度 0-100（vec:progress） */
  progress?: number;
  /** 主进程批次/任务 id（路由结果 + 取消用） */
  batchId?: string;
  taskId?: string;
  logs?: string[];
  error?: string | null;
}

// ───────────────────────── 视频剪辑节点（video-clip）─────────────────────────
// 时间轴式视频剪辑（参照剪映/Premiere）：接多个上游视频 → 每段一个片段，按时间轴排序，
// 每段可 裁切(入/出点) / 变速 / 音量·静音·淡入淡出，段间可加 转场，整体可调色 + 文字叠加 →
// 本地 ffmpeg 一次性合成（复用 api:video:edit op='clip'）→ 输出 mp4 喂下游。
// 长条形节点上做轻量排序/裁切 + 双击进「剪辑工作台」弹窗做深度编辑。

/** 段间转场类型（'none'=硬切）。与 electron/services/video/clipGraph.ts 的 VideoTransition 保持同步。 */
export type VideoTransition = 'none' | 'fade' | 'fadeblack' | 'dissolve' | 'wipeleft' | 'slideright';
export const VIDEO_TRANSITION_LABELS: Record<VideoTransition, string> = {
  none: '硬切',
  fade: '交叉淡化',
  fadeblack: '黑场过渡',
  dissolve: '溶解',
  wipeleft: '左擦除',
  slideright: '右滑入'
};

/** 时间轴上的一个视频片段（一段上游视频 + 其剪辑参数）。src 作为与上游视频的对应键。 */
export interface VideoClipSegment {
  /** 视频本地路径 / http(s) URL（来自上游视频来源，作为身份键，reconcile 用） */
  src: string;
  /** 裁切入点（秒，>=0） */
  trimStart: number;
  /** 裁切出点（秒）；<=0 = 到自然结尾 */
  trimEnd: number;
  /** 变速 0.5~2（1=正常） */
  speed: number;
  /** 音量倍数 0~4（1=不变） */
  volume: number;
  muted: boolean;
  fadeIn: number;
  fadeOut: number;
  /** 进入本段的转场（第 0 段忽略） */
  transition: VideoTransition;
  transitionDur: number;
}

/** 时间轴文字/字幕叠加（按时间区间显示）。 */
export interface VideoClipTextOverlay {
  id: string;
  text: string;
  /** 显示起止（成片时间轴秒） */
  start: number;
  end: number;
  /** 0~1 相对位置 */
  x: number;
  y: number;
  fontSize: number;
  color: string;
}

/** 视频剪辑节点：多段时间轴 + 转场 + 每段音频/变速 + 整体调色 + 文字叠加。 */
export interface VideoClipNodeData extends NodeMeta {
  /** 片段（顺序 = 时间轴顺序）；由上游视频 reconcile 生成、用户可排序/裁切 */
  segments: VideoClipSegment[];
  /** 文字叠加轨 */
  texts: VideoClipTextOverlay[];
  /** 整体调色（默认值 = 不变） */
  brightness: number;
  contrast: number;
  saturation: number;
  gamma: number;
  hue: number;
  /** 成片帧率（默认 30） */
  fps: number;
  status: RunStatus;
  progress?: number;
  outputVideo?: string | null;
  error?: string | null;
  durationMs?: number;
}

// ───────────────────────── 智能分镜节点（storyboard）─────────────────────────
// 2026-07-12 重做（旧「N 条分镜 + N-1 条转场」双输出方案连同分镜工作台整体删除）：
// 上游传入 角色描述 + 简短故事（纯文本），一次 LLM 调用生成完整视频分镜脚本——
// 开头【定调】段（固定全片风格/场景环境/内容物/光色基调，稳定剧本与绘图）+
// 时间轴「第X-Y秒：…」逐段推进（每个时间段独立成段），每段写清 场景/人物动作/物体变化/镜头运动，
// 单输出口（out）整份喂下游视频节点。提示词纯函数在 src/lib/storyboardPrompt.ts。
// 复用 api:chat:optimize-prompt，零新 IPC。旧档（shots/转场/out-trans 口）在 smartDocStorage.sanitize 原位迁移。

export interface StoryboardNodeData extends NodeMeta {
  /** 文本模型显示名（复用 settingsStore type='text' 配置） */
  modelId: string;
  /** 卡上补充素材（角色描述 / 简短故事均可；与上游文本合并） */
  input: string;
  /** 手动上传的参考图（2026-07-14：人物形象图 / 分镜片段图，与上游图片来源合并后经视觉模型读图并入素材） */
  inputImage?: { url: string; name?: string };
  /** 视频总时长（秒）。预设 15/30/60/120 或自定义（4-600，缺省 30），时间轴按它铺 */
  videoDurationSec?: number;
  /** 每个时间段约几秒（2-15，缺省 5；决定时间轴颗粒度） */
  secPerShot?: number;
  /** 额外要求（可选：风格/节奏/镜头偏好等一句话，注入系统提示词） */
  extraNote?: string;
  /** 生成的分镜脚本（【定调】段 + 每个「第X-Y秒」时间段各占一段；节点唯一输出，整份喂下游） */
  resultText?: string;
  status: RunStatus;
  logs?: string[];
  error?: string | null;
}

// ───────────────────────── 角色卡节点（character-card，2026-07-12）─────────────────────────
// 人物照片 + 简单描述 → ① 视觉模型详细分析外貌（五官/发色发型/衣着/妆容/配饰/配色，越细越好）
// → ② 组装成一张完整「角色设定卡」（三视图/表情九宫格/服装拆解/色板…）的生图提示词 → 喂下游生图出角色卡。
// 提示词纯函数在 src/lib/characterCardPrompt.ts。复用 api:lab:vision-analyze + api:chat:optimize-prompt，零新 IPC。

/** 角色卡版面风格（选项与提示词模板见 src/lib/characterCardPrompt.ts 的 CARD_STYLES）。 */
export type CharacterCardStyle = 'magazine' | 'journal' | 'photoset' | 'minimal';

/** 角色卡输出类型（2026-07-12 导出扩展）：card=完整设定卡；turnaround=三视图；face=面部特写；
 *  expressions=表情九宫格；body=身材比例；pose=动作姿势。每种各有独立版面提示词模板（characterCardPrompt.ts）。 */
export type CharacterSheetType = 'card' | 'turnaround' | 'face' | 'expressions' | 'body' | 'pose';

/** 角色主体类型：person=人物；animal=动物（宠物/生物角色——分析与版面提示词按物种适配）。 */
export type CharacterSubjectType = 'person' | 'animal';

export interface CharacterCardNodeData extends NodeMeta {
  /** 视觉/对话模型显示名（分析照片 + 组卡两步共用，需支持识图） */
  modelId: string;
  /** 简单描述（与上游文本合并作为角色补充素材） */
  desc: string;
  /** 输出类型（缺省 'card' 完整设定卡；三视图/面部特写/表情九宫格/身材比例/动作姿势 各自成图） */
  sheetType?: CharacterSheetType;
  /** 主体类型（缺省 'person' 人物；'animal' 动物按物种适配分析与版面） */
  subjectType?: CharacterSubjectType;
  /** 角色卡版面风格（仅 sheetType='card' 时生效，缺省 'magazine' 时尚杂志） */
  cardStyle?: CharacterCardStyle;
  /** 手动上传的人物照片（上游图片优先；本字段兜底） */
  inputImage?: { url: string; name?: string };
  /** 第 ① 步产物：外貌分析文本 = 角色描述提示词，从**下输出口（out-desc）**喂下游（分镜/生图作角色设定） */
  analysisText?: string;
  /** 第 ② 步产物：角色卡生图提示词，从**上输出口（out）**喂下游生图出设定卡 */
  resultText?: string;
  status: RunStatus;
  logs?: string[];
  error?: string | null;
}

// ───────────────────────── 提示词商城节点（prompt-mall）─────────────────────────
// 「逛店选购」式提示词构建（替代旧「角色设计」节点）：左分类栏（人物/服饰/画风/镜头构图/光线/色彩/
// 质感/环境/室内/动植物建筑/氛围/质量 等二级分类）→ 中缩略图卡片墙（拖一张进购物车则墙上消失）→
// 右购物车（按大类自动排布）→ 合成一条提示词。勾「优化」交给对话模型（api:chat:optimize-prompt）合并去重，
// 否则纯函数逗号拼接。输出文本喂下游（生图/分镜/视频/ComfyUI/LLM）。中/英切换同时控制卡片显示与输出语言。
// 卡片库是 app 自带只读数据（src/lib/promptMall，每卡含 genPrompt 供用户自行批量生成缩略图）。零新 IPC。

export type PromptMallLang = 'zh' | 'en';

/** 购物车条目（拖进购物车的卡片快照；custom=用户手输的自由片段，无缩略图）。 */
export interface PromptMallCartItem {
  /** 实例唯一 id（同一张卡片可被加入多个分组，故用 uid 作稳定 key，非 cardId） */
  uid: string;
  /** 卡片库 id（custom 片段可自造） */
  cardId: string;
  /** 大类 slug（加入时快照，便于按大类分组排布） */
  cat: string;
  /** 子类 slug */
  sub: string;
  /** 中文片段快照 */
  zh: string;
  /** 英文片段快照 */
  en: string;
  /** true=用户自定义自由片段（非卡片库） */
  custom?: boolean;
  /** 所属分组（图片组成部分）id；缺省=默认第一组。同组内同 (cat,sub) 互斥（开启排斥时） */
  group?: string;
}

/** 购物车分组（= 一张图的一个组成部分，如「人物A」「背景」）。组间互不影响，组内相关联（同 cat,sub）互斥。 */
export interface PromptMallGroup {
  id: string;
  name: string;
}

export interface PromptMallNodeData extends NodeMeta {
  /** 购物车（有序；展示与合成时按大类自动排布） */
  cart: PromptMallCartItem[];
  /** 分组列表（缺省视为单个「组 1」）。 */
  groups?: PromptMallGroup[];
  /** 当前活动分组 id（新拖入的卡片落到这一组）。 */
  activeGroup?: string;
  /** 排斥：同组内同 (cat,sub) 只能选一个（默认开启，undefined 视为 true）。 */
  exclusive?: boolean;
  /** 输出 + 卡片显示语言（单一真相） */
  lang: PromptMallLang;
  /** 合成用对话模型显示名（勾「优化」时用） */
  modelId: string;
  /** true=把购物车交给对话模型合并去重成一条；false=纯函数逗号拼接 */
  optimize: boolean;
  /** 组装方式：'fragments'=逐段片段逗号拼接（默认，可选优化合并）/ 'paragraph'=对话模型从头写成一整段连贯自然语言描述 */
  assembleMode?: 'fragments' | 'paragraph';
  /** 合成产物 = 本节点的文本输出（优化后或原始拼接） */
  assembled?: string;
  /** 锁定产物：手改后不被「运行」覆盖 */
  lockOutput?: boolean;
  /** 缩略图「开发模式」：节点上点开后可连 ComfyUI 节点，按 genPrompt 批量生成卡片缩略图（按 cardId 落盘） */
  devMode?: boolean;
  status: RunStatus;
  logs?: string[];
  error?: string | null;
}

// ───────────────────────── 循环节点（loop）─────────────────────────
// 工作流控制节点：对一组「项」逐项执行——把当前项作为本节点输出（提示词/尺寸/图片通道），
// 触发并等待直接下游 runnable（生图/ComfyUI/视频）完成，再切下一项。
// 支持 暂停（项间生效）/继续/停止/跳过当前项/从指定项继续；状态与当前项持久化（跨会话可续跑）。

export type LoopSourceType = 'images' | 'prompts' | 'folder' | 'sizes' | 'range' | 'count';

export const LOOP_SOURCE_LABELS: Record<LoopSourceType, string> = {
  images: '图片批次（直接传入多张）',
  prompts: '提示词列表',
  folder: '文件夹图片',
  sizes: '尺寸列表',
  range: '数值范围',
  count: '固定次数'
};

/** range 模式的输出通道：text=数值作为文本；size-width/size-height=数值作宽/高（另一边取 rangeOtherEdge）。 */
export type LoopRangeAs = 'text' | 'size-width' | 'size-height';

export interface LoopNodeData extends NodeMeta {
  sourceType: LoopSourceType;
  /** count 模式：循环次数（当前项输出 = 第 N 次文本） */
  count: number;
  /** range 模式：起 / 止 / 步长 */
  rangeFrom: number;
  rangeTo: number;
  rangeStep: number;
  rangeAs: LoopRangeAs;
  /** rangeAs=size-* 时另一边的固定值 */
  rangeOtherEdge?: number;
  /** prompts 模式：多行文本，每行一条 */
  promptLines: string;
  /** sizes 模式：每行 "1024x768" / "1024,768"（也支持 ×） */
  sizeLines: string;
  /** folder 模式：图片文件夹（复用 api:storage:list-images 扫描） */
  folderDir?: string;
  /** images 模式：直接拖入 / 选入的多张图（本地路径 / data:URI） */
  images?: string[];
  /** images / folder 模式：每批向下游传入几张（默认 1 = 逐张；>1 = 每批 N 张，配合下游「逐张处理输入图」可一批多出） */
  batchSize?: number;
  /** true=某项失败即停；缺省 false=失败跳过继续 */
  stopOnError?: boolean;
  // ── 运行态（持久化无害；「从指定项继续」跨会话可用）──
  status: RunStatus | 'paused';
  currentIndex?: number;
  totalItems?: number;
  doneCount?: number;
  failCount?: number;
  /** 当前项展示值 */
  currentValue?: string;
  // ── 当前项输出通道：computeUpstream 读这里 ──
  outPrompt?: string;
  outSize?: SizeSpec;
  outImage?: string;
  /** 当前批的多张图（images / folder 批次模式；computeUpstream 优先读它，逐批喂下游） */
  outImages?: string[];
  logs?: string[];
  error?: string | null;
}

// ───────────────────────── 文件夹输入 / 输出节点 ─────────────────────────
// folder-input：选输入文件夹 → 扫描图片（api:storage:list-images）→ 作为图片来源输出（多图）。
// folder-output：选输出文件夹 → 上游 生图/ComfyUI/视频/缩放/结果 每出一张结果自动落盘
//（api:storage:copy-into，本地路径零转码复制 / dataUri 解码写入），命名规则 原名/前缀+序号。
// 组合：folder-input(N 图) → ComfyUI 节点「逐张图执行」 → folder-output = 文件夹批量处理。

export interface FolderInputNodeData extends NodeMeta {
  dir?: string;
  /** 扫描快照：图片绝对路径（文件名自然序）。持久化；「刷新」按钮重扫 */
  files: string[];
  /** 扫描快照：视频绝对路径（2026-06-12 起一并扫描，作下游视频来源） */
  videoFiles?: string[];
  scannedAt?: number;
  error?: string | null;
}

export type FolderNameRule = 'original' | 'prefix-seq';

export const FOLDER_NAME_RULE_LABELS: Record<FolderNameRule, string> = {
  original: '沿用原文件名（重名自动 -2/-3）',
  'prefix-seq': '前缀 + 四位序号'
};

export interface FolderOutputNodeData extends NodeMeta {
  dir?: string;
  nameRule: FolderNameRule;
  /** nameRule='prefix-seq' 的前缀，默认 'output' */
  prefix: string;
  /** 下一序号（持久化递增） */
  seq: number;
  /** 关闭时只记日志不落盘 */
  enabled: boolean;
  savedCount: number;
  failCount: number;
  logs?: string[];
  error?: string | null;
}

// ───────────────────────── 切分 / 对稿 共享（视觉元素分析）─────────────────────────
// 两类节点都靠「视觉模型分析整图 → 返回逐元素边界框 + 逐元素信息」，框为源图像素坐标，可在工作台拖拽/缩放校准。

/** 元素边界框（源图像素坐标，左上角原点）。 */
export interface ElementRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 对稿问题类别。 */
export type ProofIssueType = 'font' | 'element' | 'logo' | 'shape';
/** 对稿严重度。 */
export type ProofSeverity = 'high' | 'medium' | 'low' | 'ok';

export const PROOF_ISSUE_LABELS: Record<ProofIssueType, string> = {
  font: '字体/文字错误',
  element: '元素错误',
  logo: 'Logo 错误',
  shape: '形态错误'
};
export const PROOF_SEVERITY_LABELS: Record<ProofSeverity, string> = {
  high: '严重',
  medium: '中等',
  low: '轻微',
  ok: '正常'
};

/** 切分元素：一个被识别出的画面元素 + 它的反推提示词 + 重绘结果。 */
export interface SegElement {
  id: string;
  /** 元素名（如「猪肉」「微信图标」「左手」） */
  label: string;
  /** 边界框（源图像素坐标） */
  box: ElementRect;
  /** 逐元素反推提示词（视觉模型给出，可手改） */
  prompt?: string;
  /** 重绘后的元素图（dataURI / 磁盘路径；不持久化大 base64，落盘后为路径） */
  regenSrc?: string;
  /** 该元素重绘状态（done=已重绘，独立于节点级 RunStatus） */
  status?: 'idle' | 'running' | 'done' | 'error';
  error?: string | null;
}

/** 切分工具节点：整图 → 自动识别元素框 → 逐元素反推 → 统一风格 → 逐元素重绘 → 1:1 拼回整图。 */
export interface SegmentNodeData extends NodeMeta {
  /** 视觉模型（识别元素框 + 逐元素反推；需多模态/vision 能力） */
  modelId?: string;
  /** 生图模型（逐元素重绘） */
  genModelId?: string;
  /** 统一风格约束（拼进每个元素的重绘提示词，保证整体风格一致） */
  stylePrompt?: string;
  /** 手动上传图（上游图片优先；本字段兜底） */
  inputImage?: { url: string; name?: string } | null;
  /** 指纹：上次识别用的图（图变了需重新识别） */
  analysisSrc?: string;
  /** 源图尺寸（识别后量得，框坐标的参照系） */
  imgW?: number;
  imgH?: number;
  /** 识别出的元素 */
  elements?: SegElement[];
  /** 拼合后的整图（节点输出；dataURI / 磁盘路径，不持久化） */
  composedSrc?: string;
  status: RunStatus;
  /** 进度文案（识别中 / 反推中 / 重绘中 / 拼合中） */
  phase?: string;
  logs?: string[];
  error?: string | null;
}

/** 对稿元素：一个被识别出的元素 + 它的检错结论。 */
export interface ProofElement {
  id: string;
  label: string;
  box: ElementRect;
  /** 命中的问题类别（可多个） */
  issueTypes: ProofIssueType[];
  severity: ProofSeverity;
  /** 问题描述 */
  description: string;
  /** 修改建议 */
  suggestion: string;
  /** 是否无问题（ok=true 时不渲染问题框） */
  ok: boolean;
}

/** 对稿节点：多模态模型逐元素拆分识别海报问题（字体/元素/logo/形态），输出审稿报告文本 + 可导出标注图。 */
export interface ProofNodeData extends NodeMeta {
  /** 视觉模型（需多模态/vision 能力） */
  modelId?: string;
  inputImage?: { url: string; name?: string } | null;
  analysisSrc?: string;
  imgW?: number;
  imgH?: number;
  elements?: ProofElement[];
  /** 审稿报告（节点文本输出，喂下游） */
  reportText?: string;
  /** 标注图（问题框画在海报上；dataURI，不持久化，工作台导出/入库用） */
  annotatedSrc?: string;
  status: RunStatus;
  logs?: string[];
  error?: string | null;
}

export type SmartNodeData =
  | UpscaleNodeData
  | VectorizeNodeData
  | ImageNodeData
  | PromptNodeData
  | WorkNodeData
  | ResultNodeData
  | GroupNodeData
  | LlmNodeData
  | ComfyNodeData
  | AnglePromptNodeData
  | ScaleNodeData
  | RatioNodeData
  | TextNodeData
  | LightNodeData
  | PaletteNodeData
  | CompareNodeData
  | VideoNodeData
  | ImageReverseNodeData
  | VideoSourceNodeData
  | FrameInterpNodeData
  | VideoClipNodeData
  | StoryboardNodeData
  | CharacterCardNodeData
  | PromptMallNodeData
  | LoopNodeData
  | FolderInputNodeData
  | FolderOutputNodeData
  | SegmentNodeData
  | ProofNodeData;

// ───────────────────────── 运行结果 ─────────────────────────

export interface WorkResult {
  ok: boolean;
  summary: string;
  /** 生成图本地路径（或占位 data:URI） */
  images: string[];
  /** 文本输出（LLM/反推/视角等文本结果汇入结果节点用；可空） */
  texts?: string[];
  /** 视频输出本地路径（视频后端接入后用；v1.0 无真实视频，仅结构 + 展示就绪） */
  videos?: string[];
  logs: string[];
  error?: string;
  /** 使用的执行参数回显（mock 也展示清楚） */
  workType: WorkType;
  runMode: RunMode;
  /** 执行后端：WorkProvider，或 ComfyUI 节点的 'comfyui'（故放宽为 string） */
  provider: string;
  model: string;
  /** true = 模拟（Local Mock 或暂无真实后端的工作类型） */
  simulated: boolean;
  /** 本次运行耗时（毫秒）：从点「运行」到出结果，结果区显示「用时 X.Xs」 */
  durationMs?: number;
  /** 本条结果对应的提示词全文（多条提示词逐条生图时 = 该条；合集卡展示用） */
  prompt?: string;
  /** 结果产生时间戳（毫秒） */
  createdAt?: number;
  /** 同一次「运行」产生的多条结果共享的批次 id（多提示词逐条生图 → 结果节点按批次聚合成合集卡） */
  batchId?: string;
  /** 该条结果对应第几条提示词（0 起；分镜场景 = 分镜序号） */
  shotIndex?: number;
  /** 产出此结果的生图节点 id（合集卡「重试此条」回溯源节点用） */
  sourceNodeId?: string;
}

// ───────────────────────── 画布序列化（导出/导入 .json）─────────────────────────

export interface SmartCanvasNodeDTO {
  id: string;
  type: SmartNodeKind;
  position: { x: number; y: number };
  width?: number;
  height?: number;
  /** 分组容器化：子节点所属分组 id（React Flow parentId） */
  parentId?: string;
  data: SmartNodeData;
}

export interface SmartCanvasConnectionDTO {
  id: string;
  source: string;
  target: string;
  /** 多输出口节点的源输出口 id；缺省 = 默认口 'out'（旧智能分镜的 out-trans 口已删，载入时迁移回 out） */
  sourceHandle?: string;
}

export interface SmartCanvasDoc {
  id: string;
  title: string;
  nodes: SmartCanvasNodeDTO[];
  connections: SmartCanvasConnectionDTO[];
  viewport: { x: number; y: number; scale: number };
  settings: Record<string, unknown>;
}
