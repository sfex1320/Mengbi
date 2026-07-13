import { z } from 'zod';
import type { WebContents } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { register, ok, err, appendNotification, parseModelRef } from './helpers';
import { ImageGenerateSchema } from './schemas';
import { getDb } from '../services/db';
import { decryptString } from '../services/safeStorage';
import { joinApiUrl } from '../services/apiUrl';
import { applyHeaderOverrides } from './headerOverrides';
import { pickStreamImage, type StreamImg } from './imageStreamParse';
import { logger } from '../services/logger';
import { makeError } from '@shared/error';
import { computeImageRemedy } from './imageRemedy';
import { compositeInpaintResult } from './inpaintComposite';
import { isMockMode } from './mocks/runtime';
import { ensureThumbnail } from '../services/thumbnail';
import { detectFamily, getFamilyById, mapGptTierSize, clampToImage2Size, type ImageFamily } from '@shared/imageModelFamilies';
import { chromiumFetch, ChromiumNetError } from '../services/httpClient';
import {
  apimartCode,
  extractApimartSubmit,
  extractApimartStatus,
  isApimartDone,
  isApimartFailed,
  extractApimartError,
  extractApimartImageUrls,
  resolveApimartStatusUrl
} from './apimartParse';
import { saveImage, getStorageRoot } from '../services/imageStore';
import {
  TIER_PIXEL_BUDGET,
  snapToGrid,
  pixelsByAspectAndBudget,
  resolveSize,
  applyBodyOverrides,
  substituteWorkflowPlaceholders
} from './imageBody';

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
    // 资产库分组：智能画布等上游可在 params 里塞 gallery_group（如画布名），落库时归入该文件夹。
    let galleryGroup: string | null = null;
    try {
      const tp = JSON.parse(task.params) as Record<string, unknown>;
      if (typeof tp.gallery_group === 'string' && tp.gallery_group.trim()) {
        galleryGroup = tp.gallery_group.trim().slice(0, 120);
      }
    } catch {
      /* params 解析失败 → 不分组 */
    }
    for (let i = 0; i < savedPaths.length; i++) {
      getDb()
        .prepare(
          `INSERT INTO images(task_id, file_path, thumbnail_path, prompt_positive, prompt_negative, model_used, params_json, group_name, created_at)
           VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          item.taskId,
          savedPaths[i],
          thumbPaths[i],
          task.positive_prompt,
          task.negative_prompt,
          task.model_id,
          task.params,
          galleryGroup,
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
    // 兜底中文解释：不管哪条协议路径抛上来的错，最终出口统一补一句「原因 + 怎么办」。
    // （部分 throw 点已就地补过 hint，includes 判断防止重复追加同一句。）
    const finalHint = upstreamErrorHint(displayMsg);
    if (finalHint && !displayMsg.includes(finalHint)) displayMsg += finalHint;
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
      taskId: item.taskId,
      // 可一键修复时附建议：前端通知中心显示「一键修复」按钮，点一下把覆盖写进该绘画模型
      remedy: computeImageRemedy(displayMsg, task.model_id)
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
  /** 自定义请求头 JSON（header 名→值，合并进默认头）。null = 不覆盖。 */
  header_overrides_json: string | null;
  /** image_kind='comfyui' 时存的 workflow JSON 文本（API Format） */
  comfyui_workflow_json: string | null;
}

function findImageConfig(modelDisplayId: string): ResolvedImageCfg | null {
  const configs = getDb()
    .prepare(`SELECT * FROM api_configs WHERE type = 'image' ORDER BY id`)
    .all() as Array<{
    id: number;
    provider_name: string | null;
    base_url: string;
    api_key_encrypted: string;
    model_mapping: string;
    image_kind: string | null;
    body_overrides_json: string | null;
    header_overrides_json: string | null;
    comfyui_workflow_json: string | null;
  }>;
  // 模型标识可能是复合「中转站 / 名」（区分同名模型在不同中转站）或旧裸名。
  const { provider, name } = parseModelRef(modelDisplayId);
  type Row = (typeof configs)[number];
  const build = (c: Row, actual: string): ResolvedImageCfg => ({
    id: c.id,
    base_url: c.base_url,
    api_key_encrypted: c.api_key_encrypted,
    actualModelId: actual,
    image_kind: c.image_kind ?? null,
    body_overrides_json: c.body_overrides_json ?? null,
    header_overrides_json: c.header_overrides_json ?? null,
    comfyui_workflow_json: c.comfyui_workflow_json ?? null
  });
  const mapOf = (c: Row): Record<string, string> => {
    try {
      return JSON.parse(c.model_mapping || '{}');
    } catch {
      return {};
    }
  };
  // 1) 复合：中转站名 + 映射名 精确命中
  if (provider) {
    for (const c of configs) {
      if ((c.provider_name ?? '').trim() !== provider) continue;
      const v = mapOf(c)[name];
      if (v) return build(c, v);
    }
  }
  // 2) 回退：按裸名（复合名的 name 段）首个命中——等价旧逻辑，旧裸名存量绝不退化
  for (const c of configs) {
    const v = mapOf(c)[name];
    if (v) return build(c, v);
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

// 比例 → 像素尺寸 / 档位换算 / 请求体覆盖 等纯函数已抽到 ./imageBody（便于单测）。
// ASPECT_TO_SIZE / TIER_PIXEL_BUDGET / snapToGrid / pixelsByAspectAndBudget / resolveSize /
// applyBodyOverrides 均从那里 import。

/** 把上游错误正文翻译成「做什么 + 怎么办」的中文提示（识别不了返回 ''，原文照旧透传）。
 *  顺序：先具体后通用——通用的 HTTP/网络模式放最后，避免抢先命中。 */
function upstreamErrorHint(text: string): string {
  if (/denied for this API key|permission_error|insufficient.*permission/i.test(text))
    return '——该 API Key 无权使用此模型：换一个绘画模型，或到该中转站为这把 Key 开通此模型';
  if (/invalid option.*auto.*low.*medium.*high/i.test(text))
    return '——quality 参数不被该模型接受（gpt-image 系列只认 auto/low/medium/high）：把「质量」换档后重试';
  if (/insufficient_quota|余额|欠费|quota|arrears|balance/i.test(text))
    return '——配额/余额不足：到中转站充值，或换一个方案/模型';
  if (/无可用渠道|无可用通道|model.*(not.*found|does not exist)|unknown model|invalid model/i.test(text))
    return '——模型不存在或中转站没开通：检查设置里「模型映射」填的真实模型 ID 是否正确，或换模型';
  if (/content.?policy|safety|sensitive|flagged|violat|moderation|敏感|违规|审核/i.test(text))
    return '——提示词疑似触发内容安全审核：换个措辞（避开敏感词/人名/品牌）后重试';
  if (/invalid.*(size|resolution)|size.*not.*support|unsupported.*size/i.test(text))
    return '——所选尺寸/分辨率不被该模型支持：换一个比例或分辨率档位重试';
  if (/(^|\D)401(\D|$)|unauthorized|invalid.*api.?key|incorrect.*api.?key|authentication/i.test(text))
    return '——API Key 无效或过期：到设置里检查这条配置的 Key 是否填错（注意别带空格）';
  if (/(^|\D)429(\D|$)|rate.?limit|too many requests|concurren/i.test(text))
    return '——请求太频繁或并发超限（高峰期常见）：等几十秒重试，或减少同时生成的任务数';
  if (/(^|\D)(502|503|504)(\D|$)|bad gateway|gateway time-?out|service unavailable|overloaded/i.test(text))
    return '——中转站网关错误（多为排队/过载，常发生在请求已转给上游之后）：⚠️ 上游任务可能仍在处理，先到中转站后台「任务记录」/ 本软件资产库 查看是否已出图，勿立刻重复提交以免重复扣费；确无结果再稍等几分钟重试';
  if (/(^|\D)(500)(\D|$)|internal server error|server.?error/i.test(text))
    return '——中转站或上游服务故障（高峰期排队/过载也会这样）：稍等几分钟重试，或换模型/换方案';
  if (/ETIMEDOUT|ECONNRESET|ECONNREFUSED|fetch failed|socket hang up|network|ERR_(CONNECTION|TIMED)|net::/i.test(text))
    return '——与中转站的连接中断：⚠️ 若已等待较久，上游任务可能仍在执行，请先到中转站后台 / 资产库确认是否已出图，避免重复提交；确无结果再检查本机网络/代理/防火墙与 API 地址后重试';
  return '';
}

/**
 * 流式请求被中转站「快速拒绝」时抛出的标记（立刻 4xx/5xx，而非慢生成后才失败）。
 * 上层 runOpenAIImage 捕获它后退回非流式重试；慢生成失败不抛它（照实报错，不诱导重试再等一遍）。
 */
class StreamRejectedError extends Error {
  constructor(
    readonly status: number,
    readonly elapsedMs: number
  ) {
    super(`streaming rejected fast (HTTP ${status}, ${elapsedMs}ms)`);
    this.name = 'StreamRejectedError';
  }
}

/** 流式快速失败阈值：低于此耗时的 !ok 视为「中转站不支持图像 SSE」→ 退回非流式；
 *  高于此（如极端比例 4K 跑 100s+ 才 500）视为上游真做不动，照实报错不退回。 */
const STREAM_REJECT_FAST_MS = 25_000;

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
  }, (m) => logger.warn(m));

  // ────────────────────────────────────────────────────────────
  // 流式分支：family 声明了 streaming 能力（目前只有 gpt-image-2）。
  // 拷贝一份 body 加 `stream: true` + `partial_images: N` 走 SSE（中间步骤图作心跳，
  // 让支持 SSE 的中转的 60s 边缘代理超时不触发）；原 body 保持非流式形态，供
  // 「中转站快速拒绝 stream:true（很多站对图像接口不支持 SSE，立刻 4xx/5xx）」时无损退回非流式重试。
  // ────────────────────────────────────────────────────────────
  // 用户在「请求体覆盖」里显式写了 "stream": false（如一键修复 SSE 格式不被识别的中转站）→ 尊重它，直接走非流式。
  if (family.streaming && body.stream !== false) {
    const streamBody: Record<string, unknown> = {
      ...body,
      stream: true,
      partial_images: family.streaming.partialImages
    };
    delete streamBody.response_format; // SSE 总是 b64_json，response_format 字段反而会被部分中转拒
    logger.info('runOpenAIImage: ENTERING streaming branch', {
      partial_images: streamBody.partial_images,
      finalBodyKeys: Object.keys(streamBody)
    });
    try {
      return await runOpenAIImageStreaming(url, apiKey, streamBody, opts);
    } catch (e) {
      if (e instanceof StreamRejectedError) {
        // 快速失败＝中转站根本不支持图像 SSE → 退回非流式重试一次（此前流式没产出，不会二次扣费）。
        logger.warn('runOpenAIImage: 流式被中转站快速拒绝，退回非流式重试', {
          status: e.status,
          elapsedMs: e.elapsedMs
        });
        return await postOpenAIImageSync(url, apiKey, body, opts);
      }
      throw e;
    }
  }
  logger.info('runOpenAIImage: family 无 streaming 能力，走非流式', { familyId: family.id });
  return await postOpenAIImageSync(url, apiKey, body, opts);
}

/**
 * 非流式 POST /v1/images/generations + 解析 + 落盘。
 * 是 runOpenAIImage 的同步出图路径，抽成独立函数，以便「流式被中转站快速拒绝」时无损退回复用。
 */
async function postOpenAIImageSync(
  url: string,
  apiKey: string,
  body: Record<string, unknown>,
  opts: OpenAIImageOpts
): Promise<string[]> {
  // chromiumFetch（基于 net.request）—— 图像生成上游单次请求常 60–300s，
  // Node 自带 fetch / net.fetch 都会被中间代理掐断成 "fetch failed"，
  // 走 Chromium URLLoader 才稳。
  const res = await chromiumFetch(url, {
    method: 'POST',
    headers: applyHeaderOverrides(
      { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      opts.cfg.header_overrides_json,
      { key: apiKey, model: opts.cfg.actualModelId }
    ),
    body: JSON.stringify(body),
    signal: opts.signal
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new StageError('upstream', `HTTP ${res.status}: ${text.slice(0, 300)}${upstreamErrorHint(text)}`);
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
 *       image_generation.completed      → 终态图（带 b64_json 或 url，要保存）
 *       error                            → 上游报错
 *   - 中转的 60s 边缘超时按"连接静默"计时，partial_image 每 N 秒来一次就清零，
 *     所以 140s 的真实生成时间也能跑通。
 *   - 兼容差异中转站：终态图字段名/事件名不一致时用 pickStreamImage 兜底；完全没有终态事件
 *     但有过中间步骤图时，退而用最后一张中间图（near-final，避免「后台已出图却报错丢图」）。
 */
async function runOpenAIImageStreaming(
  url: string,
  apiKey: string,
  body: Record<string, unknown>,
  opts: OpenAIImageOpts
): Promise<string[]> {
  const t0 = Date.now();
  const completedImgs: StreamImg[] = [];
  let lastPartial: StreamImg | null = null;
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
          const json = JSON.parse(payload) as Record<string, unknown>;
          const errField = json.error;
          const type = typeof json.type === 'string' ? json.type : '';
          if (errField) {
            upstreamError =
              typeof errField === 'string'
                ? errField
                : (typeof (errField as { message?: unknown }).message === 'string'
                    ? ((errField as { message?: string }).message as string)
                    : '上游错误（无 message）');
          } else {
            const isPartial = type.includes('partial');
            const img = pickStreamImage(json);
            if (isPartial) {
              // 中间步骤图也是真图；不存盘，只记为兜底 + 汇报进度让 UI 不静默
              if (img) lastPartial = img;
              partialCount++;
              opts.notifyProgress?.({ phase: `streaming:partial(${partialCount})` });
            } else if (img) {
              // 终态图：兼容 image_generation.completed / 别名事件 / 仅带 url 的中转站
              completedImgs.push(img);
              completedCount++;
              opts.notifyProgress?.({ progress: 100, phase: 'streaming:completed' });
            }
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
  // 连接可能在「上游已出图（已扣费）」后才被中转站/边缘代理掐断（unity2 这类长耗时同步出图常见）。
  // chromiumFetch 是「先 onChunk 收数据、再 reject」，所以收到的 partial/completed 都已落进 completedImgs/lastPartial，
  // 必须 try/catch 住，否则连接一断就把已经到手的图丢了（用户白扣费）。
  let res: Awaited<ReturnType<typeof chromiumFetch>> | null = null;
  let connError: unknown = null;
  try {
    res = await chromiumFetch(url, {
      method: 'POST',
      headers: applyHeaderOverrides(
        { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, Accept: 'text/event-stream' },
        opts.cfg.header_overrides_json,
        { key: apiKey, model: opts.cfg.actualModelId }
      ),
      body: JSON.stringify(body),
      signal: opts.signal,
      onChunk
    });
  } catch (e) {
    connError = e;
  }

  logger.info('runOpenAIImage:streaming finished', {
    status: res?.status,
    partialCount,
    completedCount,
    sawError: upstreamError !== null,
    connError: connError ? String(connError) : undefined
  });

  if (connError) {
    // 连接中断：上游明确报过错就抛错；否则已收到的（终态或最后一张中间步骤）图照常保存，避免「后台有图却报错丢图」。
    if (upstreamError) {
      throw new StageError('upstream', `上游错误：${upstreamError}${upstreamErrorHint(upstreamError)}`);
    }
    if (completedImgs.length === 0 && lastPartial) {
      logger.warn('runOpenAIImage:streaming 连接中断，用最后一张中间步骤图兜底', { partialCount, err: String(connError) });
      completedImgs.push(lastPartial);
    }
    if (completedImgs.length === 0) {
      // 真没收到任何图（中转站没发 SSE 心跳、纯缓冲到死）→ 抛原「连接中断」诊断（含 grsai/降分辨率建议）
      throw connError;
    }
    logger.warn('runOpenAIImage:streaming 连接中断但已收到图，照常保存', { count: completedImgs.length });
  } else if (res) {
    if (!res.ok) {
      const elapsedMs = Date.now() - t0;
      // 快速失败（<阈值）＝中转站不支持图像 SSE，立刻报错 → 抛 StreamRejectedError 让上层退回非流式重试。
      // 慢生成后失败（如极端比例 4K 跑 100s+ 才 500）＝上游真做不动 → 照实抛 StageError，不诱导上层重试再等一遍。
      if (elapsedMs < STREAM_REJECT_FAST_MS) {
        logger.warn('runOpenAIImage:streaming 快速失败，标记为退回非流式', { status: res.status, elapsedMs });
        throw new StreamRejectedError(res.status, elapsedMs);
      }
      throw new StageError(
        'upstream',
        `HTTP ${res.status} on streaming /v1/images/generations${
          upstreamError ? `（上游：${upstreamError}）` : ''
        }${upstreamErrorHint(upstreamError ?? '')}`
      );
    }
    if (upstreamError) {
      throw new StageError('upstream', `上游错误：${upstreamError}${upstreamErrorHint(upstreamError)}`);
    }
  }

  if (completedImgs.length === 0) {
    // 1) 中转站把 stream 忽略了、直接回普通 JSON（没按 SSE 发事件）→ 从整段 buffer 抢救
    //    （避免「重发 = 二次扣费」）。兼容 {data:[...]} / 顶层单图 等形态。
    try {
      const j = JSON.parse(buffer.trim()) as Record<string, unknown>;
      const list = Array.isArray((j as { data?: unknown }).data)
        ? ((j as { data: unknown[] }).data)
        : [j];
      for (const it of list) {
        const im = it && typeof it === 'object' ? pickStreamImage(it as Record<string, unknown>) : null;
        if (im) completedImgs.push(im);
      }
    } catch {
      /* 不是 JSON，下面再试中间图兜底 */
    }
    // 2) 仍没终态图，但流里出现过中间步骤图 → 用最后一张兜底（near-final），
    //    避免「后台已出图、前端却报错丢图」（差异中转站终态事件名/字段不被识别时尤甚）。
    if (completedImgs.length === 0 && lastPartial) {
      logger.warn('runOpenAIImage:streaming 未见终态事件，用最后一张中间步骤图兜底', { partialCount });
      completedImgs.push(lastPartial);
    }
    if (completedImgs.length === 0) {
      throw new StageError(
        'parse',
        'SSE 流结束但没识别出终态图（该中转站的图像流格式不被识别）——可在该绘画模型的「请求体覆盖」里加 {"stream": false} 改用非流式返回'
      );
    }
    logger.info('runOpenAIImage:streaming 兜底取图成功', { count: completedImgs.length });
  }

  const saved: string[] = [];
  for (let i = 0; i < completedImgs.length; i++) {
    const item = completedImgs[i];
    let buf: Buffer;
    if (item.b64) {
      try {
        buf = decodeB64Image(item.b64);
      } catch (e) {
        throw new StageError('parse', `b64 解码失败：${(e as Error).message}`);
      }
    } else if (item.url) {
      buf = await fetchImageBufWithRetry(item.url, opts.signal);
    } else {
      throw new StageError('parse', '图片数据格式不明（既无 b64 也无 url）');
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
  }, (m) => logger.warn(m));

  logger.info('runOpenAIResponsesImage', {
    url,
    family: family.id,
    model: opts.cfg.actualModelId,
    inputKind: typeof input === 'string' ? 'text' : `array(${(input as ResponsesInputItem[]).length})`,
    toolSize: tool.size,
    toolQuality: tool.quality,
    partial_images: tool.partial_images
  });

  // SSE 解析——与 runOpenAIImageStreaming 同套（pickStreamImage 兼容差异中转站字段/事件名/url），只多加 response.* 事件分支
  const completedImgs: StreamImg[] = [];
  let lastPartial: StreamImg | null = null;
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
          const json = JSON.parse(payload) as Record<string, unknown>;
          const type = typeof json.type === 'string' ? json.type : '';
          const errField = json.error;
          const respErr = (json.response as { error?: { message?: unknown } } | undefined)?.error?.message;
          if (errField) {
            upstreamError =
              typeof errField === 'string'
                ? errField
                : (typeof (errField as { message?: unknown }).message === 'string'
                    ? ((errField as { message?: string }).message as string)
                    : '上游错误（无 message）');
          } else if (type === 'response.failed' || type === 'response.error') {
            if (typeof respErr === 'string') upstreamError = respErr;
          } else {
            const isPartial = type.includes('partial');
            const img = pickStreamImage(json);
            if (isPartial) {
              if (img) lastPartial = img;
              partialCount++;
              opts.notifyProgress?.({ phase: `responses:partial(${partialCount})` });
            } else if (img) {
              completedImgs.push(img);
              completedCount++;
              opts.notifyProgress?.({ progress: 100, phase: 'responses:completed' });
            }
          }
          // response.output_item.added / response.completed（无图载荷时）：仅作流转信号
        } catch {
          // 非标准 data: 行（注释 / keepalive）忽略
        }
      }
    }
  };

  // 同 runOpenAIImageStreaming：连接可能在上游已出图后被掐断，try/catch 住已收到的图（避免白扣费丢图）。
  let res: Awaited<ReturnType<typeof chromiumFetch>> | null = null;
  let connError: unknown = null;
  try {
    res = await chromiumFetch(url, {
      method: 'POST',
      headers: applyHeaderOverrides(
        { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, Accept: 'text/event-stream' },
        opts.cfg.header_overrides_json,
        { key: apiKey, model: opts.cfg.actualModelId }
      ),
      body: JSON.stringify(body),
      signal: opts.signal,
      onChunk
    });
  } catch (e) {
    connError = e;
  }

  logger.info('runOpenAIResponsesImage finished', {
    status: res?.status,
    partialCount,
    completedCount,
    sawError: upstreamError !== null,
    connError: connError ? String(connError) : undefined
  });

  if (upstreamError) {
    throw new StageError('upstream', `上游错误：${upstreamError}${upstreamErrorHint(upstreamError)}`);
  }
  if (connError) {
    if (completedImgs.length === 0 && lastPartial) {
      logger.warn('runOpenAIResponsesImage 连接中断，用最后一张中间步骤图兜底', { partialCount, err: String(connError) });
      completedImgs.push(lastPartial);
    }
    if (completedImgs.length === 0) throw connError;
    logger.warn('runOpenAIResponsesImage 连接中断但已收到图，照常保存', { count: completedImgs.length });
  } else if (res && !res.ok) {
    throw new StageError(
      'upstream',
      `HTTP ${res.status} on /v1/responses${upstreamError ? `（上游：${upstreamError}）` : ''}${upstreamErrorHint(upstreamError ?? '')}`
    );
  }
  if (completedImgs.length === 0 && lastPartial) {
    // 没有终态事件但出现过中间步骤图 → 用最后一张兜底（避免「后台已出图却报错丢图」）
    logger.warn('runOpenAIResponsesImage 未见终态事件，用最后一张中间步骤图兜底', { partialCount });
    completedImgs.push(lastPartial);
  }
  if (completedImgs.length === 0) {
    throw new StageError(
      'parse',
      'Responses SSE 流结束但没识别出终态图（中转可能未实现 /v1/responses 或缓冲了 SSE）——可在该绘画模型的「请求体覆盖」里加 {"stream": false} 改用非流式'
    );
  }

  const saved: string[] = [];
  for (let i = 0; i < completedImgs.length; i++) {
    const item = completedImgs[i];
    let buf: Buffer;
    if (item.b64) {
      try {
        buf = decodeB64Image(item.b64);
      } catch (e) {
        throw new StageError('parse', `b64 解码失败：${(e as Error).message}`);
      }
    } else if (item.url) {
      buf = await fetchImageBufWithRetry(item.url, opts.signal);
    } else {
      throw new StageError('parse', '图片数据格式不明（既无 b64 也无 url）');
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

  // gpt-image-2 选 1K/2K 档 → 与文生图同一套枚举尺寸映射（任意 WxH 在不少中转站被拒）；
  // 用户给了精确宽高则精确值优先。其它 family 走 resolveSize 原逻辑。
  const editFamily = detectFamily(opts.cfg.actualModelId);
  const tierMapped =
    editFamily.id === 'gpt-image-2' && !opts.params.width && !opts.params.height
      ? mapGptTierSize(
          typeof opts.params.image_size === 'string' ? opts.params.image_size : undefined,
          typeof opts.params.aspect === 'string' ? opts.params.aspect : undefined
        )
      : null;
  // gpt-image-2 且用户给了精确宽高 → 规整到合法尺寸（单边≤3840 / 比例≤3:1 / 655360..8.3MP，
  // 与文生图 computeSize 同一套约束）；档位映射优先，其它 family / 比例路径仍走 resolveSize。
  const editW = Number(opts.params.width);
  const editH = Number(opts.params.height);
  let size: string;
  if (tierMapped) {
    size = `${tierMapped.w}x${tierMapped.h}`;
  } else if (editFamily.id === 'gpt-image-2' && editW > 0 && editH > 0) {
    const c = clampToImage2Size(editW, editH);
    size = `${c.w}x${c.h}`;
  } else {
    size = resolveSize(opts.params);
  }
  const n = typeof opts.params.n === 'number' ? opts.params.n : 1;
  // gpt-image 系列 quality 枚举 = auto|low|medium|high：「标准」(standard) 是 DALL·E 3 词表，
  // 严格校验的中转站会 400（与文生图 buildBody 同源映射 standard→medium）。
  const rawQuality = typeof opts.params.quality === 'string' ? opts.params.quality : undefined;
  let quality = editFamily.id === 'gpt-image-2' && rawQuality === 'standard' ? 'medium' : rawQuality;
  // 与文生图 buildBody 同源：「默认」(空)= 自动按分辨率智能选，且绝不发"空 quality"
  //（部分中转站如 Now Coding 把分辨率挂在 quality 上，不带 quality 会降级到 ~1K 并无视 size）。
  // gpt-image-2 且用户未显式选 quality 时：4K→high / 2K→medium / 1K→low / 未选档位→auto。
  if (editFamily.id === 'gpt-image-2' && !quality) {
    const tier = typeof opts.params.image_size === 'string' ? opts.params.image_size : '';
    quality = tier === '4K' ? 'high' : tier === '2K' ? 'medium' : tier === '1K' ? 'low' : 'auto';
  }

  // FormData / Blob 是 Node 18+ / Electron 28 内置全局
  const form = new FormData();
  form.append('model', opts.cfg.actualModelId);
  form.append('prompt', opts.positivePrompt);
  form.append('size', size);
  form.append('n', String(n));
  if (quality === 'standard' || quality === 'high' || quality === 'medium' || quality === 'low' || quality === 'auto')
    form.append('quality', quality);

  // 多张参考图：用 image[] 字段（OpenAI gpt-image-1 支持）
  // 三种来源：fs 路径（文件选择器）/ data URI（拖拽 / 粘贴 / 画板）/ http(s) URL
  let attached = 0;
  let baseImageBuf: Buffer | null = null; // 首张参考图(底图) buffer，留作局部重绘「合成贴回」
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
      if (baseImageBuf === null) baseImageBuf = buf; // 首张=底图，合成贴回用
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
  let maskBuf: Buffer | null = null; // 留作「合成贴回」（未遮罩区保留底图像素）
  const inpaintMask = typeof opts.params.inpaint_mask === 'string' ? opts.params.inpaint_mask : null;
  if (inpaintMask) {
    const mm = /^data:([^;]+);base64,(.+)$/.exec(inpaintMask);
    if (mm) {
      const mbuf = Buffer.from(mm[2], 'base64');
      form.append('mask', new Blob([new Uint8Array(mbuf)], { type: mm[1] || 'image/png' }), 'mask.png');
      maskBuf = mbuf;
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
      `HTTP ${res.status} on /v1/images/edits: ${text.slice(0, 300)}${upstreamErrorHint(text)}`
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
    // 局部重绘/扩图「合成贴回」：以底图尺寸为准，未遮罩区原样保留底图（修「中间被改」+「比例乱跳」）。
    if (maskAttached && baseImageBuf && maskBuf) {
      buf = await compositeInpaintResult(buf, baseImageBuf, maskBuf);
      ensureImageBuf(buf);
    }
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

  // 端点决策（修「nano-banana 选 4K 却只出 1K」）：
  // grsai 旧的通用端点 `api/generate` 不认 imageSize → 4K 静默退化成 1K。
  // 官方文档与 ComfyUI-GrsAI 参考实现都用 `/v1/draw/nano-banana`，且明确支持
  // imageSize="1K"/"2K"/"4K"。故 nano-banana 改走官方端点；gpt-image-2-vip 等其它模型
  // 保持旧端点不动（隔离，不影响它们）。官方端点若在该中转站不存在（404/405）则自动回退
  // 旧端点，避免硬退化（回退后 imageSize 可能被忽略，但至少能出图）。
  const legacyUrl = joinApiUrl(opts.cfg.base_url, 'api/generate');
  let submitUrl = isNanoBanana
    ? joinApiUrl(opts.cfg.base_url, 'v1/draw/nano-banana')
    : legacyUrl;

  // aspectRatio 字段决策（新版统一支持 "16:9" / "1024x1024" / "4K" 三种）：
  //   1. nano-banana 系列且选了档位 → 档位进独立 imageSize 字面量（"1K"/"2K"/"4K"），比例进 aspectRatio
  //   2. 显式 width/height 双字段 → "WxH"（gpt-image-2 这类按像素出图）
  //   3. 显式档位 + 比例 → 用预算换算成 "WxH"
  //   4. 其他 → 比例字符串（"16:9"）
  let aspectRatioField: string;
  // nano-banana 新版后端把「档位」放进独立的 imageSize 字段（"1K"/"2K"/"4K"），
  // aspectRatio 仍放真实比例（"1:1"）。旧代码把档位塞进 aspectRatio（"4K"），新后端
  // 不认这个"比例" → 静默回退默认 1K —— 这就是「点 4K 却只出 1K」的根因。
  // 仅 nano-banana 系列走这条；gpt-image-2 等仍按 WxH 不受影响（隔离）。
  // 2026-07-14：nano-banana 的档位分支提到 WxH 之前——智能画布尺寸节点会同时给
  // width/height + image_size，此前 WxH 分支先命中 → 档位被绕过 + snapToGrid 封顶 3840，
  // 「点 4K 只出 1K」在接了尺寸节点时复发。
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
  if (isNanoBanana && tierLabel) {
    // 比例进 aspectRatio，档位进独立 imageSize（与 grsai nano-banana 文档示例一致）
    aspectRatioField = aspect;
    imageSizeField = tierLabel;
  } else if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    aspectRatioField = `${snapToGrid(w)}x${snapToGrid(h)}`;
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
  const submitInit = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(submitBody),
    signal: opts.signal
  } as const;
  let submitRes = await chromiumFetch(submitUrl, submitInit);
  // 官方 /v1/draw/nano-banana 在该中转站不存在 → 回退旧端点 api/generate（不硬退化）
  if (
    isNanoBanana &&
    submitUrl !== legacyUrl &&
    (submitRes.status === 404 || submitRes.status === 405)
  ) {
    logger.warn('grsai.draw.official-endpoint-missing', {
      status: submitRes.status,
      from: submitUrl,
      fallback: legacyUrl
    });
    submitUrl = legacyUrl;
    submitRes = await chromiumFetch(submitUrl, submitInit);
  }

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
    // 间隔 3s：状态查询是轻量 GET，间隔越短「后台已出图但还没轮询到」的等待越短
    const POLL_INTERVAL_MS = 3000;
    const POLL_TIMEOUT_MS = 15 * 60 * 1000; // 15 分钟硬上限——再等就没意义了
    const MAX_CONSECUTIVE_POLL_ERRORS = 10; // 连续 10 次（30s）失败就放弃
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

// apimart 提交/轮询响应的解析全部收口到 ./apimartParse（兼容官方 + 新版 async-generations 两种形态，纯函数可单测）。

async function pollApimartOnce(
  baseUrl: string,
  apiKey: string,
  taskId: string,
  signal: AbortSignal,
  statusUrl?: string | null
): Promise<unknown> {
  // 新版给了自描述 status_url 就用它；否则回退官方 GET /tasks/{id}
  const url = statusUrl ?? joinApiUrl(baseUrl, `tasks/${encodeURIComponent(taskId)}`);
  const res = await chromiumFetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
    signal
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const json: unknown = JSON.parse(await res.text());
  const code = apimartCode(json);
  if (code !== undefined && code !== 200 && code !== 0) {
    const msg = (json as { msg?: string })?.msg ?? '';
    throw new Error(`apimart code=${code}: ${msg}`);
  }
  return json;
}

async function runApimartImage(opts: ApimartImageOpts): Promise<string[]> {
  const submitUrl = joinApiUrl(opts.cfg.base_url, 'images/generations');
  const apiKey = decryptString(opts.cfg.api_key_encrypted);

  // size 字段决策：apimart 的 size 既能吃比例 "16:9" 也能吃像素 "1024x1024"，
  // 还有 resolution 是档位 '1k'/'2k'/'4k'。
  // 优先级（2026-07-14 调整）：可表达的显式 W×H（最长边 ≤3840）> 档位 + 比例 > 比例字符串。
  // 智能画布尺寸节点会同时给 width/height + image_size：4K 档（4096 边）超出 snapToGrid 的
  // 3840 封顶，此前被 WxH 分支静默砍小且绕过 resolution 档位字段 → 改为超限时走 档位+比例。
  const w = Number(opts.params.width);
  const h = Number(opts.params.height);
  const aspect =
    typeof opts.params.aspect === 'string' && opts.params.aspect && opts.params.aspect !== 'auto'
      ? opts.params.aspect
      : '1:1';
  const t = opts.params.image_size;
  const tierOk = t === '1K' || t === '2K' || t === '4K';
  let sizeField: string | null = null;
  let resolutionField: string | null = null;
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 && (Math.max(w, h) <= 3840 || !tierOk)) {
    sizeField = `${snapToGrid(w)}x${snapToGrid(h)}`;
  } else {
    sizeField = aspect;
    if (tierOk) {
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

  const submitJson: unknown = JSON.parse(await submitRes.text());
  const submitCode = apimartCode(submitJson);
  if (submitCode !== undefined && submitCode !== 200 && submitCode !== 0) {
    const msg = (submitJson as { msg?: string })?.msg ?? '';
    throw new StageError('upstream', `apimart 提交 code=${submitCode}: ${msg}`);
  }
  // 兼容两种异步形态：官方 data[0].task_id；新版 async-generations 把 task_id/job_id 放顶层 + 给 status_url。
  const { taskId: upstreamTaskId, statusUrl: rawStatusUrl } = extractApimartSubmit(submitJson);
  if (!upstreamTaskId) {
    throw new StageError(
      'parse',
      `apimart 提交未返回 task_id：${JSON.stringify(submitJson).slice(0, 200)}`
    );
  }
  // 新版给了 status_url（自描述轮询地址）就用它（挂到 origin 避免双 /v1）；否则回退官方 /tasks/{id}
  const pollStatusUrl = rawStatusUrl ? resolveApimartStatusUrl(opts.cfg.base_url, rawStatusUrl) : null;

  logger.info('apimart.draw.task-submitted', {
    localTaskId: opts.taskId,
    upstreamTaskId,
    statusUrl: pollStatusUrl
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

    let pollJson: unknown;
    try {
      pollJson = await pollApimartOnce(opts.cfg.base_url, apiKey, upstreamTaskId, opts.signal, pollStatusUrl);
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

    if (!pollJson) continue;

    const status = extractApimartStatus(pollJson);
    if (isApimartFailed(status)) {
      throw new StageError(
        'upstream',
        `apimart 任务失败：${extractApimartError(pollJson) ?? '未知原因'}（upstream id=${upstreamTaskId}）`
      );
    }
    if (isApimartDone(status)) {
      // 多形态抽图片 URL（官方 data.result.images[].url[] / 新版 result.images / data[].url / output[] 等）
      const found = extractApimartImageUrls(pollJson);
      if (found.length === 0) {
        throw new StageError(
          'parse',
          `apimart 报告完成但没有图片 URL：${JSON.stringify(pollJson).slice(0, 200)}`
        );
      }
      urls.push(...found);
      break;
    }
    // pending / submitted / processing / running：上游没暴露 progress，按"模拟值"推一下让 UI 不静默
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
    // {{lora}} 由 imageParamsStore 注入：选了 LoRA 时拼成 <lora:name:weight> 串放 params.lora（见 imageParamsStore.buildParams）
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
