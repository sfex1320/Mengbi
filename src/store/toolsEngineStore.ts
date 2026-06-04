import { create } from 'zustand';
import type {
  UpscaleEngineStatus,
  HypirDependencyCheck,
  HypirPortableProbe,
  HypirServerStatus,
  HypirProgressPayload,
  UpscaleResultInfo
} from '@shared/ipc';

/**
 * 工具箱引擎状态缓存。
 *
 * 为什么需要：
 * - HypirPanel 每次 mount 会 spawn 子进程探测依赖，没装的话 30s 起步；
 *   切换标签时不该重新跑。
 * - RealESRGAN 引擎扫描跨切换缓存也省事。
 * - HYPIR Portable 探测 / 服务状态 / 当前任务 / 批量任务都走这里。
 *
 * 策略：
 * - 每个状态只在首次需要时拉一次；后续来回切走缓存
 * - 单飞 promise：refresh* 多个并发调用会复用同一个进行中的 promise
 * - 显式 "重新检测" 按钮可强制重拉
 */

export type HypirTaskUiStatus =
  | 'idle'
  | 'queued'
  | 'running'
  | 'done'
  | 'failed'
  | 'cancelled';

export type UpscaleIntensity = 'conservative' | 'standard' | 'strong';

export interface HypirSubmittedInput {
  inputPath: string;
  scale: number;
  tileSize: number;
  prompt: string;
  negativePrompt?: string;
  intensity: UpscaleIntensity;
  highlightProtection: boolean;
  disablePostsharpen: boolean;
  restorationDepth: number;
}

export interface HypirCurrentTask {
  taskId: string;
  status: HypirTaskUiStatus;
  percent: number;
  message: string;
  outputPath?: string;
  errorMessageZh?: string;
  errorHint?: string;
  durationSeconds?: number | null;
  resultInfo?: UpscaleResultInfo | null;
  submittedInput?: HypirSubmittedInput;
}

/** 批量任务里单张图的状态(HYPIR 用,SUPIR 已砍除) */
export interface BatchItem {
  /** 队列中的位置 0-based */
  index: number;
  inputPath: string;
  fileName: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled';
  taskId?: string;
  outputPath?: string;
  errorMessage?: string;
  durationSeconds?: number | null;
  width?: number;
  height?: number;
}

export interface BatchState {
  active: boolean;
  /** 用于取消整个批次：用户按"取消批量"，新任务不再发，当前任务调 cancelTask */
  cancelRequested: boolean;
  currentIndex: number;
  total: number;
  items: BatchItem[];
}

const EMPTY_BATCH: BatchState = {
  active: false,
  cancelRequested: false,
  currentIndex: 0,
  total: 0,
  items: []
};

interface ToolsEngineState {
  upscaleStatus: UpscaleEngineStatus | null;
  upscaleStatusLoading: boolean;
  refreshUpscaleStatus: (force?: boolean) => Promise<void>;

  // ── HYPIR Portable 状态 ──────────────────────────
  hypirPortable: HypirPortableProbe | null;
  hypirPortableLoading: boolean;
  refreshHypirPortable: (force?: boolean) => Promise<void>;

  hypirServer: HypirServerStatus | null;
  hypirServerLoading: boolean;
  refreshHypirServer: (force?: boolean) => Promise<void>;

  hypirCurrentTask: HypirCurrentTask | null;
  setHypirCurrentTask: (t: HypirCurrentTask | null) => void;
  applyHypirProgress: (p: HypirProgressPayload) => void;

  hypirBatch: BatchState;
  setHypirBatch: (next: BatchState | ((prev: BatchState) => BatchState)) => void;
  resetHypirBatch: () => void;

  // ── HYPIR 旧版"系统级"依赖探测（保留作降级） ────
  hypirCheck: HypirDependencyCheck | null;
  hypirCheckLoading: boolean;
  refreshHypirCheck: (force?: boolean) => Promise<void>;

  // SUPIR 状态字段已整体砍除(2026-05-29)
}

