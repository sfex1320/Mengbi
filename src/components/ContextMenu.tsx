import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import './ContextMenu.css';

export interface ContextMenuItem {
  label: string;
  /** 图标元素 */
  icon?: React.ReactNode;
  /** 用于在禁用时变灰 */
  disabled?: boolean;
  /** 关键 / 危险动作染红 */
  variant?: 'default' | 'accent' | 'danger';
  onClick: () => void;
}

interface MenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

let openMenuFn: ((s: MenuState) => void) | null = null;

/**
 * 全局唤起方法，从任何组件里直接调：
 *   openContextMenu({ x, y, items: [{ label: '复制', onClick: ... }] })
 */
export function openContextMenu(state: MenuState): void {
  if (openMenuFn) openMenuFn(state);
}

export function ContextMenuRoot(): JSX.Element | null {
  const [state, setState] = useState<MenuState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // 把 openMenuFn 挂到模块级，让 openContextMenu 能调到组件里
  const openHandler = useCallback((s: MenuState) => setState(s), []);
  useEffect(() => {
    openMenuFn = openHandler;
    return () => {
      openMenuFn = null;
    };
  }, [openHandler]);

  // 关闭：点空白 / Esc / 滚轮 / window blur
  useEffect(() => {
    if (!state) return;
    function close(): void {
      setState(null);
    }
    function onPointer(e: PointerEvent): void {
      if (menuRef.current && menuRef.current.contains(e.target as Node)) return;
      close();
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') close();
    }
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('wheel', close, { passive: true });
    window.addEventListener('blur', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('wheel', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [state]);

  if (!state) return null;

  // 防止超出右下边界：先放上，再下一帧测量纠正（简单做法）
  const VW = window.innerWidth;
  const VH = window.innerHeight;
  const MAX_W = 220;
  const APPROX_H = 38 * state.items.length + 8;
  const left = Math.min(state.x, VW - MAX_W - 8);
  const top = Math.min(state.y, VH - APPROX_H - 8);

  return createPortal(
    <div
      ref={menuRef}
      className="mb-ctxmenu"
      style={{ left, top }}
      onClick={(e) => e.stopPropagation()}
      role="menu"
    >
      {state.items.map((item, i) => (
        <button
          key={i}
          type="button"
          role="menuitem"
          className={`mb-ctxmenu-item ${
            item.variant === 'accent'
              ? 'is-accent'
              : item.variant === 'danger'
                ? 'is-danger'
                : ''
          }`}
          disabled={item.disabled}
          onClick={() => {
            if (item.disabled) return;
            setState(null);
            item.onClick();
          }}
        >
          {item.icon && <span className="mb-ctxmenu-icon">{item.icon}</span>}
          <span>{item.label}</span>
        </button>
      ))}
    </div>,
    document.body
  );
}
