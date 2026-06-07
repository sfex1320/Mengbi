import { app, type WebContents } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { register, ok, err, appendNotification } from './helpers';
import { VideoGenerateSchema, VideoCancelSchema, VideoSaveThumbSchema } from './schemas';
import { getDb } from '../services/db';
import { decryptString } from '../services/safeStorage';
import { chromiumFetch } from '../services/httpClient';
import { thumbPathFor } from '../services/thumbnail';
import { logger } from '../services/logger';
import { makeError } from '@shared/error';
import type { VideoKind } from '@shared/domain';
import type { VideoGenerateInput, VideoProgressPayload, VideoDonePayload } from '@shared/ipc';

/**
 * AI 视频生成（异步：提交任务 → 轮询 → 下载 mp4 落盘 + 入图库）。
 * 三种协议（video_kind）：
 *   - kling   可灵代理型（中转站最主流）：POST {root}/kling/v1/videos/{text2video|image2video} → 轮询 .../{task_id}
 *   - sora    OpenAI Sora 原生：POST {base}/v1/videos → 轮询 GET /v1/videos/{id} → GET /v1/videos/{id}/content
 *   - unified 聚合站统一端点：POST {root}/video/generations → 轮询 → video.url / data[0].url
 * 各站字段差异用 body_overrides_json 顶层合并兜底（与 image 思路一致）。
 */

interface ResolvedVideoCfg {
  base_url: string;
  apiKey: string;
  actualModelId: string;
  video_kind: VideoKind;
  body_overrides_json: string | null;
}

const POLL_INTERVAL_MS = 8000;
const MAX_WAIT_MS = 600_000; // 10 分钟兜底

const activeTasks = new Map<string, AbortController>();

export function registerVideoHandlers(): void {
  register('api:video:generate', VideoGenerateSchema, async (input, event) => {
    const cfg = findVideoConfig(input.modelId);
    if (!cfg) {
      return err(
        makeError('VALIDATION_FAILED', `没找到视频模型「${input.modelId}」的配置`, {
          severity: 'toast',
          hint: '到「设置 → 视频模型」添加，并在模型映射里加入该显示名'
        })
      );
    }
    const taskId = randomUUID();
    const ctrl = new AbortController();
    activeTasks.set(taskId, ctrl);
    // 异步执行，不阻塞 IPC 返回；进度/完成走推送
    void runVideoTask(taskId, cfg, input, event.sender, ctrl.signal).finally(() =>
      activeTasks.delete(taskId)
    );
    return ok({ taskId });
  });

  register('api:video:cancel', VideoCancelSchema, async (taskId) => {
    const ctrl = activeTasks.get(taskId);
    if (ctrl) ctrl.abort();
    activeTasks.delete(taskId);
    return ok(true as const);
  });

  // 视频封面：渲染端抓首帧（webp dataURI）→ 这里写成图库缩略图 + 更新 images.thumbnail_path。
  // 失败一律 silent（封面是锦上添花，缺了不影响视频本身）。
  register('api:video:save-thumbnail', VideoSaveThumbSchema, async (input) => {
    const row = getDb().prepare(`SELECT file_path FROM images WHERE id = ?`).get(input.imageId) as
      | { file_path: string }
      | undefined;
    if (!row?.file_path) return err(makeError('VALIDATION_FAILED', '找不到该视频记录', { severity: 'silent' }));
    const m = input.dataUri.match(/^data:[^;]+;base64,(.*)$/);
    if (!m) return err(makeError('VALIDATION_FAILED', '封面数据无效', { severity: 'silent' }));
    const out = thumbPathFor(row.file_path);
    try {
      await fs.mkdir(path.dirname(out), { recursive: true });
      await sharp(Buffer.from(m[1], 'base64'), { failOn: 'none' })
        .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toFile(out);
      getDb().prepare(`UPDATE images SET thumbnail_path = ? WHERE id = ?`).run(out, input.imageId);
      return ok({ thumbnail: out });
    } catch (e) {
      logger.warn(`[video] save thumbnail failed: ${(e as Error).message}`);
      return err(makeError('FILE_PERMISSION', '封面写入失败', { severity: 'silent' }));
    }
  });
}