let upscaleInflight: Promise<void> | null = null;
let hypirCheckInflight: Promise<void> | null = null;
let hypirProbeInflight: Promise<void> | null = null;
let hypirServerInflight: Promise<void> | null = null;

export const useToolsEngineStore = create<ToolsEngineState>((set, get) => ({
  upscaleStatus: null,
  upscaleStatusLoading: false,
  refreshUpscaleStatus: async (force = false) => {
    if (!force && get().upscaleStatus) return;
    if (upscaleInflight) return upscaleInflight;
    upscaleInflight = (async () => {
      set({ upscaleStatusLoading: true });
      try {
        const r = await window.electronAPI.upscale.status();
        if (r.ok) set({ upscaleStatus: r.data });
      } finally {
        set({ upscaleStatusLoading: false });
        upscaleInflight = null;
      }
    })();
    return upscaleInflight;
  },

  // ── HYPIR Portable ─────────────────────────────────

  hypirPortable: null,
  hypirPortableLoading: false,
  refreshHypirPortable: async (force = false) => {
    if (!force && get().hypirPortable) return;
    if (hypirProbeInflight) return hypirProbeInflight;
    hypirProbeInflight = (async () => {
      set({ hypirPortableLoading: true });
      try {
        const r = await window.electronAPI.hypir.probe();
        if (r.ok) set({ hypirPortable: r.data });
      } finally {
        set({ hypirPortableLoading: false });
        hypirProbeInflight = null;
      }
    })();
    return hypirProbeInflight;
  },

  hypirServer: null,
  hypirServerLoading: false,
  refreshHypirServer: async (force = false) => {
    if (!force && get().hypirServer && get().hypirServer?.reachable) return;
    if (hypirServerInflight) return hypirServerInflight;
    hypirServerInflight = (async () => {
      set({ hypirServerLoading: true });
      try {
        const r = await window.electronAPI.hypir.serverStatus();
        if (r.ok) set({ hypirServer: r.data });
      } finally {
        set({ hypirServerLoading: false });
        hypirServerInflight = null;
      }
    })();
    return hypirServerInflight;
  },

  hypirCurrentTask: null,
  setHypirCurrentTask: (t) => set({ hypirCurrentTask: t }),
  applyHypirProgress: (p) => {
    const cur = get().hypirCurrentTask;
    if (!cur || cur.taskId !== p.taskId) return;
    set({
      hypirCurrentTask: {
        ...cur,
        status: p.status,
        percent: p.percent,
        message: p.message,
        outputPath: p.outputPath ?? cur.outputPath,
        errorMessageZh: p.errorMessageZh ?? cur.errorMessageZh,
        errorHint: p.errorHint ?? cur.errorHint,
        durationSeconds:
          p.durationSeconds !== undefined && p.durationSeconds !== null
            ? p.durationSeconds
            : cur.durationSeconds,
        resultInfo: p.resultInfo ?? cur.resultInfo ?? null
      }
    });
  },

  hypirBatch: EMPTY_BATCH,
  setHypirBatch: (next) =>
    set((s) => ({
      hypirBatch: typeof next === 'function' ? (next as (p: BatchState) => BatchState)(s.hypirBatch) : next
    })),
  resetHypirBatch: () => set({ hypirBatch: EMPTY_BATCH }),

  // ── HYPIR 系统级依赖探测（兼容） ───────────────────

  hypirCheck: null,
  hypirCheckLoading: false,
  refreshHypirCheck: async (force = false) => {
    if (!force && get().hypirCheck) return;
    if (hypirCheckInflight) return hypirCheckInflight;
    hypirCheckInflight = (async () => {
      set({ hypirCheckLoading: true });
      try {
        const r = await window.electronAPI.hypir.check({});
        if (r.ok) set({ hypirCheck: r.data });
      } finally {
        set({ hypirCheckLoading: false });
        hypirCheckInflight = null;
      }
    })();
    return hypirCheckInflight;
  },

  // SUPIR slice 已整体砍除(2026-05-29 — 显存需求过大,用户配置带不动)
}));
