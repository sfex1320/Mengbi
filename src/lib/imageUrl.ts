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
