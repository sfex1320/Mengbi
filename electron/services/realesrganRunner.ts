/**
 * Real-ESRGAN ncnn Vulkan 运行器。
 *
 * 单图 / 批量都靠 child_process.spawn 调 realesrgan-ncnn-vulkan.exe。
 * 进度从 stderr 里解析（每个 tile 完成会打 'XX.XX%'）。
 * 取消靠 proc.kill('SIGTERM')；Windows 上 SIGTERM 等价 TerminateProcess。
 *
 * 任务模型：
 * - 每个外部调用拿到一个 taskId
 * - 同一 taskId 内可以串多张图（批量），每张推完发一条 'upscale:progress'
 * - 完成或失败发 'upscale:done'
 *
 * 注意：单卡 GPU 并发跑会拖慢甚至 OOM，统一在 main-process 全局队列里串行执行。
 */

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { app, type WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import { logger } from './logger';
import { execPath, modelsDir, getEngineStatus } from './realesrganEngine';

export type OutFormat = 'png' | 'jpg' | 'webp';

export interface UpscaleParams {
  modelName: string;
  scale: 2 | 3 | 4;
  format: OutFormat;
  tile: number;
  gpuId: number | 'auto';
  tta: boolean;
}

export interface UpscaleProgressPayload {
  taskId: string;
  /** 批量时表明当前是第几张 */
  itemIndex: number;
  itemCount: number;
  /** 当前单张的 0-100 */
  percent: number;
  phase: string;
  currentInput?: string;
}

export interface UpscaleItemResult {
  inputPath: string;
  outputPath: string;
  inputW: number;
  inputH: number;
  outputW: number;
  outputH: number;
  elapsedMs: number;
}

export interface UpscaleDonePayload {
  taskId: string;
  ok: boolean;
  results: UpscaleItemResult[];
  /** ok=false 时填，描述失败原因 */
  error?: string;
  cancelled?: boolean;
}

// ─── 全局任务管理 ─────────────────────────────────────────

interface RunningTask {
  taskId: string;
  proc: ChildProcess | null;
  cancelled: boolean;
}

const ACTIVE_TASKS = new Map<string, RunningTask>();
/** 串行队列：同时只跑一张图，避免 Vulkan 显存抖动 */
let queueChain: Promise<unknown> = Promise.resolve();

function enqueueSerial<T>(fn: () => Promise<T>): Promise<T> {
  const next = queueChain.then(() => fn(), () => fn());
  queueChain = next.catch(() => undefined);
  return next;
}

// ─── dataUri ↔ file ───────────────────────────────────────

const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp'
};

function dataUriToBuffer(dataUri: string): { buf: Buffer; ext: string } | null {
  const m = dataUri.match(/^data:([^;]+);base64,(.*)$/);
  if (!m) return null;
  const ext = MIME_TO_EXT[m[1]] ?? 'png';
  return { buf: Buffer.from(m[2], 'base64'), ext };
}

async function writeTempInput(dataUri: string): Promise<string> {
  const decoded = dataUriToBuffer(dataUri);
  if (!decoded) throw new Error('输入不是合法 dataUri');
  const dir = path.join(app.getPath('temp'), 'mengbi-upscale');
  await fs.mkdir(dir, { recursive: true });
  const fp = path.join(dir, `${randomUUID()}.${decoded.ext}`);
  await fs.writeFile(fp, decoded.buf);
  return fp;
}

// ─── 主入口 ───────────────────────────────────────────────

export interface RunSingleInput {
  inputDataUri?: string;
  inputPath?: string;
  outputDir?: string;
  outputFileName?: string;
  params: UpscaleParams;
}

export interface RunBatchInput {
  inputPaths: string[];
  outputDir: string;
  params: UpscaleParams;
}

export interface RunHandle {
  taskId: string;
  /** done 在最后一张推完（或失败/取消）时 resolve */
  done: Promise<UpscaleDonePayload>;
}

/**
 * 跑单图——内部仍走批量逻辑，n=1
 */
export function runSingle(
  input: RunSingleInput,
  sender: WebContents,
  defaultOutputDir: string
): RunHandle {
  return runJob(
    {
      inputPaths: [],
      single: input,
      outputDir: input.outputDir ?? defaultOutputDir,
      params: input.params
    },
    sender
  );
}

export function runBatch(input: RunBatchInput, sender: WebContents): RunHandle {
  return runJob(
    {
      inputPaths: input.inputPaths,
      outputDir: input.outputDir,
      params: input.params
    },
    sender
  );
}

interface JobInput {
  inputPaths: string[];
  /** 若 single 模式（dataUri），需要先 dump 到 temp 再当 inputPaths[0] */
  single?: RunSingleInput;
  outputDir: string;
  params: UpscaleParams;
}

