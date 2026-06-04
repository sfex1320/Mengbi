import { z } from 'zod';
import type { WebContents } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { register, ok, err, appendNotification } from './helpers';
import { ImageGenerateSchema } from './schemas';
import { getDb } from '../services/db';
import { decryptString } from '../services/safeStorage';
import { joinApiUrl } from '../services/apiUrl';
import { logger } from '../services/logger';
import { makeError } from '@shared/error';
import { isMockMode } from './mocks/runtime';
import { ensureThumbnail } from '../services/thumbnail';
import { detectFamily, getFamilyById, type ImageFamily } from '@shared/imageModelFamilies';
import { chromiumFetch, ChromiumNetError } from '../services/httpClient';
import { saveImage, getStorageRoot } from '../services/imageStore';

// ─────────────────────────────────────────────────────
// 任务队列：FIFO 入队，**最多 3 条并发**
//   - queue: 等待中
//   - inflight: 在跑的（taskId → QueueItem）
//   - drainQueue 每次尽量补满到 MAX_CONCURRENT
// ─────────────────────────────────────────────────────

interface QueueItem {
  taskId: number;
  cancel: AbortController;
  sender: WebContents;
}

const MAX_CONCURRENT = 3;
const queue: QueueItem[] = [];
const inflight = new Map<number, QueueItem>();

function enqueue(taskId: number, sender: WebContents): void {
  const ctrl = new AbortController();
  queue.push({ taskId, cancel: ctrl, sender });
  drainQueue();
}

function drainQueue(): void {
  while (inflight.size < MAX_CONCURRENT && queue.length > 0) {
    const item = queue.shift()!;
    inflight.set(item.taskId, item);
    void executeTask(item)
      .catch((e) => {
        logger.error('image task fatal', e);
      })
      .finally(() => {
        inflight.delete(item.taskId);
        // 一条结束 → 立刻看看能不能补一条进来
        drainQueue();
      });
  }
}

