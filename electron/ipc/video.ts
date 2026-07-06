import { app, type WebContents } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { getSharp } from '../services/sharpLazy';
import ffmpegPath from 'ffmpeg-static';
import { register, ok, err, appendNotification, parseModelRef } from './helpers';
import { VideoGenerateSchema, VideoCancelSchema, VideoScaleSchema, VideoSaveThumbSchema, VideoUploadAssetSchema, VideoEditSchema } from './schemas';
import { getDb } from '../services/db';
import { decryptString } from '../services/safeStorage';
import { chromiumFetch } from '../services/httpClient';
import { applyHeaderOverrides } from './headerOverrides';
import { thumbPathFor } from '../services/thumbnail';
import { insertProducedMedia, broadcastGalleryChanged } from '../services/producedMedia';
import { logger } from '../services/logger';
import { makeError } from '@shared/error';
import type { VideoKind } from '@shared/domain';
import { normalizeVideoKind, autoCorrectVideoKind } from '@shared/domain';
import type { VideoGenerateInput, VideoProgressPayload, VideoDonePayload } from '@shared/ipc';
import type { VideoTaskStatusState } from '@shared/video';
import { mergeVideoProvidersConfig, findVideoModel } from '@shared/videoProviders';
import { isAdapterKind, getVideoAdapter } from '../services/video/registry';
import type { AdapterContext } from '../services/video/adapter';
import { joinUrl, safeJson as adapterSafeJson } from '../services/video/adapter';
import { buildClipFilterGraph, type ClipInput, type VideoTransition } from '../services/video/clipGraph';
import { existsSync } from 'node:fs';

/**
 * AI 视频生成（异步：提交任务 → 轮询 → 下载 mp4 落盘 + 入资产库）。
 * 三种协议（video_kind）：
 *   - kling   可灵代理型（中转站最主流）：POST {root}/kling/v1/videos/{text2video|image2video} → 轮询 .../{task_id}
 *   - sora    OpenAI Sora 原生：POST {base}/v1/videos → 轮询 GET /v1/videos/{id} → GET /v1/videos/{id}/content
 *   - unified 聚合站统一端点：POST {root}/video/generations → 轮询 → video.url / data[0].url
 * 各站字段差异用 body_overrides_json 顶层合并兜底（与 image 思路一致）。
 */

interface ResolvedVideoCfg {
  base_url: string;
  apiKey: string;
  actualModelId: string;
  video_kind: VideoKind;
  body_overrides_json: string | null;
  /** 自定义请求头 JSON（header 名→值）；legacy 引擎(kling/sora/unified)生效，null = 不覆盖 */
  header_overrides_json: string | null;
}

const POLL_INTERVAL_MS = 8000;
// 2026-06-12 起视频等待**不限时**（用户决策：视频生成动辄十几分钟到半小时+，固定 10 分钟必误杀）：
// 只要后台报告「任务进行中」就一直轮询等待；判失败只有两种情况——
//   ① 上游明确报告任务失败；② 状态查询本身连续失败 N 次（任务可能已丢/网络长断）。
// 用户仍可在「高级：视频供应商微调」给单个供应商显式设上限（timeout>0 时生效）。
const MAX_CONSECUTIVE_POLL_ERRORS = 45; // 连续 ~6 分钟（45×8s）查询失败才放弃

/** 不限时等待下的进度斜坡：无真实进度时随时间缓慢爬升（~+4%/分钟），封顶 90%。 */
function timeRamp(startMs: number): number {
  const min = (Date.now() - startMs) / 60000;
  return Math.min(90, 12 + Math.round(min * 4));
}

const activeTasks = new Map<string, AbortController>();

export function registerVideoHandlers(): void {
  register('api:video:generate', VideoGenerateSchema, async (input, event) => {
    const cfg = findVideoConfig(input.modelId);
    if (!cfg) {
      return err(
        makeError('VALIDATION_FAILED', `没找到视频模型「${input.modelId}」的配置`, {
          severity: 'toast',
          hint: '到「设置 → 视频模型」添加，并在模型映射里加入该显示名'
        })
      );
    }
    const taskId = randomUUID();
    const ctrl = new AbortController();
    activeTasks.set(taskId, ctrl);
    // 异步执行，不阻塞 IPC 返回；进度/完成走推送
    void runVideoTask(taskId, cfg, input, event.sender, ctrl.signal).finally(() =>
      activeTasks.delete(taskId)
    );
    return ok({ taskId });
  });

  register('api:video:cancel', VideoCancelSchema, async (taskId) => {
    const ctrl = activeTasks.get(taskId);
    if (ctrl) ctrl.abort();
    activeTasks.delete(taskId);
    return ok(true as const);
  });

  // 视频封面：渲染端抓首帧（webp dataURI）→ 这里写成资产库缩略图 + 更新 images.thumbnail_path。
  // 失败一律 silent（封面是锦上添花，缺了不影响视频本身）。
  register('api:video:save-thumbnail', VideoSaveThumbSchema, async (input) => {
    const row = getDb().prepare(`SELECT file_path FROM images WHERE id = ?`).get(input.imageId) as
      | { file_path: string }
      | undefined;
    if (!row?.file_path) return err(makeError('VALIDATION_FAILED', '找不到该视频记录', { severity: 'silent' }));
    const m = input.dataUri.match(/^data:[^;]+;base64,(.*)$/);
    if (!m) return err(makeError('VALIDATION_FAILED', '封面数据无效', { severity: 'silent' }));
    const out = thumbPathFor(row.file_path);
    try {
      await fs.mkdir(path.dirname(out), { recursive: true });
      const sharp = await getSharp();
      await sharp(Buffer.from(m[1], 'base64'), { failOn: 'none' })
        .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toFile(out);
      getDb().prepare(`UPDATE images SET thumbnail_path = ? WHERE id = ?`).run(out, input.imageId);
      return ok({ thumbnail: out });
    } catch (e) {
      logger.warn(`[video] save thumbnail failed: ${(e as Error).message}`);
      return err(makeError('FILE_PERMISSION', '封面写入失败', { severity: 'silent' }));
    }
  });

  // 素材上传：本地图片/视频/音频 → 供应商 uploadEndpoint（multipart）→ 返回公网 URL。
  // 无 uploadEndpoint 时明确报错引导用户用公网 URL（不把 file:// 发给远端）。
  register('api:video:upload-asset', VideoUploadAssetSchema, async (input) => {
    const cfg = findVideoConfig(input.modelId);
    if (!cfg) {
      return err(makeError('VALIDATION_FAILED', `没找到视频模型「${input.modelId}」的配置`, { severity: 'toast' }));
    }
    const merged = loadMergedVideoConfig();
    const provider = merged.providers[cfg.video_kind ?? 'kling'];
    const uploadEndpoint = provider?.uploadEndpoint?.trim();
    if (!uploadEndpoint) {
      return err(
        makeError('VALIDATION_FAILED', '该供应商未配置上传端点（uploadEndpoint）', {
          severity: 'toast',
          hint: '参考视频/音频请改用公网可访问 URL，或到「视频模型配置中心」填写上传端点'
        })
      );
    }
    // 取字节 + 基础检查（大小/格式）
    let bytes: Buffer;
    let filename = input.filename ?? 'asset';
    try {
      if (input.filePath) {
        const stat = await fs.stat(input.filePath);
        const capMb = input.kind === 'image' ? 30 : 300;
        if (stat.size > capMb * 1024 * 1024) {
          return err(makeError('VALIDATION_FAILED', `文件过大（>${capMb}MB）`, { severity: 'toast' }));
        }
        bytes = await fs.readFile(input.filePath);
        filename = path.basename(input.filePath);
      } else {
        const m = (input.dataUri ?? '').match(/^data:([^;]+);base64,(.*)$/);
        if (!m) return err(makeError('VALIDATION_FAILED', '素材数据无效', { severity: 'toast' }));
        bytes = Buffer.from(m[2], 'base64');
      }
    } catch (e) {
      return err(makeError('FILE_PERMISSION', `读取素材失败：${(e as Error).message}`, { severity: 'toast' }));
    }

    const baseUrl = provider.baseUrl && provider.baseUrl.trim() ? provider.baseUrl : cfg.base_url;
    const url = joinUrl(baseUrl, uploadEndpoint);
    const mime = guessAssetMime(filename, input.kind);
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(bytes)], { type: mime }), filename);
    try {
      const res = await chromiumFetch(url, {
        method: 'POST',
        headers: applyHeaderOverrides(
          { Authorization: `Bearer ${cfg.apiKey}` },
          cfg.header_overrides_json,
          { key: cfg.apiKey, model: cfg.actualModelId }
        ),
        body: form
      });
      const text = await res.text();
      if (!res.ok) {
        return err(
          makeError('UNKNOWN', `上传失败 HTTP ${res.status}：${scrubKey(text.slice(0, 300), cfg.apiKey)}`, {
            severity: 'toast'
          })
        );
      }
      const assetUrl = extractAssetUrl(adapterSafeJson(text));
      if (!assetUrl) {
        return err(
          makeError('UNKNOWN', `上传成功但未返回 URL：${scrubKey(text.slice(0, 200), cfg.apiKey)}`, { severity: 'toast' })
        );
      }
      return ok({ url: assetUrl });
    } catch (e) {
      return err(makeError('UNKNOWN', `上传异常：${scrubKey((e as Error).message, cfg.apiKey)}`, { severity: 'toast' }));
    }
  });

  register('api:video:scale', VideoScaleSchema, async (input) => scaleVideoWithFfmpeg(input));
  register('api:video:edit', VideoEditSchema, async (input) => editVideoWithFfmpeg(input));
}

