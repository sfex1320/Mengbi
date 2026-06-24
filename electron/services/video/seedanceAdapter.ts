/**
 * ApiMartSeedanceAdapter —— APIMart Seedance 2.0 系列适配器（主进程）。
 * 端点统一 POST {base}{generationEndpoint}（默认 /v1/videos/generations），按 7 模式拼 body。
 *
 * GenericVideoAdapter 提供通用的「提交 → 轮询 → 归一」骨架；Seedance 只覆盖 buildBody 的 7 模式映射。
 * CustomAdapter（自定义中转站，基础预留）直接用通用 buildBody。
 */

import {
  type VideoProviderAdapter,
  type AdapterContext,
  type CreateTaskResult,
  authHeaders,
  joinUrl,
  fillTaskUrl,
  safeJson,
  mergeBody,
  extractTaskId,
  extractVideoUrl,
  extractLastFrameUrl,
  extractError,
  normalizeStatusState,
  statusRaw
} from './adapter';
import { chromiumFetch } from '../httpClient';
import { logger, maskKey } from '../logger';
import {
  validateVideoRequest,
  estimateVideoCost
} from '@shared/videoProviders';
import type { VideoGenerationRequest, VideoTaskStatus, ValidationResult, CostEstimate } from '@shared/video';

/** 通用视频适配器骨架：提交/轮询/取消/归一；子类只需实现 buildBody。 */
export abstract class GenericVideoAdapter implements VideoProviderAdapter {
  abstract readonly id: string;
  protected ctx: AdapterContext;
  constructor(ctx: AdapterContext) {
    this.ctx = ctx;
  }

  validate(req: VideoGenerationRequest): ValidationResult {
    return validateVideoRequest(req, this.ctx.model);
  }
  estimateCost(req: VideoGenerationRequest): CostEstimate {
    return estimateVideoCost(req, this.ctx.model);
  }

  protected abstract buildBody(req: VideoGenerationRequest): Record<string, unknown>;

