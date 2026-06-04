import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import { localPathToImageUrl } from '@/lib/imageUrl';

/**
 * 把 localStorage 包一层防抖：500ms 内只把最后一次值写盘，避免拖滑块时
 * 每帧 setItem（同步、序列化大对象）冻结主线程造成全局卡顿。
 */
function debouncedLocalStorage(): StateStorage {
  type Pending = { name: string; value: string };
  const queue = new Map<string, Pending>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  function flush(): void {
    for (const [name, p] of queue) {
      try {
        localStorage.setItem(name, p.value);
      } catch (e) {
        // localStorage 满 / 关闭 — 忽略
        console.warn('[canvas persist] setItem failed', name, e);
      }
    }
    queue.clear();
    timer = null;
  }
  return {
    getItem: (name) => localStorage.getItem(name),
    setItem: (name, value) => {
      queue.set(name, { name, value });
      if (timer === null) {
        timer = setTimeout(flush, 500);
      }
    },
    removeItem: (name) => {
      queue.delete(name);
      try {
        localStorage.removeItem(name);
      } catch {
        /* ignore */
      }
    }
  };
}
import {
  type CanvasProject,
  type Layer,
  type BlendMode,
  type PerspectiveCorners,
  type CropRect,
  type BrushStroke,
  cryptoRandomId,
  makeEmptyProject,
  makeGroupLayer,
  makeBrushLayer
} from '@/pages/Canvas/types';

/**
 * 画板模块的全局状态。v1 只保留"当前唯一工程"，下次启动自动恢复。
 *
 * 注意：
 *   - cookedDataUri 不持久化（抠图 / 透视后的图，可能是 MB 级 dataUri，会爆 localStorage quota）
 *     重新打开时如果用户当时还没另存，cooked 结果会丢失，回退到 sourcePath
 *   - 撤销栈完全在内存（useRef），不持久化
 */

interface CanvasState {
  project: CanvasProject;

  // 工程级
  setProjectMeta: (patch: Partial<Pick<CanvasProject, 'name' | 'width' | 'height' | 'background'>>) => void;
  resetProject: () => void;
  loadProject: (p: CanvasProject) => void;
  /**
   * 扩图：把画板扩到 newWidth×newHeight，所有图层整体平移 (offsetX, offsetY)，
   * 原图内容保持在原视觉位置，新增区域为空（透明）。
   */
  expandCanvas: (offsetX: number, offsetY: number, newWidth: number, newHeight: number) => void;
  /**
   * 画布贴合图层：把画布尺寸 1:1 改成选中图层的渲染尺寸（width×|scaleX| 等），
   * 并整体平移所有图层让该图层落到 (0,0)。maxSize 上限钳制。
   */
  fitCanvasToLayer: (layerId: string, maxSize: number) => void;

  // 选择（B1）
  selectLayer: (id: string | null) => void;
  toggleLayerInSelection: (id: string) => void;
  selectAllLayers: () => void;

  // 图层增删改
  addLayer: (layer: Layer) => void;
  removeLayer: (id: string) => void;
  removeLayers: (ids: string[]) => void;
  duplicateLayer: (id: string) => void;
  updateLayer: (id: string, patch: Partial<Layer>) => void;
  /** B3：换原图来源，保留 transform / crop / blend；width/height 用新图尺寸覆盖 */
  replaceLayerSource: (id: string, src: { sourcePath: string | null; cookedDataUri: string | null; width: number; height: number }) => void;

  // ─── 笔刷图层（C4c） ───
  createBrushLayer: (name?: string) => string;
  appendStroke: (layerId: string, stroke: BrushStroke) => void;
  clearStrokes: (layerId: string) => void;
  popLastStroke: (layerId: string) => void;

  // ─── 蒙版（C1） ───
  appendMaskStroke: (layerId: string, stroke: BrushStroke) => void;
  clearMask: (layerId: string) => void;
  enableMask: (layerId: string) => void;

  /**
   * 合并图层：移除 ids，把一张已合成好的整画板图（dataUri）作为单个图像图层插回
   * 到这些图层原本最低的 z 位置。
   */
  mergeLayersWithImage: (ids: string[], dataUri: string, name?: string) => void;

