/**
 * 智能画布「视图偏好」（持久化）：连线外观 + 网格吸附 + 对齐参考线 + 状态着色。
 * 这些是用户级显示偏好（与具体文档无关），单独存 localStorage `mengbi.smartCanvas.view.v1`。
 * 与 themeStore.flowColor（连线流动色）互补：本 store 管连线形状/箭头/状态色/吸附等结构性显示。
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type EdgeStyle = 'bezier' | 'straight' | 'step';

/** 连线流动动画：on=始终开 / auto=节点或连线多时自动停（性能降级）/ off=始终关 */
export type FlowAnimation = 'on' | 'auto' | 'off';

interface SmartViewState {
  /** 连线形状：曲线 / 直线 / 折线 */
  edgeStyle: EdgeStyle;
  /** 连线末端显示箭头（方向） */
  showArrows: boolean;
  /** 按上游节点运行状态给连线着色（idle/灰 running/强调 success/绿 error/红） */
  statusColorEdges: boolean;
  /** 拖动时吸附到网格 */
  snapToGrid: boolean;
  /** 网格步长（px） */
  snapSize: number;
  /** 拖动时显示对齐参考线（与其它节点边/中心对齐） */
  alignGuides: boolean;
  /** 节点属性面板：true=浮动跟随选中节点（默认）/ false=固定右侧抽屉 */
  inspectorFloat: boolean;
  /** 连线流动动画：on / auto（默认，大画布自动停）/ off */
  flowAnimation: FlowAnimation;
  setEdgeStyle: (s: EdgeStyle) => void;
  setFlowAnimation: (v: FlowAnimation) => void;
  toggleArrows: () => void;
  toggleStatusColor: () => void;
  toggleSnap: () => void;
  setSnapSize: (n: number) => void;
  toggleGuides: () => void;
  toggleInspectorFloat: () => void;
}

export const useSmartViewStore = create<SmartViewState>()(
  persist(
    (set) => ({
      edgeStyle: 'bezier',
      showArrows: true,
      statusColorEdges: true,
      snapToGrid: false,
      snapSize: 16,
      alignGuides: true,
      inspectorFloat: true,
      flowAnimation: 'auto',
      setEdgeStyle: (edgeStyle) => set({ edgeStyle }),
      setFlowAnimation: (flowAnimation) => set({ flowAnimation }),
      toggleArrows: () => set((s) => ({ showArrows: !s.showArrows })),
      toggleStatusColor: () => set((s) => ({ statusColorEdges: !s.statusColorEdges })),
      toggleSnap: () => set((s) => ({ snapToGrid: !s.snapToGrid })),
      setSnapSize: (snapSize) => set({ snapSize: Math.max(4, Math.min(64, Math.round(snapSize))) }),
      toggleGuides: () => set((s) => ({ alignGuides: !s.alignGuides })),
      toggleInspectorFloat: () => set((s) => ({ inspectorFloat: !s.inspectorFloat }))
    }),
    {
      name: 'mengbi.smartCanvas.view.v1',
      version: 1,
      // 一次性修复：把节点属性面板恢复成「浮动」。此前若误点过「📌 固定面板」会把
      // inspectorFloat 持久化成 false，导致生成节点的悬浮控制台不再出现（改走右侧抽屉）。
      // 只在旧版本（无 version / version 0）数据上跑一次，跑完用户仍可自由再钉。
      migrate: (persisted, version) => {
        const s = (persisted ?? {}) as Partial<SmartViewState>;
        if (version < 1) return { ...s, inspectorFloat: true };
        return s as SmartViewState;
      }
    }
  )
);
