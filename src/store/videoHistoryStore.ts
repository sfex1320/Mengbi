/**
 * 视频任务历史（渲染端，localStorage 持久化，FIFO 上限 100）。
 * 用 localStorage 而非 DB：避免 schema 迁移、与 notificationStore 等现有渲染端持久化一致。
 * 安全：入参里的 data:URI 大素材替换为占位（防 localStorage 爆 quota）；不存任何 API Key（Key 只在主进程 header）。
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { VideoMode, VideoTaskStatusState } from '@shared/video';

const MAX_RECORDS = 100;

export interface VideoHistoryRecord {
  taskId: string;
  providerId: string;
  providerName: string;
  modelId: string; // 显示名
  actualModelId?: string;
  mode: VideoMode;
  prompt: string;
  negativePrompt?: string;
  duration: number;
  resolution: string;
  aspectRatio: string;
  generateAudio?: boolean;
  returnLastFrame?: boolean;
  inputImages?: string[]; // data:URI 已脱量为占位
  inputVideos?: string[];
  inputAudios?: string[];
  videoUrl?: string; // 远端
  localVideoPath?: string;
  lastFrameUrl?: string;
  costNote?: string;
  status: VideoTaskStatusState;
  error?: string;
  createdAt: number;
  finishedAt?: number;
  rawResponseText?: string; // 截断
}

interface VideoHistoryState {
  records: VideoHistoryRecord[];
  add: (r: VideoHistoryRecord) => void;
  /** 更新已有任务（按 taskId）。 */
  patch: (taskId: string, patch: Partial<VideoHistoryRecord>) => void;
  remove: (taskId: string) => void;
  clear: () => void;
}

/** 把可能很大的 data:URI / 长字符串脱量，避免 localStorage 爆 quota。 */
function sanitizeAssets(urls?: string[]): string[] | undefined {
  if (!urls || !urls.length) return undefined;
  return urls.map((u) => (typeof u === 'string' && u.startsWith('data:') ? '[内联素材]' : u));
}

export function sanitizeHistoryRecord(r: VideoHistoryRecord): VideoHistoryRecord {
  return {
    ...r,
    inputImages: sanitizeAssets(r.inputImages),
    inputVideos: sanitizeAssets(r.inputVideos),
    inputAudios: sanitizeAssets(r.inputAudios),
    rawResponseText: r.rawResponseText ? r.rawResponseText.slice(0, 2000) : undefined
  };
}

export const useVideoHistoryStore = create<VideoHistoryState>()(
  persist(
    (set) => ({
      records: [],
      add: (r) =>
        set((s) => ({ records: [sanitizeHistoryRecord(r), ...s.records].slice(0, MAX_RECORDS) })),
      patch: (taskId, patch) =>
        set((s) => ({
          records: s.records.map((x) => (x.taskId === taskId ? sanitizeHistoryRecord({ ...x, ...patch }) : x))
        })),
      remove: (taskId) => set((s) => ({ records: s.records.filter((x) => x.taskId !== taskId) })),
      clear: () => set({ records: [] })
    }),
    { name: 'mengbi.videoHistory.v1' }
  )
);
