/**
 * 视频封面抓帧（图库缩略图用，免 ffmpeg）：用隐藏 <video> 解码首帧 → canvas → webp dataURI。
 * 走 blob URL（先 fetch 成 blob 再 createObjectURL）以保证同源，避免 canvas 被跨源污染导致 toDataURL 抛错。
 * 任何失败 / 超时都返回 null（调用方静默忽略）。
 */
function grabFirstFrame(objUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false;
    const video = document.createElement('video');
    const finish = (v: string | null): void => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      try {
        video.removeAttribute('src');
        video.load();
      } catch {
        /* ignore */
      }
      video.remove();
      resolve(v);
    };
    const timer = window.setTimeout(() => finish(null), 8000);
    video.muted = true;
    video.preload = 'auto';
    video.playsInline = true;
    video.style.position = 'fixed';
    video.style.left = '-9999px';
    video.style.width = '64px';
    video.style.height = '64px';
    const grab = (): void => {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) {
        finish(null);
        return;
      }
      try {
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          finish(null);
          return;
        }
        ctx.drawImage(video, 0, 0, w, h);
        finish(canvas.toDataURL('image/webp', 0.82));
      } catch {
        finish(null);
      }
    };
    video.addEventListener('loadeddata', () => {
      if (video.readyState >= 2) grab();
    });
    video.addEventListener('error', () => finish(null));
    document.body.appendChild(video);
    video.src = objUrl;
    video.load();
  });
}

export async function captureVideoPoster(srcUrl: string): Promise<string | null> {
  let objUrl: string | null = null;
  try {
    const res = await fetch(srcUrl);
    if (!res.ok) return null;
    const blob = await res.blob();
    objUrl = URL.createObjectURL(blob);
    return await grabFirstFrame(objUrl);
  } catch {
    return null;
  } finally {
    if (objUrl) URL.revokeObjectURL(objUrl);
  }
}
