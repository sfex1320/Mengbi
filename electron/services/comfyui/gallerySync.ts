/**
 * 把 ComfyUI 输出图同步进资产库（images 表）。自动同步（每次出图）与手动「加入资产库」共用。
 * 按 file_path 去重——同一文件不会重复入库（自动同步过后手动再点也不会产生重复）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../db';
import { ensureThumbnail } from '../thumbnail';
import { logger } from '../logger';
import type { OutputFile } from '@shared/comfyui';

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);

export interface GallerySyncOpts {
  prompt?: string | null;
  paramsJson?: string | null;
  notes?: string;
  /** 资产库分组名（文件夹）；null=不分组（首页散图）。只写 group_name 列，不物理移动文件。 */
  groupName?: string | null;
}

/** 把若干输出文件里的图片插入 images 表，返回新增条数。 */
export async function addImagesToGallery(
  files: OutputFile[] | null | undefined,
  opts: GallerySyncOpts = {}
): Promise<number> {
  if (!files || files.length === 0) return 0;
  const now = new Date().toISOString();
  let added = 0;
  for (const o of files) {
    if (!o.path || !fs.existsSync(o.path)) continue;
    const ext = path.extname(o.path).slice(1).toLowerCase();
    if (!IMAGE_EXT.has(ext)) continue;
    try {
      const dup = getDb()
        .prepare(`SELECT COUNT(*) AS cnt FROM images WHERE file_path = ?`)
        .get(o.path) as { cnt: number } | undefined;
      if (dup && dup.cnt > 0) continue;
      let thumb: string | null = null;
      try {
        thumb = await ensureThumbnail(o.path);
      } catch {
        /* 缩略图失败不阻塞入库 */
      }
      getDb()
        .prepare(
          `INSERT INTO images(task_id, file_path, thumbnail_path, prompt_positive, prompt_negative, model_used, params_json, notes, group_name, created_at)
           VALUES(NULL, ?, ?, ?, NULL, 'comfyui', ?, ?, ?, ?)`
        )
        .run(
          o.path,
          thumb,
          opts.prompt ?? null,
          opts.paramsJson ?? null,
          opts.notes ?? 'ComfyUI 工作流输出',
          opts.groupName ?? null,
          now
        );
      added++;
    } catch (e) {
      logger.warn(`[comfyui] addImagesToGallery failed for ${o.path}: ${(e as Error).message}`);
    }
  }
  return added;
}
