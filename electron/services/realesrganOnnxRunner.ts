/**
 * Real-ESRGAN ONNX 运行器(2026-05-28)。
 *
 * 替代以前的 PyTorch sidecar 路径 —— 主进程内用 onnxruntime-node 直接跑推理,
 * 无 Python、无 sidecar、无端口、无冷启动。
 *
 * 执行 provider(自动选,顺序回退):
 *   Windows: DirectML(GPU,A 卡/N 卡通吃) → CPU
 *   macOS:   CoreML → CPU
 *   Linux:   CUDA(若 onnxruntime-node-cuda 装了) → CPU
 *
 * Tiling 逻辑直接 port 自 xinntao/Real-ESRGAN(realesrgan/utils.py):
 *   1. 整图先 reflection padding 10px(pre_pad)
 *   2. 切 tile_size × tile_size 块,每块再扩 tile_pad=10px
 *   3. 推理后,从每块输出中"砍掉 4*tile_pad px 边",留中心拼接
 *   4. 全图拼完再砍 4*pre_pad px 边,得最终输出
 *
 * 进度推送:与 ncnn runner 同 shape("upscale:progress" / "upscale:done"),
 * UI 共用同一套 task 表。
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { app, type WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import type * as ort from 'onnxruntime-node';
import { logger } from './logger';

// onnxruntime-node 是 200MB+ 的重型 native 模块（加载时还要侧载 DirectML 等 DLL）。
// 顶层静态 import 会在启动注册 IPC 时就同步加载、拖慢冷启动 —— 改为首次真正推理时才
// 动态加载（与 localLlmServer 对 node-llama-cpp 的 lazy 模式一致）。类型引用走 import type（零运行时开销）。
let ortModule: typeof import('onnxruntime-node') | null = null;
async function getOrt(): Promise<typeof import('onnxruntime-node')> {
  if (!ortModule) ortModule = await import('onnxruntime-node');
  return ortModule;
}
import { findOnnxSpec, ONNX_MODELS } from './realesrganOnnxModels';
import type {
  OutFormat,
  RunHandle,
  UpscaleDonePayload,
  UpscaleItemResult,
  UpscaleProgressPayload
} from './realesrganRunner';

// 模型 onnx 文件落盘目录
export function onnxModelsDir(): string {
  return path.join(app.getPath('userData'), 'engines', 'realesrgan-onnx', 'models');
}

// 默认 tile 大小;Real-ESRGAN 论文 + 实践经验:DirectML 8GB 显存下 256 是稳的
const DEFAULT_TILE = 256;
const TILE_PAD = 10;
const PRE_PAD = 10;

// ── ONNX session cache(同一模型连续多张图避免重复 init) ──────────────
interface SessionCacheEntry {
  modelPath: string;
  session: ort.InferenceSession;
  loadedAt: number;
}
let sessionCache: SessionCacheEntry | null = null;

// 任务结束 30s 内若没新任务则自动释放 session(关键:防止 ORT 把 GPU / RAM 一直占着,
// 拖累 UI 滚动 / IPC 调度。30s 留余量给"连发两张"场景免重复冷加载)。
const AUTO_RELEASE_DELAY_MS = 30_000;
let releaseTimer: NodeJS.Timeout | null = null;

function cancelAutoRelease(): void {
  if (releaseTimer) {
    clearTimeout(releaseTimer);
    releaseTimer = null;
  }
}

function scheduleAutoRelease(): void {
  cancelAutoRelease();
  releaseTimer = setTimeout(() => {
    releaseTimer = null;
    void releaseOnnxSession().then(() => {
      logger.info(
        `[realesrgan-onnx] auto-released ORT session after ${AUTO_RELEASE_DELAY_MS}ms idle`
      );
    });
  }, AUTO_RELEASE_DELAY_MS);
}

async function ensureSession(modelPath: string): Promise<ort.InferenceSession> {
  cancelAutoRelease();
  if (sessionCache && sessionCache.modelPath === modelPath) {
    return sessionCache.session;
  }
  if (sessionCache) {
    try {
      await sessionCache.session.release();
    } catch {
      /* */
    }
    sessionCache = null;
  }
  // 平台默认 EP 顺序;onnxruntime-node 会按平台 prebuilt 自动 fallback
  const executionProviders: string[] = (() => {
    switch (process.platform) {
      case 'win32':
        return ['dml', 'cpu'];
      case 'darwin':
        return ['coreml', 'cpu'];
      case 'linux':
        return ['cuda', 'cpu'];
      default:
        return ['cpu'];
    }
  })();

  logger.info(
    `[realesrgan-onnx] loading session: ${path.basename(modelPath)}, EP=${executionProviders.join('/')}`
  );

  const ortRt = await getOrt();
  const session = await ortRt.InferenceSession.create(modelPath, {
    executionProviders,
    graphOptimizationLevel: 'all',
    logSeverityLevel: 3
  });
  sessionCache = { modelPath, session, loadedAt: Date.now() };
  return session;
}

