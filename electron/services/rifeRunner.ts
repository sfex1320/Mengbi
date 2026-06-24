/**
 * RIFE 插帧任务执行器（仿 realesrganRunner.ts + video.ts scaleVideoWithFfmpeg）。
 *
 * 三阶段管线（全部子进程，串行队列防显存抖动）：
 *   1) ffmpeg 探测（-i 取 fps/时长/音轨）+ 拆帧到临时目录（PNG）
 *   2) rife-ncnn-vulkan：in/ → out/，`-n 目标总帧数`（v4 系支持任意倍率）
 *   3) ffmpeg 合帧：out/%08d.png + 原视频音轨 → mp4
 *
 * 进度：拆帧 0-15%（stderr frame=N）/ 插帧 15-85%（每 700ms 轮询输出目录文件数）/ 合帧 85-100%。
 * 取消：ACTIVE_TASKS 标志 + 当前阶段子进程 kill，阶段之间检查提前退出。
 * 临时目录 try/finally 必清；启动前清扫 24h 之前的残留（防上次崩溃遗留爆盘）。
 */
import { app } from 'electron';
import type { WebContents } from 'electron';
import ffmpegPath from 'ffmpeg-static';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { execPath as rifeExecPath, engineRoot, getEngineStatus } from './rifeEngine';
import {
  parseFfmpegMediaInfo,
  parseFfmpegFrameProgress,
  computeTargetFrames,
  overallPercent
} from './rifeMath';
import { logger } from './logger';

// ─── payload 形状（渲染端 src/types/ipc.ts 同步） ──────────

export interface InterpProgressPayload {
  taskId: string;
  /** 渲染端定位节点用（run 提交时带入，原样回带） */
  clientTag?: string;
  stage: 'probe' | 'extract' | 'interp' | 'encode';
  /** 总进度 0-100（三阶段定额换算） */
  percent: number;
  framesDone: number;
  framesTotal: number;
  /** probe 后回填，UI 显示「源 24fps → 60fps」 */
  srcFps?: number;
  /** 中文阶段说明 */
  phase: string;
}

export interface InterpDonePayload {
  taskId: string;
  ok: boolean;
  outputPath?: string;
  srcFps?: number;
  srcFrames?: number;
  outFrames?: number;
  elapsedMs?: number;
  error?: string;
  cancelled?: boolean;
}

export interface RunInterpInput {
  inputPath: string;
  outputDir: string;
  targetFps: number;
  /** 模型目录名（缺省用引擎默认 rife-v4.6） */
  model?: string;
  clientTag?: string;
}

// ─── 防爆盘闸门 ────────────────────────────────────────────

/** 视频时长上限（秒）——1080p 每帧 PNG ~3MB，2 分钟 60fps 输出就要 ~20GB 临时空间 */
const MAX_DURATION_SEC = 120;
/** 目标总帧数上限 */
const MAX_TARGET_FRAMES = 7200;
/** 插帧阶段 idle 看门狗（轮询无新增帧 + 无 stderr 即判挂死） */
const IDLE_KILL_MS = 300_000;

// ─── 任务管理（与 Real-ESRGAN 队列相互独立） ───────────────

interface RunningTask {
  taskId: string;
  proc: ChildProcess | null;
  cancelled: boolean;
}

const ACTIVE_TASKS = new Map<string, RunningTask>();
let queueChain: Promise<unknown> = Promise.resolve();

function enqueueSerial<T>(fn: () => Promise<T>): Promise<T> {
  const next = queueChain.then(() => fn(), () => fn());
  queueChain = next.catch(() => undefined);
  return next;
}

export function cancelTask(taskId?: string): { cancelledTaskIds: string[] } {
  const ids: string[] = [];
  if (taskId) {
    const t = ACTIVE_TASKS.get(taskId);
    if (t) {
      t.cancelled = true;
      t.proc?.kill();
      ids.push(taskId);
    }
  } else {
    for (const [id, t] of ACTIVE_TASKS.entries()) {
      t.cancelled = true;
      t.proc?.kill();
      ids.push(id);
    }
  }
  return { cancelledTaskIds: ids };
}

// ─── 主入口 ────────────────────────────────────────────────

export interface RunInterpHandle {
  taskId: string;
  done: Promise<InterpDonePayload>;
}

