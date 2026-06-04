/**
 * HYPIR Portable IPC（已迁移到通用 AI 平台底座）。
 *
 * 历史:本文件以前直接调 hypirPortable.ts 的 spawn/HTTP；
 * 现在所有 lifecycle / 探测 / HTTP 都走 SidecarManager，HYPIR 自己只剩:
 *   - 提交任务的请求体构造（HYPIR-specific 参数 → snake_case body）
 *   - error_code → AppErrorCode 映射
 *   - 后台 polling + 推送 hypir:progress
 *
 * 外部 IPC 通道名保持不变，前端 (HypirPanel.tsx) 完全不用动:
 *   api:hypir:check, api:hypir:probe, api:hypir:set-portable-path, api:hypir:bootstrap,
 *   api:hypir:start-server, api:hypir:stop-server, api:hypir:server-status,
 *   api:hypir:submit-task, api:hypir:task-status, api:hypir:cancel-task,
 *   api:hypir:unload-model
 */
import { register, ok, err } from './helpers';
import { makeError } from '@shared/error';
import {
  getSidecarManager,
  bootstrapPortable,
  setPortableRoot,
  isPortableRootConfigured,
  type TaskStatusRaw
} from '../services/ai-platform';
import { HYPIR_FEATURE_ID, buildHypirSubmitBody, mapHypirErrorCode } from '../services/ai-features';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { checkHypirDependencies } from '../services/hypirCheck';
import { HypirSetPortablePathSchema, HypirSubmitTaskSchema, HypirTaskIdSchema } from './schemas';
import { z } from 'zod';
import { logger } from '../services/logger';

const HypirCheckInputSchema = z
  .object({
    pythonPath: z.string().optional(),
    hypirWeightsPath: z.string().optional(),
    sd21Path: z.string().optional()
  })
  .optional();

export function registerHypirHandlers(): void {
  // [兼容] 旧的本地依赖检查 —— UI 在没装 portable 时降级用
  register('api:hypir:check', HypirCheckInputSchema, async (input) => {
    const r = await checkHypirDependencies(input ?? {});
    return ok(r);
  });

  // 把新的通用 FeatureProbe 形态压回旧 HypirPortableProbe shape，前端 HypirPanel 不动
  register('api:hypir:probe', null, async () => {
    const p = await getSidecarManager().probe(HYPIR_FEATURE_ID);
    const root = p.portablePath;
    const hypirSrc = path.join(root, 'app', 'HYPIR');
    const testBat = path.join(root, 'test_env.bat');
    const installBat = path.join(root, 'install_or_repair.bat');
    const sd2 = p.models['sd2-base'];
    const wts = p.models['hypir-weights'];
    return ok({
      configured: isPortableRootConfigured(),
      portablePath: root,
      exists: p.portableExists,
      python: { exists: p.pythonExists, path: p.pythonPath },
      hypirSource: { exists: existsSync(hypirSrc), path: hypirSrc },
      hypirWeights: {
        exists: wts?.exists ?? false,
        path: wts?.path ?? '',
        sizeBytes: wts?.sizeBytes ?? 0
      },
      sd21Base: { exists: sd2?.exists ?? false, path: sd2?.path ?? '' },
      bats: {
        startExists: p.startBatExists,
        stopExists: p.stopBatExists,
        testExists: existsSync(testBat),
        installExists: existsSync(installBat)
      },
      configPort: p.port,
      serverScaffoldExists: p.serverScaffoldExists,
      scaffoldSource: p.scaffoldSource
    });
  });

  register('api:hypir:set-portable-path', HypirSetPortablePathSchema, async (input) => {
    setPortableRoot(input.path);
    return ok(true as const);
  });

  register('api:hypir:bootstrap', null, async () => {
    try {
      const r = await bootstrapPortable();
      return ok(r);
    } catch (e) {
      return err(
        makeError('FILE_PERMISSION', `脚手架展开失败：${(e as Error).message}`, {
          severity: 'modal',
          hint: '检查便携包目录是否可写'
        })
      );
    }
  });

  register('api:hypir:start-server', null, async () => {
    try {
      const r = await getSidecarManager().start(HYPIR_FEATURE_ID);
      return ok(r);
    } catch (e) {
      return err(
        makeError('CONFIG_INVALID', `启动服务失败：${(e as Error).message}`, {
          severity: 'modal',
          hint: '查看 HYPIR_Portable/logs/hypir.log；或先跑 test_env.bat 检查环境'
        })
      );
    }
  });

  register('api:hypir:stop-server', null, async () => {
    try {
      const r = await getSidecarManager().stop(HYPIR_FEATURE_ID);
      return ok(r);
    } catch (e) {
      return err(makeError('UNKNOWN', `停止服务失败：${(e as Error).message}`, { severity: 'toast' }));
    }
  });

  register('api:hypir:server-status', null, async () => {
    const r = await getSidecarManager().getServerStatus(HYPIR_FEATURE_ID);
    return ok(r);
  });

  register('api:hypir:submit-task', HypirSubmitTaskSchema, async (input, event) => {
    try {
      const body = buildHypirSubmitBody({
        inputPath: input.inputPath,
        outputPath: input.outputPath,
        scale: input.scale ?? 4,
        prompt: input.prompt,
        negativePrompt: input.negativePrompt,
        seed: input.seed,
        tileSize: input.tileSize,
        device: input.device,
        intensity: input.intensity,
        highlightProtection: input.highlightProtection,
        disablePostsharpen: input.disablePostsharpen,
        restorationDepth: input.restorationDepth
      });
      const submitted = await getSidecarManager().submitTask<{
        success: boolean;
        task_id: string;
        status: string;
      }>(HYPIR_FEATURE_ID, body);
      void pollTask(submitted.task_id, event.sender).catch((e) =>
        logger.error('hypir.pollTask threw', e)
      );
      return ok({ taskId: submitted.task_id, status: submitted.status });
    } catch (e) {
      return err(
        makeError('API_FAILED', `提交任务失败：${(e as Error).message}`, {
          severity: 'toast',
          hint: '确认 HYPIR 服务已启动'
        })
      );
    }
  });

  register('api:hypir:task-status', HypirTaskIdSchema, async (input) => {
    try {
      const t = await getSidecarManager().getTaskStatus(HYPIR_FEATURE_ID, input.taskId);
      return ok(t);
    } catch (e) {
      return err(
        makeError('VALIDATION_FAILED', `查询任务失败：${(e as Error).message}`, { severity: 'toast' })
      );
    }
  });

  register('api:hypir:cancel-task', HypirTaskIdSchema, async (input) => {
    try {
      await getSidecarManager().cancelTask(HYPIR_FEATURE_ID, input.taskId);
      return ok(true as const);
    } catch (e) {
      return err(makeError('UNKNOWN', `取消任务失败：${(e as Error).message}`, { severity: 'toast' }));
    }
  });

  register('api:hypir:unload-model', null, async () => {
    try {
      const r = await getSidecarManager().unloadModel<{
        success: boolean;
        unloaded: boolean;
        model_loaded: boolean;
        vram_used_mb: number | null;
      }>(HYPIR_FEATURE_ID);
      return ok({
        unloaded: !!r.unloaded,
        modelLoaded: !!r.model_loaded,
        vramUsedMb: r.vram_used_mb ?? null
      });
    } catch (e) {
      return err(
        makeError('UNKNOWN', `卸载模型失败：${(e as Error).message}`, {
          severity: 'toast',
          hint: '确认 HYPIR 服务正在运行'
        })
      );
    }
  });
}

