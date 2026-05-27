/**
 * TaskDetail —— 单个任务详情面板(v3 重设计)。
 *
 * 顶部:[← 返回队列] + 任务名 + 切换上一/下一任务
 * 主区:左原图 / 右 SVG 双面板对比(各占一半,可放缩)
 * 底部元数据:Engine / Quality / 耗时 / 路径 / 颜色 / 节点
 * 工具栏:复制 SVG / 文件夹 / 浏览器 / 查看调试
 * 失败态:替换主区为错误信息卡
 * 回退态:顶部 FallbackBanner
 */
import { useEffect, useMemo, useState } from 'react';
import { useVecStore } from '@/store/vecStore';
import { toast } from '@/store/toastStore';
import {
  FolderIcon,
  CopyIconShape,
  XIcon,
  WrenchIcon,
  ChevronRightIcon
} from '@/components/Icon';
import { EngineBadge } from './components/EngineBadge';
import { QualityScoreBadge } from './components/QualityScoreBadge';
import { FallbackBanner } from './components/FallbackBanner';
import type { VecReport } from '@/types/ipc';

export function TaskDetail(): JSX.Element {
  const selectedTaskId = useVecStore((s) => s.selectedTaskId);
  const setSelectedTaskId = useVecStore((s) => s.setSelectedTaskId);
  const tasks = useVecStore((s) => s.tasks);
  const task = selectedTaskId ? tasks.get(selectedTaskId) ?? null : null;

  // 同批次任务索引(用于上一/下一)
  const batchTasks = useMemo(() => {
    if (!task) return [];
    return Array.from(tasks.values())
      .filter((t) => t.batchId === task.batchId)
      .sort((a, b) => a.taskId.localeCompare(b.taskId));
  }, [task, tasks]);
  const idx = task ? batchTasks.findIndex((t) => t.taskId === task.taskId) : -1;

  const [svgText, setSvgText] = useState('');
  const [report, setReport] = useState<VecReport | null>(null);

  useEffect(() => {
    setSvgText('');
    setReport(null);
    if (!task || task.status !== 'succeeded' || !task.outputPath) return;
    const url = filePathToUrl(task.outputPath);
    fetch(url)
      .then((r) => r.text())
      .then(setSvgText)
      .catch(() => setSvgText(''));
    if (task.reportDir) {
      void window.electronAPI.vec
        .reportGet({ reportDir: task.reportDir })
        .then((r) => {
          if (r.ok) setReport(r.data);
        })
        .catch(() => {});
    }
  }, [task]);

  if (!task) {
    return <div className="mb-vec-detail-empty">未选中任务</div>;
  }

  const baseName = task.inputPath ? task.inputPath.split(/[\\/]/).pop() : task.taskId;

  async function copy(): Promise<void> {
    if (!svgText) return;
    try {
      await navigator.clipboard.writeText(svgText);
      toast.success('已复制', 'SVG 源代码已复制到剪贴板');
    } catch {
      toast.error('复制失败', '剪贴板访问被拒');
    }
  }

  return (
    <div className="mb-vec-detail">
      {/* 顶部条:返回 + 文件名 + 上下切换 */}
      <header className="mb-vec-detail-head">
        <button
          type="button"
          className="mb-btn mb-btn-ghost mb-btn-sm"
          onClick={() => setSelectedTaskId(null)}
          title="返回队列"
        >
          <XIcon size={12} /> 返回队列
        </button>
        <div className="mb-vec-detail-title" title={task.inputPath}>
          {baseName}
        </div>
        {batchTasks.length > 1 && (
          <div className="mb-vec-detail-nav">
            <button
              type="button"
              className="mb-btn mb-btn-ghost mb-btn-xs"
              disabled={idx <= 0}
              onClick={() => idx > 0 && setSelectedTaskId(batchTasks[idx - 1].taskId)}
              title="上一个"
            >
              <ChevronRightIcon size={11} style={{ transform: 'rotate(180deg)' }} />
            </button>
            <span className="mb-vec-detail-counter">
              {idx + 1} / {batchTasks.length}
            </span>
            <button
              type="button"
              className="mb-btn mb-btn-ghost mb-btn-xs"
              disabled={idx >= batchTasks.length - 1}
              onClick={() => idx < batchTasks.length - 1 && setSelectedTaskId(batchTasks[idx + 1].taskId)}
              title="下一个"
            >
              <ChevronRightIcon size={11} />
            </button>
          </div>
        )}
      </header>

      {/* 回退横幅 */}
      {task.fellBack && (
        <FallbackBanner
          requestedMode={task.requestedMode}
          actualEngine={task.actualEngine}
          reason={task.fallbackReason}
          reportDir={task.reportDir}
        />
      )}

      {/* 主区 */}
      {task.status === 'succeeded' && task.outputPath ? (
        <>
          <div className="mb-vec-detail-compare">
            <div className="mb-vec-detail-pane">
              <div className="mb-vec-detail-pane-label">原图</div>
              <div className="mb-vec-detail-pane-frame">
                <img src={filePathToUrl(task.inputPath)} alt="原图" />
              </div>
            </div>
            <div className="mb-vec-detail-pane">
              <div className="mb-vec-detail-pane-label">矢量结果</div>
              <div className="mb-vec-detail-pane-frame is-checker">
                <object data={filePathToUrl(task.outputPath)} type="image/svg+xml" aria-label="SVG 预览" />
              </div>
            </div>
          </div>

          {/* 元数据条 */}
          <div className="mb-vec-detail-meta">
            <div className="mb-vec-detail-meta-row">
              <EngineBadge
                requestedMode={task.requestedMode}
                actualEngine={task.actualEngine}
                fellBack={task.fellBack}
                fallbackReason={task.fallbackReason}
                size="md"
              />
              <QualityScoreBadge score={task.qualityScore} size="md" />
              <span className="mb-vec-detail-meta-item">
                <em>耗时</em> {((task.durationMs ?? 0) / 1000).toFixed(1)}s
              </span>
              {report && (
                <>
                  <span className="mb-vec-detail-meta-item">
                    <em>路径</em> {report.svgPathCount}
                  </span>
                  <span className="mb-vec-detail-meta-item">
                    <em>颜色</em> {report.svgColorCount}
                  </span>
                  <span className="mb-vec-detail-meta-item">
                    <em>节点</em> {report.svgNodeCount}
                  </span>
                </>
              )}
            </div>
            {report?.userSuggestion && (
              <div className="mb-vec-detail-suggestion">💡 {report.userSuggestion}</div>
            )}
          </div>

          {/* 工具栏 */}
          <div className="mb-vec-detail-actions">
            <button
              type="button"
              className="mb-btn mb-btn-ghost mb-btn-sm"
              onClick={() => void copy()}
              disabled={!svgText}
            >
              <CopyIconShape size={12} /> 复制 SVG
            </button>
            <button
              type="button"
              className="mb-btn mb-btn-ghost mb-btn-sm"
              onClick={() => void window.electronAPI.storage.showInFolder(task.outputPath!)}
            >
              <FolderIcon size={12} /> 文件夹
            </button>
            <button
              type="button"
              className="mb-btn mb-btn-ghost mb-btn-sm"
              onClick={() => void window.electronAPI.storage.openUrl(filePathToUrl(task.outputPath!))}
            >
              浏览器打开
            </button>
            {task.reportDir && (
              <button
                type="button"
                className="mb-btn mb-btn-ghost mb-btn-sm"
                onClick={() => void window.electronAPI.vec.debugOpen({ reportDir: task.reportDir! })}
                title="打开 userData/vec-debug/<ts>/"
              >
                <WrenchIcon size={12} /> 查看调试
              </button>
            )}
          </div>
        </>
      ) : task.status === 'failed' ? (
        <div className="mb-vec-detail-fail">
          <div className="mb-vec-detail-fail-title">任务失败</div>
          {task.errorMessageZh && <p className="mb-vec-detail-fail-msg">{task.errorMessageZh}</p>}
          {task.errorHint && <p className="mb-vec-detail-fail-hint">{task.errorHint}</p>}
          {task.errorTag && <p className="mb-vec-detail-fail-tag">错误码: {task.errorTag}</p>}
          {task.reportDir && (
            <button
              type="button"
              className="mb-btn mb-btn-ghost mb-btn-sm"
              onClick={() => void window.electronAPI.vec.debugOpen({ reportDir: task.reportDir! })}
            >
              <WrenchIcon size={12} /> 打开调试目录
            </button>
          )}
        </div>
      ) : (
        <div className="mb-vec-detail-running">
          <div className="mb-vec-detail-running-text">{task.message}</div>
          <div className="mb-vec-detail-running-bar">
            <div className="mb-vec-detail-running-bar-fill" style={{ width: `${task.progress}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}

function filePathToUrl(p: string): string {
  const normalized = p.replace(/\\/g, '/');
  return normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`;
}
