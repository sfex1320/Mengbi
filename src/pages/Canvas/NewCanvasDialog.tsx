import { useState } from 'react';
import { useCanvasStore } from '@/store/canvasStore';
import { useInpaintMaskStore } from '@/store/inpaintMaskStore';
import { makeEmptyProject } from './types';
import { toast } from '@/store/toastStore';

const MAX = 4096;

const PRESETS: Array<{ label: string; w: number; h: number }> = [
  { label: '1:1 · 1024', w: 1024, h: 1024 },
  { label: '1:1 · 2048', w: 2048, h: 2048 },
  { label: '3:4 · 1536', w: 1152, h: 1536 },
  { label: '4:3 · 1536', w: 1536, h: 1152 },
  { label: '9:16 · 1080', w: 1080, h: 1920 },
  { label: '16:9 · 1920', w: 1920, h: 1080 }
];

const BG_OPTIONS: Array<{ label: string; value: string }> = [
  { label: '透明', value: 'transparent' },
  { label: '白', value: '#ffffff' },
  { label: '黑', value: '#000000' },
  { label: '深灰', value: '#1c1c24' }
];

/**
 * 新建画布：选尺寸（预设 / 自定义）+ 背景，确认后用一张全新的空白工程替换当前画板。
 * 同时清空局部重绘蒙版（属于旧画布）。当前画板有内容时先确认，避免误清。
 */
export function NewCanvasDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const hasContent = useCanvasStore((s) => s.project.layers.length > 0);
  const loadProject = useCanvasStore((s) => s.loadProject);
  const resetMask = useInpaintMaskStore((s) => s.reset);

  const [w, setW] = useState(1024);
  const [h, setH] = useState(1024);
  const [bg, setBg] = useState('transparent');

  function create(): void {
    const cw = Math.max(64, Math.min(MAX, Math.round(w)));
    const ch = Math.max(64, Math.min(MAX, Math.round(h)));
    const project = makeEmptyProject();
    project.width = cw;
    project.height = ch;
    project.background = bg;
    project.name = '未命名画板';
    loadProject(project);
    resetMask();
    toast.success('已新建空白画布', `${cw} × ${ch}`);
    onClose();
  }

  return (
    <div className="mb-modal-backdrop" onClick={onClose}>
      <div className="mb-modal mb-newcanvas-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>新建画布</h3>
        {hasContent && (
          <p className="mb-mask-rule">当前画板内容会被替换（可用 Ctrl+Z 撤销）</p>
        )}

        <p className="mb-canvas-props-section-title">常用尺寸</p>
        <div className="mb-canvas-props-presetgrid">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              className={`mb-canvas-props-actionbtn ${w === p.w && h === p.h ? 'is-accent' : ''}`}
              onClick={() => {
                setW(p.w);
                setH(p.h);
              }}
              title={`${p.w} × ${p.h}`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="mb-canvas-props-row" style={{ marginTop: 10 }}>
          <label style={{ minWidth: 28 }}>宽</label>
          <input
            type="number"
            className="mb-canvas-props-input"
            value={w}
            min={64}
            max={MAX}
            onChange={(e) => setW(Math.max(0, +e.target.value || 0))}
          />
          <label style={{ minWidth: 28 }}>高</label>
          <input
            type="number"
            className="mb-canvas-props-input"
            value={h}
            min={64}
            max={MAX}
            onChange={(e) => setH(Math.max(0, +e.target.value || 0))}
          />
        </div>

        <div className="mb-canvas-props-row">
          <label style={{ minWidth: 28 }}>背景</label>
          <select className="mb-canvas-props-select" value={bg} onChange={(e) => setBg(e.target.value)}>
            {BG_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="mb-modal-actions">
          <button type="button" className="mb-btn" onClick={onClose}>
            取消
          </button>
          <button type="button" className="mb-btn mb-btn-primary" onClick={create}>
            新建
          </button>
        </div>
      </div>
    </div>
  );
}
