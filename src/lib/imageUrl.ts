/**
 * 把本地绝对路径包成 mengbi-image:// URL，配合主进程注册的 protocol.handle 一起用。
 * 编码用 url-safe base64（替换 + / 为 - _，去尾部 =），放在 URL 的 path 段
 * （host 段会被 Chromium 强制小写，base64url 是大小写敏感的，不能用 host）。
 */
export function localPathToImageUrl(absPath: string): string {
  const enc = btoa(unescape(encodeURIComponent(absPath)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `mengbi-image://x/${enc}`;
}

/**
 * 把原图路径换成对应的缩略图绝对路径，与 [electron/services/thumbnail.ts](../../electron/services/thumbnail.ts)
 * 的 thumbPathFor 完全一致：
 *   {dir}/{base}.{ext}  →  {dir}/.thumbs/{base}.webp
 *
 * 用法：渲染卡片封面时优先用此函数；缩略图加载失败由 onError 回退到原图。
 * 由 generate.ts / tools.ts 在写库时同步生成缩略图，所以新落盘的图必有此文件；
 * 老图由 gallery list 触发的 enqueueBackfill 后台补。
 */
export function thumbUrlFromOriginalPath(absPath: string): string {
  // Win / posix 都支持
  const sep = absPath.includes('\\') ? '\\' : '/';
  const lastSep = absPath.lastIndexOf(sep);
  const dir = lastSep >= 0 ? absPath.slice(0, lastSep) : '';
  const fileName = lastSep >= 0 ? absPath.slice(lastSep + 1) : absPath;
  const lastDot = fileName.lastIndexOf('.');
  const base = lastDot >= 0 ? fileName.slice(0, lastDot) : fileName;
  const thumbAbs = `${dir}${sep}.thumbs${sep}${base}.webp`;
  return localPathToImageUrl(thumbAbs);
}
