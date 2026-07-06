import { useRef } from 'react';
import { srcToUrl } from '@/lib/imageScale';
import type { ElementRect } from '@shared/smartCanvas';

export interface OverlayBox {
  id: string;
  box: ElementRect;
  /** 框颜色（缺省用 accent） */
  color?: string;
  /** 框上角标文字 */
  label?: string;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(v, hi));
}

/**
 * 图片 + 可拖拽/缩放的边界框覆盖层（切分/对稿工作台共用）。
 * box 用「源图像素坐标」，组件按容器(=源图同比例)换算成百分比定位；编辑时把屏幕位移按 scale 换回源图像素。
 * 容器宽 100% + aspect-ratio=源图比例，故百分比定位精确、与最终裁剪/拼合 1:1 对应。
 */
export function BoxOverlayEditor({
  src,
  imgW,
  imgH,
  boxes,
  editable,
  selectedId,
  onSelect,
  onChange,
  maxHeight = '56vh'
}: {
  src: string;
  imgW: number;
  imgH: number;
  boxes: OverlayBox[];
  editable?: boolean;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onChange?: (id: string, box: ElementRect) => void;
  maxHeight?: string;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    id: string;
    mode: 'move' | 'resize';
    sx: number;
    sy: number;
    start: ElementRect;
    scaleX: number;
    scaleY: number;
  } | null>(null);

  function begin(e: React.PointerEvent, id: string, mode: 'move' | 'resize'): void {
    onSelect?.(id);
    if (!editable) return;
    const cont = ref.current;
    const b = boxes.find((x) => x.id === id);
    if (!cont || !b) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const rect = cont.getBoundingClientRect();
    drag.current = {
      id,
      mode,
      sx: e.clientX,
      sy: e.clientY,
      start: { ...b.box },
      scaleX: imgW / Math.max(1, rect.width),
      scaleY: imgH / Math.max(1, rect.height)
    };
  }

  function move(e: React.PointerEvent): void {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.sx) * d.scaleX;
    const dy = (e.clientY - d.sy) * d.scaleY;
    let { x, y, w, h } = d.start;
    if (d.mode === 'move') {
      x = clamp(x + dx, 0, imgW - w);
      y = clamp(y + dy, 0, imgH - h);
    } else {
      w = clamp(w + dx, 8, imgW - x);
      h = clamp(h + dy, 8, imgH - y);
    }
    onChange?.(d.id, { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
  }

  function end(e: React.PointerEvent): void {
    if (!drag.current) return;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    drag.current = null;
  }

  const pct = (v: number, dim: number): string => `${(v / Math.max(1, dim)) * 100}%`;

  return (
    <div className="mb-sc-boxedit-wrap" style={{ maxHeight }}>
      <div
        ref={ref}
        className="mb-sc-boxedit nodrag nowheel"
        style={{ aspectRatio: `${imgW} / ${imgH}`, backgroundImage: `url("${srcToUrl(src)}")` }}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        {boxes.map((b) => {
          const sel = b.id === selectedId;
          const color = b.color || 'var(--mb-accent)';
          return (
            <div
              key={b.id}
              className={`mb-sc-boxedit-box${sel ? ' is-sel' : ''}`}
              style={{
                left: pct(b.box.x, imgW),
                top: pct(b.box.y, imgH),
                width: pct(b.box.w, imgW),
                height: pct(b.box.h, imgH),
                borderColor: color
              }}
              onPointerDown={(e) => begin(e, b.id, 'move')}
              title={b.label}
            >
              {b.label && (
                <span className="mb-sc-boxedit-tag" style={{ background: color }}>
                  {b.label}
                </span>
              )}
              {editable && (
                <span className="mb-sc-boxedit-handle" onPointerDown={(e) => begin(e, b.id, 'resize')} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
