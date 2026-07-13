/**
 * 画板右键菜单构建（图层菜单 + 画布空白菜单）。
 * 复用全局 ContextMenu（openContextMenu / ContextMenuRoot）。
 *
 * 纯 store 动作（复制/删除/层级/显隐/锁定/合并）在这里直接执行；
 * 需要打开对话框 / 跨模块的动作（抠图/扩图/添加图片/适合屏幕）通过 handlers 注入。
 */

import { openContextMenu, type ContextMenuEntry } from '@/components/ContextMenu';
import { promptDialog } from '@/components/ConfirmDialog';
import { useCanvasStore } from '@/store/canvasStore';
import { useInpaintMaskStore } from '@/store/inpaintMaskStore';
import { useImageParamsStore } from '@/store/imageParamsStore';
import { renderLayersToCanvas, blobToDataUri } from './canvasEngine/exportPNG';
import { maskFromAlpha } from './canvasEngine/maskEngine';
import { mergeLayers } from './canvasEngine/layerOps';
import { toast } from '@/store/toastStore';
import { useShortcutsStore, type Shortcut } from '@/store/shortcutsStore';
import { sendToShortcut, buildShortcutSendMenuItems } from '@/lib/mediaActions';
import type { Layer } from './types';

export interface CanvasMenuHandlers {
  onBgRemove: (layerId: string) => void;
  onAddImage: () => void;
  onOutpaint: () => void;
  onFitScreen: () => void;
}

async function layerToCanvas(layerId: string): Promise<HTMLCanvasElement | null> {
  const project = useCanvasStore.getState().project;
  const layer = project.layers.find((l) => l.id === layerId);
  if (!layer) return null;
  return renderLayersToCanvas(project, [layer], false);
}

