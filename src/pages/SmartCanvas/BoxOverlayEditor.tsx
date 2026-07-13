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

/** 同一位置重复点击视为「循环选择」的判定半径（屏幕像素）。 */
const CYCLE_TOLERANCE = 6;

/**
 * 图片 + 可拖拽/缩放的边界框覆盖层（切分/对稿工作台共用）。
 * box 用「源图像素坐标」，组件按容器(=源图同比例)换算成百分比定位；编辑时把屏幕位移按 scale 换回源图像素。
 * 容器宽 100% + aspect-ratio=源图比例，故百分比定位精确、与最终裁剪/拼合 1:1 对应。
 *
 * 选择用**容器级命中测试**而非框 div 自己接事件（框 div pointer-events:none）：
 * 点击处命中多个框时按**面积升序**取（小框/深层框优先），同一位置再次点击**循环切换**到下一个更大的框——
 * 解决「重叠框永远只能选到最上层」的老问题；hoverId 给列表 hover 联动高亮用。
 */
export function BoxOverlayEditor({
  src,
  imgW,
  imgH,
  boxes,
  editable,
  selectedId,
  hoverId,
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
  /** 列表侧 hover 的框 id：画布上对应框加白色高亮（遮挡场景用清单兜底选择） */
  hoverId?: string | null;
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
  // 循环选择状态：上次点击的屏幕坐标 + 命中集指纹 + 当前循环下标
  const cycle = useRef<{ sx: number; sy: number; key: string; idx: number } | null>(null);

  /** 开始拖动/缩放某个框（仅 editable；选择已在调用方完成）。 */
  function beginDrag(e: React.PointerEvent, id: string, mode: 'move' | 'resize'): void {
    if (!editable) return;
    const cont = ref.current;
    const b = boxes.find((x) => x.id === id);
    if (!cont || !b) return;
    e.preventDefault();
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

  /** 容器级命中测试：收集点击点命中的全部框（面积升序），同点重复点击循环推进。 */
  function onContainerDown(e: React.PointerEvent): void {
    if (e.button !== 0) return; // 只处理左键
    const cont = ref.current;
    if (!cont) return;
    const rect = cont.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / Math.max(1, rect.width)) * imgW;
    const py = ((e.clientY - rect.top) / Math.max(1, rect.height)) * imgH;
    const hits = boxes
      .filter((b) => px >= b.box.x && px <= b.box.x + b.box.w && py >= b.box.y && py <= b.box.y + b.box.h)
      .sort((a, b) => a.box.w * a.box.h - b.box.w * b.box.h);
    if (!hits.length) {
      cycle.current = null;
      return;
    }
    const key = hits.map((h) => h.id).join('|');
    const c = cycle.current;
    const samePoint =
      !!c && c.key === key && Math.abs(e.clientX - c.sx) <= CYCLE_TOLERANCE && Math.abs(e.clientY - c.sy) <= CYCLE_TOLERANCE;
    const idx = samePoint ? (c.idx + 1) % hits.length : 0;
    cycle.current = { sx: e.clientX, sy: e.clientY, key, idx };
    const target = hits[idx];
    onSelect?.(target.id);
    beginDrag(e, target.id, 'move');
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
        onPointerDown={onContainerDown}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        {boxes.map((b) => {
          const sel = b.id === selectedId;
          const hov = b.id === hoverId;
          const color = b.color || 'var(--mb-accent)';
          return (
            <div
              key={b.id}
              className={`mb-sc-boxedit-box${sel ? ' is-sel' : ''}${hov ? ' is-hover' : ''}`}
              style={{
                left: pct(b.box.x, imgW),
                top: pct(b.box.y, imgH),
                width: pct(b.box.w, imgW),
                height: pct(b.box.h, imgH),
                borderColor: color
              }}
            >
              {b.label && (
                <span className="mb-sc-boxedit-tag" style={{ background: color }}>
                  {b.label}
                </span>
              )}
              {/* 缩放手柄只给选中框：pointer-events 单独放行（框本体 none），stopPropagation 防容器再跑一轮命中循环 */}
              {editable && sel && (
                <span
                  className="mb-sc-boxedit-handle"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    beginDrag(e, b.id, 'resize');
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
