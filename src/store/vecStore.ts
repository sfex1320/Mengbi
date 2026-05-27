/**
 * 图像转矢量本地状态(v3 重构,2026-05-27) —— UI 选项 + 进度任务表。
 *
 * 主进程的 batchQueue 是 source of truth;前端只缓存"我看到的任务进度"。
 * 不持久化:任务列表是会话级别,刷新就重来。
 *
 * v3 新增:
 *   - 5 模式选择(experimental 默认隐藏,由 showExperimental 控制)
 *   - 任务记录 requestedMode + actualEngine + fellBack + qualityScore + reportDir
 *   - 批次记录 fellBackCount
 *   - 拖入图片后的 lastImageHint(图像类型检测结果)
 */
import { create } from 'zustand';
import type {
  VecMode,
  VecBatchStatus,
  VecTaskStatus,
  VecTaskProgressPayload,
  VecBatchProgressPayload,
  ImageTypeDetection
} from '@/types/ipc';

export interface VecBatchView {
  batchId: string;
  requestedMode: VecMode;
  status: VecBatchStatus;
  total: number;
  pending: number;
  running: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  fellBackCount: number;
  etaSeconds: number | null;
  avgPerTaskMs: number | null;
  createdAt: number;
}

export interface VecTaskView {
  taskId: string;
  batchId: string;
  requestedMode: VecMode;
  actualEngine: VecMode | null;
  fellBack: boolean;
  fallbackReason: string | null;
  inputPath: string;
  status: VecTaskStatus;
  progress: number;
  message: string;
  outputPath: string | null;
  durationMs: number | null;
  qualityScore: number | null;
  errorMessageZh: string | null;
  errorHint: string | null;
  errorTag: string | null;
  reportDir: string | null;
}

interface VecState {
  selectedMode: VecMode;
  /** 每个模式的可用性(由 probe 异步填充) */
  modeAvailability: Partial<Record<VecMode, boolean>>;
  pendingInputs: string[];
  outputDir: string;
  naming: 'original' | 'suffix';
  onConflict: 'overwrite' | 'skip' | 'rename';
  tasks: Map<string, VecTaskView>;
  batches: Map<string, VecBatchView>;
  selectedTaskId: string | null;
  /** 最近一次图片类型检测结果(BatchDropzone 拖入时填) */
  lastImageHint: ImageTypeDetection | null;

  setSelectedMode: (m: VecMode) => void;
  setModeAvailability: (mode: VecMode, available: boolean) => void;
  setPendingInputs: (paths: string[]) => void;
  addPendingInputs: (paths: string[]) => void;
  clearPendingInputs: () => void;
  setOutputDir: (p: string) => void;
  setNaming: (n: 'original' | 'suffix') => void;
  setOnConflict: (c: 'overwrite' | 'skip' | 'rename') => void;
  setSelectedTaskId: (id: string | null) => void;
  setLastImageHint: (h: ImageTypeDetection | null) => void;

  registerBatch: (batchId: string, mode: VecMode, taskIds: string[], total: number) => void;
  applyTaskProgress: (p: VecTaskProgressPayload, inputPath?: string) => void;
  applyBatchProgress: (p: VecBatchProgressPayload) => void;
  removeBatch: (batchId: string) => void;
  reset: () => void;
}

export const useVecStore = create<VecState>((set, get) => ({
  selectedMode: 'vtracer',
  modeAvailability: { vtracer: true, potrace: true },
  pendingInputs: [],
  outputDir: '',
  naming: 'original',
  onConflict: 'rename',
  tasks: new Map(),
  batches: new Map(),
  selectedTaskId: null,
  lastImageHint: null,

  setSelectedMode: (m) => set({ selectedMode: m }),
  setModeAvailability: (mode, available) =>
    set((s) => ({ modeAvailability: { ...s.modeAvailability, [mode]: available } })),
  setPendingInputs: (paths) => set({ pendingInputs: paths }),
  addPendingInputs: (paths) =>
    set((s) => ({ pendingInputs: [...new Set([...s.pendingInputs, ...paths])] })),
  clearPendingInputs: () => set({ pendingInputs: [] }),
  setOutputDir: (p) => set({ outputDir: p }),
  setNaming: (n) => set({ naming: n }),
  setOnConflict: (c) => set({ onConflict: c }),
  setSelectedTaskId: (id) => set({ selectedTaskId: id }),
  setLastImageHint: (h) => set({ lastImageHint: h }),

  registerBatch: (batchId, mode, taskIds, total) => {
    const tasks = new Map(get().tasks);
    const batches = new Map(get().batches);
    const inputs = get().pendingInputs;
    taskIds.forEach((tid, i) => {
      tasks.set(tid, {
        taskId: tid,
        batchId,
        requestedMode: mode,
        actualEngine: null,
        fellBack: false,
        fallbackReason: null,
        inputPath: inputs[i] ?? '',
        status: 'pending',
        progress: 0,
        message: '排队中',
        outputPath: null,
        durationMs: null,
        qualityScore: null,
        errorMessageZh: null,
        errorHint: null,
        errorTag: null,
        reportDir: null
      });
    });
    batches.set(batchId, {
      batchId,
      requestedMode: mode,
      status: 'running',
      total,
      pending: total,
      running: 0,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
      fellBackCount: 0,
      etaSeconds: null,
      avgPerTaskMs: null,
      createdAt: Date.now()
    });
    set({ tasks, batches });
  },

  applyTaskProgress: (p, inputPath) => {
    const tasks = new Map(get().tasks);
    const prev = tasks.get(p.taskId);
    tasks.set(p.taskId, {
      taskId: p.taskId,
      batchId: p.batchId,
      requestedMode: p.requestedMode,
      actualEngine: p.actualEngine,
      fellBack: p.fellBack,
      fallbackReason: p.fallbackReason,
      inputPath: prev?.inputPath ?? inputPath ?? '',
      status: p.status,
      progress: p.progress,
      message: p.message,
      outputPath: p.outputPath,
      durationMs: p.durationMs,
      qualityScore: p.qualityScore,
      errorMessageZh: p.errorMessageZh,
      errorHint: p.errorHint,
      errorTag: p.errorTag,
      reportDir: p.reportDir
    });
    set({ tasks });
  },

  applyBatchProgress: (p) => {
    const batches = new Map(get().batches);
    const prev = batches.get(p.batchId);
    batches.set(p.batchId, {
      batchId: p.batchId,
      requestedMode: p.requestedMode,
      status: p.status,
      total: p.total,
      pending: p.pending,
      running: p.running,
      succeeded: p.succeeded,
      failed: p.failed,
      cancelled: p.cancelled,
      fellBackCount: p.fellBackCount,
      etaSeconds: p.etaSeconds,
      avgPerTaskMs: p.avgPerTaskMs,
      createdAt: prev?.createdAt ?? Date.now()
    });
    set({ batches });
  },

  removeBatch: (batchId) => {
    const tasks = new Map(get().tasks);
    const batches = new Map(get().batches);
    batches.delete(batchId);
    for (const [tid, t] of tasks) {
      if (t.batchId === batchId) tasks.delete(tid);
    }
    set({ tasks, batches });
  },

  reset: () => set({ tasks: new Map(), batches: new Map(), selectedTaskId: null })
}));
