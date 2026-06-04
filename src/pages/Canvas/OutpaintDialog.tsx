import { useState } from 'react';
import { useCanvasStore } from '@/store/canvasStore';
import { applyOutpaint, MAX_CANVAS_SIZE } from './canvasEngine/outpaintOps';
import { autoSnapshot } from '@/store/snapshotStore';
import { toast } from '@/store/toastStore';

/** 内置常用比例（需求六节） */
const RATIOS = ['1:1', '4:3', '3:2', '16:9', '21:9', '9:16', '3:4', '2:1', '3:1'];

type HAnchor = 'left' | 'center' | 'right';
type VAnchor = 'top' | 'center' | 'bottom';

/**
 * AI 扩图对话框：把画板向外扩展，保留原图、新区透明，并自动生成扩图蒙版
 * （白 = 新增区 = AI 填充区）。三种方式：按方向 px / 按目标比例 / 自定义目标尺寸，
 * 后两者用九宫格锚点决定原图落点。
 *
 * 「拖动画布边界扩图」作为画布交互将在后续批次补充；本对话框覆盖数值 / 比例 / 锚点路径。
 */
export function OutpaintDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const project = useCanvasStore((s) => s.project);

  const oldW = project.width;
  const oldH = project.height;

  // 方向扩展
  const [top, setTop] = useState(0);
  const [right, setRight] = useState(0);
  const [bottom, setBottom] = useState(0);
  const [left, setLeft] = useState(0);

  // 锚点（比例 / 自定义模式用）
  const [hAnchor, setHAnchor] = useState<HAnchor>('center');
  const [vAnchor, setVAnchor] = useState<VAnchor>('center');

  // 自定义目标
  const [targetW, setTargetW] = useState(oldW);
  const [targetH, setTargetH] = useState(oldH);

  function apply(offsetX: number, offsetY: number, newW: number, newH: number): void {
    autoSnapshot('扩图前');
    const r = applyOutpaint(offsetX, offsetY, newW, newH);
    if (!r.ok) {
      toast.error('扩图失败', r.message);
      return;
    }
    toast.success('已扩图', '新区域已生成蒙版（白 = AI 填充区），切到「蒙版」可微调');
    onClose();
  }

  function applyDirections(t: number, r: number, b: number, l: number): void {
    apply(l, t, oldW + l + r, oldH + t + b);
  }

  function anchorOffset(newW: number, newH: number): { ox: number; oy: number } {
    const ox = hAnchor === 'left' ? 0 : hAnchor === 'center' ? (newW - oldW) / 2 : newW - oldW;
    const oy = vAnchor === 'top' ? 0 : vAnchor === 'center' ? (newH - oldH) / 2 : newH - oldH;
    return { ox: Math.round(ox), oy: Math.round(oy) };
  }

  function applyRatio(ratio: string): void {
    const [rw, rh] = ratio.split(':').map(Number);
    const ratioVal = rw / rh;
    let newW: number;
    let newH: number;
    if (oldW / oldH >= ratioVal) {
      newW = oldW;
      newH = Math.round(oldW / ratioVal);
    } else {
      newH = oldH;
      newW = Math.round(oldH * ratioVal);
    }
    const { ox, oy } = anchorOffset(newW, newH);
    apply(ox, oy, newW, newH);
  }

  function applyCustom(): void {
    const newW = Math.max(oldW, Math.round(targetW));
    const newH = Math.max(oldH, Math.round(targetH));
    const { ox, oy } = anchorOffset(newW, newH);
    apply(ox, oy, newW, newH);
  }

  return (
    <div className="mb-modal-backdrop" onClick={onClose}>
      <div className="mb-modal mb-outpaint-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>AI 扩图</h3>
        <p className="mb-mask-rule">
          当前画板 {oldW}×{oldH}，扩图后原图保留、新区透明并自动生成蒙版
        </p>

        <div className="mb-canvas-props-section">
          <p className="mb-canvas-props-section-title">按方向扩展（px）</p>
          <div className="mb-outpaint-dirs">
            <NumInput label="上" value={top} onChange={setTop} />
            <NumInput label="下" value={bottom} onChange={setBottom} />
            <NumInput label="左" value={left} onChange={setLeft} />
            <NumInput label="右" value={right} onChange={setRight} />
          </div>
          <div className="mb-canvas-props-btnrow">
            <button
              type="button"
              className="mb-canvas-props-actionbtn"
              onClick={() => {
                const v = Math.max(top, right, bottom, left, 256);
                setTop(v);
                setRight(v);
                setBottom(v);
                setLeft(v);
              }}
            >
              四周相等
            </button>
            <button
              type="button"
              className="mb-canvas-props-actionbtn is-accent"
              onClick={() => applyDirections(top, right, bottom, left)}
            >
              应用方向扩图
            </button>
          </div>
        </div>

        <div className="mb-canvas-props-section">
          <p className="mb-canvas-props-section-title">原图位置（锚点）</p>
          <AnchorGrid h={hAnchor} v={vAnchor} onChange={(h, v) => { setHAnchor(h); setVAnchor(v); }} />
        </div>

        <div className="mb-canvas-props-section">
          <p className="mb-canvas-props-section-title">按目标比例（只放大，按锚点摆放）</p>
          <div className="mb-outpaint-ratios">
            {RATIOS.map((r) => (
              <button
                key={r}
                type="button"
                className="mb-canvas-props-actionbtn"
                onClick={() => applyRatio(r)}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-canvas-props-section">
          <p className="mb-canvas-props-section-title">自定义目标尺寸</p>
          <div className="mb-outpaint-dirs">
            <NumInput label="宽" value={targetW} onChange={setTargetW} />
            <NumInput label="高" value={targetH} onChange={setTargetH} />
          </div>
          <button type="button" className="mb-canvas-props-actionbtn is-accent" onClick={applyCustom}>
            应用自定义尺寸
          </button>
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

function NumInput({
  label,
  value,
  onChange
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}): JSX.Element {
  return (
    <div className="mb-canvas-props-row">
      <label style={{ minWidth: 28 }}>{label}</label>
      <input
        type="number"
        className="mb-canvas-props-input"
        value={value}
        min={0}
        max={MAX_CANVAS_SIZE}
        onChange={(e) => onChange(Math.max(0, +e.target.value || 0))}
      />
    </div>
  );
}

function AnchorGrid({
  h,
  v,
  onChange
}: {
  h: HAnchor;
  v: VAnchor;
  onChange: (h: HAnchor, v: VAnchor) => void;
}): JSX.Element {
  const hs: HAnchor[] = ['left', 'center', 'right'];
  const vs: VAnchor[] = ['top', 'center', 'bottom'];
  return (
    <div className="mb-anchor-grid">
      {vs.map((vv) =>
        hs.map((hh) => (
          <button
            key={`${hh}-${vv}`}
            type="button"
            className={`mb-anchor-cell ${h === hh && v === vv ? 'is-active' : ''}`}
            onClick={() => onChange(hh, vv)}
            title={`${vv}-${hh}`}
          />
        ))
      )}
    </div>
  );
}