function cancelTask(taskId: number): boolean {
  // 先在等待队列里找
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
  // 在跑的也支持取消（abort upstream fetch）
  const live = inflight.get(taskId);
  if (live) {
    live.cancel.abort();
    return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────
// IPC 注册
// ─────────────────────────────────────────────────────

export function registerGenerateHandlers(): void {
  // 启动指纹：用户日志里看到这一行 = 跑的是新代码
  logger.info('generate handlers registered (grsai-async + honest-error-msg, rev 5)');

  register('api:image:generate', ImageGenerateSchema, async (input, event) => {
    logger.info('image.generate received', {
      modelId: input.modelId,
      promptHead: input.positivePrompt.slice(0, 60),
      params: input.params,
      refsCount: input.referenceImages?.length ?? 0
    });
    const now = new Date().toISOString();
    // 提前查一下配置拿 image_kind，记到任务行上——让前端能区分
    // "云端 API 生图" vs "本地大模型 ComfyUI 生图"，不再混在同一份"最近输出"里
    const cfgPreview = findImageConfig(input.modelId);
    const imageKind = cfgPreview?.image_kind ?? null;
    const result = getDb()
      .prepare(
        `INSERT INTO generation_tasks(model_id, image_kind, positive_prompt, negative_prompt, params, reference_images, status, created_at)
         VALUES(?, ?, ?, ?, ?, ?, 'pending', ?)`
      )
      .run(
        input.modelId,
        imageKind,
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
    // 多 select error_message / params：失败卡片显示错误文案 + 「降一档重试」按钮要解析原参数。
    const rows = getDb()
      .prepare(
        `SELECT id, model_id, image_kind, positive_prompt, status, created_at, finished_at,
                result_paths, error_message, params
           FROM generation_tasks
          WHERE status IN ('pending','running','done','failed','cancelled')
          ORDER BY id DESC LIMIT 50`
      )
      .all();
    return ok(rows);
  });
}

// ─────────────────────────────────────────────────────
// 任务执行
// ─────────────────────────────────────────────────────

/**
 * 任务执行的阶段标签——失败时会拼到错误前面，前端 toast / 日志一眼定位。
 *   cfg     找模型配置 / 解析任务参数
 *   upstream 调上游 generate / edits 接口
 *   parse   解析上游响应 JSON / SSE
 *   download 上游返回 url 时的二次 CDN 下载
 *   save    写图到磁盘
 *   db      把图片元数据写 images 表 / 更新任务状态
 */
type ExecStage = 'cfg' | 'upstream' | 'parse' | 'download' | 'save' | 'db';

class StageError extends Error {
  constructor(public stage: ExecStage, message: string, public cause?: unknown) {
    super(message);
    this.name = 'StageError';
  }
}

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
        image_kind: string | null;
        positive_prompt: string;
        negative_prompt: string | null;
        params: string;
        reference_images: string | null;
      }
    | undefined;
  if (!task) return;

  // 让所有 image:done / image:progress 推送都带上 imageKind，前端按需过滤
  const imageKind = task.image_kind ?? null;

  getDb().prepare(`UPDATE generation_tasks SET status = 'running' WHERE id = ?`).run(item.taskId);
  send('image:progress', { taskId: item.taskId, imageKind, status: 'running' });

  // 当前所处的阶段；catch 块用它作错误归因
  let stage: ExecStage = 'cfg';

  try {
    let savedPaths: string[];
    if (isMockMode()) {
      stage = 'upstream';
      savedPaths = await runMockGenerate(item.taskId);
    } else {
      const cfg = findImageConfig(task.model_id);
      if (!cfg) {
        throw new StageError('cfg', `未找到模型「${task.model_id}」的绘画配置`);
      }
      const params = JSON.parse(task.params) as Record<string, unknown>;
      const refs = task.reference_images
        ? (JSON.parse(task.reference_images) as string[])
        : [];
      // 进度回调：grsai 异步轮询时会用到，把上游 progress 0-100 + 阶段标识推给渲染端
      const notifyProgress = (info: { progress?: number; phase?: string }): void => {
        send('image:progress', {
          taskId: item.taskId,
          imageKind,
          status: 'running',
          progress: info.progress,
          phase: info.phase
        });
      };
      stage = 'upstream';
      if (cfg.image_kind === 'grsai') {
        savedPaths = await runGrsaiImage({
          cfg,
          positivePrompt: task.positive_prompt,
          params,
          referenceImages: refs,
          taskId: item.taskId,
          signal: item.cancel.signal,
          notifyProgress
        });
      } else if (cfg.image_kind === 'apimart') {
        savedPaths = await runApimartImage({
          cfg,
          positivePrompt: task.positive_prompt,
          params,
          referenceImages: refs,
          taskId: item.taskId,
          signal: item.cancel.signal,
          notifyProgress
        });
      } else if (cfg.image_kind === 'comfyui') {
        savedPaths = await runComfyUIImage({
          cfg,
          positivePrompt: task.positive_prompt,
          negativePrompt: task.negative_prompt ?? '',
          params,
          taskId: item.taskId,
          signal: item.cancel.signal,
          notifyProgress
        });
      } else if (cfg.image_kind === 'openai-responses') {
        // Responses API：POST /v1/responses + tools.image_generation。
        // 走 SSE 流式 + partial_images 心跳，用于穿透中转 60s 边缘代理超时。
        // refs 为空 → text-only；refs 非空 → input 数组带 input_image。
        savedPaths = await runOpenAIResponsesImage({
          cfg,
          positivePrompt: task.positive_prompt,
          params,
          referenceImages: refs,
          taskId: item.taskId,
          signal: item.cancel.signal,
          notifyProgress
        });
      } else if (refs.length > 0) {
        savedPaths = await runOpenAIImageEdit({
          cfg,
          positivePrompt: task.positive_prompt,
          params,
          referenceImages: refs,
          taskId: item.taskId,
          signal: item.cancel.signal,
          notifyProgress
        });
      } else {
        savedPaths = await runOpenAIImage({
          cfg,
          positivePrompt: task.positive_prompt,
          params,
          taskId: item.taskId,
          signal: item.cancel.signal,
          notifyProgress
        });
      }
    }

    stage = 'db';
    const now = new Date().toISOString();
    // 同步生成缩略图 —— 让卡片 list 第一次拉就能拿到 thumbnail_path
    // sharp resize 4K → 512 WebP 通常 < 50ms / 张，串行可接受
    const thumbPaths: Array<string | null> = [];
    for (const p of savedPaths) {
      try {
        thumbPaths.push(await ensureThumbnail(p));
      } catch (e) {
        logger.warn(`[generate] thumb failed for ${p}: ${(e as Error).message}`);
        thumbPaths.push(null);
      }
    }
    for (let i = 0; i < savedPaths.length; i++) {
      getDb()
        .prepare(
          `INSERT INTO images(task_id, file_path, thumbnail_path, prompt_positive, prompt_negative, model_used, params_json, created_at)
           VALUES(?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          item.taskId,
          savedPaths[i],
          thumbPaths[i],
          task.positive_prompt,
          task.negative_prompt,
          task.model_id,
          task.params,
          now
        );
    }
    getDb()
      .prepare(
        `UPDATE generation_tasks SET status = 'done', result_paths = ?, finished_at = ? WHERE id = ?`
      )
      .run(JSON.stringify(savedPaths), now, item.taskId);
    send('image:done', { taskId: item.taskId, imageKind, paths: savedPaths });
    appendNotification(item.sender, {
      channel: 'image:done',
      kind: 'success',
      taskId: item.taskId
    });
  } catch (e) {
    const finishedAt = new Date().toISOString();
    const aborted = (e as Error).name === 'AbortError' || item.cancel.signal.aborted;
    if (aborted) {
      getDb()
        .prepare(`UPDATE generation_tasks SET status = 'cancelled', finished_at = ? WHERE id = ?`)
        .run(finishedAt, item.taskId);
      send('image:done', { taskId: item.taskId, imageKind, cancelled: true });
      appendNotification(item.sender, {
        channel: 'image:done',
        kind: 'info',
        message: '任务已取消',
        taskId: item.taskId
      });
      return;
    }
    // 拿到真实失败的阶段：StageError 自带 stage，否则用 catch 现场的 stage
    const failedStage: ExecStage =
      e instanceof StageError ? e.stage : stage;
    const rawMsg = (e as Error).message || String(e);
    // 网络层错误：连接被中间链路掐掉。两种 case，需要诚实区分给用户：
    //   ① ~60s/120s 整数附近掉线 → 中转站边缘代理硬超时，请求根本没到上游，
    //      不会扣费、后台无记录；用户实际行动：降分辨率 / 换支持异步的中转站。
    //   ② >30s 但不是整数 60/120 → 可能上游真的在跑，连接被中间某一跳掐了；
    //      上游可能已扣费已出图，用户去后台找。
    const baseErr = e instanceof StageError ? (e.cause ?? e) : e;
    const isChromiumNetErr = baseErr instanceof ChromiumNetError;
    const elapsedSec = isChromiumNetErr
      ? (baseErr as ChromiumNetError).elapsedMs / 1000
      : 0;
    // 看是否落在 60s/120s/180s ±5s 这几个常见硬超时点附近
    const isHardProxyTimeout =
      isChromiumNetErr &&
      [60, 120, 180].some((t) => Math.abs(elapsedSec - t) < 5);
    // 解析 task.params 拿当前用的档位 / family，做更具体的"降档"提示
    let currentTier = '';
    let currentFamily = '';
    try {
      const tp = JSON.parse(task.params) as Record<string, unknown>;
      currentTier = typeof tp.image_size === 'string' ? tp.image_size : '';
      currentFamily =
        typeof tp.family_override === 'string' ? tp.family_override : '';
    } catch {
      /* ignore */
    }
    const looksLikeGPT = /gpt[\s\-_]*image|gptimage/i.test(task.model_id ?? '');
    const isHighTier = currentTier === '4K' || currentTier === '';
    let displayMsg: string;
    if (failedStage === 'upstream' && isChromiumNetErr && elapsedSec > 30) {
      const code = (baseErr as ChromiumNetError).code;
      if (isHardProxyTimeout) {
        // 记忆这条中转的边缘超时秒数，让前端下次提交前能 pre-flight 提醒。
        // 用 task.model_id 找回 cfg.id（catch 块作用域里 cfg 已经不可见）。
        try {
          const recoveredCfg = findImageConfig(task.model_id);
          if (recoveredCfg) {
            getDb()
              .prepare(`UPDATE api_configs SET proxy_timeout_seconds = ? WHERE id = ?`)
              .run(Math.round(elapsedSec), recoveredCfg.id);
            logger.info('recorded proxy edge timeout', {
              configId: recoveredCfg.id,
              seconds: Math.round(elapsedSec)
            });
          }
        } catch (e2) {
          logger.warn('failed to record proxy_timeout_seconds', e2);
        }
        const tierHint =
          (looksLikeGPT || currentFamily === 'gpt-image-2') && isHighTier
            ? `\n建议：把"分辨率档位"从 ${currentTier || '4K (默认)'} 降到 2K 或 1K（GPT Image 2 现在按档位走像素预算）。`
            : currentTier === '4K'
              ? `\n建议：把"分辨率档位"从 4K 降到 2K 重试。`
              : '';
        displayMsg =
          `[upstream] 连接被中转站强制掐断（硬超时，${code}，正好 ${elapsedSec.toFixed(0)}s）` +
          `—— 这条中转站到 ${Math.round(elapsedSec)}s 就会切断连接，请求多半没发到上游、通常不扣费。` +
          `解决：要么降低分辨率让出图快于 ${Math.round(elapsedSec)}s，要么换支持异步轮询的中转站（如 grsai）。${tierHint}`;
      } else {
        displayMsg =
          `[upstream] 连接中断（${code}，已等 ${elapsedSec.toFixed(0)}s）—— ` +
          `上游可能仍在生成。先到中转站后台「任务记录」看是否扣费：` +
          `有则去那里下载结果图；没记录则建议改用 grsai 异步路径或降低分辨率。`;
      }
    } else if (/^\[\w+\]/.test(rawMsg)) {
      displayMsg = rawMsg;
    } else {
      displayMsg = `[${failedStage}] ${rawMsg}`;
    }
    // 完整日志：stack + cause + Chromium 错误码（若有）+ 耗时
    logger.error('image task failed', {
      taskId: item.taskId,
      modelId: task.model_id,
      stage: failedStage,
      message: rawMsg,
      chromiumCode: baseErr instanceof ChromiumNetError ? baseErr.code : undefined,
      elapsedMs: baseErr instanceof ChromiumNetError ? baseErr.elapsedMs : undefined,
      cause: (e as Error & { cause?: unknown }).cause,
      stack: (e as Error).stack
    });
    getDb()
      .prepare(
        `UPDATE generation_tasks SET status = 'failed', error_message = ?, finished_at = ? WHERE id = ?`
      )
      .run(displayMsg, finishedAt, item.taskId);
    send('image:done', { taskId: item.taskId, imageKind, error: displayMsg });
    appendNotification(item.sender, {
      channel: 'image:done',
      kind: 'failure',
      errorCode: 'API_FAILED',
      severity: 'toast',
      message: displayMsg,
      taskId: item.taskId
    });
  }
}

interface ResolvedImageCfg {
  /** api_configs.id —— 用于 hard timeout 时回写 proxy_timeout_seconds 列 */
  id: number;
  base_url: string;
  api_key_encrypted: string;
  actualModelId: string;
  image_kind: string | null;
  /** 用户在设置页配的 JSON 模板，与默认请求体顶层合并发出。null = 不覆盖。 */
  body_overrides_json: string | null;
  /** image_kind='comfyui' 时存的 workflow JSON 文本（API Format） */
  comfyui_workflow_json: string | null;
}

function findImageConfig(modelDisplayId: string): ResolvedImageCfg | null {
  const configs = getDb()
    .prepare(`SELECT * FROM api_configs WHERE type = 'image' ORDER BY id`)
    .all() as Array<{
    id: number;
    base_url: string;
    api_key_encrypted: string;
    model_mapping: string;
    image_kind: string | null;
    body_overrides_json: string | null;
    comfyui_workflow_json: string | null;
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
        id: c.id,
        base_url: c.base_url,
        api_key_encrypted: c.api_key_encrypted,
        actualModelId: map[modelDisplayId],
        image_kind: c.image_kind ?? null,
        body_overrides_json: c.body_overrides_json ?? null,
        comfyui_workflow_json: c.comfyui_workflow_json ?? null
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
  /** 异步路径用：把上游进度（0–100）/ 阶段标识推回渲染端。同步路径可忽略。 */
  notifyProgress?: (info: { progress?: number; phase?: string }) => void;
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

/** 严格向下取到 16 的倍数；用于"必须不超预算"的场景（4K 预算 8.3MP） */
function snapDown16(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 256;
  const snapped = Math.floor(value / 16) * 16;
  return Math.max(256, Math.min(3840, snapped));
}

/**
 * 给定比例字符串 + 总像素预算，反推 W×H。
 * 关键约束：snap 后 w*h 必须 **小于等于** totalPx——否则像 GPT Image 2 这种严格 8.3MP 上限的模型会拒绝。
 * 算法：先用 floor-to-16 取下，得到 w0/h0；若仍 > budget（极端比例下浮点误差），逐步把更长那边 -16 直到合规。
 */
function pixelsByAspectAndBudget(aspect: string, totalPx: number): { w: number; h: number } {
  const [aw, ah] = aspect.split(':').map(Number);
  if (!Number.isFinite(aw) || !Number.isFinite(ah) || aw <= 0 || ah <= 0) {
    const side = Math.sqrt(totalPx);
    return { w: snapDown16(side), h: snapDown16(side) };
  }
  const hExact = Math.sqrt((totalPx * ah) / aw);
  const wExact = (hExact * aw) / ah;
  let w = snapDown16(wExact);
  let h = snapDown16(hExact);
  // 兜底：极端时再削一档
  while (w * h > totalPx && (w > 256 || h > 256)) {
    if (w >= h && w > 256) w -= 16;
    else if (h > 256) h -= 16;
    else break;
  }
  return { w, h };
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

  // family 自动判定：用户在 params 里可显式 override（imageParamsStore 暴露
  // 的"系列覆盖"下拉），否则按 actualModelId 自动嗅探。
  const overrideFamily =
    typeof opts.params.family_override === 'string' && opts.params.family_override
      ? getFamilyById(opts.params.family_override as ImageFamily)
      : null;
  const family = overrideFamily ?? detectFamily(opts.cfg.actualModelId);

  // LoRA：如果 imageParamsStore 注入了 params.lora（拼好的 <lora:name:weight> 串），
  // 拼到 prompt 末尾——这是 OpenAI 兼容站接 LoRA 的事实标准（柏拉图AI / Civitai 中转都识别）
  const loraSuffix =
    typeof opts.params.lora === 'string' && opts.params.lora.trim()
      ? ' ' + opts.params.lora.trim()
      : '';
  const finalPrompt = opts.positivePrompt + loraSuffix;

  // 由 family.buildBody 构造请求体——避免把 size / aspect_ratio / image_size 都
  // 一股脑发出导致中转站随机选一项的"4K 实际只出 1K"问题。
  const body = family.buildBody({
    modelId: opts.cfg.actualModelId,
    prompt: finalPrompt,
    params: opts.params as {
      n?: number;
      width?: number;
      height?: number;
      aspect?: string;
      image_size?: string;
      quality?: string;
      lora?: string;
    }
  });

  // seed 透传：family.buildBody 默认不带 seed（edit 路径在 FormData 里已支持）。
  // 文生图路径这里补上，供智能画布等需要可复现/迭代的场景；用户 body 覆盖仍可 null 掉。
  if (typeof opts.params.seed === 'number' && Number.isFinite(opts.params.seed)) {
    body.seed = Math.trunc(opts.params.seed);
  }

  logger.info('runOpenAIImage', {
    url,
    family: family.id,
    familyStreamingFlag: family.streaming ? family.streaming.partialImages : 'none',
    model: opts.cfg.actualModelId,
    bodyKeys: Object.keys(body),
    bodySize: body.size,
    bodyImageSize: body.image_size,
    bodyAspect: body.aspect_ratio,
    bodyN: body.n,
    bodyQuality: body.quality
  });

  const n = (typeof body.n === 'number' ? body.n : 1) as number;

  // 用户在设置页配的 body 覆盖（如 {"response_format": null} 屏蔽该字段，绕过部分中转站的 500）
  applyBodyOverrides(body, opts.cfg.body_overrides_json, {
    model: opts.cfg.actualModelId,
    prompt: finalPrompt,
    size: typeof body.size === 'string' ? body.size : '',
    n,
    quality: typeof body.quality === 'string' ? body.quality : null,
    aspect: typeof body.aspect_ratio === 'string' ? body.aspect_ratio : null,
    image_size: typeof body.image_size === 'string' ? body.image_size : null,
    negative_prompt: typeof body.negative_prompt === 'string' ? body.negative_prompt : null
  });

  // ────────────────────────────────────────────────────────────
  // 流式分支：family 声明了 streaming 能力（目前只有 gpt-image-2）。
  // 给 body 加 `stream: true` + `partial_images: N`，走 SSE 解析，
  // 中间步骤图作为心跳让中转的 60s 边缘代理超时永远不触发。
  // 解决 Now Coding 这类中转跑 GPT Image 4K 必失败的死局。
  // ────────────────────────────────────────────────────────────
  if (family.streaming) {
    body.stream = true;
    body.partial_images = family.streaming.partialImages;
    delete body.response_format; // SSE 总是 b64_json，response_format 字段反而会被部分中转拒
    logger.info('runOpenAIImage: ENTERING streaming branch', {
      partial_images: body.partial_images,
      finalBodyKeys: Object.keys(body)
    });
    return await runOpenAIImageStreaming(url, apiKey, body, opts);
  }
  logger.info('runOpenAIImage: skipping streaming, using sync path', {
    reason: 'family.streaming is falsy',
    familyId: family.id
  });

  // chromiumFetch（基于 net.request）—— 图像生成上游单次请求常 60–300s，
  // Node 自带 fetch / net.fetch 都会被中间代理掐断成 "fetch failed"，
  // 走 Chromium URLLoader 才稳。
  const res = await chromiumFetch(url, {
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
    throw new StageError('upstream', `HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  const respJson = (await parseJsonOrSse(res)) as {
    data?: Array<{ b64_json?: string; url?: string }>;
  };
  // 响应 shape 日志：调中转站协议 / 排查"为啥拿不到 b64_json/url"用，
  // 不打 b64_json 全文（动辄 MB 级），只打开头 80 字符够辨别真假图。
  logger.info('runOpenAIImage response shape', {
    topKeys: Object.keys(respJson ?? {}),
    dataLen: Array.isArray(respJson?.data) ? respJson.data.length : null,
    firstItemKeys: respJson?.data?.[0] ? Object.keys(respJson.data[0]) : null,
    firstB64Head:
      typeof respJson?.data?.[0]?.b64_json === 'string'
        ? respJson.data[0].b64_json.slice(0, 80)
        : null,
    firstUrl:
      typeof respJson?.data?.[0]?.url === 'string' ? respJson.data[0].url : null
  });
  if (!respJson.data?.length) throw new StageError('parse', '上游未返回图片');

  const saved: string[] = [];
  for (let i = 0; i < respJson.data.length; i++) {
    const item = respJson.data[i];
    let buf: Buffer;
    if (item.b64_json) {
      try {
        buf = decodeB64Image(item.b64_json);
      } catch (e) {
        throw new StageError('parse', `b64_json 解码失败：${(e as Error).message}`);
      }
    } else if (item.url) {
      buf = await fetchImageBufWithRetry(item.url, opts.signal);
    } else {
      throw new StageError('parse', '图片数据格式不明（既无 b64_json 也无 url）');
    }
    // 写盘前先校验是真图，避免中转站把垃圾塞进 b64_json 后默默落盘
    ensureImageBuf(buf);
    let filePath: string;
    try {
      filePath = saveImage(buf, opts.taskId, i + 1, {
        prompt: opts.positivePrompt,
        model: opts.cfg.actualModelId,
        aspect: typeof opts.params.aspect === 'string' ? opts.params.aspect : undefined
      });
    } catch (e) {
      throw new StageError('save', `写盘失败：${(e as Error).message}`);
    }
    saved.push(filePath);
  }
  return saved;
}

/**
 * GPT Image 2 流式分支：
 *   - 请求体已含 `stream: true` + `partial_images: N`（runOpenAIImage 里加好）
 *   - SSE 事件类型：
 *       image_generation.partial_image  → 中间步骤图（保活用，可丢可显示进度）
 *       image_generation.completed      → 终态图（带 b64_json，要保存）
 *       error                            → 上游报错
 *   - 中转的 60s 边缘超时按"连接静默"计时，partial_image 每 N 秒来一次就清零，
 *     所以 140s 的真实生成时间也能跑通。
 */
async function runOpenAIImageStreaming(
  url: string,
  apiKey: string,
  body: Record<string, unknown>,
  opts: OpenAIImageOpts
): Promise<string[]> {
  const completedB64: string[] = [];
  let buffer = '';
  let upstreamError: string | null = null;
  let partialCount = 0;
  let completedCount = 0;

  // SSE 解析回调：每 chunk 来都附加到 buffer，按 \n\n 切事件块
  const onChunk = (chunk: Buffer): void => {
    buffer += chunk.toString('utf8');
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      for (const rawLine of block.split('\n')) {
        const line = rawLine.trim();
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const json = JSON.parse(payload) as {
            type?: string;
            b64_json?: string;
            partial_image_index?: number;
            error?: { message?: string } | string;
          };
          if (json.error) {
            upstreamError =
              typeof json.error === 'string'
                ? json.error
                : (json.error.message ?? '上游错误（无 message）');
          } else if (
            json.type === 'image_generation.completed' &&
            typeof json.b64_json === 'string'
          ) {
            completedB64.push(json.b64_json);
            completedCount++;
            opts.notifyProgress?.({ progress: 100, phase: 'streaming:completed' });
          } else if (json.type === 'image_generation.partial_image') {
            partialCount++;
            // 中间步骤图也是真图；这里不存盘，只汇报进度让 UI 不静默
            opts.notifyProgress?.({
              phase: `streaming:partial(${partialCount})`
            });
          }
        } catch {
          // 非标准 data: 行（注释 / keep-alive 心跳）忽略
        }
      }
    }
  };

  logger.info('runOpenAIImage:streaming STARTING fetch', {
    url,
    stream: body.stream,
    partial_images: body.partial_images,
    bodyKeys: Object.keys(body)
  });
  const res = await chromiumFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      Accept: 'text/event-stream'
    },
    body: JSON.stringify(body),
    signal: opts.signal,
    onChunk
  });

  logger.info('runOpenAIImage:streaming finished', {
    status: res.status,
    partialCount,
    completedCount,
    sawError: upstreamError !== null
  });

  if (!res.ok) {
    throw new StageError(
      'upstream',
      `HTTP ${res.status} on streaming /v1/images/generations${
        upstreamError ? `（上游：${upstreamError}）` : ''
      }`
    );
  }
  if (upstreamError) {
    throw new StageError('upstream', `上游错误：${upstreamError}`);
  }
  if (completedB64.length === 0) {
    throw new StageError(
      'parse',
      'SSE 流结束但没收到任何 image_generation.completed 事件'
    );
  }

  const saved: string[] = [];
  for (let i = 0; i < completedB64.length; i++) {
    let buf: Buffer;
    try {
      buf = decodeB64Image(completedB64[i]);
    } catch (e) {
      throw new StageError('parse', `b64_json 解码失败：${(e as Error).message}`);
    }
    ensureImageBuf(buf);
    try {
      saved.push(
        saveImage(buf, opts.taskId, i + 1, {
          prompt: opts.positivePrompt,
          model: opts.cfg.actualModelId,
          aspect: typeof opts.params.aspect === 'string' ? opts.params.aspect : undefined
        })
      );
    } catch (e) {
      throw new StageError('save', `写盘失败：${(e as Error).message}`);
    }
  }
  return saved;
}

