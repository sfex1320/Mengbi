/**
 * 文件对象的媒体类型判定 + Electron 本地路径提取。
 *
 * 视频一律走「本地路径」而不是 dataURI（几十 MB 的 base64 会撑爆内存与 localStorage）；
 * Electron 28 的 File 对象带非标准 `path` 属性（拖入 / 从资源管理器复制粘贴的文件都有），
 * 浏览器来源（网页拖图）没有 path——调用方需对 null 做降级提示。
 */

export const VIDEO_FILE_RE = /\.(mp4|mov|webm|mkv|m4v|avi)$/i;

export function isVideoFile(f: File): boolean {
  return f.type.startsWith('video/') || VIDEO_FILE_RE.test(f.name);
}

/** Electron 渲染进程里 File 的本地绝对路径（拿不到返回 null）。 */
export function electronFilePath(f: File): string | null {
  const p = (f as File & { path?: string }).path;
  return typeof p === 'string' && p.trim() ? p : null;
}

/**
 * 多个图片文件 → 字符串数组（本地路径优先，避免 base64 膨胀 localStorage；
 * 无 path 的网页拖图 / 粘贴退回 dataURI）。图片列表 / 循环图片批次共用。
 */
export async function filesToImageSrcs(files: File[]): Promise<string[]> {
  const out: string[] = [];
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue;
    const p = electronFilePath(f);
    if (p) {
      out.push(p);
      continue;
    }
    const du = await new Promise<string | null>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => resolve(null);
      r.readAsDataURL(f);
    });
    if (du) out.push(du);
  }
  return out;
}

// ── 资产库多类型收录（图片 / 视频 / SVG / PSD / PDF / Office）──

export type GalleryFileKind = 'image' | 'video' | 'svg' | 'psd' | 'pdf' | 'office';

/** 按扩展名判定资产库条目的文件类型（未识别一律按 image 处理，保持旧行为）。 */
export function fileKindOf(p: string): GalleryFileKind {
  const ext = (p.split('.').pop() ?? '').toLowerCase();
  if (['mp4', 'mov', 'webm', 'mkv', 'm4v', 'avi'].includes(ext)) return 'video';
  if (ext === 'svg') return 'svg';
  if (ext === 'psd' || ext === 'psb') return 'psd';
  if (ext === 'pdf') return 'pdf';
  if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext)) return 'office';
  return 'image';
}

/** 无法生成像素缩略图的类型 → 类型图标卡的图符与标签。 */
export const FILE_KIND_BADGE: Record<Exclude<GalleryFileKind, 'image' | 'svg'>, { icon: string; label: string }> = {
  video: { icon: '🎬', label: '视频' },
  psd: { icon: '🖌️', label: 'PSD' },
  pdf: { icon: '📄', label: 'PDF' },
  office: { icon: '📑', label: 'Office' }
};

/** 资产库「导入文件」对话框的扩展名清单（与主进程 api:gallery:import-files 白名单一致）。 */
export const GALLERY_IMPORT_EXTENSIONS = [
  'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg',
  'mp4', 'mov', 'webm', 'mkv', 'm4v', 'avi',
  'psd', 'psb', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'
];
