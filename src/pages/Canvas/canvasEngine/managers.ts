/**
 * 画板「管理器」模块组织（对应需求十七节的拆分建议）。
 *
 * 这是一个**聚合导出层**，把已经按职责拆好的纯函数 / store 归到 10 个管理器命名空间下，
 * 给上层一个清晰、稳定的导入面，而不是大改已稳定运行的实现。
 *
 *   CanvasCore        —— 渲染 / 缩放 / 平移 / 坐标转换（在 index.tsx + CanvasStage.tsx 内，Konva 驱动）
 *   LayerManager      —— 图层增删改 / 排序 / 合并（canvasStore + layerOps）
 *   MaskManager       —— 蒙版绘制 / 几何 / 导入导出（maskEngine + inpaintMaskStore）
 *   SelectionManager  —— 选区 = 蒙版的形状填充（maskEngine 的 fill* + inpaintMaskStore.shapeMode）
 *   TransformManager  —— 移动 / 缩放 / 旋转 / 透视 / 裁切（Konva.Transformer + perspective/crop 引擎）
 *   HistoryManager    —— 撤销重做（index.tsx）+ 命名快照（snapshotStore）
 *   ExportManager     —— 合成导出 / 工程文件（exportPNG + projectFile）
 *   PhotoshopBridge   —— window.electronAPI.ps.*（主进程 electron/ipc/ps.ts）
 *   AIActionBridge    —— 局部重绘 / 扩图 / 生图入口（InpaintDialog + outpaintOps + AIActionPanel）
 *   ReferenceImageManager —— 参考图（imageParamsStore.refs + ReferencePanel）
 */

export * as MaskManager from './maskEngine';
export * as LayerManager from './layerOps';
export * as AIActionBridge from './outpaintOps';
export * as ExportManager from './exportPNG';
export * as ProjectFile from './projectFile';
export * as AdjustManager from './adjust';

// 说明性指针（非导出实现，仅文档化模块归属）：
//   HistoryManager        → @/store/snapshotStore
//   MaskManager(状态)     → @/store/inpaintMaskStore
//   ReferenceImageManager → @/store/imageParamsStore + ReferencePanel.tsx
//   PhotoshopBridge       → window.electronAPI.ps + PhotoshopBar.tsx
//   CanvasCore/Transform  → index.tsx + CanvasStage.tsx（Konva）
