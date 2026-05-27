/**
 * OutputCard —— 右侧输出卡(v3 重设计)。
 *
 * 三态切换:
 *   1. empty   — 没有批次:显示提示文案 + 模式速查
 *   2. queue   — 有批次但未点任务行:显示批次队列(原 BatchProgressList)
 *   3. detail  — 点了某行任务:显示原图+SVG 双面板 + 元数据侧栏(原 ResultPreview)
 *
 * 切换逻辑:tasks.size === 0 → empty;selectedTaskId 为空 → queue;否则 detail
 */
import { useMemo } from 'react';
import { useVecStore } from '@/store/vecStore';
import { VecBatchProgressList } from './BatchProgressList';
import { TaskDetail } from './TaskDetail';

export function OutputCard(): JSX.Element {
  const batchCount = useVecStore((s) => s.batches.size);
  const selectedTaskId = useVecStore((s) => s.selectedTaskId);
  const task = useVecStore((s) => (selectedTaskId ? s.tasks.get(selectedTaskId) : null));
  const selectedMode = useVecStore((s) => s.selectedMode);

  const state = useMemo<'empty' | 'queue' | 'detail'>(() => {
    if (task) return 'detail';
    if (batchCount > 0) return 'queue';
    return 'empty';
  }, [task, batchCount]);

  if (state === 'empty') {
    return (
      <div className="mb-vec-output-card is-empty">
        <div className="mb-vec-output-empty">
          <div className="mb-vec-output-empty-title">暂无任务</div>
          <p className="mb-vec-output-empty-sub">
            从左侧添加图片,然后点「开始矢量化」即可。任务进度会出现在这里。
          </p>
          <ul className="mb-vec-output-empty-tips">
            <li>
              <span className="mb-vec-tip-dot is-fast" />
              <strong>Fast</strong> · 彩色图 / logo / 文化墙美陈
            </li>
            <li>
              <span className="mb-vec-tip-dot is-crisp" />
              <strong>Crisp</strong> · 单色线稿 / 广告字 / 黑白 logo
            </li>
            <li>
              <span className="mb-vec-tip-dot is-info" />
              当前已选 <strong>{modeLabel(selectedMode)}</strong>
            </li>
          </ul>
        </div>
      </div>
    );
  }

  if (state === 'queue') {
    return (
      <div className="mb-vec-output-card is-queue">
        <VecBatchProgressList />
      </div>
    );
  }

  return (
    <div className="mb-vec-output-card is-detail">
      <TaskDetail />
    </div>
  );
}

function modeLabel(m: string): string {
  return ({ vtracer: 'Fast (彩色)', potrace: 'Crisp (单色)' }[m] ?? m);
}
