/**
 * 智能画布（AI 创作节点画布）—— 跨文件共享类型（@shared/smartCanvas）。
 * 节点：图片 / 提示词 / 工作 / 结果 / 分组。与 /canvas 物理隔离（独立 store / css 前缀 mb-sc-*）。
 * 工作节点 provider 两档：mengbi（复用现有 api:image:generate）/ mock（Local Mock）。
 * 命名对齐 MVP 规格：image-generation / outpainting / video-generation / batch-process / continue-from-connections。
 */
import type { InputControl } from './comfyui';

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
  | 'ratio';

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
  /** 节点标签 / 注释文字（展示在标题条下方的彩色小条） */
  label?: string;
  /** 标签颜色（CSS 颜色值，取主题 token 之一；空 = 用默认 accent） */
  labelColor?: string;
}

export interface ImageNodeData extends NodeMeta {
  /** 本地绝对路径或 data:URI */
  src?: string;
  name?: string;
  naturalW?: number;
  naturalH?: number;
}

export interface PromptNodeData extends NodeMeta {
  text: string;
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
  /** 分辨率档位 '1K'|'2K'|'4K'；空 = 默认。按 family.supportedTiers 自适应 */
  imageSize?: string;
  /** 质量 'standard'|'high'…；family.supportsQuality 时可用 */
  quality?: string;
  /** 绘画强度 0-1（img2img/重绘；仅 ComfyUI 等支持的后端生效，OpenAI 协议忽略） */
  strength?: number;
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
  | 'reverse'; // 图片反推提示词（需 vision 文本模型）

export const LLM_OP_LABELS: Record<LlmOp, string> = {
  optimize: '优化提示词',
  'translate-en': '翻译成英文',
  'translate-zh': '翻译成中文',
  expand: '扩写细化',
  decompose: '细节分解',
  refine: '对话完善',
  reverse: '图片反推提示词'
};

/** 需要上游图片的 LLM 操作（vision） */
export const LLM_IMAGE_OPS: ReadonlySet<LlmOp> = new Set<LlmOp>(['reverse']);

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
  /** 本节点输入文本（与上游文本合并） */
  input: string;
  /** reverse 时的反推类型 */
  reverseType: 'description' | 'tags' | 'style';
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

export interface ComfyNodeData extends NodeMeta {
  /** 绑定的工作流模板 id（comfyui_workflow_templates.workflowId） */
  workflowId: string;
  templateName: string;
  /** 模板暴露的输入控件快照（用于检查器渲染） */
  controls: InputControl[];
  /** controlId → 覆盖值 */
  controlValues: Record<string, unknown>;
  status: RunStatus;
  /** 进行中的 comfyui runId（匹配 comfyui:run-done） */
  runId?: string;
  result?: WorkResult | null;
  logs: string[];
  error?: string | null;
}

// ───────────────────────── 视角提示词节点（angle-prompt）─────────────────────────
// 接入一张图片 → 3D 预览 + 角度控制 → 实时生成「改变拍摄视角」的提示词，作文本输出喂下游。
// 不直接生成图片；3D 预览仅用于交互展示。

export interface AnglePromptNodeData extends NodeMeta {
  /** 手动上传的图（上游图片优先；本字段为兜底）。url = 本地路径或 data:URI */
  inputImage?: { url: string; name?: string };
  /** 水平旋转 -90~90，0 默认；>0 向右 / <0 向左 */
  horizontalAngle: number;
  /** 垂直俯仰 -90~90，0 默认；>0 俯视 / <0 仰视 */
  verticalAngle: number;
  /** 镜头距离 0.1~8，4 默认；>4 广角 / <4 特写 */
  distance: number;
  /** 实时生成的视角提示词（文本输出，下游可读） */
  generatedPrompt: string;
  /** 是否追加「保持主体一致，只改视角」约束句 */
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
}

// ───────────────────────── 比例/分辨率分析节点（ratio）─────────────────────────
// 接入一张图 → 显示最接近的常用比例 + 各分辨率档（1K/2K/4K）下的实际像素 + 像素预算建议。
// 纯参考展示，不输出（帮你决定生图用什么比例/分辨率）。

export type RatioNodeData = NodeMeta;

export type SmartNodeData =
  | ImageNodeData
  | PromptNodeData
  | WorkNodeData
  | ResultNodeData
  | GroupNodeData
  | LlmNodeData
  | ComfyNodeData
  | AnglePromptNodeData
  | ScaleNodeData
  | RatioNodeData;

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
}

export interface SmartCanvasDoc {
  id: string;
  title: string;
  nodes: SmartCanvasNodeDTO[];
  connections: SmartCanvasConnectionDTO[];
  viewport: { x: number; y: number; scale: number };
  settings: Record<string, unknown>;
}
