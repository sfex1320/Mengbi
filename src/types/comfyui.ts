/**
 * ComfyUI 通用工作流编排器 —— 跨进程共享类型。
 * 主进程（electron/services/comfyui/*、electron/ipc/comfyui*.ts）与渲染进程共用。
 * 纯类型文件，不得 import 任何运行时（electron / node）。
 *
 * 第一阶段实际用到：连接状态、API workflow、模板、运行记录、进度推送。
 * 控件/绑定/循环类型先在此定义好（后续阶段填 UI），让 DB 列与未来扩展对齐。
 */

// ───────────────────────── ComfyUI 原始 workflow ─────────────────────────

/** ComfyUI API-format 工作流：节点 id → 节点。 */
export type ComfyApiWorkflow = Record<string, ComfyApiNode>;

export interface ComfyApiNode {
  class_type: string;
  inputs: Record<string, unknown>;
  /** ComfyUI 导出时常带 _meta.title（节点标题） */
  _meta?: { title?: string };
}

/** workflow 格式判定结果 */
export type WorkflowFormat = 'api' | 'ui' | 'unknown';

// ───────────────────────── 解析后的节点图 ─────────────────────────

/** 节点的一个标量参数（非连线 input） */
export interface ParsedParam {
  name: string;
  value: unknown;
}

/** 节点间连线：from 节点的第 fromOutput 个输出 → to 节点的 toInput 端口 */
export interface ParsedEdge {
  fromNode: string;
  fromOutput: number;
  toNode: string;
  toInput: string;
}

export interface ParsedNode {
  id: string;
  classType: string;
  title?: string;
  /** 标量参数（可绑定/可改） */
  params: ParsedParam[];
  /** 来自其它节点的输入端口名（连线 input） */
  linkedInputs: string[];
  /** 该节点是否在 object_info 里找不到（自定义/缺失节点） */
  unknown: boolean;
}

export interface ParsedGraph {
  nodes: ParsedNode[];
  edges: ParsedEdge[];
}

// ───────────────────────── 连接 ─────────────────────────

export type ConnectionPhase =
  | 'disconnected' // 未连接
  | 'connecting' // 连接中
  | 'connected' // 已连接
  | 'launch-failed' // 启动失败
  | 'executing' // 执行中
  | 'queued'; // 队列中

export interface ConnectionStatus {
  phase: ConnectionPhase;
  host: string;
  reachable: boolean;
  /** mengbi 是否托管着 ComfyUI 进程（区别于用户自己起的） */
  managed: boolean;
  pid: number | null;
  version?: string;
  message?: string;
}

export interface ComfyConnectionConfig {
  host: string; // e.g. 127.0.0.1:8188（无协议头则按 http 处理）
  launchCommand: string; // e.g. run_nvidia_gpu.bat / python main.py --port 8188
  launchCwd: string; // ComfyUI 根目录
  hasAuthToken: boolean; // token 是否已设置（明文永不回传渲染进程）
}

// ───────────────────────── 输入/输出控件 + 绑定（后续阶段用） ─────────────────────────

export type InputControlKind =
  | 'text'
  | 'textarea'
  | 'number'
  | 'slider'
  | 'select'
  | 'switch'
  | 'image'
  | 'multi_image'
  | 'mask'
  | 'video'
  | 'audio'
  | 'file'
  | 'color'
  | 'size'
  | 'region'
  | 'json'
  | 'prompt'
  | 'seed';

export type OutputControlKind =
  | 'output_image'
  | 'output_video'
  | 'output_text'
  | 'output_audio'
  | 'output_file'
  | 'output_json'
  | 'output_mask';

export interface InputControl {
  id: string;
  label: string;
  type: InputControlKind;
  group?: string;
  default?: unknown;
  options?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
  step?: number;
  required?: boolean;
  visible?: boolean;
  editable?: boolean;
}

export interface OutputControl {
  id: string;
  label: string;
  type: OutputControlKind;
  source?: { nodeId: string; outputName?: string };
}

export type Binding =
  | { mode: 'parameter'; controlId: string; nodeId: string; inputName: string }
  | { mode: 'file_upload'; controlId: string; nodeId: string; inputName: string; index?: number }
  | {
      mode: 'connection';
      controlId: string;
      nodeId: string;
      inputName: string;
      sourceNodeId: string;
      sourceOutput: number;
    }
  | { mode: 'expression'; controlId?: string; targets: Array<{ nodeId: string; inputName: string; expr: string }> }
  | { mode: 'preset'; controlId: string; nodeId: string; inputName: string; map: Record<string, unknown> }
  | { mode: 'enabled_switch'; controlId: string; nodeId: string; inputName: string; whenOff?: unknown }
  | { mode: 'output'; controlId: string; nodeId: string; outputKey?: string }
  /** 忽略/绕过节点：运行时把该节点从执行图摘除，其输入直接接到下游（passthrough）。无控件。 */
  | { mode: 'bypass'; nodeId: string };

