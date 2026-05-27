/**
 * 历史记录抽屉 —— 列出最近 200 条 vec 任务,可按模式 / 状态过滤。
 *
 * 走 api:vec:history-list,数据来自 SQLite vectorize_history 表。
 */
import { useEffect, useState } from 'react';
import { toast } from '@/store/toastStore';
import { XIcon, FolderIcon } from '@/components/Icon';
import type { VecHistoryRow, VecMode } from '@/types/ipc';
import { EngineBadge } from './components/EngineBadge';
import { QualityScoreBadge } from './components/QualityScoreBadge';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function VecHistoryDrawer({ open, onClose }: Props): JSX.Element | null {
  const [rows, setRows] = useState<VecHistoryRow[]>([]);
  const [mode, setMode] = useState<VecMode | ''>('');
  const [status, setStatus] = useState<'succeeded' | 'failed' | 'cancelled' | ''>('');
  const [fellBackOnly, setFellBackOnly] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    void window.electronAPI.vec
      .historyList({
        filter: {
          mode: mode || undefined,
          status: status || undefined,
          fellBackOnly: fellBackOnly || undefined,
          limit: 200
        }
      })
      .then((r) => {
        if (r.ok) setRows(r.data);
        else toast.error('加载历史失败', r.error.message);
      })
      .finally(() => setLoading(false));
  }, [open, mode, status, fellBackOnly]);

  if (!open) return null;

  async function clearAll(): Promise<void> {
    if (!confirm('确认清空全部矢量化历史?(SVG 文件不会删除,只删数据库记录)')) return;
    const r = await window.electronAPI.vec.historyClear({});
    if (r.ok) {
      toast.info('已清空', `删除了 ${r.data.deleted} 条记录`);
      setRows([]);
    } else {
      toast.error('清空失败', r.error.message);
    }
  }

  return (
    <aside className="mb-vec-history-drawer" role="dialog" aria-label="矢量化历史">
      <header className="mb-vec-history-header">
        <h3>矢量化历史</h3>
        <button type="button" className="mb-btn mb-btn-ghost mb-btn-xs" onClick={onClose}>
          <XIcon size={12} />
        </button>
      </header>
      <div className="mb-vec-history-filters">
        <select value={mode} onChange={(e) => setMode(e.target.value as VecMode | '')}>
          <option value="">所有模式</option>
          <option value="vtracer">VTracer</option>
          <option value="potrace">Potrace</option>
          <option value="autotrace">AutoTrace</option>
          <option value="starvector">StarVector</option>
          <option value="experimental">实验精修</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="">所有状态</option>
          <option value="succeeded">成功</option>
          <option value="failed">失败</option>
          <option value="cancelled">已取消</option>
        </select>
        <label className="mb-vec-history-fellback-toggle">
          <input
            type="checkbox"
            checked={fellBackOnly}
            onChange={(e) => setFellBackOnly(e.target.checked)}
          />
          <span>仅看已回退</span>
        </label>
        <button type="button" className="mb-btn mb-btn-ghost mb-btn-xs" onClick={() => void clearAll()}>
          清空记录
        </button>
      </div>
      <div className="mb-vec-history-body">
        {loading ? (
          <p>加载中…</p>
        ) : rows.length === 0 ? (
          <p>暂无记录</p>
        ) : (
          <ul className="mb-vec-history-list">
            {rows.map((r) => (
              <li key={r.id} className={`mb-vec-history-row is-${r.status}`}>
                <div className="mb-vec-history-row-main">
                  <EngineBadge
                    requestedMode={r.requestedMode ?? r.mode}
                    actualEngine={r.actualEngine ?? r.mode}
                    fellBack={r.fellBack}
                    fallbackReason={r.fallbackReason}
                  />
                  <span className="mb-vec-history-input">{r.inputPath.split(/[\\/]/).pop()}</span>
                  <span className="mb-vec-history-time">{formatDate(r.createdAt)}</span>
                </div>
                <div className="mb-vec-history-row-sub">
                  <QualityScoreBadge score={r.qualityScore} size="xs" />
                  <span>{(r.durationMs / 1000).toFixed(1)}s</span>
                  {r.fallbackReason && (
                    <span className="mb-vec-history-fellback" title={r.fallbackReason}>
                      回退
                    </span>
                  )}
                  {r.error && <span className="mb-vec-history-error">{r.error}</span>}
                  {r.reportPath && (
                    <button
                      type="button"
                      className="mb-btn mb-btn-ghost mb-btn-xs"
                      onClick={() => void window.electronAPI.vec.debugOpen({ reportDir: r.reportPath! })}
                      title="打开调试目录"
                    >
                      调试
                    </button>
                  )}
                  {r.status === 'succeeded' && (
                    <button
                      type="button"
                      className="mb-btn mb-btn-ghost mb-btn-xs"
                      onClick={() => void window.electronAPI.storage.showInFolder(r.outputPath)}
                    >
                      <FolderIcon size={10} />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}
