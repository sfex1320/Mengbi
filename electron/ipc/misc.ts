import { z } from 'zod';
import { dialog, BrowserWindow, shell } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { register, ok, err } from './helpers';
import { ThemeSaveSchema } from './schemas';
import { getDb } from '../services/db';
import { makeError } from '@shared/error';

const IMG_EXT_TO_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
};

export function registerMiscHandlers(): void {
  register('api:storage:select', null, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || result.filePaths.length === 0) return ok(null);
    return ok({ path: result.filePaths[0] });
  });

  // 选参考图：多选 image，返回路径 + data URI（用于前端回显缩略图）
  register('api:storage:pick-images', null, async (_input, event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = win
      ? await dialog.showOpenDialog(win, {
          properties: ['openFile', 'multiSelections'],
          filters: [
            { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }
          ]
        })
      : await dialog.showOpenDialog({
          properties: ['openFile', 'multiSelections'],
          filters: [
            { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }
          ]
        });
    if (result.canceled || result.filePaths.length === 0) {
      return ok({ files: [] as Array<{ path: string; dataUri: string }> });
    }
    const out: Array<{ path: string; dataUri: string }> = [];
    for (const p of result.filePaths) {
      try {
        const buf = await fs.readFile(p);
        const mime = IMG_EXT_TO_MIME[path.extname(p).toLowerCase()] ?? 'application/octet-stream';
        out.push({ path: p, dataUri: `data:${mime};base64,${buf.toString('base64')}` });
      } catch (e) {
        // 跳过读取失败的单张
      }
    }
    return ok({ files: out });
  });

  register('api:theme:list', null, async () => {
    const rows = getDb().prepare(`SELECT * FROM themes ORDER BY id`).all();
    return ok(rows);
  });

  register('api:theme:save', ThemeSaveSchema, async (input) => {
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO themes(name, atmosphere, palette, overrides, is_builtin, created_at)
         VALUES(?, ?, ?, NULL, 0, ?)`
      )
      .run(input.name, input.atmosphere, input.palette, now);
    return ok({ saved: true });
  });

  register(
    'api:export:card',
    z.object({ imageId: z.number().int(), outputPath: z.string().optional() }),
    async () => err(makeError('NOT_IMPLEMENTED', 'export.card 将在 Phase 6 实现', { severity: 'toast' }))
  );

  // 在系统文件管理器中显示文件
  register('api:storage:show-in-folder', z.string().min(1), async (filePath) => {
    try {
      shell.showItemInFolder(filePath);
      return ok(true as const);
    } catch (e) {
      return err(
        makeError('FILE_NOT_FOUND', `打开失败：${(e as Error).message}`, {
          severity: 'toast'
        })
      );
    }
  });

  // Window controls
  register('api:window:minimize', null, async (_input, event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
    return ok(true as const);
  });
  register('api:window:maximize-toggle', null, async (_input, event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return ok({ maximized: false });
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return ok({ maximized: win.isMaximized() });
  });
  register('api:window:close', null, async (_input, event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
    return ok(true as const);
  });
  register('api:window:state', null, async (_input, event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return ok({ maximized: win?.isMaximized() ?? false });
  });
}

void ok;
