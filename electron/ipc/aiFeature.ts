/**
 * 通用 AI Feature IPC —— `api:ai-feature:*`
 *
 * 替代旧的 per-feature 各自一套 probe / start / stop / install。
 * 现在所有 AI 功能共用一组 IPC，前端按 feature.id 选择对应功能。
 *
 * 通道：
 *   api:ai-feature:list              所有已注册功能 + 状态（installed / serverRunning / missing 列表）
 *   api:ai-feature:status            单个 feature 完整状态
 *   api:ai-feature:probe             单个 feature 完整体检（含模型 / Python / bat）
 *   api:ai-feature:start             启 sidecar
 *   api:ai-feature:stop              停 sidecar
 *   api:ai-feature:server-status     ping /api/status
 *   api:ai-feature:unload-model      释放显存（不停服）
 *   api:ai-feature:install           跑安装脚本链 + 进度推送 `ai-feature:install-progress`
 *   api:ai-feature:cancel-install
 *   api:ai-feature:bootstrap         展开内置脚手架到便携包根
 *   api:ai-feature:set-portable-path 改便携根路径
 *
 * 推送（renderer 通过 `on` 监听）:
 *   ai-feature:install-progress { featureId, stage, message, percent? }
 */
import { z } from 'zod';
import { register, ok, err } from './helpers';
import { makeError } from '@shared/error';
import {
  getSidecarManager,
  getFeatureRegistry,
  bootstrapPortable,
  setPortableRoot,
  installFeature,
  cancelInstall
} from '../services/ai-platform';

const FeatureIdSchema = z.object({ featureId: z.string().min(1) });
const SetPortablePathSchema = z.object({ path: z.string() });
const InstallSchema = z.object({
  featureId: z.string().min(1),
  jobId: z.string().min(1)
});

