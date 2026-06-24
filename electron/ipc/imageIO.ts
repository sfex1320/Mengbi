/**
 * 资产库「图片」导出 / 导入（api:image-io:*）。
 *
 * 与 configIO（加密单文件、只装配置不装图片）分开：图片是大体积二进制，
 * 走「文件夹 + 清单」方案——导出复制图片文件到用户选的文件夹并写 mengbi-images.json，
 * 导入读清单把图片复制进存储根目录 + INSERT 进 images 表。不加密、不压成单文件，
 * 避免把 GB 级图片塞进 gzip+base64 撑爆内存。
 *
 * 图片导入恒为「追加（merge）」：按 created_at + 提示词 + 文件名 轻量去重，不提供「覆盖」
 * （覆盖会删除用户整库图片与磁盘文件，风险过高）。
 */
import { z } from 'zod';
import fs from 'node:fs/promises';
import path from 'node:path';
import { register, ok, err } from './helpers';
import { getDb } from '../services/db';
import { getStorageRoot } from '../services/imageStore';
import { ensureThumbnail, thumbPathFor } from '../services/thumbnail';
import { broadcastGalleryChanged } from '../services/producedMedia';
import { makeError } from '@shared/error';
import { logger } from '../services/logger';

const MANIFEST_NAME = 'mengbi-images.json';
const MANIFEST_FORMAT = 'mengbi-images-v1';

interface ManifestItem {
  file: string; // images/ 下的相对文件名
  thumb: string | null; // images/.thumbs/ 下的相对文件名
  prompt_positive: string | null;
  prompt_negative: string | null;
  model_used: string | null;
  params_json: string | null;
  tags: string | null;
  rating: number;
  notes: string | null;
  album_ids: string | null;
  created_at: string;
}

interface ImageRow {
  id: number;
  file_path: string;
  thumbnail_path: string | null;
  prompt_positive: string | null;
  prompt_negative: string | null;
  model_used: string | null;
  params_json: string | null;
  tags: string | null;
  rating: number;
  notes: string | null;
  album_ids: string | null;
  created_at: string;
}

function sanitizeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '_');
}

