/**
 * CustomSelect —— 自定义深色下拉(替代原生 <select>)。
 *
 * 为什么不用 native:
 *   - native <select> 的弹出菜单走系统主题(Windows 浅色),跟 mengbi 深色 UI 严重不协调
 *   - 字体不跟 webview 走
 *   - optgroup 样式无法定制
 *
 * 行为:
 *   - 点击 head 弹 popover,popover 跟随 head 宽度
 *   - 支持 optgroup (label + items)
 *   - 键盘: ↑↓ 选中预览,Enter 确认,Esc 关闭
 *   - 受控:value + onChange
 *   - popover 用 portal 挂 body,自动 flip 上/下
 */
import {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
  type ReactNode,
  type CSSProperties
} from 'react';
import { createPortal } from 'react-dom';
import { ChevronDownIcon } from '@/components/Icon';

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  /** 右侧灰色辅助文字(分类标签 / 大小等) */
  meta?: string;
  /** 是否禁用 */
  disabled?: boolean;
  /** hover/选中后 tooltip(描述) */
  hint?: string;
}

export interface SelectOptGroup<T extends string = string> {
  /** 分组标题(灰色小字) */
  label: string;
  options: SelectOption<T>[];
}

interface Props<T extends string> {
  value: T;
  onChange: (v: T) => void;
  /** 直接给一组 options(无分组) 或一组 optgroups(有分组) */
  options?: SelectOption<T>[];
  optgroups?: SelectOptGroup<T>[];
  /** value 不在列表时显示的占位 */
  placeholder?: string;
  disabled?: boolean;
  /** 渲染单条:可拿到选项做更丰富的展示。默认渲染 label + meta */
  renderOption?: (opt: SelectOption<T>) => ReactNode;
  /** 渲染当前选中头部:可重定义,默认显示 label */
  renderHead?: (opt: SelectOption<T> | null) => ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function CustomSelect<T extends string>({
  value,
  onChange,
  options,
  optgroups,
  placeholder = '请选择…',
  disabled,
  renderOption,
  renderHead,
  className,
  style
}: Props<T>): JSX.Element {
  const [open, setOpen] = useState(false);
  const [hoverIdx, setHoverIdx] = useState(-1);
  const headRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [popStyle, setPopStyle] = useState<CSSProperties>({});

  // 拍平 (group, options) 成单一可迭代列表(用于键盘导航)
  const flatList = useMemo<SelectOption<T>[]>(() => {
    if (optgroups) return optgroups.flatMap((g) => g.options);
    return options ?? [];
  }, [options, optgroups]);

  const selectedOpt = useMemo(
    () => flatList.find((o) => o.value === value) ?? null,
    [flatList, value]
  );

  const updatePosition = useCallback(() => {
    if (!headRef.current) return;
    const rect = headRef.current.getBoundingClientRect();
    const viewportH = window.innerHeight;
    const spaceBelow = viewportH - rect.bottom;
    const spaceAbove = rect.top;
    const flipUp = spaceBelow < 280 && spaceAbove > spaceBelow;
    if (flipUp) {
      setPopStyle({
        position: 'fixed',
        bottom: viewportH - rect.top + 4,
        left: rect.left,
        width: rect.width,
        maxHeight: Math.min(360, spaceAbove - 12)
      });
    } else {
      setPopStyle({
        position: 'fixed',
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
        maxHeight: Math.min(360, spaceBelow - 12)
      });
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, updatePosition]);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent): void {
      if (!popRef.current || !headRef.current) return;
      const t = e.target as Node;
      if (!popRef.current.contains(t) && !headRef.current.contains(t)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  // 键盘
  const onKey = useCallback(
    (e: React.KeyboardEvent): void => {
      if (e.key === 'Enter' || e.key === ' ') {
        if (!open) {
          setOpen(true);
          e.preventDefault();
          return;
        }
        if (hoverIdx >= 0 && hoverIdx < flatList.length) {
          const opt = flatList[hoverIdx];
          if (!opt.disabled) {
            onChange(opt.value);
            setOpen(false);
            e.preventDefault();
          }
        }
      } else if (e.key === 'Escape') {
        setOpen(false);
      } else if (e.key === 'ArrowDown') {
        if (!open) setOpen(true);
        setHoverIdx((i) => Math.min(i + 1, flatList.length - 1));
        e.preventDefault();
      } else if (e.key === 'ArrowUp') {
        if (!open) setOpen(true);
        setHoverIdx((i) => Math.max(i - 1, 0));
        e.preventDefault();
      }
    },
    [open, hoverIdx, flatList, onChange]
  );

  function onSelect(opt: SelectOption<T>): void {
    if (opt.disabled) return;
    onChange(opt.value);
    setOpen(false);
  }

  // popover 内容 — 渲染 grouped 或 flat
  function renderItems(items: SelectOption<T>[], baseIdx: number): ReactNode {
    return items.map((opt, i) => {
      const idx = baseIdx + i;
      const active = opt.value === value;
      const hover = idx === hoverIdx;
      return (
        <button
          key={opt.value}
          type="button"
          role="option"
          aria-selected={active}
          aria-disabled={opt.disabled}
          className={`mb-cs-item ${active ? 'is-active' : ''} ${hover ? 'is-hover' : ''} ${opt.disabled ? 'is-disabled' : ''}`}
          onClick={() => onSelect(opt)}
          onMouseEnter={() => setHoverIdx(idx)}
          title={opt.hint}
        >
          <span className="mb-cs-item-content">
            {renderOption ? (
              renderOption(opt)
            ) : (
              <>
                <span className="mb-cs-item-label">{opt.label}</span>
                {opt.meta && <span className="mb-cs-item-meta">{opt.meta}</span>}
              </>
            )}
          </span>
        </button>
      );
    });
  }

  function renderPopover(): ReactNode {
    let cursor = 0;
    return (
      <div
        ref={popRef}
        role="listbox"
        className="mb-cs-popover"
        style={popStyle}
      >
        {optgroups
          ? optgroups.map((g) => {
              const block = (
                <div key={g.label} className="mb-cs-group">
                  <div className="mb-cs-group-title">{g.label}</div>
                  {renderItems(g.options, cursor)}
                </div>
              );
              cursor += g.options.length;
              return block;
            })
          : renderItems(options ?? [], 0)}
      </div>
    );
  }

  return (
    <>
      <button
        ref={headRef}
        type="button"
        className={`mb-cs-head ${open ? 'is-open' : ''} ${disabled ? 'is-disabled' : ''} ${className ?? ''}`}
        style={style}
        onClick={() => !disabled && setOpen((v) => !v)}
        onKeyDown={onKey}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="mb-cs-head-content">
          {renderHead
            ? renderHead(selectedOpt)
            : selectedOpt
              ? selectedOpt.label
              : <span className="mb-cs-placeholder">{placeholder}</span>}
        </span>
        <ChevronDownIcon size={12} />
      </button>
      {open && createPortal(renderPopover(), document.body)}
    </>
  );
}