function runJob(job: JobInput, sender: WebContents): RunHandle {
  const taskId = randomUUID();
  const state: RunningTask = { taskId, proc: null, cancelled: false };
  ACTIVE_TASKS.set(taskId, state);

  const done = enqueueSerial(async () => {
    try {
      const status = await getEngineStatus();
      if (!status.installed) {
        throw new Error('Real-ESRGAN 引擎未安装——请先在工具箱设置里点「安装引擎」');
      }
      if (!hasModel(status.models, job.params.modelName)) {
        throw new Error(`模型 "${job.params.modelName}" 缺失——请先在「模型管理」下载或导入`);
      }

      // 单图模式：dataUri → temp file
      const inputs: string[] = [...job.inputPaths];
      const tempInputsToClean: string[] = [];
      if (job.single) {
        if (job.single.inputDataUri) {
          const fp = await writeTempInput(job.single.inputDataUri);
          inputs.push(fp);
          tempInputsToClean.push(fp);
        } else if (job.single.inputPath) {
          inputs.push(job.single.inputPath);
        }
      }
      if (inputs.length === 0) throw new Error('没有输入图');

      await fs.mkdir(job.outputDir, { recursive: true });

      const results: UpscaleItemResult[] = [];
      for (let i = 0; i < inputs.length; i++) {
        if (state.cancelled) break;
        sendProgress(sender, {
          taskId,
          itemIndex: i,
          itemCount: inputs.length,
          percent: 0,
          phase: '准备中…',
          currentInput: path.basename(inputs[i])
        });

        const inputPath = inputs[i];
        if (!existsSync(inputPath)) {
          throw new Error(`输入文件不存在：${inputPath}`);
        }
        const outName = resolveOutputName(
          inputPath,
          job.params,
          job.single?.outputFileName,
          i,
          inputs.length
        );
        const outputPath = path.join(job.outputDir, outName);
        // 避免覆盖：找一个不冲突的名字
        const finalOut = await ensureUniquePath(outputPath);

        const t0 = Date.now();
        await runOneImage(state, sender, taskId, i, inputs.length, inputPath, finalOut, job.params);
        const elapsedMs = Date.now() - t0;

        const inSize = await probeImageSize(inputPath);
        const outSize = await probeImageSize(finalOut);
        results.push({
          inputPath,
          outputPath: finalOut,
          inputW: inSize.w,
          inputH: inSize.h,
          outputW: outSize.w,
          outputH: outSize.h,
          elapsedMs
        });

        sendProgress(sender, {
          taskId,
          itemIndex: i,
          itemCount: inputs.length,
          percent: 100,
          phase: '完成',
          currentInput: path.basename(inputPath)
        });
      }

      // 清掉临时 dataUri 输入
      for (const fp of tempInputsToClean) {
        await fs.unlink(fp).catch(() => undefined);
      }

      const payload: UpscaleDonePayload = {
        taskId,
        ok: true,
        results,
        cancelled: state.cancelled
      };
      sendDone(sender, payload);
      return payload;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const payload: UpscaleDonePayload = {
        taskId,
        ok: false,
        results: [],
        error: msg,
        cancelled: state.cancelled
      };
      sendDone(sender, payload);
      return payload;
    } finally {
      ACTIVE_TASKS.delete(taskId);
    }
  });

  return { taskId, done };
}

function hasModel(
  models: Array<{ name: string; sizeBytes: number }>,
  name: string
): boolean {
  return models.some((m) => m.name === name);
}

function resolveOutputName(
  inputPath: string,
  params: UpscaleParams,
  override: string | undefined,
  _index: number,
  total: number
): string {
  if (override) {
    // 用户自定义名字时只在单图模式下生效；批量时退回自动
    if (total === 1 && !override.includes(path.sep)) {
      // 已带后缀就用，否则按 format 自动补
      if (/\.(png|jpg|jpeg|webp)$/i.test(override)) return override;
      return `${override}.${params.format}`;
    }
  }
  const base = path.basename(inputPath, path.extname(inputPath));
  return `${base}-x${params.scale}-${params.modelName}.${params.format}`;
}

async function ensureUniquePath(p: string): Promise<string> {
  if (!existsSync(p)) return p;
  const dir = path.dirname(p);
  const ext = path.extname(p);
  const base = path.basename(p, ext);
  for (let i = 2; i < 1000; i++) {
    const cand = path.join(dir, `${base}-${i}${ext}`);
    if (!existsSync(cand)) return cand;
  }
  return path.join(dir, `${base}-${Date.now()}${ext}`);
}

async function probeImageSize(p: string): Promise<{ w: number; h: number }> {
  try {
    // 优先用 sharp（项目已依赖）；它能读 jpg/png/webp
    const sharp = (await import('sharp')).default;
    const meta = await sharp(p).metadata();
    return { w: meta.width ?? 0, h: meta.height ?? 0 };
  } catch {
    return { w: 0, h: 0 };
  }
}

