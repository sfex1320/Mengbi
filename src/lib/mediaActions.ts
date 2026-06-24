/**
 * 全应用通用的媒体操作（复制 / 另存 / 打开位置 / 作参考图 / 发送到智能画布）。
 * 统一预览（Lightbox）右键菜单与智能画布 nodeArea 共用——通用组件不反向依赖页面模块。
 */
import { toast } from '@/store/toastStore';
import { localPathToImageUrl } from '@/lib/imageUrl';
import { useShortcutsStore, type Shortcut } from '@/store/shortcutsStore';
import type { ContextMenuEntry } from '@/components/ContextMenu';

/** 已是可直接 fetch 的 URL（mengbi-image:// / blob: / http(s)）？raw 本地路径需要再包一层。 */
function isFetchableUrl(src: string): boolean {
  return /^(mengbi-image|blob|https?):/i.test(src);
}

/** 本地路径 / data:URI / mengbi-image:// URL → dataUri（入资产库 / 另存都需要）。失败返回 null。 */
export async function toDataUri(src: string): Promise<string | null> {
  if (src.startsWith('data:')) return src;
  try {
    const res = await fetch(isFetchableUrl(src) ? src : localPathToImageUrl(src));
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

/** 把一张图另存到磁盘（走「另存为」对话框）。 */
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

/** 在系统文件管理器里显示该文件。 */
export async function showInFolder(src: string): Promise<void> {
  if (src.startsWith('data:')) {
    toast.error('该项是内存数据，还没有落盘文件', '先「另存…」再打开目录');
    return;
  }
  const r = await window.electronAPI.storage.showInFolder(src);
  if (!r.ok) toast.error(r.error.message, r.error.hint);
}

/** 把一张图发回生图页作参考图（与资产库 / 画板同一通道 imageParamsStore.addRefs）。
 *  不做路由跳转（由调用方决定是否 navigate('/')）。返回是否成功。 */
export async function imageAsCreateRef(src: string): Promise<boolean> {
  const du = await toDataUri(src);
  if (!du) {
    toast.error('读取图片失败');
    return false;
  }
  const { useImageParamsStore } = await import('@/store/imageParamsStore');
  useImageParamsStore.getState().addRefs?.([{ dataUri: du, path: src.startsWith('data:') ? '' : src }]);
  toast.success('已作为参考图发到生图页');
  return true;
}

/** 把一张图发送到智能画布（收件箱 → 进入 /smart-canvas 后自动建图片节点）。 */
export async function imageToSmartCanvas(src: string, name?: string): Promise<void> {
  const { useSmartInboxStore } = await import('@/store/smartInboxStore');
  useSmartInboxStore.getState().push([{ kind: 'image', src, name }]);
  toast.success('已发送到智能画布', '切到「智能画布」即可看到');
}

// ──────────────────────────────────────────────────────────
// 「发送到侧栏快捷方式」—— 软件项=用该软件打开内容编辑；文件夹项=把内容放进该文件夹。
// 全应用右键菜单共用（buildShortcutSendMenuItems），侧栏拖入也复用 sendToShortcut。
// ──────────────────────────────────────────────────────────

export interface ShortcutContent {
  kind: 'image' | 'video' | 'text';
  /** image/video：本地路径 / mengbi-image:// / dataURI */
  src?: string;
  /** text：文本内容 */
  text?: string;
  /** 建议文件名（用于落盘命名，可不带扩展名） */
  name?: string;
}

function baseNameOf(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? 'file';
}

/** 把内容落成一个真实磁盘文件，返回路径（失败 null）。文字 → .txt；图/视频裸路径直接用，否则转 dataURI 落临时文件。 */
async function materializeContentToFile(content: ShortcutContent): Promise<string | null> {
  if (content.kind === 'text') {
    const r = await window.electronAPI.storage.saveTempText({
      text: content.text ?? '',
      suggestedName: content.name
    });
    return r.ok ? r.data.filePath : null;
  }
  const src = content.src;
  if (!src) return null;
  if (!src.startsWith('data:') && !isFetchableUrl(src)) return src; // 裸本地路径零拷贝
  const du = await toDataUri(src);
  if (!du) return null;
  const r = await window.electronAPI.storage.saveTempImage({ dataUri: du, suggestedName: content.name });
  return r.ok ? r.data.filePath : null;
}

/** 把内容发送到某个侧栏快捷方式：软件→用该软件打开；文件夹→放进该文件夹。 */
export async function sendToShortcut(shortcut: Shortcut, content: ShortcutContent): Promise<void> {
  const filePath = await materializeContentToFile(content);
  if (!filePath) {
    toast.error('准备内容失败', '无法读取该内容');
    return;
  }
  if (shortcut.kind === 'app') {
    const r = await window.electronAPI.shortcuts.openWith({ appPath: shortcut.path, filePath });
    if (r.ok) toast.success(`已用「${shortcut.label}」打开`);
    else toast.error('打开失败', r.error.message);
  } else {
    const r = await window.electronAPI.storage.copyInto({
      targetDir: shortcut.path,
      items: [{ src: filePath, destName: baseNameOf(filePath) }]
    });
    if (r.ok && r.data.saved.length) toast.success(`已放入「${shortcut.label}」`, r.data.saved[0].dest);
    else if (r.ok) toast.error('放入失败', r.data.failed[0]?.error ?? '未知错误');
    else toast.error('放入失败', r.error.message);
  }
}

/** 构造右键菜单的「发送到快捷方式 ▸」子菜单项；无快捷方式时返回空数组（菜单不显示该项）。 */
export function buildShortcutSendMenuItems(content: ShortcutContent): ContextMenuEntry[] {
  const shortcuts = useShortcutsStore.getState().shortcuts;
  if (!shortcuts.length) return [];
  return [
    {
      label: '发送到快捷方式',
      children: shortcuts.map((s) => ({
        label: (s.kind === 'app' ? '▶ ' : '📁 ') + s.label,
        onClick: () => void sendToShortcut(s, content)
      }))
    }
  ];
}
