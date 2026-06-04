import type { Layer } from '../types';

export type AlignKind =
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | 'center-h'
  | 'center-v';

interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 把图层在世界坐标系里的轴对齐包围盒算出来。
 * 旋转 / skew 也要算进 bbox —— 对齐用户视觉感知的边而不是原始边。
 */
export function computeLayerBBox(layer: Layer): BBox {
  const w = layer.width * Math.abs(layer.scaleX);
  const h = layer.height * Math.abs(layer.scaleY);
  if (!layer.rotation) {
    return { x: layer.x, y: layer.y, w, h };
  }
  const rad = (layer.rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const rw = w * cos + h * sin;
  const rh = w * sin + h * cos;
  const cx = layer.x + w / 2;
  const cy = layer.y + h / 2;
  return { x: cx - rw / 2, y: cy - rh / 2, w: rw, h: rh };
}

/** 单层对齐画板（0,0 → canvas.w,canvas.h） */
export function alignToCanvas(
  layer: Layer,
  canvas: { width: number; height: number },
  kind: AlignKind
): { x: number; y: number } {
  const bb = computeLayerBBox(layer);
  const dx0 = bb.x - layer.x;
  const dy0 = bb.y - layer.y;
  let bx = bb.x;
  let by = bb.y;
  switch (kind) {
    case 'left':
      bx = 0;
      break;
    case 'right':
      bx = canvas.width - bb.w;
      break;
    case 'top':
      by = 0;
      break;
    case 'bottom':
      by = canvas.height - bb.h;
      break;
    case 'center-h':
      bx = (canvas.width - bb.w) / 2;
      break;
    case 'center-v':
      by = (canvas.height - bb.h) / 2;
      break;
  }
  return { x: bx - dx0, y: by - dy0 };
}

/**
 * 多层对齐到 target 层：返回除 target 之外每一层的新 (x,y)。
 * 边/中心都用 bbox 来算，旋转层也能对齐感知到的边。
 */
export function alignToTarget(
  layers: Layer[],
  target: Layer,
  kind: AlignKind
): Map<string, { x: number; y: number }> {
  const result = new Map<string, { x: number; y: number }>();
  const tb = computeLayerBBox(target);
  for (const l of layers) {
    if (l.id === target.id) continue;
    const bb = computeLayerBBox(l);
    const dx0 = bb.x - l.x;
    const dy0 = bb.y - l.y;
    let bx = bb.x;
    let by = bb.y;
    switch (kind) {
      case 'left':
        bx = tb.x;
        break;
      case 'right':
        bx = tb.x + tb.w - bb.w;
        break;
      case 'top':
        by = tb.y;
        break;
      case 'bottom':
        by = tb.y + tb.h - bb.h;
        break;
      case 'center-h':
        bx = tb.x + (tb.w - bb.w) / 2;
        break;
      case 'center-v':
        by = tb.y + (tb.h - bb.h) / 2;
        break;
    }
    result.set(l.id, { x: bx - dx0, y: by - dy0 });
  }
  return result;
}
