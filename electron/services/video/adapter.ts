/**
 * VideoProviderAdapter —— 视频供应商适配器抽象（主进程）。
 *
 * 画布节点只提交与供应商无关的 {@link VideoGenerationRequest}；adapter 负责：
 *  - validate：复用 @shared/videoProviders 的纯校验（能力/限制）
 *  - estimateCost：复用纯费用估算
 *  - createTask / pollTask / cancelTask：与具体供应商的 HTTP 协议对接
 *  - normalizeResponse：把各家五花八门的返回归一成 {@link VideoTaskStatus}
 *
 * 第一版实现 ApiMartSeedanceAdapter；Kling/Veo/Runway/fal/Custom 通过 registry 增量接入，零改节点。
 */

import type {
  VideoGenerationRequest,
  VideoTaskStatus,
  ValidationResult,
  CostEstimate
} from '@shared/video';
import type { VideoProviderConfig, VideoModelConfig } from '@shared/videoProviders';

/** adapter 运行上下文：合并后的供应商/模型配置 + 解析出的凭证 + abort 信号。 */
export interface AdapterContext {
  provider: VideoProviderConfig;
  model: VideoModelConfig | null;
  /** 解析后的 base_url（provider.baseUrl 优先，否则 api_configs 的 base_url） */
  baseUrl: string;
  apiKey: string;
  actualModelId: string;
  /** 方案级请求体覆盖（顶层合并，null 删字段） */
  bodyOverridesJson: string | null;
  signal: AbortSignal;
}

export interface CreateTaskResult {
  taskId: string;
  /** 若供应商在提交响应里直接给了结果（同步式），带回避免多一轮轮询 */
  status: VideoTaskStatus;
}

export interface VideoProviderAdapter {
  readonly id: string;
  validate(req: VideoGenerationRequest): ValidationResult;
  estimateCost(req: VideoGenerationRequest): CostEstimate;
  createTask(req: VideoGenerationRequest): Promise<CreateTaskResult>;
  pollTask(taskId: string): Promise<VideoTaskStatus>;
  cancelTask?(taskId: string): Promise<void>;
  normalizeResponse(raw: unknown): VideoTaskStatus;
}

// ───────────────────────── 共享 HTTP / 解析工具 ─────────────────────────

/** Bearer / header / custom 鉴权头（custom 第一版退化为 Bearer）。 */
export function authHeaders(apiKey: string, authType: string): Record<string, string> {
  const common = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (authType === 'header') return { ...common, 'x-api-key': apiKey };
  return { ...common, Authorization: `Bearer ${apiKey}` };
}

/** 拼接 base + endpoint（容错多余/缺失斜杠）。
 *  防双 /v1：OpenAI 兼容中转站的 base_url 常带 /v1（如 https://api.apimart.ai/v1），
 *  而 endpoint 模板也以 /v1 开头（/v1/videos/generations）→ 直接拼会得到 .../v1/v1/...（404）。
 *  base 已以 /v1 结尾且 endpoint 又以 /v1 开头时，去掉 endpoint 的这一段。 */
export function joinUrl(base: string, endpoint: string): string {
  const b = base.replace(/\/+$/, '');
  if (!endpoint) return b;
  let e = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  if (/\/v1$/i.test(b) && /^\/v1(\/|$)/i.test(e)) e = e.replace(/^\/v1/i, '');
  return `${b}${e}`;
}

/** 把 `{taskId}` / `{task_id}` / `{id}` 占位替换为真实 id；无占位则末尾补 `/id`。 */
export function fillTaskUrl(template: string, taskId: string): string {
  if (/\{task_?id\}|\{id\}/.test(template)) {
    return template.replace(/\{task_?id\}|\{id\}/g, encodeURIComponent(taskId));
  }
  return `${template.replace(/\/+$/, '')}/${encodeURIComponent(taskId)}`;
}

