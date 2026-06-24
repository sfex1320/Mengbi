/**
 * 视频插帧 IPC（本地 RIFE ncnn Vulkan，仿 upscale.ts 模式）。
 *
 * 通道布局：
 *   api:interp:status          → 引擎装没装、模型清单、默认模型、平台
 *   api:interp:install-engine  → 下载 zip 解压到 userData/engines/rife/（进度推 interp:install-progress）
 *   api:interp:remove-engine   → 删整个引擎目录
 *   api:interp:run             → 同步等完成（ffmpeg 拆帧 → RIFE 插帧 → ffmpeg 合帧），进度推 interp:progress
 *   api:interp:cancel          → 按 taskId 取消（空 = 取消所有）
 *
 * 推送通道：
 *   interp:progress         → {taskId, clientTag?, stage, percent, framesDone, framesTotal, srcFps?, phase}
 *   interp:install-progress → {component, received, total}
 */
import path from 'node:path';
import { register, ok, err } from './helpers';
import { makeError } from '@shared/error';
import { InterpEngineInstallSchema, InterpRunSchema, InterpCancelSchema } from './schemas';
import { getEngineStatus, installEngine, removeEngine, engineRoot } from '../services/rifeEngine';
import { runInterp, cancelTask } from '../services/rifeRunner';
import type { DownloadProgress } from '../services/netDownloader';
import { getVideoStorageRoot } from './video';
import { insertProducedMedia } from '../services/producedMedia';

export function registerInterpHandlers(): void {
  register('api:interp:status', null, async () => {
    const s = await getEngineStatus();
    return ok(s);
  });

  register('api:interp:install-engine', InterpEngineInstallSchema, async (input, event) => {
    const sender = event.sender;
    try {
      const onProgress = (e: DownloadProgress): void => {
        if (sender.isDestroyed()) return;
        sender.send('interp:install-progress', e);
      };
      const r = await installEngine(input?.source ?? 'auto', onProgress);
      return ok(r);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return err(
        makeError('NETWORK_OFFLINE', `插帧引擎安装失败：${msg}`, {
          severity: 'modal',
          hint: `可换个时间重试（镜像会自动轮换）；或手动从 GitHub（nihui/rife-ncnn-vulkan releases）下载 zip 解压到 ${engineRoot()}`
        })
      );
    }
  });

  register('api:interp:remove-engine', null, async () => {
    try {
      await removeEngine();
      return ok(true as const);
    } catch (e) {
      return err(
        makeError('FILE_PERMISSION', `删除失败：${(e as Error).message}`, { severity: 'toast' })
      );
    }
  });

  register('api:interp:run', InterpRunSchema, async (input, event) => {
    const outputDir =
      input.outputDir ?? path.join(getVideoStorageRoot(), new Date().toISOString().slice(0, 10));
    const handle = runInterp(
      {
        inputPath: input.inputPath,
        outputDir,
        targetFps: input.targetFps,
        model: input.model,
        clientTag: input.clientTag
      },
      event.sender
    );
    const done = await handle.done;
    if (!done.ok) {
      if (done.cancelled) {
        return err(makeError('CANCELLED', '插帧已取消', { severity: 'silent' }));
      }
      return err(
        makeError('UNKNOWN', done.error ?? '插帧失败', {
          severity: 'toast',
          hint: '确认显卡 Vulkan 驱动可用、磁盘剩余空间充足；过长视频请先截取片段'
        })
      );
    }
    // 软件产物一律入库（封面由渲染端抓帧后经 api:video:save-thumbnail 补）
    const imageId = await insertProducedMedia({
      filePath: done.outputPath!,
      kind: 'video',
      notes: `[interp] ${done.srcFps ? `${Math.round(done.srcFps)}→` : ''}${input.targetFps}fps 插帧`,
      model: input.model ?? 'rife-v4.6',
      params: { src_fps: done.srcFps, target_fps: input.targetFps, out_frames: done.outFrames }
    });
    return ok({
      taskId: done.taskId,
      outputPath: done.outputPath!,
      srcFps: done.srcFps,
      srcFrames: done.srcFrames,
      outFrames: done.outFrames,
      targetFps: input.targetFps,
      elapsedMs: done.elapsedMs,
      imageId: imageId ?? undefined
    });
  });

  register('api:interp:cancel', InterpCancelSchema, async (input) => {
    return ok(cancelTask(input.taskId));
  });
}
