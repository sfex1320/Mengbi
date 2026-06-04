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
  /** 二级菜单：有 children 时点击不触发 onClick，而是展开右侧子菜单 */
  children?: ContextMenuEntry[];
  /** 可选 onClick（有 children 时通常忽略） */
  onClick?: () => void;
}

/** 分隔线：在 items 数组里插入 `{ separator: true }` 即渲染一条细线 */
export interface ContextMenuSeparator {
  separator: true;
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator;

function isSeparator(e: ContextMenuEntry): e is ContextMenuSeparator {
  return (e as ContextMenuSeparator).separator === true;
}

interface MenuState {
  x: number;
  y: number;
  items: ContextMenuEntry[];
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

  const VW = window.innerWidth;
  const VH = window.innerHeight;
  const MAX_W = 240;
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
      <MenuList
        items={state.items}
        onCloseAll={() => setState(null)}
      />
    </div>,
    document.body
  );
}

/**
 * 渲染菜单项列表 —— 抽出来是为了递归挂二级菜单。
 * 一级和二级都用这个组件，二级菜单在 hover 时通过 portal 绝对定位渲染。
 */
function MenuList({
  items,
  onCloseAll
}: {
  items: ContextMenuEntry[];
  onCloseAll: () => void;
}): JSX.Element {
  // 当前被 hover / 点开的二级菜单 index（-1 = 关闭）
  const [openSub, setOpenSub] = useState<number>(-1);
  // 子菜单位置（屏幕坐标）
  const [subPos, setSubPos] = useState<{ left: number; top: number } | null>(null);
  // hover delay：移出主项不立刻关，避免穿越间隙
  const closeTimerRef = useRef<number | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function clearCloseTimer(): void {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }

  function openSubmenu(i: number): void {
    clearCloseTimer();
    const btn = itemRefs.current[i];
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const VW = window.innerWidth;
    const VH = window.innerHeight;
    const SUB_W = 240;
    // 优先放右边；屏幕右边没地方就放左边
    let left = rect.right + 4;
    if (left + SUB_W > VW - 8) left = Math.max(8, rect.left - SUB_W - 4);
    // 子菜单顶部对齐主项顶部；超过底部就上移
    const item = items[i];
    const childrenCount =
      !isSeparator(item) && item.children ? item.children.length : 4;
    const approxH = childrenCount * 34 + 8;
    const top = Math.min(rect.top, VH - approxH - 8);
    setSubPos({ left, top });
    setOpenSub(i);
  }

  function scheduleClose(): void {
    clearCloseTimer();
    // 140ms：足够从主项移到子菜单（进入子菜单会 clearCloseTimer），又比 200ms 更跟手、少闪
    closeTimerRef.current = window.setTimeout(() => {
      setOpenSub(-1);
      setSubPos(null);
    }, 140);
  }

  return (
    <>
      {items.map((entry, i) => {
        if (isSeparator(entry)) {
          return <div key={i} className="mb-ctxmenu-sep" role="separator" />;
        }
        const item = entry;
        const hasChildren = !!item.children && item.children.length > 0;
        const variantCls =
          item.variant === 'accent'
            ? 'is-accent'
            : item.variant === 'danger'
              ? 'is-danger'
              : '';
        return (
          <button
            key={i}
            ref={(el) => (itemRefs.current[i] = el)}
            type="button"
            role="menuitem"
            className={`mb-ctxmenu-item ${variantCls} ${hasChildren ? 'has-sub' : ''} ${openSub === i ? 'is-sub-open' : ''}`}
            disabled={item.disabled}
            onMouseEnter={() => {
              if (hasChildren && !item.disabled) openSubmenu(i);
              else {
                // 离开有 sub 的项才关
                if (openSub !== -1) scheduleClose();
              }
            }}
            onClick={() => {
              if (item.disabled) return;
              if (hasChildren) {
                // 已展开就收起；未展开就展开
                if (openSub === i) {
                  setOpenSub(-1);
                  setSubPos(null);
                } else {
                  openSubmenu(i);
                }
                return;
              }
              onCloseAll();
              item.onClick?.();
            }}
          >
            {item.icon && <span className="mb-ctxmenu-icon">{item.icon}</span>}
            <span className="mb-ctxmenu-label">{item.label}</span>
            {hasChildren && <span className="mb-ctxmenu-caret">›</span>}
          </button>
        );
      })}

      {openSub !== -1 &&
        subPos &&
        (() => {
          const cur = items[openSub];
          if (isSeparator(cur) || !cur.children) return null;
          return createPortal(
            <div
              className="mb-ctxmenu mb-ctxmenu-sub"
              style={{ left: subPos.left, top: subPos.top }}
              role="menu"
              onMouseEnter={() => clearCloseTimer()}
              onMouseLeave={() => scheduleClose()}
              onClick={(e) => e.stopPropagation()}
            >
              <MenuList items={cur.children} onCloseAll={onCloseAll} />
            </div>,
            document.body
          );
        })()}
    </>
  );
}
