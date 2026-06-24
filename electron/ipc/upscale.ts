/**
 * 放大引擎 IPC：Real-ESRGAN 保真放大模式(2026-05-28 重构)。
 *
 * 两条后端通路:
 *   - ncnn-vulkan(.bin + .param) → 走外部二进制,GPU(Vulkan 跨厂商)
 *   - ONNX(.onnx)               → 走主进程内 onnxruntime-node,GPU(DirectML/CoreML/CUDA)
 *
 * 通道布局:
 *   通用:
 *     api:upscale:status            → ncnn 引擎装没装、平台、ncnn 模型清单
 *     api:upscale:install-engine    → 装 ncnn-vulkan 二进制
 *     api:upscale:install-engine-from-zip  → 本地 zip 装
 *     api:upscale:remove-engine
 *     api:upscale:install-model     → 单装某 ncnn .bin/.param
 *     api:upscale:remove-model      → 删某 ncnn 模型
 *     api:upscale:import-local-model-files  → 用户导入 .bin/.param
 *     api:upscale:run-single / run-batch  → 按 input.backend 分流(ncnn/onnx)
 *     api:upscale:cancel
 *
 *   ONNX:
 *     api:upscale:onnx-list          → 内置 + 用户导入 .onnx 清单(installed 状态)
 *     api:upscale:onnx-download      → 下载内置某 .onnx(HF mirror 优先 + HF 原站备援)
 *     api:upscale:onnx-remove        → 删某 .onnx
 *     api:upscale:onnx-import-files  → 用户导入本地 .onnx
 *
 * 推送通道:
 *   upscale:progress         → 推理进度
 *   upscale:done             → 任务完成
 *   upscale:install-progress → ncnn 引擎 / ncnn 模型下载进度
 *   upscale:onnx-download-progress → onnx 模型下载进度
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { app, BrowserWindow } from 'electron';
import { z } from 'zod';
import { register, ok, err } from './helpers';
import {
  UpscaleEngineInstallSchema,
  UpscaleEngineInstallFromZipSchema,
  UpscaleImportLocalModelFilesSchema,
  UpscaleModelInstallSchema,
  UpscaleRunSingleSchema,
  UpscaleRunBatchSchema,
  UpscaleCancelSchema,
  UpscaleRemoveModelSchema
} from './schemas';
import {
  getEngineStatus,
  installEngine,
  installEngineFromLocalZip,
  importLocalModelFiles,
  removeEngine,
  installModel,
  removeModel,
  type DownloadProgressEvent
} from '../services/realesrganEngine';
import {
  runSingle,
  runBatch,
  cancelTask,
  type UpscaleParams
} from '../services/realesrganRunner';
import {
  runOnnxSingle,
  runOnnxBatch,
  cancelOnnxTask,
  probeOnnxModels,
  onnxModelsDir,
  releaseOnnxSession,
  prewarmOnnxSession,
  type OnnxUpscaleParams
} from '../services/realesrganOnnxRunner';
import { ONNX_MODELS, findOnnxSpec } from '../services/realesrganOnnxModels';
import { downloadFromAny } from '../services/netDownloader';
import { getDb } from '../services/db';
import { insertProducedMedia } from '../services/producedMedia';
import { makeError } from '@shared/error';

function getToolsRoot(): string {
  const tools = getDb()
    .prepare(`SELECT value FROM settings WHERE key='tools_storage_path'`)
    .get() as { value: string } | undefined;
  if (tools?.value && tools.value.trim()) return tools.value;
  const img = getDb()
    .prepare(`SELECT value FROM settings WHERE key='image_storage_path'`)
    .get() as { value: string } | undefined;
  if (img?.value) return img.value;
  return path.join(app.getPath('userData'), 'images');
}

function defaultUpscaleOutDir(): string {
  return path.join(getToolsRoot(), 'upscale');
}

export function registerUpscaleHandlers(): void {
  register('api:upscale:status', null, async () => {
    const s = await getEngineStatus();
    return ok(s);
  });

  register('api:upscale:install-engine', UpscaleEngineInstallSchema, async (input, event) => {
    const sender = event.sender;
    try {
      const onProgress = (e: DownloadProgressEvent): void => {
        if (sender.isDestroyed()) return;
        sender.send('upscale:install-progress', e);
      };
      const r = await installEngine(input.source ?? 'auto', onProgress);
      return ok(r);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return err(
        makeError('NETWORK_OFFLINE', `引擎安装失败：${msg}`, {
          severity: 'modal',
          hint: '可在「下载来源」切换镜像后重试；或手动从 GitHub Release 下载 zip 解压到引擎目录'
        })
      );
    }
  });

  register('api:upscale:remove-engine', null, async () => {
    try {
      await removeEngine();
      return ok(true as const);
    } catch (e) {
      return err(
        makeError('FILE_PERMISSION', `删除失败：${(e as Error).message}`, { severity: 'toast' })
      );
    }
  });

  register(
    'api:upscale:install-engine-from-zip',
    UpscaleEngineInstallFromZipSchema,
    async (input) => {
      try {
        const r = await installEngineFromLocalZip(input.zipPath);
        return ok(r);
      } catch (e) {
        return err(
          makeError('FILE_PERMISSION', `本地安装失败：${(e as Error).message}`, {
            severity: 'modal'
          })
        );
      }
    }
  );

  register('api:upscale:install-model', UpscaleModelInstallSchema, async (input, event) => {
    const sender = event.sender;
    try {
      const onProgress = (e: DownloadProgressEvent): void => {
        if (sender.isDestroyed()) return;
        sender.send('upscale:install-progress', e);
      };
      const r = await installModel(input.modelName, input.source ?? 'auto', onProgress);
      return ok(r);
    } catch (e) {
      return err(
        makeError('NETWORK_OFFLINE', `模型下载失败：${(e as Error).message}`, {
          severity: 'toast',
          hint: '可切换下载源后重试'
        })
      );
    }
  });

  register('api:upscale:remove-model', UpscaleRemoveModelSchema, async (input) => {
    try {
      await removeModel(input.modelName);
      return ok(true as const);
    } catch (e) {
      return err(
        makeError('FILE_PERMISSION', `删除失败：${(e as Error).message}`, { severity: 'toast' })
      );
    }
  });

  register(
    'api:upscale:import-local-model-files',
    UpscaleImportLocalModelFilesSchema,
    async (input) => {
      try {
        const r = await importLocalModelFiles(input.filePaths);
        return ok(r);
      } catch (e) {
        return err(
          makeError('FILE_PERMISSION', `导入失败：${(e as Error).message}`, {
            severity: 'toast'
          })
        );
      }
    }
  );

  register('api:upscale:run-single', UpscaleRunSingleSchema, async (input, event) => {
    const outDir = input.outputDir ?? defaultUpscaleOutDir();
    const backend = input.backend ?? 'ncnn';

    let handle;
    if (backend === 'onnx') {
      const onnxParams: OnnxUpscaleParams = {
        modelId: input.modelName,
        scale: input.scale,
        format: input.format,
        tile: input.tile ?? 0,
        keepAlpha: input.keepAlpha ?? true
      };
      handle = runOnnxSingle(
        {
          inputDataUri: input.inputDataUri,
          inputPath: input.inputPath,
          outputDir: outDir,
          outputFileName: input.outputFileName,
          params: onnxParams
        },
        event.sender
      );
    } else {
      const params: UpscaleParams = {
        modelName: input.modelName,
        scale: input.scale,
        format: input.format,
        tile: input.tile ?? 0,
        gpuId: input.gpuId ?? 'auto',
        tta: input.tta ?? false
      };
      handle = runSingle(
        {
          inputDataUri: input.inputDataUri,
          inputPath: input.inputPath,
          outputDir: outDir,
          outputFileName: input.outputFileName,
          params
        },
        event.sender,
        outDir
      );
    }

    const done = await handle.done;
    if (!done.ok) {
      return err(
        makeError(done.cancelled ? 'CANCELLED' : 'UNKNOWN', done.error ?? '放大失败', {
          severity: done.cancelled ? 'silent' : 'toast'
        })
      );
    }
    const item = done.results[0];
    if (!item) {
      return err(makeError('UNKNOWN', '引擎未返回结果', { severity: 'toast' }));
    }
    // 软件产物一律入库（引用原位路径，含缩略图；失败只记日志不挡主流程）
    await insertProducedMedia({
      filePath: item.outputPath,
      kind: 'image',
      notes: `[upscale] ${input.modelName} x${input.scale}`,
      model: input.modelName,
      params: { scale: input.scale, backend, output_w: item.outputW, output_h: item.outputH }
    });
    // 2026-05-28: 不再 eager 编码 dataUri(整张大图 base64 走 IPC 会卡 UI 1-3s)。
    // 渲染进程通过 outputPath 自己用 mengbi-image:// 协议加载;
    // 复制 / 另存为等操作在用户触发时才 lazy fetch → blob,主进程不阻塞。
    return ok({
      taskId: handle.taskId,
      outputPath: item.outputPath,
      outputDataUri: null,
      inputW: item.inputW,
      inputH: item.inputH,
      outputW: item.outputW,
      outputH: item.outputH,
      elapsedMs: item.elapsedMs
    });
  });

  register('api:upscale:run-batch', UpscaleRunBatchSchema, async (input, event) => {
    const outDir = input.outputDir ?? defaultUpscaleOutDir();
    const backend = input.backend ?? 'ncnn';

    let handle;
    if (backend === 'onnx') {
      const onnxParams: OnnxUpscaleParams = {
        modelId: input.modelName,
        scale: input.scale,
        format: input.format,
        tile: input.tile ?? 0,
        keepAlpha: input.keepAlpha ?? true
      };
      handle = runOnnxBatch(
        { inputPaths: input.inputPaths, outputDir: outDir, params: onnxParams },
        event.sender
      );
    } else {
      const params: UpscaleParams = {
        modelName: input.modelName,
        scale: input.scale,
        format: input.format,
        tile: input.tile ?? 0,
        gpuId: input.gpuId ?? 'auto',
        tta: input.tta ?? false
      };
      handle = runBatch(
        { inputPaths: input.inputPaths, outputDir: outDir, params },
        event.sender
      );
    }
    const done = await handle.done;
    if (!done.ok) {
      return err(
        makeError(done.cancelled ? 'CANCELLED' : 'UNKNOWN', done.error ?? '批量放大失败', {
          severity: done.cancelled ? 'silent' : 'toast'
        })
      );
    }
    // 批量产物逐张入库（每张失败独立容错）
    for (const it of done.results) {
      if (!it?.outputPath) continue;
      await insertProducedMedia({
        filePath: it.outputPath,
        kind: 'image',
        notes: `[upscale] ${input.modelName} x${input.scale}（批量）`,
        model: input.modelName,
        params: { scale: input.scale, backend, output_w: it.outputW, output_h: it.outputH }
      });
    }
    return ok({
      taskId: handle.taskId,
      results: done.results,
      cancelled: done.cancelled === true
    });
  });

  register('api:upscale:cancel', UpscaleCancelSchema, async (input) => {
    // ncnn 和 onnx 两个 runner 同时尝试取消,每个 runner 按 taskId 查找,不匹配的会 noop。
    const a = cancelTask(input.taskId);
    const b = cancelOnnxTask(input.taskId);
    return ok({ cancelledTaskIds: [...a.cancelledTaskIds, ...b.cancelledTaskIds] });
  });

  // ── ONNX 模型管理 ──────────────────────────────────────

  register('api:upscale:onnx-list', null, async () => {
    const probed = probeOnnxModels();
    const dir = onnxModelsDir();
    // 读 custom_meta.json 拿 modeHint
    let meta: Record<string, string> = {};
    try {
      const metaPath = path.join(dir, 'custom_meta.json');
      if (existsSync(metaPath)) {
        meta = JSON.parse(await fs.readFile(metaPath, 'utf-8')) as Record<string, string>;
      }
    } catch {
      /* */
    }
    // 同时枚举用户导入的非内置 .onnx
    let custom: Array<{
      fileName: string;
      absPath: string;
      sizeBytes: number;
      modeHint: string;
    }> = [];
    try {
      if (existsSync(dir)) {
        const knownFiles = new Set(ONNX_MODELS.map((m) => m.fileName.toLowerCase()));
        const entries = await fs.readdir(dir);
        for (const e of entries) {
          if (!e.toLowerCase().endsWith('.onnx')) continue;
          if (knownFiles.has(e.toLowerCase())) continue;
          const abs = path.join(dir, e);
          custom.push({
            fileName: e,
            absPath: abs,
            sizeBytes: statSync(abs).size,
            modeHint: meta[e] ?? 'custom'
          });
        }
      }
    } catch {
      /* */
    }
    return ok({
      modelsDir: dir,
      builtins: probed.map((p) => {
        const spec = findOnnxSpec(p.id)!;
        return {
          id: p.id,
          displayName: spec.displayName,
          description: spec.description,
          licenseNote: spec.licenseNote,
          categoryHint: spec.categoryHint,
          fileName: p.fileName,
          absPath: p.absPath,
          expectedBytes: p.expectedBytes,
          actualBytes: p.actualBytes,
          installed: p.installed,
          nativeScale: spec.nativeScale,
          /** sources 为空 = 无公开 .onnx,UI 应显示「上传到此槽位」 */
          sources: spec.sources.map((s) => ({ name: s.name, url: s.url }))
        };
      }),
      custom
    });
  });

  register(
    'api:upscale:onnx-download',
    z.object({ modelId: z.string().min(1) }),
    async (input) => {
      const spec = findOnnxSpec(input.modelId);
      if (!spec) {
        return err(
          makeError('VALIDATION_FAILED', `未知 ONNX 模型: ${input.modelId}`, { severity: 'toast' })
        );
      }
      const dir = onnxModelsDir();
      await fs.mkdir(dir, { recursive: true });
      const dest = path.join(dir, spec.fileName);
      const urls = spec.sources.map((s) => s.url);
      try {
        const onProg = (e: { component: string; received: number; total: number }): void => {
          for (const w of BrowserWindow.getAllWindows()) {
            if (w.isDestroyed()) continue;
            try {
              w.webContents.send('upscale:onnx-download-progress', {
                modelId: input.modelId,
                component: e.component,
                received: e.received,
                total: e.total
              });
            } catch {
              /* */
            }
          }
        };
        const r = await downloadFromAny(urls, dest, {
          component: spec.displayName,
          onProgress: onProg
        });
        return ok({ modelId: input.modelId, usedUrl: r.usedUrl, destPath: dest });
      } catch (e) {
        const msg = (e as Error).message;
        return err(
          makeError('NETWORK_OFFLINE', `下载失败: ${msg}`, {
            severity: 'toast',
            hint: '可换网/挂代理后重试,或手动从 HF / 镜像下载放到目录里'
          })
        );
      }
    }
  );

  register(
    'api:upscale:onnx-remove',
    z.object({ fileName: z.string().min(1) }),
    async (input) => {
      const dir = onnxModelsDir();
      const fp = path.join(dir, input.fileName);
      if (!existsSync(fp)) {
        return err(makeError('FILE_NOT_FOUND', '文件不存在', { severity: 'toast' }));
      }
      try {
        await fs.unlink(fp);
        // 顺便清掉 custom_meta.json 里的记录
        const metaPath = path.join(dir, 'custom_meta.json');
        if (existsSync(metaPath)) {
          try {
            const meta = JSON.parse(await fs.readFile(metaPath, 'utf-8')) as Record<string, string>;
            if (meta[input.fileName]) {
              delete meta[input.fileName];
              await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
            }
          } catch {
            /* */
          }
        }
        return ok(true as const);
      } catch (e) {
        return err(
          makeError('FILE_PERMISSION', `删除失败: ${(e as Error).message}`, { severity: 'toast' })
        );
      }
    }
  );

  // 自定义 .onnx 元信息(分类标签)— 落盘到 onnxModelsDir()/custom_meta.json
  //   { "<fileName>": "<modeHint>" }
  // 上传时记录,onnxList 读取,resolveModelForMode 按 modeHint 把 custom .onnx 排到对应模式备选末尾。
  register(
    'api:upscale:onnx-import-files',
    z.object({
      filePaths: z.array(z.string().min(1)).min(1).max(50),
      /** 用户为这批文件指定的分类(同时挂到该模式备选末尾) */
      modeHint: z
        .enum(['general-hd', 'general-fast', 'anime-illust', 'anime-video', 'sharpen', 'custom'])
        .default('custom')
    }),
    async (input) => {
      const dir = onnxModelsDir();
      await fs.mkdir(dir, { recursive: true });
      const imported: string[] = [];
      const skipped: Array<{ src: string; reason: string }> = [];
      // 读取已有 meta(若有)
      const metaPath = path.join(dir, 'custom_meta.json');
      let meta: Record<string, string> = {};
      try {
        if (existsSync(metaPath)) {
          meta = JSON.parse(await fs.readFile(metaPath, 'utf-8')) as Record<string, string>;
        }
      } catch {
        /* 损坏就重置 */
      }
      for (const src of input.filePaths) {
        if (!src.toLowerCase().endsWith('.onnx')) {
          skipped.push({ src, reason: '不是 .onnx 文件' });
          continue;
        }
        const baseName = path.basename(src);
        const dst = path.join(dir, baseName);
        try {
          await fs.copyFile(src, dst);
          imported.push(baseName);
          meta[baseName] = input.modeHint ?? 'custom';
        } catch (e) {
          skipped.push({ src, reason: (e as Error).message });
        }
      }
      // 回写 meta
      try {
        await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
      } catch {
        /* 写不进就算了,下次重读 */
      }
      return ok({ imported, skipped });
    }
  );

  register('api:upscale:onnx-unload', null, async () => {
    await releaseOnnxSession();
    return ok(true as const);
  });

  /**
   * 预热某个 ONNX 模型(后台 ensureSession)。
   * 用户在面板选模型 / 拖入文件后 debounce 调一次,首次推理就不用付冷加载代价。
   */
  // 同一模型的并发预热去重：快速切模型 / 多面板时，避免同一模型被重复加载进显存
  const prewarmInFlight = new Map<string, Promise<boolean>>();
  register(
    'api:upscale:onnx-prewarm',
    z.object({ modelId: z.string().min(1) }),
    async (input) => {
      let p = prewarmInFlight.get(input.modelId);
      if (!p) {
        p = prewarmOnnxSession(input.modelId).finally(() => prewarmInFlight.delete(input.modelId));
        prewarmInFlight.set(input.modelId, p);
      }
      return ok({ warmed: await p });
    }
  );
}

// 让 helpers WRITE_CHANNELS 白名单识别哪些通道是写操作（用于通知中心）
export const UPSCALE_WRITE_CHANNELS = [
  'api:upscale:install-engine',
  'api:upscale:install-engine-from-zip',
  'api:upscale:remove-engine',
  'api:upscale:install-model',
  'api:upscale:import-local-model-files',
  'api:upscale:remove-model',
  'api:upscale:run-single',
  'api:upscale:run-batch',
  'api:upscale:cancel',
  'api:upscale:onnx-download',
  'api:upscale:onnx-remove',
  'api:upscale:onnx-import-files',
  'api:upscale:onnx-unload'
] as const;

// 让 schema 入参的字段在不同导出场景下都能被 TS 推到（避免树震到丢字段）
export type _UpscaleSchemas = z.ZodSchema;