// ────────────────────────────────────────────────────────────
// OpenAI Responses API 图像适配器（image_kind='openai-responses'）
//
// 走 POST /v1/responses + tools:[{type:"image_generation", partial_images:2, ...}]，
// 用 SSE + 中间步骤图作心跳穿透中转 60s 边缘代理超时。是 Now Coding 这类
// 同步 /v1/images/generations 物理上跑不通 4K（生成 120-200s > 60s 切连接）
// 的唯一协议层解。
//
// 设计参考 https://gpt-image-playground.cooksleep.dev/ 的 apiMode="responses" 实现。
// SSE 事件类型（与已有 runOpenAIImageStreaming 一致）：
//   - response.output_item.added       开始
//   - image_generation.partial_image    心跳 + 中间图（不存盘）
//   - image_generation.completed        终态图（存盘）
//   - response.completed                结束
// ────────────────────────────────────────────────────────────

interface OpenAIResponsesOpts extends OpenAIImageOpts {
  referenceImages: string[];
}

type ResponsesInputItem =
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; image_url: string };

async function runOpenAIResponsesImage(opts: OpenAIResponsesOpts): Promise<string[]> {
  const url = joinApiUrl(opts.cfg.base_url, 'responses');
  const apiKey = decryptString(opts.cfg.api_key_encrypted);

  const overrideFamily =
    typeof opts.params.family_override === 'string' && opts.params.family_override
      ? getFamilyById(opts.params.family_override as ImageFamily)
      : null;
  const family = overrideFamily ?? detectFamily(opts.cfg.actualModelId);

  const loraSuffix =
    typeof opts.params.lora === 'string' && opts.params.lora.trim()
      ? ' ' + opts.params.lora.trim()
      : '';
  const finalPrompt = opts.positivePrompt + loraSuffix;

  // 跑 family.buildBody 得到 OpenAI Images 标准 body，再转换到 Responses tool 形态
  const imagesBody = family.buildBody({
    modelId: opts.cfg.actualModelId,
    prompt: finalPrompt,
    params: opts.params as {
      n?: number;
      width?: number;
      height?: number;
      aspect?: string;
      image_size?: string;
      quality?: string;
      lora?: string;
    }
  });

  // tool 字段集：size / quality / output_format / output_compression / moderation
  // partial_images 固定 2（playground 默认；够频心跳又不浪费带宽）
  const tool: Record<string, unknown> = {
    type: 'image_generation',
    partial_images: 2
  };
  if (typeof imagesBody.size === 'string') tool.size = imagesBody.size;
  if (typeof imagesBody.quality === 'string') tool.quality = imagesBody.quality;
  // Responses API 默认 png，显式声明避免上游默认走 webp 之类
  tool.output_format = 'png';

  // 当有参考图：input 是数组，text + 多张 input_image；否则是字符串
  let input: string | ResponsesInputItem[];
  if (opts.referenceImages.length > 0) {
    const refs = await refsToUploadable(opts.referenceImages);
    const arr: ResponsesInputItem[] = [{ type: 'input_text', text: finalPrompt }];
    for (const ref of refs) {
      arr.push({ type: 'input_image', image_url: ref });
    }
    input = arr;
  } else {
    input = finalPrompt;
  }

  const body: Record<string, unknown> = {
    model: opts.cfg.actualModelId,
    input,
    stream: true,
    tools: [tool]
  };

  // 用户级覆盖仍生效——作用于顶层 body（model/input/stream/tools）。
  // 想覆盖 tool 内字段就在 overrides 里整段写 tools 数组。
  applyBodyOverrides(body, opts.cfg.body_overrides_json, {
    model: opts.cfg.actualModelId,
    prompt: finalPrompt,
    size: typeof tool.size === 'string' ? tool.size : '',
    n: 1,
    quality: typeof tool.quality === 'string' ? tool.quality : null,
    aspect: typeof opts.params.aspect === 'string' ? opts.params.aspect : null,
    image_size: typeof opts.params.image_size === 'string' ? opts.params.image_size : null,
    negative_prompt: null
  });

  logger.info('runOpenAIResponsesImage', {
    url,
    family: family.id,
    model: opts.cfg.actualModelId,
    inputKind: typeof input === 'string' ? 'text' : `array(${(input as ResponsesInputItem[]).length})`,
    toolSize: tool.size,
    toolQuality: tool.quality,
    partial_images: tool.partial_images
  });

  // SSE 解析——与 runOpenAIImageStreaming 同套，只多加 response.* 事件分支
  const completedB64: string[] = [];
  let buffer = '';
  let upstreamError: string | null = null;
  let partialCount = 0;
  let completedCount = 0;

  const onChunk = (chunk: Buffer): void => {
    buffer += chunk.toString('utf8');
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      for (const rawLine of block.split('\n')) {
        const line = rawLine.trim();
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const json = JSON.parse(payload) as {
            type?: string;
            b64_json?: string;
            partial_image_index?: number;
            error?: { message?: string } | string;
            response?: { error?: { message?: string } };
          };
          if (json.error) {
            upstreamError =
              typeof json.error === 'string'
                ? json.error
                : (json.error.message ?? '上游错误（无 message）');
          } else if (
            json.type === 'image_generation.completed' &&
            typeof json.b64_json === 'string'
          ) {
            completedB64.push(json.b64_json);
            completedCount++;
            opts.notifyProgress?.({ progress: 100, phase: 'responses:completed' });
          } else if (
            json.type === 'image_generation.partial_image' &&
            typeof json.b64_json === 'string'
          ) {
            partialCount++;
            opts.notifyProgress?.({
              phase: `responses:partial(${partialCount})`
            });
          } else if (json.type === 'response.failed' || json.type === 'response.error') {
            const msg = json.response?.error?.message;
            if (msg) upstreamError = msg;
          }
          // response.output_item.added / response.completed：仅作流转信号，无需特殊处理
        } catch {
          // 非标准 data: 行（注释 / keepalive）忽略
        }
      }
    }
  };

  const res = await chromiumFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      Accept: 'text/event-stream'
    },
    body: JSON.stringify(body),
    signal: opts.signal,
    onChunk
  });

  logger.info('runOpenAIResponsesImage finished', {
    status: res.status,
    partialCount,
    completedCount,
    sawError: upstreamError !== null
  });

  if (!res.ok) {
    throw new StageError(
      'upstream',
      `HTTP ${res.status} on /v1/responses${upstreamError ? `（上游：${upstreamError}）` : ''}`
    );
  }
  if (upstreamError) {
    throw new StageError('upstream', `上游错误：${upstreamError}`);
  }
  if (completedB64.length === 0) {
    throw new StageError(
      'parse',
      'Responses SSE 流结束但没收到任何 image_generation.completed 事件（中转可能未实现 /v1/responses 或缓冲了 SSE）'
    );
  }

  const saved: string[] = [];
  for (let i = 0; i < completedB64.length; i++) {
    let buf: Buffer;
    try {
      buf = decodeB64Image(completedB64[i]);
    } catch (e) {
      throw new StageError('parse', `b64_json 解码失败：${(e as Error).message}`);
    }
    ensureImageBuf(buf);
    try {
      saved.push(
        saveImage(buf, opts.taskId, i + 1, {
          prompt: opts.positivePrompt,
          model: opts.cfg.actualModelId,
          aspect: typeof opts.params.aspect === 'string' ? opts.params.aspect : undefined
        })
      );
    } catch (e) {
      throw new StageError('save', `写盘失败：${(e as Error).message}`);
    }
  }
  return saved;
}


