import { create } from 'zustand';

/**
 * App 级资产库缓存：避免每次切回资产库都重拉、空等 2-3 秒（铁律17：数据与页面解耦）。
 * Manager 整页随路由 unmount，本 store 在 App 级常驻——切回时先显缓存（瞬开），再后台刷新。
 * 按相册 id 缓存列表（'all'=全部）；启动预加载「全部」，gallery:changed 时后台刷新。
 * 这里只缓存「服务端按相册返回的原始列表」；搜索/日期/模型/比例/类型 等筛选 Manager 仍在客户端做。
 */
interface GalleryCacheState {
  /** key: 'all' 或相册 id 字符串 → 该相册的图片行（原始，未客户端筛选） */
  cache: Record<string, unknown[]>;
  loaded: boolean;
  getCached: (albumId: number | null) => unknown[] | undefined;
  setCached: (albumId: number | null, rows: unknown[]) => void;
  /** 拉取「全部」列表填缓存（启动 + gallery:changed 后台刷新；失败静默，Manager 打开时会自拉）。 */
  preload: () => Promise<void>;
  clear: () => void;
}

const keyOf = (albumId: number | null): string => (albumId == null ? 'all' : String(albumId));

export const useGalleryStore = create<GalleryCacheState>((set, get) => ({
  cache: {},
  loaded: false,
  getCached: (albumId) => get().cache[keyOf(albumId)],
  setCached: (albumId, rows) => set((s) => ({ cache: { ...s.cache, [keyOf(albumId)]: rows }, loaded: true })),
  preload: async () => {
    try {
      const r = await window.electronAPI.gallery.list({ album_id: undefined });
      if (r.ok) set((s) => ({ cache: { ...s.cache, all: r.data as unknown[] }, loaded: true }));
    } catch {
      /* 预加载失败静默 */
    }
  },
  clear: () => set({ cache: {}, loaded: false })
}));