// ───────────────────────── 配置解析 ─────────────────────────

function findVideoConfig(modelDisplayId: string): ResolvedVideoCfg | null {
  const rows = getDb()
    .prepare(`SELECT * FROM api_configs WHERE type = 'video' ORDER BY id`)
    .all() as Array<{
    base_url: string;
    api_key_encrypted: string;
    model_mapping: string;
    video_kind: string | null;
    body_overrides_json: string | null;
  }>;
  for (const c of rows) {
    let map: Record<string, string> = {};
    try {
      map = JSON.parse(c.model_mapping || '{}');
    } catch {
      map = {};
    }
    if (map[modelDisplayId]) {
      const vk = c.video_kind;
      return {
        base_url: c.base_url,
        apiKey: decryptString(c.api_key_encrypted),
        actualModelId: map[modelDisplayId],
        video_kind: vk === 'kling' || vk === 'sora' || vk === 'unified' ? vk : 'kling',
        body_overrides_json: c.body_overrides_json ?? null
      };
    }
  }
  return null;
}

// ───────────────────────── 任务执行 ─────────────────────────

async function runVideoTask(
  taskId: string,
  cfg: ResolvedVideoCfg,
  input: VideoGenerateInput,
  sender: WebContents,
  signal: AbortSignal
): Promise<void> {
  const t0 = Date.now();
  const push = (ch: 'video:progress' | 'video:done', payload: VideoProgressPayload | VideoDonePayload): void => {
    if (!sender.isDestroyed()) sender.send(ch, payload);
  };
  const progress = (percent: number, phase: string): void => push('video:progress', { taskId, percent, phase });
  const done = (p: Omit<VideoDonePayload, 'taskId' | 'durationMs'>): void => {
    push('video:done', { taskId, durationMs: Date.now() - t0, ...p });
    // 与图片任务一致：异步完成/失败记入通知中心
    if (!sender.isDestroyed()) {
      appendNotification(sender, {
        channel: 'video:done',
        kind: p.ok ? 'success' : 'failure',
        message: p.ok ? '视频生成完成' : `视频生成失败：${p.error ?? ''}`
      });
    }
  };

  try {
    progress(3, '提交中');
    const kind = cfg.video_kind ?? 'kling';
    const bytes =
      kind === 'sora'
        ? await runSora(cfg, input, signal, progress)
        : await runKlingOrUnified(kind, cfg, input, signal, progress);
    if (signal.aborted) {
      done({ ok: false, error: '已取消' });
      return;
    }
    progress(95, '下载中');
    const { filePath, imageId } = await saveVideo(bytes, input.modelId, input.prompt);
    done({ ok: true, filePath, imageId });
  } catch (e) {
    if (signal.aborted) {
      done({ ok: false, error: '已取消' });
      return;
    }
    const msg = e instanceof Error ? e.message : String(e);
    logger.error('[video] task failed', e);
    done({ ok: false, error: msg });
  }
}

// ───────────────────────── 协议：kling / unified ─────────────────────────

