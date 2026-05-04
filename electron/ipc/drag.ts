import { ipcMain, nativeImage } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { logger } from '../services/logger';

/**
 * OS 文件拖拽：把渲染层"对话气泡里的图片"（dataUri 或本地路径）变成一次原生 drag。
 *
 * 关键点：
 *   - 必须在 ipcMain.on（而不是 handle）里同步调用 webContents.startDrag，
 *     否则浏览器侧的 dragstart 已经取消，OS 拖拽就起不来。
 *   - dataUri 我们提前/同步落到 OS 临时目录（重复拖同一张走 SHA1 缓存）。
 */

const TEMP_DIR = path.join(os.tmpdir(), 'mengbi-drag');
fs.mkdirSync(TEMP_DIR, { recursive: true });

const dataUriCache = new Map<string, string>(); // sha1 → tempPath

function dataUriToTempPath(dataUri: string, suggestedName?: string): string | null {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUri);
  if (!m) return null;
  const mime = m[1];
  const b64 = m[2];
  const sha1 = crypto.createHash('sha1').update(b64).digest('hex').slice(0, 16);
  const cached = dataUriCache.get(sha1);
  if (cached && fs.existsSync(cached)) return cached;
  const ext =
    mime === 'image/png'
      ? '.png'
      : mime === 'image/jpeg'
        ? '.jpg'
        : mime === 'image/webp'
          ? '.webp'
          : mime === 'image/gif'
            ? '.gif'
            : '.bin';
  const safeName = (suggestedName ?? `mengbi-${sha1}`).replace(/[<>:"/\\|?*]/g, '_');
  const filename = safeName.endsWith(ext) ? safeName : `${safeName}${ext}`;
  const filepath = path.join(TEMP_DIR, filename);
  fs.writeFileSync(filepath, Buffer.from(b64, 'base64'));
  dataUriCache.set(sha1, filepath);
  return filepath;
}

/** 16x16 的占位 icon（防止某些平台 startDrag 没 icon 报错） */
function placeholderIcon(): Electron.NativeImage {
  // 1×1 透明 PNG
  const png = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082',
    'hex'
  );
  return nativeImage.createFromBuffer(png);
}

export function registerDragHandlers(): void {
  ipcMain.on('api:drag:start-from-data-uri', (event, payload: unknown) => {
    try {
      const { dataUri, suggestedName } = (payload ?? {}) as {
        dataUri?: string;
        suggestedName?: string;
      };
      if (!dataUri) return;
      const filepath = dataUriToTempPath(dataUri, suggestedName);
      if (!filepath) return;
      event.sender.startDrag({
        file: filepath,
        icon: placeholderIcon()
      });
    } catch (e) {
      logger.warn('drag.start-from-data-uri failed', e);
    }
  });

  ipcMain.on('api:drag:start-from-path', (event, payload: unknown) => {
    try {
      const { filePath } = (payload ?? {}) as { filePath?: string };
      if (!filePath || !fs.existsSync(filePath)) return;
      event.sender.startDrag({
        file: filePath,
        icon: placeholderIcon()
      });
    } catch (e) {
      logger.warn('drag.start-from-path failed', e);
    }
  });
}