const POLL_INTERVAL_MS = 700;
/** 轮询硬超时：HYPIR 若卡在 pending 永不收尾，30 分钟后停止跟踪，避免无限空转。 */
const POLL_MAX_MS = 30 * 60 * 1000;

/**
 * 后台 polling：每 700ms 拉一次任务状态，推 'hypir:progress'。
 * - sender.send 全部走 safeSend：销毁/竞态时静默跳过，不抛出未处理异常。
 * - 30 分钟硬超时兜底，防服务卡 pending 时 while 永久空转。
 */
async function pollTask(taskId: string, sender: Electron.WebContents): Promise<void> {
  const startedAt = Date.now();
  const safeSend = (payload: Record<string, unknown>): void => {
    if (sender.isDestroyed()) return;
    try {
      sender.send('hypir:progress', payload);
    } catch {
      /* sender 已销毁或竞态，忽略 */
    }
  };
  while (true) {
    if (sender.isDestroyed()) return;
    if (Date.now() - startedAt > POLL_MAX_MS) {
      safeSend({
        taskId,
        percent: 0,
        message: `轮询超时（>${Math.round(POLL_MAX_MS / 60000)} 分钟），已停止跟踪`,
        status: 'failed',
        errorCode: 'API_FAILED',
        errorMessageZh: 'HYPIR 任务长时间未返回完成状态',
        errorHint: '查看 HYPIR_Portable/logs/hypir.log'
      });
      return;
    }
    let t: TaskStatusRaw;
    try {
      t = await getSidecarManager().getTaskStatus(HYPIR_FEATURE_ID, taskId);
    } catch (e) {
      safeSend({
        taskId,
        percent: 0,
        message: `轮询失败：${(e as Error).message}`,
        status: 'failed',
        errorCode: 'API_FAILED',
        errorMessageZh: '与 HYPIR 服务的连接中断',
        errorHint: '查看 HYPIR_Portable/logs/hypir.log'
      });
      return;
    }
    safeSend({
      taskId: t.task_id,
      percent: t.progress,
      message: t.message,
      status: t.status,
      outputPath: t.output_path,
      errorCode: t.error_code ? mapHypirErrorCode(t.error_code) : null,
      rawErrorCode: t.error_code,
      errorMessageZh: t.error_message_zh,
      errorHint: t.error_hint,
      durationSeconds:
        t.duration_seconds ??
        (t.result_info && typeof t.result_info.duration_seconds === 'number'
          ? t.result_info.duration_seconds
          : null),
      resultInfo: t.result_info ?? null
    });
    if (t.status === 'done' || t.status === 'failed' || t.status === 'cancelled') return;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}
