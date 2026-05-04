import { HashRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { Sidebar } from '@/components/Sidebar';
import { ThemePicker } from '@/components/ThemePicker';
import { ToastViewport } from '@/components/ToastViewport';
import { WindowControls } from '@/components/WindowControls';
import { Stars } from '@/components/Stars';
import { ContextMenuRoot } from '@/components/ContextMenu';
import { ConfirmDialogRoot } from '@/components/ConfirmDialog';
import CreatePage from '@/pages/Create';
import ManagerPage from '@/pages/Manager';
import LaboratoryPage from '@/pages/Laboratory';
import SettingsPage from '@/pages/Settings';
import { applyThemeToDocument } from '@/store/themeStore';
import { useSettingsStore } from '@/store/settingsStore';

const ROUTE_LABEL: Record<string, string> = {
  '/': '生图',
  '/manager': '提示词管家',
  '/lab': '实验室',
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

  // 待机静默模式：窗口失焦 / 最小化 / 切到其它桌面 时，
  // 在 <html> 上打 data-idle，CSS 把所有 animation-play-state 设为 paused，
  // 大大降低后台 CPU（流星 / 星辰 / 渐变 logo / orb 全部停转）。
  // 鼠标点回软件 → focus 事件 → 自动恢复。
  useEffect(() => {
    const html = document.documentElement;
    function setIdle(v: boolean): void {
      if (v) html.dataset.idle = 'true';
      else delete html.dataset.idle;
    }
    function recompute(): void {
      const blurred = !document.hasFocus();
      const hidden = document.hidden;
      setIdle(blurred || hidden);
    }
    window.addEventListener('blur', recompute);
    window.addEventListener('focus', recompute);
    document.addEventListener('visibilitychange', recompute);
    recompute();
    return () => {
      window.removeEventListener('blur', recompute);
      window.removeEventListener('focus', recompute);
      document.removeEventListener('visibilitychange', recompute);
      delete html.dataset.idle;
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;
      switch (e.key) {
        case '1':
          e.preventDefault();
          navigate('/');
          break;
        case '2':
          e.preventDefault();
          navigate('/manager');
          break;
        case '3':
          e.preventDefault();
          navigate('/lab');
          break;
        case ',':
          e.preventDefault();
          navigate('/settings');
          break;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  const label = ROUTE_LABEL[location.pathname] ?? '梦笔';

  return (
    <div className="mb-app">
      <Stars />
      <Sidebar />
      <main className="mb-app-main">
        <header className="mb-header">
          <div className="mb-header-brand">
            <span className="mb-header-brand-logo">
              <img
                src={new URL('./assets/icon-121.svg', import.meta.url).toString()}
                alt="梦笔 logo"
                className="mb-header-brand-logo-img"
                draggable={false}
              />
            </span>
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
            <WindowControls />
          </div>
        </header>
        <div className="mb-page-container">
          <Routes location={location}>
            <Route path="/" element={<CreatePage />} />
            <Route path="/manager" element={<ManagerPage />} />
            <Route path="/lab" element={<LaboratoryPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </div>
      </main>
      <ToastViewport />
      <ContextMenuRoot />
      <ConfirmDialogRoot />
    </div>
  );
}
