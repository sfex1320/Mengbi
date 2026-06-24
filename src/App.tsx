import { HashRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Sidebar } from '@/components/Sidebar';
import { ThemePicker } from '@/components/ThemePicker';
import { ToastViewport } from '@/components/ToastViewport';
import { WindowControls } from '@/components/WindowControls';
import { NotificationCenter } from '@/components/NotificationCenter';
import { Stars } from '@/components/Stars';
import { ContextMenuRoot } from '@/components/ContextMenu';
import { ConfirmDialogRoot } from '@/components/ConfirmDialog';
import { CursorHalo } from '@/components/CursorHalo';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import CreatePage from '@/pages/Create';
import ManagerPage from '@/pages/Manager';
import CanvasPage from '@/pages/Canvas';
import SettingsPage from '@/pages/Settings';
import ToolsPage from '@/pages/Tools';
import ComfyUIPage from '@/pages/ComfyUI';
import SmartCanvasPage from '@/pages/SmartCanvas';
import { applyThemeToDocument, useThemeStore } from '@/store/themeStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useNotificationStore } from '@/store/notificationStore';
import { useShortcutsStore } from '@/store/shortcutsStore';
import { useGalleryStore } from '@/store/galleryStore';
import { toast } from '@/store/toastStore';
import { registerSmartRunnerListeners } from '@/lib/smartCanvasRunner';
import { speakNotification, isTaskCompletion } from '@/lib/voiceNotify';
import type { NotificationAppendPayload } from '@shared/ipc';

const ROUTE_LABEL: Record<string, string> = {
  '/': '生图',
  '/manager': '资产库',
  '/canvas': '画板',
  '/tools': '工具箱',
  '/comfyui': '工作流',
  '/smart-canvas': '智能画布',
  '/settings': '设置'
};

export default function App(): JSX.Element {
  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  );
}