/** 用 ffmpeg 缩放/补帧视频（重编码 mp4，保留/转码音频）。输入只接本地路径或 http(s) URL（不接 data:）。 */
async function scaleVideoWithFfmpeg(input: {
  inputPath: string;
  width?: number | null;
  height?: number | null;
  fps?: number | null;
}): Promise<ReturnType<typeof ok> | ReturnType<typeof err>> {
  // 打包后 ffmpeg-static 返回的路径指向 app.asar 内，但二进制经 asarUnpack 解包到 app.asar.unpacked，需重映射（dev 下无 app.asar，replace 为空操作）
  const bin = (ffmpegPath as string | null)?.replace('app.asar', 'app.asar.unpacked') ?? null;
  if (!bin) return err(makeError('UNKNOWN', 'ffmpeg 不可用（未解析到内置二进制）', { severity: 'toast' }));
  const src = input.inputPath.trim();
  if (!src || src.startsWith('data:')) {
    return err(makeError('VALIDATION_FAILED', '视频缩放只支持本地文件或公网 URL', { severity: 'toast' }));
  }
  const w = input.width && input.width > 0 ? Math.round(input.width) : null;
  const h = input.height && input.height > 0 ? Math.round(input.height) : null;
  const fps = input.fps && input.fps > 0 ? Math.round(input.fps) : null;
  if (!w && !h && !fps) return err(makeError('VALIDATION_FAILED', '请指定目标宽/高或补帧帧率', { severity: 'toast' }));
  const filters: string[] = [];
  // -2：保持比例并对齐到偶数（H.264 要求偶数边）
  if (w || h) filters.push(w && h ? `scale=${w}:${h}` : w ? `scale=${w}:-2` : `scale=-2:${h}`);
  // minterpolate 运动补偿插帧（非简单重复帧）：把 Seedance 等固定 24fps 的产出补到 30/60，肉眼可见更流畅。CPU 重，慢。
  if (fps) filters.push(`minterpolate=fps=${fps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1`);
  const filter = filters.join(',');

  const root = getVideoStorageRoot();
  const date = new Date().toISOString().slice(0, 10);
  const dir = path.join(root, date);
  await fs.mkdir(dir, { recursive: true });
  const out = path.join(dir, `scaled-${Date.now()}.mp4`);

  // -movflags +faststart：moov 移到文件头，<video> 起播无需先 seek 到尾部（缩放/补帧产物默认 moov 在尾）。
  const args = ['-y', '-i', src, '-vf', filter, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out];
  return await new Promise((resolve) => {
    let stderr = '';
    let settled = false;
    const child = spawn(bin, args, { windowsHide: true });
    const killTimer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }, fps ? 900_000 : 300_000); // 缩放 5 分钟兜底；补帧（minterpolate）CPU 重，放宽到 15 分钟
    child.stderr?.on('data', (d) => {
      stderr += String(d);
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });
    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      resolve(err(makeError('UNKNOWN', `ffmpeg 启动失败：${e.message}`, { severity: 'toast' })));
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      if (code === 0) {
        // 软件产物一律入库（封面由渲染端抓帧补）；insertProducedMedia 永不抛
        const tag = [w || h ? `${w ?? '自动'}×${h ?? '自动'}` : null, fps ? `补帧${fps}fps` : null]
          .filter(Boolean)
          .join(' ');
        void insertProducedMedia({
          filePath: out,
          kind: 'video',
          notes: `[scale] 视频${tag ? ` ${tag}` : '处理'}`,
          params: { width: w, height: h, fps }
        }).then((imageId) => resolve(ok({ path: out, imageId: imageId ?? undefined })));
      } else {
        resolve(err(makeError('UNKNOWN', `视频缩放失败(ffmpeg ${code})：${stderr.slice(-280)}`, { severity: 'toast' })));
      }
    });
  });
}

// ───────────────────────── 视频编辑（ffmpeg：裁切 / 调色 / 声音 / 合并）─────────────────────────

/** 解析 ffmpeg-static 二进制路径（打包后重映射到 asar.unpacked）。 */
function resolveFfmpegBin(): string | null {
  return (ffmpegPath as string | null)?.replace('app.asar', 'app.asar.unpacked') ?? null;
}

/** 文字叠加用的字体文件：按平台找一个能渲染中文的系统字体；找不到返回 null（则不渲染文字）。 */
function resolveOverlayFont(): string | null {
  const candidates =
    process.platform === 'win32'
      ? ['C:/Windows/Fonts/msyh.ttc', 'C:/Windows/Fonts/msyhbd.ttc', 'C:/Windows/Fonts/simhei.ttf', 'C:/Windows/Fonts/simsun.ttc', 'C:/Windows/Fonts/arial.ttf']
      : process.platform === 'darwin'
        ? ['/System/Library/Fonts/PingFang.ttc', '/System/Library/Fonts/STHeiti Medium.ttc', '/Library/Fonts/Arial.ttf']
        : ['/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc', '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'];
  for (const f of candidates) {
    try {
      if (existsSync(f)) return f;
    } catch {
      /* ignore */
    }
  }
  return null;
}

