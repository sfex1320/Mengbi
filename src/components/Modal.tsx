import { motion, AnimatePresence } from 'framer-motion';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { XIcon } from './Icon';
import './Modal.css';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  width?: number;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** 标题栏右侧、关闭按钮左边的操作区（如把「保存 / 取消」放到顶部） */
  headerActions?: React.ReactNode;
  /** 是否允许点击 backdrop 关闭，默认 false（避免误触丢失编辑数据） */
  dismissOnBackdrop?: boolean;
  /** 是否允许 Esc 关闭，默认 true */
  dismissOnEsc?: boolean;
}

export function Modal({
  open,
  onClose,
  title,
  width = 520,
  children,
  footer,
  headerActions,
  dismissOnBackdrop = false,
  dismissOnEsc = true
}: ModalProps): JSX.Element {
  useEffect(() => {
    if (!open || !dismissOnEsc) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, dismissOnEsc, onClose]);

  // 铁律 27：portal 到 body——Modal 常被渲染在带 transform 的祖先里（framer 路由过渡等），
  // fixed 会退化成相对该祖先定位 → 遮罩只盖住一截、下方内容露出还能滚动/点击（设置页三合一弹窗实测踩坑）。
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="mb-modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={() => {
            if (dismissOnBackdrop) onClose();
          }}
        >
          <motion.div
            className="mb-modal mb-card-lg"
            style={{ width }}
            initial={{ opacity: 0, scale: 0.94, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 12 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-modal-header">
              <h3>{title}</h3>
              {headerActions && <div className="mb-modal-header-actions">{headerActions}</div>}
              <button className="mb-modal-close" onClick={onClose} aria-label="关闭">
                <XIcon size={18} />
              </button>
            </div>
            <div className="mb-modal-body">{children}</div>
            {footer && <div className="mb-modal-footer">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
