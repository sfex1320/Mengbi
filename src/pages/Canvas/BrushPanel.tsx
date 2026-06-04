import { useState } from 'react';
import { useBrushStore } from '@/store/brushStore';
import { useCanvasStore } from '@/store/canvasStore';
import { ColorPicker } from './ColorPicker';

interface Props {
  /** 当前生效的画笔模式：自由画 / 在选中图层蒙版上画 */
  mode: 'paint' | 'mask';
}

/**
 * 画笔工具面板：颜色、大小、不透明度、最近用色、撤销最近一笔。
 * - mode='paint'：颜色生效（取色器 + RGB 输入）
 * - mode='mask'：颜色被忽略，按 paint=显示 / erase=隐藏 渲染；只显示大小 / 不透明度
 */
export function BrushPanel({ mode }: Props): JSX.Element {
  const color = useBrushStore((s) => s.color);
  const size = useBrushStore((s) => s.size);
  const opacity = useBrushStore((s) => s.opacity);
  const recent = useBrushStore((s) => s.recent);
  const setColor = useBrushStore((s) => s.setColor);
  const setSize = useBrushStore((s) => s.setSize);
  const setOpacity = useBrushStore((s) => s.setOpacity);

  const project = useCanvasStore((s) => s.project);
  const popLastStroke = useCanvasStore((s) => s.popLastStroke);
  const clearStrokes = useCanvasStore((s) => s.clearStrokes);

  const [colorOpen, setColorOpen] = useState(false);
  const selected = project.layers.find((l) => l.id === project.selectedId) ?? null;

  return (
    <div className="mb-canvas-props">
      <h3>{mode === 'mask' ? '蒙版画笔' : '画笔'}</h3>

      {mode === 'paint' && (
        <div className="mb-canvas-props-section">
          <p className="mb-canvas-props-section-title">颜色</p>
          <button
            type="button"
            className="mb-color-swatch"
            onClick={() => setColorOpen((v) => !v)}
            title="点击展开调色板"
          >
            <span className="mb-color-swatch-chip" style={{ background: color }} />
            <span className="mb-color-swatch-hex">{color.toUpperCase()}</span>
          </button>
          {colorOpen && (
            <ColorPicker
              value={color}
              onChange={setColor}
              recent={recent}
            />
          )}
        </div>
      )}

      <div className="mb-canvas-props-section">
        <p className="mb-canvas-props-section-title">笔刷大小 ({size}px)</p>
        <input
          type="range"
          min={1}
          max={300}
          value={size}
          onChange={(e) => setSize(+e.target.value)}
          className="mb-canvas-props-slider"
          style={{ width: '100%' }}
        />
      </div>

      <div className="mb-canvas-props-section">
        <p className="mb-canvas-props-section-title">不透明度 ({Math.round(opacity * 100)}%)</p>
        <input
          type="range"
          min={5}
          max={100}
          value={Math.round(opacity * 100)}
          onChange={(e) => setOpacity(+e.target.value / 100)}
          className="mb-canvas-props-slider"
          style={{ width: '100%' }}
        />
      </div>

      <div className="mb-canvas-props-section">
        <p className="mb-canvas-props-section-title">操作</p>
        <div className="mb-canvas-props-btnrow">
          <button
            type="button"
            className="mb-canvas-props-actionbtn"
            disabled={!selected}
            onClick={() => selected && popLastStroke(selected.id)}
            title="撤销最近一笔（仅当前图层）"
          >
            ↶ 撤一笔
          </button>
          <button
            type="button"
            className="mb-canvas-props-actionbtn is-danger"
            disabled={!selected}
            onClick={() => selected && clearStrokes(selected.id)}
            title="清空当前笔刷图层所有描边"
          >
            清空全部
          </button>
        </div>
      </div>

      <p
        style={{
          fontSize: 'var(--mb-text-tiny)',
          color: 'var(--mb-text-muted)',
          margin: '6px 0 0',
          lineHeight: 1.5
        }}
      >
        {mode === 'mask'
          ? '蒙版画笔：在选中图像图层上画 = 隐藏 / 擦除画笔 = 还原。'
          : '快捷键：B = 画笔，E = 橡皮，Shift+[ ] 调大小。新画的笔刷会落在选中的笔刷图层；如未选中则自动新建一层。'}
      </p>
    </div>
  );
}