interface VideoProbe {
  durationSec: number;
  width: number;
  height: number;
  hasAudio: boolean;
}

/** 用 ffmpeg -i（无输出）探测时长 / 分辨率 / 是否含音轨（解析 stderr，无需 ffprobe）。失败给安全默认。 */
function probeVideo(bin: string, src: string): Promise<VideoProbe> {
  return new Promise((resolve) => {
    let stderr = '';
    let settled = false;
    const done = (): void => {
      if (settled) return;
      settled = true;
      let durationSec = 0;
      const dm = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (dm) durationSec = Number(dm[1]) * 3600 + Number(dm[2]) * 60 + Number(dm[3]);
      let width = 0;
      let height = 0;
      const vm = stderr.match(/Video:.*?(\d{2,5})x(\d{2,5})/);
      if (vm) {
        width = Number(vm[1]);
        height = Number(vm[2]);
      }
      resolve({ durationSec, width, height, hasAudio: /Audio:/.test(stderr) });
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(bin, ['-i', src], { windowsHide: true });
    } catch {
      done();
      return;
    }
    // 超时：先杀子进程再 done（挂起/极慢的 http URL 探测不 kill 会泄漏后台 ffmpeg 进程）
    const t = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      done();
    }, 20_000);
    child.stderr?.on('data', (d) => {
      stderr += String(d);
      if (stderr.length > 16000) stderr = stderr.slice(0, 16000); // 头部就含 Duration/Stream，截前段
    });
    child.on('error', () => {
      clearTimeout(t);
      done();
    });
    child.on('close', () => {
      clearTimeout(t);
      done();
    });
  });
}

/** 跑一条 ffmpeg 命令，成功后入库（kind=video，封面由渲染端补）。 */
function runFfmpegToVideo(
  bin: string,
  args: string[],
  out: string,
  notes: string,
  params: Record<string, unknown>,
  timeoutMs = 600_000
): Promise<ReturnType<typeof ok> | ReturnType<typeof err>> {
  // +faststart：把 MP4 的 moov atom 移到文件头，让 <video> 起播无需先 seek 到文件尾读 moov
  //（即使 -c copy 也生效，是输出 muxer 选项）。必须在输出文件参数之前。
  const finalArgs =
    args[args.length - 1] === out && !args.includes('-movflags')
      ? [...args.slice(0, -1), '-movflags', '+faststart', out]
      : args;
  return new Promise((resolve) => {
    let stderr = '';
    let settled = false;
    const child = spawn(bin, finalArgs, { windowsHide: true });
    const killTimer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }, timeoutMs);
    child.stderr?.on('data', (d) => {
      stderr += String(d);
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });
    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      resolve(err(makeError('UNKNOWN', `ffmpeg 启动失败：${e.message}`, { severity: 'toast' })));
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      if (code === 0) {
        void insertProducedMedia({ filePath: out, kind: 'video', notes, params }).then((imageId) =>
          resolve(ok({ path: out, imageId: imageId ?? undefined }))
        );
      } else {
        resolve(err(makeError('UNKNOWN', `视频处理失败(ffmpeg ${code})：${stderr.slice(-280)}`, { severity: 'toast' })));
      }
    });
  });
}

interface ClipSegmentInput {
  src: string;
  trimStart: number;
  trimEnd: number;
  speed: number;
  volume: number;
  muted: boolean;
  fadeIn: number;
  fadeOut: number;
  transition: VideoTransition;
  transitionDur: number;
}
interface ClipTextInput {
  text: string;
  start: number;
  end: number;
  x: number;
  y: number;
  fontSize: number;
  color: string;
}