/**
 * 二次下载上游返回的 image url。带 3 次指数退避重试（300ms / 1200ms / 2700ms），
 * 因为很多中转站返回的是签名 URL（短 TTL）或经 CDN，多任务并发时偶发 5xx / RST。
 * AbortSignal 被触发就立刻抛，不再重试。
 */
async function fetchImageBufWithRetry(
  url: string,
  signal: AbortSignal,
  tries = 3
): Promise<Buffer> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    if (signal.aborted) {
      throw new StageError('download', '已取消');
    }
    try {
      const r = await chromiumFetch(url, { signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      if (signal.aborted) throw e;
      lastErr = e;
      if (i < tries - 1) {
        await new Promise((res) => setTimeout(res, 300 * (i + 1) * (i + 1)));
      }
    }
  }
  throw new StageError(
    'download',
    `下载图片失败（已重试 ${tries} 次）：${(lastErr as Error)?.message ?? lastErr}`,
    lastErr
  );
}

/**
 * 把 fetch Response 解析为 JSON。
 * 兼容两种上游：
 *   - 标准 JSON 一次性返回（默认情况）
 *   - 部分中转站把图像生成接口当 SSE 回包（Content-Type: text/event-stream），
 *     里面是 `data: {...}\n\ndata: {...}\n\n[DONE]` 的形式。
 * 第二种情况下，挑最后一条带 `data` 字段（含图片）的合法 JSON。
 */
