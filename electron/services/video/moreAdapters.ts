/**
 * 新增视频适配器：Veo / Runway / fal（主进程）。基于 2026 调研的真实 API 形态实现，
 * 但**未经真机实测**——端点/字段以「视频模型配置中心」可改 + 请求体覆盖兜底为安全网。
 *
 *  - VeoAdapter    中转 OpenAI 兼容：POST {base}/v1/videos/generations，轮询 /{id}，取 video.url（复用 Generic 提交/轮询，仅改 buildBody）。
 *  - RunwayAdapter 官方/透传：camelCase，ratio 用分辨率串，必带 X-Runway-Version 头；t2v/i2v 分端点；轮询 /tasks/{id} 取 output[0]。
 *  - FalAdapter    fal 队列：Authorization: Key；POST queue.fal.run/{model_id}；用响应里的 status_url/response_url 轮询；结果 video.url。
 */

import { GenericVideoAdapter } from './seedanceAdapter';
import {
  joinUrl,
  safeJson,
  mergeBody,
  extractTaskId,
  extractVideoUrl,
  extractLastFrameUrl,
  extractError,
  type CreateTaskResult
} from './adapter';
import { chromiumFetch } from '../httpClient';
import { logger } from '../logger';
import type { VideoGenerationRequest, VideoTaskStatus } from '@shared/video';

function firstFrameOf(req: VideoGenerationRequest): string | undefined {
  const r = (req.images ?? []).find((i) => i.role === 'first_frame')?.url;
  return r || req.imageUrls?.[0];
}
function lastFrameOf(req: VideoGenerationRequest): string | undefined {
  return (req.images ?? []).find((i) => i.role === 'last_frame')?.url;
}
function refImagesOf(req: VideoGenerationRequest): string[] {
  return [...(req.imageUrls ?? []), ...(req.images ?? []).filter((i) => i.role === 'reference_image').map((i) => i.url)];
}

// ───────────────────────── Veo（中转 OpenAI 兼容）─────────────────────────

export class VeoAdapter extends GenericVideoAdapter {
  readonly id = 'veo';
  protected buildBody(req: VideoGenerationRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.ctx.actualModelId,
      prompt: req.prompt,
      aspect_ratio: req.aspectRatio,
      duration: req.duration
    };
    if (req.negativePrompt?.trim()) body.negative_prompt = req.negativePrompt;
    if (req.seed != null) body.seed = req.seed;
    if (req.generateAudio) body.generate_audio = true;
    const first = firstFrameOf(req);
    switch (req.mode) {
      case 'image_to_video':
      case 'continuous':
        if (first) body.image_url = first;
        break;
      case 'first_last_frame':
        if (first) body.first_frame = first;
        if (lastFrameOf(req)) body.last_frame = lastFrameOf(req);
        break;
      case 'reference_images': {
        const refs = refImagesOf(req);
        if (refs.length) body.reference_images = refs;
        break;
      }
      default:
        break;
    }
    return body;
  }
}

// ───────────────────────── Runway（官方 / 透传）─────────────────────────

const RUNWAY_VERSION = '2024-11-06';

/** 把比例映射成该模型支持的分辨率串（Runway ratio 用 'W:H' 分辨率，不接受 '16:9'）。 */
function mapRunwayRatio(aspect: string, resolutions: string[]): string {
  // 用户若直接填了分辨率串（含较大数字）就原样用
  if (/^\d{3,}:\d{3,}$/.test(aspect)) return aspect;
  const isPortrait = ['9:16', '3:4', '2:3'].includes(aspect);
  const isSquare = aspect === '1:1';
  const parse = (s: string): [number, number] => {
    const [w, h] = s.split(':').map((x) => Number(x));
    return [w || 0, h || 0];
  };
  const pick = (pred: (w: number, h: number) => boolean): string | undefined =>
    resolutions.find((r) => {
      const [w, h] = parse(r);
      return pred(w, h);
    });
  const byOrient = isSquare ? pick((w, h) => w === h) : isPortrait ? pick((w, h) => h > w) : pick((w, h) => w > h);
  if (byOrient) return byOrient;
  const fallback: Record<string, string> = {
    '16:9': '1280:720',
    '9:16': '720:1280',
    '1:1': '960:960',
    '4:3': '1104:832',
    '3:4': '832:1104',
    '21:9': '1584:672'
  };
  return fallback[aspect] ?? resolutions[0] ?? '1280:720';
}