/** 视频编辑分发：裁切 / 基础调色 / 声音处理 / 合并 / 时间轴剪辑(clip)。输入只接本地路径或 http(s) URL。 */
async function editVideoWithFfmpeg(input: {
  op: 'trim' | 'color' | 'audio' | 'merge' | 'clip';
  inputs: string[];
  start?: number | null;
  end?: number | null;
  brightness?: number | null;
  contrast?: number | null;
  saturation?: number | null;
  gamma?: number | null;
  hue?: number | null;
  audioMode?: 'keep' | 'mute' | 'volume' | 'fade' | null;
  volume?: number | null;
  fadeIn?: number | null;
  fadeOut?: number | null;
  segments?: ClipSegmentInput[];
  texts?: ClipTextInput[];
  fps?: number | null;
}): Promise<ReturnType<typeof ok> | ReturnType<typeof err>> {
  const bin = resolveFfmpegBin();
  if (!bin) return err(makeError('UNKNOWN', 'ffmpeg 不可用（未解析到内置二进制）', { severity: 'toast' }));
  const srcs = input.inputs.map((s) => s.trim()).filter(Boolean);
  if (srcs.some((s) => s.startsWith('data:'))) {
    return err(makeError('VALIDATION_FAILED', '视频编辑只支持本地文件或公网 URL', { severity: 'toast' }));
  }
  if (!srcs.length) return err(makeError('VALIDATION_FAILED', '没有输入视频', { severity: 'toast' }));

  const root = getVideoStorageRoot();
  const date = new Date().toISOString().slice(0, 10);
  const dir = path.join(root, date);
  await fs.mkdir(dir, { recursive: true });
  const out = path.join(dir, `edit-${input.op}-${Date.now()}.mp4`);
  const VENC = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '20'];

  if (input.op === 'clip') {
    // 时间轴剪辑：每个 input 对应一个 segment（同序）。逐段 probe 取自然时长/音轨/分辨率 → 纯函数构图 → 一次合成。
    const segs = input.segments ?? [];
    if (segs.length !== srcs.length || srcs.length < 1) {
      return err(makeError('VALIDATION_FAILED', '剪辑片段为空或与输入不匹配', { severity: 'toast' }));
    }
    const probes = await Promise.all(srcs.map((s) => probeVideo(bin, s)));
    const baseW = (probes.find((p) => p.width > 0)?.width || 1280) & ~1;
    const baseH = (probes.find((p) => p.height > 0)?.height || 720) & ~1;
    const clips: ClipInput[] = segs.map((sg, i) => ({
      trimStart: Math.max(0, sg.trimStart || 0),
      trimEnd: sg.trimEnd > 0 ? sg.trimEnd : 0,
      naturalDuration: probes[i].durationSec,
      hasAudio: probes[i].hasAudio,
      volume: sg.volume,
      muted: sg.muted,
      fadeIn: sg.fadeIn,
      fadeOut: sg.fadeOut,
      speed: sg.speed,
      transition: i === 0 ? 'none' : sg.transition,
      transitionDur: sg.transitionDur
    }));
    let graph: ReturnType<typeof buildClipFilterGraph>;
    try {
      graph = buildClipFilterGraph({
        clips,
        width: baseW,
        height: baseH,
        fps: input.fps && input.fps > 0 ? input.fps : 30,
        color: {
          brightness: input.brightness ?? 0,
          contrast: input.contrast ?? 1,
          saturation: input.saturation ?? 1,
          gamma: input.gamma ?? 1,
          hue: input.hue ?? 0
        },
        texts: (input.texts ?? []).map((t) => ({ text: t.text, start: t.start, end: t.end, x: t.x, y: t.y, fontSize: t.fontSize, color: t.color })),
        fontFile: (input.texts ?? []).some((t) => (t.text ?? '').trim()) ? resolveOverlayFont() : null
      });
    } catch (e) {
      return err(makeError('UNKNOWN', `剪辑构图失败：${(e as Error).message}`, { severity: 'toast' }));
    }
    const args = ['-y'];
    for (const s of srcs) args.push('-i', s);
    args.push('-filter_complex', graph.filterComplex, '-map', graph.mapV);
    if (graph.mapA) args.push('-map', graph.mapA, '-c:a', 'aac', '-b:a', '128k');
    args.push(...VENC, out);
    return runFfmpegToVideo(bin, args, out, `[clip] 剪辑 ${segs.length} 段`, { segments: segs.length, baseW, baseH }, 1_200_000);
  }

  if (input.op === 'trim') {
    const start = input.start && input.start > 0 ? input.start : 0;
    const end = input.end && input.end > 0 ? input.end : null;
    if (end != null && end <= start) {
      return err(makeError('VALIDATION_FAILED', '结束时间必须大于开始时间', { severity: 'toast' }));
    }
    // -ss/-to 放在 -i 后：精确裁切（重编码）。-to 为绝对时间戳。
    const args = ['-y', '-i', srcs[0], '-ss', String(start)];
    if (end != null) args.push('-to', String(end));
    args.push(...VENC, '-c:a', 'aac', '-b:a', '128k', out);
    const tag = end != null ? `${start}s–${end}s` : `${start}s 起`;
    return runFfmpegToVideo(bin, args, out, `[trim] 裁切 ${tag}`, { start, end }, 300_000);
  }

  if (input.op === 'color') {
    const eq: string[] = [];
    if (input.brightness != null && input.brightness !== 0) eq.push(`brightness=${input.brightness}`);
    if (input.contrast != null && input.contrast !== 1) eq.push(`contrast=${input.contrast}`);
    if (input.saturation != null && input.saturation !== 1) eq.push(`saturation=${input.saturation}`);
    if (input.gamma != null && input.gamma !== 1) eq.push(`gamma=${input.gamma}`);
    const vf: string[] = [];
    if (eq.length) vf.push(`eq=${eq.join(':')}`);
    if (input.hue != null && input.hue !== 0) vf.push(`hue=h=${input.hue}`);
    if (!vf.length) return err(makeError('VALIDATION_FAILED', '请至少调整一项（亮度/对比度/饱和度/伽马/色相）', { severity: 'toast' }));
    const args = ['-y', '-i', srcs[0], '-vf', vf.join(','), ...VENC, '-c:a', 'copy', out];
    return runFfmpegToVideo(bin, args, out, '[color] 视频调色', {
      brightness: input.brightness,
      contrast: input.contrast,
      saturation: input.saturation,
      gamma: input.gamma,
      hue: input.hue
    });
  }

  if (input.op === 'audio') {
    const mode = input.audioMode ?? 'keep';
    if (mode === 'keep') {
      // 「保留原声」：视频重编码规范化、音轨直拷（no-op 透传，符合直觉语义，不报错）
      const args = ['-y', '-i', srcs[0], ...VENC, '-c:a', 'copy', out];
      return runFfmpegToVideo(bin, args, out, '[audio] 保留原声', { audioMode: mode }, 300_000);
    }
    if (mode === 'mute') {
      const args = ['-y', '-i', srcs[0], '-an', '-c:v', 'copy', out];
      return runFfmpegToVideo(bin, args, out, '[audio] 静音', { audioMode: mode }, 300_000);
    }
    const af: string[] = [];
    if (mode === 'volume') {
      const vol = input.volume != null && input.volume >= 0 ? input.volume : 1;
      af.push(`volume=${vol}`);
    } else if (mode === 'fade') {
      const fin = input.fadeIn && input.fadeIn > 0 ? input.fadeIn : 0;
      const fout = input.fadeOut && input.fadeOut > 0 ? input.fadeOut : 0;
      if (fin > 0) af.push(`afade=t=in:st=0:d=${fin}`);
      if (fout > 0) {
        // 淡出需要精确时长定位起点；探测失败（durationSec<=0，如某些容器/挂起 URL）时
        // 绝不能把 st 兜成 0（那会把淡出加到开头，与意图相反），而是跳过淡出并提示。
        const probe = await probeVideo(bin, srcs[0]);
        if (probe.durationSec > 0) {
          const st = Math.max(0, probe.durationSec - fout);
          af.push(`afade=t=out:st=${st.toFixed(2)}:d=${fout}`);
        } else if (!fin) {
          return err(makeError('UNKNOWN', '无法获取视频时长，淡出已跳过：请改用本地视频文件，或只设淡入', { severity: 'toast' }));
        }
        // 探测失败但设了淡入 → 保留淡入、静默跳过淡出（af 非空，不报错）
      }
    }
    if (!af.length) return err(makeError('VALIDATION_FAILED', '请设置音量或淡入淡出', { severity: 'toast' }));
    const args = ['-y', '-i', srcs[0], '-af', af.join(','), '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', out];
    return runFfmpegToVideo(bin, args, out, `[audio] 声音处理（${mode}）`, { audioMode: mode, volume: input.volume, fadeIn: input.fadeIn, fadeOut: input.fadeOut }, 300_000);
  }

  // merge：把多段视频拼接（重编码，按第一段分辨率统一缩放 + setsar；音轨全有才拼音频，否则只拼画面）
  const probes = await Promise.all(srcs.map((s) => probeVideo(bin, s)));
  // 目标分辨率对齐到偶数（H.264/yuv420p 要求偶数边；首段若是奇数分辨率会让 libx264 直接失败）
  const baseW = (probes[0].width || 1280) & ~1;
  const baseH = (probes[0].height || 720) & ~1;
  const allHaveAudio = probes.every((p) => p.hasAudio);
  const args: string[] = ['-y'];
  for (const s of srcs) args.push('-i', s);
  const parts: string[] = [];
  const concatRefs: string[] = [];
  srcs.forEach((_, i) => {
    parts.push(`[${i}:v]scale=${baseW}:${baseH}:force_original_aspect_ratio=decrease,pad=${baseW}:${baseH}:(ow-iw)/2:(oh-ih)/2,setsar=1[v${i}]`);
    concatRefs.push(`[v${i}]`);
    // 音轨归一到统一采样率/格式/声道（concat 滤镜硬性要求各段音频参数一致，
    // 不同来源/用户上传视频常见 44100 vs 48000、单声道 vs 立体声，不归一会直接合并失败）
    if (allHaveAudio) {
      parts.push(`[${i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`);
      concatRefs.push(`[a${i}]`);
    }
  });
  const n = srcs.length;
  const concat = allHaveAudio
    ? `${concatRefs.join('')}concat=n=${n}:v=1:a=1[v][a]`
    : `${concatRefs.join('')}concat=n=${n}:v=1:a=0[v]`;
  const filterComplex = `${parts.join(';')};${concat}`;
  args.push('-filter_complex', filterComplex, '-map', '[v]');
  if (allHaveAudio) args.push('-map', '[a]', '-c:a', 'aac', '-b:a', '128k');
  args.push(...VENC, out);
  return runFfmpegToVideo(bin, args, out, `[merge] 合并 ${n} 段`, { count: n, baseW, baseH, allHaveAudio }, 900_000);
}

