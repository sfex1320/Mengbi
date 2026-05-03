import { z } from 'zod';
import { app } from 'electron';
import type { WebContents } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { register, ok, err } from './helpers';
import { ImageGenerateSchema } from './schemas';
import { getDb } from '../services/db';
import { decryptString } from '../services/safeStorage';
import { joinApiUrl } from '../services/apiUrl';
import { logger } from '../services/logger';
import { makeError } from '@shared/error';
import { isMockMode } from './mocks/runtime';
import {
  parseFilenameTemplate,
  applyFilenameTemplate,
  type FilenameContext
} from '@shared/filenameTemplate';

// ─────────────────────────────────────────────────────
// 任务队列（最小可用：FIFO 顺序执行）
// ─────────────────────────────────────────────────────

interface QueueItem {
  taskId: number;
  cancel: AbortController;
  sender: WebContents;
}

const queue: QueueItem[] = [];
let running = false;

function enqueue(taskId: number, sender: WebContents): void {
  const ctrl = new AbortController();
  queue.push({ taskId, cancel: ctrl, sender });
  void drainQueue();
}

async function drainQueue(): Promise<void> {
  if (running) return;
  running = true;
  while (queue.length > 0) {
    const item = queue.shift()!;
    await executeTask(item).catch((e) => {
      logger.error('image task fatal', e);
    });
  }
  running = false;
}