async function parseJsonOrSse(res: { text(): Promise<string> }): Promise<unknown> {
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
    throw new StageError(
      'parse',
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
  // 三种来源：fs 路径（文件选择器）/ data URI（拖拽 / 粘贴 / 画板）/ http(s) URL
  let attached = 0;
  for (const ref of opts.referenceImages) {
    try {
      let buf: Buffer;
      let mime = 'image/png';
      let filename = 'ref.png';
      if (ref.startsWith('data:')) {
        const m = /^data:([^;]+);base64,(.+)$/.exec(ref);
        if (!m) throw new Error('malformed data URI');
        mime = m[1] || 'image/png';
        buf = Buffer.from(m[2], 'base64');
        filename = `ref.${mime.split('/')[1] ?? 'png'}`;
      } else if (ref.startsWith('http://') || ref.startsWith('https://')) {
        const dl = await chromiumFetch(ref, { method: 'GET', signal: opts.signal });
        if (!dl.ok) throw new Error(`HTTP ${dl.status}`);
        buf = Buffer.from(await dl.arrayBuffer());
        const urlExt = path.extname(new URL(ref).pathname).toLowerCase();
        mime = REF_EXT_TO_MIME[urlExt] ?? 'image/png';
        filename = path.basename(new URL(ref).pathname) || filename;
      } else {
        buf = await fs.promises.readFile(ref);
        const ext = path.extname(ref).toLowerCase();
        mime = REF_EXT_TO_MIME[ext] ?? 'image/png';
        filename = path.basename(ref);
      }
      const blob = new Blob([new Uint8Array(buf)], { type: mime });
      form.append('image[]', blob, filename);
      attached++;
    } catch (e) {
      logger.warn('image edit: failed to attach ref', { ref: ref.slice(0, 80), err: (e as Error).message });
    }
  }
  if (attached === 0) {
    throw new StageError(
      'cfg',
      '参考图全部读取失败，无法走 /v1/images/edits 接口（检查参考图路径是否真实存在）'
    );
  }

  // 局部重绘蒙版（来自画板）：params.inpaint_mask 是一张 PNG dataUri，
  // 约定为 OpenAI /images/edits 的“透明处即编辑区”形式（渲染端已按内部白=AI 规则转换好）。
  let maskAttached = false;
  const inpaintMask = typeof opts.params.inpaint_mask === 'string' ? opts.params.inpaint_mask : null;
  if (inpaintMask) {
    const mm = /^data:([^;]+);base64,(.+)$/.exec(inpaintMask);
    if (mm) {
      const mbuf = Buffer.from(mm[2], 'base64');
      form.append('mask', new Blob([new Uint8Array(mbuf)], { type: mm[1] || 'image/png' }), 'mask.png');
      maskAttached = true;
    } else {
      logger.warn('inpaint mask is not a valid data URI, skipped');
    }
  }
  // 透传随机种子（部分中转支持；gpt-image 原生忽略也无害）
  if (typeof opts.params.seed === 'number' && Number.isFinite(opts.params.seed)) {
    form.append('seed', String(Math.trunc(opts.params.seed)));
  }

  logger.info('openai.images.edits.request', {
    url,
    model: opts.cfg.actualModelId,
    refs: attached,
    mask: maskAttached,
    size
  });

  // chromiumFetch：长响应（gpt-image-2 4K edits 经常 >100s）必须走 Chromium 栈
  const res = await chromiumFetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: opts.signal
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new StageError(
      'upstream',
      `HTTP ${res.status} on /v1/images/edits: ${text.slice(0, 300)}`
    );
  }

  const respJson = (await parseJsonOrSse(res)) as {
    data?: Array<{ b64_json?: string; url?: string }>;
  };
  logger.info('runOpenAIImageEdit response shape', {
    topKeys: Object.keys(respJson ?? {}),
    dataLen: Array.isArray(respJson?.data) ? respJson.data.length : null,
    firstItemKeys: respJson?.data?.[0] ? Object.keys(respJson.data[0]) : null,
    firstB64Head:
      typeof respJson?.data?.[0]?.b64_json === 'string'
        ? respJson.data[0].b64_json.slice(0, 80)
        : null,
    firstUrl:
      typeof respJson?.data?.[0]?.url === 'string' ? respJson.data[0].url : null
  });
  if (!respJson.data?.length) throw new StageError('parse', '上游未返回图片');

  const saved: string[] = [];
  for (let i = 0; i < respJson.data.length; i++) {
    const item = respJson.data[i];
    let buf: Buffer;
    if (item.b64_json) {
      try {
        buf = decodeB64Image(item.b64_json);
      } catch (e) {
        throw new StageError('parse', `b64_json 解码失败：${(e as Error).message}`);
      }
    } else if (item.url) {
      buf = await fetchImageBufWithRetry(item.url, opts.signal);
    } else {
      throw new StageError('parse', '图片数据格式不明（既无 b64_json 也无 url）');
    }
    ensureImageBuf(buf);
    try {
      saved.push(
        saveImage(buf, opts.taskId, i + 1, {
          prompt: opts.positivePrompt,
          model: opts.cfg.actualModelId,
          aspect: typeof opts.params.aspect === 'string' ? opts.params.aspect : undefined
        })
      );
    } catch (e) {
      throw new StageError('save', `写盘失败：${(e as Error).message}`);
    }
  }
  return saved;
}

// ─────────────────────────────────────────────────────
// grsai 自有协议（v2 统一端点 / 异步轮询模式）
// 参考：https://qmy27nhsd9.apifox.cn/452409160e0  （生成）
//      https://qmy27nhsd9.apifox.cn/452409577e0  （查询）
//
// 端点：所有模型统一走 POST /v1/api/generate（旧版按 family 拆 endpoint 的方案已废）
//
// 请求体字段：
//   - model        ：模型名（如 gpt-image-2 / gpt-image-2-vip / nano-banana-* 等）
//   - prompt       ：文字提示词
//   - images?      ：参考图数组（base64 或 URL，文生图时省略）
//   - aspectRatio? ：比例字符串（"16:9"）或像素字符串（"1024x1024"）或档位（"4K"）
//   - replyType?   ：json（同步等结果）/ stream（SSE）/ async（异步先返 id）—— 这里固定 async
//
// 协议（replyType="async"）：
//   1. 提交：POST /v1/api/generate
//      → 立刻返回 { id, status:"running", progress:0 }
//   2. 轮询：GET /v1/api/result?id=<id>，每 5 秒一次
//      → { id, status, progress(0-100), results:[{url}], error }
//      status: running / succeeded / violation / failed
//   3. 终态：
//      - succeeded → 下载 results[].url
//      - violation / failed → throw（携带 error 字段）
//
// 为什么不用 stream/json：单次连接 hold 60–300s 极易被中间链路（中转站
// nginx / 杀软 / 路由器）TLS reset，前端表现"失败"但上游已扣费出图。异步模式每次
// HTTP 都很短，连接超时无关紧要。
//
// 关于"图片编辑"：grsai 新版没有 OpenAI 式 mask edit 端点；要"修改一张图"就把
// 它放进 images[] 当参考图，prompt 描述要改成什么样——本质是图生图。
// ─────────────────────────────────────────────────────

interface GrsaiResponse {
  id?: string;
  status?: string;
  progress?: number;
  results?: Array<{ url?: string }>;
  error?: string;
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

/** 单次轮询调用——失败要么是网络抖动（外层重试）、要么是上游正常 progress（外层继续等）。 */
async function pollGrsaiOnce(
  baseUrl: string,
  apiKey: string,
  upstreamId: string,
  signal: AbortSignal
): Promise<GrsaiResponse> {
  const url = joinApiUrl(baseUrl, `api/result?id=${encodeURIComponent(upstreamId)}`);
  const res = await chromiumFetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    signal
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return (await parseJsonOrSse(res)) as GrsaiResponse;
}

async function runGrsaiImage(opts: GrsaiImageOpts): Promise<string[]> {
  const submitUrl = joinApiUrl(opts.cfg.base_url, 'api/generate');
  const apiKey = decryptString(opts.cfg.api_key_encrypted);

  // family 判定（与 runOpenAIImage 同套规则）：用户在 params.family_override 下拉
  // 选了非 'auto' 时强制；否则按 actualModelId 自动嗅探。
  // 新版 grsai 后端只有一个 aspectRatio 字段，不再按 family 拆 endpoint；family 在这里
  // 仅用于决定 aspectRatio 字段最终塞什么字符串（比例 / "WxH" / 档位）。
  const overrideFamily =
    typeof opts.params.family_override === 'string' && opts.params.family_override
      ? getFamilyById(opts.params.family_override as ImageFamily)
      : null;
  const family = overrideFamily ?? detectFamily(opts.cfg.actualModelId);
  const isNanoBanana =
    family.id === 'nano-banana-pro' ||
    family.id === 'nano-banana-2' ||
    family.id === 'nano-banana-flash';

  // aspectRatio 字段决策（新版统一支持 "16:9" / "1024x1024" / "4K" 三种）：
  //   1. 显式 width/height 双字段 → "WxH"（gpt-image-2 这类按像素出图）
  //   2. nano-banana 系列且选了档位 → 直接传档位字面量（"1K"/"2K"/"4K"），模型自己挑分辨率
  //   3. 显式档位 + 比例 → 用预算换算成 "WxH"
  //   4. 其他 → 比例字符串（"16:9"）
  let aspectRatioField: string;
  // nano-banana 新版后端把「档位」放进独立的 imageSize 字段（"1K"/"2K"/"4K"），
  // aspectRatio 仍放真实比例（"1:1"）。旧代码把档位塞进 aspectRatio（"4K"），新后端
  // 不认这个"比例" → 静默回退默认 1K —— 这就是「点 4K 却只出 1K」的根因。
  // 仅 nano-banana 系列走这条；gpt-image-2 等仍按 WxH 不受影响（隔离）。
  let imageSizeField: string | null = null;
  const w = Number(opts.params.width);
  const h = Number(opts.params.height);
  const aspect =
    typeof opts.params.aspect === 'string' && opts.params.aspect && opts.params.aspect !== 'auto'
      ? opts.params.aspect
      : '1:1';
  const tierLabel =
    opts.params.image_size === '1K' ||
    opts.params.image_size === '2K' ||
    opts.params.image_size === '4K'
      ? opts.params.image_size
      : null;
  const tierBudget = tierLabel ? TIER_PIXEL_BUDGET[tierLabel] : null;
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    aspectRatioField = `${snapToGrid(w)}x${snapToGrid(h)}`;
  } else if (isNanoBanana && tierLabel) {
    // 比例进 aspectRatio，档位进独立 imageSize（与 grsai nano-banana 文档示例一致）
    aspectRatioField = aspect;
    imageSizeField = tierLabel;
  } else if (tierBudget) {
    const { w: cw, h: ch } = pixelsByAspectAndBudget(aspect, tierBudget);
    aspectRatioField = `${cw}x${ch}`;
  } else {
    aspectRatioField = aspect;
  }

  // LoRA 注入 prompt 末尾（同 runOpenAIImage 路径）
  const loraSuffix =
    typeof opts.params.lora === 'string' && opts.params.lora.trim()
      ? ' ' + opts.params.lora.trim()
      : '';
  const finalPrompt = opts.positivePrompt + loraSuffix;

  // 参考图：base64 或 URL，没有时省略字段（文生图）
  const images = await refsToUploadable(opts.referenceImages);

  // 关键：replyType:"async" → 异步模式，立刻返回 task id，不 hold 连接
  const submitBody: Record<string, unknown> = {
    model: opts.cfg.actualModelId,
    prompt: finalPrompt,
    aspectRatio: aspectRatioField,
    replyType: 'async'
  };
  // nano-banana 档位用独立字段发出（修「点 4K 出 1K」）
  if (imageSizeField) submitBody.imageSize = imageSizeField;
  if (images.length > 0) submitBody.images = images;