/** 从上传响应抠资源 URL（兼容 data.url / url / data[0].url / data.file_url / file_url）。 */
function extractAssetUrl(j: Record<string, unknown> | undefined): string | undefined {
  if (!j) return undefined;
  const data = (j.data ?? {}) as Record<string, unknown>;
  for (const c of [j.url, data.url, data.file_url, j.file_url, data.fileUrl, j.fileUrl]) {
    if (typeof c === 'string' && c) return c;
  }
  const arr = (j.data ?? j.files ?? j.urls) as unknown;
  if (Array.isArray(arr)) {
    const f = arr[0];
    if (typeof f === 'string') return f;
    if (f && typeof (f as Record<string, unknown>).url === 'string') return (f as Record<string, unknown>).url as string;
  }
  return undefined;
}

function guessAssetMime(filename: string, kind: 'image' | 'video' | 'audio'): string {
  const ext = (filename.split('.').pop() ?? '').toLowerCase();
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    webm: 'video/webm',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    m4a: 'audio/mp4',
    aac: 'audio/aac'
  };
  return map[ext] ?? (kind === 'image' ? 'image/png' : kind === 'video' ? 'video/mp4' : 'audio/mpeg');
}

// ───────────────────────── 配置解析 ─────────────────────────

function findVideoConfig(modelDisplayId: string): ResolvedVideoCfg | null {
  const rows = getDb()
    .prepare(`SELECT * FROM api_configs WHERE type = 'video' ORDER BY id`)
    .all() as Array<{
    provider_name: string | null;
    base_url: string;
    api_key_encrypted: string;
    model_mapping: string;
    video_kind: string | null;
    body_overrides_json: string | null;
    header_overrides_json: string | null;
  }>;
  type Row = (typeof rows)[number];
  // 模型标识可能是复合「中转站 / 名」或旧裸名
  const { provider, name } = parseModelRef(modelDisplayId);
  const mapOf = (c: Row): Record<string, string> => {
    try {
      return JSON.parse(c.model_mapping || '{}');
    } catch {
      return {};
    }
  };
  const build = (c: Row, actual: string): ResolvedVideoCfg => {
    // 协议自动纠偏：配置停在 legacy 但 地址/模型 明显是别家（如 APIMart/Seedance）→ 自动用对的协议，
    // 免去「选错协议 → 提交进错端点 → 烧钱且取不回视频」（用户无需理解 video_kind）。
    const stored = normalizeVideoKind(c.video_kind) ?? 'kling';
    const kind = autoCorrectVideoKind(stored, c.base_url, actual) ?? 'kling';
    if (kind !== stored) logger.info(`[video] 协议自动纠偏：${stored} → ${kind}（${c.base_url} / ${actual}）`);
    return {
      base_url: c.base_url,
      apiKey: decryptString(c.api_key_encrypted),
      actualModelId: actual,
      video_kind: kind,
      body_overrides_json: c.body_overrides_json ?? null,
      header_overrides_json: c.header_overrides_json ?? null
    };
  };
  // 1) 复合：中转站名 + 映射名 精确命中
  if (provider) {
    for (const c of rows) {
      if ((c.provider_name ?? '').trim() !== provider) continue;
      const v = mapOf(c)[name];
      if (v) return build(c, v);
    }
  }
  // 2) 回退：按裸名首个命中（向后兼容旧裸名存量）
  for (const c of rows) {
    const v = mapOf(c)[name];
    if (v) return build(c, v);
  }
  return null;
}

// ───────────────────────── 任务执行 ─────────────────────────

async function runVideoTask(
  taskId: string,
  cfg: ResolvedVideoCfg,
  input: VideoGenerateInput,
  sender: WebContents,
  signal: AbortSignal
): Promise<void> {
  const t0 = Date.now();
  const push = (ch: 'video:progress' | 'video:done', payload: VideoProgressPayload | VideoDonePayload): void => {
    if (!sender.isDestroyed()) sender.send(ch, payload);
  };
  const progress = (percent: number, phase: string, state?: VideoTaskStatusState): void =>
    push('video:progress', { taskId, percent, phase, state });
  const done = (p: Omit<VideoDonePayload, 'taskId' | 'durationMs'>): void => {
    push('video:done', { taskId, durationMs: Date.now() - t0, ...p });
    // 与图片任务一致：异步完成/失败记入通知中心
    if (!sender.isDestroyed()) {
      appendNotification(sender, {
        channel: 'video:done',
        kind: p.ok ? 'success' : 'failure',
        message: p.ok ? '视频生成完成' : `视频生成失败：${p.error ?? ''}`
      });
    }
  };

  try {
    progress(3, '提交中', 'submitted');
    const kind = cfg.video_kind ?? 'kling';
    let bytes: Buffer;
    let lastFrameUrl: string | undefined;
    let remoteUrl: string | undefined;
    if (isAdapterKind(kind) && input.request) {
      // adapter 路径（seedance / custom）：统一请求 → 适配器映射 + 校验 + 轮询
      const r = await runAdapterTask(kind, cfg, input.request, signal, progress);
      bytes = r.bytes;
      lastFrameUrl = r.lastFrameUrl;
      remoteUrl = r.remoteUrl;
    } else {
      // legacy 内置简易引擎（kling / sora / unified）—— 完全不变
      bytes =
        kind === 'sora'
          ? await runSora(cfg, input, signal, progress)
          : await runKlingOrUnified(kind === 'unified' ? 'unified' : 'kling', cfg, input, signal, progress);
    }
    if (signal.aborted) {
      done({ ok: false, error: '已取消' });
      return;
    }
    progress(95, '下载中', 'processing');
    const { filePath, imageId } = await saveVideo(bytes, input.modelId, input.prompt);
    done({ ok: true, filePath, imageId, lastFrameUrl, remoteUrl });
  } catch (e) {
    if (signal.aborted) {
      done({ ok: false, error: '已取消' });
      return;
    }
    const raw = e instanceof Error ? e.message : String(e);
    const msg = friendlyVideoError(scrubKey(raw, cfg.apiKey));
    logger.error('[video] task failed', e);
    done({ ok: false, error: msg });
  }
}

// ───────────────────────── 协议：adapter 路径（seedance / custom） ─────────────────────────

/** 读 settings 的 video_providers_json 合并内置模板（主进程版，供 adapter 用）。 */
function loadMergedVideoConfig(): ReturnType<typeof mergeVideoProvidersConfig> {
  const row = getDb().prepare(`SELECT value FROM settings WHERE key='video_providers_json'`).get() as
    | { value: string }
    | undefined;
  return mergeVideoProvidersConfig(row?.value ?? null);
}

// 每供应商并发闸门（maxConcurrentTasks）。
const slotCounts = new Map<string, number>();
const slotWaiters = new Map<string, Array<() => void>>();