function cancelTask(taskId: number): boolean {
  const idx = queue.findIndex((q) => q.taskId === taskId);
  if (idx >= 0) {
    queue[idx].cancel.abort();
    queue.splice(idx, 1);
    getDb()
      .prepare(
        `UPDATE generation_tasks SET status = 'cancelled' WHERE id = ? AND status IN ('pending','running')`
      )
      .run(taskId);
    return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────
// IPC 注册
// ─────────────────────────────────────────────────────

export function registerGenerateHandlers(): void {
  register('api:image:generate', ImageGenerateSchema, async (input, event) => {
    logger.info('image.generate received', {
      modelId: input.modelId,
      promptHead: input.positivePrompt.slice(0, 60),
      params: input.params,
      refsCount: input.referenceImages?.length ?? 0
    });
    const now = new Date().toISOString();
    const result = getDb()
      .prepare(
        `INSERT INTO generation_tasks(model_id, positive_prompt, negative_prompt, params, reference_images, status, created_at)
         VALUES(?, ?, ?, ?, ?, 'pending', ?)`
      )
      .run(
        input.modelId,
        input.positivePrompt,
        input.negativePrompt ?? null,
        JSON.stringify(input.params),
        input.referenceImages ? JSON.stringify(input.referenceImages) : null,
        now
      );
    const taskId = Number(result.lastInsertRowid);
    enqueue(taskId, event.sender);
    return ok({ taskId });
  });

  register('api:image:status', z.number().int(), async (taskId) => {
    const row = getDb()
      .prepare(`SELECT status, result_paths, error_message FROM generation_tasks WHERE id = ?`)
      .get(taskId) as { status: string; result_paths: string | null; error_message: string | null } | undefined;
    if (!row) return err(makeError('FILE_NOT_FOUND', `任务 ${taskId} 不存在`, { severity: 'toast' }));
    return ok({
      status: row.status,
      result_paths: row.result_paths ? (JSON.parse(row.result_paths) as string[]) : []
    });
  });

  register('api:image:cancel', z.number().int(), async (taskId) => {
    const cancelled = cancelTask(taskId);
    return ok(cancelled as true);
  });

  register('api:image:queue', null, async () => {
    const rows = getDb()
      .prepare(
        `SELECT id, model_id, positive_prompt, status, created_at, result_paths
           FROM generation_tasks
          WHERE status IN ('pending','running','done','failed','cancelled')
          ORDER BY id DESC LIMIT 50`
      )
      .all();
    return ok(rows);
  });

  register(
    'api:image:reorder',
    z.object({ taskIds: z.array(z.number().int()) }),
    async () => ok(true as const)
  );
}

// ─────────────────────────────────────────────────────
// 任务执行
// ─────────────────────────────────────────────────────

async function executeTask(item: QueueItem): Promise<void> {
  const send = (channel: string, payload: unknown): void => {
    if (!item.sender.isDestroyed()) item.sender.send(channel, payload);
  };

  const task = getDb()
    .prepare(`SELECT * FROM generation_tasks WHERE id = ?`)
    .get(item.taskId) as
    | {
        id: number;
        model_id: string;
        positive_prompt: string;
        negative_prompt: string | null;
        params: string;
        reference_images: string | null;
      }
    | undefined;
  if (!task) return;

  getDb().prepare(`UPDATE generation_tasks SET status = 'running' WHERE id = ?`).run(item.taskId);
  send('image:progress', { taskId: item.taskId, status: 'running' });

  try {
    let savedPaths: string[];
    if (isMockMode()) {
      savedPaths = await runMockGenerate(item.taskId);
    } else {
      const cfg = findImageConfig(task.model_id);
      if (!cfg) {
        throw new Error(`未找到模型「${task.model_id}」的绘画配置`);
      }
      const params = JSON.parse(task.params) as Record<string, unknown>;
      const refs = task.reference_images
        ? (JSON.parse(task.reference_images) as string[])
        : [];
      // 根据 image_kind 派发到不同协议
      if (cfg.image_kind === 'grsai') {
        savedPaths = await runGrsaiImage({
          cfg,
          positivePrompt: task.positive_prompt,
          params,
          referenceImages: refs,
          taskId: item.taskId,
          signal: item.cancel.signal
        });
      } else if (refs.length > 0) {
        // OpenAI 标准：带参考图走 /v1/images/edits（multipart）
        savedPaths = await runOpenAIImageEdit({
          cfg,
          positivePrompt: task.positive_prompt,
          params,
          referenceImages: refs,
          taskId: item.taskId,
          signal: item.cancel.signal
        });
      } else {
        savedPaths = await runOpenAIImage({
          cfg,
          positivePrompt: task.positive_prompt,
          params,
          taskId: item.taskId,
          signal: item.cancel.signal
        });
      }
    }

    // 写入 images 表
    const now = new Date().toISOString();
    for (let i = 0; i < savedPaths.length; i++) {
      getDb()
        .prepare(
          `INSERT INTO images(task_id, file_path, prompt_positive, prompt_negative, model_used, params_json, created_at)
           VALUES(?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          item.taskId,
          savedPaths[i],
          task.positive_prompt,
          task.negative_prompt,
          task.model_id,
          task.params,
          now
        );
    }
    getDb()
      .prepare(
        `UPDATE generation_tasks SET status = 'done', result_paths = ? WHERE id = ?`
      )
      .run(JSON.stringify(savedPaths), item.taskId);
    send('image:done', { taskId: item.taskId, paths: savedPaths });
  } catch (e) {
    const aborted = (e as Error).name === 'AbortError' || item.cancel.signal.aborted;
    if (aborted) {
      getDb().prepare(`UPDATE generation_tasks SET status = 'cancelled' WHERE id = ?`).run(item.taskId);
      send('image:done', { taskId: item.taskId, cancelled: true });
    } else {
      const msg = (e as Error).message || String(e);
      getDb()
        .prepare(`UPDATE generation_tasks SET status = 'failed', error_message = ? WHERE id = ?`)
        .run(msg, item.taskId);
      send('image:done', { taskId: item.taskId, error: msg });
    }
  }
}

interface ResolvedImageCfg {
  base_url: string;
  api_key_encrypted: string;
  actualModelId: string;
  image_kind: string | null;
}

function findImageConfig(modelDisplayId: string): ResolvedImageCfg | null {
  const configs = getDb()
    .prepare(`SELECT * FROM api_configs WHERE type = 'image' ORDER BY id`)
    .all() as Array<{
    base_url: string;
    api_key_encrypted: string;
    model_mapping: string;
    image_kind: string | null;
  }>;
  for (const c of configs) {
    let map: Record<string, string> = {};
    try {
      map = JSON.parse(c.model_mapping || '{}');
    } catch {
      map = {};
    }
    if (map[modelDisplayId]) {
      return {
        base_url: c.base_url,
        api_key_encrypted: c.api_key_encrypted,
        actualModelId: map[modelDisplayId],
        image_kind: c.image_kind ?? null
      };
    }
  }
  return null;
}

interface OpenAIImageOpts {
  cfg: ResolvedImageCfg;
  positivePrompt: string;
  params: Record<string, unknown>;
  taskId: number;
  signal: AbortSignal;
}

interface GrsaiImageOpts extends OpenAIImageOpts {
  referenceImages: string[];
}

// ─────────────────────────────────────────────────────
// 比例 → 像素尺寸（OpenAI 标准协议）
// 参考：绘图模型配置规则/GPT-Image-2-配置规则.md §2.2
//
// 档位（image_size）按"总像素"算，而不是单边：
//   1K → 1 MP   ≈ 1024×1024
//   2K → 4 MP   ≈ 2048×2048
//   4K → 8.3 MP ≈ 4K UHD（3840×2160 在 16:9 下完美对齐）
// 这样 4K + 9:16 不会爆 GPT Image 2 的 8.3MP 上限。
// ─────────────────────────────────────────────────────
const ASPECT_TO_SIZE: Record<string, string> = {
  '1:1': '1024x1024',
  '4:5': '1024x1280',
  '5:4': '1280x1024',
  '3:4': '1152x1536',
  '4:3': '1536x1152',
  '2:3': '1024x1536',
  '3:2': '1536x1024',
  '9:16': '1152x2048',
  '16:9': '2048x1152',
  '21:9': '1680x720',
  '9:21': '720x1680',
  '4:1': '2048x512',
  '1:4': '512x2048',
  '8:1': '2048x256',
  '1:8': '256x2048',
  '2:1': '1536x768',
  '1:2': '768x1536',
  '3:1': '1920x640',
  '1:3': '640x1920'
};

const TIER_PIXEL_BUDGET: Record<string, number> = {
  '1K': 1_048_576, // 1 MP
  '2K': 4_194_304, // 4 MP
  '4K': 8_294_400  // 8.3 MP
};

function snapToGrid(value: number): number {
  const snapped = Math.round(value / 16) * 16;
  return Math.max(256, Math.min(3840, snapped));
}

/** 给定比例字符串 + 总像素预算，反推 W×H（snap 到 16） */
function pixelsByAspectAndBudget(aspect: string, totalPx: number): { w: number; h: number } {
  const [aw, ah] = aspect.split(':').map(Number);
  if (!Number.isFinite(aw) || !Number.isFinite(ah) || aw <= 0 || ah <= 0) {
    const side = Math.sqrt(totalPx);
    return { w: snapToGrid(side), h: snapToGrid(side) };
  }
  const h = Math.sqrt((totalPx * ah) / aw);
  const w = (h * aw) / ah;
  return { w: snapToGrid(w), h: snapToGrid(h) };
}

/**
 * 解析 params 拿到最终 size 字符串。
 * 优先级：custom W×H > image_size 档位（按总像素） > aspect 比例预设 > 默认 1024x1024
 */
function resolveSize(params: Record<string, unknown>): string {
  const w = Number(params.width);
  const h = Number(params.height);
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    return `${snapToGrid(w)}x${snapToGrid(h)}`;
  }
  const imageSize = typeof params.image_size === 'string' ? params.image_size : '';
  const aspect = typeof params.aspect === 'string' ? params.aspect : '1:1';
  const budget = TIER_PIXEL_BUDGET[imageSize];
  if (budget) {
    const { w: cw, h: ch } = pixelsByAspectAndBudget(aspect, budget);
    return `${cw}x${ch}`;
  }
  return ASPECT_TO_SIZE[aspect] ?? '1024x1024';
}

async function runOpenAIImage(opts: OpenAIImageOpts): Promise<string[]> {
  const url = joinApiUrl(opts.cfg.base_url, 'images/generations');
  const apiKey = decryptString(opts.cfg.api_key_encrypted);

  const size = resolveSize(opts.params);
  logger.info('runOpenAIImage', {
    url,
    model: opts.cfg.actualModelId,
    size,
    paramsAspect: opts.params.aspect,
    paramsImageSize: opts.params.image_size,
    paramsW: opts.params.width,
    paramsH: opts.params.height
  });
  const n = typeof opts.params.n === 'number' ? opts.params.n : 1;
  const quality = typeof opts.params.quality === 'string' ? opts.params.quality : undefined;

  const body: Record<string, unknown> = {
    model: opts.cfg.actualModelId,
    prompt: opts.positivePrompt,
    size,
    n,
    response_format: 'b64_json'
  };
  if (quality === 'standard' || quality === 'high') body.quality = quality;
  // Nano Banana 系列只认 aspect_ratio / image_size，OpenAI 也兼容 size，
  // 因此同时透传 aspect_ratio 让上游中转站自己挑。
  if (typeof opts.params.aspect === 'string') {
    body.aspect_ratio = opts.params.aspect;
  }
  if (
    opts.params.image_size === '1K' ||
    opts.params.image_size === '2K' ||
    opts.params.image_size === '4K'
  ) {
    body.image_size = opts.params.image_size;
    // image_size 与 aspect_ratio 互斥，删掉 aspect_ratio
    delete body.aspect_ratio;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body),
    signal: opts.signal
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  const respJson = (await parseJsonOrSse(res)) as {
    data?: Array<{ b64_json?: string; url?: string }>;
  };
  if (!respJson.data?.length) throw new Error('上游未返回图片');

  const saved: string[] = [];
  for (let i = 0; i < respJson.data.length; i++) {
    const item = respJson.data[i];
    let buf: Buffer;
    if (item.b64_json) {
      buf = Buffer.from(item.b64_json, 'base64');
    } else if (item.url) {
      const r = await fetch(item.url, { signal: opts.signal });
      if (!r.ok) throw new Error(`下载图片失败 HTTP ${r.status}`);
      buf = Buffer.from(await r.arrayBuffer());
    } else {
      throw new Error('图片数据格式不明');
    }
    const filePath = saveImage(buf, opts.taskId, i + 1, {
      prompt: opts.positivePrompt,
      model: opts.cfg.actualModelId,
      aspect: typeof opts.params.aspect === 'string' ? opts.params.aspect : undefined
    });
    saved.push(filePath);
  }
  return saved;
}

/**
 * 把 fetch Response 解析为 JSON。
 * 兼容两种上游：
 *   - 标准 JSON 一次性返回（默认情况）
 *   - 部分中转站把图像生成接口当 SSE 回包（Content-Type: text/event-stream），
 *     里面是 `data: {...}\n\ndata: {...}\n\n[DONE]` 的形式。
 * 第二种情况下，挑最后一条带 `data` 字段（含图片）的合法 JSON。
 */
async function parseJsonOrSse(res: Response): Promise<unknown> {
  const text = await res.text();
  // 先尝试整体当 JSON 解析
  try {
    return JSON.parse(text);
  } catch {
    /* 落到 SSE 解析 */
  }
  // SSE 模式：扫所有 `data:` 行，挑最后一条带 results / data / url 的
  let lastJson: Record<string, unknown> | null = null;
  for (const line of text.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const j = JSON.parse(payload) as Record<string, unknown>;
      lastJson = j;
    } catch {
      /* 跳过非 JSON 行 */
    }
  }
  if (!lastJson) {
    throw new Error(
      `上游响应既不是合法 JSON 也不是可解析的 SSE：${text.slice(0, 200)}`
    );
  }
  return lastJson;
}

// ─────────────────────────────────────────────────────
// OpenAI /v1/images/edits（multipart）—— 带参考图的生图入口
// 参考：https://platform.openai.com/docs/api-reference/images/createEdit
// 兼容 gpt-image-1 / gpt-image-2 等支持图入的模型
// ─────────────────────────────────────────────────────
interface OpenAIEditOpts extends OpenAIImageOpts {
  referenceImages: string[];
}

async function runOpenAIImageEdit(opts: OpenAIEditOpts): Promise<string[]> {
  const url = joinApiUrl(opts.cfg.base_url, 'images/edits');
  const apiKey = decryptString(opts.cfg.api_key_encrypted);

  const size = resolveSize(opts.params);
  const n = typeof opts.params.n === 'number' ? opts.params.n : 1;
  const quality = typeof opts.params.quality === 'string' ? opts.params.quality : undefined;

  // FormData / Blob 是 Node 18+ / Electron 28 内置全局
  const form = new FormData();
  form.append('model', opts.cfg.actualModelId);
  form.append('prompt', opts.positivePrompt);
  form.append('size', size);
  form.append('n', String(n));
  if (quality === 'standard' || quality === 'high') form.append('quality', quality);

  // 多张参考图：用 image[] 字段（OpenAI gpt-image-1 支持）
  let attached = 0;
  for (const refPath of opts.referenceImages) {
    try {
      const buf = await fs.promises.readFile(refPath);
      const ext = path.extname(refPath).toLowerCase();
      const mime = REF_EXT_TO_MIME[ext] ?? 'image/png';
      const blob = new Blob([buf], { type: mime });
      form.append('image[]', blob, path.basename(refPath));
      attached++;
    } catch (e) {
      logger.warn('image edit: failed to attach ref', refPath);
    }
  }
  if (attached === 0) {
    throw new Error('参考图全部读取失败，无法走 /v1/images/edits 接口');
  }

  logger.info('openai.images.edits.request', {
    url,
    model: opts.cfg.actualModelId,
    refs: attached,
    size
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: opts.signal
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} on /v1/images/edits: ${text.slice(0, 300)}`);
  }

  const respJson = (await parseJsonOrSse(res)) as {
    data?: Array<{ b64_json?: string; url?: string }>;
  };
  if (!respJson.data?.length) throw new Error('上游未返回图片');

  const saved: string[] = [];
  for (let i = 0; i < respJson.data.length; i++) {
    const item = respJson.data[i];
    let buf: Buffer;
    if (item.b64_json) {
      buf = Buffer.from(item.b64_json, 'base64');
    } else if (item.url) {
      const r = await fetch(item.url, { signal: opts.signal });
      if (!r.ok) throw new Error(`下载图片失败 HTTP ${r.status}`);
      buf = Buffer.from(await r.arrayBuffer());
    } else {
      throw new Error('图片数据格式不明');
    }
    saved.push(
      saveImage(buf, opts.taskId, i + 1, {
        prompt: opts.positivePrompt,
        model: opts.cfg.actualModelId,
        aspect: typeof opts.params.aspect === 'string' ? opts.params.aspect : undefined
      })
    );
  }
  return saved;
}

// ─────────────────────────────────────────────────────
// grsai 自有协议
// 参考：https://grsai.com/zh/dashboard/documents/gpt-image
//      https://grsai.com/dashboard/documents/nano-banana
//
// 重要：grsai 按模型族走不同 endpoint
//   - nano-banana 系列  → POST /v1/draw/nano-banana
//   - 其它（gpt-image / sora-image / 等） → POST /v1/draw/completions
//
// 同步模式：shutProgress=true，直接返回 results[].url；
// 异步模式：webHook="-1"，先拿 task id 再轮询 /v1/draw/result。
// 我们用同步模式以简化客户端；超时/失败由 fetch.signal 控制。
// ─────────────────────────────────────────────────────
interface GrsaiResponse {
  status?: string;
  id?: string;
  results?: Array<{ url?: string }>;
  error?: string;
  message?: string;
  msg?: string;
  code?: number;
}

function pickGrsaiEndpoint(modelId: string): string {
  const lower = modelId.toLowerCase();
  if (lower.includes('nano-banana') || lower.includes('nanobanana')) {
    return 'draw/nano-banana';
  }
  return 'draw/completions';
}

const REF_EXT_TO_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
};

async function refsToUploadable(refs: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const r of refs) {
    if (r.startsWith('http://') || r.startsWith('https://') || r.startsWith('data:')) {
      out.push(r);
      continue;
    }
    // 当作本地路径读出，转 data URI
    try {
      const buf = await fs.promises.readFile(r);
      const ext = path.extname(r).toLowerCase();
      const mime = REF_EXT_TO_MIME[ext] ?? 'application/octet-stream';
      out.push(`data:${mime};base64,${buf.toString('base64')}`);
    } catch (e) {
      logger.warn('refsToUploadable: failed to read', r);
    }
  }
  return out;
}

async function runGrsaiImage(opts: GrsaiImageOpts): Promise<string[]> {
  const endpoint = pickGrsaiEndpoint(opts.cfg.actualModelId);
  const url = joinApiUrl(opts.cfg.base_url, endpoint);
  const apiKey = decryptString(opts.cfg.api_key_encrypted);

  // grsai 文档：aspectRatio 既支持 "16:9" 这种比例，也支持 "1024x1024" 这种像素值。
  // 所以：自定义 W×H / 1K-2K-4K 档位 → 直接转成 "WxH" 给 aspectRatio
  //        纯比例 → 原样传 "16:9"
  const w = Number(opts.params.width);
  const h = Number(opts.params.height);
  const tier = TIER_PIXEL_BUDGET[String(opts.params.image_size ?? '')];
  let aspectField: string;
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    aspectField = `${snapToGrid(w)}x${snapToGrid(h)}`;
  } else if (tier) {
    const aspect = typeof opts.params.aspect === 'string' ? opts.params.aspect : '1:1';
    const { w: cw, h: ch } = pixelsByAspectAndBudget(aspect, tier);
    aspectField = `${cw}x${ch}`;
  } else {
    aspectField = typeof opts.params.aspect === 'string' ? opts.params.aspect : '1:1';
  }

  const n = typeof opts.params.n === 'number' ? opts.params.n : 1;
  const uploadable = await refsToUploadable(opts.referenceImages);

  const body: Record<string, unknown> = {
    model: opts.cfg.actualModelId,
    prompt: opts.positivePrompt,
    urls: uploadable,
    shutProgress: true,
    aspectRatio: aspectField
  };
  if (n > 1) body.n = n;

  logger.info('grsai.draw.request', {
    url,
    model: opts.cfg.actualModelId,
    endpoint,
    aspectRatio: aspectField,
    refs: opts.referenceImages.length
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body),
    signal: opts.signal
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `grsai HTTP ${res.status} on ${endpoint}: ${text.slice(0, 300)}`
    );
  }

  const json = (await parseJsonOrSse(res)) as GrsaiResponse;
  // grsai 不同接口的 status 表达不一，能拿到 results 就当成功
  const urls = (json.results ?? [])
    .map((r) => r.url)
    .filter((u): u is string => typeof u === 'string' && u.length > 0);
  if (urls.length === 0) {
    if (json.status && json.status !== 'succeeded' && json.status !== 'success') {
      throw new Error(
        `grsai 未成功（status=${json.status}）：${json.error ?? json.msg ?? json.message ?? ''}`
      );
    }
    throw new Error(`grsai 未返回图片 URL：${json.msg ?? json.message ?? ''}`);
  }

  const saved: string[] = [];
  for (let i = 0; i < urls.length; i++) {
    const r = await fetch(urls[i], { signal: opts.signal });
    if (!r.ok) throw new Error(`下载 grsai 图片失败 HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    saved.push(
      saveImage(buf, opts.taskId, i + 1, {
        prompt: opts.positivePrompt,
        model: opts.cfg.actualModelId,
        aspect: typeof opts.params.aspect === 'string' ? opts.params.aspect : undefined
      })
    );
  }
  return saved;
}

async function runMockGenerate(taskId: number): Promise<string[]> {
  // 简单 1024x1024 SVG 渐变占位（实际需要 PNG，但 SVG 也能在 <img> 显示）
  const colors = [
    ['#fb923c', '#ea580c'],
    ['#a855f7', '#7e22ce'],
    ['#10b981', '#047857'],
    ['#3b82f6', '#1d4ed8'],
    ['#f43f5e', '#be123c']
  ];
  const [c1, c2] = colors[taskId % colors.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>
    <radialGradient id="g" cx="50%" cy="50%" r="80%">
      <stop offset="0%" stop-color="${c1}" stop-opacity="1"/>
      <stop offset="100%" stop-color="${c2}" stop-opacity="1"/>
    </radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <text x="50%" y="50%" font-family="sans-serif" font-size="48" fill="white" text-anchor="middle" dy=".3em">mock #${taskId}</text>
</svg>`;
  await new Promise((r) => setTimeout(r, 1200 + Math.random() * 800));
  const filePath = saveSvgAsFile(svg, taskId, 1);
  return [filePath];
}

function getStorageRoot(): string {
  const row = getDb().prepare(`SELECT value FROM settings WHERE key='image_storage_path'`).get() as
    | { value: string }
    | undefined;
  if (row?.value) return row.value;
  return path.join(app.getPath('userData'), 'images');
}

interface SaveCtx {
  prompt?: string;
  model?: string;
  width?: number;
  height?: number;
  aspect?: string;
}

function getFilenameTemplate(): ReturnType<typeof parseFilenameTemplate> {
  const row = getDb()
    .prepare(`SELECT value FROM settings WHERE key = 'image_filename_template'`)
    .get() as { value: string } | undefined;
  return parseFilenameTemplate(row?.value);
}

/** 保留旧签名做兼容；新签名带 ctx 用模板算文件名 */
function saveImage(buf: Buffer, taskId: number, seq: number, ctx?: SaveCtx): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const dir = path.join(getStorageRoot(), date);
  fs.mkdirSync(dir, { recursive: true });

  // 量一下图的真实尺寸
  let realW = ctx?.width ?? 0;
  let realH = ctx?.height ?? 0;
  if ((!realW || !realH) && buf.length > 0) {
    try {
      const probed = probePngSize(buf);
      if (probed) {
        realW = probed.w;
        realH = probed.h;
      }
    } catch {
      /* ignore */
    }
  }

  const tpl = getFilenameTemplate();
  const fnCtx: FilenameContext = {
    taskId,
    seq,
    width: realW,
    height: realH,
    aspect: ctx?.aspect,
    prompt: ctx?.prompt,
    model: ctx?.model,
    createdAt: now
  };
  const base = applyFilenameTemplate(tpl, fnCtx);
  // 防重名：在路径已存在时追加 -N
  let final = path.join(dir, `${base}.png`);
  let n = 2;
  while (fs.existsSync(final)) {
    final = path.join(dir, `${base}-${n++}.png`);
    if (n > 999) break;
  }
  fs.writeFileSync(final, buf);
  return final;
}

/** 直接读 PNG 头部 IHDR 拿宽高，避免引入 sharp 给 main 增体积 */
function probePngSize(buf: Buffer): { w: number; h: number } | null {
  // PNG 签名 8B + IHDR (length 4 + type 4 = 8B) + width(4) + height(4)
  if (buf.length < 24) return null;
  // 89 50 4E 47 0D 0A 1A 0A → PNG 签名
  if (
    buf[0] !== 0x89 ||
    buf[1] !== 0x50 ||
    buf[2] !== 0x4e ||
    buf[3] !== 0x47
  ) {
    return null;
  }
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  return { w, h };
}

function saveSvgAsFile(svg: string, taskId: number, seq: number): string {
  const date = new Date().toISOString().slice(0, 10);
  const dir = path.join(getStorageRoot(), date);
  fs.mkdirSync(dir, { recursive: true });
  const seqStr = seq.toString().padStart(2, '0');
  const taskStr = taskId.toString().padStart(5, '0');
  const fp = path.join(dir, `${taskStr}-${seqStr}.svg`);
  fs.writeFileSync(fp, svg, 'utf-8');
  return fp;
}
