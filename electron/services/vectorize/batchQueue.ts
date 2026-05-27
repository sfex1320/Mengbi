/**
 * 图像转矢量批量队列(3 模式,2026-05-28)。
 *
 * 模式 + 统一流水线:
 *   imagePreprocess → engineRunner.run() → svgPostprocess (cleaner/repair/simplify/score)
 *   → fallbackManager → debugWriter → vecHistory → 落盘 SVG → 进度事件
 *
 * 并发规则:
 *   - vtracer / potrace / autotrace 均 CPU 模式,并发 = max(1, os.cpus() - 1)
 *   - 各模式队列独立,互不阻塞
 *
 * 关键守则:
 *   - 引擎调用失败 → fallback 接管,UI 显示 actualEngine != requestedMode
 *   - VTracer 是绝对兜底;它失败时不再回退,直接 failed
 *   - cancel batch:pause + 丢掉 pending(运行中的 CPU 任务跑完不可打断)
 *   - 单任务失败不中断批次
 *
 * 事件发送:统一调 broadcast(channel, payload) → 所有 BrowserWindow
 */
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { BrowserWindow } from 'electron';

import { getEngine, isEngineImplemented } from './engines';
import { preprocessForMode, cleanupPreprocessTemp } from './preprocess/imagePreprocess';
import { runPostprocess } from './postprocess';
import { decideFallback, getFallbackTarget } from './fallback/fallbackManager';
import { prepareDebugDir, writeDebugBundle } from './debug/debugWriter';
import { insertVecHistory } from './vecHistory';
import { resolveOutputPath } from './outputNaming';
import { logger } from '../logger';
import type {
  VecMode,
  VecParams,
  VecBatchOptions,
  VecTaskRecord,
  VecBatchRecord,
  VecBatchStatus,
  VecTaskProgressEvent,
  VecBatchProgressEvent,
  EngineResult,
  PostprocessResult,
  VecReport,
  VTracerParams
} from './types';
import type { AppErrorCode } from '@shared/error';

// ── 事件分发 ─────────────────────────────────────────────────

function broadcast(channel: 'vec:progress' | 'vec:batch-progress', payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (w.isDestroyed()) continue;
    try {
      w.webContents.send(channel, payload);
    } catch {
      /* renderer 已销毁就静默 */
    }
  }
}

// ── 单例 ─────────────────────────────────────────────────────
// 2026-05-28: 砍 AI 模式后,所有模式都是 CPU spawn / 同步 NAPI,统一并发
class BatchQueueImpl {
  private readonly cpuConcurrency = Math.max(1, os.cpus().length - 1);

  // 任务索引 (taskId → record)
  private readonly tasks = new Map<string, VecTaskRecord>();
  // 批次索引 (batchId → record)
  private readonly batches = new Map<string, VecBatchRecord>();

  // 每种模式独立的待办 / 正跑集合
  private readonly pendingByMode: Record<VecMode, string[]> = {
    vtracer: [],
    potrace: []
  };
  private readonly runningByMode: Record<VecMode, Set<string>> = {
    vtracer: new Set(),
    potrace: new Set()
  };

  // 暂停的批次 (batchId set)
  private readonly pausedBatches = new Set<string>();

  // 每个批次的完成耗时累计(用于 ETA)
  private readonly completedDurationsByBatch = new Map<string, number[]>();

  // ── 公共接口 ────────────────────────────────────────────

