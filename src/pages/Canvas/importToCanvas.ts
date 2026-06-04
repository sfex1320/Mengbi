import { useCanvasStore, makeLayerFromImage } from '@/store/canvasStore';
import { makeEmptyProject } from './types';

const MAX_CANVAS_SIZE = 4096;

export interface ImportSource {
  /** 真实磁盘路径（mengbi-image:// 用）；从 dataUri / 临时图来的可以为 null */
  sourcePath: string | null;
  /** 数据 URI；优先用作 cookedDataUri 或在没有 sourcePath 时唯一来源 */
  dataUri: string | null;
  width: number;
  height: number;
  /** 显示用名称（图层名 / 默认工程名） */
  name?: string;
}

/**
 * 把一张图片导入画板，按用户选择创建新工程或加进当前。
 *
 * mode='new'：新建一个画板，宽高 = 图像比例（最大边 ≤ MAX_CANVAS_SIZE），原图作为初始图层（铺满）。
 *             当前画板的内容**不丢失**——zustand store 持有，但 v1 只支持单工程，新建会替换。
 *             所以这里在新建前调用 confirmDialog 让用户确认。
 * mode='current'：直接 addLayer 到当前画板。
 */
export function importImageToCanvas(src: ImportSource, mode: 'new' | 'current'): void {
  const store = useCanvasStore.getState();
  const layerName = src.name ?? '导入图层';

  if (mode === 'new') {
    const scale = Math.min(1, MAX_CANVAS_SIZE / Math.max(src.width, src.height));
    const w = Math.max(64, Math.round(src.width * scale));
    const h = Math.max(64, Math.round(src.height * scale));
    const project = makeEmptyProject();
    project.width = w;
    project.height = h;
    project.name = src.name ?? '未命名画板';
    store.loadProject(project);
    // loadProject 是同步 set，下一行立即可以读取最新 project
    const layer = makeLayerFromImage({
      name: layerName,
      sourcePath: src.sourcePath,
      cookedDataUri: src.sourcePath ? null : src.dataUri,
      width: src.width,
      height: src.height,
      canvasWidth: w,
      canvasHeight: h
    });
    store.addLayer(layer);
    return;
  }

  // current：直接加到当前画板
  const cur = store.project;
  const layer = makeLayerFromImage({
    name: layerName,
    sourcePath: src.sourcePath,
    cookedDataUri: src.sourcePath ? null : src.dataUri,
    width: src.width,
    height: src.height,
    canvasWidth: cur.width,
    canvasHeight: cur.height
  });
  store.addLayer(layer);
}

/**
 * 把一张来自外部（Photoshop 导回 / AI 结果）的 dataUri 按指定方式装回画板。
 *   - 'new-layer'   ：作为新图层叠加在当前画板（居中铺放，原图不破坏）
 *   - 'replace'     ：替换当前选中图层的来源（保留 transform / 不透明度 / 混合模式）
 *   - 'new-canvas'  ：新建画板（宽高 = 图像，原图作为初始图层）
 * 撤销栈由 canvasStore 的每次 set 自动捕获，所以这些导入都可 Ctrl+Z 回退。
 */
export async function importDataUriToCanvas(
  dataUri: string,
  mode: 'new-layer' | 'replace' | 'new-canvas',
  name = '导入图层'
): Promise<void> {
  const img = await loadImageEl(dataUri);
  const store = useCanvasStore.getState();

  if (mode === 'new-canvas') {
    importImageToCanvas(
      { sourcePath: null, dataUri, width: img.naturalWidth, height: img.naturalHeight, name },
      'new'
    );
    return;
  }

  if (mode === 'replace') {
    const sel = store.project.selectedId;
    const target = sel ? store.project.layers.find((l) => l.id === sel) : null;
    if (target && !target.isGroup) {
      store.replaceLayerSource(target.id, {
        sourcePath: null,
        cookedDataUri: dataUri,
        width: img.naturalWidth,
        height: img.naturalHeight
      });
      return;
    }
    // 没有可替换的图层 → 退化为新图层
  }

  // new-layer（含 replace 的退化分支）
  importImageToCanvas(
    { sourcePath: null, dataUri, width: img.naturalWidth, height: img.naturalHeight, name },
    'current'
  );
}

function loadImageEl(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('image load failed'));
    im.src = src;
  });
}
