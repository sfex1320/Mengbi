/**
 * 节点内文本/图片区域的通用交互：右上角复制按钮 + 右键菜单 + 文字自适应高度。
 */
import { openContextMenu, type ContextMenuEntry } from '@/components/ContextMenu';
import { toast } from '@/store/toastStore';
import { useSmartCanvasStore } from '@/store/smartCanvasStore';
import { localPathToImageUrl } from '@/lib/imageUrl';
import { CopyIcon } from './icons';

/** 本地路径 / data:URI → dataUri（入图库 / 另存都需要）。失败返回 null。 */
export async function toDataUri(src: string): Promise<string | null> {
  if (src.startsWith('data:')) return src;
  try {
    const res = await fetch(localPathToImageUrl(src));
    const blob = await res.blob();
    return await new Promise<string | null>((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/** 把一张图（节点里的结果/图片）写入图库。 */
export async function imageToGallery(src: string): Promise<void> {
  const du = await toDataUri(src);
  if (!du) {
    toast.error('读取图片失败');
    return;
  }
  const r = await window.electronAPI.gallery.importFromBuffer({ dataUri: du, kind: 'imported', notes: '智能画布' });
  if (r.ok) toast.success('已入图库');
  else toast.error(r.error.message, r.error.hint);
}

/** 把一张图另存到磁盘。 */
export async function imageSaveAs(src: string, name: string): Promise<void> {
  const du = await toDataUri(src);
  if (!du) {
    toast.error('读取图片失败');
    return;
  }
  const r = await window.electronAPI.storage.saveAs({ dataUri: du, defaultName: name });
  if (r.ok && r.data) toast.success('已另存', r.data.filePath);
  else if (!r.ok) toast.error(r.error.message, r.error.hint);
}

/** 把运行耗时（ms）格式化成「用时 X.Xs / X分X秒」，空值返回空串。 */
export function fmtDur(ms?: number): string {
  if (ms == null || !Number.isFinite(ms)) return '';
  if (ms >= 60000) return `用时 ${Math.floor(ms / 60000)}分${Math.round((ms % 60000) / 1000)}秒`;
  return `用时 ${(ms / 1000).toFixed(1)}s`;
}

/** 导出一段文本到磁盘（运行日志导出用）：转 data:URI → 走「另存为」对话框写盘。 */
export async function exportTextFile(defaultName: string, text: string): Promise<void> {
  const dataUri = `data:text/plain;charset=utf-8;base64,${btoa(unescape(encodeURIComponent(text)))}`;
  const r = await window.electronAPI.storage.saveAs({ dataUri, defaultName });
  if (r.ok && r.data) toast.success('已导出日志', r.data.filePath);
  else if (!r.ok) toast.error(r.error.message, r.error.hint);
}

export function copyText(text: string): void {
  if (!text) return;
  void navigator.clipboard
    .writeText(text)
    .then(() => toast.success('已复制文本'))
    .catch(() => toast.error('复制失败'));
}

export async function copyImage(url: string): Promise<void> {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    await navigator.clipboard.write([new ClipboardItem({ [blob.type || 'image/png']: blob })]);
    toast.success('已复制图片');
  } catch {
    toast.error('复制图片失败');
  }
}

/**
 * 用一段文字在源节点右侧新建一个「提示词节点」并选中（文本输出节点—— LLM / 视角 / ComfyUI / 结果——
 * 把输出文本直接导入下游提示词节点）。返回新节点 id；文本为空则提示并返回 null。
 */
export function makePromptNodeFrom(sourceId: string, text: string): string | null {
  const t = (text ?? '').trim();
  if (!t) {
    toast.error('没有可用的文本输出');
    return null;
  }
  const st = useSmartCanvasStore.getState();
  const self = st.nodes.find((n) => n.id === sourceId);
  const pos = self ? { x: self.position.x + (self.width ?? 260) + 60, y: self.position.y } : undefined;
  const nid = st.addNode('prompt', pos);
  st.updateNodeData(nid, { text: t });
  toast.success('已生成提示词节点');
  return nid;
}

/** 在光标处弹出区域右键菜单。 */
export function areaMenu(e: React.MouseEvent, items: ContextMenuEntry[]): void {
  e.preventDefault();
  e.stopPropagation();
  openContextMenu({ x: e.clientX, y: e.clientY, items });
}

/** 把节点高度自适应到内容（文字溢出时触发）。contentEl 为可滚动的文本元素。 */
export function fitNodeHeight(id: string, contentEl: HTMLElement | null): void {
  if (!contentEl) return;
  const h = Math.ceil(contentEl.scrollHeight) + 72; // 标题栏 + 内边距 + 手柄余量
  useSmartCanvasStore.getState().setNodeSize(id, { height: Math.max(140, h) });
}

/** 粗略估算一段文本在给定节点宽度下占用的高度（px），用于节点自适应增高。 */
export function estimateTextHeight(text: string, width: number, linePx = 18): number {
  if (!text) return 0;
  const perLine = Math.max(6, Math.floor((width - 30) / 8)); // ~8px/字符（中英混排取中）
  let lines = 0;
  for (const ln of text.split('\n')) lines += Math.max(1, Math.ceil(ln.length / perLine));
  return lines * linePx;
}

/** 自适应增高：内容需要更高就把节点撑高（只增不减、封顶；不进撤销栈）。 */
export function autoGrowNode(id: string, needed: number, maxH = 760): void {
  const st = useSmartCanvasStore.getState();
  const n = st.nodes.find((x) => x.id === id);
  if (!n) return;
  const cur = typeof n.height === 'number' ? n.height : n.measured?.height ?? 0;
  const target = Math.min(maxH, Math.ceil(needed));
  if (target > cur + 6) st.setNodeSize(id, { height: target });
}

/** 读节点当前宽度（非响应式，在 effect 内即时取）。
 *  不放进 effect 依赖：拖角/横向缩放会同时改 width，若依赖 width 会触发自适应把高度顶回去、互相打架。 */
export function getNodeWidth(id: string): number {
  const n = useSmartCanvasStore.getState().nodes.find((x) => x.id === id);
  return typeof n?.width === 'number' ? n.width : n?.measured?.width ?? 250;
}

/** 区域右上角的小复制按钮。 */
export function CopyButton({ onClick, title = '复制' }: { onClick: () => void; title?: string }): JSX.Element {
  return (
    <button
      className="mb-sc-copy nodrag"
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <CopyIcon size={13} />
    </button>
  );
}