export function runInterp(input: RunInterpInput, sender: WebContents): RunInterpHandle {
  const taskId = randomUUID();
  const state: RunningTask = { taskId, proc: null, cancelled: false };
  ACTIVE_TASKS.set(taskId, state);
  const t0 = Date.now();

  const done = enqueueSerial(async (): Promise<InterpDonePayload> => {
    const taskDir = path.join(tempRoot(), taskId);
    try {
      const payload = await runPipeline(input, state, sender, taskId, taskDir, t0);
      return payload;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        taskId,
        ok: false,
        error: msg,
        cancelled: state.cancelled,
        elapsedMs: Date.now() - t0
      };
    } finally {
      ACTIVE_TASKS.delete(taskId);
      await fs.rm(taskDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  return { taskId, done };
}

// ─── 管线 ──────────────────────────────────────────────────

async function runPipeline(
  input: RunInterpInput,
  state: RunningTask,
  sender: WebContents,
  taskId: string,
  taskDir: string,
  t0: number
): Promise<InterpDonePayload> {
  const ffmpeg = ffmpegBin();
  if (!ffmpeg) throw new Error('ffmpeg 不可用（未解析到内置二进制）');
  const status = await getEngineStatus();
  if (!status.installed) {
    throw new Error('插帧引擎未安装——请先在插帧节点上点「安装插帧引擎」');
  }
  const model = input.model ?? status.defaultModel;
  if (!model || !existsSync(path.join(engineRoot(), model))) {
    throw new Error(`插帧模型 ${model ?? '(无)'} 缺失——请重新安装引擎（zip 自带 rife-v4.6 模型）`);
  }
  const src = input.inputPath.trim();
  if (!src || src.startsWith('data:')) {
    throw new Error('插帧只支持本地视频文件或公网 URL');
  }

  await sweepStaleTaskDirs();
  const inDir = path.join(taskDir, 'in');
  const outDir = path.join(taskDir, 'out');
  await fs.mkdir(inDir, { recursive: true });
  await fs.mkdir(outDir, { recursive: true });

  const push = (p: Omit<InterpProgressPayload, 'taskId' | 'clientTag'>): void => {
    if (sender.isDestroyed()) return;
    sender.send('interp:progress', { ...p, taskId, clientTag: input.clientTag });
  };

  // ── 阶段 0：探测 ──
  push({ stage: 'probe', percent: 0, framesDone: 0, framesTotal: 0, phase: '探测视频信息…' });
  const probeStderr = await runFfmpegCapture(ffmpeg, ['-hide_banner', '-i', src], state);
  if (state.cancelled) return cancelledPayload(taskId, t0);
  const info = parseFfmpegMediaInfo(probeStderr);
  if (info.durationSec != null && info.durationSec > MAX_DURATION_SEC) {
    throw new Error(
      `视频过长（${Math.round(info.durationSec)}s > ${MAX_DURATION_SEC}s 上限）——插帧需逐帧落盘，长视频会占数十 GB 临时空间，请先截取片段后重试`
    );
  }

  // ── 阶段 1：拆帧 ──
  const estFrames =
    info.fps != null && info.durationSec != null ? Math.round(info.fps * info.durationSec) : 0;
  await runStageProc(
    state,
    spawn(ffmpeg, ['-y', '-i', src, path.join(inDir, '%08d.png')], { windowsHide: true }),
    {
      idleKillMs: IDLE_KILL_MS,
      onStderr: (chunk) => {
        const f = parseFfmpegFrameProgress(chunk);
        if (f != null) {
          push({
            stage: 'extract',
            percent: overallPercent('extract', estFrames > 0 ? f / estFrames : 0.5),
            framesDone: f,
            framesTotal: estFrames,
            srcFps: info.fps ?? undefined,
            phase: `拆帧 ${f}${estFrames ? `/${estFrames}` : ''}`
          });
        }
      },
      stageName: '拆帧'
    }
  );
  if (state.cancelled) return cancelledPayload(taskId, t0);

  const srcFrames = (await fs.readdir(inDir)).filter((f) => f.endsWith('.png')).length;
  if (srcFrames === 0) throw new Error('拆帧失败（没有解出任何帧）——确认视频格式可被解码（mp4/webm/mov）');
  const srcFps =
    info.fps ?? (info.durationSec && info.durationSec > 0 ? srcFrames / info.durationSec : 24);
  const srcFpsRounded = Math.round(srcFps * 100) / 100;
  if (input.targetFps <= srcFps) {
    throw new Error(
      `目标帧率（${input.targetFps}fps）需高于源帧率（${srcFpsRounded}fps）——请选更高档位`
    );
  }
  const targetFrames = computeTargetFrames(srcFrames, srcFps, input.targetFps);
  if (targetFrames <= 0) throw new Error('目标帧数计算失败（源视频信息异常）');
  if (targetFrames > MAX_TARGET_FRAMES) {
    throw new Error(
      `目标帧数过多（${targetFrames} > ${MAX_TARGET_FRAMES} 上限）——请缩短视频或降低目标帧率`
    );
  }

  // ── 阶段 2：RIFE 插帧（进度靠轮询输出目录文件数） ──
  if (state.cancelled) return cancelledPayload(taskId, t0);
  let pollTimer: NodeJS.Timeout | null = null;
  let lastCount = -1;
  let bumpInterpWatchdog: (() => void) | null = null;
  try {
    const interpProc = spawn(
      rifeExecPath(),
      ['-i', inDir, '-o', outDir, '-m', path.join(engineRoot(), model), '-n', String(targetFrames), '-f', '%08d.png'],
      { cwd: engineRoot(), windowsHide: true }
    );
    const stagePromise = runStageProc(state, interpProc, {
      idleKillMs: IDLE_KILL_MS,
      onStderr: () => undefined,
      stageName: 'AI 插帧',
      exposeBump: (bump) => {
        bumpInterpWatchdog = bump;
      }
    });
    pollTimer = setInterval(() => {
      void fs
        .readdir(outDir)
        .then((files) => {
          const n = files.length;
          if (n > lastCount) {
            lastCount = n;
            bumpInterpWatchdog?.();
            push({
              stage: 'interp',
              percent: overallPercent('interp', targetFrames > 0 ? n / targetFrames : 0),
              framesDone: n,
              framesTotal: targetFrames,
              srcFps: srcFpsRounded,
              phase: `AI 插帧 ${n}/${targetFrames}`
            });
          }
        })
        .catch(() => undefined);
    }, 700);
    await stagePromise;
  } finally {
    if (pollTimer) clearInterval(pollTimer);
  }
  if (state.cancelled) return cancelledPayload(taskId, t0);

  const outFrames = (await fs.readdir(outDir)).filter((f) => f.endsWith('.png')).length;
  if (outFrames === 0) throw new Error('插帧失败（引擎没有输出任何帧）——检查显卡 Vulkan 驱动是否可用');

  // ── 阶段 3：合帧（带回原音轨；? 容忍无音轨） ──
  await fs.mkdir(input.outputDir, { recursive: true });
  const outFile = path.join(input.outputDir, `interp-${Date.now()}-${input.targetFps}fps.mp4`);
  await runStageProc(
    state,
    spawn(
      ffmpeg,
      [
        '-y',
        '-framerate', String(input.targetFps),
        '-i', path.join(outDir, '%08d.png'),
        '-i', src,
        '-map', '0:v',
        '-map', '1:a:0?',
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-preset', 'veryfast',
        '-crf', '20',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-shortest',
        // moov 移到文件头：<video> 起播无需先 seek 到尾部读 moov（插帧产物默认 moov 在尾）。
        '-movflags', '+faststart',
        outFile
      ],
      { windowsHide: true }
    ),
    {
      idleKillMs: IDLE_KILL_MS,
      onStderr: (chunk) => {
        const f = parseFfmpegFrameProgress(chunk);
        if (f != null) {
          push({
            stage: 'encode',
            percent: overallPercent('encode', outFrames > 0 ? f / outFrames : 0.5),
            framesDone: f,
            framesTotal: outFrames,
            srcFps: srcFpsRounded,
            phase: `合成编码 ${f}/${outFrames}`
          });
        }
      },
      stageName: '合成编码'
    }
  );
  if (state.cancelled) {
    await fs.unlink(outFile).catch(() => undefined);
    return cancelledPayload(taskId, t0);
  }
  if (!existsSync(outFile)) throw new Error('合成失败（未生成输出文件）');

  push({
    stage: 'encode',
    percent: 100,
    framesDone: outFrames,
    framesTotal: outFrames,
    srcFps: srcFpsRounded,
    phase: '完成'
  });
  return {
    taskId,
    ok: true,
    outputPath: outFile,
    srcFps: srcFpsRounded,
    srcFrames,
    outFrames,
    elapsedMs: Date.now() - t0
  };
}

function cancelledPayload(taskId: string, t0: number): InterpDonePayload {
  return { taskId, ok: false, cancelled: true, error: '已取消', elapsedMs: Date.now() - t0 };
}

// ─── 子进程助手 ────────────────────────────────────────────

function ffmpegBin(): string | null {
  // 打包后 ffmpeg-static 路径指向 app.asar 内，二进制实际被 asarUnpack 解包，需重映射（dev 下空操作）
  return (ffmpegPath as string | null)?.replace('app.asar', 'app.asar.unpacked') ?? null;
}

function tempRoot(): string {
  return path.join(app.getPath('temp'), 'mengbi-interp');
}

/** 清扫 24h 前的残留任务目录（上次崩溃/强退遗留，防爆盘）。 */
async function sweepStaleTaskDirs(): Promise<void> {
  const root = tempRoot();
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const cutoff = Date.now() - 24 * 3600 * 1000;
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const dir = path.join(root, e.name);
      if (ACTIVE_TASKS.has(e.name)) continue;
      try {
        const st = await fs.stat(dir);
        if (st.mtimeMs < cutoff) await fs.rm(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* root 不存在等 */
  }
}

/** 跑 ffmpeg 并收 stderr（用于 -i 探测：必然非 0 退出码，忽略之只取文本）。 */
function runFfmpegCapture(bin: string, args: string[], state: RunningTask): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { windowsHide: true });
    state.proc = proc;
    let stderr = '';
    proc.stderr?.on('data', (b: Buffer) => {
      stderr += b.toString();
      if (stderr.length > 64_000) stderr = stderr.slice(-64_000);
    });
    proc.on('error', (e) => {
      state.proc = null;
      reject(new Error(`ffmpeg 启动失败：${e.message}`));
    });
    proc.on('close', () => {
      state.proc = null;
      resolve(stderr);
    });
  });
}

