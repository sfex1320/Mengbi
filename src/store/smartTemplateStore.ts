/**
 * 智能画布「节点模板」（2026-06-22 改为文件存储）：把选中的若干节点 + 其内部连线存为命名模板，
 * 之后可一键插入到任意画布（跨文档复用常用节点组合 / 整套工具流）。
 *
 * 存储位置由 localStorage 迁到「软件配置文件夹」userData/node-templates/（每模板一个 .json，
 * 走 api:template:* IPC）——可在设置页「一键打开配置文件夹」查看 / 备份 / 分享单个模板。
 * 首次加载时自动把旧 localStorage `mengbi.smartCanvas.templates.v1` 里的模板迁移到磁盘（只迁一次）。
 *
 * 模板内容是节点/连线的深拷贝快照；插入时由 store 重映射 id + 偏移（见 smartCanvasStore.insertNodes）。
 */
import { create } from 'zustand';
import type { Node, Edge } from '@xyflow/react';
import type { NodeTemplateDTO } from '@shared/ipc';

export interface SmartTemplate {
  id: string;
  name: string;
  /** 备注：简述模板用途 / 包含的工具流（列表卡片展示，可编辑） */
  notes?: string;
  createdAt: string;
  /** 节点数（列表展示用） */
  count: number;
  nodes: Node[];
  edges: Edge[];
}

function rid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `tpl-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
  }
}

const OLD_LS_KEY = 'mengbi.smartCanvas.templates.v1';
const MIGRATED_FLAG = 'mengbi.smartCanvas.templates.migrated.v1';

/** 磁盘旧模板兜底迁移：① video-reverse（2026-07-11 并入「反推」image-reverse）原位换 type，字段同名沿用；
 *  ② 旧智能分镜的 out-trans 输出口连线（2026-07-12 双输出方案删除）迁回默认口 out。
 *  模板文件不回写（插入画布时即为新形态，重存自然更新）。 */
function migrateTemplateKinds(t: SmartTemplate): SmartTemplate {
  const needNodes = t.nodes?.some((n) => (n.type as string) === 'video-reverse');
  const needEdges = t.edges?.some((e) => e.sourceHandle === 'out-trans');
  if (!needNodes && !needEdges) return t;
  return {
    ...t,
    nodes: needNodes
      ? t.nodes.map((n) => ((n.type as string) === 'video-reverse' ? { ...n, type: 'image-reverse' } : n))
      : t.nodes,
    edges: needEdges
      ? t.edges.map((e) => (e.sourceHandle === 'out-trans' ? { ...e, sourceHandle: 'out' } : e))
      : t.edges
  };
}

interface SmartTemplateState {
  templates: SmartTemplate[];
  loaded: boolean;
  /** 从磁盘加载（含一次性 localStorage 迁移）。幂等：已加载则直接 return。 */
  loadFromDisk: () => Promise<void>;
  /** 存模板：传入节点 + 内部连线（调用方已剥离 selected / 运行态）+ 可选备注。 */
  save: (name: string, nodes: Node[], edges: Edge[], notes?: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  rename: (id: string, name: string) => Promise<void>;
  /** 改标题 / 备注（复用 save IPC 按 id 覆盖整个模板文件）。 */
  update: (id: string, patch: { name?: string; notes?: string }) => Promise<void>;
}

export const useSmartTemplateStore = create<SmartTemplateState>()((set, get) => ({
  templates: [],
  loaded: false,
  loadFromDisk: async () => {
    if (get().loaded) return;
    const api = window.electronAPI?.template;
    if (!api) {
      set({ loaded: true });
      return;
    }
    // 一次性迁移旧 localStorage 模板到磁盘
    try {
      if (!localStorage.getItem(MIGRATED_FLAG)) {
        const raw = localStorage.getItem(OLD_LS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as { state?: { templates?: SmartTemplate[] } };
          const old = parsed?.state?.templates ?? [];
          for (const t of old) {
            if (t && typeof t.id === 'string') {
              await api.save(t as unknown as NodeTemplateDTO).catch(() => undefined);
            }
          }
        }
        localStorage.setItem(MIGRATED_FLAG, '1');
      }
    } catch {
      /* 迁移失败不致命 */
    }
    const r = await api.list();
    if (r.ok) set({ templates: (r.data.templates as unknown as SmartTemplate[]).map(migrateTemplateKinds), loaded: true });
    else set({ loaded: true });
  },
  save: async (name, nodes, edges, notes) => {
    const tpl: SmartTemplate = {
      id: rid(),
      name: name.trim() || '未命名模板',
      notes: notes?.trim() || undefined,
      createdAt: new Date().toISOString(),
      count: nodes.length,
      nodes,
      edges
    };
    const api = window.electronAPI?.template;
    if (api) {
      const r = await api.save(tpl as unknown as NodeTemplateDTO);
      if (!r.ok) throw new Error(r.error.message);
    }
    set((s) => ({ templates: [tpl, ...s.templates] }));
  },
  update: async (id, patch) => {
    const cur = get().templates.find((t) => t.id === id);
    if (!cur) return;
    const next: SmartTemplate = {
      ...cur,
      name: patch.name != null ? patch.name.trim() || cur.name : cur.name,
      notes: patch.notes != null ? patch.notes.trim() || undefined : cur.notes
    };
    const api = window.electronAPI?.template;
    if (api) await api.save(next as unknown as NodeTemplateDTO).catch(() => undefined);
    set((s) => ({ templates: s.templates.map((t) => (t.id === id ? next : t)) }));
  },
  remove: async (id) => {
    const api = window.electronAPI?.template;
    if (api) await api.remove({ id }).catch(() => undefined);
    set((s) => ({ templates: s.templates.filter((t) => t.id !== id) }));
  },
  rename: async (id, name) => {
    const nm = name.trim();
    const api = window.electronAPI?.template;
    if (api) await api.rename({ id, name: nm }).catch(() => undefined);
    set((s) => ({
      templates: s.templates.map((t) => (t.id === id ? { ...t, name: nm || t.name } : t))
    }));
  }
}));