  logger.info('grsai.draw.async-submit', {
    url: submitUrl,
    family: family.id,
    model: opts.cfg.actualModelId,
    aspectRatio: aspectRatioField,
    imageSize: imageSizeField,
    refs: opts.referenceImages.length
  });

  // ── 第一步：提交任务 ─────────────
  const submitRes = await chromiumFetch(submitUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(submitBody),
    signal: opts.signal
  });

  if (!submitRes.ok) {
    const text = await submitRes.text().catch(() => '');
    throw new StageError(
      'upstream',
      `grsai 提交任务失败 HTTP ${submitRes.status}: ${text.slice(0, 300)}`
    );
  }

  const submitJson = (await parseJsonOrSse(submitRes)) as GrsaiResponse;
  const submitStatus = (submitJson.status ?? '').toLowerCase();

  if (submitStatus === 'failed') {
    throw new StageError(
      'upstream',
      `grsai 提交直接失败：${submitJson.error ?? '未知原因'}`
    );
  }
  if (submitStatus === 'violation') {
    throw new StageError(
      'upstream',
      `grsai 内容被判违规：${submitJson.error ?? '内容审核未通过'}`
    );
  }

  // 同步提交直接 succeeded（理论上 replyType=async 不会，但留个兜底）
  let urls: string[] = [];
  if (submitStatus === 'succeeded') {
    urls = (submitJson.results ?? [])
      .map((r) => r.url)
      .filter((u): u is string => typeof u === 'string' && u.length > 0);
  }

  // 异步路径：拿 id 进入轮询
  if (urls.length === 0) {
    const upstreamTaskId = submitJson.id;
    if (!upstreamTaskId) {
      throw new StageError(
        'parse',
        `grsai 提交未返回 task id 且 status=${submitJson.status}：${JSON.stringify(submitJson).slice(0, 200)}`
      );
    }

    logger.info('grsai.draw.task-submitted', {
      localTaskId: opts.taskId,
      upstreamTaskId
    });
    opts.notifyProgress?.({ progress: 0, phase: 'submitted' });

    // ── 第二步：轮询直到 succeeded / failed / violation ─────────────
    const POLL_INTERVAL_MS = 5000;
    const POLL_TIMEOUT_MS = 15 * 60 * 1000; // 15 分钟硬上限——再等就没意义了
    const MAX_CONSECUTIVE_POLL_ERRORS = 6; // 连续 6 次（30s）失败就放弃
    const start = Date.now();
    let consecutiveErrors = 0;

    for (;;) {
      if (opts.signal.aborted) {
        const e = new Error('Aborted');
        (e as Error).name = 'AbortError';
        throw e;
      }
      if (Date.now() - start > POLL_TIMEOUT_MS) {
        throw new StageError(
          'upstream',
          `grsai 轮询超时（>${POLL_TIMEOUT_MS / 60000} 分钟仍未完成，upstream id=${upstreamTaskId}）—— 上游可能仍在跑，请到 grsai 后台查看`
        );
      }

      await sleepWithAbort(POLL_INTERVAL_MS, opts.signal);

      let data: GrsaiResponse;
      try {
        data = await pollGrsaiOnce(opts.cfg.base_url, apiKey, upstreamTaskId, opts.signal);
        consecutiveErrors = 0;
      } catch (e) {
        consecutiveErrors++;
        logger.warn('grsai.draw.poll-error', {
          localTaskId: opts.taskId,
          upstreamTaskId,
          consecutiveErrors,
          message: (e as Error).message
        });
        if (consecutiveErrors >= MAX_CONSECUTIVE_POLL_ERRORS) {
          throw new StageError(
            'upstream',
            `grsai 轮询连续失败 ${consecutiveErrors} 次（upstream id=${upstreamTaskId}）：${(e as Error).message}`
          );
        }
        continue; // 继续下一轮
      }

      // 进度推送
      if (typeof data.progress === 'number') {
        opts.notifyProgress?.({ progress: data.progress, phase: data.status });
      }

      const status = (data.status ?? '').toLowerCase();
      if (status === 'failed') {
        throw new StageError(
          'upstream',
          `grsai 任务失败：${data.error ?? '未知原因'}（upstream id=${upstreamTaskId}）`
        );
      }
      if (status === 'violation') {
        throw new StageError(
          'upstream',
          `grsai 内容被判违规：${data.error ?? '内容审核未通过'}（upstream id=${upstreamTaskId}）`
        );
      }
      if (status === 'succeeded') {
        urls = (data.results ?? [])
          .map((r) => r.url)
          .filter((u): u is string => typeof u === 'string' && u.length > 0);
        if (urls.length === 0) {
          throw new StageError(
            'parse',
            `grsai 报告任务成功但没有图片 URL：${JSON.stringify(data).slice(0, 200)}`
          );
        }
        break; // 跳出轮询
      }
      // running / 其他：继续等
    }

    logger.info('grsai.draw.task-succeeded', {
      localTaskId: opts.taskId,
      upstreamTaskId,
      elapsedMs: Date.now() - start,
      imageCount: urls.length
    });
  }

  opts.notifyProgress?.({ progress: 100, phase: 'downloading' });

  // ── 第三步：下载结果图到本地 ─────────────
  const saved: string[] = [];
  for (let i = 0; i < urls.length; i++) {
    const buf = await fetchImageBufWithRetry(urls[i], opts.signal);
    ensureImageBuf(buf);
    try {
      saved.push(
        saveImage(buf, opts.taskId, i + 1, {
          prompt: opts.positivePrompt,
          model: opts.cfg.actualModelId,
          aspect: typeof opts.params.aspect === 'string' ? opts.params.aspect : undefined
        })
      );
    } catch (e) {
      throw new StageError('save', `写盘失败：${(e as Error).message}`);
    }
  }
  return saved;
}

// ─────────────────────────────────────────────────────
// apimart 自有协议（异步轮询模式）
// 参考：https://docs.apimart.ai/cn/api-reference/images/gpt-image-2/generation
//
// 端点：
//   提交：POST {base_url}/v1/images/generations
//   轮询：GET  {base_url}/v1/tasks/{task_id}
//
// 请求体（提交）：
//   { model, prompt, size?, resolution?, image_urls?, n? }
//   - model：模型 ID（如 'gpt-image-2'）
//   - prompt：提示词
//   - size：比例字符串（15 种）或像素，如 '16:9' / '1024x1024' / 'auto'
//   - resolution：'1k' / '2k' / '4k'（区别于 size，是档位）
//   - image_urls：参考图数组（URL 或 base64），最多 16 张
//   - n：只能是 1（apimart 限制）
//
// 提交响应：
//   { code:200, data:[{ status:'submitted', task_id:'task_xxx' }] }
//
// 轮询响应：
//   { code:200, data:{ status, result:{ images:[{ url:["https://..."] }] } } }
//   status: 'submitted' / 'processing' / 'completed' / 'failed'
//   注意：images[i].url 是数组（单元素），不是字符串
// ─────────────────────────────────────────────────────

interface ApimartImageOpts extends OpenAIImageOpts {
  referenceImages: string[];
}

interface ApimartSubmitResponse {
  code?: number;
  msg?: string;
  data?: Array<{ status?: string; task_id?: string }>;
}

interface ApimartResultResponse {
  code?: number;
  msg?: string;
  data?: {
    id?: string;
    status?: string;
    error?: string;
    result?: {
      images?: Array<{ url?: string[]; expires_at?: number }>;
    };
  };
}

async function pollApimartOnce(
  baseUrl: string,
  apiKey: string,
  taskId: string,
  signal: AbortSignal
): Promise<ApimartResultResponse['data']> {
  const url = joinApiUrl(baseUrl, `tasks/${encodeURIComponent(taskId)}`);
  const res = await chromiumFetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
    signal
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const json = JSON.parse(await res.text()) as ApimartResultResponse;
  if (json.code !== undefined && json.code !== 200 && json.code !== 0) {
    throw new Error(`apimart code=${json.code}: ${json.msg ?? ''}`);
  }
  return json.data;
}