  enqueueBatch(input: {
    mode: VecMode;
    inputs: string[];
    options: VecBatchOptions;
    params: VecParams;
  }): { batchId: string; taskIds: string[] } {
    const batchId = randomUUID();
    const taskIds: string[] = [];
    for (const inputPath of input.inputs) {
      const outputPath = resolveOutputPath(
        inputPath,
        input.options.outputDir,
        input.options.naming,
        input.options.onConflict
      );
      if (outputPath === null) {
        // skip 模式撞到现有文件,这条不入队,也不计入 total。
        continue;
      }
      const taskId = randomUUID();
      const rec: VecTaskRecord = {
        taskId,
        batchId,
        requestedMode: input.mode,
        actualEngine: null,
        fellBack: false,
        fallbackReason: null,
        inputPath,
        outputPath,
        status: 'pending',
        progress: 0,
        message: '排队中',
        errorCode: null,
        errorMessageZh: null,
        errorHint: null,
        errorTag: null,
        durationMs: null,
        qualityScore: null,
        reportDir: null,
        params: input.params,
        submittedAt: Date.now(),
        startedAt: null,
        finishedAt: null
      };
      this.tasks.set(taskId, rec);
      this.pendingByMode[input.mode].push(taskId);
      taskIds.push(taskId);
    }

    const batch: VecBatchRecord = {
      batchId,
      requestedMode: input.mode,
      status: taskIds.length === 0 ? 'completed' : 'running',
      options: input.options,
      taskIds,
      createdAt: Date.now()
    };
    this.batches.set(batchId, batch);
    this.completedDurationsByBatch.set(batchId, []);

    // 立即先推一个 batch 状态,让 UI 看到总数
    this.emitBatchProgress(batchId);

    // kick off dispatch
    if (taskIds.length > 0) {
      this.dispatch(input.mode);
    }
    return { batchId, taskIds };
  }

  pauseBatch(batchId: string): boolean {
    if (!this.batches.has(batchId)) return false;
    this.pausedBatches.add(batchId);
    const b = this.batches.get(batchId);
    if (b && b.status === 'running') {
      b.status = 'paused';
      this.emitBatchProgress(batchId);
    }
    return true;
  }

  resumeBatch(batchId: string): boolean {
    if (!this.batches.has(batchId)) return false;
    if (!this.pausedBatches.delete(batchId)) return false;
    const b = this.batches.get(batchId);
    if (b && b.status === 'paused') {
      b.status = 'running';
      this.emitBatchProgress(batchId);
      this.dispatch(b.requestedMode);
    }
    return true;
  }

  cancelBatch(batchId: string): boolean {
    const b = this.batches.get(batchId);
    if (!b) return false;
    this.pausedBatches.add(batchId);
    for (const taskId of b.taskIds) {
      const t = this.tasks.get(taskId);
      if (!t) continue;
      if (t.status === 'pending') {
        t.status = 'cancelled';
        t.message = '已取消';
        t.finishedAt = Date.now();
        this.emitTaskProgress(t);
      }
      // running 的 CPU 同步调用没法打断,跑完会自然完成。
    }
    for (const mode of Object.keys(this.pendingByMode) as VecMode[]) {
      this.pendingByMode[mode] = this.pendingByMode[mode].filter((id) => {
        const t = this.tasks.get(id);
        return t && t.batchId !== batchId;
      });
    }
    b.status = 'aborted';
    this.emitBatchProgress(batchId);
    return true;
  }

  cancelTask(taskId: string): boolean {
    const t = this.tasks.get(taskId);
    if (!t) return false;
    if (t.status === 'pending') {
      t.status = 'cancelled';
      t.message = '已取消';
      t.finishedAt = Date.now();
      this.pendingByMode[t.requestedMode] = this.pendingByMode[t.requestedMode].filter(
        (id) => id !== taskId
      );
      this.emitTaskProgress(t);
      this.afterTaskFinished(t);
      return true;
    }
    return false;
  }