async function runKlingOrUnified(
  kind: 'kling' | 'unified',
  cfg: ResolvedVideoCfg,
  input: VideoGenerateInput,
  signal: AbortSignal,
  progress: (p: number, phase: string) => void
): Promise<Buffer> {
  const root = stripV1(cfg.base_url);
  const p = input.params;
  const img = pickImage(p.image);
  const isI2V = !!img;

  let submitUrl: string;
  let body: Record<string, unknown>;
  if (kind === 'kling') {
    submitUrl = `${root}/kling/v1/videos/${isI2V ? 'image2video' : 'text2video'}`;
    body = {
      model_name: cfg.actualModelId,
      prompt: input.prompt,
      ...(input.negativePrompt ? { negative_prompt: input.negativePrompt } : {}),
      // kling 的 mode 是「质量档」std|pro（文/图生已由 URL 路径区分）；从用户填的 resolution 归一。
      mode: klingMode(p.resolution),
      aspect_ratio: str(p.aspect, '16:9'),
      duration: str(p.duration, '5'),
      ...(img ? { image: img } : {}),
      ...(pickImage(p.imageTail) ? { image_tail: pickImage(p.imageTail) } : {})
    };
  } else {
    submitUrl = `${root}/video/generations`;
    body = {
      model: cfg.actualModelId,
      prompt: input.prompt,
      ...(input.negativePrompt ? { negative_prompt: input.negativePrompt } : {}),
      duration: str(p.duration, '5'),
      aspect_ratio: str(p.aspect, '16:9'),
      resolution: str(p.resolution, '720p'),
      ...(img ? { image: img, image_url: img } : {})
    };
  }
  body = applyOverrides(body, cfg.body_overrides_json);

  const subRes = await chromiumFetch(submitUrl, {
    method: 'POST',
    headers: authHeaders(cfg.apiKey),
    body: JSON.stringify(body),
    signal
  });
  const subText = await subRes.text();
  if (!subRes.ok) throw new Error(`提交失败 HTTP ${subRes.status}：${subText.slice(0, 300)}`);
  const subJson = safeJson(subText);
  const taskId = extractTaskId(subJson);
  if (!taskId) throw new Error(`提交返回里找不到任务 id：${subText.slice(0, 300)}`);

  // 轮询
  const pollUrl =
    kind === 'kling' ? `${submitUrl}/${taskId}` : `${root}/video/generations/${taskId}`;
  const start = Date.now();
  progress(10, '排队中');
  for (;;) {
    if (signal.aborted) throw new Error('已取消');
    if (Date.now() - start > MAX_WAIT_MS) throw new Error('视频生成超时（10 分钟）');
    await sleep(POLL_INTERVAL_MS, signal);
    if (signal.aborted) throw new Error('已取消');
    const pr = await chromiumFetch(pollUrl, { method: 'GET', headers: authHeaders(cfg.apiKey), signal });
    const txt = await pr.text();
    if (!pr.ok) {
      // 个别站点轮询偶发 5xx，容忍继续
      logger.warn(`[video] poll HTTP ${pr.status}: ${txt.slice(0, 200)}`);
      continue;
    }
    const j = safeJson(txt);
    const st = extractStatus(j);
    const ramp = Math.min(90, 12 + Math.floor(((Date.now() - start) / MAX_WAIT_MS) * 80));
    progress(ramp, '生成中');
    if (st.state === 'failed') throw new Error(st.error || '上游报告生成失败');
    if (st.state === 'done') {
      const videoUrl = extractVideoUrl(j);
      if (!videoUrl) throw new Error('完成但未取到视频地址');
      // 公网 mp4 URL，下载不带鉴权头（避免个别 CDN 拒绝）
      const vr = await chromiumFetch(videoUrl, { method: 'GET', signal });
      if (!vr.ok) throw new Error(`下载视频失败 HTTP ${vr.status}`);
      return Buffer.from(await vr.arrayBuffer());
    }
  }
}

// ───────────────────────── 协议：OpenAI Sora ─────────────────────────

