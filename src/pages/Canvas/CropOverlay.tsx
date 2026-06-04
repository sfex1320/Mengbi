import { useState } from 'react';
import type { Layer, CropRect } from './types';
import { useCanvasStore } from '@/store/canvasStore';

interface Props {
  layer: Layer;
  zoom: number;
  onCommit: () => void;
}

/**
 * 裁切模式：
 *   - layer 在屏幕上的 bbox 内拖出一个矩形选区
 *   - 选区四角 / 四边各有把手
 *   - 提交：写入 layer.crop
 *   - 取消：还原原 crop
 *
 * 同样忽略 layer 的 rotation / skew，只考虑 layer.x/y/scaleX/scaleY。
 */
export function CropOverlay({ layer, zoom, onCommit }: Props): JSX.Element {
  const setCrop = useCanvasStore((s) => s.setCrop);
  const [crop, setCropLocal] = useState<CropRect>(
    layer.crop ?? { x: 0, y: 0, width: layer.width, height: layer.height }
  );
  const [originalCrop] = useState<CropRect | null>(layer.crop ?? null);

  const sx = layer.scaleX * zoom;
  const sy = layer.scaleY * zoom;
  const ox = layer.x * zoom;
  const oy = layer.y * zoom;

  const screenX = ox + crop.x * sx;
  const screenY = oy + crop.y * sy;
  const screenW = crop.width * sx;
  const screenH = crop.height * sy;

  // 整个 layer 的屏幕 bbox，用于约束 crop
  const layerW = layer.width * Math.abs(sx);
  const layerH = layer.height * Math.abs(sy);
  const layerScreenX = ox + Math.min(0, layer.width * sx);
  const layerScreenY = oy + Math.min(0, layer.height * sy);

  function startDrag(
    mode: 'move' | 'tl' | 'tr' | 'bl' | 'br' | 't' | 'b' | 'l' | 'r',
    e: React.PointerEvent<HTMLDivElement>
  ): void {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startY = e.clientY;
    const start = { ...crop };

    function onMove(ev: PointerEvent): void {
      const dxScreen = ev.clientX - startX;
      const dyScreen = ev.clientY - startY;
      const dx = dxScreen / sx; // 转回图像坐标
      const dy = dyScreen / sy;

      const next = { ...start };
      if (mode === 'move') {
        next.x = clamp(start.x + dx, 0, layer.width - start.width);
        next.y = clamp(start.y + dy, 0, layer.height - start.height);
      } else {
        if (mode.includes('l')) {
          const newX = clamp(start.x + dx, 0, start.x + start.width - 8);
          next.width = start.x + start.width - newX;
          next.x = newX;
        }
        if (mode.includes('r')) {
          next.width = clamp(start.width + dx, 8, layer.width - start.x);
        }
        if (mode.includes('t')) {
          const newY = clamp(start.y + dy, 0, start.y + start.height - 8);
          next.height = start.y + start.height - newY;
          next.y = newY;
        }
        if (mode.includes('b')) {
          next.height = clamp(start.height + dy, 8, layer.height - start.y);
        }
      }
      setCropLocal(next);
    }
    function onUp(): void {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  function handleCommit(): void {
    setCrop(layer.id, crop);
    onCommit();
  }

  function handleCancel(): void {
    setCrop(layer.id, originalCrop);
    onCommit();
  }

  return (
    <>
      {/* 半透明遮罩：把 layer bbox 内、crop 之外的部分压暗 */}
      <svg
        className="mb-canvas-perspective-overlay-svg"
        style={{ pointerEvents: 'none' }}
      >
        <defs>
          <mask id="mb-crop-mask">
            <rect
              x={layerScreenX}
              y={layerScreenY}
              width={layerW}
              height={layerH}
              fill="white"
            />
            <rect
              x={Math.min(screenX, screenX + screenW)}
              y={Math.min(screenY, screenY + screenH)}
              width={Math.abs(screenW)}
              height={Math.abs(screenH)}
              fill="black"
            />
          </mask>
        </defs>
        <rect
          x={layerScreenX}
          y={layerScreenY}
          width={layerW}
          height={layerH}
          fill="rgba(0,0,0,0.55)"
          mask="url(#mb-crop-mask)"
        />
      </svg>

      {/* 裁切矩形 + 把手 */}
      <div
        style={{
          position: 'absolute',
          left: Math.min(screenX, screenX + screenW),
          top: Math.min(screenY, screenY + screenH),
          width: Math.abs(screenW),
          height: Math.abs(screenH),
          border: '1.5px solid var(--mb-accent)',
          boxShadow: '0 0 0 1px rgba(0,0,0,0.4)',
          cursor: 'move',
          zIndex: 21
        }}
        onPointerDown={(e) => startDrag('move', e)}
      >
        {(['tl', 't', 'tr', 'l', 'r', 'bl', 'b', 'br'] as const).map((h) => (
          <div
            key={h}
            onPointerDown={(e) => startDrag(h, e)}
            style={cropHandleStyle(h)}
          />
        ))}
      </div>

      {/* 工具条：应用 / 取消 / 重置 —— 固定在画板视口最顶部,不跟随 canvas 滚动 */}
      <div className="mb-canvas-crop-toolbar">
        <button type="button" className="mb-canvas-toolbar-btn is-primary" onClick={handleCommit}>
          ✓ 应用裁切
        </button>
        <button
          type="button"
          className="mb-canvas-toolbar-btn"
          onClick={() =>
            setCropLocal({ x: 0, y: 0, width: layer.width, height: layer.height })
          }
        >
          重置
        </button>
        <button type="button" className="mb-canvas-toolbar-btn" onClick={handleCancel}>
          ✗ 取消
        </button>
      </div>
    </>
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function cropHandleStyle(h: string): React.CSSProperties {
  const sz = 10;
  const half = sz / 2;
  const base: React.CSSProperties = {
    position: 'absolute',
    width: sz,
    height: sz,
    background: 'var(--mb-accent)',
    border: '1.5px solid #fff',
    borderRadius: 2,
    boxShadow: '0 2px 4px rgba(0,0,0,0.4)'
  };
  switch (h) {
    case 'tl':
      return { ...base, left: -half, top: -half, cursor: 'nwse-resize' };
    case 't':
      return { ...base, left: '50%', top: -half, marginLeft: -half, cursor: 'ns-resize' };
    case 'tr':
      return { ...base, right: -half, top: -half, cursor: 'nesw-resize' };
    case 'l':
      return { ...base, left: -half, top: '50%', marginTop: -half, cursor: 'ew-resize' };
    case 'r':
      return { ...base, right: -half, top: '50%', marginTop: -half, cursor: 'ew-resize' };
    case 'bl':
      return { ...base, left: -half, bottom: -half, cursor: 'nesw-resize' };
    case 'b':
      return { ...base, left: '50%', bottom: -half, marginLeft: -half, cursor: 'ns-resize' };
    case 'br':
      return { ...base, right: -half, bottom: -half, cursor: 'nwse-resize' };
  }
  return base;
}