async function runApimartImage(opts: ApimartImageOpts): Promise<string[]> {
  const submitUrl = joinApiUrl(opts.cfg.base_url, 'images/generations');
  const apiKey = decryptString(opts.cfg.api_key_encrypted);

  // size 字段决策：apimart 的 size 既能吃比例 "16:9" 也能吃像素 "1024x1024"，
  // 还有 resolution 是档位 '1k'/'2k'/'4k'。优先级：显式 W×H > 档位 + 比例 > 比例字符串。
  const w = Number(opts.params.width);
  const h = Number(opts.params.height);
  const aspect =
    typeof opts.params.aspect === 'string' && opts.params.aspect && opts.params.aspect !== 'auto'
      ? opts.params.aspect
      : '1:1';
  let sizeField: string | null = null;
  let resolutionField: string | null = null;
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    sizeField = `${snapToGrid(w)}x${snapToGrid(h)}`;
  } else {
    sizeField = aspect;
    const t = opts.params.image_size;
    if (t === '1K' || t === '2K' || t === '4K') {
      resolutionField = String(t).toLowerCase();
    }
  }

  // LoRA 注入（与其他 adapter 对齐，未来不一定有用）
  const loraSuffix =
    typeof opts.params.lora === 'string' && opts.params.lora.trim()
      ? ' ' + opts.params.lora.trim()
      : '';
  const finalPrompt = opts.positivePrompt + loraSuffix;

  // 参考图：base64 或 URL，最多 16 张
  const imageUrls = (await refsToUploadable(opts.referenceImages)).slice(0, 16);

  const submitBody: Record<string, unknown> = {
    model: opts.cfg.actualModelId,
    prompt: finalPrompt,
    n: 1 // apimart 当前限制 n=1，多张要分次提交
  };
  if (sizeField) submitBody.size = sizeField;
  if (resolutionField) submitBody.resolution = resolutionField;
  if (imageUrls.length > 0) submitBody.image_urls = imageUrls;

  logger.info('apimart.draw.submit', {
    url: submitUrl,
    model: opts.cfg.actualModelId,
    size: sizeField,
    resolution: resolutionField,
    refs: opts.referenceImages.length
  });

  // ── 第一步：提交，拿 task_id ─────────────
  const submitRes = await chromiumFetch(submitUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(submitBody),
    signal: opts.signal
  });

  if (!submitRes.ok) {
    const text = await submitRes.text().catch(() => '');
    throw new StageError(
      'upstream',
      `apimart 提交任务失败 HTTP ${submitRes.status}: ${text.slice(0, 300)}`
    );
  }

  const submitJson = JSON.parse(await submitRes.text()) as ApimartSubmitResponse;
  if (submitJson.code !== undefined && submitJson.code !== 200 && submitJson.code !== 0) {
    throw new StageError(
      'upstream',
      `apimart 提交 code=${submitJson.code}: ${submitJson.msg ?? ''}`
    );
  }
  const upstreamTaskId = submitJson.data?.[0]?.task_id;
  if (!upstreamTaskId) {
    throw new StageError(
      'parse',
      `apimart 提交未返回 task_id：${JSON.stringify(submitJson).slice(0, 200)}`
    );
  }

  logger.info('apimart.draw.task-submitted', {
    localTaskId: opts.taskId,
    upstreamTaskId
  });
  opts.notifyProgress?.({ progress: 0, phase: 'submitted' });

  // ── 第二步：轮询直到 completed / failed ─────────────
  // 调参依据：实测 ERR_CONNECTION_CLOSED 每次需 ~10s 才报错，原来 5s 间隔 + 6 次容忍
  // = 约 90s 弃疗，正好落在 92s 这种"上游马上要好但还没好"的窗口里 → 假阴性。
  // 改为 2.5s 间隔（健康时刷新更快）+ 20 次容忍（弱网下能扛 ~4 分钟瞬断），
  // 并且加 ERROR_BUDGET_MS 双保险：纯报错累计超 3 分钟也强制弃疗，避免空转太久。
  const POLL_INTERVAL_MS = 2500;
  const POLL_TIMEOUT_MS = 15 * 60 * 1000;
  const MAX_CONSECUTIVE_POLL_ERRORS = 20;
  const ERROR_BUDGET_MS = 3 * 60 * 1000;
  const start = Date.now();
  let consecutiveErrors = 0;
  let firstErrorAt = 0;
  const urls: string[] = [];

  for (;;) {
    if (opts.signal.aborted) {
      const e = new Error('Aborted');
      (e as Error).name = 'AbortError';
      throw e;
    }
    if (Date.now() - start > POLL_TIMEOUT_MS) {
      throw new StageError(
        'upstream',
        `apimart 轮询超时（>${POLL_TIMEOUT_MS / 60000} 分钟仍未完成，upstream id=${upstreamTaskId}）`
      );
    }

    await sleepWithAbort(POLL_INTERVAL_MS, opts.signal);

    let data: ApimartResultResponse['data'];
    try {
      data = await pollApimartOnce(opts.cfg.base_url, apiKey, upstreamTaskId, opts.signal);
      consecutiveErrors = 0;
      firstErrorAt = 0;
    } catch (e) {
      consecutiveErrors++;
      if (firstErrorAt === 0) firstErrorAt = Date.now();
      const errorWindowMs = Date.now() - firstErrorAt;
      logger.warn('apimart.draw.poll-error', {
        localTaskId: opts.taskId,
        upstreamTaskId,
        consecutiveErrors,
        errorWindowMs,
        message: (e as Error).message
      });
      const exhaustedCount = consecutiveErrors >= MAX_CONSECUTIVE_POLL_ERRORS;
      const exhaustedBudget = errorWindowMs >= ERROR_BUDGET_MS;
      if (exhaustedCount || exhaustedBudget) {
        throw new StageError(
          'upstream',
          `apimart 轮询连续失败 ${consecutiveErrors} 次（持续 ${(errorWindowMs / 1000).toFixed(0)}s，upstream id=${upstreamTaskId}）：${(e as Error).message}`
        );
      }
      continue;
    }

    if (!data) continue;

    const status = (data.status ?? '').toLowerCase();
    if (status === 'failed') {
      throw new StageError(
        'upstream',
        `apimart 任务失败：${data.error ?? '未知原因'}（upstream id=${upstreamTaskId}）`
      );
    }
    if (status === 'completed' || status === 'succeeded') {
      // 路径：data.result.images[*].url[*]（url 是字符串数组，单元素居多）
      const images = data.result?.images ?? [];
      for (const im of images) {
        const arr = im.url ?? [];
        for (const u of arr) {
          if (typeof u === 'string' && u.length > 0) urls.push(u);
        }
      }
      if (urls.length === 0) {
        throw new StageError(
          'parse',
          `apimart 报告完成但没有图片 URL：${JSON.stringify(data).slice(0, 200)}`
        );
      }
      break;
    }
    // submitted / processing / running：上游没暴露 progress，按"模拟值"推一下让 UI 不静默
    opts.notifyProgress?.({ phase: status || 'running' });
  }

  logger.info('apimart.draw.task-succeeded', {
    localTaskId: opts.taskId,
    upstreamTaskId,
    elapsedMs: Date.now() - start,
    imageCount: urls.length
  });
  opts.notifyProgress?.({ progress: 100, phase: 'downloading' });

  // ── 第三步：下载结果图到本地 ─────────────
  const saved: string[] = [];
  for (let i = 0; i < urls.length; i++) {
    const buf = await fetchImageBufWithRetry(urls[i], opts.signal);
    ensureImageBuf(buf);
    try {
      saved.push(
        saveImage(buf, opts.taskId, i + 1, {
          prompt: opts.positivePrompt,
          model: opts.cfg.actualModelId,
          aspect: typeof opts.params.aspect === 'string' ? opts.params.aspect : undefined
        })
      );
    } catch (e) {
      throw new StageError('save', `写盘失败：${(e as Error).message}`);
    }
  }
  return saved;
}

/** 可被 abort 中断的 sleep。 */
async function sleepWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(t);
      resolve();
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
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

/**
 * 把用户配置的 JSON 覆盖应用到默认请求体上。
 *   1. 顶层 Object.assign（用户值赢）
 *   2. 字符串值若是 `${var}` 整串占位，按 vars 表替换为真实类型（字符串/数字/null）
 *   3. 值为 null 的字段从最终 body 删除（"null = 删除"语义，让用户能屏蔽默认字段）
 *
 * 仅做顶层合并；OpenAI 图片接口的 body 字段都是平的，递归合并复杂度无价值。
 * 非法 JSON / 非对象顶层在 settings 保存时已由 zod 拦截，这里不再二次校验。
 */
function applyBodyOverrides(
  body: Record<string, unknown>,
  overrideText: string | null | undefined,
  vars: Record<string, unknown>
): void {
  if (!overrideText || !overrideText.trim()) return;
  let overrides: Record<string, unknown>;
  try {
    overrides = JSON.parse(overrideText) as Record<string, unknown>;
  } catch {
    // 理论上不会到这里（zod 已拦截）。万一发生，宁可静默跳过覆盖也不让生图失败。
    return;
  }
  for (const [k, v] of Object.entries(overrides)) {
    if (typeof v === 'string') {
      const m = v.match(/^\$\{(\w+)\}$/);
      if (m) {
        // 变量名在 vars 里才替换（含值为 null 时 → 删字段语义）；
        // 名字打错(vars 没这个键)时跳过此项覆盖、保留默认值，并记警告——
        // 而不是当成 undefined 把 body[k] 静默删掉（用户根本看不出覆盖失败）。
        if (m[1] in vars) {
          body[k] = vars[m[1]];
        } else {
          logger.warn(
            `applyBodyOverrides: 未知变量 \${${m[1]}}（请求体覆盖里写错了？），已跳过对字段 "${k}" 的覆盖`
          );
        }
      } else {
        body[k] = v;
      }
    } else {
      body[k] = v;
    }
  }
  for (const k of Object.keys(body)) {
    if (body[k] === null || body[k] === undefined) delete body[k];
  }
}

/**
 * 解 b64_json 字段。中转站常把图片包成 data URL（`data:image/png;base64,XXX`）
 * 直接塞进 b64_json，必须先剥前缀再 decode。
 *
 * 不能直接 `Buffer.from(dataUrl, 'base64')`：Node base64 解码器会跳过 `:` `;` `,`
 * 等非 base64 字符，但 `/` 是合法字母（索引 63），结果前缀里的 `data` `image` `/`
 * `png` `base64` 全被当成数据解出来，得到几 MB 垃圾字节，落盘后是坏图。
 */
function decodeB64Image(b64: string): Buffer {
  const raw = b64.replace(/^data:[^;,]+;base64,/i, '');
  return Buffer.from(raw, 'base64');
}

/**
 * 已知图像格式 magic bytes 探测。返回格式名（小写）或 null。
 * 覆盖：PNG / JPEG / GIF / BMP / WebP / TIFF / AVIF / HEIC。
 */
