/**
 * 图层栅格操作（LayerManager 的"重活"部分）：合并图层。
 * 纯函数 + 调 canvasStore 动作，渲染端调用。
 */

import { useCanvasStore } from '@/store/canvasStore';
import { renderLayersToCanvas, blobToDataUri } from './exportPNG';

async function canvasToDataUri(canvas: HTMLCanvasElement): Promise<string> {
  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob null'))), 'image/png')
  );
  return blobToDataUri(blob);
}

/**
 * 合并指定图层为单张图像图层（保持透明背景）。ids 至少 2 个才有意义，
 * 但 1 个也允许（等于栅格化该图层）。组会被忽略（其 child 需显式列出）。
 */
export async function mergeLayers(ids: string[]): Promise<void> {
  const project = useCanvasStore.getState().project;
  const idsSet = new Set(ids);
  // 按工程 z 顺序（数组顺序）取子集，保证叠放正确
  const subset = project.layers.filter((l) => idsSet.has(l.id) && !l.isGroup);
  if (subset.length === 0) return;
  const canvas = await renderLayersToCanvas(project, subset, false);
  const dataUri = await canvasToDataUri(canvas);
  useCanvasStore.getState().mergeLayersWithImage(ids, dataUri, '合并图层');
}

/** 合并所有可见图层为一张图（盖印）。 */
export async function flattenVisible(): Promise<void> {
  const project = useCanvasStore.getState().project;
  const visibleIds = project.layers.filter((l) => l.visible && !l.isGroup).map((l) => l.id);
  if (visibleIds.length === 0) return;
  await mergeLayers(visibleIds);
}