export function registerAiFeatureHandlers(): void {
  register('api:ai-feature:list', null, async () => {
    const r = await getFeatureRegistry().getAllStatus();
    return ok(r);
  });

  register('api:ai-feature:status', FeatureIdSchema, async (input) => {
    try {
      const r = await getFeatureRegistry().getStatus(input.featureId);
      return ok(r);
    } catch (e) {
      return err(makeError('VALIDATION_FAILED', (e as Error).message, { severity: 'toast' }));
    }
  });

  register('api:ai-feature:probe', FeatureIdSchema, async (input) => {
    try {
      const r = await getSidecarManager().probe(input.featureId);
      return ok(r);
    } catch (e) {
      return err(makeError('VALIDATION_FAILED', (e as Error).message, { severity: 'toast' }));
    }
  });

  register('api:ai-feature:start', FeatureIdSchema, async (input) => {
    try {
      const r = await getSidecarManager().start(input.featureId);
      return ok(r);
    } catch (e) {
      return err(
        makeError('CONFIG_INVALID', `启动 ${input.featureId} 服务失败：${(e as Error).message}`, {
          severity: 'modal',
          hint: '查看 HYPIR_Portable/logs/<feature>.log；或先跑安装脚本'
        })
      );
    }
  });

  register('api:ai-feature:stop', FeatureIdSchema, async (input) => {
    try {
      const r = await getSidecarManager().stop(input.featureId);
      return ok(r);
    } catch (e) {
      return err(makeError('UNKNOWN', `停止 ${input.featureId} 失败：${(e as Error).message}`, { severity: 'toast' }));
    }
  });

  register('api:ai-feature:server-status', FeatureIdSchema, async (input) => {
    try {
      const r = await getSidecarManager().getServerStatus(input.featureId);
      return ok(r);
    } catch (e) {
      return err(makeError('UNKNOWN', (e as Error).message, { severity: 'toast' }));
    }
  });

  register('api:ai-feature:unload-model', FeatureIdSchema, async (input) => {
    try {
      const r = await getSidecarManager().unloadModel(input.featureId);
      return ok(r);
    } catch (e) {
      return err(
        makeError('UNKNOWN', `卸载 ${input.featureId} 模型失败：${(e as Error).message}`, {
          severity: 'toast',
          hint: '确认服务正在运行'
        })
      );
    }
  });

  register('api:ai-feature:bootstrap', null, async () => {
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

  register('api:ai-feature:set-portable-path', SetPortablePathSchema, async (input) => {
    try {
      setPortableRoot(input.path);
      return ok({ saved: true });
    } catch (e) {
      return err(makeError('DB_ERROR', (e as Error).message, { severity: 'toast' }));
    }
  });

  // 长任务：跑安装脚本链；进度推 ai-feature:install-progress
  register('api:ai-feature:install', InstallSchema, async (input, event) => {
    const send = (stage: string, message: string, percent?: number): void => {
      try {
        event.sender.send('ai-feature:install-progress', {
          jobId: input.jobId,
          featureId: input.featureId,
          stage,
          message,
          percent
        });
      } catch { /* renderer 已销毁就静默 */ }
    };
    try {
      const r = await installFeature(input.featureId, (e) => send(e.stage, e.message, e.percent));
      if (!r.success) {
        const lastStep = r.steps[r.steps.length - 1];
        return err(
          makeError('API_FAILED', `安装失败（${lastStep?.bat ?? 'unknown'}，exit=${lastStep?.exitCode ?? -1}）`, {
            severity: 'modal',
            hint: '查看日志末尾几行；或手动跑该 bat 看完整输出',
            details: lastStep?.logTail
          })
        );
      }
      return ok({ featureId: input.featureId, steps: r.steps.length });
    } catch (e) {
      return err(makeError('API_FAILED', (e as Error).message, { severity: 'modal' }));
    }
  });

  register('api:ai-feature:cancel-install', FeatureIdSchema, async (input) => {
    const r = cancelInstall(input.featureId);
    return ok(r);
  });

  // 一键清理 —— 工具箱顶部"清理显存与缓存"按钮调这里。
  // 遍历所有已注册 feature,每个跑得起来的 sidecar 都做 cleanup;
  // unloadModels=true 时额外把模型从显存卸下(更彻底,下次推理要重新加载 30-60s)。
  register(
    'api:ai-feature:cleanup-all',
    z.object({ unloadModels: z.boolean().default(false) }),
    async (input) => {
      const mgr = getSidecarManager();
      const results: Array<{
        featureId: string;
        reachable: boolean;
        vramBeforeMb: number | null;
        vramAfterMb: number | null;
        vramFreedMb: number | null;
        modelLoaded: boolean;
        unloaded: boolean;
      }> = [];
      for (const spec of mgr.list()) {
        try {
          const r = await mgr.cleanupSidecar(spec.id, !!input.unloadModels);
          if (r === null) {
            results.push({
              featureId: spec.id,
              reachable: false,
              vramBeforeMb: null,
              vramAfterMb: null,
              vramFreedMb: null,
              modelLoaded: false,
              unloaded: false
            });
          } else {
            const freed =
              r.vram_used_mb_before !== null && r.vram_used_mb_after !== null
                ? r.vram_used_mb_before - r.vram_used_mb_after
                : null;
            results.push({
              featureId: spec.id,
              reachable: true,
              vramBeforeMb: r.vram_used_mb_before,
              vramAfterMb: r.vram_used_mb_after,
              vramFreedMb: freed,
              modelLoaded: r.model_loaded,
              unloaded: r.unloaded
            });
          }
        } catch (e) {
          results.push({
            featureId: spec.id,
            reachable: false,
            vramBeforeMb: null,
            vramAfterMb: null,
            vramFreedMb: null,
            modelLoaded: false,
            unloaded: false
          });
        }
      }
      const totalFreed = results.reduce((s, r) => s + (r.vramFreedMb ?? 0), 0);
      return ok({
        results,
        totalFreedMb: totalFreed,
        unloadedCount: results.filter((r) => r.unloaded).length,
        reachableCount: results.filter((r) => r.reachable).length
      });
    }
  );
}
