/**
 * 图像转矢量 IPC 通道 —— api:vec:* (v3 重构,2026-05-27)。
 *
 * 5 个模式: vtracer / potrace / autotrace / starvector / experimental
 *   - Phase 1 实装 vtracer / potrace
 *   - Phase 2 加 autotrace
 *   - Phase 3 加 starvector
 *   - Phase 4 加 experimental(默认隐藏)
 *
 * 设计要点(对应用户清单 §3 §10):
 *   - 所有引擎调用统一走 batchQueue,即使是单图也包成 1 张的 batch
 *     (这样后处理 / 回退 / debug 报告完全统一,UI 不分单/批)
 *   - run-vtracer / run-potrace 保留为单图便捷调用(返回 batchId + taskId)
 *   - 新增 detect-type / report-get / debug-open 通道
 *   - 进度通过 'vec:progress' / 'vec:batch-progress' broadcast
 */
import { z } from 'zod';
import { existsSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { shell, app } from 'electron';
import { register, ok, err } from './helpers';
import { makeError } from '@shared/error';
import { getBatchQueue } from '../services/vectorize/batchQueue';
import { listVecHistory, clearVecHistory } from '../services/vectorize/vecHistory';
import { detectImageType } from '../services/vectorize/preprocess/imageTypeDetect';
import { validateOutputDir } from '../services/vectorize/outputNaming';
import { resolveAutotracePath } from '../services/vectorize/engines/autotraceEngine';
import { getSidecarManager } from '../services/ai-platform/sidecarManager';
import { STARVECTOR_FEATURE_ID } from '../services/ai-features/starvector';
import { getDb } from '../services/db';
import type { VecMode, VecParams } from '../services/vectorize/types';

function readUserStarVectorPath(): string {
  try {
    const row = getDb()
      .prepare(`SELECT value FROM settings WHERE key = 'vec_starvector_path'`)
      .get() as { value: string } | undefined;
    return (row?.value ?? '').trim();
  } catch {
    return '';
  }
}

// ── schemas ─────────────────────────────────────────────────

const VecModeEnum = z.enum(['vtracer', 'potrace', 'autotrace', 'starvector', 'experimental']);

const VTracerParamsSchema = z
  .object({
    colorMode: z.enum(['color', 'binary']).optional(),
    hierarchical: z.enum(['stacked', 'cutout']).optional(),
    filterSpeckle: z.number().int().min(0).max(20).optional(),
    colorPrecision: z.number().int().min(1).max(10).optional(),
    layerDifference: z.number().int().min(0).max(128).optional(),
    cornerThreshold: z.number().int().min(0).max(180).optional(),
    lengthThreshold: z.number().min(0).max(50).optional(),
    maxIterations: z.number().int().min(1).max(50).optional(),
    spliceThreshold: z.number().int().min(0).max(180).optional(),
    pathPrecision: z.number().int().min(0).max(10).optional(),
    maxPaths: z.number().int().min(1).max(100000).optional(),
    colorMergeDelta: z.number().min(0).max(255).optional()
  })
  .strict();

const PotraceParamsSchema = z
  .object({
    threshold: z.number().int().min(0).max(255).optional(),
    blackOnWhite: z.boolean().optional(),
    turdSize: z.number().int().min(0).max(100).optional(),
    alphaMax: z.number().min(0).max(1.34).optional(),
    optCurve: z.boolean().optional(),
    optTolerance: z.number().min(0).max(2).optional()
  })
  .strict();

const AutotraceParamsSchema = z
  .object({
    colorCount: z.number().int().min(2).max(256).optional(),
    cornerThreshold: z.number().int().min(0).max(180).optional(),
    despeckleLevel: z.number().int().min(0).max(20).optional(),
    centerline: z.boolean().optional(),
    lineThreshold: z.number().min(0).max(5).optional()
  })
  .strict();

const StarVectorParamsSchema = z
  .object({
    maxNewTokens: z.number().int().min(64).max(16384).optional(),
    temperature: z.number().min(0).max(2).optional(),
    doSample: z.boolean().optional()
  })
  .strict();

const ExperimentalParamsSchema = z
  .object({
    numPaths: z.number().int().min(1).max(2048).optional(),
    iters: z.number().int().min(10).max(10000).optional(),
    timeoutSeconds: z.number().int().min(10).max(3600).optional(),
    initFrom: z.enum(['random', 'vtracer']).optional()
  })
  .strict();

const AnyParamsSchema = z.union([
  VTracerParamsSchema,
  PotraceParamsSchema,
  AutotraceParamsSchema,
  StarVectorParamsSchema,
  ExperimentalParamsSchema
]);

const VecBatchOptionsSchema = z.object({
  outputDir: z.string().min(1),
  naming: z.enum(['original', 'suffix']),
  onConflict: z.enum(['overwrite', 'skip', 'rename'])
});

const RunSingleSchemaBase = z.object({
  inputPath: z.string().min(1),
  outputDir: z.string().min(1),
  onConflict: z.enum(['overwrite', 'skip', 'rename']).default('rename'),
  naming: z.enum(['original', 'suffix']).default('original')
});

const RunSingleVTracerSchema = RunSingleSchemaBase.extend({
  params: VTracerParamsSchema.default({})
});
const RunSinglePotraceSchema = RunSingleSchemaBase.extend({
  params: PotraceParamsSchema.default({})
});

const RunBatchSchema = z.object({
  mode: VecModeEnum,
  inputs: z.array(z.string().min(1)).min(1).max(2000),
  options: VecBatchOptionsSchema,
  params: AnyParamsSchema.default({})
});

const BatchIdSchema = z.object({ batchId: z.string().min(1) });
const TaskIdSchema = z.object({ taskId: z.string().min(1) });

const HistoryListSchema = z.object({
  filter: z
    .object({
      batchId: z.string().optional(),
      mode: VecModeEnum.optional(),
      requestedMode: VecModeEnum.optional(),
      status: z.enum(['succeeded', 'failed', 'cancelled']).optional(),
      fellBackOnly: z.boolean().optional(),
      limit: z.number().int().min(1).max(5000).optional(),
      offset: z.number().int().min(0).optional()
    })
    .optional()
});

const HistoryClearSchema = z.object({
  olderThanDays: z.number().int().min(0).max(3650).optional()
});

const DetectTypeSchema = z.object({ inputPath: z.string().min(1) });
const ReportGetSchema = z.object({ reportDir: z.string().min(1) });
// reportDir 为空 = 打开 vec-debug 根目录;非空 = 打开指定子目录
const DebugOpenSchema = z.object({ reportDir: z.string().optional() });

// ── handlers ────────────────────────────────────────────────

interface SingleEnqueueInput {
  inputPath: string;
  outputDir: string;
  naming: 'original' | 'suffix';
  onConflict: 'overwrite' | 'skip' | 'rename';
  params: VecParams;
}

async function enqueueSingleTask(mode: VecMode, input: SingleEnqueueInput) {
  if (!existsSync(input.inputPath)) {
    return err(
      makeError('FILE_NOT_FOUND', `输入文件不存在: ${input.inputPath}`, {
        severity: 'toast'
      })
    );
  }
  const v = validateOutputDir(input.outputDir);
  if (!v.ok) {
    return err(
      makeError('FILE_PERMISSION', v.reason, {
        severity: 'toast',
        hint: '改用其他可写目录,或检查权限。'
      })
    );
  }
  const r = getBatchQueue().enqueueBatch({
    mode,
    inputs: [input.inputPath],
    options: {
      outputDir: input.outputDir,
      naming: input.naming,
      onConflict: input.onConflict
    },
    params: input.params
  });
  if (r.taskIds.length === 0) {
    return err(
      makeError('VALIDATION_FAILED', '该文件已存在(冲突策略=skip),已跳过', {
        severity: 'inline'
      })
    );
  }
  return ok({ batchId: r.batchId, taskId: r.taskIds[0] });
}

export function registerVecHandlers(): void {
  register('api:vec:run-vtracer', RunSingleVTracerSchema, async (input) =>
    enqueueSingleTask('vtracer', input as SingleEnqueueInput)
  );
  register('api:vec:run-potrace', RunSinglePotraceSchema, async (input) =>
    enqueueSingleTask('potrace', input as SingleEnqueueInput)
  );

  // ── 批量 ──
  register('api:vec:run-batch', RunBatchSchema, async (input) => {
    const v = validateOutputDir(input.options.outputDir);
    if (!v.ok) {
      return err(makeError('FILE_PERMISSION', v.reason, { severity: 'toast' }));
    }
    const existing = input.inputs.filter((p) => existsSync(p));
    if (existing.length === 0) {
      return err(makeError('FILE_NOT_FOUND', '所有输入文件都不存在', { severity: 'toast' }));
    }
    const r = getBatchQueue().enqueueBatch({
      mode: input.mode as VecMode,
      inputs: existing,
      options: input.options,
      params: input.params ?? {}
    });
    return ok({
      batchId: r.batchId,
      taskIds: r.taskIds,
      skippedExistingFiles: input.inputs.length - existing.length
    });
  });

  register('api:vec:pause-batch', BatchIdSchema, async (input) => {
    const ok2 = getBatchQueue().pauseBatch(input.batchId);
    if (!ok2) return err(makeError('VALIDATION_FAILED', '批次不存在', { severity: 'toast' }));
    return ok({ ok: true });
  });

  register('api:vec:resume-batch', BatchIdSchema, async (input) => {
    const ok2 = getBatchQueue().resumeBatch(input.batchId);
    if (!ok2) return err(makeError('VALIDATION_FAILED', '批次不存在或未暂停', { severity: 'toast' }));
    return ok({ ok: true });
  });

  register('api:vec:cancel-batch', BatchIdSchema, async (input) => {
    const ok2 = getBatchQueue().cancelBatch(input.batchId);
    if (!ok2) return err(makeError('VALIDATION_FAILED', '批次不存在', { severity: 'toast' }));
    return ok({ ok: true });
  });

  register('api:vec:cancel-task', TaskIdSchema, async (input) => {
    const ok2 = getBatchQueue().cancelTask(input.taskId);
    if (!ok2) {
      return err(
        makeError('VALIDATION_FAILED', '任务不存在或无法取消(运行中的 CPU 模式不可打断)', {
          severity: 'toast'
        })
      );
    }
    return ok({ ok: true });
  });

  register('api:vec:list-batches', null, async () => {
    return ok(getBatchQueue().listBatches());
  });

  // ── 历史 ──
  register('api:vec:history-list', HistoryListSchema, async (input) => {
    return ok(listVecHistory(input.filter ?? {}));
  });

  register('api:vec:history-clear', HistoryClearSchema, async (input) => {
    const deleted = clearVecHistory(input.olderThanDays);
    return ok({ deleted });
  });

  // ── 图片类型检测(拖入即调) ──
  register('api:vec:detect-type', DetectTypeSchema, async (input) => {
    if (!existsSync(input.inputPath)) {
      return err(
        makeError('FILE_NOT_FOUND', `图片不存在: ${input.inputPath}`, { severity: 'inline' })
      );
    }
    try {
      const detection = await detectImageType(input.inputPath);
      return ok(detection);
    } catch (e) {
      return err(
        makeError('UNKNOWN', `识别失败: ${(e as Error).message}`, { severity: 'silent' })
      );
    }
  });

  // ── report.json 读取(供 UI 详情面板) ──
  register('api:vec:report-get', ReportGetSchema, async (input) => {
    const reportFile = path.join(input.reportDir, 'report.json');
    if (!existsSync(reportFile)) {
      return err(makeError('FILE_NOT_FOUND', '报告文件不存在或已过期', { severity: 'inline' }));
    }
    try {
      const raw = await readFile(reportFile, 'utf-8');
      return ok(JSON.parse(raw));
    } catch (e) {
      return err(
        makeError('UNKNOWN', `读取报告失败: ${(e as Error).message}`, { severity: 'toast' })
      );
    }
  });

  // ── AutoTrace 探测(UI 用于判断 Pro 是否激活) ──
  register('api:vec:autotrace-probe', null, async () => {
    const exe = resolveAutotracePath();
    return ok({ available: exe !== null, exePath: exe });
  });

  // ── StarVector 探测(model path + sidecar reachable) ──
  register('api:vec:starvector-probe', null, async () => {
    const modelPath = readUserStarVectorPath();
    const modelPathConfigured = modelPath.length > 0;
    const modelPathExists = modelPathConfigured && existsSync(modelPath);
    const status = await getSidecarManager().getServerStatus(STARVECTOR_FEATURE_ID);
    return ok({
      modelPathConfigured,
      modelPathExists,
      sidecarReachable: status.reachable,
      available: modelPathExists && status.reachable,
      modelPath: modelPath || null
    });
  });

  // ── StarVector sidecar lifecycle ──
  register('api:vec:starvector-start-server', null, async () => {
    const modelPath = readUserStarVectorPath();
    if (modelPath) {
      // 通过 env 传给 start_starvector.bat
      process.env.MENGBI_STARVECTOR_MODEL_PATH = modelPath;
    }
    try {
      const r = await getSidecarManager().start(STARVECTOR_FEATURE_ID);
      return ok(r);
    } catch (e) {
      return err(
        makeError('CONFIG_INVALID', `StarVector 启动失败: ${(e as Error).message}`, {
          severity: 'toast',
          hint: '查看 logs/starvector.log 或 install_starvector_extras.bat 是否跑过。'
        })
      );
    }
  });

  register('api:vec:starvector-stop-server', null, async () => {
    try {
      const r = await getSidecarManager().stop(STARVECTOR_FEATURE_ID);
      return ok(r);
    } catch (e) {
      return err(
        makeError('UNKNOWN', `StarVector 停止失败: ${(e as Error).message}`, { severity: 'toast' })
      );
    }
  });

  // ── 打开 debug 目录(空 reportDir = 打开根目录) ──
  register('api:vec:debug-open', DebugOpenSchema, async (input) => {
    const target =
      input.reportDir && input.reportDir.length > 0
        ? input.reportDir
        : path.join(app.getPath('userData'), 'vec-debug');
    try {
      // 根目录不存在时建一个空目录(用户首次还没跑过任务也能打开)
      mkdirSync(target, { recursive: true });
      void shell.openPath(target);
      return ok({ ok: true });
    } catch (e) {
      return err(
        makeError('UNKNOWN', `打开目录失败: ${(e as Error).message}`, { severity: 'toast' })
      );
    }
  });
}
