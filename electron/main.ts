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
let splash: BrowserWindow | null = null;

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
 * 加载托盘 / 窗口图标。
 *   1. resources/icon.png —— 随包发的应用图标（1024² 方形，electron-builder.yml extraResources 落到
 *      process.resourcesPath/resources/icon.png；dev 时在项目根 resources/icon.png）
 *   2. 1×1 透明占位（仅当 icon.png 缺失时兜底）
 *
 * 注意：**不再**回退到 userData/icon-101.png。那是旧版本 sharp 栅格化的缓存，
 * 一旦 resources/icon.png 没随包发（历史 bug），就会一直拿那张旧 logo —— 任务栏 + 托盘双双显示老图。
 * 现在 icon.png 已显式随包发，缓存兜底纯属footgun，移除。
 */
function loadAppIcon(): Electron.NativeImage {
  const p = getResourcePath('icon.png');
  try {
    if (fs.existsSync(p)) {
      const img = nativeImage.createFromPath(p);
      if (!img.isEmpty()) return img;
    }
  } catch {
    /* 落到占位 */
  }
  return nativeImage.createFromBuffer(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGUlEQVR42mNkYPhfDwQMjAxQ8B+EAQAFiAH+nW3pmAAAAABJRU5ErkJggg==',
      'base64'
    )
  );
}

/**
 * 启动画面（splash）。app.whenReady 一进来就弹，避免「点了图标但黑屏几秒、不知道有没有启动」。
 * 主窗口 ready-to-show 时关闭。frameless + 透明圆角卡片 + 不确定进度条（动画）。
 */
function createSplash(): void {
  try {
    splash = new BrowserWindow({
      width: 460,
      height: 460,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      center: true,
      show: false,
      alwaysOnTop: true,
      skipTaskbar: false,
      hasShadow: false,
      backgroundColor: '#00000000',
      title: '梦笔',
      icon: loadAppIcon(),
      webPreferences: { contextIsolation: true, nodeIntegration: false }
    });
    // 迅雷风：透明窗口，中间 logo + 往外延展的光晕（双层呼吸）+ 下方流动进度条，无边框无卡片
    const logo = loadAppIcon().toDataURL();
    const html = `<!doctype html><meta charset="utf-8"/><style>
html,body{margin:0;height:100%;overflow:hidden;background:transparent;-webkit-user-select:none;user-select:none;font-family:Inter,'SF Pro Display',system-ui,-apple-system,sans-serif}
.wrap{position:relative;width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center}
.logobox{position:relative;display:flex;align-items:center;justify-content:center;width:160px;height:160px}
.halo{position:absolute;left:50%;top:50%;width:380px;height:380px;transform:translate(-50%,-50%);pointer-events:none;background:radial-gradient(circle,rgba(96,165,255,.55) 0%,rgba(74,134,242,.30) 26%,rgba(56,104,214,.13) 46%,rgba(20,40,90,0) 68%);animation:breathe 2.6s ease-in-out infinite}
.halo2{position:absolute;left:50%;top:50%;width:230px;height:230px;transform:translate(-50%,-50%);pointer-events:none;background:radial-gradient(circle,rgba(150,200,255,.5) 0%,rgba(120,180,255,0) 70%);animation:breathe 2.6s ease-in-out infinite reverse}
@keyframes breathe{0%,100%{opacity:.7;transform:translate(-50%,-50%) scale(.96)}50%{opacity:1;transform:translate(-50%,-50%) scale(1.12)}}
.logo{position:relative;width:132px;height:132px;object-fit:contain;filter:drop-shadow(0 4px 22px rgba(80,150,255,.55));animation:float 3s ease-in-out infinite}
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
.bar{position:relative;margin-top:30px;width:188px;height:4px;border-radius:99px;background:rgba(180,205,255,.16);overflow:hidden;box-shadow:0 0 10px rgba(80,150,255,.22)}
.bar::before{content:"";position:absolute;top:0;height:100%;width:40%;border-radius:99px;background:linear-gradient(90deg,#5b9cff,#9ecbff);box-shadow:0 0 8px rgba(120,180,255,.8);animation:run 1.15s cubic-bezier(.4,0,.2,1) infinite}
@keyframes run{0%{left:-42%}100%{left:100%}}
.status{position:relative;margin-top:15px;font-size:12.5px;letter-spacing:2px;color:rgba(225,235,255,.78);text-shadow:0 1px 6px rgba(0,0,0,.55)}
</style>
<div class="wrap"><div class="logobox"><div class="halo"></div><div class="halo2"></div><img class="logo" src="${logo}"/></div><div class="bar"></div><div class="status" id="s">正在启动…</div></div>`;
    void splash.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    splash.once('ready-to-show', () => splash?.show());
    // 兜底：12s 后无条件关掉 splash，防主窗口万一没触发 ready-to-show 时一直挂着
    setTimeout(() => closeSplash(), 12_000);
  } catch (e) {
    logger.warn('splash init failed', e);
  }
}

