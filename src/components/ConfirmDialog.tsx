import { create } from 'zustand';
import { motion, AnimatePresence } from 'framer-motion';
import { useEffect } from 'react';
import './ConfirmDialog.css';

/**
 * 全局命令式确认弹窗——替换原生 confirm() / window.confirm，
 * 让风格与产品其余 UI 一致。
 *
 *   const ok = await confirmDialog({ message: '删除这条记录？', danger: true });
 *
 * 使用步骤：
 *   1. App.tsx 里渲染 <ConfirmDialogRoot />
 *   2. 任意地方调用 confirmDialog(...) 即可拿到 Promise<boolean>
 */

interface ConfirmOptions {
  title?: string;
  message: string;
  detail?: string;
  okText?: string;
  cancelText?: string;
  /** 危险操作 → 主按钮变红 */
  danger?: boolean;
}

interface ConfirmState extends ConfirmOptions {
  open: boolean;
  resolve?: (v: boolean) => void;
}

interface ConfirmStore extends ConfirmState {
  open_: (opts: ConfirmOptions, resolve: (v: boolean) => void) => void;
  close_: (v: boolean) => void;
}

const useConfirmStore = create<ConfirmStore>((set, get) => ({
  open: false,
  message: '',
  open_: (opts, resolve) =>
    set({
      open: true,
      title: opts.title,
      message: opts.message,
      detail: opts.detail,
      okText: opts.okText,
      cancelText: opts.cancelText,
      danger: opts.danger,
      resolve
    }),
  close_: (v) => {
    const { resolve } = get();
    set({ open: false, resolve: undefined });
    resolve?.(v);
  }
}));

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    useConfirmStore.getState().open_(opts, resolve);
  });
}

export function ConfirmDialogRoot(): JSX.Element {
  const {
    open,
    title,
    message,
    detail,
    okText,
    cancelText,
    danger,
    close_
  } = useConfirmStore();

  // Esc / Enter 快捷键
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault();
        close_(false);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        close_(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close_]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="mb-confirm-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onClick={() => close_(false)}
        >
          <motion.div
            className="mb-confirm mb-card-lg"
            initial={{ opacity: 0, scale: 0.94, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 12 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
          >
            {title && <h3 className="mb-confirm-title">{title}</h3>}
            <div className="mb-confirm-message">{message}</div>
            {detail && <div className="mb-confirm-detail">{detail}</div>}
            <div className="mb-confirm-actions">
              <button
                type="button"
                className="mb-btn mb-btn-ghost mb-btn-sm"
                onClick={() => close_(false)}
              >
                {cancelText ?? '取消'}
              </button>
              <button
                type="button"
                autoFocus
                className={`mb-btn mb-btn-sm ${
                  danger ? 'mb-btn-danger' : 'mb-btn-primary'
                }`}
                onClick={() => close_(true)}
              >
                {okText ?? '确定'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
