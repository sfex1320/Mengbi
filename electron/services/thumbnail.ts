/**
 * 图库缩略图生成 / 路径解析。
 *
 * 设计：
 *   原图：    {root}/{date:YYYY-MM-DD}/{base}.{ext}
 *   缩略图：  {root}/{date:YYYY-MM-DD}/.thumbs/{base}.webp
 *
 * - 基础名相同（taskId-seq / hypir-xxx / upscale-yyy 都按原图基础名走）
 * - 缩略图统一 WebP（最长边 512px，质量 80，progressive）
 * - 缩略图体积通常 ~5-40KB，60 张图加载从 ~300MB 降到 ~3MB
 * - `.thumbs/` 用 dot 开头：Mac Finder / Linux 文件管理器默认隐藏，不打扰用户
 *
 * 失败安全：任何一步抛错都返回 null —— 调用方自动回退到原图渲染。
 *
 * 并发：lazy 模式下被 gallery list 触发的批量补缩略图，
 *      用单飞 + 容量 4 的 worker pool 控制（见 enqueueBackfill）。
 */
import { existsSync, statSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { logger } from './logger';

/** 缩略图最长边像素 */
const THUMB_MAX_EDGE = 512;
/** WebP 编码质量（0-100） */
const THUMB_QUALITY = 80;
/** 后端补缩略图的并发上限 */
const BACKFILL_CONCURRENCY = 4;

/**
 * 根据原图路径推出缩略图绝对路径（不检查文件是否存在）。
 * 例：
 *   F:/imgs/2026-05-25/123-01.png
 *   → F:/imgs/2026-05-25/.thumbs/123-01.webp
 */
export function thumbPathFor(originalPath: string): string {
  const dir = path.dirname(originalPath);
  const base = path.basename(originalPath, path.extname(originalPath));
  return path.join(dir, '.thumbs', `${base}.webp`);
}

/**
 * 生成单张缩略图。已存在且比原图新就跳过。返回最终缩略图绝对路径，
 * 失败返回 null（调用方应回退到原图）。
 */
export async function generateThumbnail(originalPath: string): Promise<string | null> {
  try {
    if (!existsSync(originalPath)) return null;
    const out = thumbPathFor(originalPath);

    // 已存在且比原图新 → 复用
    if (existsSync(out)) {
      const so = statSync(out);
      const si = statSync(originalPath);
      if (so.mtimeMs >= si.mtimeMs) return out;
    }

    await fs.mkdir(path.dirname(out), { recursive: true });

    await sharp(originalPath, { failOn: 'none' })
      .rotate() // 应用 EXIF 旋转
      .resize({
        width: THUMB_MAX_EDGE,
        height: THUMB_MAX_EDGE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: THUMB_QUALITY, effort: 4 })
      .toFile(out);

    return out;
  } catch (e) {
    logger.warn(`[thumb] generate failed for ${originalPath}: ${(e as Error).message}`);
    return null;
  }
}

/**
 * 同步缩略图（封面用）—— 如果不存在就同步等它生成完。
 * 一般只在"用户刚落盘一张新图，马上要立刻显示"时用。
 */
export async function ensureThumbnail(originalPath: string): Promise<string | null> {
  const out = thumbPathFor(originalPath);
  if (existsSync(out)) return out;
  return generateThumbnail(originalPath);
}

// ── lazy backfill：图库 list 时发现 thumbnail_path 缺失就排队补 ──

type BackfillJob = {
  imageId: number;
  originalPath: string;
  onDone: (thumbPath: string | null) => void;
};

const queue: BackfillJob[] = [];
let activeWorkers = 0;

/**
 * 把"需要补缩略图"的图入队，回调拿到 (thumbPath | null)。
 * 同一张图同时入队多次也只会处理一次（基于 originalPath 去重）。
 */
export function enqueueBackfill(job: BackfillJob): void {
  // 去重
  if (queue.some((q) => q.originalPath === job.originalPath)) return;
  queue.push(job);
  pumpQueue();
}

function pumpQueue(): void {
  while (activeWorkers < BACKFILL_CONCURRENCY && queue.length > 0) {
    const job = queue.shift()!;
    activeWorkers++;
    void generateThumbnail(job.originalPath)
      .then((thumbPath) => {
        try {
          job.onDone(thumbPath);
        } catch (e) {
          logger.warn(`[thumb] onDone callback threw: ${(e as Error).message}`);
        }
      })
      .finally(() => {
        activeWorkers--;
        pumpQueue();
      });
  }
}

/** 队列长度（DevTools / status 接口可用） */
export function getBackfillQueueDepth(): { pending: number; active: number } {
  return { pending: queue.length, active: activeWorkers };
}
