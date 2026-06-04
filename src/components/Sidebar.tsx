import { NavLink } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  AiBrushIcon,
  GalleryIcon,
  FlaskIcon,
  CanvasIcon,
  SettingsIcon,
  ToolboxIcon,
  WorkflowIcon,
  SmartCanvasIcon
} from './Icon';
import logoUrl from '@/assets/mengbi-logo.png';
import './Sidebar.css';

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  shortcut: string;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: '生图', icon: AiBrushIcon, shortcut: 'Ctrl+1' },
  { to: '/canvas', label: '画板', icon: CanvasIcon, shortcut: 'Ctrl+2' },
  { to: '/manager', label: '图库', icon: GalleryIcon, shortcut: 'Ctrl+3' },
  { to: '/comfyui', label: 'ComfyUI 工作流', icon: WorkflowIcon, shortcut: 'Ctrl+4' },
  { to: '/tools', label: '工具箱', icon: ToolboxIcon, shortcut: 'Ctrl+5' },
  { to: '/lab', label: '提示词实验室', icon: FlaskIcon, shortcut: 'Ctrl+6' },
  { to: '/smart-canvas', label: '智能画布', icon: SmartCanvasIcon, shortcut: 'Ctrl+7' }
];

/**
 * 侧边栏 active 高亮：之前用 `layoutId="sidebar-active-bg"` 让背景胶囊在不同 nav
 * 之间"飞"——但跨距大（顶 → 底）时会从屏幕中段穿过，看着像"什么东西突然弹出来"。
 * 改成 CSS-only 的 fade，每个图标自己的高亮，不跨元素移动，就稳了。
 */
export function Sidebar(): JSX.Element {
  return (
    <aside className="mb-sidebar">
      <div className="mb-sidebar-brand" aria-label="Mengbi">
        <img
          src={logoUrl}
          alt="Mengbi"
          className="mb-sidebar-brand-img"
          draggable={false}
        />
      </div>

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