  /**
   * 提交前把 data: 内联图换成公网 URL：不少站点（如 APIMart）生成接口只收 http/https 或 asset://，
   * 直接发 base64 会 400「Invalid format for image_with_roles[0].url」。
   * 有 imageUploadEndpoint → 自动 multipart 上传换 URL（同图去重）；
   * 没有 → 原样放行（部分站收 base64，保持旧行为；被拒时由上游 400 文案提示）。
   */
  protected async resolveDataImages(req: VideoGenerationRequest): Promise<VideoGenerationRequest> {
    const isData = (u: string | undefined): boolean => !!u && u.startsWith('data:');
    const all = [...(req.imageUrls ?? []), ...(req.images ?? []).map((i) => i.url)];
    if (!all.some(isData)) return req;
    const ep = this.ctx.provider.imageUploadEndpoint;
    if (!ep) return req;
    const cache = new Map<string, string>();
    const upload = async (u: string): Promise<string> => {
      if (!u.startsWith('data:')) return u;
      const hit = cache.get(u);
      if (hit) return hit;
      const m = /^data:([^;,]*?)(?:;charset=[^;,]*)?(;base64)?,([\s\S]*)$/.exec(u);
      if (!m) throw new Error('参考图 data URI 无法解析');
      const mime = m[1] || 'image/png';
      const buf = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]), 'utf8');
      if (buf.length > 20 * 1024 * 1024) throw new Error('参考图超过 20MB（上传端点上限），请先用「缩放」节点压小');
      const ext = (mime.split('/')[1] || 'png').replace('jpeg', 'jpg');
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(buf)], { type: mime }), `ref.${ext}`);
      // multipart 不能手动设 Content-Type（boundary 由 fetch 生成）——不走 authHeaders 的 json 头
      const headers: Record<string, string> =
        this.ctx.provider.authType === 'header' ? { 'x-api-key': this.ctx.apiKey } : { Authorization: `Bearer ${this.ctx.apiKey}` };
      const res = await chromiumFetch(joinUrl(this.ctx.baseUrl, ep), { method: 'POST', headers, body: form, signal: this.ctx.signal });
      const text = await res.text();
      if (!res.ok) throw new Error(`参考图上传失败 HTTP ${res.status}：${text.slice(0, 200)}`);
      const j = safeJson(text);
      const data = (Array.isArray(j?.data) ? (j?.data as unknown[])[0] : j?.data) as Record<string, unknown> | undefined;
      const cands = [j?.url, data?.url, data?.file_url, j?.file_url];
      const got = cands.find((c): c is string => typeof c === 'string' && !!c);
      if (!got) throw new Error(`参考图上传响应里找不到 URL：${text.slice(0, 200)}`);
      logger.info(`[video:${this.id}] 参考图已上传换公网 URL（${buf.length} 字节）`);
      cache.set(u, got);
      return got;
    };
    return {
      ...req,
      imageUrls: req.imageUrls ? await Promise.all(req.imageUrls.map(upload)) : req.imageUrls,
      images: req.images ? await Promise.all(req.images.map(async (i) => ({ ...i, url: await upload(i.url) }))) : req.images
    };
  }

  async createTask(rawReq: VideoGenerationRequest): Promise<CreateTaskResult> {
    const { provider, baseUrl, apiKey, signal } = this.ctx;
    const req = await this.resolveDataImages(rawReq);
    const url = joinUrl(baseUrl, provider.generationEndpoint);
    const body = mergeBody(this.buildBody(req), this.ctx.bodyOverridesJson, req.advanced);
    const res = await chromiumFetch(url, {
      method: 'POST',
      headers: authHeaders(apiKey, provider.authType),
      body: JSON.stringify(body),
      signal
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`提交失败 HTTP ${res.status}：${text.slice(0, 300)}`);
    const j = safeJson(text);
    // 同步式：提交即给视频
    const videoUrl = extractVideoUrl(j);
    if (videoUrl) {
      return {
        taskId: extractTaskId(j) ?? 'sync',
        status: { state: 'succeeded', videoUrl, lastFrameUrl: extractLastFrameUrl(j), raw: j }
      };
    }
    const taskId = extractTaskId(j);
    if (!taskId) throw new Error(`提交返回里找不到任务 id：${text.slice(0, 300)}`);
    return { taskId, status: { state: 'submitted', raw: j } };
  }

  async pollTask(taskId: string): Promise<VideoTaskStatus> {
    const { provider, baseUrl, apiKey, signal } = this.ctx;
    // 查询端点：配置了 taskQueryEndpoint 用之（支持 {taskId} 占位）；否则默认 generationEndpoint/{id}
    const tpl = provider.taskQueryEndpoint
      ? joinUrl(baseUrl, provider.taskQueryEndpoint)
      : joinUrl(baseUrl, provider.generationEndpoint);
    const url = fillTaskUrl(tpl, taskId);
    const res = await chromiumFetch(url, {
      method: 'GET',
      headers: authHeaders(apiKey, provider.authType),
      signal
    });
    const text = await res.text();
    if (!res.ok) {
      // 个别站点轮询偶发 5xx，归为 processing 让上层继续（不抛错中断）
      logger.warn(`[video:${this.id}] poll HTTP ${res.status}: ${text.slice(0, 200)}`);
      return { state: 'processing' };
    }
    return this.normalizeResponse(safeJson(text));
  }

  async cancelTask(taskId: string): Promise<void> {
    const { provider, baseUrl, apiKey, signal } = this.ctx;
    if (!provider.cancelEndpoint) return; // best-effort：没配取消端点就只能停轮询
    try {
      const url = fillTaskUrl(joinUrl(baseUrl, provider.cancelEndpoint), taskId);
      await chromiumFetch(url, {
        method: 'POST',
        headers: authHeaders(apiKey, provider.authType),
        signal
      });
    } catch (e) {
      logger.warn(`[video:${this.id}] cancel best-effort failed: ${(e as Error).message}`);
    }
  }

  normalizeResponse(raw: unknown): VideoTaskStatus {
    const j = (raw ?? undefined) as Record<string, unknown> | undefined;
    const state = normalizeStatusState(statusRaw(j));
    if (state === 'failed') return { state: 'failed', error: extractError(j), raw: j };
    const videoUrl = extractVideoUrl(j);
    if (state === 'succeeded' || videoUrl) {
      return { state: 'succeeded', videoUrl, lastFrameUrl: extractLastFrameUrl(j), raw: j };
    }
    const data = (j?.data ?? {}) as Record<string, unknown>;
    const pct = typeof data.progress === 'number' ? data.progress : typeof j?.progress === 'number' ? j.progress : undefined;
    return { state: 'processing', progress: pct, raw: j };
  }

  protected logSubmit(url: string): void {
    logger.info(`[video:${this.id}] submit ${url} (key ${maskKey(this.ctx.apiKey)})`);
  }
}

