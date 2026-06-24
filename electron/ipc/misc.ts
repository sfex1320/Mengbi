import { z } from 'zod';
import { app, dialog, BrowserWindow, shell } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { register, ok, err } from './helpers';
import { ThemeSaveSchema } from './schemas';
import { getDb } from '../services/db';
import { chromiumFetch } from '../services/httpClient';
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

  // 列出文件夹中的图片文件（文件夹批量处理：folder-input 节点扫描用）。
  // 只读、不回传图片字节（批量场景 N 张大图 dataURI 跨 IPC 会爆内存）；扩展名白名单同 IMG_EXT_TO_MIME。
  // 2026-06-12 扩展：可选 kinds 含 'video' 时一并列出视频文件（folder-input 节点作视频来源；additive 字段零新 IPC）。
  register(
    'api:storage:list-images',
    z.object({ dir: z.string().min(1), kinds: z.array(z.enum(['image', 'video'])).optional() }),
    async (input) => {
      const kinds = input.kinds ?? ['image'];
      const VIDEO_EXTS = new Set(['.mp4', '.mov', '.webm', '.mkv', '.m4v', '.avi']);
      try {
        const items = await fs.readdir(input.dir, { withFileTypes: true });
        const files: Array<{ path: string; name: string; size: number; mtime: number; kind: 'image' | 'video' }> = [];
        for (const it of items) {
          if (!it.isFile()) continue;
          const ext = path.extname(it.name).toLowerCase();
          const kind: 'image' | 'video' | null =
            ext in IMG_EXT_TO_MIME ? 'image' : VIDEO_EXTS.has(ext) ? 'video' : null;
          if (!kind || !kinds.includes(kind)) continue;
          const fp = path.join(input.dir, it.name);
          try {
            const st = await fs.stat(fp);
            files.push({ path: fp, name: it.name, size: st.size, mtime: st.mtimeMs, kind });
          } catch {
            /* skip */
          }
        }
        // 文件名自然序（img2 < img10）
        files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        return ok({ files });
      } catch (e) {
        return err(
          makeError('FILE_NOT_FOUND', `读取文件夹失败：${(e as Error).message}`, {
            severity: 'toast',
            hint: '检查文件夹是否存在、是否有读取权限'
          })
        );
      }
    }
  );

  // 批量把图片复制/写入到目标文件夹（文件夹批量处理：folder-output 节点落盘用）。
  // src 支持 本地路径（fs.copyFile 零转码）或 data: URI（解码写入）；目标重名自动 -2/-3 兜底。
  register(
    'api:storage:copy-into',
    z.object({
      targetDir: z.string().min(1),
      items: z.array(z.object({ src: z.string().min(1), destName: z.string().min(1).max(200) })).min(1).max(500),
      // true=同名直接覆盖（提示词商城「覆盖已有缩略图」重生成用）；缺省 false=重名自动 -2/-3
      overwrite: z.boolean().optional()
    }),
    async (input) => {
      const saved: Array<{ src: string; dest: string }> = [];
      const failed: Array<{ src: string; error: string }> = [];
      try {
        await fs.mkdir(input.targetDir, { recursive: true });
      } catch (e) {
        return err(
          makeError('FILE_PERMISSION', `输出文件夹不可用：${(e as Error).message}`, {
            severity: 'toast',
            hint: '检查输出文件夹路径与写入权限'
          })
        );
      }
      for (const it of input.items) {
        try {
          const safeName = it.destName.replace(/[\\/:*?"<>|]/g, '_');
          // 重名兜底：name.png → name-2.png → name-3.png …
          const extname = path.extname(safeName);
          const base = safeName.slice(0, safeName.length - extname.length);
          let dest = path.join(input.targetDir, safeName);
          // overwrite=true 时同名直接覆盖，不走 -2/-3 兜底（保证 <cardId>.png 一一对应可重生成）
          if (!input.overwrite) {
            for (let i = 2; i < 1000; i++) {
              try {
                await fs.access(dest);
                dest = path.join(input.targetDir, `${base}-${i}${extname}`);
              } catch {
                break; // 不存在 → 可用
              }
            }
          }
          if (it.src.startsWith('data:')) {
            const m = it.src.match(/^data:[^;]+;base64,(.*)$/);
            if (!m) throw new Error('不是合法的 dataUri');
            await fs.writeFile(dest, Buffer.from(m[1], 'base64'));
          } else {
            await fs.copyFile(it.src, dest);
          }
          saved.push({ src: it.src, dest });
        } catch (e) {
          failed.push({ src: it.src, error: (e as Error).message });
        }
      }
      return ok({ saved, failed });
    }
  );

  // 抓取一个网页的预览（og:image 封面 + og:title 标题），用于「外置提示词库」卡片自动获取封面。
  // 主进程抓取（避开 CORS）：取 HTML → 解析 og:image/twitter:image + og:title/<title> → 抓图 sharp 压成 512 webp dataURI。
  // 只读、不存储其它内容；失败一律 toast，不抛。
  register('api:web:page-preview', z.object({ url: z.string().url() }), async (input) => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 12000);
    try {
      const res = await chromiumFetch(input.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36' },
        signal: ac.signal
      });
      const html = (await res.text()).slice(0, 600_000); // 只看头部足够拿 meta
      const meta = (prop: string): string | undefined => {
        const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i');
        const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, 'i');
        return re.exec(html)?.[1] ?? re2.exec(html)?.[1];
      };
      const title =
        meta('og:title') ?? meta('twitter:title') ?? /<title[^>]*>([^<]+)<\/title>/i.exec(html)?.[1];
      const imgRaw = meta('og:image') ?? meta('twitter:image') ?? meta('og:image:url');
      let cover: string | undefined;
      if (imgRaw) {
        try {
          const imgUrl = new URL(imgRaw, input.url).toString();
          const imgRes = await chromiumFetch(imgUrl, { signal: ac.signal });
          if (imgRes.ok) {
            const buf = Buffer.from(await imgRes.arrayBuffer());
            const webp = await sharp(buf, { failOn: 'none', limitInputPixels: false })
              .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
              .webp({ quality: 78 })
              .toBuffer();
            cover = `data:image/webp;base64,${webp.toString('base64')}`;
          }
        } catch {
          /* 封面图抓不到 → 只回标题 */
        }
      }
      return ok({ title: title?.trim().slice(0, 120), cover });
    } catch (e) {
      return err(
        makeError('NETWORK_OFFLINE', `获取网页预览失败：${(e as Error).message}`, {
          severity: 'toast',
          hint: '检查链接是否可访问，或手动选择本地图片作封面'
        })
      );
    } finally {
      clearTimeout(timer);
    }
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

  // 把纯文本写到 userData/temp-refs/，返回真实磁盘路径（侧栏「文字 → 用软件打开 / 放入文件夹」用）。
  register(
    'api:storage:save-temp-text',
    z.object({ text: z.string(), suggestedName: z.string().optional() }),
    async (input) => {
      try {
        const dir = path.join(app.getPath('userData'), 'temp-refs');
        await fs.mkdir(dir, { recursive: true });
        const safeName = (input.suggestedName ?? 'text').replace(/[^\w一-龥-]/g, '_').slice(0, 40) || 'text';
        const filePath = path.join(dir, `${safeName}-${Date.now()}.txt`);
        await fs.writeFile(filePath, input.text, 'utf-8');
        return ok({ filePath });
      } catch (e) {
        return err(
          makeError('FILE_PERMISSION', `写入临时文本失败：${(e as Error).message}`, { severity: 'toast' })
        );
      }
    }
  );

  // 批量探测路径：是否存在 / 是否目录（侧栏「拖文件夹自动添加快捷方式」判定文件夹 vs exe/lnk）。
  register(
    'api:storage:path-info',
    z.object({ paths: z.array(z.string().min(1)).min(1).max(50) }),
    async (input) => {
      const items = await Promise.all(
        input.paths.map(async (p) => {
          try {
            const st = await fs.stat(p);
            return { path: p, exists: true, isDir: st.isDirectory() };
          } catch {
            return { path: p, exists: false, isDir: false };
          }
        })
      );
      return ok({ items });
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

  // 打开软件配置文件夹（userData，含数据库、节点模板、临时文件等），并返回其绝对路径。
  // 设置页「一键打开配置文件夹」用：方便用户查看 / 备份 / 分享 节点模板等配置文件。
  register('api:storage:open-config-folder', null, async () => {
    const dir = app.getPath('userData');
    try {
      await fs.mkdir(dir, { recursive: true });
      const errMsg = await shell.openPath(dir);
      if (errMsg) {
        return err(makeError('FILE_NOT_FOUND', `打开失败：${errMsg}`, { severity: 'toast' }));
      }
      return ok({ path: dir });
    } catch (e) {
      return err(
        makeError('FILE_NOT_FOUND', `打开失败：${(e as Error).message}`, { severity: 'toast' })
      );
    }
  });

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

  // 任务完成提醒：让任务栏图标闪烁（Windows 默认黄/橙高亮，闪一会儿后保持高亮直到用户聚焦窗口）。
  // 只在窗口未聚焦时闪——用户正在看就别打扰。聚焦时 main.ts 的 'focus' 监听会 flashFrame(false) 清除。
  register('api:window:flash', null, async (_input, event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isFocused()) win.flashFrame(true);
    return ok(true as const);
  });
}

void ok;