async function acquireSlot(kind: string, max: number, signal: AbortSignal): Promise<void> {
  if (!max || max <= 0) return;
  const cur = slotCounts.get(kind) ?? 0;
  if (cur < max) {
    slotCounts.set(kind, cur + 1);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const w = resolve;
    const arr = slotWaiters.get(kind) ?? [];
    arr.push(w);
    slotWaiters.set(kind, arr);
    signal.addEventListener(
      'abort',
      () => {
        const a = slotWaiters.get(kind);
        if (a) {
          const i = a.indexOf(w);
          if (i >= 0) a.splice(i, 1);
        }
        reject(new Error('已取消'));
      },
      { once: true }
    );
  });
  // 槽位由 releaseSlot 转交，计数不变
}

function releaseSlot(kind: string): void {
  const arr = slotWaiters.get(kind);
  if (arr && arr.length) {
    const w = arr.shift();
    if (w) {
      w();
      return;
    }
  }
  const cur = slotCounts.get(kind) ?? 1;
  slotCounts.set(kind, Math.max(0, cur - 1));
}

async function runAdapterTask(
  kind: string,
  cfg: ResolvedVideoCfg,
  request: NonNullable<VideoGenerateInput['request']>,
  signal: AbortSignal,
  progress: (p: number, phase: string, state?: VideoTaskStatusState) => void
): Promise<{ bytes: Buffer; lastFrameUrl?: string; remoteUrl?: string }> {
  const merged = loadMergedVideoConfig();
  const provider = merged.providers[kind];
  if (!provider) throw new Error(`未找到视频供应商「${kind}」的配置，请到设置 → 视频模型配置中心检查`);
  const model = findVideoModel(merged, cfg.actualModelId);
  const baseUrl = provider.baseUrl && provider.baseUrl.trim() ? provider.baseUrl : cfg.base_url;
  const ctx: AdapterContext = {
    provider,
    model,
    baseUrl,
    apiKey: cfg.apiKey,
    actualModelId: cfg.actualModelId,
    bodyOverridesJson: cfg.body_overrides_json,
    signal
  };
  const adapter = getVideoAdapter(kind, ctx);
  if (!adapter) throw new Error(`视频供应商「${kind}」暂未实现适配器`);

  // 用真实模型 id / providerId 覆盖请求（防御：以服务端解析为准）
  const req = { ...request, providerId: kind, modelId: cfg.actualModelId };

  progress(4, '校验中', 'validating');
  if (model) {
    // 有能力模板 → 严格校验
    const v = adapter.validate(req);
    if (!v.ok) throw new Error(`参数校验未通过：${v.issues.map((i) => i.message).join('；')}`);
  } else {
    // 无模板（自定义模型 id）→ 宽松：只要有输入即放行
    const hasInput =
      !!req.prompt?.trim() ||
      !!req.images?.length ||
      !!req.imageUrls?.length ||
      !!req.videoUrls?.length ||
      !!req.audioUrls?.length;
    if (!hasInput) throw new Error('缺少输入：请填提示词或连入图片/素材');
  }

  await acquireSlot(kind, provider.maxConcurrentTasks, signal);
  try {
    progress(6, '提交中', 'submitted');
    const created = await adapter.createTask(req);
    let st = created.status;
    const start = Date.now();
    // timeout>0 = 用户显式设的上限；0/缺省 = 不限时（默认）——只要上游说进行中就一直等
    const timeout = provider.timeout > 0 ? provider.timeout : Infinity;
    const interval = provider.pollingInterval > 0 ? provider.pollingInterval : POLL_INTERVAL_MS;
    progress(10, '排队中', 'polling');
    let pollErrors = 0;
    while (st.state !== 'succeeded') {
      if (st.state === 'failed') throw new Error(st.error || '上游报告生成失败');
      if (signal.aborted) throw new Error('已取消');
      if (Date.now() - start > timeout)
        throw new Error(`视频生成超时（超过配置的 ${Math.round(timeout / 60000)} 分钟上限）`);
      await sleep(interval, signal);
      // 状态查询偶发失败（网络抖动/上游 5xx）容忍重试——长等待下必然遇到，不能一击致命
      try {
        st = await adapter.pollTask(created.taskId);
        pollErrors = 0;
      } catch (e) {
        if (signal.aborted) throw new Error('已取消');
        pollErrors++;
        logger.warn(`[video] adapter poll error #${pollErrors}: ${(e as Error).message}`);
        if (pollErrors >= MAX_CONSECUTIVE_POLL_ERRORS) {
          throw new Error(
            `状态查询连续失败 ${pollErrors} 次（约 ${Math.round((pollErrors * interval) / 60000)} 分钟）——网络长断或任务已丢：${(e as Error).message}`
          );
        }
        continue;
      }
      const ramp = Number.isFinite(timeout)
        ? Math.min(90, 12 + Math.floor(((Date.now() - start) / timeout) * 80))
        : timeRamp(start);
      // 部分供应商（如 Runway）以 0..1 小数返回进度，归一到百分比再夹取
      const reported =
        typeof st.progress === 'number' ? (st.progress <= 1 ? st.progress * 100 : st.progress) : undefined;
      progress(reported != null ? Math.max(12, Math.min(92, reported)) : ramp, '生成中', 'processing');
    }
    const videoUrl = st.videoUrl;
    if (!videoUrl) throw new Error('完成但未取到视频地址');
    progress(95, '下载中', 'processing');
    const vr = await chromiumFetch(videoUrl, { method: 'GET', signal });
    if (!vr.ok) throw new Error(`下载视频失败 HTTP ${vr.status}`);
    return { bytes: Buffer.from(await vr.arrayBuffer()), lastFrameUrl: st.lastFrameUrl, remoteUrl: videoUrl };
  } finally {
    releaseSlot(kind);
  }
}

/** 错误文案口语化（普通用户看得懂；原始报错调用方已脱敏）。 */
function friendlyVideoError(msg: string): string {
  const m = msg.toLowerCase();
  if (/\b401\b|\b403\b|unauthorized|invalid api key|无效.*key/.test(m)) {
    return `鉴权失败：API Key 可能错误或无权限。请到「设置 → 视频模型」检查。原始：${msg}`;
  }
  if (/余额|额度|balance|insufficient|quota|欠费/.test(m)) {
    return `额度/余额不足：请到中转站充值后重试。原始：${msg}`;
  }
  if (/超时|timeout|timed out/.test(m)) {
    return `任务超时：视频生成较慢或上游拥堵，可稍后重试（或降低分辨率/时长）。原始：${msg}`;
  }
  if (/only http\/https|image_with_roles.*url|asset:\/\//i.test(m)) {
    return (
      `该站的生成接口只接受公网图片 URL（不收 base64 内联图）。` +
      `APIMart 已默认自动上传换 URL（直接重试即可）；其它供应商可在「高级：视频供应商微调」里填「图片上传端点」。原始：${msg}`
    );
  }
  if (/找不到任务 id|未取到视频地址|格式|json/.test(m)) {
    return (
      `上游返回格式异常：多半是「视频 API 协议」与该站不匹配。` +
      `若地址是 APIMart（apimart.ai）或模型是 Seedance/豆包，请在设置里把该视频配置的协议改为 seedance` +
      `（新版已按地址/模型自动纠偏，直接重试一次通常即可）。原始：${msg}`
    );
  }
  return msg;
}

/** 从错误文案里抹掉可能出现的 API Key（兜底；正常情况下 key 只在 header 不在响应体）。 */
function scrubKey(msg: string, key: string): string {
  if (!key || key.length < 8) return msg;
  return msg.split(key).join('***');
}