function detectImageFormat(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  // GIF: 47 49 46 38（"GIF8"）
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'gif';
  // BMP: 42 4D（"BM"）
  if (buf[0] === 0x42 && buf[1] === 0x4d) return 'bmp';
  // WebP: "RIFF" .... "WEBP"
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) {
    return 'webp';
  }
  // ISO BMFF（AVIF / HEIC / HEIF）：bytes 4-7 = "ftyp"，再看 brand
  if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) {
    const brand = buf.slice(8, 12).toString('ascii');
    if (brand === 'avif' || brand === 'avis') return 'avif';
    if (
      brand === 'heic' || brand === 'heix' ||
      brand === 'hevc' || brand === 'hevx' ||
      brand === 'mif1' || brand === 'msf1'
    ) {
      return 'heic';
    }
  }
  // TIFF: II*\0 / MM\0*
  if (
    (buf[0] === 0x49 && buf[1] === 0x49 && buf[2] === 0x2a && buf[3] === 0x00) ||
    (buf[0] === 0x4d && buf[1] === 0x4d && buf[2] === 0x00 && buf[3] === 0x2a)
  ) {
    return 'tiff';
  }
  return null;
}

/**
 * 落盘前的图像格式护栏：buf 不像任何主流图像格式时立即抛 parse 错。
 *
 * 触发场景：中转站把 markdown / 错误 JSON / 自定义二进制塞进 b64_json 字段，
 * Buffer.from(invalidBase64, 'base64') 不会抛——会"成功" decode 出垃圾字节，
 * 默默写盘。这道护栏拦下后 toast 直接展示开头 16 字节 hex + 80 字节 ASCII，
 * 让用户和开发者一眼看出上游真实返回，而不是面对一张坏 png 干瞪眼。
 */
function ensureImageBuf(buf: Buffer): void {
  if (detectImageFormat(buf)) return;
  const head = buf.slice(0, 80);
  const text = Array.from(head)
    .map((b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.'))
    .join('');
  const hex = Array.from(head.slice(0, 16))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(' ');
  throw new StageError(
    'parse',
    `上游返回的不是图片（${buf.length} 字节）：hex=[${hex}] text="${text}"`
  );
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

// ──────────────────────────────────────────────────────────
// ComfyUI BYOW
// ──────────────────────────────────────────────────────────
//
// 用户从 ComfyUI 网页"保存（API Format）"导出 workflow JSON 后粘贴到方案配置。
// 运行流程：
//   1. 字符串替换占位符 ({{prompt}} / {{negative_prompt}} / {{seed}} / {{batch_size}} /
//      {{width}} / {{height}} / {{lora}})
//   2. POST <base_url>/prompt → { prompt_id }
//   3. 轮询 GET /history/<prompt_id>，直到 status.completed === true 或拿到 outputs
//   4. 对每张输出图 GET /view?filename=...&subfolder=...&type=output → buffer
//   5. saveImage 落盘（命名走通用模板）
//
// 占位符语义：仅替换值为完整 "{{var}}" 字符串的字段；不支持子串拼接（避免引入复杂模板引擎）。
// 支持的位置：节点 inputs 字段值。

interface ComfyUIOpts {
  cfg: ResolvedImageCfg;
  positivePrompt: string;
  negativePrompt: string;
  params: Record<string, unknown>;
  taskId: number;
  signal: AbortSignal;
  notifyProgress?: (info: { progress?: number; phase?: string }) => void;
}

async function runComfyUIImage(opts: ComfyUIOpts): Promise<string[]> {
  const { cfg, positivePrompt, negativePrompt, params, taskId, signal, notifyProgress } = opts;
  if (!cfg.comfyui_workflow_json) {
    throw new StageError(
      'cfg',
      'ComfyUI 配置缺少 workflow JSON：请在设置→方案配置里粘贴从 ComfyUI 导出的 API Format'
    );
  }
  let workflow: Record<string, unknown>;
  try {
    workflow = JSON.parse(cfg.comfyui_workflow_json);
  } catch (e) {
    throw new StageError('cfg', `ComfyUI workflow JSON 解析失败：${(e as Error).message}`);
  }

  // 占位符变量表
  const seedRaw = (params.seed as number | undefined) ?? Math.floor(Math.random() * 2_000_000_000);
  // resolveSize 正确处理 width/height → 档位(1K/2K/4K)+比例预算 → 比例映射，
  // 返回真实 "WxH"。原先读不存在的 params.size 再退到档位字面量('4K')，
  // 正则匹配失败回退 1024×1024，导致「选 4K 实际出 1024」。
  const sizeStr = resolveSize(params);
  const sizeMatch = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(sizeStr);
  const variables: Record<string, string | number> = {
    prompt: positivePrompt,
    negative_prompt: negativePrompt,
    seed: seedRaw,
    batch_size: Number(params.n ?? 1),
    width: sizeMatch ? Number(sizeMatch[1]) : Number(params.width ?? 1024),
    height: sizeMatch ? Number(sizeMatch[2]) : Number(params.height ?? 1024),
    // {{lora}} 由 imageParamsStore 注入；当前生图侧暂未传入，未来 LoRA UI 完成后会拼好放 params.lora
    lora: typeof params.lora === 'string' ? (params.lora as string) : ''
  };

  const filledWorkflow = substituteWorkflowPlaceholders(workflow, variables);

  const baseUrl = cfg.base_url.replace(/\/$/, '');
  const apiKey = decryptString(cfg.api_key_encrypted);
  // 部分 ComfyUI 转发会要求 token；本地默认无鉴权
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey && apiKey !== 'local' && apiKey.length > 4) headers['Authorization'] = `Bearer ${apiKey}`;

  notifyProgress?.({ phase: 'comfyui:submitting', progress: 5 });
  // 用 chromiumFetch：远程 ComfyUI 转发可能耗时数十秒，原生 fetch 在中间代理处易被 60s 掐
  const submitRes = await chromiumFetch(`${baseUrl}/prompt`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ prompt: filledWorkflow }),
    signal
  });
  if (!submitRes.ok) {
    const t = await submitRes.text().catch(() => '');
    throw new StageError(
      'upstream',
      `ComfyUI POST /prompt 失败 HTTP ${submitRes.status}: ${t.slice(0, 300)}`
    );
  }
  const submitJson = JSON.parse(await submitRes.text()) as { prompt_id?: string; error?: unknown };
  if (!submitJson.prompt_id) {
    throw new StageError(
      'upstream',
      `ComfyUI 未返回 prompt_id：${JSON.stringify(submitJson).slice(0, 300)}`
    );
  }
  const promptId = submitJson.prompt_id;

  // 轮询 /history/<prompt_id> —— ComfyUI 没有 SSE，5 分钟超时
  notifyProgress?.({ phase: 'comfyui:queued', progress: 10 });
  const startedAt = Date.now();
  const TIMEOUT_MS = 5 * 60 * 1000;
  let outputs: Record<string, { images?: Array<{ filename: string; subfolder?: string; type?: string }> }> | null = null;
  while (Date.now() - startedAt < TIMEOUT_MS) {
    if (signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    await new Promise((r) => setTimeout(r, 1500));
    const hRes = await chromiumFetch(`${baseUrl}/history/${promptId}`, { signal });
    if (!hRes.ok) {
      // 早期还没记录也算正常，继续轮询
      continue;
    }
    const hJson = JSON.parse(await hRes.text()) as Record<
      string,
      {
        status?: { completed?: boolean; status_str?: string };
        outputs?: Record<string, { images?: Array<{ filename: string; subfolder?: string; type?: string }> }>;
      }
    >;
    const entry = hJson[promptId];
    if (!entry) continue;
    if (entry.status?.completed) {
      outputs = entry.outputs ?? {};
      break;
    }
    // 进度估算：把"已耗时 / 30s"映射到 10-90%（ComfyUI 没暴露真实进度）
    const elapsed = Date.now() - startedAt;
    const pct = Math.min(90, 10 + Math.round((elapsed / 30_000) * 80));
    notifyProgress?.({ phase: 'comfyui:running', progress: pct });
  }
  if (!outputs) {
    throw new StageError('upstream', 'ComfyUI 等待超时（5 分钟）');
  }

  // 收集所有有 images 的 output 节点，合并为一个数组
  const refs: Array<{ filename: string; subfolder?: string; type?: string }> = [];
  for (const node of Object.values(outputs)) {
    if (Array.isArray(node?.images)) refs.push(...node.images);
  }
  if (refs.length === 0) {
    throw new StageError('upstream', 'ComfyUI workflow 完成但未输出任何图片节点');
  }

  notifyProgress?.({ phase: 'comfyui:downloading', progress: 92 });
  const saved: string[] = [];
  let seq = 1;
  for (const ref of refs) {
    const q = new URLSearchParams({
      filename: ref.filename,
      subfolder: ref.subfolder ?? '',
      type: ref.type ?? 'output'
    });
    const vRes = await chromiumFetch(`${baseUrl}/view?${q.toString()}`, { signal });
    if (!vRes.ok) {
      throw new StageError(
        'upstream',
        `ComfyUI GET /view 失败 HTTP ${vRes.status}（${ref.filename}）`
      );
    }
    const ab = await vRes.arrayBuffer();
    const buf = Buffer.from(ab);
    const fp = saveImage(buf, taskId, seq, {
      width: variables.width as number,
      height: variables.height as number,
      prompt: positivePrompt,
      model: 'comfyui'
    });
    saved.push(fp);
    seq++;
  }
  notifyProgress?.({ phase: 'comfyui:done', progress: 100 });
  return saved;
}

/**
 * 递归遍历 workflow 对象，把所有值为完整 `{{var}}` 字符串的字段替换为 variables[var]。
 * 子串拼接形式（如 `"prefix-{{var}}"`) 不替换 —— 显式要求"完整等于占位符"，避免误伤。
 */
function substituteWorkflowPlaceholders(
  obj: unknown,
  variables: Record<string, string | number>
): unknown {
  if (typeof obj === 'string') {
    const m = /^\{\{(\w+)\}\}$/.exec(obj.trim());
    if (m && m[1] in variables) return variables[m[1]];
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map((x) => substituteWorkflowPlaceholders(x, variables));
  }
  if (obj && typeof obj === 'object') {
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      next[k] = substituteWorkflowPlaceholders(v, variables);
    }
    return next;
  }
  return obj;
}