export async function releaseOnnxSession(): Promise<void> {
  if (!sessionCache) return;
  try {
    await sessionCache.session.release();
  } catch {
    /* */
  }
  sessionCache = null;
}

/**
 * 预热 ONNX session —— 用户选定模型 / 拖入文件 / 即将提交前后台静默调用。
 * 跑到 ensureSession 完成,首次推理就跳过冷加载 5-15s。失败不抛错,只 log。
 */
export async function prewarmOnnxSession(modelId: string): Promise<boolean> {
  try {
    const spec = findOnnxSpec(modelId);
    const fileName = spec?.fileName ?? modelId;
    const modelPath = path.join(onnxModelsDir(), fileName);
    if (!existsSync(modelPath)) return false;
    cancelAutoRelease();
    await ensureSession(modelPath);
    return true;
  } catch (e) {
    logger.warn(`[realesrgan-onnx] prewarm failed: ${(e as Error).message}`);
    return false;
  }
}

// ── 图像 I/O(sharp 是项目现有依赖) ────────────────────────────────

interface RawImage {
  data: Float32Array; // length = C * H * W,值域 0..1,NCHW(N=1)
  width: number;
  height: number;
  channels: number; // 通常 3;带 alpha 时单独处理
  alpha: Float32Array | null; // 单通道 alpha(H*W),0..1;无则 null
}

