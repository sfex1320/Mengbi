/**
 * ComfyUI 编排器的 DB 读写：工作流模板 + 运行记录。所有 SQL 收口于此。
 * 表结构见 db.ts v14 迁移。JSON 列以字符串存取，这里做序列化/反序列化。
 */
import { getDb } from '../db';
import type {
  WorkflowTemplate,
  WorkflowTemplateSummary,
  ComfyRun,
  RunStatus,
  InputControl,
  OutputControl,
  Binding,
  LoopConfig,
  UiLayout,
  OutputFile,
  ComfyRunSummary
} from '@shared/comfyui';

function safeParse<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

interface TemplateRow {
  workflow_id: string;
  name: string;
  type_tags: string | null;
  original_api_workflow_json: string;
  object_info_snapshot: string | null;
  input_controls: string;
  output_controls: string;
  bindings: string;
  loop_config: string | null;
  ui_layout: string | null;
  created_at: string;
  updated_at: string;
}

function rowToTemplate(r: TemplateRow): WorkflowTemplate {
  return {
    workflowId: r.workflow_id,
    name: r.name,
    typeTags: safeParse<string[]>(r.type_tags, []),
    originalApiWorkflowJson: r.original_api_workflow_json,
    objectInfoSnapshot: r.object_info_snapshot,
    inputControls: safeParse<InputControl[]>(r.input_controls, []),
    outputControls: safeParse<OutputControl[]>(r.output_controls, []),
    bindings: safeParse<Binding[]>(r.bindings, []),
    loopConfig: safeParse<LoopConfig | null>(r.loop_config, null),
    uiLayout: safeParse<UiLayout | null>(r.ui_layout, null),
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

export function listTemplates(): WorkflowTemplateSummary[] {
  const rows = getDb()
    .prepare(
      `SELECT workflow_id, name, type_tags, updated_at
         FROM comfyui_workflow_templates ORDER BY updated_at DESC`
    )
    .all() as Array<Pick<TemplateRow, 'workflow_id' | 'name' | 'type_tags' | 'updated_at'>>;
  return rows.map((r) => ({
    workflowId: r.workflow_id,
    name: r.name,
    typeTags: safeParse<string[]>(r.type_tags, []),
    updatedAt: r.updated_at
  }));
}

export function getTemplate(workflowId: string): WorkflowTemplate | null {
  const row = getDb()
    .prepare(`SELECT * FROM comfyui_workflow_templates WHERE workflow_id = ?`)
    .get(workflowId) as TemplateRow | undefined;
  return row ? rowToTemplate(row) : null;
}

export function upsertTemplate(t: WorkflowTemplate): void {
  const db = getDb();
  const now = new Date().toISOString();
  const exists = db
    .prepare(`SELECT 1 FROM comfyui_workflow_templates WHERE workflow_id = ?`)
    .get(t.workflowId);
  if (exists) {
    db.prepare(
      `UPDATE comfyui_workflow_templates SET
         name=?, type_tags=?, original_api_workflow_json=?, object_info_snapshot=?,
         input_controls=?, output_controls=?, bindings=?, loop_config=?, ui_layout=?, updated_at=?
       WHERE workflow_id=?`
    ).run(
      t.name,
      JSON.stringify(t.typeTags ?? []),
      t.originalApiWorkflowJson,
      t.objectInfoSnapshot ?? null,
      JSON.stringify(t.inputControls ?? []),
      JSON.stringify(t.outputControls ?? []),
      JSON.stringify(t.bindings ?? []),
      t.loopConfig ? JSON.stringify(t.loopConfig) : null,
      t.uiLayout ? JSON.stringify(t.uiLayout) : null,
      now,
      t.workflowId
    );
  } else {
    db.prepare(
      `INSERT INTO comfyui_workflow_templates(
         workflow_id, name, type_tags, original_api_workflow_json, object_info_snapshot,
         input_controls, output_controls, bindings, loop_config, ui_layout, created_at, updated_at
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      t.workflowId,
      t.name,
      JSON.stringify(t.typeTags ?? []),
      t.originalApiWorkflowJson,
      t.objectInfoSnapshot ?? null,
      JSON.stringify(t.inputControls ?? []),
      JSON.stringify(t.outputControls ?? []),
      JSON.stringify(t.bindings ?? []),
      t.loopConfig ? JSON.stringify(t.loopConfig) : null,
      t.uiLayout ? JSON.stringify(t.uiLayout) : null,
      t.createdAt || now,
      now
    );
  }
}

export function deleteTemplate(workflowId: string): void {
  getDb().prepare(`DELETE FROM comfyui_workflow_templates WHERE workflow_id = ?`).run(workflowId);
}

// ───────────────────────── 运行记录 ─────────────────────────

interface RunRow {
  run_id: string;
  template_id: string | null;
  batch_id: string | null;
  iteration_index: number;
  prompt_id: string | null;
  status: RunStatus;
  input_snapshot: string | null;
  parameter_snapshot: string | null;
  uploaded_files: string | null;
  output_files: string | null;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
}

function rowToRun(r: RunRow): ComfyRun {
  return {
    runId: r.run_id,
    templateId: r.template_id,
    batchId: r.batch_id,
    iterationIndex: r.iteration_index,
    promptId: r.prompt_id,
    status: r.status,
    inputSnapshot: safeParse<Record<string, unknown> | null>(r.input_snapshot, null),
    parameterSnapshot: safeParse<Record<string, unknown> | null>(r.parameter_snapshot, null),
    uploadedFiles: safeParse<Record<string, unknown> | null>(r.uploaded_files, null),
    outputFiles: safeParse<OutputFile[] | null>(r.output_files, null),
    errorMessage: r.error_message,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    durationMs: r.duration_ms
  };
}

export interface CreateRunInput {
  runId: string;
  templateId: string | null;
  batchId: string | null;
  iterationIndex: number;
  inputSnapshot?: Record<string, unknown> | null;
  parameterSnapshot?: Record<string, unknown> | null;
}

export function createRun(input: CreateRunInput): void {
  getDb()
    .prepare(
      `INSERT INTO comfyui_runs(
         run_id, template_id, batch_id, iteration_index, status,
         input_snapshot, parameter_snapshot, started_at
       ) VALUES (?,?,?,?,'pending',?,?,?)`
    )
    .run(
      input.runId,
      input.templateId,
      input.batchId,
      input.iterationIndex,
      input.inputSnapshot ? JSON.stringify(input.inputSnapshot) : null,
      input.parameterSnapshot ? JSON.stringify(input.parameterSnapshot) : null,
      new Date().toISOString()
    );
}

export interface UpdateRunPatch {
  status?: RunStatus;
  promptId?: string | null;
  uploadedFiles?: Record<string, unknown> | null;
  outputFiles?: OutputFile[] | null;
  errorMessage?: string | null;
  finishedAt?: string | null;
  durationMs?: number | null;
}

export function updateRun(runId: string, patch: UpdateRunPatch): void {
  const sets: string[] = [];
  const vals: unknown[] = [];
  const add = (col: string, v: unknown): void => {
    sets.push(`${col}=?`);
    vals.push(v);
  };
  if (patch.status !== undefined) add('status', patch.status);
  if (patch.promptId !== undefined) add('prompt_id', patch.promptId);
  if (patch.uploadedFiles !== undefined)
    add('uploaded_files', patch.uploadedFiles ? JSON.stringify(patch.uploadedFiles) : null);
  if (patch.outputFiles !== undefined)
    add('output_files', patch.outputFiles ? JSON.stringify(patch.outputFiles) : null);
  if (patch.errorMessage !== undefined) add('error_message', patch.errorMessage);
  if (patch.finishedAt !== undefined) add('finished_at', patch.finishedAt);
  if (patch.durationMs !== undefined) add('duration_ms', patch.durationMs);
  if (sets.length === 0) return;
  vals.push(runId);
  getDb()
    .prepare(`UPDATE comfyui_runs SET ${sets.join(', ')} WHERE run_id = ?`)
    .run(...vals);
}

export function getRun(runId: string): ComfyRun | null {
  const row = getDb().prepare(`SELECT * FROM comfyui_runs WHERE run_id = ?`).get(runId) as
    | RunRow
    | undefined;
  return row ? rowToRun(row) : null;
}

export function listRunsByBatch(batchId: string): ComfyRun[] {
  const rows = getDb()
    .prepare(`SELECT * FROM comfyui_runs WHERE batch_id = ? ORDER BY iteration_index`)
    .all(batchId) as RunRow[];
  return rows.map(rowToRun);
}

export interface RunFilter {
  templateId?: string;
  batchId?: string;
  limit?: number;
  offset?: number;
}

export function listRuns(filter: RunFilter): ComfyRunSummary[] {
  const where: string[] = [];
  const args: unknown[] = [];
  if (filter.templateId) {
    where.push('template_id = ?');
    args.push(filter.templateId);
  }
  if (filter.batchId) {
    where.push('batch_id = ?');
    args.push(filter.batchId);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = filter.limit ?? 200;
  const offset = filter.offset ?? 0;
  const rows = getDb()
    .prepare(
      `SELECT run_id, template_id, batch_id, iteration_index, status,
              parameter_snapshot, output_files, error_message, started_at, duration_ms
         FROM comfyui_runs ${whereSql}
         ORDER BY started_at DESC LIMIT ? OFFSET ?`
    )
    .all(...args, limit, offset) as Array<
    Pick<
      RunRow,
      | 'run_id'
      | 'template_id'
      | 'batch_id'
      | 'iteration_index'
      | 'status'
      | 'parameter_snapshot'
      | 'output_files'
      | 'error_message'
      | 'started_at'
      | 'duration_ms'
    >
  >;
  return rows.map((r) => ({
    runId: r.run_id,
    templateId: r.template_id,
    batchId: r.batch_id,
    iterationIndex: r.iteration_index,
    status: r.status,
    parameterSnapshot: safeParse<Record<string, unknown> | null>(r.parameter_snapshot, null),
    outputFiles: safeParse<OutputFile[] | null>(r.output_files, null),
    errorMessage: r.error_message,
    startedAt: r.started_at,
    durationMs: r.duration_ms
  }));
}

export function deleteRuns(opts: { runId?: string; batchId?: string }): number {
  if (opts.runId) {
    const r = getDb().prepare(`DELETE FROM comfyui_runs WHERE run_id = ?`).run(opts.runId);
    return r.changes;
  }
  if (opts.batchId) {
    const r = getDb().prepare(`DELETE FROM comfyui_runs WHERE batch_id = ?`).run(opts.batchId);
    return r.changes;
  }
  return 0;
}