  // ─── B2 图层组 ───
  /** 新建一个空组（顶级） */
  createGroup: (name?: string) => string;
  /** 把图层 id 设为某个组的子项（parentId = 组 id 或 null） */
  setLayerParent: (id: string, parentId: string | null) => void;
  /** 切换组折叠状态 */
  toggleGroupCollapsed: (groupId: string) => void;
  /** 把当前选中的图层组合到一个新组 */
  groupSelectedLayers: (name?: string) => void;
  /** 解散组：把组内所有 child 的 parentId 设为 null，然后删除组本身 */
  ungroupLayer: (groupId: string) => void;

  // 层级
  reorderLayers: (fromIndex: number, toIndex: number) => void;
  bringToFront: (id: string) => void;
  sendToBack: (id: string) => void;
  bringForward: (id: string) => void;
  sendBackward: (id: string) => void;

  // 翻转
  flipHorizontal: (id: string) => void;
  flipVertical: (id: string) => void;

  // 透视 / 裁切 / cooked
  setPerspective: (id: string, corners: PerspectiveCorners | null) => void;
  setCrop: (id: string, crop: CropRect | null) => void;
  setCooked: (id: string, dataUri: string | null) => void;

  // 工具：当前选中图层
  getSelected: () => Layer | null;
}

function touch(p: CanvasProject): CanvasProject {
  return { ...p, updatedAt: new Date().toISOString() };
}

function mapLayer(p: CanvasProject, id: string, fn: (l: Layer) => Layer): CanvasProject {
  return touch({ ...p, layers: p.layers.map((l) => (l.id === id ? fn(l) : l)) });
}

/** 收集 id 自身 + 所有子孙图层 id（用于删除组时连带删除 children） */
function collectDescendants(layers: Layer[], id: string): Set<string> {
  const out = new Set<string>([id]);
  // 简单 BFS：可能多层嵌套
  let changed = true;
  while (changed) {
    changed = false;
    for (const l of layers) {
      if (l.parentId && out.has(l.parentId) && !out.has(l.id)) {
        out.add(l.id);
        changed = true;
      }
    }
  }
  return out;
}

/** 给定图层 id，向上查找祖先链（含自身）的可见性 / 锁定状态 */
export function isEffectivelyVisible(layers: Layer[], id: string): boolean {
  let cur: Layer | undefined = layers.find((l) => l.id === id);
  while (cur) {
    if (!cur.visible) return false;
    if (!cur.parentId) break;
    cur = layers.find((l) => l.id === cur!.parentId);
  }
  return true;
}

export function isEffectivelyLocked(layers: Layer[], id: string): boolean {
  let cur: Layer | undefined = layers.find((l) => l.id === id);
  while (cur) {
    if (cur.locked) return true;
    if (!cur.parentId) break;
    cur = layers.find((l) => l.id === cur!.parentId);
  }
  return false;
}

