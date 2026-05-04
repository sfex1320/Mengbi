import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  session,
  shell,
  protocol,
  net
} from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { logger } from './services/logger';
import { initDb, closeDb } from './services/db';
import { registerAllIpcHandlers } from './ipc';

// 让 mengbi-image:// 拥有标准协议特性（支持 fetch、CORS、CSP 等）
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'mengbi-image',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      bypassCSP: false
    }
  }
]);

/**
 * 主进程入口。
 * - 单例锁
 * - 初始化 DB
 * - 注册 IPC handler
 * - 创建主窗口
 */

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

/** 在 dev 和 packaged 两种情形下找 resources/ */
function getResourcePath(...rel: string[]): string {
  // packaged：resources 在 process.resourcesPath；dev：在项目根
  const rootCandidates = [
    process.resourcesPath,
    path.resolve(__dirname, '..', '..'),
    path.resolve(__dirname, '..', '..', '..')
  ];
  for (const root of rootCandidates) {
    if (!root) continue;
    const p = path.join(root, 'resources', ...rel);
    if (fs.existsSync(p)) return p;
  }
  return path.join('resources', ...rel);
}

/**
 * 加载托盘 / 窗口图标。优先级：
 *   1. userData/icon-101.png  —— 用 sharp 把 资源 101.svg 一次性栅格化的缓存
 *   2. resources/icon.png     —— builder buildResources 兜底
 *   3. 1×1 透明占位
 */
function loadAppIcon(): Electron.NativeImage {
  const cached = path.join(app.getPath('userData'), 'icon-101.png');
  for (const p of [cached, getResourcePath('icon.png')]) {
    try {
      if (fs.existsSync(p)) {
        const img = nativeImage.createFromPath(p);
        if (!img.isEmpty()) return img;
      }
    } catch {
      /* try next */
    }
  }
  return nativeImage.createFromBuffer(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGUlEQVR42mNkYPhfDwQMjAxQ8B+EAQAFiAH+nW3pmAAAAABJRU5ErkJggg==',
      'base64'
    )
  );
}

/** 启动时把 资源 101.svg 栅格化成 PNG 缓存到 userData，用于托盘 + 窗口图标 */
async function rasterizeAppIcon(): Promise<void> {
  const cached = path.join(app.getPath('userData'), 'icon-101.png');
  if (fs.existsSync(cached)) return;
  const svgPath = getResourcePath('icon-101.svg');
  if (!fs.existsSync(svgPath)) return;
  try {
    // sharp 在 electron.vite.config.ts 里 external，运行时直接 require 拿原生模块
    const sharp = (await import('sharp')).default;
    const buf = await sharp(svgPath).resize(256, 256).png().toBuffer();
    fs.writeFileSync(cached, buf);
    logger.info('app icon rasterized', cached);
  } catch (e) {
    logger.warn('rasterize app icon failed, falling back to icon.png', e);
  }
}

function createTray(): void {
  const baseIcon = loadAppIcon();
  // 托盘要 16×16 / 32×32 范围；resize 一下避免 macOS 上巨大
  const icon = baseIcon.resize({ width: 18, height: 18 });

  try {
    tray = new Tray(icon);
    tray.setToolTip('梦笔 mengbi');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: '显示主窗口',
          click: () => {
            if (!mainWindow) createWindow();
            else {
              if (mainWindow.isMinimized()) mainWindow.restore();
              mainWindow.show();
              mainWindow.focus();
            }
          }
        },
        {
          label: '隐藏到托盘',
          click: () => mainWindow?.hide()
        },
        { type: 'separator' },
        { label: '退出', role: 'quit' }
      ])
    );
    tray.on('click', () => {
      if (!mainWindow) {
        createWindow();
        return;
      }
      if (mainWindow.isVisible() && mainWindow.isFocused()) mainWindow.hide();
      else {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
    });
  } catch (e) {
    logger.warn('tray init failed', e);
  }
}

