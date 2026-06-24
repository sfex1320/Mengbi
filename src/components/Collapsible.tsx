/**
 * Collapsible —— 通用折叠区(全项目共享)。
 *
 * 历史:原在 src/pages/Tools/Vec/components/,2026-05-28 提升到 src/components/
 * 让 Real-ESRGAN 等面板也能复用同款折叠。
 *
 * 受控:open + onOpenChange。
 * 展开/收起用 framer-motion 的 height:auto 动画(测量目标高度,平滑不抖)。
 */
import { useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
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
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            className="mb-collapsible-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            style={{ overflow: 'hidden' }}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