function Shell(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const load = useSettingsStore((s) => s.load);

  useEffect(() => {
    applyThemeToDocument();
    load().catch((e) => console.error('settings load failed', e));
  }, [load]);

  // 订阅主进程推送的通知中心条目，写入 notificationStore。
  // 顺手做任务完成语音播报（voiceNotify 按白名单/开关/话术表自行过滤）+ 任务栏图标闪烁提醒。
  useEffect(() => {
    const off = window.electronAPI?.on('notification:append', (payload) => {
      const entry = payload as NotificationAppendPayload;
      if (!entry || typeof entry.id !== 'string') return;
      useNotificationStore.getState().append(entry);
      speakNotification(entry);
      // 真正完成的任务 → 任务栏图标闪烁/标黄（窗口未聚焦时；与语音开关无关）
      if (isTaskCompletion(entry)) window.electronAPI?.window.flash().catch(() => undefined);
    });
    return () => {
      off?.();
    };
  }, []);

  // 智能画布的任务推送监听（image:done / comfyui:run-done / video:* / chat:*）注册在 App 级：
  // 切到任何页面任务都不丢路由——页面只展示状态，不决定任务是否继续（任务生命周期规范）。
  useEffect(() => {
    const off = registerSmartRunnerListeners();
    return off;
  }, []);

  // 资产库常驻预加载（默认开）：启动即把「全部」列表拉进 App 级缓存，并在产物入库/生图完成时后台刷新，
  // 这样从别的功能切回资产库时瞬开、不空等 2-3 秒（Manager 整页随路由 unmount，缓存在 App 级活着）。
  useEffect(() => {
    if (!window.electronAPI?.on) return;
    const enabled = (): boolean => useSettingsStore.getState().prefs.gallery_preload !== '0';
    if (enabled()) void useGalleryStore.getState().preload();
    // image:done 往往紧跟一条 gallery:changed（产物自动入库广播）——300ms 去抖，避免一次完成触发两次 preload
    let timer: number | undefined;
    const refresh = (): void => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (enabled()) void useGalleryStore.getState().preload();
      }, 300);
    };
    const off1 = window.electronAPI.on('gallery:changed', refresh);
    const off2 = window.electronAPI.on('image:done', refresh);
    return () => {
      if (timer) window.clearTimeout(timer);
      off1();
      off2();
    };
  }, []);

  // 待机静默模式：窗口失焦 / 最小化 / 切到其它桌面 时，
  // 在 <html> 上打 data-idle，CSS 把所有 animation-play-state 设为 paused，
  // 大大降低后台 CPU（流星 / 星辰 / 渐变 logo / orb 全部停转）。
  // 鼠标点回软件 → focus 事件 → 自动恢复。
  useEffect(() => {
    const html = document.documentElement;
    // 失焦/隐藏 → 立即 idle；聚焦可见但「无输入超过 IDLE_AFTER_MS」也进入 idle，
    // 让装饰动画在用户停手发呆时也暂停（原来只在失焦时停，聚焦发呆仍满载烧 GPU）。
    const IDLE_AFTER_MS = 8000;
    let timer: number | undefined;
    function setIdle(v: boolean): void {
      if (v) html.dataset.idle = 'true';
      else delete html.dataset.idle;
    }
    function clearTimer(): void {
      if (timer !== undefined) {
        window.clearTimeout(timer);
        timer = undefined;
      }
    }
    function recompute(): void {
      const active = document.hasFocus() && !document.hidden;
      if (!active) {
        clearTimer();
        setIdle(true);
        return;
      }
      setIdle(false);
      clearTimer();
      timer = window.setTimeout(() => setIdle(true), IDLE_AFTER_MS);
    }
    function onActivity(): void {
      if (!document.hasFocus() || document.hidden) return;
      if (html.dataset.idle === 'true') setIdle(false);
      clearTimer();
      timer = window.setTimeout(() => setIdle(true), IDLE_AFTER_MS);
    }
    window.addEventListener('blur', recompute);
    window.addEventListener('focus', recompute);
    document.addEventListener('visibilitychange', recompute);
    window.addEventListener('mousemove', onActivity, { passive: true });
    window.addEventListener('keydown', onActivity);
    window.addEventListener('wheel', onActivity, { passive: true });
    window.addEventListener('pointerdown', onActivity, { passive: true });
    recompute();
    return () => {
      clearTimer();
      window.removeEventListener('blur', recompute);
      window.removeEventListener('focus', recompute);
      document.removeEventListener('visibilitychange', recompute);
      window.removeEventListener('mousemove', onActivity);
      window.removeEventListener('keydown', onActivity);
      window.removeEventListener('wheel', onActivity);
      window.removeEventListener('pointerdown', onActivity);
      delete html.dataset.idle;
    };
  }, []);

  // 当前路径放 ref，键盘处理器读最新值（避免把 location 进 effect 依赖反复重订阅）
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;
  useEffect(() => {
    const NAV_MAP: Record<string, string> = {
      '1': '/',
      '2': '/canvas',
      '3': '/manager',
      '4': '/comfyui',
      '5': '/tools',
      '6': '/smart-canvas',
      ',': '/settings'
    };
    function onKey(e: KeyboardEvent): void {
      const ctrl = e.ctrlKey || e.metaKey;
      // e.repeat：忽略长按自动重复，避免排队多次跳转
      if (!ctrl || e.repeat) return;
      const target = NAV_MAP[e.key];
      if (!target) return;
      e.preventDefault();
      if (pathRef.current !== target) navigate(target); // 已在目标页就不再重复跳
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  // Ctrl+7/8/9 启动前 3 个侧栏快捷方式（Ctrl+1..6=主功能、Ctrl+0/-/= 已被窗口缩放占用）。
  useEffect(() => {
    const KEYS = ['7', '8', '9'];
    function onKey(e: KeyboardEvent): void {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.repeat) return;
      const idx = KEYS.indexOf(e.key);
      if (idx < 0) return;
      const s = useShortcutsStore.getState().shortcuts[idx];
      if (!s) return;
      e.preventDefault();
      if (s.kind === 'folder') {
        void window.electronAPI.storage.openPath({ targetPath: s.path }).then((r) => {
          if (!r.ok) toast.error('打开失败', r.error.message);
        });
      } else {
        void window.electronAPI.shortcuts.launchExe({ exePath: s.path }).then((r) => {
          if (!r.ok) toast.error('启动失败', r.error.message);
        });
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 整窗界面缩放：Ctrl/⌘ + =/+ 放大、Ctrl + - 缩小、Ctrl + 0 复位（webFrame 整窗缩放，对称可预期）。
  // Chromium 原生「Ctrl++」在无菜单无边框窗口里不可靠（"+" 实为 Shift+"="，未绑定放大加速器），这里统一接管。
  // 画板(/canvas)自身用 Ctrl+± / Ctrl+0 缩放画布 —— 在该页放行不接管（由画板自己 preventDefault + 缩放画布）。
  useEffect(() => {
    function onZoomKey(e: KeyboardEvent): void {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      let dir: 'in' | 'out' | 'reset' | null = null;
      if (e.key === '=' || e.key === '+' || e.code === 'Equal' || e.code === 'NumpadAdd') dir = 'in';
      else if (e.key === '-' || e.key === '_' || e.code === 'Minus' || e.code === 'NumpadSubtract') dir = 'out';
      else if (e.key === '0' || e.code === 'Digit0' || e.code === 'Numpad0') dir = 'reset';
      if (!dir) return;
      if (pathRef.current === '/canvas') return; // 画板自己缩放画布，不接管
      e.preventDefault(); // 接管：压掉 Chromium 原生缩放，改用 webFrame 对称缩放（themeStore 持久化）
      const STEP = 0.1;
      const cur = useThemeStore.getState().appZoom;
      const next = dir === 'reset' ? 1 : dir === 'in' ? cur + STEP : cur - STEP;
      useThemeStore.getState().setAppZoom(next);
    }
    window.addEventListener('keydown', onZoomKey);
    return () => window.removeEventListener('keydown', onZoomKey);
  }, []);

  const label = ROUTE_LABEL[location.pathname] ?? 'Mengbi';
  // 性能模式=低配：页面切换过渡 duration=0（等效关闭），少两帧合成，弱机切页更跟手
  const perfMode = useThemeStore((s) => s.perfMode);

  return (
    <div className="mb-app">
      <Stars />
      <Sidebar />
      <main className="mb-app-main">
        <header className="mb-header">
          <div className="mb-header-brand">
            <div className="mb-header-brand-title">
              <span className="mb-header-brand-name">MENGBI</span>
              <span className="mb-header-brand-tagline">AI绘画智能工作站</span>
            </div>
            <span className="mb-header-divider">·</span>
            <motion.span
              key={label}
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.22 }}
              className="mb-header-route"
            >
              {label}
            </motion.span>
          </div>
          <div className="mb-header-actions">
            <ThemePicker />
            <NotificationCenter />
            <WindowControls />
          </div>
        </header>
        <div className="mb-page-container">
          {/* 路由切换只做「新页面入场淡入」，刻意不再用 AnimatePresence mode="wait" + exit。
              踩过的坑：mode="wait" 必须等旧页面 exit 动画完成才挂载新页面；若旧页面子树里有
              framer 的 layoutId 共享布局动画 / 嵌套 AnimatePresence 的 exit 没回调「safe to remove」
              （提示词管家就是），整条切换队列会被永久卡死 → 新页面挂载后停在 opacity:0 →
              内容区全白且持续，而且不抛错（ErrorBoundary 接不住，所以上次加错误边界没修好）。
              改成「按 pathname 重挂 + 入场淡入」：旧页面立即卸载、根本不存在可被卡住的 exit 动画，
              任何子树里的动画都无法再阻塞整页渲染。低配模式 duration=0（等效瞬切）。 */}
          <motion.div
            key={location.pathname}
            className="mb-page-motion"
            initial={{ opacity: 0, y: perfMode === 'low' ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: perfMode === 'low' ? 0 : 0.16 }}
          >
            {/* 页面级错误边界：某页渲染崩溃只显示可恢复的错误卡，侧栏 / 顶栏仍可用，
                切换功能页（pathname 变 → resetKey 变）自动恢复，杜绝「一处崩溃 → 整个应用白屏卡死」 */}
            <ErrorBoundary contained resetKey={location.pathname}>
              <Routes location={location}>
                <Route path="/" element={<CreatePage />} />
                <Route path="/manager" element={<ManagerPage />} />
                <Route path="/canvas" element={<CanvasPage />} />
                <Route path="/tools" element={<ToolsPage />} />
                <Route path="/comfyui" element={<ComfyUIPage />} />
                <Route path="/smart-canvas" element={<SmartCanvasPage />} />
                <Route path="/settings" element={<SettingsPage />} />
              </Routes>
            </ErrorBoundary>
          </motion.div>
        </div>
      </main>
      <ToastViewport />
      <ContextMenuRoot />
      <ConfirmDialogRoot />
      <CursorHalo />
    </div>
  );
}
