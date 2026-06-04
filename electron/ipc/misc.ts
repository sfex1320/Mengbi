import { z } from 'zod';
import { app, dialog, BrowserWindow, shell } from 'electron';
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

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif'
};

export function registerMiscHandlers(): void {
  register('api:storage:select', null, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || result.filePaths.length === 0) return ok(null);
    return ok({ path: result.filePaths[0] });
  });

  // 通用单文件选择器（GGUF / 任意文件）。前端可传 filters 限制扩展名。
  register(
    'api:storage:pick-file',
    z
      .object({
        filters: z
          .array(z.object({ name: z.string(), extensions: z.array(z.string()) }))
          .optional(),
        title: z.string().optional()
      })
      .optional(),
    async (input, event) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      const opts = {
        properties: ['openFile' as const],
        filters: input?.filters ?? [],
        title: input?.title ?? '选择文件'
      };
      const result = win
        ? await dialog.showOpenDialog(win, opts)
        : await dialog.showOpenDialog(opts);
      const out: { filePath: string | null } =
        result.canceled || result.filePaths.length === 0
          ? { filePath: null }
          : { filePath: result.filePaths[0] };
      return ok(out);
    }
  );

  // 通用多文件选择器（与 pick-file 同 filter 入参，但 properties 加 multiSelections）
  register(
    'api:storage:pick-files',
    z
      .object({
        filters: z
          .array(z.object({ name: z.string(), extensions: z.array(z.string()) }))
          .optional(),
        title: z.string().optional()
      })
      .optional(),
    async (input, event) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      const opts = {
        properties: ['openFile' as const, 'multiSelections' as const],
        filters: input?.filters ?? [],
        title: input?.title ?? '选择文件'
      };
      const result = win
        ? await dialog.showOpenDialog(win, opts)
        : await dialog.showOpenDialog(opts);
      const out: { filePaths: string[] } =
        result.canceled || result.filePaths.length === 0
          ? { filePaths: [] }
          : { filePaths: result.filePaths };
      return ok(out);
    }
  );

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

  // 把 dataUri 写到 userData/temp-refs/，返回真实磁盘路径。
  // 用于画板导出 → 生图页参考图：避免伪路径让 /v1/images/edits 那边 fs.readFile 失败。
  register(
    'api:storage:save-temp-image',
    z.object({ dataUri: z.string().min(10), suggestedName: z.string().optional() }),
    async (input) => {
      const m = input.dataUri.match(/^data:(image\/[\w+.-]+);base64,(.*)$/);
      if (!m) {
        return err(
          makeError('VALIDATION_FAILED', '不是合法 image dataUri', { severity: 'toast' })
        );
      }
      const mime = m[1];
      const ext = MIME_TO_EXT[mime] ?? 'png';
      try {
        const dir = path.join(app.getPath('userData'), 'temp-refs');
        await fs.mkdir(dir, { recursive: true });
        const safeName = (input.suggestedName ?? 'canvas').replace(/[^\w一-龥-]/g, '_').slice(0, 40);
        const filePath = path.join(dir, `${safeName}-${Date.now()}.${ext}`);
        await fs.writeFile(filePath, Buffer.from(m[2], 'base64'));
        return ok({ filePath });
      } catch (e) {
        return err(
          makeError('FILE_PERMISSION', `写入临时文件失败：${(e as Error).message}`, {
            severity: 'toast'
          })
        );
      }
    }
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

  // 直接打开一个目录（或文件）—— shell.openPath，与 showItemInFolder 行为不同。
  // ensureDir=true 时，目录不存在会先 mkdir -p 再打开，避免"模型还没装时按钮失效"。
  register(
    'api:storage:open-path',
    z.object({ targetPath: z.string().min(1), ensureDir: z.boolean().optional() }),
    async (input) => {
      try {
        if (input.ensureDir) {
          await fs.mkdir(input.targetPath, { recursive: true });
        }
        const errMsg = await shell.openPath(input.targetPath);
        if (errMsg) {
          return err(makeError('FILE_NOT_FOUND', `打开失败：${errMsg}`, { severity: 'toast' }));
        }
        return ok(true as const);
      } catch (e) {
        return err(
          makeError('FILE_NOT_FOUND', `打开失败：${(e as Error).message}`, { severity: 'toast' })
        );
      }
    }
  );

  // 弹「另存为」对话框，把 dataUri 字节写到用户选择的路径。
  // 工具箱（高清放大 / 矢量化）的右键菜单"另存为"用这条。
  register(
    'api:storage:save-as',
    z.object({
      dataUri: z.string().min(10),
      defaultName: z.string().min(1).max(120),
      filters: z
        .array(
          z.object({
            name: z.string(),
            extensions: z.array(z.string())
          })
        )
        .optional()
    }),
    async (input, event) => {
      const m = input.dataUri.match(/^data:([^;]+);base64,(.*)$/);
      if (!m) {
        return err(
          makeError('VALIDATION_FAILED', '不是合法的 dataUri', { severity: 'toast' })
        );
      }
      const win = BrowserWindow.fromWebContents(event.sender);
      const opts: Electron.SaveDialogOptions = {
        defaultPath: input.defaultName,
        filters: input.filters
      };
      const result = win
        ? await dialog.showSaveDialog(win, opts)
        : await dialog.showSaveDialog(opts);
      if (result.canceled || !result.filePath) return ok(null);
      try {
        await fs.writeFile(result.filePath, Buffer.from(m[2], 'base64'));
        return ok({ filePath: result.filePath });
      } catch (e) {
        return err(
          makeError('FILE_PERMISSION', `写入失败：${(e as Error).message}`, {
            severity: 'toast'
          })
        );
      }
    }
  );

  // 扫描用户设置的 LoRA 目录，递归找 .safetensors / .pt / .ckpt 文件
  // 返回 [{ path, name, sizeBytes }]，name 是去掉后缀的文件名
  register('api:storage:scan-loras', null, async () => {
    const folder = (
      getDb()
        .prepare(`SELECT value FROM settings WHERE key='lora_folder_path'`)
        .get() as { value: string } | undefined
    )?.value;
    if (!folder || !folder.trim()) return ok([] as Array<{ name: string; path: string; sizeBytes: number }>);
    const results: Array<{ name: string; path: string; sizeBytes: number }> = [];
    async function walk(dir: string, depth: number): Promise<void> {
      if (depth > 4) return; // 防止过深嵌套
      let items: import('node:fs').Dirent[] = [];
      try {
        items = (await fs.readdir(dir, { withFileTypes: true })) as unknown as import('node:fs').Dirent[];
      } catch {
        return;
      }
      for (const it of items) {
        const fp = path.join(dir, it.name);
        if (it.isDirectory()) {
          await walk(fp, depth + 1);
        } else if (it.isFile()) {
          const ext = path.extname(it.name).toLowerCase();
          if (ext === '.safetensors' || ext === '.pt' || ext === '.ckpt') {
            try {
              const st = await fs.stat(fp);
              results.push({
                name: it.name.replace(/\.(safetensors|pt|ckpt)$/i, ''),
                path: fp,
                sizeBytes: st.size
              });
            } catch {
              /* skip */
            }
          }
        }
      }
    }
    try {
      await walk(folder, 0);
    } catch (e) {
      return err(
        makeError('FILE_NOT_FOUND', `LoRA 目录扫描失败：${(e as Error).message}`, {
          severity: 'toast'
        })
      );
    }
    results.sort((a, b) => a.name.localeCompare(b.name));
    return ok(results);
  });

  // 在系统默认浏览器中打开 URL（参考来源卡片 / 模型下载页 用）
  register('api:storage:open-url', z.string().url(), async (url) => {
    try {
      await shell.openExternal(url);
      return ok(true as const);
    } catch (e) {
      return err(
        makeError('UNKNOWN', `打开链接失败：${(e as Error).message}`, {
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