interface StageOpts {
  idleKillMs: number;
  onStderr: (chunk: string) => void;
  stageName: string;
  /** 把看门狗 bump 函数交给调用方（插帧阶段用输出目录轮询计数喂狗） */
  exposeBump?: (bump: () => void) => void;
}

/** 跑一个阶段子进程：stderr 喂进度 + idle 看门狗 + 取消感知。非 0 退出码报错（取消除外）。 */
function runStageProc(state: RunningTask, proc: ChildProcess, opts: StageOpts): Promise<void> {
  return new Promise((resolve, reject) => {
    state.proc = proc;
    let timedOut = false;
    let watchdog: NodeJS.Timeout | null = null;
    const bump = (): void => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        timedOut = true;
        try {
          proc.kill();
        } catch {
          /* 进程可能已退出 */
        }
      }, opts.idleKillMs);
    };
    bump();
    opts.exposeBump?.(bump);

    let stderrBuf = '';
    proc.stderr?.on('data', (b: Buffer) => {
      bump();
      const s = b.toString();
      stderrBuf += s;
      if (stderrBuf.length > 16_000) stderrBuf = stderrBuf.slice(-16_000);
      try {
        opts.onStderr(s);
      } catch {
        /* 进度回调不致命 */
      }
    });
    proc.on('error', (e) => {
      if (watchdog) clearTimeout(watchdog);
      state.proc = null;
      reject(new Error(`${opts.stageName}启动失败：${e.message}`));
    });
    proc.on('close', (code, signal) => {
      if (watchdog) clearTimeout(watchdog);
      state.proc = null;
      if (state.cancelled) {
        resolve(); // 取消由上层统一收尾
        return;
      }
      if (timedOut) {
        reject(
          new Error(`${opts.stageName}超时（${Math.round(opts.idleKillMs / 60000)} 分钟无进展，已自动终止）——检查显卡驱动或换更短的视频`)
        );
        return;
      }
      if (code === 0) {
        resolve();
        return;
      }
      const tail = stderrBuf.trim().split(/\r?\n/).slice(-5).join(' | ');
      logger.warn(`[rife] ${opts.stageName} exited ${code ?? signal}: ${tail}`);
      reject(new Error(`${opts.stageName}失败（退出码 ${code ?? signal}）：${tail || '(无输出)'}`));
    });
  });
}