// ───────────────────────── 协议：kling / unified ─────────────────────────

async function runKlingOrUnified(
  kind: 'kling' | 'unified',
  cfg: ResolvedVideoCfg,
  input: VideoGenerateInput,
  signal: AbortSignal,
  progress: (p: number, phase: string) => void
): Promise<Buffer> {
  const root = stripV1(cfg.base_url);
  const p = input.params;
  const img = pickImage(p.image);
  const isI2V = !!img;

  let submitUrl: string;
  let body: Record<string, unknown>;
  if (kind === 'kling') {
    submitUrl = `${root}/kling/v1/videos/${isI2V ? 'image2video' : 'text2video'}`;
    body = {
      model_name: cfg.actualModelId,
      prompt: input.prompt,
      ...(input.negativePrompt ? { negative_prompt: input.negativePrompt } : {}),
      // kling 的 mode 是「质量档」std|pro（文/图生已由 URL 路径区分）；从用户填的 resolution 归一。
      mode: klingMode(p.resolution),
      aspect_ratio: str(p.aspect, '16:9'),
      duration: str(p.duration, '5'),
      ...(img ? { image: img } : {}),
      ...(pickImage(p.imageTail) ? { image_tail: pickImage(p.imageTail) } : {})
    };
  } else {
    submitUrl = `${root}/video/generations`;
    body = {
      model: cfg.actualModelId,
      prompt: input.prompt,
      ...(input.negativePrompt ? { negative_prompt: input.negativePrompt } : {}),
      duration: str(p.duration, '5'),
      aspect_ratio: str(p.aspect, '16:9'),
      resolution: str(p.resolution, '720p'),
      ...(img ? { image: img, image_url: img } : {})
    };
  }
  body = applyOverrides(body, cfg.body_overrides_json);

  const subRes = await chromiumFetch(submitUrl, {
    method: 'POST',
    headers: authHeaders(cfg.apiKey, cfg.header_overrides_json, cfg.actualModelId),
    body: JSON.stringify(body),
    signal
  });
  const subText = await subRes.text();
  if (!subRes.ok) throw new Error(`提交失败 HTTP ${subRes.status}：${subText.slice(0, 300)}`);
  const subJson = safeJson(subText);
  const taskId = extractTaskId(subJson);
  if (!taskId) throw new Error(`提交返回里找不到任务 id：${subText.slice(0, 300)}`);

  // 轮询
  const pollUrl =
    kind === 'kling' ? `${submitUrl}/${taskId}` : `${root}/video/generations/${taskId}`;
  const start = Date.now();
  progress(10, '排队中');
  let pollErrors = 0;
  for (;;) {
    if (signal.aborted) throw new Error('已取消');
    await sleep(POLL_INTERVAL_MS, signal);
    if (signal.aborted) throw new Error('已取消');
    const pr = await chromiumFetch(pollUrl, { method: 'GET', headers: authHeaders(cfg.apiKey, cfg.header_overrides_json, cfg.actualModelId), signal });
    const txt = await pr.text();
    if (!pr.ok) {
      // 个别站点轮询偶发 5xx，容忍继续；但连续失败太久（任务可能已丢/网络长断）就放弃
      pollErrors++;
      logger.warn(`[video] poll HTTP ${pr.status} (#${pollErrors}): ${txt.slice(0, 200)}`);
      if (pollErrors >= MAX_CONSECUTIVE_POLL_ERRORS) {
        throw new Error(`状态查询连续失败 ${pollErrors} 次（HTTP ${pr.status}）——网络长断或任务已丢`);
      }
      continue;
    }
    pollErrors = 0;
    const j = safeJson(txt);
    const st = extractStatus(j);
    progress(timeRamp(start), '生成中');
    if (st.state === 'failed') throw new Error(st.error || '上游报告生成失败');
    if (st.state === 'done') {
      const videoUrl = extractVideoUrl(j);
      if (!videoUrl) throw new Error('完成但未取到视频地址');
      // 公网 mp4 URL，下载不带鉴权头（避免个别 CDN 拒绝）
      const vr = await chromiumFetch(videoUrl, { method: 'GET', signal });
      if (!vr.ok) throw new Error(`下载视频失败 HTTP ${vr.status}`);
      return Buffer.from(await vr.arrayBuffer());
    }
  }
}

// ───────────────────────── 协议：OpenAI Sora ─────────────────────────

async function runSora(
  cfg: ResolvedVideoCfg,
  input: VideoGenerateInput,
  signal: AbortSignal,
  progress: (p: number, phase: string) => void
): Promise<Buffer> {
  const base = cfg.base_url.replace(/\/+$/, '');
  const apiBase = /\/v1$/i.test(base) ? base : `${base}/v1`;
  const p = input.params;
  let body: Record<string, unknown> = {
    model: cfg.actualModelId,
    prompt: input.prompt,
    size: str(p.size, str(p.resolution, '1280x720')),
    seconds: str(p.duration, '8'),
    ...(pickImage(p.image) ? { input_reference: pickImage(p.image) } : {})
  };
  body = applyOverrides(body, cfg.body_overrides_json);

  const subRes = await chromiumFetch(`${apiBase}/videos`, {
    method: 'POST',
    headers: authHeaders(cfg.apiKey, cfg.header_overrides_json, cfg.actualModelId),
    body: JSON.stringify(body),
    signal
  });
  const subText = await subRes.text();
  if (!subRes.ok) throw new Error(`提交失败 HTTP ${subRes.status}：${subText.slice(0, 300)}`);
  const subJson = safeJson(subText);
  const id = typeof subJson?.id === 'string' ? subJson.id : undefined;
  if (!id) throw new Error(`提交返回里找不到 video id：${subText.slice(0, 300)}`);

  const start = Date.now();
  progress(10, '排队中');
  let pollErrors = 0;
  for (;;) {
    if (signal.aborted) throw new Error('已取消');
    await sleep(POLL_INTERVAL_MS, signal);
    if (signal.aborted) throw new Error('已取消');
    const pr = await chromiumFetch(`${apiBase}/videos/${id}`, {
      method: 'GET',
      headers: authHeaders(cfg.apiKey, cfg.header_overrides_json, cfg.actualModelId),
      signal
    });
    const txt = await pr.text();
    if (!pr.ok) {
      pollErrors++;
      logger.warn(`[video] sora poll HTTP ${pr.status} (#${pollErrors}): ${txt.slice(0, 200)}`);
      if (pollErrors >= MAX_CONSECUTIVE_POLL_ERRORS) {
        throw new Error(`状态查询连续失败 ${pollErrors} 次（HTTP ${pr.status}）——网络长断或任务已丢`);
      }
      continue;
    }
    pollErrors = 0;
    const j = safeJson(txt);
    const status = String(j?.status ?? '');
    const pct = typeof j?.progress === 'number' ? Math.max(10, Math.min(92, j.progress)) : undefined;
    progress(pct ?? timeRamp(start), '生成中');
    if (status === 'failed') throw new Error(extractSoraError(j) || 'Sora 报告生成失败');
    if (status === 'completed') {
      const cr = await chromiumFetch(`${apiBase}/videos/${id}/content?variant=video`, {
        method: 'GET',
        headers: authHeaders(cfg.apiKey, cfg.header_overrides_json, cfg.actualModelId),
        signal
      });
      if (!cr.ok) throw new Error(`下载视频失败 HTTP ${cr.status}`);
      return Buffer.from(await cr.arrayBuffer());
    }
  }
}

