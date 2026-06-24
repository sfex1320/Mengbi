import { useState } from 'react';
import { useSmartCanvasStore, useSmartKeybindStore } from '@/store/smartCanvasStore';
import { ClampNumberInput } from './nodePanel/consoleControls';
import { LayoutIcon, RowsIcon, DistributeHIcon, DistributeVIcon, RunAllIcon } from './icons';

/** 把 'alt+arrowleft' 这类组合串美化成 'Alt+←' 给 tooltip 用。 */
function prettyCombo(c?: string): string {
  if (!c) return '';
  return c
    .split('+')
    .map((p) => {
      if (p === 'arrowleft') return '←';
      if (p === 'arrowright') return '→';
      if (p === 'arrowup') return '↑';
      if (p === 'arrowdown') return '↓';
      return p.charAt(0).toUpperCase() + p.slice(1);
    })
    .join('+');
}

/** 排布弹窗（画布右下角）：网格 / 按类型 / 对齐选中 / 均分。带图标，加大避免文字显示不全。 */
export function ArrangePanel({ onClose }: { onClose: () => void }): JSX.Element {
  const arrangeGrid = useSmartCanvasStore((s) => s.arrangeGrid);
  const arrangeByType = useSmartCanvasStore((s) => s.arrangeByType);
  const arrangeSmart = useSmartCanvasStore((s) => s.arrangeSmart);
  const alignSelected = useSmartCanvasStore((s) => s.alignSelected);
  const distributeSelected = useSmartCanvasStore((s) => s.distributeSelected);
  const bindings = useSmartKeybindStore((s) => s.bindings);
  const kb = (id: string): string => {
    const c = prettyCombo(bindings[id]);
    return c ? `（${c}）` : '';
  };
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
          <ClampNumberInput min={1} max={12} value={cols} onCommit={setCols} />
        </label>
        <label className="mb-sc-arrange-field">
          <span>间距</span>
          <ClampNumberInput min={0} max={400} value={gap} onCommit={setGap} />
        </label>
      </div>

      <button
        className="mb-btn mb-btn-sm mb-btn-primary mb-sc-arrange-smart"
        title={`智能排布 ${kb('arrange-smart')}`}
        onClick={() => arrangeSmart(gap)}
      >
        <RunAllIcon size={13} />
        智能排布{kb('arrange-smart')}（按工作流走向 · 上游左 → 下游右）
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
        <button className="mb-btn mb-btn-sm mb-btn-ghost" title={`左对齐 ${kb('align-left')}`} onClick={() => alignSelected('left')}>
          左
        </button>
        <button className="mb-btn mb-btn-sm mb-btn-ghost" title={`水平居中 ${kb('align-hcenter')}`} onClick={() => alignSelected('hcenter')}>
          水平中
        </button>
        <button className="mb-btn mb-btn-sm mb-btn-ghost" title={`右对齐 ${kb('align-right')}`} onClick={() => alignSelected('right')}>
          右
        </button>
        <button className="mb-btn mb-btn-sm mb-btn-ghost" title={`顶对齐 ${kb('align-top')}`} onClick={() => alignSelected('top')}>
          上
        </button>
        <button className="mb-btn mb-btn-sm mb-btn-ghost" title={`垂直居中 ${kb('align-vcenter')}`} onClick={() => alignSelected('vcenter')}>
          垂直中
        </button>
        <button className="mb-btn mb-btn-sm mb-btn-ghost" title={`底对齐 ${kb('align-bottom')}`} onClick={() => alignSelected('bottom')}>
          下
        </button>
      </div>

      <div className="mb-sc-arrange-label">均分选中（≥3 个）</div>
      <div className="mb-sc-arrange-row2">
        <button className="mb-btn mb-btn-sm mb-btn-ghost mb-sc-tbtn" title={`横向均分 ${kb('distribute-h')}`} onClick={() => distributeSelected('h')}>
          <DistributeHIcon size={14} />
          横向均分
        </button>
        <button className="mb-btn mb-btn-sm mb-btn-ghost mb-sc-tbtn" title={`纵向均分 ${kb('distribute-v')}`} onClick={() => distributeSelected('v')}>
          <DistributeVIcon size={14} />
          纵向均分
        </button>
      </div>
      <div className="mb-sc-arrange-note">只动顶层非分组节点 · 对齐/排布支持快捷键（Alt+方向 / Alt+H/V / Alt+L，可在快捷键设置改）。</div>
    </div>
  );
}
