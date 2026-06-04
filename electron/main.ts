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
 *   1. resources/icon.png    —— 当前打包资源（mengbi 标志透明）
 *   2. userData/icon-101.png —— 旧版本 sharp 栅格化的兜底缓存
 *   3. 1×1 透明占位
 *
 * 注意顺序：resources/icon.png 必须排前面，旧用户 userData 里仍有上一版本的
 * icon-101.png 缓存，不挪到后面就一直拿旧图。
 */
function loadAppIcon(): Electron.NativeImage {
  const cached = path.join(app.getPath('userData'), 'icon-101.png');
  for (const p of [getResourcePath('icon.png'), cached]) {
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

/** 启动时清理 userData/temp-refs/ 中超过 24 小时的旧文件。
 *  这里存的是画板"送入生图页"时为引用图写盘的临时图片——重启之后引用关系丢了，
 *  但文件本身还在。24h 阈值兼顾"用户重启后继续编辑同一批"和"避免无限增长"。 */
async function cleanupTempRefs(): Promise<void> {
  const dir = path.join(app.getPath('userData'), 'temp-refs');
  try {
    const files = await fs.promises.readdir(dir);
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const f of files) {
      const p = path.join(dir, f);
      try {
        const stat = await fs.promises.stat(p);
        if (stat.mtimeMs < cutoff) {
          await fs.promises.unlink(p).catch(() => {});
        }
      } catch {
        /* skip 单个文件失败 */
      }
    }
  } catch {
    /* dir 不存在 = 还没用过 */
  }
}

function createTray(): void {
  const baseIcon = loadAppIcon();
  // 托盘要 16×16 / 32×32 范围；resize 一下避免 macOS 上巨大
  const icon = baseIcon.resize({ width: 18, height: 18 });

  try {
    tray = new Tray(icon);
    tray.setToolTip('Mengbi · AI绘画智能工作站');
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
      // 启用 Chromium 实验性能力（含 WebGPU），让 onnxruntime-web 能用到 GPU 推理。
      // 没开这个 flag，Electron 28 默认 webgpu adapter 不可用。
      experimentalFeatures: true,
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
            "script-src 'self' 'wasm-unsafe-eval'; " +
            "worker-src 'self' blob:; " +
            "connect-src 'self' https:;"
        ]
      }
    });
  });
}

// 解锁 WebGPU 不安全后端 —— Electron 28 + Windows 上 onnxruntime-web 的 webgpu provider
// 需要这个 switch 才能拿到 GPU adapter；wasm 后端不依赖此 switch。
app.commandLine.appendSwitch('enable-unsafe-webgpu');
app.commandLine.appendSwitch('enable-features', 'Vulkan');

app.whenReady().then(async () => {
  try {
    initDb();
    registerAllIpcHandlers();
    await cleanupTempRefs();
  } catch (e) {
    logger.error('boot failed', e);
    app.exit(1);
    return;
  }

  // 启动期清扫:上一轮 mengbi 异常退出留下的孤儿 Python sidecar 此时可能仍在烧 GPU,
  // 探测所有已注册 feature 的端口,有人占着就走 graceful HTTP + stop bat + taskkill 完整流程。
  // 必须在 registerAllIpcHandlers() 之后（FeatureRegistry 已注册 HYPIR/SUPIR）、在用户能 spawn 新 sidecar 之前跑。
  try {
    const { sweepOrphanSidecars } = await import('./services/ai-platform');
    const r = await sweepOrphanSidecars();
    if (r.swept.length > 0) {
      logger.info(`[main] startup sweep cleaned ${r.swept.length} orphan sidecar(s): ${r.swept.join(', ')}`);
    }
  } catch (e) {
    logger.warn(`[main] startup orphan sweep failed: ${(e as Error).message}`);
    // 不阻塞启动 —— 用户仍可用 mengbi 的其他功能
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
  // 内嵌 llama-cpp 服务异步停（不能在这里 await，但 process exit 前 OS 会回收）
  void import('./services/localLlmServer').then(({ localLlmServer }) =>
    localLlmServer.stop()
  );
  // AI sidecar 优雅停 fire-and-forget(graceful HTTP 路径,Python 端 atexit 可以正常跑)
  void import('./services/ai-platform').then(({ getSidecarManager }) =>
    getSidecarManager().stopAllOnQuit()
  );
  // 同步兜底:before-quit 没有 await,如果 mengbi 在 graceful 完成前就退出,
  // 上面的 async chain 会被 OS 直接砍掉,Python 孙子留下当孤儿。
  // 这里同步 spawn taskkill /F /T /PID,1.5s 内完成,确保 GPU 被释放。
  try {
    // require() 在 before-quit 里是同步的;import() 才是 async
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const aiPlatform = require('./services/ai-platform') as typeof import('./services/ai-platform');
    aiPlatform.getSidecarManager().killAllSidecarsSync();
  } catch {
    /* 即便 require 失败也别拖垮退出 */
  }
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});
