/**
 * 批量任务进度列表(v3 重构)。
 *
 * 每行一个任务,显示:
 *   - 输入文件名
 *   - EngineBadge(用户选择 vs 实际引擎)
 *   - QualityScoreBadge(0-100,有则显示)
 *   - 状态 + 进度条 + 取消按钮
 *
 * 顶部批次行:总进度 + 已回退计数 + 暂停/继续/取消按钮。
 */
import { useMemo } from 'react';
import { useVecStore } from '@/store/vecStore';
import { toast } from '@/store/toastStore';
import { XIcon } from '@/components/Icon';
import { EngineBadge } from './components/EngineBadge';
import { QualityScoreBadge } from './components/QualityScoreBadge';
import type { VecBatchView, VecTaskView } from '@/store/vecStore';

export function VecBatchProgressList(): JSX.Element {
  const batches = useVecStore((s) => s.batches);
  const tasks = useVecStore((s) => s.tasks);
  const setSelectedTaskId = useVecStore((s) => s.setSelectedTaskId);
  const removeBatch = useVecStore((s) => s.removeBatch);

  const batchArr = useMemo(
    () => Array.from(batches.values()).sort((a, b) => b.createdAt - a.createdAt),
    [batches]
  );

  if (batchArr.length === 0) {
    return <div className="mb-vec-batch-empty">暂无任务。拖入图片并点击「开始矢量化」即可。</div>;
  }

  return (
    <div className="mb-vec-batch-list">
      {batchArr.map((b) => {
        const tasksOfBatch = Array.from(tasks.values()).filter((t) => t.batchId === b.batchId);
        return (
          <BatchBlock
            key={b.batchId}
            batch={b}
            tasks={tasksOfBatch}
            onSelectTask={setSelectedTaskId}
            onDismiss={() => removeBatch(b.batchId)}
          />
        );
      })}
    </div>
  );
}

interface BatchBlockProps {
  batch: VecBatchView;
  tasks: VecTaskView[];
  onSelectTask: (id: string | null) => void;
  onDismiss: () => void;
}

function BatchBlock({ batch, tasks, onSelectTask, onDismiss }: BatchBlockProps): JSX.Element {
  async function pause(): Promise<void> {
    const r = await window.electronAPI.vec.pauseBatch({ batchId: batch.batchId });
    if (!r.ok) toast.error('暂停失败', r.error.message);
  }
  async function resume(): Promise<void> {
    const r = await window.electronAPI.vec.resumeBatch({ batchId: batch.batchId });
    if (!r.ok) toast.error('继续失败', r.error.message);
  }
  async function cancel(): Promise<void> {
    if (!confirm(`确认取消批次?剩余 ${batch.pending + batch.running} 个任务会被中止。`)) return;
    const r = await window.electronAPI.vec.cancelBatch({ batchId: batch.batchId });
    if (!r.ok) toast.error('取消失败', r.error.message);
  }

  const overall =
    batch.total === 0
      ? 0
      : Math.round((100 * (batch.succeeded + batch.failed + batch.cancelled)) / batch.total);

  return (
    <div className={`mb-vec-batch-block is-${batch.status}`}>
      <header className="mb-vec-batch-header">
        <div className="mb-vec-batch-title">
          <span className={`mb-vec-mode-chip is-${batch.requestedMode}`}>
            {batch.requestedMode.toUpperCase()}
          </span>
          <span className="mb-vec-batch-progress-text">
            {batch.succeeded + batch.failed + batch.cancelled} / {batch.total}
            {batch.etaSeconds !== null && batch.etaSeconds > 0 && ` · 剩 ~${batch.etaSeconds}s`}
            {batch.failed > 0 && (
              <span className="mb-vec-fail-flag"> · {batch.failed} 失败</span>
            )}
            {batch.fellBackCount > 0 && (
              <span className="mb-vec-fellback-flag"> · {batch.fellBackCount} 已回退</span>
            )}
          </span>
        </div>
        <div className="mb-vec-batch-actions">
          {batch.status === 'running' && (
            <button type="button" className="mb-btn mb-btn-ghost mb-btn-xs" onClick={() => void pause()}>
              暂停
            </button>
          )}
          {batch.status === 'paused' && (
            <button type="button" className="mb-btn mb-btn-primary mb-btn-xs" onClick={() => void resume()}>
              继续
            </button>
          )}
          {(batch.status === 'running' || batch.status === 'paused') && (
            <button type="button" className="mb-btn mb-btn-ghost mb-btn-xs" onClick={() => void cancel()}>
              取消批次
            </button>
          )}
          {(batch.status === 'completed' || batch.status === 'aborted') && (
            <button
              type="button"
              className="mb-btn mb-btn-ghost mb-btn-xs"
              onClick={onDismiss}
              title="从列表清掉(不删历史)"
            >
              <XIcon size={11} />
            </button>
          )}
        </div>
      </header>
      <div className="mb-vec-batch-bar">
        <div className="mb-vec-batch-bar-fill" style={{ width: `${overall}%` }} />
      </div>
      <ul className="mb-vec-task-list">
        {tasks.map((t) => (
          <TaskRow key={t.taskId} task={t} onClick={() => onSelectTask(t.taskId)} />
        ))}
      </ul>
    </div>
  );
}

function TaskRow({ task, onClick }: { task: VecTaskView; onClick: () => void }): JSX.Element {
  const baseName = task.inputPath ? task.inputPath.split(/[\\/]/).pop() : task.taskId;
  async function cancelOne(): Promise<void> {
    await window.electronAPI.vec.cancelTask({ taskId: task.taskId });
  }
  return (
    <li
      className={`mb-vec-task-row is-${task.status}`}
      onClick={onClick}
      title={task.errorMessageZh ?? task.message}
    >
      <div className="mb-vec-task-name">{baseName}</div>
      <div className="mb-vec-task-meta">
        <EngineBadge
          requestedMode={task.requestedMode}
          actualEngine={task.actualEngine}
          fellBack={task.fellBack}
          fallbackReason={task.fallbackReason}
        />
        {task.status === 'succeeded' && (
          <QualityScoreBadge score={task.qualityScore} size="xs" />
        )}
      </div>
      <div className="mb-vec-task-status">
        <span className={`mb-vec-status-dot is-${task.status}`} />
        <span>{statusLabel(task.status)}</span>
        <span className="mb-vec-task-pct">{task.progress}%</span>
      </div>
      <div className="mb-vec-task-bar">
        <div className="mb-vec-task-bar-fill" style={{ width: `${task.progress}%` }} />
      </div>
      <div className="mb-vec-task-actions">
        {(task.status === 'pending' || task.status === 'running') && (
          <button
            type="button"
            className="mb-btn mb-btn-ghost mb-btn-xs"
            onClick={(e) => {
              e.stopPropagation();
              void cancelOne();
            }}
          >
            取消
          </button>
        )}
      </div>
    </li>
  );
}

function statusLabel(s: VecTaskView['status']): string {
  switch (s) {
    case 'pending':
      return '排队中';
    case 'running':
      return '处理中';
    case 'succeeded':
      return '完成';
    case 'failed':
      return '失败';
    case 'cancelled':
      return '已取消';
  }
}