async function runSora(
  cfg: ResolvedVideoCfg,
  input: VideoGenerateInput,
  signal: AbortSignal,
  progress: (p: number, phase: string) => void
): Promise<Buffer> {
  const base = cfg.base_url.replace(/\/+$/, '');
  const apiBase = /\/v1$/i.test(base) ? base : `${base}/v1`;
  const p = input.params;
  let body: Record<string, unknown> = {
    model: cfg.actualModelId,
    prompt: input.prompt,
    size: str(p.size, str(p.resolution, '1280x720')),
    seconds: str(p.duration, '8'),
    ...(pickImage(p.image) ? { input_reference: pickImage(p.image) } : {})
  };
  body = applyOverrides(body, cfg.body_overrides_json);

  const subRes = await chromiumFetch(`${apiBase}/videos`, {
    method: 'POST',
    headers: authHeaders(cfg.apiKey),
    body: JSON.stringify(body),
    signal
  });
  const subText = await subRes.text();
  if (!subRes.ok) throw new Error(`提交失败 HTTP ${subRes.status}：${subText.slice(0, 300)}`);
  const subJson = safeJson(subText);
  const id = typeof subJson?.id === 'string' ? subJson.id : undefined;
  if (!id) throw new Error(`提交返回里找不到 video id：${subText.slice(0, 300)}`);

  const start = Date.now();
  progress(10, '排队中');
  for (;;) {
    if (signal.aborted) throw new Error('已取消');
    if (Date.now() - start > MAX_WAIT_MS) throw new Error('视频生成超时（10 分钟）');
    await sleep(POLL_INTERVAL_MS, signal);
    if (signal.aborted) throw new Error('已取消');
    const pr = await chromiumFetch(`${apiBase}/videos/${id}`, {
      method: 'GET',
      headers: authHeaders(cfg.apiKey),
      signal
    });
    const txt = await pr.text();
    if (!pr.ok) {
      logger.warn(`[video] sora poll HTTP ${pr.status}: ${txt.slice(0, 200)}`);
      continue;
    }
    const j = safeJson(txt);
    const status = String(j?.status ?? '');
    const pct = typeof j?.progress === 'number' ? Math.max(10, Math.min(92, j.progress)) : undefined;
    progress(pct ?? Math.min(90, 12 + Math.floor(((Date.now() - start) / MAX_WAIT_MS) * 80)), '生成中');
    if (status === 'failed') throw new Error(extractSoraError(j) || 'Sora 报告生成失败');
    if (status === 'completed') {
      const cr = await chromiumFetch(`${apiBase}/videos/${id}/content?variant=video`, {
        method: 'GET',
        headers: authHeaders(cfg.apiKey),
        signal
      });
      if (!cr.ok) throw new Error(`下载视频失败 HTTP ${cr.status}`);
      return Buffer.from(await cr.arrayBuffer());
    }
  }
}

// ───────────────────────── 落盘 + 入图库 ─────────────────────────

async function saveVideo(
  bytes: Buffer,
  modelId: string,
  prompt: string
): Promise<{ filePath: string; imageId?: number }> {
  const root = getVideoStorageRoot();
  const date = new Date().toISOString().slice(0, 10);
  const dir = path.join(root, date);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `video-${Date.now()}.mp4`);
  await fs.writeFile(filePath, bytes);
  let imageId: number | undefined;
  try {
    // 视频暂无缩略图（sharp 不解码视频），thumbnail_path 置 NULL；图库以 [video] 标记
    const r = getDb()
      .prepare(
        `INSERT INTO images(task_id, file_path, thumbnail_path, prompt_positive, prompt_negative, model_used, params_json, notes, created_at)
         VALUES(NULL, ?, NULL, ?, NULL, ?, NULL, ?, ?)`
      )
      .run(filePath, prompt || '', modelId, '[video] 智能画布生成', new Date().toISOString());
    imageId = Number(r.lastInsertRowid);
  } catch (e) {
    logger.warn(`[video] gallery insert failed: ${(e as Error).message}`);
  }
  return { filePath, imageId };
}

function getVideoStorageRoot(): string {
  const img = getDb().prepare(`SELECT value FROM settings WHERE key='image_storage_path'`).get() as
    | { value: string }
    | undefined;
  if (img?.value && img.value.trim()) return img.value;
  return path.join(app.getPath('userData'), 'images');
}

// ───────────────────────── 工具 ─────────────────────────

function authHeaders(key: string): Record<string, string> {
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' };
}

function stripV1(base: string): string {
  return base.replace(/\/+$/, '').replace(/\/v1$/i, '');
}

/** params 里取字符串/数字值（其它类型回退默认）。 */
function str(v: unknown, d: string): string {
  return typeof v === 'string' || typeof v === 'number' ? String(v) : d;
}

/** kling 的 mode 只接受 std|pro（质量档）；把用户填的 resolution（std/pro/720p/1080p…）归一。
 *  pro / 含 1080/1440/2k/4k → 'pro'；其余（含 720p、空、文/图生模式串）→ 'std'。 */
function klingMode(v: unknown): string {
  const s = typeof v === 'string' ? v.toLowerCase() : '';
  return s === 'pro' || /1080|1440|2k|4k/.test(s) ? 'pro' : 'std';
}

