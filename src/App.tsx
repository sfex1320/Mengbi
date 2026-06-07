import { HashRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sidebar } from '@/components/Sidebar';
import { ThemePicker } from '@/components/ThemePicker';
import { ToastViewport } from '@/components/ToastViewport';
import { WindowControls } from '@/components/WindowControls';
import { NotificationCenter } from '@/components/NotificationCenter';
import { Stars } from '@/components/Stars';
import { ContextMenuRoot } from '@/components/ContextMenu';
import { ConfirmDialogRoot } from '@/components/ConfirmDialog';
import { CursorHalo } from '@/components/CursorHalo';
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
import type { NotificationAppendPayload } from '@shared/ipc';

const ROUTE_LABEL: Record<string, string> = {
  '/': '生图',
  '/manager': '图库',
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
  useEffect(() => {
    const off = window.electronAPI?.on('notification:append', (payload) => {
      const entry = payload as NotificationAppendPayload;
      if (!entry || typeof entry.id !== 'string') return;
      useNotificationStore.getState().append(entry);
    });
    return () => {
      off?.();
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
          {/* 页面切换淡入淡出（短时长、mode=wait）：替代原来的瞬切，过渡更顺。仅 opacity，不动布局 */}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={location.pathname}
              className="mb-page-motion"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.14 }}
            >
              <Routes location={location}>
                <Route path="/" element={<CreatePage />} />
                <Route path="/manager" element={<ManagerPage />} />
                <Route path="/canvas" element={<CanvasPage />} />
                <Route path="/tools" element={<ToolsPage />} />
                <Route path="/comfyui" element={<ComfyUIPage />} />
                <Route path="/smart-canvas" element={<SmartCanvasPage />} />
                <Route path="/settings" element={<SettingsPage />} />
              </Routes>
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
      <ToastViewport />
      <ContextMenuRoot />
      <ConfirmDialogRoot />
      <CursorHalo />
    </div>
  );
}
