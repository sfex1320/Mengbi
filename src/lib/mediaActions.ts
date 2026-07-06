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

/** 把任意图片 blob 解码后重新编码成 PNG。
 *  Chromium 异步剪贴板的图片写入只可靠支持 image/png——webp/jpeg 的 ClipboardItem 会被拒。 */
async function blobToPngBlob(blob: Blob): Promise<Blob> {
  if (blob.type === 'image/png') return blob;
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return blob;
  ctx.drawImage(bmp, 0, 0);
  bmp.close?.();
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob 失败'))), 'image/png');
  });
}

export async function copyImage(url: string): Promise<void> {
  // 关键：把 Promise<Blob> 直接交给 ClipboardItem（而不是先 await fetch 再 write）——
  // 否则大图 fetch 期间用户手势的 transient activation 会过期 → clipboard.write 抛 NotAllowedError
  // （表现就是「右键复制没反应/复制失败」）。同时统一转 PNG，规避非 PNG 类型被拒。
  try {
    const item = new ClipboardItem({
      'image/png': fetch(url)
        .then((r) => r.blob())
        .then(blobToPngBlob)
    });
    await navigator.clipboard.write([item]);
    toast.success('已复制图片');
    return;
  } catch {
    /* 部分环境不支持把 Promise 交给 ClipboardItem → 回退到先取后写 */
  }
  try {
    const blob = await blobToPngBlob(await (await fetch(url)).blob());
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
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
  if (shortcut.kind === 'url') {
    toast.error('网址链接不能作为发送目标', '请用文件夹或软件类型的快捷方式');
    return;
  }
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

/** 构造右键菜单的「发送到快捷方式 ▸」子菜单项。
 *  只有「文件夹 / 软件」类型的快捷方式可作发送目标（网址链接不能收文件）。
 *  没有可用目标时不再隐藏整项，而是给一个禁用提示——否则用户看不到入口，会误以为功能「失效」。 */
export function buildShortcutSendMenuItems(content: ShortcutContent): ContextMenuEntry[] {
  const targets = useShortcutsStore.getState().shortcuts.filter((s) => s.kind === 'app' || s.kind === 'folder');
  if (!targets.length) {
    return [
      {
        label: '发送到快捷方式（先在左侧栏添加 文件夹/软件 快捷方式）',
        disabled: true
      }
    ];
  }
  return [
    {
      label: '发送到快捷方式',
      children: targets.map((s) => ({
        label: (s.kind === 'app' ? '▶ ' : '📁 ') + s.label,
        onClick: () => void sendToShortcut(s, content)
      }))
    }
  ];
}