/** 图片入参：data:URI 去前缀留 base64（多数站点 kling.image 接受 base64 或 URL）；http URL 原样。 */
function pickImage(v: unknown): string | undefined {
  if (typeof v !== 'string' || !v) return undefined;
  if (v.startsWith('data:')) return v.replace(/^data:[^;]+;base64,/, '');
  return v;
}

function safeJson(text: string): Record<string, unknown> | undefined {
  try {
    const j = JSON.parse(text);
    return typeof j === 'object' && j !== null ? (j as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** 顶层合并 body_overrides_json（null 值删字段）。 */
function applyOverrides(body: Record<string, unknown>, json: string | null): Record<string, unknown> {
  if (!json || !json.trim()) return body;
  let ov: Record<string, unknown>;
  try {
    const parsed = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return body;
    ov = parsed as Record<string, unknown>;
  } catch {
    return body;
  }
  const merged: Record<string, unknown> = { ...body, ...ov };
  for (const k of Object.keys(merged)) {
    if (merged[k] === null || merged[k] === undefined) delete merged[k];
  }
  return merged;
}

/** 从提交响应里抠任务 id（兼容各家：data.task_id / task_id / id / request_id / data.id）。 */
function extractTaskId(j: Record<string, unknown> | undefined): string | undefined {
  if (!j) return undefined;
  const data = (j.data ?? {}) as Record<string, unknown>;
  const cands = [data.task_id, data.id, j.task_id, j.id, j.request_id, (j.task as Record<string, unknown> | undefined)?.id];
  for (const c of cands) if (typeof c === 'string' && c) return c;
  return undefined;
}

/** 归一各家轮询状态 → done / failed / pending。 */
function extractStatus(j: Record<string, unknown> | undefined): { state: 'done' | 'failed' | 'pending'; error?: string } {
  if (!j) return { state: 'pending' };
  const data = (j.data ?? {}) as Record<string, unknown>;
  const raw = String(
    data.task_status ?? data.status ?? data.state ?? j.status ?? j.state ?? ''
  ).toLowerCase();
  if (['succeed', 'success', 'succeeded', 'completed', 'done', 'finished'].includes(raw)) {
    return { state: 'done' };
  }
  if (['failed', 'fail', 'error', 'cancelled', 'canceled'].includes(raw)) {
    const msg =
      (data.task_status_msg as string | undefined) ??
      (j.error as string | undefined) ??
      (typeof j.error === 'object' && j.error ? ((j.error as Record<string, unknown>).message as string) : undefined);
    return { state: 'failed', error: msg };
  }
  return { state: 'pending' };
}

/** 从轮询响应里抠视频 URL（兼容 kling / 聚合站多种字段）。 */
function extractVideoUrl(j: Record<string, unknown> | undefined): string | undefined {
  if (!j) return undefined;
  const data = (j.data ?? {}) as Record<string, unknown>;
  // kling: data.task_result.videos[0].url
  const tr = (data.task_result ?? {}) as Record<string, unknown>;
  const klingVideos = tr.videos as Array<{ url?: string }> | undefined;
  if (klingVideos?.[0]?.url) return klingVideos[0].url;
  // 通用：video.url / data[0].url / videoUrl / url / output[0] / data.video_url / data.url
  const video = (j.video ?? data.video) as Record<string, unknown> | undefined;
  if (video && typeof video.url === 'string') return video.url;
  const arr = (j.data ?? j.output ?? j.videos) as unknown;
  if (Array.isArray(arr)) {
    const first = arr[0];
    if (typeof first === 'string') return first;
    if (first && typeof (first as Record<string, unknown>).url === 'string')
      return (first as Record<string, unknown>).url as string;
  }
  for (const cand of [j.videoUrl, j.url, data.video_url, data.url, data.videoUrl]) {
    if (typeof cand === 'string' && cand) return cand;
  }
  return undefined;
}

function extractSoraError(j: Record<string, unknown> | undefined): string | undefined {
  if (!j) return undefined;
  const e = j.error;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object') return (e as Record<string, unknown>).message as string | undefined;
  return undefined;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new Error('已取消'));
      },
      { once: true }
    );
  });
}
