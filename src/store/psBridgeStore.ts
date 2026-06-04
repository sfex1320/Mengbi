import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/**
 * 画板 ↔ Photoshop 联动桥的渲染端状态。
 *
 * 两类数据：
 *   - 服务端镜像（photoshopPath / tempDir / keepTemp）：真值在主进程 settings 表，
 *     这里只缓存最近一次 api:ps:status 的结果，方便 UI 即时渲染；改动走 api:ps:set-config。
 *   - 纯渲染端偏好（reimportMode / autoReimport）：持久化到 localStorage。
 *
 * `lastTempPath` 是最近一次「发送到 PS」写出的临时文件，从 PS 导入时默认读它。
 */

export type ReimportMode = 'new-layer' | 'replace' | 'new-canvas';

interface PsBridgeState {
  // 服务端镜像
  photoshopPath: string;
  photoshopPathExists: boolean;
  tempDir: string;
  keepTemp: boolean;
  watching: string[];
  // 渲染端偏好
  reimportMode: ReimportMode;
  /** true = 检测到保存直接导回；false = 先弹确认 */
  autoReimport: boolean;
  /** 最近一次发送到 PS 的临时文件 */
  lastTempPath: string | null;

  setStatus: (s: {
    photoshopPath: string;
    photoshopPathExists: boolean;
    tempDir: string;
    keepTemp: boolean;
    watching: string[];
  }) => void;
  setReimportMode: (m: ReimportMode) => void;
  setAutoReimport: (b: boolean) => void;
  setLastTempPath: (p: string | null) => void;
}

export const usePsBridgeStore = create<PsBridgeState>()(
  persist(
    (set) => ({
      photoshopPath: '',
      photoshopPathExists: false,
      tempDir: '',
      keepTemp: false,
      watching: [],
      reimportMode: 'new-layer',
      autoReimport: false,
      lastTempPath: null,

      setStatus: (s) =>
        set({
          photoshopPath: s.photoshopPath,
          photoshopPathExists: s.photoshopPathExists,
          tempDir: s.tempDir,
          keepTemp: s.keepTemp,
          watching: s.watching
        }),
      setReimportMode: (m) => set({ reimportMode: m }),
      setAutoReimport: (b) => set({ autoReimport: b }),
      setLastTempPath: (p) => set({ lastTempPath: p })
    }),
    {
      name: 'mengbi-ps-bridge',
      storage: createJSONStorage(() => localStorage),
      // 只持久化纯渲染端偏好；服务端镜像每次启动重新拉
      partialize: (s) => ({
        reimportMode: s.reimportMode,
        autoReimport: s.autoReimport
      })
    }
  )
);
