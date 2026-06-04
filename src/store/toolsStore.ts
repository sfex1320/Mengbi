import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/**
 * 工具箱本地状态：
 *
 * - activeTab：当前激活的子工具（**持久化**）
 *   * 'upscale'   = Real-ESRGAN ncnn Vulkan（保真放大模式，默认）
 *   * 'hypir'     = HYPIR（AI 高质量修复放大，需 Python+CUDA 环境，独立后端）
 *   * 'vectorize' = 图像转矢量(VTracer / Potrace)
 *   * SUPIR 已于 2026-05-29 整体砍除(显存需求过大)
 * - pendingImport：跨页面跳转过来时把要处理的图带过来（生图右键 → 工具箱）
 * - inputDataUri：当前已加载的输入图（不持久化——重启丢失符合预期）
 * - batchInputs：批量输入文件路径数组（不持久化）
 * - lastUpscale：最近一次的放大结果。
 *   **不持久化**——4K 放大产出 base64 体积可至 30MB+，
 *   塞进 localStorage 会撑爆 5MB 配额（CLAUDE.md 铁律 14 同源原则）。
 *   切页面再切回来仍在（Zustand 内存 store 还活着），只有应用重启丢失。
 *   用户若想长久留存，请显式调"保存"按钮。
 */

export type ToolsTab = 'upscale' | 'hypir' | 'vectorize';

export interface UpscaleResultSnapshot {
  /** 输出 dataUri（前端预览 + 右键复制/另存为/入库用） */
  outputDataUri: string;
  /** 输出文件落盘绝对路径 */
  outputPath: string;
  /** 单图模式才有：与原图的尺寸对照 */
  inputW: number;
  inputH: number;
  outputW: number;
  outputH: number;
  /** 使用的引擎名（用于标签 + 入库时 source_model 字段） */
  engineLabel: string;
  /** 使用的模型名（如 'realesrgan-x4plus-anime'） */
  modelName: string;
  /** 倍率 */
  scale: number;
  /** 耗时 */
  elapsedMs: number;
  ts: number;
}

// VectorizeResultSnapshot 已随矢量化功能整体移除，待重做

interface ToolsState {
  activeTab: ToolsTab;
  pendingImport: string | null;
  inputDataUri: string | null;
  /** 批量输入：本地文件绝对路径列表（不持久化） */
  batchInputs: string[];
  lastUpscale: UpscaleResultSnapshot | null;

  setActiveTab: (t: ToolsTab) => void;
  setPendingImport: (s: string | null) => void;
  setInputDataUri: (s: string | null) => void;
  setBatchInputs: (paths: string[]) => void;
  consumePendingImport: () => string | null;
  setLastUpscale: (v: UpscaleResultSnapshot | null) => void;
}

export const useToolsStore = create<ToolsState>()(
  persist(
    (set, get) => ({
      activeTab: 'upscale',
      pendingImport: null,
      inputDataUri: null,
      batchInputs: [],
      lastUpscale: null,

      setActiveTab: (t) => set({ activeTab: t }),
      setPendingImport: (s) => set({ pendingImport: s }),
      setInputDataUri: (s) => set({ inputDataUri: s }),
      setBatchInputs: (paths) => set({ batchInputs: paths }),
      consumePendingImport: () => {
        const cur = get().pendingImport;
        if (cur) set({ pendingImport: null, inputDataUri: cur });
        return cur;
      },
      setLastUpscale: (v) => set({ lastUpscale: v })
    }),
    {
      name: 'mengbi-tools',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        activeTab: state.activeTab
      })
    }
  )
);
