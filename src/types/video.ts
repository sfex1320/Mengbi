/**
 * 统一视频生成抽象层（跨进程共享 @shared/video）。
 *
 * 设计目标：画布节点 / 运行端只构造与供应商无关的 {@link VideoGenerationRequest}，
 * 由主进程的 VideoProviderAdapter 负责映射到各家（APIMart Seedance / Kling / Sora / 自定义）的真实参数。
 * 校验（{@link validateVideoRequest}）与费用预估（{@link estimateVideoCost}）是纯函数，
 * 渲染端 dry-run 预览与主进程提交前强校验**复用同一份逻辑**，避免双份漂移。
 *
 * 注意：本文件**不含任何供应商专属字段**——APIMart 的映射在 electron/services/video/seedanceAdapter.ts。
 */

/** 视频生成模式（统一 7 档，供应商能力决定可用子集）。 */
export type VideoMode =
  | 'text_to_video'
  | 'image_to_video'
  | 'first_last_frame'
  | 'reference_images'
  | 'reference_video'
  | 'reference_audio'
  | 'continuous';

export const VIDEO_MODE_LABELS: Record<VideoMode, string> = {
  text_to_video: '文生视频',
  image_to_video: '图生视频 / 首帧',
  first_last_frame: '首尾帧视频',
  reference_images: '多参考图',
  reference_video: '参考视频',
  reference_audio: '参考音频 / 有声',
  continuous: '连续视频'
};

/** 旧版两档模式（'text-to-video' / 'image-to-video'）→ 新版归一，兼容历史持久化数据。 */
export function normalizeVideoMode(v: unknown): VideoMode {
  const s = typeof v === 'string' ? v : '';
  if (s === 'text-to-video') return 'text_to_video';
  if (s === 'image-to-video') return 'image_to_video';
  return (Object.prototype.hasOwnProperty.call(VIDEO_MODE_LABELS, s) ? s : 'text_to_video') as VideoMode;
}

export type VideoImageRole = 'first_frame' | 'last_frame' | 'reference_image';

export interface VideoRequestImage {
  /** http(s) URL 或 data:URI（adapter 决定内联 base64 / 上传 / 原样） */
  url: string;
  role: VideoImageRole;
}

/** 供应商无关的统一视频生成请求。 */
export interface VideoGenerationRequest {
  /** 供应商 id（= video_kind：seedance / kling / sora / unified / custom …） */
  providerId: string;
  /** 真实模型 id（如 doubao-seedance-2.0-fast） */
  modelId: string;
  mode: VideoMode;
  prompt: string;
  negativePrompt?: string;
  duration: number;
  aspectRatio: string;
  resolution: string;
  seed?: number | null;
  generateAudio?: boolean;
  returnLastFrame?: boolean;
  /** 带 role 的图片（首尾帧用 image_with_roles） */
  images?: VideoRequestImage[];
  /** 纯图片 URL 列表（多参考图 / 单图生视频） */
  imageUrls?: string[];
  videoUrls?: string[];
  audioUrls?: string[];
  /** 透传给 adapter 的高级覆盖（顶层合并到最终请求体） */
  advanced?: Record<string, unknown>;
}

export type VideoTaskStatusState =
  | 'idle'
  | 'validating'
  | 'submitted'
  | 'polling'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'timeout';

export const VIDEO_TASK_STATE_LABELS: Record<VideoTaskStatusState, string> = {
  idle: '空闲',
  validating: '校验中',
  submitted: '已提交',
  polling: '轮询中',
  processing: '生成中',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
  timeout: '超时'
};

export interface VideoTask {
  taskId: string;
  providerId: string;
  modelId: string;
  status: VideoTaskStatusState;
  progress?: number;
  videoUrl?: string;
  localVideoPath?: string;
  firstFrameUrl?: string;
  lastFrameUrl?: string;
  error?: string;
  rawResponse?: unknown;
  createdAt: number;
  updatedAt: number;
}

/** adapter.pollTask / normalizeResponse 的归一返回。 */
export interface VideoTaskStatus {
  state: VideoTaskStatusState;
  progress?: number;
  videoUrl?: string;
  firstFrameUrl?: string;
  lastFrameUrl?: string;
  error?: string;
  raw?: unknown;
}

export interface ValidationIssue {
  field: string;
  message: string;
}
export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

export type CostTier = 'low' | 'medium' | 'high';
export interface CostEstimate {
  /** 估算金额；null = 无价格信息（仅给提示文案） */
  amount: number | null;
  currency: string;
  tier: CostTier;
  /** 人类可读说明（含模型 priceRemark） */
  note: string;
}
