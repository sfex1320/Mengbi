import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNotificationStore, selectUnreadFailureCount, type NotificationEntry } from '@/store/notificationStore';
import { labelForChannel } from '@/lib/operationLabels';
import { BellIcon, CheckIcon, XIcon, TrashIcon } from '@/components/Icon';
import { confirmDialog } from '@/components/ConfirmDialog';
import { toast } from '@/store/toastStore';
import './NotificationCenter.css';

/**
 * 通知中心：常驻的"操作日志"。
 * - 铃铛按钮放头部右上角；有未读失败时显示红色 badge。
 * - 点开 popover 面板（沿用 ThemePicker 的形态），列出最近 200 条写动作记录。
 * - 详见 plans/concurrent-soaring-puffin.md。
 */
export function NotificationCenter(): JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const entries = useNotificationStore((s) => s.entries);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const clearAll = useNotificationStore((s) => s.clear);
  const unread = useNotificationStore(selectUnreadFailureCount);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  function handleToggle(): void {
    setOpen((v) => {
      const next = !v;
      if (next) markAllRead();
      return next;
    });
  }

  async function handleClear(): Promise<void> {
    if (entries.length === 0) return;
    const ok = await confirmDialog({
      title: '清空操作记录',
      message: '确定要清空所有操作记录吗？',
      detail: '此操作不可撤销 —— 通知中心会回到全空状态。',
      okText: '清空',
      cancelText: '取消',
      danger: true
    });
    if (ok) clearAll();
  }

  return (
    <div ref={ref} className="mb-notif-root">
      <button
        onClick={handleToggle}
        className="mb-notif-trigger"
        aria-label="通知中心"
        title="通知中心"
      >
        <BellIcon size={18} />
        {unread > 0 && (
          <span className="mb-notif-badge" aria-label={`${unread} 条未读失败`}>
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="mb-notif-panel"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.18 }}
          >
            <header className="mb-notif-panel-header">
              <span className="mb-notif-panel-title">通知中心</span>
              <div className="mb-notif-panel-actions">
                <button
                  className="mb-notif-panel-action"
                  onClick={() => void handleClear()}
                  disabled={entries.length === 0}
                  title="清空记录"
                >
                  <TrashIcon size={14} />
                  清空
                </button>
              </div>
            </header>
            <div className="mb-notif-panel-body">
              {entries.length === 0 ? (
                <div className="mb-notif-empty">暂无操作记录</div>
              ) : (
                <ul className="mb-notif-list">
                  {entries.map((entry) => (
                    <NotificationRow key={entry.id} entry={entry} />
                  ))}
                </ul>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function NotificationRow({ entry }: { entry: NotificationEntry }): JSX.Element {
  const label = labelForChannel(entry.channel);
  const time = formatRelativeTime(entry.ts);
  const remedy = entry.remedy;
  const [fixed, setFixed] = useState(false);
  const [busy, setBusy] = useState(false);

  async function applyFix(): Promise<void> {
    if (!remedy || busy) return;
    setBusy(true);
    try {
      const r = await window.electronAPI.settings.applyOverrides({
        modelId: remedy.modelId,
        bodyMerge: remedy.bodyMerge,
        headerMerge: remedy.headerMerge
      });
      if (r.ok) {
        setFixed(true);
        toast.success('已修复', `「${remedy.label}」已写入${r.data.providerName ? `「${r.data.providerName}」` : ''}该模型，重新生成即可生效`);
      } else {
        toast.error('修复失败', r.error.message);
      }
    } catch (e) {
      toast.error('修复失败', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li
      className={`mb-notif-row mb-notif-row-${entry.kind}`}
      title={entry.hint ?? ''}
    >
      <span className="mb-notif-row-icon" aria-hidden="true">
        {entry.kind === 'success' ? (
          <CheckIcon size={14} />
        ) : entry.kind === 'failure' ? (
          <XIcon size={14} />
        ) : (
          <BellIcon size={14} />
        )}
      </span>
      <div className="mb-notif-row-body">
        <div className="mb-notif-row-head">
          <span className="mb-notif-row-label">{label}</span>
          <span className="mb-notif-row-time">{time}</span>
        </div>
        {entry.kind === 'failure' && (
          <div className="mb-notif-row-detail">
            {entry.errorCode && (
              <span className="mb-notif-row-code">[{entry.errorCode}]</span>
            )}
            {entry.message && (
              <span className="mb-notif-row-msg">{entry.message}</span>
            )}
          </div>
        )}
        {entry.kind === 'info' && entry.message && (
          <div className="mb-notif-row-detail">
            <span className="mb-notif-row-msg">{entry.message}</span>
          </div>
        )}
        {entry.hint && entry.kind === 'failure' && (
          <div className="mb-notif-row-hint">{entry.hint}</div>
        )}
        {remedy && entry.kind === 'failure' && (
          <button
            type="button"
            className="mb-notif-row-fix"
            disabled={busy || fixed}
            title={remedy.detail ?? remedy.label}
            onClick={() => void applyFix()}
          >
            {fixed ? '✓ 已修复，重新生成即可' : busy ? '修复中…' : `🔧 一键修复：${remedy.label}`}
          </button>
        )}
      </div>
    </li>
  );
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 0) return '刚刚';
  const sec = Math.floor(diff / 1000);
  if (sec < 10) return '刚刚';
  if (sec < 60) return `${sec} 秒前`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} 天前`;
  const d = new Date(ts);
  const m = d.getMonth() + 1;
  return `${m}月${d.getDate()}日`;
}
