import { electronFilePath } from '@/lib/mediaFile';

/**
 * 资产库卡片「OS 原生拖出」期间的应用内握手（模块级登记）。
 *
 * 为什么需要它：原生拖出必须在 dragstart 里 e.preventDefault() 后立刻调
 * webContents.startDrag（经 preload 的 fire-and-forget IPC），此后这次拖拽对本窗口
 * 来说就是一次「外部文件拖入」——HTML5 dataTransfer 的自定义 MIME 全部失效，
 * dataTransfer.types 只剩 'Files'。但资产库内部的「拖卡成组 / 拖进文件夹卡 /
 * 拖到出组卡」必须继续工作，所以把本次拖拽的 id 与文件路径记到模块级变量，
 * 内部 drop 目标读不到自定义 MIME 时回退读这里。
 */

interface ActiveDrag {
  ids: number[];
  /** 本次拖出的文件绝对路径集合（已归一）——drop 时对账，防「变量残留 + 外部真文件拖入」误判为内部拖拽 */
  paths: Set<string>;
}

/** 路径对账用归一：统一反斜杠 + 小写（Windows 不分大小写；File.path 与 DB file_path 偶有分隔符差异） */
function normPath(p: string): string {
  return p.replace(/\//g, '\\').toLowerCase();
}

let active: ActiveDrag | null = null;
let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

/** 拖拽期间整窗压掉默认 dragover/drop：防自家文件落在非目标区域时 Chromium 导航到 file:// */
function onWindowDragOver(ev: DragEvent): void {
  ev.preventDefault();
}

function onWindowDrop(ev: DragEvent): void {
  ev.preventDefault();
  // 延后一拍再清空：window 级监听与目标卡片的 React onDrop 同帧派发，
  // 立即清空会让目标处理函数读不到载荷
  setTimeout(clearGalleryNativeDrag, 0);
}

function onWindowDragEnd(): void {
  setTimeout(clearGalleryNativeDrag, 0);
}

/**
 * dragstart 里调用：登记本次原生拖出的 id + 文件路径。
 * 原生拖拽结束时源元素的 HTML5 dragend 不一定触发（dragstart 已被取消），
 * 所以 window 'drop' / 'dragend' / 'pointerup' + 定时兜底 全部挂上，保证登记不残留。
 */
export function beginGalleryNativeDrag(ids: number[], paths: string[]): void {
  clearGalleryNativeDrag();
  active = { ids: [...ids], paths: new Set(paths.map(normPath)) };
  window.addEventListener('dragover', onWindowDragOver);
  window.addEventListener('drop', onWindowDrop);
  window.addEventListener('dragend', onWindowDragEnd);
  // OS 拖拽期间指针被系统接管，pointerup 不会立刻来；拖完后用户的下一次点击兜底清掉
  window.addEventListener('pointerup', onWindowDragEnd);
  fallbackTimer = setTimeout(clearGalleryNativeDrag, 120_000);
}

export function clearGalleryNativeDrag(): void {
  active = null;
  window.removeEventListener('dragover', onWindowDragOver);
  window.removeEventListener('drop', onWindowDrop);
  window.removeEventListener('dragend', onWindowDragEnd);
  window.removeEventListener('pointerup', onWindowDragEnd);
  if (fallbackTimer != null) {
    clearTimeout(fallbackTimer);
    fallbackTimer = null;
  }
}

/** 当前是否处于资产库原生拖出中（dragover 高亮判定用——原生拖拽的 types 只有 'Files'）。 */
export function isGalleryNativeDragActive(): boolean {
  return active !== null;
}

/**
 * 读取本次原生拖出的 id 列表（drop 时用）。
 * 传入落下的文件列表时做「路径对账」：只要混入了不属于本次拖出的文件
 * （例如登记残留后用户从资源管理器拖真文件进来），判为外部拖入返回 null。
 */
export function readGalleryNativeDragIds(files?: FileList | null): number[] | null {
  const a = active;
  if (!a) return null;
  if (files && files.length) {
    for (let i = 0; i < files.length; i++) {
      const p = electronFilePath(files[i]);
      if (p && !a.paths.has(normPath(p))) return null;
    }
  }
  return [...a.ids];
}

/**
 * 这批文件路径是否全部来自本次资产库原生拖出。
 * Sidebar 用：把自家卡片拖回「资产库」主功能按钮时跳过导入（本就在库里，防重复收录）。
 */
export function pathsAllFromGalleryDrag(paths: string[]): boolean {
  const a = active;
  if (!a || !paths.length) return false;
  return paths.every((p) => a.paths.has(normPath(p)));
}