async function exportLayerPng(layerId: string): Promise<void> {
  const c = await layerToCanvas(layerId);
  if (!c) return;
  const blob: Blob = await new Promise((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob null'))), 'image/png')
  );
  const dataUri = await blobToDataUri(blob);
  const layer = useCanvasStore.getState().project.layers.find((l) => l.id === layerId);
  const r = await window.electronAPI.storage.saveAs({
    dataUri,
    defaultName: `${layer?.name || 'layer'}.png`,
    filters: [{ name: 'PNG', extensions: ['png'] }]
  });
  if (r.ok && r.data) toast.success('已导出图层');
}

async function layerAsReference(layerId: string): Promise<void> {
  const c = await layerToCanvas(layerId);
  if (!c) return;
  const blob: Blob = await new Promise((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob null'))), 'image/png')
  );
  const dataUri = await blobToDataUri(blob);
  useImageParamsStore.getState().addRefs([{ path: '', dataUri, width: c.width, height: c.height }]);
  toast.success('已加入生图参考图', '到生图页可调整权重与类型');
}

type SendFormat = 'png' | 'jpeg' | 'webp';
const FORMAT_MIME: Record<SendFormat, string> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };

/** 把一张 canvas 按指定格式编码成 dataUri（PNG 无损，JPEG/WebP 用 0.92 质量）。 */
async function canvasToDataUri(c: HTMLCanvasElement, format: SendFormat): Promise<string> {
  const blob: Blob = await new Promise((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob null'))), FORMAT_MIME[format], format === 'png' ? undefined : 0.92)
  );
  return blobToDataUri(blob);
}

async function layerToSmartCanvas(layerId: string, format: SendFormat): Promise<void> {
  const c = await layerToCanvas(layerId);
  if (!c) return;
  const dataUri = await canvasToDataUri(c, format);
  const layer = useCanvasStore.getState().project.layers.find((l) => l.id === layerId);
  const { useSmartInboxStore } = await import('@/store/smartInboxStore');
  useSmartInboxStore.getState().push([{ src: dataUri, name: layer?.name || '画板图层' }]);
  toast.success('已发送到智能画布', '按 Ctrl+7 打开智能画布查看');
}

/** 整张画板（所有可见图层合成，预处理后的成图）按指定格式发送到智能画布。 */
async function compositeToSmartCanvas(format: SendFormat): Promise<void> {
  const project = useCanvasStore.getState().project;
  const visible = project.layers.filter((l) => l.visible);
  if (!visible.length) {
    toast.error('画板没有可见图层');
    return;
  }
  const c = await renderLayersToCanvas(project, visible, true);
  const dataUri = await canvasToDataUri(c, format);
  const { useSmartInboxStore } = await import('@/store/smartInboxStore');
  useSmartInboxStore.getState().push([{ src: dataUri, name: project.name || '画板成图' }]);
  toast.success('已发送到智能画布', '按 Ctrl+7 打开智能画布查看');
}

/** 「发送到智能画布」的格式子菜单（图层 / 整张共用）。 */
function smartCanvasSendChildren(run: (f: SendFormat) => void): ContextMenuEntry[] {
  return [
    { label: 'PNG（无损）', onClick: () => run('png') },
    { label: 'JPEG（更小）', onClick: () => run('jpeg') },
    { label: 'WebP', onClick: () => run('webp') }
  ];
}

async function layerToShortcut(layerId: string, shortcut: Shortcut): Promise<void> {
  const c = await layerToCanvas(layerId);
  if (!c) return;
  const dataUri = await canvasToDataUri(c, 'png');
  const layer = useCanvasStore.getState().project.layers.find((l) => l.id === layerId);
  await sendToShortcut(shortcut, { kind: 'image', src: dataUri, name: layer?.name || '画板图层' });
}

/** 「发送到快捷方式」的图层图片子菜单（按当前侧栏快捷方式列出，渲染该图层后投送）。 */
function layerShortcutChildren(layerId: string): ContextMenuEntry[] {
  return useShortcutsStore.getState().shortcuts.map((s) => ({
    label: (s.kind === 'app' ? '▶ ' : '📁 ') + s.label,
    onClick: () => void layerToShortcut(layerId, s)
  }));
}

async function layerToInpaintMask(layerId: string): Promise<void> {
  const c = await layerToCanvas(layerId);
  if (!c) return;
  const color = useInpaintMaskStore.getState().color;
  const mask = maskFromAlpha(c, color);
  useInpaintMaskStore.getState().replaceCanvas(mask);
  useInpaintMaskStore.getState().setVisible(true);
  toast.success('已把图层主体转为重绘蒙版', '切到「蒙版」工具可微调');
}

/** 构建单个图层的右键菜单项 */
export function buildLayerMenuItems(layer: Layer, handlers: CanvasMenuHandlers): ContextMenuEntry[] {
  const store = useCanvasStore.getState();
  const selectedIds = store.project.selectedIds ?? [];
  const multi = selectedIds.length >= 2 && selectedIds.includes(layer.id);
  const isImage = !layer.isGroup && !layer.isText && !layer.isBrush && !layer.shapeKind;

  return [
    {
      label: '复制图层',
      onClick: () => store.duplicateLayer(layer.id)
    },
    {
      label: '重命名…',
      onClick: () =>
        void promptDialog({ message: '图层名称', initial: layer.name }).then((name) => {
          if (name && name.trim()) store.updateLayer(layer.id, { name: name.trim() });
        })
    },
    {
      label: layer.visible ? '隐藏图层' : '显示图层',
      onClick: () => store.updateLayer(layer.id, { visible: !layer.visible })
    },
    {
      label: layer.locked ? '解锁图层' : '锁定图层',
      onClick: () => store.updateLayer(layer.id, { locked: !layer.locked })
    },
    { separator: true },
    {
      label: '层级',
      children: [
        { label: '移到顶层', onClick: () => store.bringToFront(layer.id) },
        { label: '上移一层', onClick: () => store.bringForward(layer.id) },
        { label: '下移一层', onClick: () => store.sendBackward(layer.id) },
        { label: '移到底层', onClick: () => store.sendToBack(layer.id) }
      ]
    },
    multi
      ? { label: `合并选中的 ${selectedIds.length} 个图层`, onClick: () => void mergeLayers(selectedIds) }
      : { label: '栅格化此图层', onClick: () => void mergeLayers([layer.id]) },
    { separator: true },
    ...(isImage
      ? [
          { label: '抠除背景…', variant: 'accent' as const, onClick: () => handlers.onBgRemove(layer.id) },
          { label: '转为重绘蒙版', onClick: () => void layerToInpaintMask(layer.id) },
          { label: '作为参考图送生图', onClick: () => void layerAsReference(layer.id) },
          { label: '发送到智能画布', children: smartCanvasSendChildren((f) => void layerToSmartCanvas(layer.id, f)) },
          ...(useShortcutsStore.getState().shortcuts.length
            ? [{ label: '发送到快捷方式', children: layerShortcutChildren(layer.id) }]
            : [])
        ]
      : []),
    ...(layer.isText && layer.text
      ? buildShortcutSendMenuItems({ kind: 'text', text: layer.text, name: layer.name })
      : []),
    { label: '导出此图层为 PNG', onClick: () => void exportLayerPng(layer.id) },
    { separator: true },
    { label: '删除图层', variant: 'danger', onClick: () => store.removeLayer(layer.id) }
  ];
}

/** 在 (x,y) 打开图层右键菜单（先选中该图层） */
export function openLayerContextMenu(
  x: number,
  y: number,
  layer: Layer,
  handlers: CanvasMenuHandlers
): void {
  const store = useCanvasStore.getState();
  const selectedIds = store.project.selectedIds ?? [];
  if (!selectedIds.includes(layer.id)) store.selectLayer(layer.id);
  openContextMenu({ x, y, items: buildLayerMenuItems(layer, handlers) });
}

/** 在 (x,y) 打开画布空白处右键菜单 */
export function openCanvasContextMenu(x: number, y: number, handlers: CanvasMenuHandlers): void {
  const store = useCanvasStore.getState();
  openContextMenu({
    x,
    y,
    items: [
      { label: '添加图片…', variant: 'accent', onClick: handlers.onAddImage },
      { label: 'AI 扩图…', onClick: handlers.onOutpaint },
      { separator: true },
      {
        label: '整张发送到智能画布',
        disabled: store.project.layers.length === 0,
        children: smartCanvasSendChildren((f) => void compositeToSmartCanvas(f))
      },
      { separator: true },
      { label: '全选图层', onClick: () => store.selectAllLayers(), disabled: store.project.layers.length === 0 },
      { label: '适合屏幕', onClick: handlers.onFitScreen }
    ]
  });
}
