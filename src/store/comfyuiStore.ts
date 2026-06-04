/**
 * ComfyUI 编排器 —— 持久化 UI 状态（连接表单、导入草稿、当前工作流引用、占位符输入）。
 * 大/瞬态数据（解析出的 graph、运行进度、输出）不持久化，见 partialize。
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { ParsedGraph, InputControl, Binding, LoopConfig } from '@shared/comfyui';

export type ComfyLeftTab = 'params' | 'batch' | 'records';

interface ComfyuiState {
  // 连接表单（真源在主进程 settings，这里缓存供表单编辑）
  host: string;
  launchCommand: string;
  launchCwd: string;
  hasAuthToken: boolean;

  // 导入
  importText: string;
  // 当前活动工作流（运行用）—— 不持久化
  activeWorkflowId: string | null;
  activeWorkflowName: string;
  activeWorkflowJson: string | null;
  activeGraph: ParsedGraph | null;

  // 自动推荐 / 用户编辑的输入控件 + 绑定 + 当前值
  activeControls: InputControl[];
  activeBindings: Binding[];
  controlValues: Record<string, unknown>;
  /** 输出限定：只读这些节点的输出（空数组 = 全部节点，向后兼容）。随模板走，不持久化到 localStorage */
  outputNodeIds: string[];
  /** 参数卡片展示顺序（节点 id 数组）；空 = 按控件自然顺序。随模板走 */
  cardOrder: string[];

  // UI 状态
  leftTab: ComfyLeftTab;
  selectedNodeId: string | null;
  loopConfig: LoopConfig;

  setConn: (patch: Partial<Pick<ComfyuiState, 'host' | 'launchCommand' | 'launchCwd' | 'hasAuthToken'>>) => void;
  setImportText: (s: string) => void;
  setActiveWorkflow: (v: {
    id: string | null;
    name: string;
    json: string;
    graph: ParsedGraph | null;
    controls?: InputControl[];
    bindings?: Binding[];
    outputNodeIds?: string[];
    cardOrder?: string[];
  }) => void;
  setControlValue: (id: string, value: unknown) => void;
  setLeftTab: (t: ComfyLeftTab) => void;
  setSelectedNode: (id: string | null) => void;
  setLoopConfig: (c: LoopConfig) => void;
  /** 手动绑定：加一个控件 + 绑定 */
  addControl: (control: InputControl, binding: Binding) => void;
  removeControl: (controlId: string) => void;
  renameControl: (controlId: string, label: string) => void;
  /** 删除节点（仅删除 + 智能清理：剔悬空链接、删关联控件/绑定、重算 graph）。只动内存 active，重存模板才落库 */
  deleteNode: (nodeId: string) => void;
  /** 切换"仅读取此节点输出"（输出限定）。再点取消 */
  toggleOutputNode: (nodeId: string) => void;
  /** 清空输出限定（恢复"全部节点"） */
  clearOutputNodes: () => void;
  /** 切换"忽略/绕过此节点"（用一条 bypass 绑定表示，随 bindings 持久化 + 流到运行引擎） */
  toggleBypassNode: (nodeId: string) => void;
  /** 拖动参数卡片排序：把 dragNid 移到 overNid 之前 */
  moveCard: (dragNid: string, overNid: string) => void;
}

