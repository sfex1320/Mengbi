import { describe, it, expect } from 'vitest';
import {
  parseFfmpegMediaInfo,
  parseFfmpegFrameProgress,
  computeTargetFrames,
  overallPercent
} from './rifeMath';

// 真实 ffmpeg -i stderr 节选样本
const STDERR_24FPS_AUDIO = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'in.mp4':
  Metadata:
    major_brand     : isom
  Duration: 00:00:05.04, start: 0.000000, bitrate: 2429 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 1280x720 [SAR 1:1 DAR 16:9], 2295 kb/s, 24 fps, 24 tbr, 12288 tbn (default)
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, stereo, fltp, 128 kb/s (default)`;

const STDERR_2398FPS_NO_AUDIO = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'movie.mov':
  Duration: 00:01:30.50, start: 0.000000, bitrate: 8000 kb/s
  Stream #0:0(und): Video: h264, yuv420p, 1920x1080, 23.98 fps, 23.98 tbr, 24k tbn`;

const STDERR_TBR_ONLY = `Input #0, matroska,webm, from 'clip.webm':
  Duration: 00:00:10.00, start: 0.000000, bitrate: 1000 kb/s
  Stream #0:0: Video: vp9, yuv420p, 640x360, 30 tbr, 1k tbn`;

describe('parseFfmpegMediaInfo', () => {
  it('解析 24fps + 时长 + 有音轨', () => {
    const r = parseFfmpegMediaInfo(STDERR_24FPS_AUDIO);
    expect(r.fps).toBe(24);
    expect(r.durationSec).toBeCloseTo(5.04, 2);
    expect(r.hasAudio).toBe(true);
  });

  it('解析 23.98fps 小数帧率 + 无音轨', () => {
    const r = parseFfmpegMediaInfo(STDERR_2398FPS_NO_AUDIO);
    expect(r.fps).toBeCloseTo(23.98, 2);
    expect(r.durationSec).toBeCloseTo(90.5, 1);
    expect(r.hasAudio).toBe(false);
  });

  it('无 fps 字样时回退 tbr', () => {
    const r = parseFfmpegMediaInfo(STDERR_TBR_ONLY);
    expect(r.fps).toBe(30);
    expect(r.durationSec).toBeCloseTo(10, 1);
    expect(r.hasAudio).toBe(false);
  });

  it('完全解析不出时返回 null/false（不抛错）', () => {
    const r = parseFfmpegMediaInfo('garbage output');
    expect(r.fps).toBeNull();
    expect(r.durationSec).toBeNull();
    expect(r.hasAudio).toBe(false);
  });
});

describe('parseFfmpegFrameProgress', () => {
  it('一段 chunk 里多个 frame= 取最后一个', () => {
    const chunk = 'frame=   10 fps=0.0 q=-1.0\rframe=   58 fps= 57 q=29.0 size=256KiB\rframe=  120 fps= 60';
    expect(parseFfmpegFrameProgress(chunk)).toBe(120);
  });

  it('没有 frame= 返回 null', () => {
    expect(parseFfmpegFrameProgress('Press [q] to stop')).toBeNull();
  });
});

describe('computeTargetFrames', () => {
  it('24→60：120 帧 → 300 帧', () => {
    expect(computeTargetFrames(120, 24, 60)).toBe(300);
  });

  it('23.98→60 非整倍取整', () => {
    // 2170 × 60 / 23.98 ≈ 5429.5
    expect(computeTargetFrames(2170, 23.98, 60)).toBe(5430);
  });

  it('非法入参返回 0', () => {
    expect(computeTargetFrames(0, 24, 60)).toBe(0);
    expect(computeTargetFrames(120, 0, 60)).toBe(0);
    expect(computeTargetFrames(120, 24, 0)).toBe(0);
    expect(computeTargetFrames(NaN, 24, 60)).toBe(0);
  });
});

describe('overallPercent', () => {
  it('三阶段定额边界：拆帧 0-15 / 插帧 15-85 / 合帧 85-100', () => {
    expect(overallPercent('extract', 0)).toBe(0);
    expect(overallPercent('extract', 1)).toBe(15);
    expect(overallPercent('interp', 0)).toBe(15);
    expect(overallPercent('interp', 1)).toBe(85);
    expect(overallPercent('encode', 0)).toBe(85);
    expect(overallPercent('encode', 1)).toBe(100);
  });

  it('ratio 越界 / 非数值夹回 [0,1]', () => {
    expect(overallPercent('interp', 2)).toBe(85);
    expect(overallPercent('interp', -1)).toBe(15);
    expect(overallPercent('extract', NaN)).toBe(0);
  });
});