async function readImageNCHW(filePath: string): Promise<RawImage> {
  const sharp = (await import('sharp')).default;
  const meta = await sharp(filePath).metadata();
  const hasAlpha = !!meta.hasAlpha;
  // 保留 RGBA 或 RGB,后续按 hasAlpha 分流
  const sharpImg = hasAlpha
    ? sharp(filePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    : sharp(filePath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { data: buf, info } = await sharpImg;
  const { width, height, channels } = info;
  const pixelCount = width * height;
  // 分离 alpha
  let alphaArr: Float32Array | null = null;
  const rgbFloat = new Float32Array(3 * pixelCount);
  if (hasAlpha && channels === 4) {
    alphaArr = new Float32Array(pixelCount);
    for (let i = 0, srcI = 0; i < pixelCount; i++, srcI += 4) {
      // sharp interleaved RGBA → 分到 NCHW 的 R / G / B 三个 plane
      rgbFloat[i] = buf[srcI] / 255;
      rgbFloat[i + pixelCount] = buf[srcI + 1] / 255;
      rgbFloat[i + 2 * pixelCount] = buf[srcI + 2] / 255;
      alphaArr[i] = buf[srcI + 3] / 255;
    }
  } else {
    for (let i = 0, srcI = 0; i < pixelCount; i++, srcI += 3) {
      rgbFloat[i] = buf[srcI] / 255;
      rgbFloat[i + pixelCount] = buf[srcI + 1] / 255;
      rgbFloat[i + 2 * pixelCount] = buf[srcI + 2] / 255;
    }
  }
  return { data: rgbFloat, width, height, channels: 3, alpha: alphaArr };
}

async function writeImageFromNCHW(
  data: Uint8Array,
  width: number,
  height: number,
  alphaArr: Float32Array | null,
  alphaScale: number,
  outputPath: string,
  format: OutFormat,
  keepAlpha: boolean
): Promise<void> {
  const pixelCount = width * height;
  // 拼回 interleaved（data 已是 0-255 的 uint8 NCHW，无需再 ×255）
  const useAlpha = keepAlpha && alphaArr !== null && format !== 'jpg';
  const channels = useAlpha ? 4 : 3;
  const buf = Buffer.alloc(pixelCount * channels);
  for (let i = 0; i < pixelCount; i++) {
    buf[i * channels] = data[i];
    buf[i * channels + 1] = data[i + pixelCount];
    buf[i * channels + 2] = data[i + 2 * pixelCount];
    if (useAlpha) {
      // alphaArr 是原图 alpha(原尺寸),需要 nearest 上采到放大后尺寸
      buf[i * channels + 3] = sampleAlphaNearest(alphaArr!, width, height, i, alphaScale);
    }
  }
  const sharp = (await import('sharp')).default;
  let img = sharp(buf, { raw: { width, height, channels } });
  if (format === 'png') img = img.png();
  else if (format === 'jpg') img = img.jpeg({ quality: 95 });
  else img = img.webp({ quality: 95 });
  await img.toFile(outputPath);
}

function sampleAlphaNearest(
  alphaArr: Float32Array,
  outW: number,
  outH: number,
  outI: number,
  scale: number
): number {
  // outI 是输出 plane 的 idx(0..outW*outH);把它换算到原图坐标
  const ox = outI % outW;
  const oy = Math.floor(outI / outW);
  const sx = Math.min(Math.floor(ox / scale), Math.floor(outW / scale) - 1);
  const sy = Math.min(Math.floor(oy / scale), Math.floor(outH / scale) - 1);
  const srcW = Math.floor(outW / scale);
  return Math.max(0, Math.min(255, Math.round(alphaArr[sy * srcW + sx] * 255)));
}

// ── reflect padding ────────────────────────────────────────────────

function reflectPad(
  data: Float32Array, // NCHW,N=1
  width: number,
  height: number,
  channels: number,
  pad: number
): { data: Float32Array; width: number; height: number } {
  if (pad === 0) return { data, width, height };
  const newW = width + 2 * pad;
  const newH = height + 2 * pad;
  const out = new Float32Array(channels * newW * newH);
  const planeIn = width * height;
  const planeOut = newW * newH;
  for (let c = 0; c < channels; c++) {
    for (let y = 0; y < newH; y++) {
      // 反射映射:y_src = abs(y - pad);超 height-1 时镜像回来
      let ys = y - pad;
      if (ys < 0) ys = -ys;
      else if (ys >= height) ys = 2 * (height - 1) - ys;
      ys = Math.max(0, Math.min(height - 1, ys));
      for (let x = 0; x < newW; x++) {
        let xs = x - pad;
        if (xs < 0) xs = -xs;
        else if (xs >= width) xs = 2 * (width - 1) - xs;
        xs = Math.max(0, Math.min(width - 1, xs));
        out[c * planeOut + y * newW + x] = data[c * planeIn + ys * width + xs];
      }
    }
  }
  return { data: out, width: newW, height: newH };
}

// ── tile 推理 ────────────────────────────────────────────────

interface InferContext {
  session: ort.InferenceSession;
  inputName: string;
  outputName: string;
  scale: number;
}

async function inferTile(
  ctx: InferContext,
  tile: Float32Array,
  tileW: number,
  tileH: number
): Promise<{ data: Float32Array; outW: number; outH: number }> {
  const ortRt = await getOrt();
  const tensor = new ortRt.Tensor('float32', tile, [1, 3, tileH, tileW]);
  const feeds: Record<string, ort.Tensor> = { [ctx.inputName]: tensor };
  const results = await ctx.session.run(feeds);
  const outTensor = results[ctx.outputName] ?? results[Object.keys(results)[0]];
  const outDims = outTensor.dims;
  if (outDims.length !== 4) {
    throw new Error(`期望 ONNX 输出 4D,实际 ${outDims.length}D`);
  }
  const outH = outDims[2];
  const outW = outDims[3];
  return { data: outTensor.data as Float32Array, outW, outH };
}

async function tileProcess(
  ctx: InferContext,
  input: Float32Array,
  width: number,
  height: number,
  tileSize: number,
  scale: number,
  onTile?: (i: number, total: number) => void
): Promise<{ data: Uint8Array; outW: number; outH: number }> {
  const outW = width * scale;
  const outH = height * scale;
  // 拼装大图用 uint8（0-255）而非 float32：内存只占 1/4，避免大图 4× 时单块 >2GB 分配失败
  const output = new Uint8Array(3 * outW * outH);
  const planeIn = width * height;
  const planeOut = outW * outH;
  const to255 = (v: number): number => (v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255));

  if (tileSize === 0 || (width <= tileSize && height <= tileSize)) {
    const r = await inferTile(ctx, input, width, height);
    onTile?.(1, 1);
    const u = new Uint8Array(3 * r.outW * r.outH);
    for (let k = 0; k < u.length; k++) u[k] = to255(r.data[k]);
    return { data: u, outW: r.outW, outH: r.outH };
  }

  const tilesX = Math.ceil(width / tileSize);
  const tilesY = Math.ceil(height / tileSize);
  const total = tilesX * tilesY;
  let done = 0;

  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const sx = tx * tileSize;
      const ex = Math.min(sx + tileSize, width);
      const sy = ty * tileSize;
      const ey = Math.min(sy + tileSize, height);

      const sxp = Math.max(sx - TILE_PAD, 0);
      const exp = Math.min(ex + TILE_PAD, width);
      const syp = Math.max(sy - TILE_PAD, 0);
      const eyp = Math.min(ey + TILE_PAD, height);

      const tileW = exp - sxp;
      const tileH = eyp - syp;

      const tileData = new Float32Array(3 * tileW * tileH);
      const planeTile = tileW * tileH;
      for (let c = 0; c < 3; c++) {
        for (let y = 0; y < tileH; y++) {
          for (let x = 0; x < tileW; x++) {
            tileData[c * planeTile + y * tileW + x] =
              input[c * planeIn + (syp + y) * width + (sxp + x)];
          }
        }
      }

      const r = await inferTile(ctx, tileData, tileW, tileH);

      // 输出在最终大图中的位置(中心区,扣掉 pad 边)
      const oSX = sx * scale;
      const oSY = sy * scale;
      // 输出 tile 内对应中心区起点
      const oSX_T = (sx - sxp) * scale;
      const oSY_T = (sy - syp) * scale;
      const widthOut = ex - sx;
      const heightOut = ey - sy;

      for (let c = 0; c < 3; c++) {
        for (let y = 0; y < heightOut * scale; y++) {
          for (let x = 0; x < widthOut * scale; x++) {
            output[c * planeOut + (oSY + y) * outW + (oSX + x)] = to255(
              r.data[c * (r.outW * r.outH) + (oSY_T + y) * r.outW + (oSX_T + x)]
            );
          }
        }
      }
      done += 1;
      onTile?.(done, total);
    }
  }
  return { data: output, outW, outH };
}

