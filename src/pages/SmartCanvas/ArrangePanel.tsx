import { useState } from 'react';
import { useSmartCanvasStore } from '@/store/smartCanvasStore';
import { LayoutIcon, RowsIcon, DistributeHIcon, DistributeVIcon, RunAllIcon } from './icons';

/** 排布弹窗（画布右下角）：网格 / 按类型 / 对齐选中 / 均分。带图标，加大避免文字显示不全。 */
export function ArrangePanel({ onClose }: { onClose: () => void }): JSX.Element {
  const arrangeGrid = useSmartCanvasStore((s) => s.arrangeGrid);
  const arrangeByType = useSmartCanvasStore((s) => s.arrangeByType);
  const arrangeSmart = useSmartCanvasStore((s) => s.arrangeSmart);
  const alignSelected = useSmartCanvasStore((s) => s.alignSelected);
  const distributeSelected = useSmartCanvasStore((s) => s.distributeSelected);
  const [cols, setCols] = useState(4);
  const [gap, setGap] = useState(48);

  return (
    <div className="mb-sc-arrange mb-card">
      <div className="mb-sc-arrange-title">
        <span>排布</span>
        <button className="mb-sc-node-x" onClick={onClose} title="关闭">
          ✕
        </button>
      </div>

      <div className="mb-sc-arrange-grid2">
        <label className="mb-sc-arrange-field">
          <span>列数</span>
          <input
            className="mb-input"
            type="number"
            min={1}
            max={12}
            value={cols}
            onChange={(e) => setCols(Math.max(1, Math.min(12, Number(e.target.value) || 1)))}
          />
        </label>
        <label className="mb-sc-arrange-field">
          <span>间距</span>
          <input
            className="mb-input"
            type="number"
            min={0}
            max={400}
            value={gap}
            onChange={(e) => setGap(Math.max(0, Math.min(400, Number(e.target.value) || 0)))}
          />
        </label>
      </div>

      <button className="mb-btn mb-btn-sm mb-btn-primary mb-sc-arrange-smart" onClick={() => arrangeSmart(gap)}>
        <RunAllIcon size={13} />
        智能排布（按工作流走向 · 上游左 → 下游右）
      </button>

      <div className="mb-sc-arrange-row2">
        <button className="mb-btn mb-btn-sm mb-sc-tbtn" onClick={() => arrangeGrid(cols, gap)}>
          <LayoutIcon size={14} />
          网格排布
        </button>
        <button className="mb-btn mb-btn-sm mb-sc-tbtn" onClick={() => arrangeByType(gap)}>
          <RowsIcon size={14} />
          按类型分组
        </button>
      </div>

      <div className="mb-sc-arrange-label">对齐选中（≥2 个）</div>
      <div className="mb-sc-arrange-aligns">
        <button className="mb-btn mb-btn-sm mb-btn-ghost" title="左对齐" onClick={() => alignSelected('left')}>
          左
        </button>
        <button className="mb-btn mb-btn-sm mb-btn-ghost" title="水平居中" onClick={() => alignSelected('hcenter')}>
          水平中
        </button>
        <button className="mb-btn mb-btn-sm mb-btn-ghost" title="右对齐" onClick={() => alignSelected('right')}>
          右
        </button>
        <button className="mb-btn mb-btn-sm mb-btn-ghost" title="顶对齐" onClick={() => alignSelected('top')}>
          上
        </button>
        <button className="mb-btn mb-btn-sm mb-btn-ghost" title="垂直居中" onClick={() => alignSelected('vcenter')}>
          垂直中
        </button>
        <button className="mb-btn mb-btn-sm mb-btn-ghost" title="底对齐" onClick={() => alignSelected('bottom')}>
          下
        </button>
      </div>

      <div className="mb-sc-arrange-label">均分选中（≥3 个）</div>
      <div className="mb-sc-arrange-row2">
        <button className="mb-btn mb-btn-sm mb-btn-ghost mb-sc-tbtn" onClick={() => distributeSelected('h')}>
          <DistributeHIcon size={14} />
          横向均分
        </button>
        <button className="mb-btn mb-btn-sm mb-btn-ghost mb-sc-tbtn" onClick={() => distributeSelected('v')}>
          <DistributeVIcon size={14} />
          纵向均分
        </button>
      </div>
      <div className="mb-sc-arrange-note">只动顶层非分组节点。</div>
    </div>
  );
}