export const useCanvasStore = create<CanvasState>()(
  persist(
    (set, get) => ({
      project: makeEmptyProject(),

      setProjectMeta: (patch) =>
        set((s) => ({ project: touch({ ...s.project, ...patch }) })),

      resetProject: () => set({ project: makeEmptyProject() }),

      loadProject: (p) => set({ project: p }),

      fitCanvasToLayer: (layerId, maxSize) =>
        set((s) => {
          const l = s.project.layers.find((x) => x.id === layerId);
          if (!l || l.isGroup) return s;
          const rw = Math.max(64, Math.min(maxSize, Math.round(Math.abs(l.width * l.scaleX))));
          const rh = Math.max(64, Math.min(maxSize, Math.round(Math.abs(l.height * l.scaleY))));
          const dx = -l.x;
          const dy = -l.y;
          return {
            project: touch({
              ...s.project,
              width: rw,
              height: rh,
              layers: s.project.layers.map((L) => ({ ...L, x: L.x + dx, y: L.y + dy }))
            })
          };
        }),

      expandCanvas: (offsetX, offsetY, newWidth, newHeight) =>
        set((s) => ({
          project: touch({
            ...s.project,
            width: newWidth,
            height: newHeight,
            // 所有图层整体平移；组容器 x/y 不参与渲染，平移无副作用
            layers: s.project.layers.map((l) => ({
              ...l,
              x: l.x + offsetX,
              y: l.y + offsetY
            }))
          })
        })),

      selectLayer: (id) =>
        set((s) => ({
          project: { ...s.project, selectedId: id, selectedIds: id ? [id] : [] }
        })),

      toggleLayerInSelection: (id) =>
        set((s) => {
          const cur = s.project.selectedIds ?? [];
          const has = cur.includes(id);
          const nextIds = has ? cur.filter((x) => x !== id) : [...cur, id];
          const nextPrimary = has
            ? nextIds[nextIds.length - 1] ?? null
            : id;
          return {
            project: { ...s.project, selectedId: nextPrimary, selectedIds: nextIds }
          };
        }),

      selectAllLayers: () =>
        set((s) => {
          const ids = s.project.layers.map((l) => l.id);
          return {
            project: {
              ...s.project,
              selectedIds: ids,
              selectedId: ids[ids.length - 1] ?? null
            }
          };
        }),

      addLayer: (layer) =>
        set((s) => ({
          project: touch({
            ...s.project,
            layers: [...s.project.layers, layer],
            selectedId: layer.id,
            selectedIds: [layer.id]
          })
        })),

      removeLayer: (id) =>
        set((s) => {
          const idx = s.project.layers.findIndex((l) => l.id === id);
          // 如果是组，递归删除子项
          const toRemove = collectDescendants(s.project.layers, id);
          const layers = s.project.layers.filter((l) => !toRemove.has(l.id));
          const nextSel =
            s.project.selectedId === id || toRemove.has(s.project.selectedId ?? '')
              ? layers[Math.max(0, idx - 1)]?.id ?? null
              : s.project.selectedId;
          return {
            project: touch({
              ...s.project,
              layers,
              selectedId: nextSel,
              selectedIds: nextSel ? [nextSel] : []
            })
          };
        }),

      removeLayers: (ids) =>
        set((s) => {
          const toRemove = new Set<string>();
          for (const id of ids) {
            for (const d of collectDescendants(s.project.layers, id)) toRemove.add(d);
          }
          const layers = s.project.layers.filter((l) => !toRemove.has(l.id));
          return {
            project: touch({
              ...s.project,
              layers,
              selectedId: null,
              selectedIds: []
            })
          };
        }),

      replaceLayerSource: (id, src) =>
        set((s) => ({
          project: mapLayer(s.project, id, (l) => ({
            ...l,
            sourcePath: src.sourcePath,
            cookedDataUri: src.cookedDataUri,
            width: src.width,
            height: src.height,
            // 抠图 / 裁切 / 透视都建立在原图之上，换图之后失效
            crop: null,
            perspective: null
          }))
        })),

      duplicateLayer: (id) =>
        set((s) => {
          const idx = s.project.layers.findIndex((l) => l.id === id);
          if (idx < 0) return s;
          const orig = s.project.layers[idx];
          const copy: Layer = {
            ...orig,
            id: cryptoRandomId(),
            name: `${orig.name} 副本`,
            x: orig.x + 24,
            y: orig.y + 24
          };
          const layers = [...s.project.layers];
          layers.splice(idx + 1, 0, copy);
          return { project: touch({ ...s.project, layers, selectedId: copy.id }) };
        }),

      updateLayer: (id, patch) =>
        set((s) => ({ project: mapLayer(s.project, id, (l) => ({ ...l, ...patch })) })),

      reorderLayers: (fromIndex, toIndex) =>
        set((s) => {
          if (fromIndex === toIndex) return s;
          const layers = [...s.project.layers];
          const [item] = layers.splice(fromIndex, 1);
          layers.splice(toIndex, 0, item);
          return { project: touch({ ...s.project, layers }) };
        }),

      bringToFront: (id) =>
        set((s) => {
          const idx = s.project.layers.findIndex((l) => l.id === id);
          if (idx < 0 || idx === s.project.layers.length - 1) return s;
          const layers = [...s.project.layers];
          const [item] = layers.splice(idx, 1);
          layers.push(item);
          return { project: touch({ ...s.project, layers }) };
        }),

      sendToBack: (id) =>
        set((s) => {
          const idx = s.project.layers.findIndex((l) => l.id === id);
          if (idx <= 0) return s;
          const layers = [...s.project.layers];
          const [item] = layers.splice(idx, 1);
          layers.unshift(item);
          return { project: touch({ ...s.project, layers }) };
        }),

      bringForward: (id) =>
        set((s) => {
          const idx = s.project.layers.findIndex((l) => l.id === id);
          if (idx < 0 || idx === s.project.layers.length - 1) return s;
          const layers = [...s.project.layers];
          [layers[idx], layers[idx + 1]] = [layers[idx + 1], layers[idx]];
          return { project: touch({ ...s.project, layers }) };
        }),

      sendBackward: (id) =>
        set((s) => {
          const idx = s.project.layers.findIndex((l) => l.id === id);
          if (idx <= 0) return s;
          const layers = [...s.project.layers];
          [layers[idx], layers[idx - 1]] = [layers[idx - 1], layers[idx]];
          return { project: touch({ ...s.project, layers }) };
        }),

      flipHorizontal: (id) =>
        set((s) => ({
          project: mapLayer(s.project, id, (l) => ({ ...l, scaleX: -l.scaleX }))
        })),

      flipVertical: (id) =>
        set((s) => ({
          project: mapLayer(s.project, id, (l) => ({ ...l, scaleY: -l.scaleY }))
        })),

      setPerspective: (id, corners) =>
        set((s) => ({ project: mapLayer(s.project, id, (l) => ({ ...l, perspective: corners })) })),

      setCrop: (id, crop) =>
        set((s) => ({ project: mapLayer(s.project, id, (l) => ({ ...l, crop })) })),

      setCooked: (id, dataUri) =>
        set((s) => ({ project: mapLayer(s.project, id, (l) => ({ ...l, cookedDataUri: dataUri })) })),

      getSelected: () => {
        const s = get();
        return s.project.layers.find((l) => l.id === s.project.selectedId) ?? null;
      },

      // ─── 笔刷图层（C4c） ───
      createBrushLayer: (name) => {
        const project = get().project;
        const bl = makeBrushLayer(project.width, project.height, name ?? '笔刷');
        set((s) => ({
          project: touch({
            ...s.project,
            layers: [...s.project.layers, bl],
            selectedId: bl.id,
            selectedIds: [bl.id]
          })
        }));
        return bl.id;
      },

      appendStroke: (layerId, stroke) =>
        set((s) => ({
          project: mapLayer(s.project, layerId, (l) => ({
            ...l,
            strokes: [...(l.strokes ?? []), stroke]
          }))
        })),

      clearStrokes: (layerId) =>
        set((s) => ({
          project: mapLayer(s.project, layerId, (l) => ({ ...l, strokes: [] }))
        })),

      popLastStroke: (layerId) =>
        set((s) => ({
          project: mapLayer(s.project, layerId, (l) => ({
            ...l,
            strokes: (l.strokes ?? []).slice(0, -1)
          }))
        })),

      // ─── 蒙版（C1） ───
      enableMask: (layerId) =>
        set((s) => ({
          project: mapLayer(s.project, layerId, (l) =>
            l.maskStrokes ? l : { ...l, maskStrokes: [] }
          )
        })),

      appendMaskStroke: (layerId, stroke) =>
        set((s) => ({
          project: mapLayer(s.project, layerId, (l) => ({
            ...l,
            maskStrokes: [...(l.maskStrokes ?? []), stroke]
          }))
        })),

      clearMask: (layerId) =>
        set((s) => ({
          project: mapLayer(s.project, layerId, (l) => ({ ...l, maskStrokes: undefined }))
        })),

      mergeLayersWithImage: (ids, dataUri, name) =>
        set((s) => {
          const idsSet = new Set(ids);
          const indices = s.project.layers
            .map((l, i) => (idsSet.has(l.id) ? i : -1))
            .filter((i) => i >= 0);
          if (indices.length === 0) return s;
          const insertAt = Math.min(...indices);
          const merged: Layer = {
            id: cryptoRandomId(),
            name: name ?? '合并图层',
            sourcePath: null,
            cookedDataUri: dataUri,
            width: s.project.width,
            height: s.project.height,
            visible: true,
            locked: false,
            opacity: 1,
            blendMode: 'source-over',
            x: 0,
            y: 0,
            scaleX: 1,
            scaleY: 1,
            rotation: 0,
            skewX: 0,
            skewY: 0,
            perspective: null,
            crop: null,
            parentId: null
          };
          const remaining = s.project.layers.filter((l) => !idsSet.has(l.id));
          // insertAt 是在原数组里的下标；移除后用“被移除的、小于 insertAt 的数量”修正
          const removedBelow = indices.filter((i) => i < insertAt).length;
          const realInsert = insertAt - removedBelow;
          remaining.splice(realInsert, 0, merged);
          return {
            project: touch({
              ...s.project,
              layers: remaining,
              selectedId: merged.id,
              selectedIds: [merged.id]
            })
          };
        }),

      // ─── B2 图层组 ───
      createGroup: (name) => {
        const g = makeGroupLayer(name ?? '组');
        set((s) => ({
          project: touch({
            ...s.project,
            layers: [...s.project.layers, g],
            selectedId: g.id,
            selectedIds: [g.id]
          })
        }));
        return g.id;
      },

      setLayerParent: (id, parentId) =>
        set((s) => ({
          project: mapLayer(s.project, id, (l) => ({ ...l, parentId: parentId ?? null }))
        })),

      toggleGroupCollapsed: (groupId) =>
        set((s) => ({
          project: mapLayer(s.project, groupId, (l) => ({ ...l, collapsed: !l.collapsed }))
        })),

      groupSelectedLayers: (name) =>
        set((s) => {
          const sel = s.project.selectedIds ?? [];
          if (sel.length === 0) return s;
          const g = makeGroupLayer(name ?? '组');
          // 把组插在选中图层中"最高"的位置（最大 index 之后）
          const indices = sel.map((id) => s.project.layers.findIndex((l) => l.id === id)).filter((x) => x >= 0);
          const insertAt = Math.max(...indices) + 1;
          const layers = s.project.layers.map((l) =>
            sel.includes(l.id) ? { ...l, parentId: g.id } : l
          );
          layers.splice(insertAt, 0, g);
          return {
            project: touch({
              ...s.project,
              layers,
              selectedId: g.id,
              selectedIds: [g.id]
            })
          };
        }),

      ungroupLayer: (groupId) =>
        set((s) => {
          const layers = s.project.layers
            .map((l) => (l.parentId === groupId ? { ...l, parentId: null } : l))
            .filter((l) => l.id !== groupId);
          return {
            project: touch({
              ...s.project,
              layers,
              selectedId: null,
              selectedIds: []
            })
          };
        })
    }),
    {
      name: 'mengbi-canvas',
      storage: createJSONStorage(() => debouncedLocalStorage()),
      // cookedDataUri 体积大、可能 MB 级，单独剔除；其它字段都可持久化
      partialize: (state) => ({
        project: {
          ...state.project,
          layers: state.project.layers.map((l) => ({ ...l, cookedDataUri: null }))
        }
      }),
      // 反序列化后再补一遍：确保所有 cooked 都是 null（防止旧版本数据残留）
      merge: (persisted, current) => {
        const p = persisted as { project?: CanvasProject } | undefined;
        if (!p?.project) return current;
        return {
          ...current,
          project: {
            ...p.project,
            layers: p.project.layers.map((l) => ({ ...l, cookedDataUri: null }))
          }
        };
      }
    }
  )
);