export class RunwayAdapter extends GenericVideoAdapter {
  readonly id = 'runway';

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.ctx.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Runway-Version': RUNWAY_VERSION
    };
  }

  protected buildBody(req: VideoGenerationRequest): Record<string, unknown> {
    const resolutions = this.ctx.model?.limits.supportedResolutions ?? [];
    const body: Record<string, unknown> = {
      model: this.ctx.actualModelId,
      promptText: req.prompt,
      ratio: mapRunwayRatio(req.aspectRatio, resolutions),
      duration: req.duration
    };
    if (req.seed != null) body.seed = req.seed;
    const first = firstFrameOf(req);
    if (req.mode === 'first_last_frame') {
      const arr: Array<{ uri: string; position: string }> = [];
      if (first) arr.push({ uri: first, position: 'first' });
      if (lastFrameOf(req)) arr.push({ uri: lastFrameOf(req) as string, position: 'last' });
      if (arr.length) body.promptImage = arr;
    } else if (req.mode === 'reference_images') {
      const refs = refImagesOf(req);
      if (refs[0]) body.promptImage = refs[0];
      if (refs.length) body.references = refs.map((uri) => ({ type: 'image', uri }));
    } else if (req.mode === 'image_to_video' || req.mode === 'continuous') {
      if (first) body.promptImage = first;
    }
    return body;
  }

  async createTask(req: VideoGenerationRequest): Promise<CreateTaskResult> {
    const { provider, baseUrl, bodyOverridesJson, signal } = this.ctx;
    const isImage = req.mode !== 'text_to_video';
    const prefix = joinUrl(baseUrl, provider.generationEndpoint);
    const url = `${prefix.replace(/\/+$/, '')}/${isImage ? 'image_to_video' : 'text_to_video'}`;
    const body = mergeBody(this.buildBody(req), bodyOverridesJson, req.advanced);
    const res = await chromiumFetch(url, { method: 'POST', headers: this.headers(), body: JSON.stringify(body), signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`提交失败 HTTP ${res.status}：${text.slice(0, 300)}`);
    const j = safeJson(text);
    const taskId = (typeof j?.id === 'string' && j.id) || extractTaskId(j);
    if (!taskId) throw new Error(`提交返回里找不到任务 id：${text.slice(0, 300)}`);
    return { taskId, status: { state: 'submitted', raw: j } };
  }

  async pollTask(taskId: string): Promise<VideoTaskStatus> {
    const { provider, baseUrl, signal } = this.ctx;
    const url = `${joinUrl(baseUrl, provider.taskQueryEndpoint).replace(/\/+$/, '')}/${encodeURIComponent(taskId)}`;
    const res = await chromiumFetch(url, { method: 'GET', headers: this.headers(), signal });
    const text = await res.text();
    if (!res.ok) {
      logger.warn(`[video:runway] poll HTTP ${res.status}: ${text.slice(0, 200)}`);
      return { state: 'processing' };
    }
    return this.normalizeResponse(safeJson(text));
  }
}

// ───────────────────────── fal.ai 队列 ─────────────────────────

export class FalAdapter extends GenericVideoAdapter {
  readonly id = 'fal';
  private statusUrl = '';
  private responseUrl = '';
  private cancelUrl = '';

