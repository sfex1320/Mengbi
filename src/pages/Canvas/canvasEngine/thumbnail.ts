/**
 * 把任意 src（路径或 dataUri）缩到 ≤ targetSize 的 webp dataUri。
 * 用于 LayerPanel 列表项缩略图，控制单图 < 30KB，避免列表卡顿。
 */
export async function makeLayerThumbnail(
  src: string,
  targetSize = 80
): Promise<string> {
  const img = await loadImage(src);
  const ratio = Math.max(img.width, img.height) / targetSize;
  const w = Math.max(1, Math.round(img.width / Math.max(1, ratio)));
  const h = Math.max(1, Math.round(img.height / Math.max(1, ratio)));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0, w, h);
  return c.toDataURL('image/webp', 0.75);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load: ${src}`));
    img.src = src;
  });
}