export const useComfyuiStore = create<ComfyuiState>()(
  persist(
    (set) => ({
      host: '127.0.0.1:8188',
      launchCommand: '',
      launchCwd: '',
      hasAuthToken: false,
      importText: '',
      activeWorkflowId: null,
      activeWorkflowName: '',
      activeWorkflowJson: null,
      activeGraph: null,
      activeControls: [],
      activeBindings: [],
      controlValues: {},
      outputNodeIds: [],
      cardOrder: [],
      leftTab: 'params',
      selectedNodeId: null,
      loopConfig: { mode: 'single' },

      setConn: (patch) => set(patch),
      setImportText: (importText) => set({ importText }),
      setActiveWorkflow: (v) =>
        set((prev) => {
          const controls = v.controls ?? [];
          // 用控件默认值初始化 controlValues（已有同 id 的值尽量保留）
          const values: Record<string, unknown> = {};
          for (const c of controls) {
            values[c.id] = prev.controlValues[c.id] ?? c.default ?? '';
          }
          return {
            activeWorkflowId: v.id,
            activeWorkflowName: v.name,
            activeWorkflowJson: v.json,
            activeGraph: v.graph,
            activeControls: controls,
            activeBindings: v.bindings ?? [],
            controlValues: values,
            outputNodeIds: v.outputNodeIds ?? [],
            cardOrder: v.cardOrder ?? []
          };
        }),
      setControlValue: (id, value) =>
        set((s) => ({ controlValues: { ...s.controlValues, [id]: value } })),
      setLeftTab: (leftTab) => set({ leftTab }),
      setSelectedNode: (selectedNodeId) => set({ selectedNodeId }),
      setLoopConfig: (loopConfig) => set({ loopConfig }),
      addControl: (control, binding) =>
        set((s) => {
          if (s.activeControls.some((c) => c.id === control.id)) return s; // 去重
          return {
            activeControls: [...s.activeControls, control],
            activeBindings: [...s.activeBindings, binding],
            controlValues: {
              ...s.controlValues,
              [control.id]: s.controlValues[control.id] ?? control.default ?? ''
            }
          };
        }),
      removeControl: (controlId) =>
        set((s) => {
          const values = { ...s.controlValues };
          delete values[controlId];
          return {
            activeControls: s.activeControls.filter((c) => c.id !== controlId),
            // bypass 绑定无 controlId，保留；其余按 controlId 过滤
            activeBindings: s.activeBindings.filter((b) => b.mode === 'bypass' || b.controlId !== controlId),
            controlValues: values
          };
        }),
      renameControl: (controlId, label) =>
        set((s) => ({
          activeControls: s.activeControls.map((c) => (c.id === controlId ? { ...c, label } : c))
        })),
      deleteNode: (nodeId) =>
        set((s) => {
          if (!s.activeWorkflowJson || !s.activeGraph) return s;
          let obj: Record<string, { class_type?: string; inputs?: Record<string, unknown> }>;
          try {
            obj = JSON.parse(s.activeWorkflowJson) as typeof obj;
          } catch {
            return s;
          }
          if (!obj[nodeId]) return s;
          delete obj[nodeId];
          // 剔除其它节点指向被删节点的悬空链接（input 值形如 [nodeId, idx]）
          for (const node of Object.values(obj)) {
            const inputs = node?.inputs;
            if (!inputs || typeof inputs !== 'object') continue;
            for (const [k, v] of Object.entries(inputs)) {
              if (Array.isArray(v) && String(v[0]) === String(nodeId)) delete inputs[k];
            }
          }
          const json = JSON.stringify(obj);
          // 重算 graph：删节点 + 删touching边 + 按剩余边重建每个节点的 linkedInputs
          const edges = s.activeGraph.edges.filter((e) => e.fromNode !== nodeId && e.toNode !== nodeId);
          const nodes = s.activeGraph.nodes
            .filter((n) => n.id !== nodeId)
            .map((n) => ({
              ...n,
              linkedInputs: Array.from(
                new Set(edges.filter((e) => e.toNode === n.id).map((e) => e.toInput))
              )
            }));
          // 删关联控件/绑定 + 对应 controlValues
          const removedControlIds = new Set<string>();
          const bindings = s.activeBindings.filter((b) => {
            if ('nodeId' in b && b.nodeId === nodeId) {
              if (b.mode !== 'bypass') removedControlIds.add(b.controlId);
              return false;
            }
            return true;
          });
          const controls = s.activeControls.filter((c) => !removedControlIds.has(c.id));
          const values = { ...s.controlValues };
          for (const id of removedControlIds) delete values[id];
          return {
            activeWorkflowJson: json,
            activeGraph: { nodes, edges },
            activeBindings: bindings,
            activeControls: controls,
            controlValues: values,
            outputNodeIds: s.outputNodeIds.filter((id) => id !== nodeId),
            selectedNodeId: s.selectedNodeId === nodeId ? null : s.selectedNodeId
          };
        }),
      toggleOutputNode: (nodeId) =>
        set((s) => ({
          outputNodeIds: s.outputNodeIds.includes(nodeId)
            ? s.outputNodeIds.filter((id) => id !== nodeId)
            : [...s.outputNodeIds, nodeId]
        })),
      clearOutputNodes: () => set({ outputNodeIds: [] }),
      toggleBypassNode: (nodeId) =>
        set((s) => {
          const has = s.activeBindings.some((b) => b.mode === 'bypass' && b.nodeId === nodeId);
          return {
            activeBindings: has
              ? s.activeBindings.filter((b) => !(b.mode === 'bypass' && b.nodeId === nodeId))
              : [...s.activeBindings, { mode: 'bypass', nodeId }]
          };
        }),
      moveCard: (dragNid, overNid) =>
        set((s) => {
          if (dragNid === overNid) return s;
          // 当前展示顺序：cardOrder 里已有的先按其序，其余（新分组）按控件出现顺序补在后面
          const groupNids: string[] = [];
          const nodeOf = new Map<string, string>();
          for (const b of s.activeBindings) {
            if (b.mode === 'parameter' || b.mode === 'file_upload') nodeOf.set(b.controlId, b.nodeId);
          }
          for (const c of s.activeControls) {
            const nid = nodeOf.get(c.id) ?? '__other__';
            if (!groupNids.includes(nid)) groupNids.push(nid);
          }
          const ordered = [
            ...s.cardOrder.filter((n) => groupNids.includes(n)),
            ...groupNids.filter((n) => !s.cardOrder.includes(n))
          ];
          const from = ordered.indexOf(dragNid);
          const to = ordered.indexOf(overNid);
          if (from < 0 || to < 0) return s;
          ordered.splice(from, 1);
          ordered.splice(ordered.indexOf(overNid), 0, dragNid);
          return { cardOrder: ordered };
        })
    }),
    {
      name: 'mengbi-comfyui',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        host: s.host,
        launchCommand: s.launchCommand,
        launchCwd: s.launchCwd,
        importText: s.importText,
        activeWorkflowId: s.activeWorkflowId,
        activeWorkflowName: s.activeWorkflowName,
        // 剔除 data:URI（图片/遮罩可能 MB 级，写 localStorage 会爆 quota）
        controlValues: Object.fromEntries(
          Object.entries(s.controlValues).filter(
            ([, v]) => !(typeof v === 'string' && v.startsWith('data:'))
          )
        )
      })
    }
  )
);
