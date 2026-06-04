import { motion, AnimatePresence } from 'framer-motion';
import { useEffect } from 'react';
import { XIcon } from './Icon';
import './Modal.css';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  width?: number;
  children: React.ReactNode;
  footer?: React.ReactNode;
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

  return (
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
              <button className="mb-modal-close" onClick={onClose} aria-label="关闭">
                <XIcon size={18} />
              </button>
            </div>
            <div className="mb-modal-body">{children}</div>
            {footer && <div className="mb-modal-footer">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
