/**
 * 放大引擎 IPC：Real-ESRGAN ncnn Vulkan（保真放大模式）。
 *
 * 通道布局：
 *   api:upscale:status          → 引擎是否已装、模型列表、平台支持
 *   api:upscale:install-engine  → 下载 zip 解压（github / mirror / auto 三源）
 *   api:upscale:remove-engine   → 删整个引擎目录
 *   api:upscale:install-model   → 单独下载某模型 .bin/.param
 *   api:upscale:remove-model    → 删某模型
 *   api:upscale:run-single      → 单图放大（dataUri 或 path），同步返回 taskId+done
 *   api:upscale:run-batch       → 批量放大（path 数组）
 *   api:upscale:cancel          → 按 taskId 取消，省略 taskId 取消所有
 *
 * 推送通道：
 *   upscale:progress
 *   upscale:done
 *   upscale:install-progress
 */

import path from 'node:path';
import { app } from 'electron';
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
import { getDb } from '../services/db';
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
    const params: UpscaleParams = {
      modelName: input.modelName,
      scale: input.scale,
      format: input.format,
      tile: input.tile ?? 0,
      gpuId: input.gpuId ?? 'auto',
      tta: input.tta ?? false
    };
    const outDir = input.outputDir ?? defaultUpscaleOutDir();
    const handle = runSingle(
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
    const params: UpscaleParams = {
      modelName: input.modelName,
      scale: input.scale,
      format: input.format,
      tile: input.tile ?? 0,
      gpuId: input.gpuId ?? 'auto',
      tta: input.tta ?? false
    };
    const handle = runBatch(
      {
        inputPaths: input.inputPaths,
        outputDir: input.outputDir ?? defaultUpscaleOutDir(),
        params
      },
      event.sender
    );
    const done = await handle.done;
    if (!done.ok) {
      return err(
        makeError(done.cancelled ? 'CANCELLED' : 'UNKNOWN', done.error ?? '批量放大失败', {
          severity: done.cancelled ? 'silent' : 'toast'
        })
      );
    }
    return ok({
      taskId: handle.taskId,
      results: done.results,
      cancelled: done.cancelled === true
    });
  });

  register('api:upscale:cancel', UpscaleCancelSchema, async (input) => {
    const r = cancelTask(input.taskId);
    return ok(r);
  });
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
  'api:upscale:cancel'
] as const;

// 让 schema 入参的字段在不同导出场景下都能被 TS 推到（避免树震到丢字段）
export type _UpscaleSchemas = z.ZodSchema;
