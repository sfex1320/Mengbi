/**
 * Collapsible —— 通用折叠区。
 *
 * 受控:open + onOpenChange。
 * 不写动画(避免高度抖动),纯 display:none/flex 切换。
 */
import { useState, type ReactNode } from 'react';
import { ChevronDownIcon, ChevronRightIcon } from '@/components/Icon';

interface Props {
  title: ReactNode;
  /** 默认是否展开 */
  defaultOpen?: boolean;
  /** 受控展开状态;不传则内部维护 */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** 右侧次要信息(如 "3 项 / 已隐藏 N 项") */
  badge?: ReactNode;
  children: ReactNode;
}

export function Collapsible({
  title,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  badge,
  children
}: Props): JSX.Element {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isOpen = controlledOpen ?? internalOpen;
  const toggle = (): void => {
    const next = !isOpen;
    if (controlledOpen === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  };

  return (
    <div className={`mb-collapsible ${isOpen ? 'is-open' : ''}`}>
      <button
        type="button"
        className="mb-collapsible-head"
        onClick={toggle}
        aria-expanded={isOpen}
      >
        {isOpen ? <ChevronDownIcon size={11} /> : <ChevronRightIcon size={11} />}
        <span className="mb-collapsible-title">{title}</span>
        {badge !== undefined && <span className="mb-collapsible-badge">{badge}</span>}
      </button>
      {isOpen && <div className="mb-collapsible-body">{children}</div>}
    </div>
  );
}