// ─── 实际 spawn ──────────────────────────────────────────

function runOneImage(
  state: RunningTask,
  sender: WebContents,
  taskId: string,
  itemIndex: number,
  itemCount: number,
  inputPath: string,
  outputPath: string,
  params: UpscaleParams
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args: string[] = [
      '-i', inputPath,
      '-o', outputPath,
      '-n', params.modelName,
      '-s', String(params.scale),
      '-t', String(params.tile),
      '-f', params.format,
      '-m', modelsDir()
    ];
    if (params.gpuId !== 'auto') {
      args.push('-g', String(params.gpuId));
    }
    if (params.tta) args.push('-x');

    logger.debug(`[realesrgan] spawn ${execPath()} ${args.join(' ')}`);
    const proc = spawn(execPath(), args, {
      cwd: path.dirname(execPath()),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    state.proc = proc;

    // 看门狗：超过 IDLE_KILL_MS 完全没有 stderr 输出（进度/诊断）即视为挂死
    // （Vulkan 驱动死锁 / GPU hang 时外部 exe 既不退出也不报错也不输出）——杀掉并报错，
    // 否则会永久阻塞主进程里的串行放大队列。正常运行时 ncnn 持续打印 'XX.XX%'，每条都重置计时。
    const IDLE_KILL_MS = 300_000;
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    let timedOut = false;
    const bumpWatchdog = (): void => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        timedOut = true;
        try {
          proc.kill();
        } catch {
          /* 进程可能已退出 */
        }
      }, IDLE_KILL_MS);
    };
    const clearWatchdog = (): void => {
      if (watchdog) {
        clearTimeout(watchdog);
        watchdog = null;
      }
    };
    bumpWatchdog();

    let stderrBuf = '';
    proc.stderr.on('data', (b: Buffer) => {
      bumpWatchdog();
      const s = b.toString();
      stderrBuf += s;
      // 每一行可能是 'XX.XX%' 或诊断消息；批量推到 progress
      const matches = s.match(/(\d{1,3}(?:\.\d+)?)%/g);
      if (matches && matches.length > 0) {
        const last = matches[matches.length - 1];
        const pct = Math.min(99, Math.max(0, Math.round(parseFloat(last))));
        sendProgress(sender, {
          taskId,
          itemIndex,
          itemCount,
          percent: pct,
          phase: `推理中 ${pct}%`,
          currentInput: path.basename(inputPath)
        });
      }
    });
    proc.on('error', (e) => {
      clearWatchdog();
      state.proc = null;
      reject(new Error(`spawn 失败：${e.message}`));
    });
    proc.on('close', (code, signal) => {
      clearWatchdog();
      state.proc = null;
      if (timedOut) {
        fs.unlink(outputPath).catch(() => undefined);
        reject(new Error('放大超时（5 分钟无进度，疑似引擎/显卡挂起，已自动终止）— 可尝试调小 tile 或检查 Vulkan 驱动'));
        return;
      }
      if (state.cancelled) {
        // 清掉可能的半截输出
        fs.unlink(outputPath).catch(() => undefined);
        reject(new Error('已取消'));
        return;
      }
      if (code === 0 && existsSync(outputPath)) {
        const st = statSync(outputPath);
        if (st.size < 64) {
          reject(new Error(`输出文件过小（${st.size}B），引擎可能未真正运行`));
          return;
        }
        resolve();
        return;
      }
      const tail = stderrBuf.trim().split(/\r?\n/).slice(-6).join(' | ');
      reject(
        new Error(
          `引擎退出码 ${code ?? signal}；最近输出：${tail || '(空)'} ` +
            '— 常见原因：模型名拼错、tile 太大爆显存、Vulkan 驱动不可用'
        )
      );
    });
  });
}

// ─── 取消 ────────────────────────────────────────────────

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

// ─── push 助手 ────────────────────────────────────────────

function sendProgress(sender: WebContents, payload: UpscaleProgressPayload): void {
  if (sender.isDestroyed()) return;
  sender.send('upscale:progress', payload);
}

function sendDone(sender: WebContents, payload: UpscaleDonePayload): void {
  if (sender.isDestroyed()) return;
  sender.send('upscale:done', payload);
}

// ─── 给单图模式回传 dataUri 用 ────────────────────────────

export async function fileToDataUri(p: string): Promise<string> {
  const buf = await fs.readFile(p);
  const ext = path.extname(p).toLowerCase();
  const mime =
    ext === '.jpg' || ext === '.jpeg'
      ? 'image/jpeg'
      : ext === '.webp'
        ? 'image/webp'
        : 'image/png';
  return `data:${mime};base64,${buf.toString('base64')}`;
}
