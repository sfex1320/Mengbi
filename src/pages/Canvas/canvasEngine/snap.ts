import type { Layer, CanvasProject } from '../types';

/**
 * 拖拽吸附 + 对齐辅助线计算。
 *
 * 输入：
 *   - 当前正在拖动的图层 id
 *   - 试探的新 (x, y)
 *   - 整个 project（用于读其它图层的 bbox）
 *   - 屏幕缩放（zoom）：决定多少像素算"接近"
 *
 * 输出：
 *   - snappedX / snappedY：可能被吸附后的新坐标
 *   - guides：触发的对齐辅助线列表（画在 stage 顶层 SVG）
 *
 * 阈值：6 屏幕像素 / zoom = 6/zoom 画布像素。
 * 对齐目标：
 *   - 画布的 0 / W/2 / W（x），0 / H/2 / H（y）
 *   - 其它每个图层的 left / centerX / right / top / centerY / bottom
 * 当前层用其 bbox（含 scaleX/scaleY 但不含 rotation/skew，简化）的 left / centerX / right / top / centerY / bottom 与目标比较。
 */

export interface SnapGuide {
  axis: 'v' | 'h';
  /** 在画布坐标系内的位置 */
  pos: number;
}

interface LayerBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
  centerX: number;
  centerY: number;
}

function bbox(l: Layer, x: number, y: number): LayerBox {
  const w = l.width * Math.abs(l.scaleX);
  const h = l.height * Math.abs(l.scaleY);
  return {
    left: x,
    right: x + w,
    top: y,
    bottom: y + h,
    centerX: x + w / 2,
    centerY: y + h / 2
  };
}

export function computeSnap(
  draggedId: string,
  draggedLayer: Layer,
  tryX: number,
  tryY: number,
  project: CanvasProject,
  zoom: number
): { x: number; y: number; guides: SnapGuide[] } {
  const threshold = 6 / Math.max(0.0001, zoom);
  const me = bbox(draggedLayer, tryX, tryY);

  const targetsX = new Set<number>();
  const targetsY = new Set<number>();
  // 画布
  targetsX.add(0);
  targetsX.add(project.width / 2);
  targetsX.add(project.width);
  targetsY.add(0);
  targetsY.add(project.height / 2);
  targetsY.add(project.height);
  // 其它图层
  for (const other of project.layers) {
    if (other.id === draggedId || !other.visible) continue;
    const b = bbox(other, other.x, other.y);
    targetsX.add(b.left);
    targetsX.add(b.centerX);
    targetsX.add(b.right);
    targetsY.add(b.top);
    targetsY.add(b.centerY);
    targetsY.add(b.bottom);
  }

  // 当前层在 X 方向需要被对齐的三条边
  const myXs: Array<{ key: keyof LayerBox; val: number }> = [
    { key: 'left', val: me.left },
    { key: 'centerX', val: me.centerX },
    { key: 'right', val: me.right }
  ];
  const myYs: Array<{ key: keyof LayerBox; val: number }> = [
    { key: 'top', val: me.top },
    { key: 'centerY', val: me.centerY },
    { key: 'bottom', val: me.bottom }
  ];

  let dx = 0;
  let dy = 0;
  let bestDx = Infinity;
  let bestDy = Infinity;
  const guides: SnapGuide[] = [];

  for (const my of myXs) {
    for (const t of targetsX) {
      const d = t - my.val;
      if (Math.abs(d) < threshold && Math.abs(d) < bestDx) {
        bestDx = Math.abs(d);
        dx = d;
      }
    }
  }
  for (const my of myYs) {
    for (const t of targetsY) {
      const d = t - my.val;
      if (Math.abs(d) < threshold && Math.abs(d) < bestDy) {
        bestDy = Math.abs(d);
        dy = d;
      }
    }
  }

  const finalX = tryX + dx;
  const finalY = tryY + dy;
  const finalBox = bbox(draggedLayer, finalX, finalY);

  // 拿吸附后的 box 再去找哪些目标完全对上 → 画线
  const matchEps = 0.5;
  for (const t of targetsX) {
    if (
      Math.abs(finalBox.left - t) < matchEps ||
      Math.abs(finalBox.centerX - t) < matchEps ||
      Math.abs(finalBox.right - t) < matchEps
    ) {
      guides.push({ axis: 'v', pos: t });
    }
  }
  for (const t of targetsY) {
    if (
      Math.abs(finalBox.top - t) < matchEps ||
      Math.abs(finalBox.centerY - t) < matchEps ||
      Math.abs(finalBox.bottom - t) < matchEps
    ) {
      guides.push({ axis: 'h', pos: t });
    }
  }

  return { x: finalX, y: finalY, guides };
}
