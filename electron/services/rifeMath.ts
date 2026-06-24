/**
 * RIFE 插帧管线的纯函数（零 electron import，可直接 vitest）。
 *
 * - parseFfmpegMediaInfo：从 `ffmpeg -i` 的 stderr 解析 fps / 时长 / 有无音轨
 *   （ffmpeg-static 不带 ffprobe，探测只能靠解析 -i 输出）
 * - computeTargetFrames：源帧数 × 目标帧率 / 源帧率 → 目标总帧数（rife v4 系 -n 参数）
 * - overallPercent：三阶段（拆帧/插帧/合帧）定额映射到总进度 0-100
 */

export interface FfmpegMediaInfo {
  /** 视频帧率；解析不出为 null（调用方用 帧数/时长 兜底） */
  fps: number | null;
  /** 时长（秒）；解析不出为 null */
  durationSec: number | null;
  /** 是否有音频流（合帧时决定要不要带回音轨） */
  hasAudio: boolean;
}

/** 解析 `ffmpeg -hide_banner -i <src>` 的 stderr（该命令必然退出码 1，只取文本）。 */
export function parseFfmpegMediaInfo(stderr: string): FfmpegMediaInfo {
  // fps 优先（如 "1280x720, 24 fps, 24 tbr"），没有 fps 字样时回退 tbr
  let fps: number | null = null;
  const fpsM = stderr.match(/(\d+(?:\.\d+)?)\s*fps\b/);
  if (fpsM) {
    fps = parseFloat(fpsM[1]);
  } else {
    const tbrM = stderr.match(/(\d+(?:\.\d+)?)\s*tbr\b/);
    if (tbrM) fps = parseFloat(tbrM[1]);
  }
  if (fps != null && (!isFinite(fps) || fps <= 0)) fps = null;

  let durationSec: number | null = null;
  const durM = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (durM) {
    durationSec = parseInt(durM[1], 10) * 3600 + parseInt(durM[2], 10) * 60 + parseFloat(durM[3]);
    if (!isFinite(durationSec) || durationSec < 0) durationSec = null;
  }

  const hasAudio = /Stream #\d+:\d+[^\n]*?:\s*Audio/.test(stderr);
  return { fps, durationSec, hasAudio };
}

/** 从 ffmpeg 进度行抠最新的 `frame= N`（一段 chunk 里可能有多行，取最后一个）；没有则 null。 */
export function parseFfmpegFrameProgress(chunk: string): number | null {
  const matches = chunk.match(/frame=\s*(\d+)/g);
  if (!matches || matches.length === 0) return null;
  const last = matches[matches.length - 1].match(/(\d+)/);
  return last ? parseInt(last[1], 10) : null;
}

/** 目标总帧数 = round(源帧数 × 目标帧率 / 源帧率)。入参非法返回 0（调用方报错）。 */
export function computeTargetFrames(srcFrames: number, srcFps: number, targetFps: number): number {
  if (!isFinite(srcFrames) || !isFinite(srcFps) || !isFinite(targetFps)) return 0;
  if (srcFrames <= 0 || srcFps <= 0 || targetFps <= 0) return 0;
  return Math.round((srcFrames * targetFps) / srcFps);
}

/** 三阶段定额：拆帧 0-15% / 插帧 15-85% / 合帧 85-100%。stageRatio 越界自动夹到 [0,1]。 */
export function overallPercent(stage: 'extract' | 'interp' | 'encode', stageRatio: number): number {
  const r = Math.min(1, Math.max(0, isFinite(stageRatio) ? stageRatio : 0));
  if (stage === 'extract') return Math.round(r * 15);
  if (stage === 'interp') return Math.round(15 + r * 70);
  return Math.round(85 + r * 15);
}