/** 取「带角色」首帧/尾帧/参考图，回退到 imageUrls。 */
function rolesByType(req: VideoGenerationRequest, role: 'first_frame' | 'last_frame' | 'reference_image'): string[] {
  return (req.images ?? []).filter((i) => i.role === role).map((i) => i.url);
}

export class ApiMartSeedanceAdapter extends GenericVideoAdapter {
  readonly id = 'seedance';

  protected buildBody(req: VideoGenerationRequest): Record<string, unknown> {
    const cap = this.ctx.model?.capabilities;
    const lim = this.ctx.model?.limits;
    const body: Record<string, unknown> = {
      model: this.ctx.actualModelId,
      prompt: req.prompt,
      duration: req.duration,
      resolution: req.resolution,
      // 比例同时用 aspect_ratio（通用键，确保画幅生效）+ size（兼容部分站点字段习惯）；
      // 站点若不认 size 可用「请求体覆盖」{"size":null} 去掉。
      aspect_ratio: req.aspectRatio,
      size: req.aspectRatio
    };
    if (req.negativePrompt && req.negativePrompt.trim() && (!lim || lim.supportNegativePrompt)) {
      body.negative_prompt = req.negativePrompt;
    }
    if (req.seed != null && (!lim || lim.supportSeed)) body.seed = req.seed;
    if (req.generateAudio && (!cap || cap.generateAudio)) body.generate_audio = true;
    // 连续视频强制回传最后一帧
    if ((req.returnLastFrame || req.mode === 'continuous') && (!cap || cap.returnLastFrame)) {
      body.return_last_frame = true;
    }

    const refImgs = [...(req.imageUrls ?? []), ...rolesByType(req, 'reference_image')];
    const firstFrames = rolesByType(req, 'first_frame');
    const lastFrames = rolesByType(req, 'last_frame');

    switch (req.mode) {
      case 'text_to_video':
        break;
      case 'image_to_video':
      case 'continuous': {
        const imgs = firstFrames.length ? firstFrames : (req.imageUrls ?? []);
        if (imgs.length) body.image_urls = imgs;
        break;
      }
      case 'first_last_frame':
        body.image_with_roles = [
          ...firstFrames.map((url) => ({ url, role: 'first_frame' })),
          ...lastFrames.map((url) => ({ url, role: 'last_frame' }))
        ];
        break;
      case 'reference_images':
        if (refImgs.length) body.image_urls = refImgs;
        break;
      case 'reference_video':
        if (req.videoUrls?.length) body.video_urls = req.videoUrls;
        break;
      case 'reference_audio':
        if (req.imageUrls?.length) body.image_urls = req.imageUrls;
        if (req.videoUrls?.length) body.video_urls = req.videoUrls;
        if (req.audioUrls?.length) body.audio_urls = req.audioUrls;
        break;
    }
    return body;
  }
}

/** 自定义中转站（基础预留）：通用 body（model/prompt + 各类素材），靠请求体覆盖微调字段。 */
export class CustomVideoAdapter extends GenericVideoAdapter {
  readonly id = 'custom';
  protected buildBody(req: VideoGenerationRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.ctx.actualModelId,
      prompt: req.prompt,
      duration: req.duration,
      resolution: req.resolution,
      aspect_ratio: req.aspectRatio
    };
    if (req.negativePrompt?.trim()) body.negative_prompt = req.negativePrompt;
    if (req.seed != null) body.seed = req.seed;
    if (req.generateAudio) body.generate_audio = true;
    if (req.returnLastFrame) body.return_last_frame = true;
    const imgs = [...(req.imageUrls ?? []), ...(req.images ?? []).map((i) => i.url)];
    if (imgs.length) body.image_urls = imgs;
    if (req.videoUrls?.length) body.video_urls = req.videoUrls;
    if (req.audioUrls?.length) body.audio_urls = req.audioUrls;
    return body;
  }
}