/** 更新 splash 上的状态文字（启动阶段提示）。splash 已关闭则静默忽略。 */
function splashStatus(text: string): void {
  if (splash && !splash.isDestroyed()) {
    splash.webContents
      .executeJavaScript(
        `(()=>{const e=document.getElementById('s');if(e)e.textContent=${JSON.stringify(text)}})()`
      )
      .catch(() => undefined);
  }
}

function closeSplash(): void {
  if (splash && !splash.isDestroyed()) {
    try {
      splash.close();
    } catch {
      /* ignore */
    }
  }
  splash = null;
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
    closeSplash();
    mainWindow?.show();
    // 不再在 dev 自动弹 DevTools —— 分离的 DevTools 会持续给渲染端打点（Elements/Paint/DOM 变更序列化），
    // 帧率大幅下降，是「从终端跑 npm run dev 测试时巨卡」的头号原因。需要时按 F12 / Ctrl+Shift+I，
    // 或设 MENGBI_OPEN_DEVTOOLS=1 启动。打包版本来就不会开（不设 ELECTRON_RENDERER_URL）。
    if (process.env.MENGBI_OPEN_DEVTOOLS === '1') {
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
    closeSplash();
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
    mainWindow?.show(); // 加载失败时 ready-to-show 不会触发，手动显示让用户看到错误页
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

// 解锁 WebGPU 不安全后端 —— 仅放开 WebGPU API 表面，不改合成后端。保留它，供将来渲染端
// onnxruntime-web 真用上 device:'webgpu' 时取 GPU adapter（当前抠图走 wasm、放大走
// onnxruntime-node/DirectML，都不依赖它）。
app.commandLine.appendSwitch('enable-unsafe-webgpu');
// ⚠️ 性能修复：**不再强制 Vulkan 合成后端**。Electron 28(Chromium 120) 上 Vulkan 是实验路径，
// 不少 Win11 GPU/驱动会被 blocklist 或静默退化到 SwiftShader 软件渲染 → 全程界面卡顿（即便不碰 AI 功能）。
// 改用 Chrome 在 Windows 上的稳定默认 ANGLE/D3D11，恢复硬件合成。
// （将来若渲染端真要 WebGPU 且某 GPU 必须 Vulkan，请按机器实测后再 gated 加回 enable-features=Vulkan，别全局强开。）
app.commandLine.appendSwitch('use-angle', 'd3d11');

app.whenReady().then(async () => {
  // 立刻弹启动画面：DB 初始化 / 渲染端解析期间不再黑屏，用户一眼能看到「已经在启动」
  createSplash();

  try {
    splashStatus('初始化数据库…');
    initDb();
    splashStatus('注册服务…');
    registerAllIpcHandlers();
  } catch (e) {
    logger.error('boot failed', e);
    closeSplash();
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

  // 关键提速：窗口尽早创建，渲染端立刻开始加载；耗时清理/孤儿清扫挪到窗口之后后台跑，不阻塞首屏
  splashStatus('加载界面…');
  createWindow();
  createTray();

  // —— 非阻塞后台任务（不挡窗口显示）——
  // 上一轮异常退出留下的临时引用图：超过 24h 的清掉
  cleanupTempRefs().catch((e) => logger.warn('cleanupTempRefs failed', e));
  // 孤儿 Python sidecar 清扫（探测端口可能慢）：后台跑；必须在 registerAllIpcHandlers() 之后
  // （FeatureRegistry 已注册）、在用户能 spawn 新 sidecar 之前完成。
  void (async () => {
    try {
      const { sweepOrphanSidecars } = await import('./services/ai-platform');
      const r = await sweepOrphanSidecars();
      if (r.swept.length > 0) {
        logger.info(
          `[main] startup sweep cleaned ${r.swept.length} orphan sidecar(s): ${r.swept.join(', ')}`
        );
      }
    } catch (e) {
      logger.warn(`[main] startup orphan sweep failed: ${(e as Error).message}`);
    }
  })();

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
