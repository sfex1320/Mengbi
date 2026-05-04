import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { NavLink } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { AiBrushIcon, GalleryIcon, FlaskIcon, SettingsIcon, PlusIcon, CheckIcon } from './Icon';
import { useUIStore } from '@/store/uiStore';
import { BUILTIN_AVATARS } from '@/data/avatars';
import { toast } from '@/store/toastStore';
import './Sidebar.css';

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  shortcut: string;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: '生图', icon: AiBrushIcon, shortcut: 'Ctrl+1' },
  { to: '/manager', label: '提示词管家', icon: GalleryIcon, shortcut: 'Ctrl+2' },
  { to: '/lab', label: '实验室', icon: FlaskIcon, shortcut: 'Ctrl+3' }
];

/**
 * 侧边栏 active 高亮：之前用 `layoutId="sidebar-active-bg"` 让背景胶囊在不同 nav
 * 之间"飞"——但跨距大（顶 → 底）时会从屏幕中段穿过，看着像"什么东西突然弹出来"。
 * 改成 CSS-only 的 fade，每个图标自己的高亮，不跨元素移动，就稳了。
 */
export function Sidebar(): JSX.Element {
  const ui = useUIStore();
  const [picking, setPicking] = useState(false);
  const [pickerPos, setPickerPos] = useState<{ left: number; top: number } | null>(null);
  const avatarBtnRef = useRef<HTMLButtonElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  const currentAvatarUrl =
    ui.avatarKey === 'custom' && ui.customAvatarDataUri
      ? ui.customAvatarDataUri
      : (BUILTIN_AVATARS.find((a) => a.key === ui.avatarKey) ?? BUILTIN_AVATARS[0]).url;

  function openPicker(): void {
    const btn = avatarBtnRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    setPickerPos({ left: r.right + 10, top: r.top });
    setPicking(true);
  }

  function togglePicker(): void {
    if (picking) {
      setPicking(false);
    } else {
      openPicker();
    }
  }

  // Outside click + Esc to close picker
  useEffect(() => {
    if (!picking) return;
    function onDown(e: MouseEvent): void {
      const t = e.target as Node;
      if (
        pickerRef.current?.contains(t) ||
        avatarBtnRef.current?.contains(t)
      ) {
        return;
      }
      setPicking(false);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setPicking(false);
    }
    function onScroll(): void {
      // 滚动 / resize 时关闭——避免位置错位
      setPicking(false);
    }
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onScroll);
    };
  }, [picking]);

  function pickBuiltin(key: string): void {
    ui.setAvatarKey(key);
    setPicking(false);
  }

  async function uploadAvatar(): Promise<void> {
    const r = await window.electronAPI.storage.pickImages();
    if (!r.ok) {
      toast.error('打开文件失败', r.error.message);
      return;
    }
    const f = r.data.files[0];
    if (!f) return;
    ui.setCustomAvatarDataUri(f.dataUri);
    ui.setAvatarKey('custom');
    setPicking(false);
    toast.success('头像已更新');
  }

  return (
    <aside className="mb-sidebar">
      <button
        ref={avatarBtnRef}
        type="button"
        className="mb-sidebar-avatar"
        aria-label="切换头像"
        title="点击换头像"
        onClick={togglePicker}
      >
        <div className="mb-sidebar-avatar-glow" />
        <img
          src={currentAvatarUrl}
          alt="头像"
          className="mb-sidebar-avatar-img"
          draggable={false}
        />
      </button>

      {createPortal(
        <AnimatePresence>
          {picking && pickerPos && (
            <motion.div
              ref={pickerRef}
              initial={{ opacity: 0, x: -8, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: -8, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              className="mb-avatar-picker"
              style={{ left: pickerPos.left, top: pickerPos.top }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-avatar-picker-grid">
                {BUILTIN_AVATARS.map((a) => (
                  <button
                    key={a.key}
                    type="button"
                    className={`mb-avatar-cell ${
                      ui.avatarKey === a.key ? 'is-active' : ''
                    }`}
                    onClick={() => pickBuiltin(a.key)}
                    title={a.label}
                  >
                    <img src={a.url} alt={a.label} draggable={false} />
                    {ui.avatarKey === a.key && (
                      <span className="mb-avatar-cell-check">
                        <CheckIcon size={11} />
                      </span>
                    )}
                  </button>
                ))}
                {ui.customAvatarDataUri && (
                  <button
                    type="button"
                    className={`mb-avatar-cell ${
                      ui.avatarKey === 'custom' ? 'is-active' : ''
                    }`}
                    onClick={() => pickBuiltin('custom')}
                    title="自定义头像"
                  >
                    <img src={ui.customAvatarDataUri} alt="自定义" draggable={false} />
                    {ui.avatarKey === 'custom' && (
                      <span className="mb-avatar-cell-check">
                        <CheckIcon size={11} />
                      </span>
                    )}
                  </button>
                )}
              </div>
              <button
                type="button"
                className="mb-avatar-upload-btn"
                onClick={uploadAvatar}
              >
                <PlusIcon size={12} /> 上传自定义
              </button>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}

      <div className="mb-sidebar-divider" />

      <nav className="mb-sidebar-nav">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              title={`${item.label} (${item.shortcut})`}
              className={({ isActive }) => `mb-sidebar-item ${isActive ? 'is-active' : ''}`}
            >
              <motion.span
                className="mb-sidebar-item-inner"
                whileHover={{ scale: 1.06 }}
                whileTap={{ scale: 0.94 }}
              >
                <Icon size={22} />
              </motion.span>
            </NavLink>
          );
        })}
      </nav>

      <NavLink
        to="/settings"
        title="设置 (Ctrl+,)"
        end
        className={({ isActive }) =>
          `mb-sidebar-item mb-sidebar-item-foot ${isActive ? 'is-active' : ''}`
        }
      >
        <motion.span
          className="mb-sidebar-item-inner"
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.94 }}
          transition={{ type: 'spring', stiffness: 350, damping: 22 }}
        >
          <SettingsIcon size={20} />
        </motion.span>
      </NavLink>
    </aside>
  );
}