  private headers(): Record<string, string> {
    return {
      Authorization: `Key ${this.ctx.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    };
  }

  protected buildBody(req: VideoGenerationRequest): Record<string, unknown> {
    const slug = this.ctx.actualModelId.toLowerCase();
    const first = firstFrameOf(req);
    const body: Record<string, unknown> = { prompt: req.prompt };
    if (slug.includes('veo')) {
      body.aspect_ratio = req.aspectRatio;
      body.duration = `${req.duration}s`;
      if (req.resolution) body.resolution = req.resolution;
      if (req.generateAudio) body.generate_audio = true;
      if (first) body.image_url = first;
      const refs = refImagesOf(req);
      if (req.mode === 'reference_images' && refs.length) body.image_urls = refs;
    } else if (slug.includes('minimax') || slug.includes('hailuo')) {
      body.duration = String(req.duration);
      body.prompt_optimizer = true;
    } else {
      // 默认按 Kling 风格
      body.duration = String(req.duration);
      body.aspect_ratio = req.aspectRatio;
      if (req.negativePrompt?.trim()) body.negative_prompt = req.negativePrompt;
      if (first) body.image_url = first;
      if (lastFrameOf(req)) body.tail_image_url = lastFrameOf(req);
      if (req.generateAudio) body.generate_audio = true;
    }
    return body;
  }

  async createTask(req: VideoGenerationRequest): Promise<CreateTaskResult> {
    const { baseUrl, actualModelId, bodyOverridesJson, signal } = this.ctx;
    const url = `${baseUrl.replace(/\/+$/, '')}/${actualModelId.replace(/^\/+/, '')}`;
    const body = mergeBody(this.buildBody(req), bodyOverridesJson, req.advanced);
    const res = await chromiumFetch(url, { method: 'POST', headers: this.headers(), body: JSON.stringify(body), signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`提交失败 HTTP ${res.status}：${text.slice(0, 300)}`);
    const j = safeJson(text);
    this.statusUrl = (j?.status_url as string) ?? '';
    this.responseUrl = (j?.response_url as string) ?? '';
    this.cancelUrl = (j?.cancel_url as string) ?? '';
    const taskId = (j?.request_id as string) ?? extractTaskId(j);
    if (!taskId) throw new Error(`提交返回里找不到 request_id：${text.slice(0, 300)}`);
    return { taskId, status: { state: 'submitted', raw: j } };
  }

  async pollTask(taskId: string): Promise<VideoTaskStatus> {
    const { baseUrl, actualModelId, signal } = this.ctx;
    const base = `${baseUrl.replace(/\/+$/, '')}/${actualModelId.replace(/^\/+/, '')}/requests/${encodeURIComponent(taskId)}`;
    const statusUrl = this.statusUrl || `${base}/status`;
    const sres = await chromiumFetch(statusUrl, { method: 'GET', headers: this.headers(), signal });
    const stext = await sres.text();
    if (!sres.ok) {
      logger.warn(`[video:fal] status HTTP ${sres.status}: ${stext.slice(0, 200)}`);
      return { state: 'processing' };
    }
    const sj = safeJson(stext);
    if (sj?.error || sj?.error_type) return { state: 'failed', error: extractError(sj) ?? 'fal 报告失败', raw: sj };
    const status = String(sj?.status ?? '').toUpperCase();
    if (status !== 'COMPLETED') {
      return { state: 'processing', raw: sj };
    }
    // 完成 → 取结果端点
    const resultUrl = this.responseUrl || base;
    const rres = await chromiumFetch(resultUrl, { method: 'GET', headers: this.headers(), signal });
    const rtext = await rres.text();
    if (!rres.ok) throw new Error(`取结果失败 HTTP ${rres.status}：${rtext.slice(0, 200)}`);
    const rj = safeJson(rtext);
    const videoUrl = extractVideoUrl(rj);
    if (!videoUrl) throw new Error(`完成但未取到视频地址：${rtext.slice(0, 200)}`);
    return { state: 'succeeded', videoUrl, lastFrameUrl: extractLastFrameUrl(rj), raw: rj };
  }

  async cancelTask(taskId: string): Promise<void> {
    const url = this.cancelUrl;
    if (!url) return;
    try {
      await chromiumFetch(url, { method: 'PUT', headers: this.headers(), signal: this.ctx.signal });
    } catch (e) {
      logger.warn(`[video:fal] cancel best-effort failed: ${(e as Error).message}`);
    }
    void taskId;
  }
}
