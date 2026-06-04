import { useEffect, useMemo, useRef, useState } from 'react';
import type { Layer } from './types';
import { renderPerspectiveWarp, type Quad } from './canvasEngine/perspective';
import type { PerspectiveCorners } from './types';
import { useCanvasStore } from '@/store/canvasStore';
import { localPathToImageUrl } from '@/lib/imageUrl';
import { defaultPerspective } from './types';

interface Props {
  layer: Layer;
  zoom: number;
  onCommit: () => void;
}

/**
 * 透视模式 overlay：
 *   - 用 HTML 元素覆盖在 Konva 画板上，4 个角控制点 + 实时变形预览
 *   - 用户拖角 → store.perspective 更新 → 异步重渲染 warp
 *   - 退出（commit）时把当前 warp 烘焙到 cookedDataUri
 *
 * 简化约束：透视编辑期间忽略 layer 的旋转 / 倾斜（rotation=0、skewX=skewY=0），
 * 只用 layer.x, layer.y, layer.scaleX, layer.scaleY 把图层在屏幕上定位。
 */
export function PerspectiveOverlay({ layer, zoom, onCommit }: Props): JSX.Element {
  const setPerspective = useCanvasStore((s) => s.setPerspective);
  const setCooked = useCanvasStore((s) => s.setCooked);
  const updateLayer = useCanvasStore((s) => s.updateLayer);

  // 透视编辑始终基于 sourcePath（原图），没有 sourcePath 才退回 cooked
  const baseSrc = useMemo(() => {
    if (layer.sourcePath) return localPathToImageUrl(layer.sourcePath);
    return layer.cookedDataUri ?? null;
  }, [layer.sourcePath, layer.cookedDataUri]);

  const corners: PerspectiveCorners = layer.perspective ?? defaultPerspective(layer.width, layer.height);

  function toQuad(c: PerspectiveCorners): Quad {
    return {
      tl: { x: c.tl[0], y: c.tl[1] },
      tr: { x: c.tr[0], y: c.tr[1] },
      br: { x: c.br[0], y: c.br[1] },
      bl: { x: c.bl[0], y: c.bl[1] }
    };
  }
  const [previewBitmap, setPreviewBitmap] = useState<ImageBitmap | null>(null);
  const [previewBbox, setPreviewBbox] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const baseImgRef = useRef<HTMLImageElement | null>(null);
  const renderSeq = useRef(0);

  // 加载原图
  useEffect(() => {
    if (!baseSrc) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      baseImgRef.current = img;
      void rerender(corners);
    };
    img.src = baseSrc;
    return () => {
      baseImgRef.current = null;
      setPreviewBitmap(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseSrc]);

  async function rerender(c: PerspectiveCorners): Promise<void> {
    const img = baseImgRef.current;
    if (!img) return;
    const seq = ++renderSeq.current;
    try {
      const r = await renderPerspectiveWarp(img, layer.width, layer.height, toQuad(c));
      if (seq !== renderSeq.current) return;
      setPreviewBitmap(r.bitmap);
      setPreviewBbox(r.bbox);
    } catch (e) {
      console.warn('perspective warp failed', e);
    }
  }

  // 把 ImageBitmap 画到 <canvas>（react 不直接渲染 bitmap）
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = previewCanvasRef.current;
    if (!c || !previewBitmap || !previewBbox) return;
    c.width = previewBbox.width;
    c.height = previewBbox.height;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(previewBitmap, 0, 0);
  }, [previewBitmap, previewBbox]);

  // 把"图像坐标"（layer 局部）映射到屏幕（overlay）像素
  // overlay 跟 .mb-canvas-stage-paper 同坐标系，paper 自身已经按 zoom 放大了
  const sx = layer.scaleX * zoom;
  const sy = layer.scaleY * zoom;
  const ox = layer.x * zoom;
  const oy = layer.y * zoom;
  function toScreen(px: number, py: number): { x: number; y: number } {
    return { x: ox + px * sx, y: oy + py * sy };
  }
  function fromScreen(sx2: number, sy2: number): { x: number; y: number } {
    return { x: (sx2 - ox) / sx, y: (sy2 - oy) / sy };
  }

  function handlePointerDown(corner: 'tl' | 'tr' | 'br' | 'bl', e: React.PointerEvent<HTMLDivElement>): void {
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);

    function onMove(ev: PointerEvent): void {
      const rect = (target.parentElement as HTMLElement).getBoundingClientRect();
      const localX = ev.clientX - rect.left;
      const localY = ev.clientY - rect.top;
      const imgPt = fromScreen(localX, localY);
      const next: PerspectiveCorners = {
        ...corners,
        [corner]: [imgPt.x, imgPt.y] as [number, number]
      };
      setPerspective(layer.id, next);
      void rerender(next);
    }
    function onUp(): void {
      target.releasePointerCapture(e.pointerId);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  // 4 角屏幕坐标
  const tlS = toScreen(corners.tl[0], corners.tl[1]);
  const trS = toScreen(corners.tr[0], corners.tr[1]);
  const brS = toScreen(corners.br[0], corners.br[1]);
  const blS = toScreen(corners.bl[0], corners.bl[1]);

  function handleCommit(): void {
    const c = previewCanvasRef.current;
    if (!c || !previewBbox) {
      onCommit();
      return;
    }
    const dataUri = c.toDataURL('image/png');
    setCooked(layer.id, dataUri);
    // 把 layer.width/height 替换成 bbox，并把 x/y 偏移补回，使视觉位置不变
    const newW = previewBbox.width;
    const newH = previewBbox.height;
    const dx = previewBbox.x * layer.scaleX;
    const dy = previewBbox.y * layer.scaleY;
    updateLayer(layer.id, {
      width: newW,
      height: newH,
      x: layer.x + dx,
      y: layer.y + dy,
      crop: null
    });
    // 透视已烘焙到 cooked，清掉 perspective 让 layer 处于"正常"状态
    setPerspective(layer.id, null);
    onCommit();
  }

  function handleCancel(): void {
    // 取消编辑：丢弃临时 perspective
    setPerspective(layer.id, null);
    onCommit();
  }

  return (
    <>
      <svg className="mb-canvas-perspective-overlay-svg">
        <line x1={tlS.x} y1={tlS.y} x2={trS.x} y2={trS.y} />
        <line x1={trS.x} y1={trS.y} x2={brS.x} y2={brS.y} />
        <line x1={brS.x} y1={brS.y} x2={blS.x} y2={blS.y} />
        <line x1={blS.x} y1={blS.y} x2={tlS.x} y2={tlS.y} />
      </svg>

      {/* 实时预览 */}
      {previewBbox && (
        <canvas
          ref={previewCanvasRef}
          style={{
            position: 'absolute',
            left: ox + previewBbox.x * sx,
            top: oy + previewBbox.y * sy,
            width: previewBbox.width * sx,
            height: previewBbox.height * sy,
            pointerEvents: 'none',
            zIndex: 18
          }}
        />
      )}

      {/* 4 角 */}
      {(['tl', 'tr', 'br', 'bl'] as const).map((c) => {
        const p = c === 'tl' ? tlS : c === 'tr' ? trS : c === 'br' ? brS : blS;
        return (
          <div
            key={c}
            className="mb-canvas-perspective-handle"
            style={{ left: p.x, top: p.y }}
            onPointerDown={(e) => handlePointerDown(c, e)}
          />
        );
      })}

      {/* 顶部小工具条：确认 / 取消 */}
      <div
        style={{
          position: 'absolute',
          top: 8,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          gap: 6,
          zIndex: 30
        }}
      >
        <button type="button" className="mb-canvas-toolbar-btn is-primary" onClick={handleCommit}>
          ✓ 应用透视
        </button>
        <button type="button" className="mb-canvas-toolbar-btn" onClick={handleCancel}>
          ✗ 取消
        </button>
      </div>
    </>
  );
}