  listBatches(): VecBatchRecord[] {
    return Array.from(this.batches.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  getTask(taskId: string): VecTaskRecord | null {
    return this.tasks.get(taskId) ?? null;
  }

  getBatch(batchId: string): VecBatchRecord | null {
    return this.batches.get(batchId) ?? null;
  }

  // ── 内部 dispatch ────────────────────────────────────────

  private dispatch(mode: VecMode): void {
    const concurrency = this.cpuConcurrency;
    while (this.runningByMode[mode].size < concurrency) {
      const taskId = this.popNextRunnable(mode);
      if (!taskId) break;
      const t = this.tasks.get(taskId);
      if (!t) continue;
      this.runningByMode[mode].add(taskId);
      this.startTask(t).catch((e) => {
        logger.error(`[vec.queue] startTask threw: ${(e as Error).message}`);
      });
    }
  }

  private popNextRunnable(mode: VecMode): string | null {
    const arr = this.pendingByMode[mode];
    for (let i = 0; i < arr.length; i++) {
      const id = arr[i];
      const t = this.tasks.get(id);
      if (!t) {
        arr.splice(i, 1);
        i--;
        continue;
      }
      if (this.pausedBatches.has(t.batchId)) continue;
      arr.splice(i, 1);
      return id;
    }
    return null;
  }

  // ── 主流水线 ────────────────────────────────────────────────

  private async startTask(t: VecTaskRecord): Promise<void> {
    t.status = 'running';
    t.startedAt = Date.now();
    t.message = '预处理中…';
    t.progress = 5;
    this.emitTaskProgress(t);
    this.emitBatchProgress(t.batchId);

    // debug 目录
    let debugDir: string | null = null;
    try {
      const bundle = await prepareDebugDir(t.taskId, new Date(t.startedAt ?? Date.now()));
      debugDir = bundle.dirPath;
      t.reportDir = debugDir;
    } catch (e) {
      logger.warn(`[vec.queue] prepareDebugDir failed: ${(e as Error).message}`);
    }

    // 输入文件元信息(用于 report)
    let inputSizeBytes = 0;
    try {
      const st = await fs.stat(t.inputPath);
      inputSizeBytes = st.size;
    } catch {
      /* 忽略 */
    }

    // ── 1) preprocess(主模式) ───────────────────────────────
    t.message = '预处理图像…';
    t.progress = 10;
    this.emitTaskProgress(t);

    let preprocessedPath = t.inputPath;
    let preprocessedSize: [number, number] | null = null;
    try {
      const pp = await preprocessForMode(t.inputPath, t.requestedMode);
      preprocessedPath = pp.outputPath;
      preprocessedSize = [pp.width, pp.height];
    } catch (e) {
      logger.warn(`[vec.queue] preprocess failed, fall back to original: ${(e as Error).message}`);
    }

    // ── 2) engine.run() ─────────────────────────────────────
    t.message = `调用 ${t.requestedMode} 引擎…`;
    t.progress = 25;
    this.emitTaskProgress(t);

    const primaryAttempt = await this.runEngineForMode(
      t.requestedMode,
      t.inputPath,
      preprocessedPath,
      t.params
    );

    // ── 3) postprocess(若主引擎成功) ───────────────────────
    let postRes: PostprocessResult | null = null;
    if (primaryAttempt.engineResult.ok) {
      t.message = 'SVG 后处理…';
      t.progress = 55;
      this.emitTaskProgress(t);
      try {
        postRes = runPostprocess(primaryAttempt.engineResult.svg);
      } catch (e) {
        logger.warn(`[vec.queue] postprocess threw: ${(e as Error).message}`);
      }
    }

    // ── 4) fallback 决策 ────────────────────────────────────
    const fbDecision = decideFallback({
      requestedMode: t.requestedMode,
      engineOk: primaryAttempt.engineResult.ok,
      qualityScore: postRes ? postRes.score : null,
      hasVisibleElements: postRes ? postRes.stats.visibleElementCount > 0 : false
    });

    let finalEngineResult: EngineResult = primaryAttempt.engineResult;
    let finalPost: PostprocessResult | null = postRes;
    let actualEngine: VecMode = t.requestedMode;
    let fellBack = false;
    let fallbackReason: string | null = null;
    let fallbackSvg: string | null = null;

    if (fbDecision.fallback && fbDecision.target) {
      fellBack = true;
      fallbackReason = fbDecision.reason;
      logger.info(
        `[vec.queue] task ${t.taskId.slice(0, 8)} ${t.requestedMode} → 回退 ${fbDecision.target}: ${fbDecision.reason}`
      );
      t.message = `${t.requestedMode} 失败,回退到 ${fbDecision.target}…`;
      t.fellBack = true;
      t.fallbackReason = fallbackReason;
      this.emitTaskProgress(t);

      // 重新预处理(可能模式不同),复用原图
      let fbPreprocessed = t.inputPath;
      try {
        const pp = await preprocessForMode(t.inputPath, fbDecision.target);
        fbPreprocessed = pp.outputPath;
      } catch (e) {
        logger.warn(`[vec.queue] fallback preprocess failed: ${(e as Error).message}`);
      }
      const fbAttempt = await this.runEngineForMode(
        fbDecision.target,
        t.inputPath,
        fbPreprocessed,
        // 回退用 VTracer 默认参数(用户原参数对它无意义)
        {} as VTracerParams
      );
      finalEngineResult = fbAttempt.engineResult;
      actualEngine = fbDecision.target;
      if (fbAttempt.engineResult.ok) {
        try {
          finalPost = runPostprocess(fbAttempt.engineResult.svg);
          fallbackSvg = finalPost.final;
        } catch (e) {
          logger.warn(`[vec.queue] fallback postprocess threw: ${(e as Error).message}`);
        }
      }
      if (fbPreprocessed !== t.inputPath) {
        void cleanupPreprocessTemp(fbPreprocessed).catch(() => {});
      }
    }

    // ── 5) 落盘 SVG ─────────────────────────────────────────
    let savedOk = false;
    if (finalEngineResult.ok && finalPost) {
      try {
        await fs.mkdir(path.dirname(t.outputPath), { recursive: true });
        await fs.writeFile(t.outputPath, finalPost.final, 'utf-8');
        savedOk = true;
      } catch (e) {
        logger.error(`[vec.queue] write final svg failed: ${(e as Error).message}`);
      }
    }

    // ── 6) 写 debug bundle ──────────────────────────────────
    if (debugDir) {
      const report = this.buildReport({
        t,
        actualEngine,
        fellBack,
        fallbackReason,
        primaryEngineResult: primaryAttempt.engineResult,
        finalEngineResult,
        primaryPost: postRes,
        finalPost,
        inputSizeBytes,
        preprocessedPath: preprocessedPath !== t.inputPath ? preprocessedPath : null,
        preprocessedSize
      });
      const errorLog = finalEngineResult.ok
        ? undefined
        : `[engine_error]\nrequestedMode=${t.requestedMode}\nactualEngine=${actualEngine}\nerrorTag=${finalEngineResult.errorTag}\nerrorCode=${finalEngineResult.errorCode}\nmessageZh=${finalEngineResult.errorMessageZh}\nhint=${finalEngineResult.errorHint}\nraw=${finalEngineResult.rawError}`;
      void writeDebugBundle({
        dirPath: debugDir,
        inputOriginalPath: t.inputPath,
        inputPreprocessedPath: preprocessedPath !== t.inputPath ? preprocessedPath : undefined,
        engineRawSvg: primaryAttempt.engineResult.ok ? primaryAttempt.engineResult.svg : undefined,
        engineRawText: primaryAttempt.engineResult.ok
          ? primaryAttempt.engineResult.rawOutput
          : undefined,
        svgCleaned: postRes?.cleaned,
        svgRepaired: postRes?.repaired,
        svgFinal: finalPost?.final,
        fallbackSvg: fellBack && fallbackSvg ? fallbackSvg : undefined,
        errorLog,
        report
      }).catch((e) => {
        logger.warn(`[vec.queue] writeDebugBundle failed: ${(e as Error).message}`);
      });
    }

    // ── 7) 清理临时预处理图 ────────────────────────────────
    if (preprocessedPath !== t.inputPath) {
      void cleanupPreprocessTemp(preprocessedPath).catch(() => {});
    }

    // ── 8) 收尾 ─────────────────────────────────────────────
    t.actualEngine = actualEngine;
    t.fellBack = fellBack;
    t.fallbackReason = fallbackReason;
    t.qualityScore = finalPost ? finalPost.score : null;

    if (finalEngineResult.ok && savedOk) {
      this.markSucceeded(t, finalEngineResult.durationMs);
    } else if (!finalEngineResult.ok) {
      this.markFailed(
        t,
        finalEngineResult.errorCode,
        finalEngineResult.errorMessageZh,
        finalEngineResult.errorHint,
        finalEngineResult.errorTag,
        finalEngineResult.rawError
      );
    } else {
      // 引擎 ok 但落盘失败
      this.markFailed(
        t,
        'FILE_PERMISSION',
        '写入 SVG 文件失败',
        '检查输出目录是否可写。',
        'OUTPUT_WRITE_FAILED',
        null
      );
    }
  }

  /**
   * 运行单一引擎一次。引擎未实装时返回结构化失败,让上层 fallback 接管。
   */
  private async runEngineForMode(
    mode: VecMode,
    originalInputPath: string,
    preprocessedPath: string,
    params: VecParams
  ): Promise<{ engineResult: EngineResult }> {
    if (!isEngineImplemented(mode)) {
      return {
        engineResult: {
          ok: false,
          errorCode: 'NOT_IMPLEMENTED',
          errorTag: `${mode.toUpperCase()}_NOT_IMPLEMENTED`,
          errorMessageZh: `${mode} 引擎尚未实装`,
          errorHint: '请在设置里改用 Fast(VTracer)或 Crisp(Potrace)。',
          rawError: 'engine factory missing',
          durationMs: 0
        }
      };
    }
    const engine = getEngine(mode);
    if (!engine) {
      return {
        engineResult: {
          ok: false,
          errorCode: 'NOT_IMPLEMENTED',
          errorTag: `${mode.toUpperCase()}_NOT_REGISTERED`,
          errorMessageZh: `${mode} 引擎未注册`,
          errorHint: '内部错误,请联系开发者。',
          rawError: 'getEngine returned null',
          durationMs: 0
        }
      };
    }
    try {
      const result = await engine.run({
        originalInputPath,
        preprocessedPath,
        params
      });
      return { engineResult: result };
    } catch (e) {
      const msg = (e as Error).message || String(e);
      return {
        engineResult: {
          ok: false,
          errorCode: 'UNKNOWN',
          errorTag: `${mode.toUpperCase()}_UNCAUGHT`,
          errorMessageZh: `${mode} 引擎抛出未预期异常: ${msg}`,
          errorHint: '查看 vec-debug/<ts>/error_log.txt。',
          rawError: msg,
          durationMs: 0
        }
      };
    }
  }

  // ── 报告构造 ─────────────────────────────────────────────

  private buildReport(args: {
    t: VecTaskRecord;
    actualEngine: VecMode;
    fellBack: boolean;
    fallbackReason: string | null;
    primaryEngineResult: EngineResult;
    finalEngineResult: EngineResult;
    primaryPost: PostprocessResult | null;
    finalPost: PostprocessResult | null;
    inputSizeBytes: number;
    preprocessedPath: string | null;
    preprocessedSize: [number, number] | null;
  }): VecReport {
    const { t, actualEngine, fellBack, fallbackReason } = args;
    const post = args.finalPost;
    const stats = post?.stats;
    const engineMeta =
      args.finalEngineResult.ok && args.finalEngineResult.meta ? args.finalEngineResult.meta : null;
    const engineErr = args.finalEngineResult.ok ? null : args.finalEngineResult;
    const rawOutputChars = args.primaryEngineResult.ok ? args.primaryEngineResult.svg.length : 0;

    return {
      taskId: t.taskId,
      batchId: t.batchId,
      timestamp: new Date(t.startedAt ?? Date.now()).toISOString(),
      inputPath: t.inputPath,
      inputSizeBytes: args.inputSizeBytes,
      inputWidth: null,
      inputHeight: null,
      inputMode: null,
      preprocessedPath: args.preprocessedPath,
      preprocessedSize: args.preprocessedSize,
      requestedMode: t.requestedMode,
      actualEngine,
      fellBack,
      fallbackReason,
      engineModelName: typeof engineMeta?.modelName === 'string' ? engineMeta.modelName : null,
      engineModelPath: typeof engineMeta?.modelPath === 'string' ? engineMeta.modelPath : null,
      durationMs: args.finalEngineResult.ok
        ? args.finalEngineResult.durationMs
        : engineErr?.durationMs ?? 0,
      engineRawOutputChars: rawOutputChars,
      svgPathCount: stats?.pathCount ?? 0,
      svgRectCount: stats?.rectCount ?? 0,
      svgCircleCount: stats?.circleCount ?? 0,
      svgEllipseCount: stats?.ellipseCount ?? 0,
      svgPolygonCount: stats?.polygonCount ?? 0,
      svgPolylineCount: stats?.polylineCount ?? 0,
      svgLineCount: stats?.lineCount ?? 0,
      svgTextCount: stats?.textCount ?? 0,
      svgColorCount: stats?.colorCount ?? 0,
      svgNodeCount: stats?.nodeCount ?? 0,
      svgFileSizeBytes: stats?.fileSizeBytes ?? 0,
      hasSvgTag: stats?.hasSvgTag ?? false,
      hasCloseTag: stats?.hasCloseTag ?? false,
      xmlValid: stats?.xmlValid ?? false,
      hasViewBox: stats?.hasViewBox ?? false,
      previewRenderable: false,
      duplicateCoordRatio: stats?.duplicateCoordRatio ?? 0,
      duplicatePathRatio: stats?.duplicatePathRatio ?? 0,
      qualityScore: post?.score ?? 0,
      qualityTier: post?.tier ?? 'invalid',
      engineErrorCode: engineErr?.errorCode ?? null,
      engineErrorMessageZh: engineErr?.errorMessageZh ?? null,
      engineErrorHint: engineErr?.errorHint ?? null,
      engineErrorTag: engineErr?.errorTag ?? null,
      userSuggestion: this.suggestionFor(t.requestedMode, post),
      engineMeta
    };
  }

  /** 简单启发式建议(放后处理之后) */
  private suggestionFor(requestedMode: VecMode, post: PostprocessResult | null): string | null {
    if (!post) return null;
    const s = post.stats;
    if (s.pathCount > 3000) {
      return '路径数较多,可在设置里调高 filterSpeckle 减少节点。';
    }
    if (s.visibleElementCount === 0) {
      return '输出无可见元素,建议尝试其它模式。';
    }
    if (post.score < 40) {
      return `${requestedMode} 输出质量较低,可改用 Fast(VTracer)。`;
    }
    return null;
  }

  // ── 任务终态收尾 ──────────────────────────────────────────

  private markSucceeded(t: VecTaskRecord, durationMs: number): void {
    t.status = 'succeeded';
    t.progress = 100;
    t.durationMs = durationMs;
    t.finishedAt = Date.now();
    const tail = t.fellBack ? ` · 已回退 ${t.actualEngine}` : '';
    t.message = `完成 (${(durationMs / 1000).toFixed(1)}s)${tail}`;
    this.persistHistory(t);
    this.emitTaskProgress(t);
    this.afterTaskFinished(t);
  }

  private markFailed(
    t: VecTaskRecord,
    errorCode: AppErrorCode,
    messageZh: string,
    hint: string,
    errorTag: string,
    raw: string | null
  ): void {
    t.status = 'failed';
    t.errorCode = errorCode;
    t.errorMessageZh = messageZh;
    t.errorHint = hint;
    t.errorTag = errorTag;
    t.message = messageZh;
    t.finishedAt = Date.now();
    t.durationMs = (t.finishedAt ?? Date.now()) - (t.startedAt ?? Date.now());
    void raw; // raw 仅写到 debug 里,这里不存
    this.persistHistory(t);
    this.emitTaskProgress(t);
    this.afterTaskFinished(t);
  }

  private persistHistory(t: VecTaskRecord): void {
    try {
      insertVecHistory({
        batchId: t.batchId,
        requestedMode: t.requestedMode,
        actualEngine: t.actualEngine,
        fellBack: t.fellBack,
        fallbackReason: t.fallbackReason,
        qualityScore: t.qualityScore,
        reportPath: t.reportDir,
        inputPath: t.inputPath,
        outputPath: t.outputPath,
        durationMs: t.durationMs ?? 0,
        status: t.status === 'succeeded' || t.status === 'cancelled' ? t.status : 'failed',
        error: t.errorMessageZh,
        paramsJson: JSON.stringify(t.params)
      });
    } catch (e) {
      logger.warn(`[vec.queue] persist history failed: ${(e as Error).message}`);
    }
  }

  private afterTaskFinished(t: VecTaskRecord): void {
    this.runningByMode[t.requestedMode].delete(t.taskId);
    const arr = this.completedDurationsByBatch.get(t.batchId) ?? [];
    if (t.durationMs != null) arr.push(t.durationMs);
    this.completedDurationsByBatch.set(t.batchId, arr);

    this.emitBatchProgress(t.batchId);
    const batch = this.batches.get(t.batchId);
    if (batch && this.isBatchDone(t.batchId)) {
      batch.status = batch.status === 'aborted' ? 'aborted' : 'completed';
      this.emitBatchProgress(t.batchId);
    }
    this.dispatch(t.requestedMode);
  }

  // ── 进度事件构造 ──────────────────────────────────────────

  private emitTaskProgress(t: VecTaskRecord): void {
    const payload: VecTaskProgressEvent = {
      batchId: t.batchId,
      taskId: t.taskId,
      requestedMode: t.requestedMode,
      actualEngine: t.actualEngine,
      fellBack: t.fellBack,
      fallbackReason: t.fallbackReason,
      status: t.status,
      progress: t.progress,
      message: t.message,
      outputPath: t.status === 'succeeded' ? t.outputPath : null,
      durationMs: t.durationMs,
      qualityScore: t.qualityScore,
      errorCode: t.errorCode,
      errorMessageZh: t.errorMessageZh,
      errorHint: t.errorHint,
      errorTag: t.errorTag,
      reportDir: t.reportDir
    };
    broadcast('vec:progress', payload);
  }

  private emitBatchProgress(batchId: string): void {
    const batch = this.batches.get(batchId);
    if (!batch) return;
    let pending = 0,
      running = 0,
      succeeded = 0,
      failed = 0,
      cancelled = 0,
      fellBackCount = 0;
    for (const taskId of batch.taskIds) {
      const t = this.tasks.get(taskId);
      if (!t) continue;
      if (t.fellBack) fellBackCount++;
      switch (t.status) {
        case 'pending':
          pending++;
          break;
        case 'running':
          running++;
          break;
        case 'succeeded':
          succeeded++;
          break;
        case 'failed':
          failed++;
          break;
        case 'cancelled':
          cancelled++;
          break;
      }
    }
    const total = batch.taskIds.length;
    const durations = this.completedDurationsByBatch.get(batchId) ?? [];
    const avg = durations.length ? durations.reduce((s, n) => s + n, 0) / durations.length : null;
    const remaining = pending + running;
    const eta = avg !== null && remaining > 0 ? Math.round((avg * remaining) / 1000) : null;

    let status: VecBatchStatus = batch.status;
    if (this.pausedBatches.has(batchId) && status !== 'aborted') status = 'paused';
    else if (status !== 'aborted' && pending + running === 0) status = 'completed';
    else if (status !== 'aborted' && status !== 'paused') status = 'running';
    batch.status = status;

    const payload: VecBatchProgressEvent = {
      batchId,
      requestedMode: batch.requestedMode,
      status,
      total,
      pending,
      running,
      succeeded,
      failed,
      cancelled,
      fellBackCount,
      etaSeconds: eta,
      avgPerTaskMs: avg
    };
    broadcast('vec:batch-progress', payload);
  }

  private isBatchDone(batchId: string): boolean {
    const b = this.batches.get(batchId);
    if (!b) return true;
    for (const id of b.taskIds) {
      const t = this.tasks.get(id);
      if (!t) continue;
      if (t.status === 'pending' || t.status === 'running') return false;
    }
    return true;
  }

  /** 直接给 fallback target 返回(用于 IPC 探测) */
  getFallbackTargetFor(mode: VecMode): VecMode | null {
    return getFallbackTarget(mode);
  }
}

let _instance: BatchQueueImpl | null = null;
export function getBatchQueue(): BatchQueueImpl {
  if (!_instance) _instance = new BatchQueueImpl();
  return _instance;
}
