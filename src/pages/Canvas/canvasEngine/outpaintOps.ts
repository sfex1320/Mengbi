/**
 * 扩图核心操作（被扩图对话框与拖边界扩图共用）。
 * 平移图层 + 扩画布 + 生成扩图蒙版（新区=白），结果通过 store 落地。
 */

import { useCanvasStore } from '@/store/canvasStore';
import { useInpaintMaskStore } from '@/store/inpaintMaskStore';
import { makeOutpaintMask, maskHasCoverage } from './maskEngine';

export const MAX_CANVAS_SIZE = 4096;

export interface OutpaintResult {
  ok: boolean;
  message?: string;
}

/**
 * 把画板扩到 newW×newH，原图落在 (offsetX, offsetY)。会自动生成扩图蒙版并显示。
 */
export function applyOutpaint(
  offsetX: number,
  offsetY: number,
  newW: number,
  newH: number
): OutpaintResult {
  const project = useCanvasStore.getState().project;
  const oldW = project.width;
  const oldH = project.height;
  newW = Math.round(newW);
  newH = Math.round(newH);
  if (newW > MAX_CANVAS_SIZE || newH > MAX_CANVAS_SIZE) {
    return { ok: false, message: `目标 ${newW}×${newH} 超过 ${MAX_CANVAS_SIZE}px 上限` };
  }
  if (newW < oldW || newH < oldH) {
    return { ok: false, message: '扩图只能放大画板' };
  }
  if (newW === oldW && newH === oldH) {
    return { ok: false, message: '没有变化' };
  }
  useCanvasStore.getState().expandCanvas(offsetX, offsetY, newW, newH);
  const maskStore = useInpaintMaskStore.getState();
  const color = maskStore.color;
  // 基础蒙版：新扩出的边 = 待填充区、原图区 = 保留区
  const mask = makeOutpaintMask(newW, newH, { x: offsetX, y: offsetY, w: oldW, h: oldH }, color);
  // 已有蒙版（之前涂的 / 上一次扩图留下的待填充区）→ 叠回原图区，
  // 让「之前已是待填充的区域」继续保持待填充，只把这次新扩的边并入；
  // 而不是把旧蒙版区当成「保留区」抹掉（即用户要的「别把蒙版部分转化成画板部分」）。
  const existing = maskStore.canvas;
  if (existing && maskStore.visible && maskHasCoverage(existing)) {
    mask.getContext('2d')!.drawImage(existing, offsetX, offsetY, oldW, oldH);
  }
  maskStore.replaceCanvas(mask);
  maskStore.setVisible(true);
  return { ok: true };
}

/** 单边扩图（拖边界用）。side 为方向，amount 为该方向新增像素。 */
export function applyOutpaintSide(side: 'top' | 'right' | 'bottom' | 'left', amount: number): OutpaintResult {
  const px = Math.round(amount);
  if (px <= 0) return { ok: false, message: '没有变化' };
  const { width: w, height: h } = useCanvasStore.getState().project;
  switch (side) {
    case 'top':
      return applyOutpaint(0, px, w, h + px);
    case 'bottom':
      return applyOutpaint(0, 0, w, h + px);
    case 'left':
      return applyOutpaint(px, 0, w + px, h);
    case 'right':
      return applyOutpaint(0, 0, w + px, h);
  }
}