// ── 主流程 ────────────────────────────────────────────────

export interface OnnxUpscaleParams {
  /** 内部 id(对应 OnnxModelSpec.id) */
  modelId: string;
  /** UI 目标倍率;若模型 nativeScale=4 但用户选 2x,会做 4x 推理后 downsample */
  scale: 2 | 3 | 4;
  format: OutFormat;
  /** tile 大小:0=自动(整图);默认 256 */
  tile: number;
  /** 输出保留 alpha 通道 */
  keepAlpha: boolean;
}

interface RunningTask {
  taskId: string;
  cancelled: boolean;
}
const ACTIVE_TASKS = new Map<string, RunningTask>();

export interface RunOnnxSingleInput {
  inputDataUri?: string;
  inputPath?: string;
  outputDir: string;
  outputFileName?: string;
  params: OnnxUpscaleParams;
}

export interface RunOnnxBatchInput {
  inputPaths: string[];
  outputDir: string;
  params: OnnxUpscaleParams;
}

export function runOnnxSingle(input: RunOnnxSingleInput, sender: WebContents): RunHandle {
  return runJob(
    {
      inputPaths: [],
      single: input,
      outputDir: input.outputDir,
      params: input.params
    },
    sender
  );
}

export function runOnnxBatch(input: RunOnnxBatchInput, sender: WebContents): RunHandle {
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
  single?: RunOnnxSingleInput;
  outputDir: string;
  params: OnnxUpscaleParams;
}

