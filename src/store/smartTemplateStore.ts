/**
 * 智能画布「节点模板」（持久化）：把选中的若干节点 + 其内部连线存为命名模板，
 * 之后可一键插入到任意画布（跨文档复用常用节点组合）。存 localStorage `mengbi.smartCanvas.templates.v1`。
 * 模板内容是节点/连线的深拷贝快照；插入时由 store 重映射 id + 偏移（见 smartCanvasStore.insertTemplate）。
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Node, Edge } from '@xyflow/react';

export interface SmartTemplate {
  id: string;
  name: string;
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

interface SmartTemplateState {
  templates: SmartTemplate[];
  /** 存模板：传入节点 + 内部连线深拷贝（调用方已剥离 selected / 运行态） */
  save: (name: string, nodes: Node[], edges: Edge[]) => void;
  remove: (id: string) => void;
  rename: (id: string, name: string) => void;
}

export const useSmartTemplateStore = create<SmartTemplateState>()(
  persist(
    (set) => ({
      templates: [],
      save: (name, nodes, edges) =>
        set((s) => ({
          templates: [
            { id: rid(), name: name.trim() || '未命名模板', createdAt: new Date().toISOString(), count: nodes.length, nodes, edges },
            ...s.templates
          ]
        })),
      remove: (id) => set((s) => ({ templates: s.templates.filter((t) => t.id !== id) })),
      rename: (id, name) =>
        set((s) => ({ templates: s.templates.map((t) => (t.id === id ? { ...t, name: name.trim() || t.name } : t)) }))
    }),
    { name: 'mengbi.smartCanvas.templates.v1' }
  )
);