export type LoopMode = 'single' | 'range' | 'list' | 'zip' | 'cartesian' | 'formula' | 'feedback';

export interface LoopVarRange {
  controlId: string;
  kind: 'range';
  from: number;
  to: number;
  step: number;
}
export interface LoopVarList {
  controlId: string;
  kind: 'list';
  /** 逗号分隔解析后的值列表 */
  values: Array<string | number>;
}
export type LoopVar = LoopVarRange | LoopVarList;

export interface LoopFormulaItem {
  controlId: string;
  expr: string;
}

export interface LoopConfig {
  mode: LoopMode;
  /** range / list / zip / cartesian 用 */
  vars?: LoopVar[];
  /** formula 用：i(轮次)/n(总数)/prev + 安全函数 */
  formula?: { count: number; items: LoopFormulaItem[] };
  /** feedback 用：上一轮某输出回灌到某输入控件 */
  feedback?: { toControlId: string; maxIterations: number };
  continueOnFail?: boolean;
}

export interface UiLayout {
  viewport?: { x: number; y: number; zoom: number };
  nodePositions?: Record<string, { x: number; y: number }>;
  /** 参数面板卡片（按节点分组）的展示顺序，存节点 id 数组；拖动卡片标题可改 */
  cardOrder?: string[];
}

// ───────────────────────── 模板 ─────────────────────────

export interface WorkflowTemplate {
  workflowId: string;
  name: string;
  typeTags: string[];
  originalApiWorkflowJson: string;
  objectInfoSnapshot?: string | null;
  inputControls: InputControl[];
  outputControls: OutputControl[];
  bindings: Binding[];
  loopConfig: LoopConfig | null;
  uiLayout: UiLayout | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowTemplateSummary {
  workflowId: string;
  name: string;
  typeTags: string[];
  updatedAt: string;
}

// ───────────────────────── 运行记录 ─────────────────────────

export type RunStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled';

export interface OutputFile {
  controlId?: string;
  /** image / video / audio / file / text */
  kind: string;
  /** 落盘绝对路径（text 类则放在 text 字段） */
  path?: string;
  text?: string;
  nodeId: string;
}

export interface ComfyRun {
  runId: string;
  templateId: string | null;
  batchId: string | null;
  iterationIndex: number;
  promptId: string | null;
  status: RunStatus;
  inputSnapshot: Record<string, unknown> | null;
  parameterSnapshot: Record<string, unknown> | null;
  uploadedFiles: Record<string, unknown> | null;
  outputFiles: OutputFile[] | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
}

// ───────────────────────── 进度推送 payload ─────────────────────────

export interface RunProgressPayload {
  runId: string;
  batchId: string | null;
  iterationIndex: number;
  promptId: string | null;
  phase: string; // submitting / queued / executing / downloading / done
  percent: number; // 0-100（估算或来自 ws progress）
  currentNode?: string | null;
  perNode?: Record<string, { value: number; max: number }>;
  queueRemaining?: number;
}

export interface RunDonePayload {
  runId: string;
  batchId: string | null;
  iterationIndex: number;
  status: RunStatus;
  outputFiles?: OutputFile[];
  error?: string;
}

export interface QueuePayload {
  batchId: string;
  total: number;
  pending: number;
  running: number;
  done: number;
  failed: number;
  paused: boolean;
}

// ───────────────────────── IPC 入/出参（第一阶段） ─────────────────────────

export interface DetectResult {
  reachable: boolean;
  version?: string;
  message?: string;
}

export interface ImportResult {
  format: WorkflowFormat;
  graph: ParsedGraph | null;
  warnings: string[];
  /** 自动推荐的输入控件 + 绑定（非强制，用户可改） */
  recommended?: { inputControls: InputControl[]; bindings: Binding[] };
}

export interface RunSingleResult {
  runId: string;
  batchId: string;
}

export interface RunBatchResult {
  batchId: string;
  plannedCount: number;
}

/** 运行记录列表项（结果管理页用） */
export interface ComfyRunSummary {
  runId: string;
  templateId: string | null;
  batchId: string | null;
  iterationIndex: number;
  status: RunStatus;
  parameterSnapshot: Record<string, unknown> | null;
  outputFiles: OutputFile[] | null;
  errorMessage: string | null;
  startedAt: string | null;
  durationMs: number | null;
}
