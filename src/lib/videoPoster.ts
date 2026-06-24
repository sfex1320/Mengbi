/** 黑帧判定阈值：平均亮度（0-255）低于此值视为黑帧/纯暗场。 */
const BLACK_LUMA_THRESHOLD = 18;

/** 估算一帧的平均亮度（0-255）。在小取样画布上算，避免大图 getImageData 开销。失败返回 -1。 */
function frameMeanLuma(video: HTMLVideoElement): number {
  try {
    const sw = 32;
    const sh = 32;
    const c = document.createElement('canvas');
    c.width = sw;
    c.height = sh;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return -1;
    ctx.drawImage(video, 0, 0, sw, sh);
    const data = ctx.getImageData(0, 0, sw, sh).data;
    let sum = 0;
    let n = 0;
    for (let i = 0; i + 3 < data.length; i += 4) {
      if (data[i + 3] < 8) continue; // 跳过透明
      sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      n++;
    }
    return n > 0 ? sum / n : -1;
  } catch {
    return -1;
  }
}

function drawToWebp(video: HTMLVideoElement): string | null {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);
    return canvas.toDataURL('image/webp', 0.82);
  } catch {
    return null;
  }
}

/**
 * 视频封面抓帧（资产库缩略图用，免 ffmpeg）：用隐藏 <video> 解码 → canvas → webp dataURI。
 * 走 blob URL（先 fetch 成 blob 再 createObjectURL）以保证同源，避免 canvas 被跨源污染导致 toDataURL 抛错。
 * 封面逻辑：默认取首帧；若首帧为黑帧/纯暗场，则按 10%/30%/50%/70% 时间点依次找第一张非黑帧；
 * 全程都黑则退回到这些候选里最亮的一张（再不行才 null）。任何失败 / 超时都返回 null（调用方静默忽略）。
 */
function grabFirstFrame(objUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false;
    let firstChecked = false; // loadeddata 已评估过真·首帧
    let candidates: number[] = []; // 黑帧兜底的候选时间点
    let ci = 0;
    let brightest: { luma: number; uri: string } | null = null;
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
    const timer = window.setTimeout(() => finish(brightest?.uri ?? null), 12000);
    video.muted = true;
    video.preload = 'auto';
    video.playsInline = true;
    video.style.position = 'fixed';
    video.style.left = '-9999px';
    video.style.width = '64px';
    video.style.height = '64px';

    const seekNextFallback = (): void => {
      if (ci >= candidates.length) {
        // 候选耗尽：退回最亮的一张（可能仍偏暗，但好过空封面）
        finish(brightest?.uri ?? null);
        return;
      }
      try {
        video.currentTime = candidates[ci];
      } catch {
        finish(brightest?.uri ?? null);
      }
    };

    /** 评估当前帧；非黑则采用，黑则记录最亮并尝试下一个兜底时间点。 */
    const evaluate = (): void => {
      if (!video.videoWidth || !video.videoHeight) {
        finish(null);
        return;
      }
      const luma = frameMeanLuma(video);
      const uri = drawToWebp(video);
      if (uri && (!brightest || luma > brightest.luma)) brightest = { luma, uri };
      // 非黑帧（或亮度无法判定时也接受）→ 直接采用
      if (uri && luma >= BLACK_LUMA_THRESHOLD) {
        finish(uri);
        return;
      }
      seekNextFallback();
      ci++;
    };

    // 真·首帧：loadeddata 时直接评估当前（t=0）帧，无需 seek（最贴合「截取第一帧」语义）
    video.addEventListener('loadeddata', () => {
      if (firstChecked || done) return;
      firstChecked = true;
      const dur = isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
      candidates = dur > 0 ? [dur * 0.1, dur * 0.3, dur * 0.5, dur * 0.7] : [];
      if (video.readyState >= 2) evaluate();
    });
    // 兜底 seek 完成后再评估
    video.addEventListener('seeked', () => {
      if (firstChecked && !done) evaluate();
    });
    video.addEventListener('error', () => finish(brightest?.uri ?? null));
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

/** 从视频均匀抽 N 帧（避开首尾极端）→ webp data:URI[]，用于视频反推喂多图给视觉模型。失败/超时返回 []。 */
function grabFrames(objUrl: string, count: number): Promise<string[]> {
  return new Promise((resolve) => {
    const out: string[] = [];
    let done = false;
    let times: number[] = [];
    let idx = 0;
    const video = document.createElement('video');
    const canvas = document.createElement('canvas');
    const finish = (): void => {
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
      resolve(out);
    };
    const timer = window.setTimeout(finish, 25000);
    video.muted = true;
    video.preload = 'auto';
    video.playsInline = true;
    video.style.position = 'fixed';
    video.style.left = '-9999px';
    video.style.width = '64px';
    video.style.height = '64px';
    const grabAt = (): void => {
      if (idx >= times.length) {
        finish();
        return;
      }
      try {
        video.currentTime = times[idx];
      } catch {
        finish();
      }
    };
    video.addEventListener('loadedmetadata', () => {
      const dur = isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
      times = Array.from({ length: count }, (_, i) => (dur > 0 ? (dur * (i + 0.5)) / count : 0));
      grabAt();
    });
    video.addEventListener('seeked', () => {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (w && h) {
        try {
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(video, 0, 0, w, h);
            out.push(canvas.toDataURL('image/webp', 0.8));
          }
        } catch {
          /* ignore */
        }
      }
      idx++;
      if (out.length >= count) {
        finish();
        return;
      }
      grabAt();
    });
    video.addEventListener('error', finish);
    document.body.appendChild(video);
    video.src = objUrl;
    video.load();
  });
}

export async function captureVideoFrames(srcUrl: string, count = 6): Promise<string[]> {
  let objUrl: string | null = null;
  try {
    const res = await fetch(srcUrl);
    if (!res.ok) return [];
    const blob = await res.blob();
    objUrl = URL.createObjectURL(blob);
    return await grabFrames(objUrl, Math.max(1, Math.min(12, count)));
  } catch {
    return [];
  } finally {
    if (objUrl) URL.revokeObjectURL(objUrl);
  }
}
