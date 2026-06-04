/**
 * 工具箱通用 IPC（矢量化 + 文件落盘 + 入库）。
 *
 * Note：放大引擎已独立到 electron/ipc/upscale.ts（Real-ESRGAN ncnn Vulkan）
 *       与 electron/ipc/hypir.ts（HYPIR 占位），本文件不再涉及任何 ONNX 推理逻辑。
 */

import { z } from 'zod';
import { app } from 'electron';
import fs from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { register, ok, err } from './helpers';
import { getDb } from '../services/db';
import { logger } from '../services/logger';
import { makeError } from '@shared/error';
import { ensureThumbnail } from '../services/thumbnail';

// ─── 路径与设置 ─────────────────────────────────────────────

function getStorageRootForTools(): string {
  const tools = getDb()
    .prepare(`SELECT value FROM settings WHERE key='tools_storage_path'`)
    .get() as { value: string } | undefined;
  if (tools?.value && tools.value.trim()) return tools.value;
  const img = getDb()
    .prepare(`SELECT value FROM settings WHERE key='image_storage_path'`)
    .get() as { value: string } | undefined;
  if (img?.value) return img.value;
  return path.join(app.getPath('userData'), 'images');
}

// ─── 工具：dataUri → Buffer ─────────────────────────────────

function dataUriToBuffer(dataUri: string): { buf: Buffer; mime: string } | null {
  const m = dataUri.match(/^data:([^;]+);base64,(.*)$/);
  if (!m) return null;
  return { mime: m[1], buf: Buffer.from(m[2], 'base64') };
}

const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg'
};

// ─── handlers ──────────────────────────────────────────────

export function registerToolsHandlers(): void {
  // 图像转矢量功能已整体移除待重做；本文件只保留通用的"保存产出 / 入库"通道。
  // 'vectorize' 仍保留在 kind 枚举里，用于过去入过库的历史图片回溯（向后兼容）。

  // 把工具产出的图（PNG / SVG）保存到工具箱配置的存储根
  register(
    'api:tools:save-output',
    z.object({
      dataUri: z.string().min(10),
      kind: z.enum(['upscale', 'vectorize']),
      suggestedName: z.string().optional()
    }),
    async (input) => {
      const decoded = dataUriToBuffer(input.dataUri);
      if (!decoded) {
        return err(makeError('VALIDATION_FAILED', '输入不是合法 dataUri', { severity: 'toast' }));
      }
      const ext = MIME_TO_EXT[decoded.mime] ?? 'png';
      const root = getStorageRootForTools();
      const date = new Date().toISOString().slice(0, 10);
      const dir = path.join(root, date);
      try {
        await fs.mkdir(dir, { recursive: true });
      } catch (e) {
        return err(
          makeError('FILE_PERMISSION', `无法创建目录 ${dir}：${(e as Error).message}`, {
            severity: 'toast'
          })
        );
      }
      const safeName = (input.suggestedName ?? input.kind)
        .replace(/[^\w一-龥-]/g, '_')
        .slice(0, 60);
      let final = path.join(dir, `${safeName}-${Date.now()}.${ext}`);
      let n = 2;
      while (existsSync(final)) {
        final = path.join(dir, `${safeName}-${Date.now()}-${n++}.${ext}`);
        if (n > 99) break;
      }
      try {
        await fs.writeFile(final, decoded.buf);
        return ok({ filePath: final });
      } catch (e) {
        return err(
          makeError('FILE_PERMISSION', `写入失败：${(e as Error).message}`, { severity: 'toast' })
        );
      }
    }
  );

  // 把工具产出导入图库——落盘 + INSERT INTO images
  register(
    'api:gallery:import-from-buffer',
    z.object({
      dataUri: z.string().min(10),
      kind: z.enum(['upscale', 'vectorize', 'imported']),
      sourceModel: z.string().optional(),
      params: z.record(z.string(), z.unknown()).optional(),
      notes: z.string().optional()
    }),
    async (input) => {
      const decoded = dataUriToBuffer(input.dataUri);
      if (!decoded) {
        return err(makeError('VALIDATION_FAILED', '输入不是合法 dataUri', { severity: 'toast' }));
      }
      const ext = MIME_TO_EXT[decoded.mime] ?? 'png';
      const root = getStorageRootForTools();
      const date = new Date().toISOString().slice(0, 10);
      const dir = path.join(root, date);
      try {
        mkdirSync(dir, { recursive: true });
      } catch (e) {
        return err(
          makeError('FILE_PERMISSION', `无法创建目录：${(e as Error).message}`, {
            severity: 'toast'
          })
        );
      }
      const ts = Date.now();
      const final = path.join(dir, `${input.kind}-${ts}.${ext}`);
      try {
        await fs.writeFile(final, decoded.buf);
      } catch (e) {
        return err(
          makeError('FILE_PERMISSION', `写入失败：${(e as Error).message}`, { severity: 'toast' })
        );
      }
      // 同步生成缩略图（SVG 跳过；sharp 不解 SVG 矢量图）
      let thumbPath: string | null = null;
      if (decoded.mime !== 'image/svg+xml') {
        try {
          thumbPath = await ensureThumbnail(final);
        } catch (e) {
          logger.warn(`[tools] thumb failed for ${final}: ${(e as Error).message}`);
        }
      }
      try {
        const result = getDb()
          .prepare(
            `INSERT INTO images(task_id, file_path, thumbnail_path, prompt_positive, prompt_negative, model_used, params_json, notes, created_at)
             VALUES(NULL, ?, ?, ?, NULL, ?, ?, ?, ?)`
          )
          .run(
            final,
            thumbPath,
            input.notes ?? `[${input.kind}] 工具箱导入`,
            input.sourceModel ?? input.kind,
            input.params ? JSON.stringify(input.params) : null,
            input.notes ?? null,
            new Date().toISOString()
          );
        return ok({ id: Number(result.lastInsertRowid), filePath: final });
      } catch (e) {
        return err(
          makeError('DB_ERROR', `落库失败：${(e as Error).message}`, { severity: 'toast' })
        );
      }
    }
  );
}
