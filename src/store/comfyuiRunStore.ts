/**
 * ComfyUI 编排器 —— 瞬态运行状态（连接状态、进度、队列、最近一次输出）。不持久化。
 */
import { create } from 'zustand';
import type {
  ConnectionStatus,
  RunProgressPayload,
  QueuePayload,
  OutputFile
} from '@shared/comfyui';

interface ComfyuiRunState {
  connStatus: ConnectionStatus | null;
  connecting: boolean;
  running: boolean;
  currentRunId: string | null;
  currentBatchId: string | null;
  progress: RunProgressPayload | null;
  queue: QueuePayload | null;
  outputs: OutputFile[];
  lastError: string | null;

  setConnStatus: (s: ConnectionStatus | null) => void;
  setConnecting: (b: boolean) => void;
  setRunning: (b: boolean) => void;
  startRun: (runId: string, batchId: string) => void;
  setProgress: (p: RunProgressPayload) => void;
  setQueue: (q: QueuePayload) => void;
  finishRun: (status: string, outputs?: OutputFile[], error?: string) => void;
  /** 只清输出（本会话累积的结果）；不动运行状态 */
  clearOutputs: () => void;
  reset: () => void;
}

export const useComfyuiRunStore = create<ComfyuiRunState>((set) => ({
  connStatus: null,
  connecting: false,
  running: false,
  currentRunId: null,
  currentBatchId: null,
  progress: null,
  queue: null,
  outputs: [],
  lastError: null,

  setConnStatus: (connStatus) => set({ connStatus }),
  setConnecting: (connecting) => set({ connecting }),
  setRunning: (running) => set({ running }),
  // 注意：不清 outputs——本次启动期间所有运行的输出都累积保留（直到手动清空或重启 app）
  startRun: (currentRunId, currentBatchId) =>
    set({ running: true, currentRunId, currentBatchId, progress: null, lastError: null }),
  setProgress: (progress) => set({ progress }),
  setQueue: (queue) => set({ queue }),
  // 每轮结束：累积输出（批量会有多轮），running 由队列完成时统一翻
  finishRun: (status, outputs, error) =>
    set((s) => ({
      outputs: outputs && outputs.length ? [...s.outputs, ...outputs] : s.outputs,
      lastError: status === 'failed' ? (error ?? '运行失败') : s.lastError
    })),
  clearOutputs: () => set({ outputs: [], lastError: null }),
  reset: () => set({ running: false, progress: null, outputs: [], lastError: null, queue: null })
}));
