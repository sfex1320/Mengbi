import { useSnapshotStore } from '@/store/snapshotStore';
import { toast } from '@/store/toastStore';
import { promptDialog } from '@/components/ConfirmDialog';

/**
 * 历史 / 快照对话框（需求十三节）。
 * 列出所有命名快照（手动 + AI/PS 前自动），支持回到某步 / 删除 / 清空 / 新建。
 * 细粒度逐步撤销仍走 Ctrl+Z（工具栏的撤销/重做）。
 */
export function HistoryPanel({ onClose }: { onClose: () => void }): JSX.Element {
  const snapshots = useSnapshotStore((s) => s.snapshots);
  const save = useSnapshotStore((s) => s.save);
  const restore = useSnapshotStore((s) => s.restore);
  const remove = useSnapshotStore((s) => s.remove);
  const clear = useSnapshotStore((s) => s.clear);

  return (
    <div className="mb-modal-backdrop" onClick={onClose}>
      <div className="mb-modal mb-history-panel" onClick={(e) => e.stopPropagation()}>
        <h3>历史快照</h3>
        <p className="mb-mask-rule">命名还原点（手动 + AI/PS 前自动）。逐步撤销请用 Ctrl+Z。</p>

        <div className="mb-canvas-props-btnrow">
          <button
            type="button"
            className="mb-canvas-props-actionbtn is-accent"
            onClick={() =>
              void promptDialog({ message: '快照名称', initial: `快照 ${snapshots.length + 1}` }).then((label) => {
                if (label && label.trim()) {
                  save(label.trim());
                  toast.success('已保存快照');
                }
              })
            }
          >
            ＋ 保存当前快照
          </button>
          {snapshots.length > 0 && (
            <button type="button" className="mb-canvas-props-actionbtn is-danger" onClick={clear}>
              清空
            </button>
          )}
        </div>

        <div className="mb-history-list">
          {snapshots.length === 0 && <div className="mb-canvas-props-empty">暂无快照</div>}
          {snapshots.map((s) => (
            <div key={s.id} className="mb-history-item">
              <div className="mb-history-meta">
                <span className="mb-history-label">{s.label}</span>
                <span className="mb-history-time">
                  {new Date(s.ts).toLocaleTimeString()} · {s.project.layers.length} 层 · {s.project.width}×
                  {s.project.height}
                </span>
              </div>
              <div className="mb-history-actions">
                <button
                  type="button"
                  className="mb-canvas-props-actionbtn"
                  onClick={() => {
                    restore(s.id);
                    toast.success('已回到该快照', s.label);
                  }}
                >
                  回到此步
                </button>
                <button type="button" className="mb-canvas-props-actionbtn is-danger" onClick={() => remove(s.id)}>
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="mb-modal-actions">
          <button type="button" className="mb-btn" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