export function safeJson(text: string): Record<string, unknown> | undefined {
  try {
    const j = JSON.parse(text);
    return typeof j === 'object' && j !== null ? (j as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** 顶层合并请求体覆盖 + advanced（null 值删字段）。 */
export function mergeBody(
  body: Record<string, unknown>,
  overridesJson: string | null,
  advanced?: Record<string, unknown>
): Record<string, unknown> {
  let merged: Record<string, unknown> = { ...body };
  if (advanced && typeof advanced === 'object') merged = { ...merged, ...advanced };
  if (overridesJson && overridesJson.trim()) {
    try {
      const ov = JSON.parse(overridesJson);
      if (ov && typeof ov === 'object' && !Array.isArray(ov)) merged = { ...merged, ...ov };
    } catch {
      /* 非法 JSON 忽略 */
    }
  }
  for (const k of Object.keys(merged)) {
    if (merged[k] === null || merged[k] === undefined) delete merged[k];
  }
  return merged;
}

/** 从提交响应抠任务 id（兼容 data.task_id / data[0].task_id(APIMart) / task_id / id / request_id / data.id / task.id）。 */
export function extractTaskId(j: Record<string, unknown> | undefined): string | undefined {
  if (!j) return undefined;
  // APIMart Seedance 提交响应是 { code, data: [ { status, task_id } ] }（data 为数组）→ 取首元素
  const rawData = j.data;
  const data = (Array.isArray(rawData) ? (rawData[0] ?? {}) : (rawData ?? {})) as Record<string, unknown>;
  const cands = [
    data.task_id,
    data.id,
    j.task_id,
    j.id,
    j.request_id,
    (j.task as Record<string, unknown> | undefined)?.id
  ];
  for (const c of cands) if (typeof c === 'string' && c) return c;
  return undefined;
}

/** 归一各家状态串 → 任务状态。 */
export function normalizeStatusState(
  raw: string
): 'processing' | 'succeeded' | 'failed' {
  const s = raw.toLowerCase();
  if (['succeed', 'success', 'succeeded', 'completed', 'done', 'finished'].includes(s)) return 'succeeded';
  if (['failed', 'fail', 'error', 'cancelled', 'canceled'].includes(s)) return 'failed';
  return 'processing';
}

/** 从轮询/提交响应抠视频 URL（兼容 kling task_result.videos / video.url / data[0].url / output 等）。 */
export function extractVideoUrl(j: Record<string, unknown> | undefined): string | undefined {
  if (!j) return undefined;
  const data = (j.data ?? {}) as Record<string, unknown>;
  const tr = (data.task_result ?? {}) as Record<string, unknown>;
  const klingVideos = tr.videos as Array<{ url?: string }> | undefined;
  if (klingVideos?.[0]?.url) return klingVideos[0].url;
  // APIMart Seedance 任务状态成功：data.result.videos[]（每项 {url} 或直接字符串）
  const result = (data.result ?? {}) as Record<string, unknown>;
  const resultVideos = result.videos as Array<{ url?: string } | string> | undefined;
  if (Array.isArray(resultVideos) && resultVideos.length) {
    const f = resultVideos[0];
    if (typeof f === 'string') return f;
    if (f && typeof (f as Record<string, unknown>).url === 'string') return (f as Record<string, unknown>).url as string;
  }
  if (typeof result.video_url === 'string' && result.video_url) return result.video_url;
  const video = (j.video ?? data.video) as Record<string, unknown> | undefined;
  if (video && typeof video.url === 'string') return video.url;
  const arr = (data.videos ?? j.videos ?? j.output ?? (Array.isArray(j.data) ? j.data : undefined)) as unknown;
  if (Array.isArray(arr)) {
    const first = arr[0];
    if (typeof first === 'string') return first;
    if (first && typeof (first as Record<string, unknown>).url === 'string')
      return (first as Record<string, unknown>).url as string;
  }
  // Runway: output[0]（mp4 URL 数组）
  const output = j.output as unknown;
  if (Array.isArray(output)) {
    const f = output[0];
    if (typeof f === 'string') return f;
    if (f && typeof (f as Record<string, unknown>).url === 'string') return (f as Record<string, unknown>).url as string;
  }
  for (const cand of [j.video_url, j.videoUrl, j.url, data.video_url, data.url, data.videoUrl, data.video_url]) {
    if (typeof cand === 'string' && cand) return cand;
  }
  return undefined;
}

/** 从响应抠「最后一帧」URL（return_last_frame 连续视频用）。 */
export function extractLastFrameUrl(j: Record<string, unknown> | undefined): string | undefined {
  if (!j) return undefined;
  const data = (j.data ?? {}) as Record<string, unknown>;
  const tr = (data.task_result ?? {}) as Record<string, unknown>;
  const result = (data.result ?? {}) as Record<string, unknown>;
  for (const cand of [
    data.last_frame_url,
    data.last_frame,
    result.last_frame_url,
    result.last_frame,
    tr.last_frame_url,
    j.last_frame_url,
    data.lastFrameUrl
  ]) {
    if (typeof cand === 'string' && cand) return cand;
  }
  return undefined;
}

/** 抠错误文案（脱敏由调用方负责；这里只取字段）。 */
export function extractError(j: Record<string, unknown> | undefined): string | undefined {
  if (!j) return undefined;
  const data = (j.data ?? {}) as Record<string, unknown>;
  const e = j.error ?? data.error ?? data.task_status_msg ?? j.message;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object') return (e as Record<string, unknown>).message as string | undefined;
  return undefined;
}

export function statusRaw(j: Record<string, unknown> | undefined): string {
  if (!j) return '';
  const data = (j.data ?? {}) as Record<string, unknown>;
  return String(data.task_status ?? data.status ?? data.state ?? j.status ?? j.state ?? '');
}