function createWindow(): void {
  const preloadPath = path.join(__dirname, '../preload/preload.js');
  logger.info('preload path:', preloadPath, 'exists:', fs.existsSync(preloadPath));

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 680,
    icon: loadAppIcon(),
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0a0b10',
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    titleBarOverlay: false,
    webPreferences: {
      preload: preloadPath,
      sandbox: false, // contextBridge 在 sandbox=true 时仍可用，但 better-sqlite3 等需要 false
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      // 窗口被遮挡 / 最小化时，让 Chromium 主动节流定时器和 rAF，
      // 配合渲染层 data-idle 把后台 CPU 压到接近 0
      backgroundThrottling: true
    }
  });

  mainWindow.webContents.on('preload-error', (_event, preloadFile, error) => {
    logger.error('preload-error', preloadFile, error);
  });

  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level >= 2) {
      logger.warn(`[renderer:${level}] ${message} @ ${sourceId}:${line}`);
    }
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
    const isDev = !!process.env.ELECTRON_RENDERER_URL;
    if (isDev || process.env.MENGBI_OPEN_DEVTOOLS === '1') {
      mainWindow?.webContents.openDevTools({ mode: 'detach' });
    }
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  // 加载失败时打日志，并告诉用户具体原因，避免一片漆黑
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    logger.error('renderer did-fail-load', { code, desc, url });
    const html = `
<!doctype html><meta charset="utf-8"/>
<style>
body{margin:0;padding:60px;font-family:system-ui,-apple-system,sans-serif;color:#f5f5f7;background:#0a0b10}
h1{font-size:18px;margin:0 0 12px}
code{font-family:Consolas,monospace;background:rgba(255,255,255,.06);padding:2px 6px;border-radius:6px;color:#fb923c}
p{color:rgba(245,245,247,.7);max-width:560px;line-height:1.6;font-size:13px}
.hint{margin-top:24px;font-size:12px;color:rgba(245,245,247,.5)}
</style>
<h1>渲染端加载失败</h1>
<p>无法加载 <code>${url}</code><br/>错误：<code>${desc}</code> (${code})</p>
<p class="hint">如果是 dev 模式，请确认 vite dev server 已启动并未被 Ctrl+C 中断。<br/>修好后重启应用即可。</p>`;
    mainWindow?.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  });

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function applySecurityHeaders(): void {
  // 仅在打包后注入 CSP；dev 阶段不注入，避免与 vite HMR / React Refresh 冲突。
  if (!app.isPackaged) return;
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; " +
            "img-src 'self' data: blob: https: mengbi-image:; " +
            "style-src 'self' 'unsafe-inline'; " +
            "script-src 'self'; " +
            "connect-src 'self' https:;"
        ]
      }
    });
  });
}

app.whenReady().then(async () => {
  try {
    initDb();
    registerAllIpcHandlers();
    await rasterizeAppIcon();
  } catch (e) {
    logger.error('boot failed', e);
    app.exit(1);
    return;
  }

  // 把 mengbi-image://x/<base64url-of-absolute-path> 映射到本地文件
  // 这样渲染进程可以用 <img src="mengbi-image://..."> 显示用户磁盘上的图，
  // 又不需要打开 webSecurity:false。
  //
  // 注意：URL 的 host 部分会被 Chromium 标准化为小写，base64url 是大小写敏感的，
  // 所以编码数据放 path 段（path 段保持原大小写）。
  protocol.handle('mengbi-image', (request) => {
    try {
      const url = new URL(request.url);
      // path 形如 "/<base64url>"，去掉前导斜杠
      const encoded = decodeURIComponent(url.pathname.replace(/^\//, ''));
      const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
      const filePath = Buffer.from(padded, 'base64').toString('utf8');
      logger.info('mengbi-image resolve', { encoded: encoded.slice(0, 32), filePath });
      if (!filePath || !fs.existsSync(filePath)) {
        logger.warn('mengbi-image: file missing', filePath);
        return new Response('Not found', { status: 404 });
      }
      return net.fetch(pathToFileURL(filePath).toString());
    } catch (e) {
      logger.warn('mengbi-image protocol error', e);
      return new Response('Bad request', { status: 400 });
    }
  });

  applySecurityHeaders();
  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  closeDb();
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});
