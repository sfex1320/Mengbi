import { createPortal } from 'react-dom';
import { useSmartViewStore, type EdgeStyle } from '@/store/smartViewStore';

const EDGE_STYLES: Array<[EdgeStyle, string]> = [
  ['bezier', '曲线'],
  ['straight', '直线'],
  ['step', '折线']
];

/** 视图偏好弹窗：连线形状/箭头/状态着色 + 网格吸附 + 对齐参考线。portal 到 body 避免 transform 错位。 */
export function ViewPrefsPanel({ onClose }: { onClose: () => void }): JSX.Element {
  const v = useSmartViewStore();
  return createPortal(
    <>
      <div className="mb-sc-menu-backdrop" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div
        className="mb-sc-viewprefs mb-card"
        style={{ position: 'fixed', zIndex: 60, left: '50%', top: 64, transform: 'translateX(-50%)' }}
      >
        <div className="mb-sc-viewprefs-title">连线与对齐</div>

        <div className="mb-sc-viewprefs-row">
          <span>连线样式</span>
          <div className="mb-sc-seg">
            {EDGE_STYLES.map(([s, l]) => (
              <button
                key={s}
                className={`mb-sc-seg-btn ${v.edgeStyle === s ? 'is-on' : ''}`}
                onClick={() => v.setEdgeStyle(s)}
              >
                {l}
              </button>
            ))}
          </div>
        </div>

        <label className="mb-sc-viewprefs-check">
          <input type="checkbox" checked={v.showArrows} onChange={v.toggleArrows} /> 显示方向箭头
        </label>
        <label className="mb-sc-viewprefs-check">
          <input type="checkbox" checked={v.statusColorEdges} onChange={v.toggleStatusColor} /> 按运行状态给连线着色
        </label>

        <div className="mb-sc-viewprefs-divider" />

        <label className="mb-sc-viewprefs-check">
          <input type="checkbox" checked={v.snapToGrid} onChange={v.toggleSnap} /> 拖动吸附网格
        </label>
        {v.snapToGrid && (
          <div className="mb-sc-viewprefs-row">
            <span>网格步长 {v.snapSize}px</span>
            <input
              className="mb-sc-range"
              type="range"
              min={4}
              max={48}
              step={2}
              value={v.snapSize}
              onChange={(e) => v.setSnapSize(Number(e.target.value))}
            />
          </div>
        )}
        <label className="mb-sc-viewprefs-check">
          <input type="checkbox" checked={v.alignGuides} onChange={v.toggleGuides} /> 拖动显示对齐参考线
        </label>
      </div>
    </>,
    document.body
  );
}