// ───────────────────────── 落盘 + 入资产库 ─────────────────────────

async function saveVideo(
  bytes: Buffer,
  modelId: string,
  prompt: string
): Promise<{ filePath: string; imageId?: number }> {
  const root = getVideoStorageRoot();
  const date = new Date().toISOString().slice(0, 10);
  const dir = path.join(root, date);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `video-${Date.now()}.mp4`);
  await fs.writeFile(filePath, bytes);
  let imageId: number | undefined;
  try {
    // 视频暂无缩略图（sharp 不解码视频），thumbnail_path 置 NULL；资产库以 [video] 标记
    const r = getDb()
      .prepare(
        `INSERT INTO images(task_id, file_path, thumbnail_path, prompt_positive, prompt_negative, model_used, params_json, notes, created_at)
         VALUES(NULL, ?, NULL, ?, NULL, ?, NULL, ?, ?)`
      )
      .run(filePath, prompt || '', modelId, '[video] 智能画布生成', new Date().toISOString());
    imageId = Number(r.lastInsertRowid);
    broadcastGalleryChanged();
  } catch (e) {
    logger.warn(`[video] gallery insert failed: ${(e as Error).message}`);
  }
  return { filePath, imageId };
}

export function getVideoStorageRoot(): string {
  const img = getDb().prepare(`SELECT value FROM settings WHERE key='image_storage_path'`).get() as
    | { value: string }
    | undefined;
  if (img?.value && img.value.trim()) return img.value;
  return path.join(app.getPath('userData'), 'images');
}

// ───────────────────────── 工具 ─────────────────────────

function authHeaders(
  key: string,
  overridesJson?: string | null,
  model?: string
): Record<string, string> {
  return applyHeaderOverrides(
    { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    overridesJson,
    { key, model }
  );
}

function stripV1(base: string): string {
  return base.replace(/\/+$/, '').replace(/\/v1$/i, '');
}

/** params 里取字符串/数字值（其它类型回退默认）。 */
function str(v: unknown, d: string): string {
  return typeof v === 'string' || typeof v === 'number' ? String(v) : d;
}

/** kling 的 mode 只接受 std|pro（质量档）；把用户填的 resolution（std/pro/720p/1080p…）归一。
 *  pro / 含 1080/1440/2k/4k → 'pro'；其余（含 720p、空、文/图生模式串）→ 'std'。 */
function klingMode(v: unknown): string {
  const s = typeof v === 'string' ? v.toLowerCase() : '';
  return s === 'pro' || /1080|1440|2k|4k/.test(s) ? 'pro' : 'std';
}

/** 图片入参：data:URI 去前缀留 base64（多数站点 kling.image 接受 base64 或 URL）；http URL 原样。 */
function pickImage(v: unknown): string | undefined {
  if (typeof v !== 'string' || !v) return undefined;
  if (v.startsWith('data:')) return v.replace(/^data:[^;]+;base64,/, '');
  return v;
}

function safeJson(text: string): Record<string, unknown> | undefined {
  try {
    const j = JSON.parse(text);
    return typeof j === 'object' && j !== null ? (j as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** 顶层合并 body_overrides_json（null 值删字段）。 */
function applyOverrides(body: Record<string, unknown>, json: string | null): Record<string, unknown> {
  if (!json || !json.trim()) return body;
  let ov: Record<string, unknown>;
  try {
    const parsed = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return body;
    ov = parsed as Record<string, unknown>;
  } catch {
    return body;
  }
  const merged: Record<string, unknown> = { ...body, ...ov };
  for (const k of Object.keys(merged)) {
    if (merged[k] === null || merged[k] === undefined) delete merged[k];
  }
  return merged;
}

/** 从提交响应里抠任务 id（兼容各家：data.task_id / task_id / id / request_id / data.id）。 */
function extractTaskId(j: Record<string, unknown> | undefined): string | undefined {
  if (!j) return undefined;
  // APIMart 等聚合站 data 是数组（{ code, data: [ { status, task_id } ] }）→ 取首元素（与 adapter.ts 同款容错）
  const rawData = j.data;
  const data = (Array.isArray(rawData) ? (rawData[0] ?? {}) : (rawData ?? {})) as Record<string, unknown>;
  const cands = [data.task_id, data.id, j.task_id, j.id, j.request_id, (j.task as Record<string, unknown> | undefined)?.id];
  for (const c of cands) if (typeof c === 'string' && c) return c;
  return undefined;
}

/** 归一各家轮询状态 → done / failed / pending。 */
function extractStatus(j: Record<string, unknown> | undefined): { state: 'done' | 'failed' | 'pending'; error?: string } {
  if (!j) return { state: 'pending' };
  const rawData = j.data;
  const data = (Array.isArray(rawData) ? (rawData[0] ?? {}) : (rawData ?? {})) as Record<string, unknown>;
  const raw = String(
    data.task_status ?? data.status ?? data.state ?? j.status ?? j.state ?? ''
  ).toLowerCase();
  if (['succeed', 'success', 'succeeded', 'completed', 'done', 'finished'].includes(raw)) {
    return { state: 'done' };
  }
  if (['failed', 'fail', 'error', 'cancelled', 'canceled'].includes(raw)) {
    const msg =
      (data.task_status_msg as string | undefined) ??
      (j.error as string | undefined) ??
      (typeof j.error === 'object' && j.error ? ((j.error as Record<string, unknown>).message as string) : undefined);
    return { state: 'failed', error: msg };
  }
  return { state: 'pending' };
}

/** 从轮询响应里抠视频 URL（兼容 kling / 聚合站多种字段）。 */
function extractVideoUrl(j: Record<string, unknown> | undefined): string | undefined {
  if (!j) return undefined;
  const data = (j.data ?? {}) as Record<string, unknown>;
  // kling: data.task_result.videos[0].url
  const tr = (data.task_result ?? {}) as Record<string, unknown>;
  const klingVideos = tr.videos as Array<{ url?: string }> | undefined;
  if (klingVideos?.[0]?.url) return klingVideos[0].url;
  // 通用：video.url / data[0].url / videoUrl / url / output[0] / data.video_url / data.url
  const video = (j.video ?? data.video) as Record<string, unknown> | undefined;
  if (video && typeof video.url === 'string') return video.url;
  const arr = (j.data ?? j.output ?? j.videos) as unknown;
  if (Array.isArray(arr)) {
    const first = arr[0];
    if (typeof first === 'string') return first;
    if (first && typeof (first as Record<string, unknown>).url === 'string')
      return (first as Record<string, unknown>).url as string;
  }
  for (const cand of [j.videoUrl, j.url, data.video_url, data.url, data.videoUrl]) {
    if (typeof cand === 'string' && cand) return cand;
  }
  return undefined;
}

function extractSoraError(j: Record<string, unknown> | undefined): string | undefined {
  if (!j) return undefined;
  const e = j.error;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object') return (e as Record<string, unknown>).message as string | undefined;
  return undefined;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new Error('已取消'));
      },
      { once: true }
    );
  });
}