export function registerImageIOHandlers(): void {
  // —— 导出图片到文件夹 ——
  register('api:image-io:export', z.object({ dir: z.string().min(1) }), async (input) => {
    try {
      const db = getDb();
      const rows = db
        .prepare(
          `SELECT id, file_path, thumbnail_path, prompt_positive, prompt_negative,
                  model_used, params_json, tags, rating, notes, album_ids, created_at
             FROM images WHERE deleted_at IS NULL ORDER BY id ASC`
        )
        .all() as ImageRow[];

      const imagesDir = path.join(input.dir, 'images');
      const thumbsDir = path.join(imagesDir, '.thumbs');
      await fs.mkdir(thumbsDir, { recursive: true });

      const items: ManifestItem[] = [];
      let copied = 0;
      let missing = 0;
      for (const r of rows) {
        try {
          await fs.access(r.file_path);
        } catch {
          missing++;
          continue; // 源文件已不在磁盘，跳过
        }
        const base = sanitizeName(`${r.id}__${path.basename(r.file_path)}`);
        try {
          await fs.copyFile(r.file_path, path.join(imagesDir, base));
        } catch (e) {
          logger.warn(`[imageIO] copy failed ${r.file_path}: ${(e as Error).message}`);
          missing++;
          continue;
        }
        let thumbRel: string | null = null;
        if (r.thumbnail_path) {
          try {
            const tb = sanitizeName(`${r.id}__${path.basename(r.thumbnail_path)}`);
            await fs.copyFile(r.thumbnail_path, path.join(thumbsDir, tb));
            thumbRel = tb;
          } catch {
            thumbRel = null; // 缩略图缺失不致命，导入时重建
          }
        }
        items.push({
          file: base,
          thumb: thumbRel,
          prompt_positive: r.prompt_positive,
          prompt_negative: r.prompt_negative,
          model_used: r.model_used,
          params_json: r.params_json,
          tags: r.tags,
          rating: r.rating ?? 0,
          notes: r.notes,
          album_ids: r.album_ids,
          created_at: r.created_at
        });
        copied++;
      }

      const manifest = {
        format: MANIFEST_FORMAT,
        exportedAt: new Date().toISOString(),
        count: items.length,
        items
      };
      await fs.writeFile(
        path.join(input.dir, MANIFEST_NAME),
        JSON.stringify(manifest),
        'utf-8'
      );
      return ok({ copied, missing, dir: input.dir });
    } catch (e) {
      logger.error('image export failed', e);
      return err(
        makeError('UNKNOWN', `图片导出失败：${(e as Error).message}`, { severity: 'modal' })
      );
    }
  });

  // —— 扫描待导入文件夹（读清单，报数量，不写库）——
  register('api:image-io:scan', z.object({ dir: z.string().min(1) }), async (input) => {
    try {
      const raw = await fs.readFile(path.join(input.dir, MANIFEST_NAME), 'utf-8');
      const m = JSON.parse(raw) as { format?: string; exportedAt?: string; items?: unknown[] };
      if (m.format !== MANIFEST_FORMAT) {
        return err(
          makeError('VALIDATION_FAILED', `该文件夹不是梦笔图片导出（缺少 ${MANIFEST_NAME}）`, {
            severity: 'modal'
          })
        );
      }
      return ok({ count: Array.isArray(m.items) ? m.items.length : 0, exportedAt: m.exportedAt ?? '' });
    } catch (e) {
      return err(
        makeError(
          'FILE_NOT_FOUND',
          `读取失败：所选文件夹里没有 ${MANIFEST_NAME}（请选「导出图片」生成的文件夹）`,
          { severity: 'modal' }
        )
      );
    }
  });

  // —— 从文件夹导入图片（恒追加，按 created_at+提示词+文件名 去重）——
  register('api:image-io:import', z.object({ dir: z.string().min(1) }), async (input) => {
    try {
      const raw = await fs.readFile(path.join(input.dir, MANIFEST_NAME), 'utf-8');
      const manifest = JSON.parse(raw) as { format?: string; items?: ManifestItem[] };
      if (manifest.format !== MANIFEST_FORMAT || !Array.isArray(manifest.items)) {
        return err(
          makeError('VALIDATION_FAILED', `不是合法的梦笔图片导出文件夹`, { severity: 'modal' })
        );
      }

      const db = getDb();
      const root = getStorageRoot();
      const destDir = path.join(root, `imported-${new Date().toISOString().slice(0, 10)}`);
      await fs.mkdir(path.join(destDir, '.thumbs'), { recursive: true });

      const findDup = db.prepare(
        `SELECT id FROM images
          WHERE created_at = ? AND IFNULL(prompt_positive,'') = ? AND file_path LIKE ?
          AND deleted_at IS NULL LIMIT 1`
      );
      const insert = db.prepare(
        `INSERT INTO images(
           task_id, file_path, thumbnail_path, prompt_positive, prompt_negative,
           model_used, params_json, tags, rating, notes, album_ids, created_at
         ) VALUES(NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      let imported = 0;
      let skipped = 0;
      for (const it of manifest.items) {
        const srcFile = path.join(input.dir, 'images', it.file);
        try {
          await fs.access(srcFile);
        } catch {
          skipped++;
          continue;
        }
        // 去重：同 created_at + 同提示词 + 同原文件名（剥掉 id__ 前缀）
        const origBase = it.file.replace(/^\d+__/, '');
        const dup = findDup.get(
          it.created_at,
          it.prompt_positive ?? '',
          `%${origBase}`
        ) as { id: number } | undefined;
        if (dup) {
          skipped++;
          continue;
        }
        // 落盘（重名 -2/-3 兜底）
        const ext = path.extname(origBase);
        const stem = origBase.slice(0, origBase.length - ext.length);
        let destPath = path.join(destDir, sanitizeName(origBase));
        for (let i = 2; i < 1000; i++) {
          try {
            await fs.access(destPath);
            destPath = path.join(destDir, sanitizeName(`${stem}-${i}${ext}`));
          } catch {
            break;
          }
        }
        try {
          await fs.copyFile(srcFile, destPath);
        } catch (e) {
          logger.warn(`[imageIO] import copy failed ${srcFile}: ${(e as Error).message}`);
          skipped++;
          continue;
        }

        // 缩略图放到 destPath 旁的规范位置（.thumbs/{base}.webp），渲染端按此解析。
        let thumbPath: string | null = null;
        const canonThumb = thumbPathFor(destPath);
        if (it.thumb) {
          const srcThumb = path.join(input.dir, 'images', '.thumbs', it.thumb);
          try {
            await fs.copyFile(srcThumb, canonThumb);
            thumbPath = canonThumb;
          } catch {
            thumbPath = null;
          }
        }
        if (!thumbPath) {
          // 没有导出的缩略图就重建（best-effort，失败回退原图渲染）
          thumbPath = await ensureThumbnail(destPath).catch(() => null);
        }

        insert.run(
          destPath,
          thumbPath,
          it.prompt_positive ?? '',
          it.prompt_negative ?? null,
          it.model_used ?? null,
          it.params_json ?? null,
          it.tags ?? null,
          Number(it.rating ?? 0),
          it.notes ?? null,
          it.album_ids ?? null,
          it.created_at ?? new Date().toISOString()
        );
        imported++;
      }

      if (imported > 0) broadcastGalleryChanged();
      return ok({ imported, skipped });
    } catch (e) {
      logger.error('image import failed', e);
      return err(
        makeError('UNKNOWN', `图片导入失败：${(e as Error).message}`, { severity: 'modal' })
      );
    }
  });
}
