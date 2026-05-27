/**
 * vectorize_history 表 CRUD(v3 重构,2026-05-27)。
 *
 * 表 schema 详见 electron/services/db.ts 的 v12 / v13 迁移段。
 * 所有完成的 vec 任务(succeeded / failed / cancelled)都落一条历史记录。
 *
 * v13 加 6 列:
 *   - requested_mode  用户选择的模式
 *   - actual_engine   实际跑成功的引擎(回退时 != requested_mode)
 *   - fell_back       0 / 1
 *   - fallback_reason 回退原因(failed 也可能填)
 *   - quality_score   0-100
 *   - report_path     userData/vec-debug/<ts>/  绝对路径
 *
 * `mode` 列保留,实际等价于 actual_engine(给旧 UI 复用);
 *  写入时 mode = actualEngine ?? requestedMode。
 */
import { getDb } from '../db';
import type { VecHistoryRow, VecMode } from './types';

export interface InsertVecHistoryInput {
  batchId: string | null;
  requestedMode: VecMode;
  actualEngine: VecMode | null;
  fellBack: boolean;
  fallbackReason: string | null;
  qualityScore: number | null;
  reportPath: string | null;
  inputPath: string;
  outputPath: string;
  durationMs: number;
  status: 'succeeded' | 'failed' | 'cancelled';
  error: string | null;
  paramsJson: string | null;
}

export function insertVecHistory(input: InsertVecHistoryInput): number {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO vectorize_history
      (created_at, batch_id, mode, requested_mode, actual_engine,
       fell_back, fallback_reason, quality_score, report_path,
       input_path, output_path, duration_ms, status, error, params_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const modeForLegacy = input.actualEngine ?? input.requestedMode;
  const r = stmt.run(
    new Date().toISOString(),
    input.batchId,
    modeForLegacy,
    input.requestedMode,
    input.actualEngine,
    input.fellBack ? 1 : 0,
    input.fallbackReason,
    input.qualityScore,
    input.reportPath,
    input.inputPath,
    input.outputPath,
    Math.round(input.durationMs),
    input.status,
    input.error,
    input.paramsJson
  );
  return Number(r.lastInsertRowid);
}

export interface ListVecHistoryFilter {
  batchId?: string;
  mode?: VecMode;             // 走 mode 列(actual_engine 同步)
  requestedMode?: VecMode;    // 单独按用户选择的模式过滤
  status?: 'succeeded' | 'failed' | 'cancelled';
  fellBackOnly?: boolean;     // 只看发生过回退的
  limit?: number;
  offset?: number;
}

export function listVecHistory(filter: ListVecHistoryFilter = {}): VecHistoryRow[] {
  const db = getDb();
  const where: string[] = [];
  const args: Array<string | number> = [];
  if (filter.batchId) {
    where.push('batch_id = ?');
    args.push(filter.batchId);
  }
  if (filter.mode) {
    where.push('mode = ?');
    args.push(filter.mode);
  }
  if (filter.requestedMode) {
    where.push('requested_mode = ?');
    args.push(filter.requestedMode);
  }
  if (filter.status) {
    where.push('status = ?');
    args.push(filter.status);
  }
  if (filter.fellBackOnly) {
    where.push('fell_back = 1');
  }
  const limit = Math.max(1, Math.min(filter.limit ?? 200, 5000));
  const offset = Math.max(0, filter.offset ?? 0);

  const sql = `
    SELECT id, created_at, batch_id, mode,
           requested_mode, actual_engine, fell_back, fallback_reason,
           quality_score, report_path,
           input_path, output_path,
           duration_ms, status, error, params_json
      FROM vectorize_history
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY id DESC
      LIMIT ? OFFSET ?
  `;
  const rows = db.prepare(sql).all(...args, limit, offset) as Array<{
    id: number;
    created_at: string;
    batch_id: string | null;
    mode: VecMode;
    requested_mode: VecMode | null;
    actual_engine: VecMode | null;
    fell_back: number;
    fallback_reason: string | null;
    quality_score: number | null;
    report_path: string | null;
    input_path: string;
    output_path: string;
    duration_ms: number;
    status: 'succeeded' | 'failed' | 'cancelled';
    error: string | null;
    params_json: string | null;
  }>;
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    batchId: r.batch_id,
    mode: r.mode,
    requestedMode: r.requested_mode,
    actualEngine: r.actual_engine,
    fellBack: r.fell_back === 1,
    fallbackReason: r.fallback_reason,
    qualityScore: r.quality_score,
    reportPath: r.report_path,
    inputPath: r.input_path,
    outputPath: r.output_path,
    durationMs: r.duration_ms,
    status: r.status,
    error: r.error,
    paramsJson: r.params_json
  }));
}

export function clearVecHistory(olderThanDays?: number): number {
  const db = getDb();
  if (typeof olderThanDays === 'number' && olderThanDays > 0) {
    const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
    const r = db.prepare(`DELETE FROM vectorize_history WHERE created_at < ?`).run(cutoff);
    return r.changes;
  }
  const r = db.prepare(`DELETE FROM vectorize_history`).run();
  return r.changes;
}