function runJob(job: JobInput, sender: WebContents): RunHandle {
  const taskId = randomUUID();
  const state: RunningTask = { taskId, cancelled: false };
  ACTIVE_TASKS.set(taskId, state);

  const done = (async () => {
    try {
      // modelId 可能是:
      //   ① 内置 OnnxModelSpec.id —— findOnnxSpec 命中,用 spec.fileName + nativeScale
      //   ② 用户自传的 .onnx 文件名 —— spec 未命中,modelId 自身就是 fileName,nativeScale 默认 4
      const spec = findOnnxSpec(job.params.modelId);
      const fileName = spec?.fileName ?? job.params.modelId;
      const nativeScale = spec?.nativeScale ?? 4;
      const displayLabel = spec?.displayName ?? fileName;

      const modelPath = path.join(onnxModelsDir(), fileName);
      if (!existsSync(modelPath)) {
        throw new Error(
          `ONNX 模型未下载:${displayLabel} — 设置 → 工具箱 → ONNX 模型库 下载或导入对应 .onnx`
        );
      }

      // 1) 收集输入路径
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

      // 2) 准备 session
      sendProgress(sender, {
        taskId,
        itemIndex: 0,
        itemCount: inputs.length,
        percent: 0,
        phase: '加载 ONNX 模型…'
      });
      const session = await ensureSession(modelPath);
      const inputName = session.inputNames[0];
      const outputName = session.outputNames[0];
      const ctx: InferContext = {
        session,
        inputName,
        outputName,
        scale: nativeScale
      };

      // 3) 逐张推理
      const results: UpscaleItemResult[] = [];
      for (let i = 0; i < inputs.length; i++) {
        if (state.cancelled) break;
        const inputPath = inputs[i];
        if (!existsSync(inputPath)) {
          throw new Error(`输入文件不存在:${inputPath}`);
        }
        sendProgress(sender, {
          taskId,
          itemIndex: i,
          itemCount: inputs.length,
          percent: 0,
          phase: '读图 + 预处理…',
          currentInput: path.basename(inputPath)
        });

        const t0 = Date.now();
        const img = await readImageNCHW(inputPath);
        const padded = reflectPad(img.data, img.width, img.height, 3, PRE_PAD);

        const tileSize = job.params.tile > 0 ? job.params.tile : DEFAULT_TILE;
        sendProgress(sender, {
          taskId,
          itemIndex: i,
          itemCount: inputs.length,
          percent: 5,
          phase: tileSize === 0 ? '整图推理…' : `分块推理(${tileSize}px)…`,
          currentInput: path.basename(inputPath)
        });

        const inferred = await tileProcess(
          ctx,
          padded.data,
          padded.width,
          padded.height,
          tileSize,
          nativeScale,
          (d, total) => {
            const pct = Math.max(5, Math.min(95, 5 + Math.round((d / total) * 85)));
            sendProgress(sender, {
              taskId,
              itemIndex: i,
              itemCount: inputs.length,
              percent: pct,
              phase: `tile ${d}/${total}`,
              currentInput: path.basename(inputPath)
            });
          }
        );

        // 4) 砍掉 pre_pad 边
        const padScale = PRE_PAD * nativeScale;
        const finalW = img.width * nativeScale;
        const finalH = img.height * nativeScale;
        // cropped 用 uint8（0-255 NCHW），不再用 float32，避免大图单块 >2GB
        const cropped = new Uint8Array(3 * finalW * finalH);
        const planeIn = inferred.outW * inferred.outH;
        const planeOut = finalW * finalH;
        for (let c = 0; c < 3; c++) {
          for (let y = 0; y < finalH; y++) {
            for (let x = 0; x < finalW; x++) {
              cropped[c * planeOut + y * finalW + x] =
                inferred.data[c * planeIn + (y + padScale) * inferred.outW + (x + padScale)];
            }
          }
        }

        // 5) 用户目标倍率 != native:再 sharp downsample
        let outW = finalW;
        let outH = finalH;
        let outData: Uint8Array = cropped;
        if (job.params.scale !== nativeScale) {
          // NCHW uint8 → interleaved uint8 Buffer,sharp resize 再读回 uint8 NCHW
          const buf = Buffer.alloc(3 * finalW * finalH);
          for (let i2 = 0; i2 < finalW * finalH; i2++) {
            buf[i2 * 3] = cropped[i2];
            buf[i2 * 3 + 1] = cropped[i2 + finalW * finalH];
            buf[i2 * 3 + 2] = cropped[i2 + 2 * finalW * finalH];
          }
          const sharp = (await import('sharp')).default;
          const targetW = Math.round(img.width * job.params.scale);
          const targetH = Math.round(img.height * job.params.scale);
          const resized = await sharp(buf, {
            raw: { width: finalW, height: finalH, channels: 3 }
          })
            .resize(targetW, targetH, { kernel: 'lanczos3' })
            .raw()
            .toBuffer();
          const tp = targetW * targetH;
          const nd = new Uint8Array(3 * tp);
          for (let i2 = 0; i2 < tp; i2++) {
            nd[i2] = resized[i2 * 3];
            nd[i2 + tp] = resized[i2 * 3 + 1];
            nd[i2 + 2 * tp] = resized[i2 * 3 + 2];
          }
          outData = nd;
          outW = targetW;
          outH = targetH;
        }

        // 6) 写盘
        // 输出文件名用 spec.id(内置)或 fileName 去掉 .onnx 后缀(用户自传)做标识
        const outNameId = spec?.id ?? fileName.replace(/\.onnx$/i, '');
        const outName = resolveOutputName(
          inputPath,
          outNameId,
          job.params.scale,
          job.params.format,
          job.single?.outputFileName,
          inputs.length
        );
        const outputPath = await ensureUniquePath(path.join(job.outputDir, outName));
        await writeImageFromNCHW(
          outData,
          outW,
          outH,
          img.alpha,
          job.params.scale,
          outputPath,
          job.params.format,
          job.params.keepAlpha
        );

        const elapsedMs = Date.now() - t0;
        results.push({
          inputPath,
          outputPath,
          inputW: img.width,
          inputH: img.height,
          outputW: outW,
          outputH: outH,
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
      logger.error(`[realesrgan-onnx] task ${taskId} failed: ${msg}`);
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
  })();

  return { taskId, done };
}

export function cancelOnnxTask(taskId?: string): { cancelledTaskIds: string[] } {
  const ids: string[] = [];
  if (taskId) {
    const t = ACTIVE_TASKS.get(taskId);
    if (t) {
      t.cancelled = true;
      ids.push(taskId);
    }
  } else {
    for (const [id, t] of ACTIVE_TASKS.entries()) {
      t.cancelled = true;
      ids.push(id);
    }
  }
  return { cancelledTaskIds: ids };
}

// ── helpers ────────────────────────────────────────────────

const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp'
};

async function writeTempInput(dataUri: string): Promise<string> {
  const m = dataUri.match(/^data:([^;]+);base64,(.*)$/);
  if (!m) throw new Error('输入不是合法 dataUri');
  const ext = MIME_TO_EXT[m[1]] ?? 'png';
  const buf = Buffer.from(m[2], 'base64');
  const dir = path.join(app.getPath('temp'), 'mengbi-upscale-onnx');
  await fs.mkdir(dir, { recursive: true });
  const fp = path.join(dir, `${randomUUID()}.${ext}`);
  await fs.writeFile(fp, buf);
  return fp;
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

function resolveOutputName(
  inputPath: string,
  modelId: string,
  scale: number,
  format: OutFormat,
  override: string | undefined,
  total: number
): string {
  if (override && total === 1 && !override.includes(path.sep)) {
    if (/\.(png|jpg|jpeg|webp)$/i.test(override)) return override;
    return `${override}.${format}`;
  }
  const base = path.basename(inputPath, path.extname(inputPath));
  return `${base}-x${scale}-${modelId}.${format}`;
}

// 节流:同任务 ID 内,只在 percent delta >= 1 或距上次 emit >= 100ms 时推。
// renderer 端每帧只重渲一次足够;ONNX 一图百块 tile 全推会把 React 卡死。
const lastEmitByTask = new Map<string, { percent: number; ts: number }>();

function sendProgress(sender: WebContents, p: UpscaleProgressPayload): void {
  if (sender.isDestroyed()) return;
  const prev = lastEmitByTask.get(p.taskId);
  const now = Date.now();
  // 始终放过 "完成"(100) 与 "起点"(0)
  if (prev && p.percent < 100 && p.percent > 0) {
    if (now - prev.ts < 100 && Math.abs(p.percent - prev.percent) < 1) return;
  }
  lastEmitByTask.set(p.taskId, { percent: p.percent, ts: now });
  sender.send('upscale:progress', p);
}

function sendDone(sender: WebContents, p: UpscaleDonePayload): void {
  lastEmitByTask.delete(p.taskId);
  if (sender.isDestroyed()) return;
  sender.send('upscale:done', p);
  // 任务完成 → 安排 ORT session 释放(被新任务取消)
  scheduleAutoRelease();
}

// 模型存在性 + 大小检查
export function probeOnnxModels(): Array<{
  id: string;
  fileName: string;
  installed: boolean;
  expectedBytes: number;
  actualBytes: number;
  absPath: string;
}> {
  const dir = onnxModelsDir();
  return ONNX_MODELS.map((m) => {
    const abs = path.join(dir, m.fileName);
    let installed = false;
    let actual = 0;
    try {
      if (existsSync(abs)) {
        installed = true;
        actual = statSync(abs).size;
      }
    } catch {
      /* */
    }
    return {
      id: m.id,
      fileName: m.fileName,
      installed,
      expectedBytes: m.expectedBytes,
      actualBytes: actual,
      absPath: abs
    };
  });
}
