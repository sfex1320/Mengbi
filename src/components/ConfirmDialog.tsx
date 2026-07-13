import { create } from 'zustand';
import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
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

/* ============ 输入弹窗（替代 window.prompt） ============
 * Electron 渲染进程从未实现 prompt()，调用即抛「prompt() is and will not be supported」
 * ——历史上 侧栏改名/网址、画板文字/快照/图层名 等 7 处因此点击无反应。
 * 用法：const name = await promptDialog({ message: '分组名称', initial: g.name });
 * 返回 null = 取消；确认返回输入串（可为空串，调用方自行 trim/校验）。 */

interface PromptDlgOptions {
  title?: string;
  message: string;
  initial?: string;
  placeholder?: string;
  okText?: string;
}

interface PromptDlgStore {
  open: boolean;
  title?: string;
  message: string;
  initial: string;
  placeholder?: string;
  okText?: string;
  resolve?: (v: string | null) => void;
  open_: (opts: PromptDlgOptions, resolve: (v: string | null) => void) => void;
  close_: (v: string | null) => void;
}

const usePromptDlgStore = create<PromptDlgStore>((set, get) => ({
  open: false,
  message: '',
  initial: '',
  open_: (opts, resolve) =>
    set({
      open: true,
      title: opts.title,
      message: opts.message,
      initial: opts.initial ?? '',
      placeholder: opts.placeholder,
      okText: opts.okText,
      resolve
    }),
  close_: (v) => {
    const { resolve } = get();
    set({ open: false, resolve: undefined });
    resolve?.(v);
  }
}));

export function promptDialog(opts: PromptDlgOptions): Promise<string | null> {
  return new Promise((resolve) => {
    usePromptDlgStore.getState().open_(opts, resolve);
  });
}

function PromptDialogView(): JSX.Element {
  const { open, title, message, initial, placeholder, okText, close_ } = usePromptDlgStore();
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // 每次打开重置为 initial 并全选（与数字输入框「聚焦全选」同规范）
  useEffect(() => {
    if (!open) return;
    setValue(initial);
    const t = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 30);
    return () => window.clearTimeout(t);
  }, [open, initial]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="mb-confirm-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onClick={() => close_(null)}
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
            <input
              ref={inputRef}
              className="mb-input mb-confirm-input"
              value={value}
              placeholder={placeholder}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                // 在输入框上处理回车/Esc（不能像 confirm 那样挂 window——会跟输入法/其它弹窗打架）
                if (e.key === 'Enter') {
                  e.preventDefault();
                  close_(value);
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  close_(null);
                }
              }}
            />
            <div className="mb-confirm-actions">
              <button type="button" className="mb-btn mb-btn-ghost mb-btn-sm" onClick={() => close_(null)}>
                取消
              </button>
              <button type="button" className="mb-btn mb-btn-sm mb-btn-primary" onClick={() => close_(value)}>
                {okText ?? '确定'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function ConfirmDialogRoot(): JSX.Element {
  // 确认弹窗 + 输入弹窗共用一个挂载根（App.tsx 只渲染 <ConfirmDialogRoot />，无需再加根组件）
  return (
    <>
      <ConfirmDialogView />
      <PromptDialogView />
    </>
  );
}

function ConfirmDialogView(): JSX.Element {
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