// 工具函数：渲染端使用的"图层显示用 src"，优先 cooked，再 sourcePath
// 注意:sourcePath 是 pseudo（:开头）时不能走 mengbi-image:// 协议——那是个磁盘协议,
// 给它一个假路径会 404,渲染端拿到空白。这种情况下只能靠 cookedDataUri 撑住。
export function layerDisplaySrc(l: Layer): string | null {
  if (l.cookedDataUri) return l.cookedDataUri;
  if (l.sourcePath && !isPseudoPath(l.sourcePath)) {
    return localPathToImageUrl(l.sourcePath);
  }
  return null;
}

/** 用于"假路径"判断：源自画板自己的合成（无真实磁盘） */
export function isPseudoPath(p: string | null): boolean {
  return !!p && p.startsWith(':');
}

/** 给定 width/height 创建一个新的图层雏形 */
export function makeLayerFromImage(opts: {
  name: string;
  sourcePath: string | null;
  cookedDataUri?: string | null;
  width: number;
  height: number;
  /** 画板尺寸，用来居中放置 */
  canvasWidth: number;
  canvasHeight: number;
}): Layer {
  const fit = Math.min(1, opts.canvasWidth / opts.width, opts.canvasHeight / opts.height);
  const w = opts.width * fit;
  const h = opts.height * fit;
  return {
    id: cryptoRandomId(),
    name: opts.name,
    sourcePath: opts.sourcePath,
    cookedDataUri: opts.cookedDataUri ?? null,
    width: opts.width,
    height: opts.height,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'source-over' as BlendMode,
    x: (opts.canvasWidth - w) / 2,
    y: (opts.canvasHeight - h) / 2,
    scaleX: fit,
    scaleY: fit,
    rotation: 0,
    skewX: 0,
    skewY: 0,
    perspective: null,
    crop: null
  };
}
