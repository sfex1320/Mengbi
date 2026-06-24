import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Stage,
  Layer as KonvaLayer,
  Image as KonvaImage,
  Rect,
  Ellipse,
  Text as KonvaText,
  Transformer,
  Group,
  Line
} from 'react-konva';
import Konva from 'konva';
import type { Layer, BrushStroke } from './types';
import { cryptoRandomId } from './types';
import { useCanvasStore, layerDisplaySrc, isEffectivelyVisible, isEffectivelyLocked } from '@/store/canvasStore';
import { toast } from '@/store/toastStore';
import { useBrushStore } from '@/store/brushStore';
import { useInpaintMaskStore } from '@/store/inpaintMaskStore';
import { PerspectiveOverlay } from './PerspectiveOverlay';
import { CropOverlay } from './CropOverlay';
import { computeSnap, type SnapGuide } from './canvasEngine/snap';
import { mengbiAdjustFilter, adjustParamsFromLayer, hasAnyAdjust } from './canvasEngine/adjust';

interface StageProps {
  zoom: number;
  panX: number;
  panY: number;
  mode: 'normal' | 'perspective' | 'crop';
  handMode: boolean;
  /** 是否处于画笔模式（含 paint / erase 两种） */
  brushTool: 'none' | 'brush' | 'eraser';
  /** 是否在蒙版模式（在当前选中图像图层的 maskStrokes 上画） */
  maskMode: boolean;
  /** 局部重绘蒙版工具（画板级 inpaint 蒙版，独立于 maskMode 的图层显示蒙版） */
  inpaintMaskTool: boolean;
  /** 仅移动当前图层：开启时只有选中图层可点击/拖动 */
  lockToSelected: boolean;
  onModeChange: (m: 'normal' | 'perspective' | 'crop') => void;
  snapGuides: SnapGuide[];
  onSnapGuidesChange: (g: SnapGuide[]) => void;
}

export function CanvasStage({
  zoom,
  panX,
  panY,
  mode,
  handMode,
  brushTool,
  maskMode,
  inpaintMaskTool,
  lockToSelected,
  onModeChange,
  snapGuides,
  onSnapGuidesChange
}: StageProps): JSX.Element {
  const project = useCanvasStore((s) => s.project);
  const select = useCanvasStore((s) => s.selectLayer);
  const toggleSelect = useCanvasStore((s) => s.toggleLayerInSelection);
  const update = useCanvasStore((s) => s.updateLayer);
  const createBrushLayer = useCanvasStore((s) => s.createBrushLayer);
  const appendStroke = useCanvasStore((s) => s.appendStroke);
  const appendMaskStroke = useCanvasStore((s) => s.appendMaskStroke);
  const enableMask = useCanvasStore((s) => s.enableMask);

  const brushColor = useBrushStore((s) => s.color);
  const brushSize = useBrushStore((s) => s.size);
  const brushOpacity = useBrushStore((s) => s.opacity);
  const pushRecent = useBrushStore((s) => s.pushRecent);

  // ─── 局部重绘蒙版 ───
  const maskCanvas = useInpaintMaskStore((s) => s.canvas);
  const maskVersion = useInpaintMaskStore((s) => s.version);
  const maskVisible = useInpaintMaskStore((s) => s.visible);
  const maskOpacity = useInpaintMaskStore((s) => s.maskOpacity);
  const ensureMaskSize = useInpaintMaskStore((s) => s.ensureSize);
  const maskStroke = useInpaintMaskStore((s) => s.stroke);
  const maskShapeMode = useInpaintMaskStore((s) => s.shapeMode);
  const maskColor = useInpaintMaskStore((s) => s.color);
  const maskFillRect = useInpaintMaskStore((s) => s.fillRect);
  const maskFillEllipse = useInpaintMaskStore((s) => s.fillEllipse);
  const maskFillPolygon = useInpaintMaskStore((s) => s.fillPolygon);
  const maskOverlayRef = useRef<Konva.Image>(null);
  const maskDrawingRef = useRef(false);
  const maskLastRef = useRef<{ x: number; y: number } | null>(null);
  // 拖拽时只在对齐辅助线真正变化时才 setState，避免每帧全量重渲染（流畅度优化）
  const lastGuidesRef = useRef<string>('');
  // 选区形状实时预览（rect/ellipse 用 box，lasso 用 points）
  const [maskShape, setMaskShape] = useState<
    | { kind: 'rect' | 'ellipse'; x0: number; y0: number; x1: number; y1: number }
    | { kind: 'lasso'; points: number[] }
    | null
  >(null);

  // 进入蒙版工具时保证画布存在且对齐画板尺寸
  useEffect(() => {
    if (inpaintMaskTool) ensureMaskSize(project.width, project.height);
  }, [inpaintMaskTool, project.width, project.height, ensureMaskSize]);

  // 蒙版栅格变更 → 重绘叠加层
  useEffect(() => {
    maskOverlayRef.current?.getLayer()?.batchDraw();
  }, [maskVersion, maskOpacity, maskVisible, maskCanvas]);

  // 当前进行中的笔刷描边（实时显示，未提交到 store）
  const [pendingStroke, setPendingStroke] = useState<{
    layerId: string;
    target: 'paint' | 'mask';
    stroke: BrushStroke;
  } | null>(null);
  const drawingRef = useRef(false);

  const stagePixelW = project.width * zoom;
  const stagePixelH = project.height * zoom;

  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const nodeRefs = useRef<Map<string, Konva.Node>>(new Map());

  // 选中变化时把 Transformer 挂到所有被选中的节点（多选）
  useEffect(() => {
    const tr = transformerRef.current;
    if (!tr) return;
    if (mode !== 'normal' || handMode || inpaintMaskTool) {
      tr.nodes([]);
      tr.getLayer()?.batchDraw();
      return;
    }
    const ids = project.selectedIds ?? (project.selectedId ? [project.selectedId] : []);
    const nodes = ids
      .map((id) => nodeRefs.current.get(id))
      .filter((n): n is Konva.Node => !!n);
    tr.nodes(nodes);
    tr.getLayer()?.batchDraw();
  }, [project.selectedId, project.selectedIds, project.layers.length, mode, handMode, inpaintMaskTool]);

  const selected = project.layers.find((l) => l.id === project.selectedId) ?? null;

  function handleStageMouseDown(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>): void {
    if (mode !== 'normal' || handMode) return;
    // 局部重绘蒙版工具优先级最高
    if (inpaintMaskTool) {
      handleMaskStart();
      return;
    }
    // 笔刷 / 橡皮模式优先级次之
    if (brushTool !== 'none') {
      handleBrushStart(e);
      return;
    }
    if (e.target === e.target.getStage()) {
      select(null);
    }
  }

  function handleMaskStart(): void {
    const p = getStagePoint();
    if (!p) return;
    ensureMaskSize(project.width, project.height);
    maskDrawingRef.current = true;
    if (maskShapeMode === 'brush') {
      maskLastRef.current = { x: p.x, y: p.y };
      const erase = useInpaintMaskStore.getState().eraseMode;
      maskStroke(p.x, p.y, p.x, p.y, erase);
      maskOverlayRef.current?.getLayer()?.batchDraw();
    } else if (maskShapeMode === 'lasso') {
      setMaskShape({ kind: 'lasso', points: [p.x, p.y] });
    } else {
      setMaskShape({ kind: maskShapeMode, x0: p.x, y0: p.y, x1: p.x, y1: p.y });
    }
  }

  function handleMaskMove(): void {
    if (!maskDrawingRef.current) return;
    const p = getStagePoint();
    if (!p) return;
    if (maskShapeMode === 'brush') {
      const last = maskLastRef.current ?? p;
      const erase = useInpaintMaskStore.getState().eraseMode;
      maskStroke(last.x, last.y, p.x, p.y, erase);
      maskLastRef.current = { x: p.x, y: p.y };
      maskOverlayRef.current?.getLayer()?.batchDraw();
    } else if (maskShapeMode === 'lasso') {
      setMaskShape((s) => (s && s.kind === 'lasso' ? { kind: 'lasso', points: [...s.points, p.x, p.y] } : s));
    } else {
      setMaskShape((s) => (s && s.kind !== 'lasso' ? { ...s, x1: p.x, y1: p.y } : s));
    }
  }

  function handleMaskEnd(): void {
    if (!maskDrawingRef.current) return;
    maskDrawingRef.current = false;
    maskLastRef.current = null;
    // 提交选区形状
    setMaskShape((s) => {
      if (!s) return null;
      if (s.kind === 'rect') maskFillRect(s.x0, s.y0, s.x1 - s.x0, s.y1 - s.y0);
      else if (s.kind === 'ellipse')
        maskFillEllipse((s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2, (s.x1 - s.x0) / 2, (s.y1 - s.y0) / 2);
      else if (s.kind === 'lasso') maskFillPolygon(s.points);
      return null;
    });
  }

  function getStagePoint(): { x: number; y: number } | null {
    const stage = stageRef.current;
    if (!stage) return null;
    const pos = stage.getPointerPosition();
    if (!pos) return null;
    // pos 已经是 stage 内坐标（含 stage scale）；除以 zoom 得到画布坐标
    return { x: pos.x / zoom, y: pos.y / zoom };
  }

  function handleBrushStart(_e: Konva.KonvaEventObject<MouseEvent | TouchEvent>): void {
    const p = getStagePoint();
    if (!p) return;
    drawingRef.current = true;

    // 决定笔刷写入位置：mask / paint
    if (maskMode) {
      const sel = project.selectedId;
      const layer = sel ? project.layers.find((l) => l.id === sel) : null;
      if (!layer || layer.isGroup || layer.isBrush) return; // 蒙版只对图像图层
      enableMask(layer.id);
      // 蒙版的坐标是图层局部坐标，需要把世界坐标转图层局部
      const local = worldToLocal(layer, p.x, p.y);
      const stroke: BrushStroke = {
        id: cryptoRandomId(),
        tool: brushTool === 'eraser' ? 'paint' : 'erase', // 蒙版语义反转：默认笔 = 隐藏
        points: [local.x, local.y],
        color: '#000000ff',
        size: brushSize,
        opacity: brushOpacity
      };
      setPendingStroke({ layerId: layer.id, target: 'mask', stroke });
      return;
    }

    // ─── 橡皮：擦除「当前选中图层」的内容（非破坏性） ───
    if (brushTool === 'eraser') {
      const sel = project.selectedId;
      const layer = sel ? project.layers.find((l) => l.id === sel) : null;
      if (!layer || layer.isGroup || layer.isText || layer.shapeKind) {
        // 没有可擦除的图层 → 不动作（不再误建笔刷图层）
        drawingRef.current = false;
        return;
      }
      const local = worldToLocal(layer, p.x, p.y);
      const eraseStroke: BrushStroke = {
        id: cryptoRandomId(),
        tool: 'erase',
        points: [local.x, local.y],
        color: '#000000ff',
        size: brushSize,
        opacity: brushOpacity
      };
      if (layer.isBrush) {
        // 笔刷图层：擦掉已画的描边
        setPendingStroke({ layerId: layer.id, target: 'paint', stroke: eraseStroke });
      } else {
        // 图像图层：写入蒙版做隐藏（擦除 = destination-out 隐藏内容）
        enableMask(layer.id);
        setPendingStroke({ layerId: layer.id, target: 'mask', stroke: eraseStroke });
      }
      return;
    }

    // ─── 画笔：写入选中的笔刷图层；当前选中不是笔刷图层则新建一个 ───
    let targetId = project.selectedId;
    let target = targetId ? project.layers.find((l) => l.id === targetId) : null;
    if (!target || !target.isBrush) {
      targetId = createBrushLayer('笔刷');
      target = useCanvasStore.getState().project.layers.find((l) => l.id === targetId) ?? null;
    }
    if (!target || !targetId) return;
    const local = worldToLocal(target, p.x, p.y);
    const stroke: BrushStroke = {
      id: cryptoRandomId(),
      tool: 'paint',
      points: [local.x, local.y],
      color: brushColor,
      size: brushSize,
      opacity: brushOpacity
    };
    setPendingStroke({ layerId: targetId, target: 'paint', stroke });
  }

  function handleBrushMove(_e: Konva.KonvaEventObject<MouseEvent | TouchEvent>): void {
    if (!drawingRef.current || !pendingStroke) return;
    const p = getStagePoint();
    if (!p) return;
    const layer = project.layers.find((l) => l.id === pendingStroke.layerId);
    if (!layer) return;
    const local = worldToLocal(layer, p.x, p.y);
    setPendingStroke({
      ...pendingStroke,
      stroke: {
        ...pendingStroke.stroke,
        points: [...pendingStroke.stroke.points, local.x, local.y]
      }
    });
  }

  function handleBrushEnd(): void {
    if (!drawingRef.current || !pendingStroke) {
      drawingRef.current = false;
      return;
    }
    drawingRef.current = false;
    const { layerId, target, stroke } = pendingStroke;
    // 提交前再校验：笔画过程中图层可能被锁定/隐藏 → 不写入（否则静默画到看不见/锁定的层）。蒙版另算。
    if (target !== 'mask' && (!isEffectivelyVisible(project.layers, layerId) || isEffectivelyLocked(project.layers, layerId))) {
      setPendingStroke(null);
      toast.info('该图层已锁定或隐藏', '笔画未提交');
      return;
    }
    if (stroke.points.length >= 2) {
      if (target === 'mask') appendMaskStroke(layerId, stroke);
      else {
        appendStroke(layerId, stroke);
        if (stroke.tool === 'paint') pushRecent(stroke.color);
      }
    }
    setPendingStroke(null);
  }

  function handleLayerDragMove(layerId: string, ev: Konva.KonvaEventObject<DragEvent>): void {
    const layer = project.layers.find((l) => l.id === layerId);
    if (!layer) return;
    const tryX = ev.target.x();
    const tryY = ev.target.y();
    const r = computeSnap(layerId, layer, tryX, tryY, project, zoom);
    if (r.x !== tryX || r.y !== tryY) {
      ev.target.x(r.x);
      ev.target.y(r.y);
    }
    // 只在辅助线变化时才更新 React 状态，避免每帧重渲染整个舞台
    const sig = r.guides.map((g) => `${g.axis}:${g.pos}`).join('|');
    if (sig !== lastGuidesRef.current) {
      lastGuidesRef.current = sig;
      onSnapGuidesChange(r.guides);
    }
  }
  function handleLayerDragEnd(): void {
    if (lastGuidesRef.current !== '') {
      lastGuidesRef.current = '';
      onSnapGuidesChange([]);
    }
  }

  return (
    <div
      className="mb-canvas-stage-paper"
      style={{
        position: 'absolute',
        left: panX,
        top: panY,
        width: stagePixelW,
        height: stagePixelH,
        pointerEvents: handMode ? 'none' : 'auto'
      }}
    >
      <Stage
        ref={stageRef}
        width={stagePixelW}
        height={stagePixelH}
        scaleX={zoom}
        scaleY={zoom}
        onMouseDown={handleStageMouseDown}
        onTouchStart={handleStageMouseDown}
        onMouseMove={(e) => {
          if (inpaintMaskTool) handleMaskMove();
          else if (brushTool !== 'none') handleBrushMove(e);
        }}
        onTouchMove={(e) => {
          if (inpaintMaskTool) handleMaskMove();
          else if (brushTool !== 'none') handleBrushMove(e);
        }}
        onMouseUp={() => {
          if (inpaintMaskTool) handleMaskEnd();
          else if (brushTool !== 'none') handleBrushEnd();
        }}
        onTouchEnd={() => {
          if (inpaintMaskTool) handleMaskEnd();
          else if (brushTool !== 'none') handleBrushEnd();
        }}
        onMouseLeave={() => {
          if (inpaintMaskTool) handleMaskEnd();
          else if (brushTool !== 'none') handleBrushEnd();
        }}
        listening={!handMode}
      >
        <KonvaLayer>
          {project.background && project.background !== 'transparent' && (
            <Rect width={project.width} height={project.height} fill={project.background} />
          )}
          {project.layers.map((layer) => {
            if (layer.isGroup) return null;
            if (!isEffectivelyVisible(project.layers, layer.id)) return null;
            const effLocked = isEffectivelyLocked(project.layers, layer.id);
            const inSelection = (project.selectedIds ?? []).includes(layer.id);
            const isPrimary = layer.id === project.selectedId;
            const pendingForLayer =
              pendingStroke && pendingStroke.layerId === layer.id ? pendingStroke : null;
            // 仅移动当前图层：有选中时非选中层不可交互（无选中时全部可点以便首次选择）
            const interactive = !lockToSelected || !project.selectedId || inSelection;
            const isBrushDraggable =
              !effLocked && brushTool === 'none' && !inpaintMaskTool && interactive;

            if (layer.isBrush) {
              return (
                <BrushLayerNode
                  key={layer.id}
                  layer={layer}
                  draggable={isBrushDraggable}
                  listening={interactive}
                  pendingPaintStroke={
                    pendingForLayer && pendingForLayer.target === 'paint'
                      ? pendingForLayer.stroke
                      : null
                  }
                  onSelect={(shift) => {
                    if (shift) toggleSelect(layer.id);
                    else select(layer.id);
                  }}
                  onChange={(patch) => update(layer.id, patch)}
                  registerNode={(node) => {
                    if (node) nodeRefs.current.set(layer.id, node);
                    else nodeRefs.current.delete(layer.id);
                  }}
                />
              );
            }

            if (layer.isText) {
              return (
                <TextNode
                  key={layer.id}
                  layer={layer}
                  draggable={isBrushDraggable}
                  listening={interactive}
                  onSelect={(shift) => {
                    if (shift) toggleSelect(layer.id);
                    else select(layer.id);
                  }}
                  onChange={(patch) => update(layer.id, patch)}
                  registerNode={(node) => {
                    if (node) nodeRefs.current.set(layer.id, node);
                    else nodeRefs.current.delete(layer.id);
                  }}
                />
              );
            }

            if (layer.shapeKind) {
              return (
                <ShapeNode
                  key={layer.id}
                  layer={layer}
                  draggable={isBrushDraggable}
                  listening={interactive}
                  onSelect={(shift) => {
                    if (shift) toggleSelect(layer.id);
                    else select(layer.id);
                  }}
                  onChange={(patch) => update(layer.id, patch)}
                  registerNode={(node) => {
                    if (node) nodeRefs.current.set(layer.id, node);
                    else nodeRefs.current.delete(layer.id);
                  }}
                />
              );
            }

            return (
              <CanvasImage
                key={layer.id}
                layer={layer}
                effLocked={effLocked}
                isSelected={inSelection}
                modeHidden={mode !== 'normal' && isPrimary}
                draggable={isBrushDraggable}
                listening={interactive}
                pendingMaskStroke={
                  pendingForLayer && pendingForLayer.target === 'mask'
                    ? pendingForLayer.stroke
                    : null
                }
                onSelect={(shift) => {
                  if (shift) toggleSelect(layer.id);
                  else select(layer.id);
                }}
                onChange={(patch) => update(layer.id, patch)}
                onDragMove={(ev) => handleLayerDragMove(layer.id, ev)}
                onDragEnd={handleLayerDragEnd}
                registerNode={(node) => {
                  if (node) nodeRefs.current.set(layer.id, node);
                  else nodeRefs.current.delete(layer.id);
                }}
              />
            );
          })}
        </KonvaLayer>
        <KonvaLayer listening={false}>
          {/* 对齐辅助线：只在拖拽时有内容 */}
          {snapGuides.map((g, i) =>
            g.axis === 'v' ? (
              <Line
                key={`v${i}`}
                points={[g.pos, 0, g.pos, project.height]}
                stroke="#f43f5e"
                strokeWidth={1 / Math.max(0.0001, zoom)}
                dash={[6 / zoom, 4 / zoom]}
              />
            ) : (
              <Line
                key={`h${i}`}
                points={[0, g.pos, project.width, g.pos]}
                stroke="#f43f5e"
                strokeWidth={1 / Math.max(0.0001, zoom)}
                dash={[6 / zoom, 4 / zoom]}
              />
            )
          )}
        </KonvaLayer>
        {maskCanvas && maskVisible && (
          <KonvaLayer listening={false}>
            <KonvaImage
              ref={maskOverlayRef}
              image={maskCanvas}
              x={0}
              y={0}
              width={project.width}
              height={project.height}
              opacity={maskOpacity}
              listening={false}
            />
            {maskShape && maskShape.kind === 'rect' && (
              <Rect
                x={Math.min(maskShape.x0, maskShape.x1)}
                y={Math.min(maskShape.y0, maskShape.y1)}
                width={Math.abs(maskShape.x1 - maskShape.x0)}
                height={Math.abs(maskShape.y1 - maskShape.y0)}
                stroke={maskColor}
                strokeWidth={1 / Math.max(0.0001, zoom)}
                dash={[6 / zoom, 4 / zoom]}
                listening={false}
              />
            )}
            {maskShape && maskShape.kind === 'ellipse' && (
              <Ellipse
                x={(maskShape.x0 + maskShape.x1) / 2}
                y={(maskShape.y0 + maskShape.y1) / 2}
                radiusX={Math.abs(maskShape.x1 - maskShape.x0) / 2}
                radiusY={Math.abs(maskShape.y1 - maskShape.y0) / 2}
                stroke={maskColor}
                strokeWidth={1 / Math.max(0.0001, zoom)}
                dash={[6 / zoom, 4 / zoom]}
                listening={false}
              />
            )}
            {maskShape && maskShape.kind === 'lasso' && maskShape.points.length >= 4 && (
              <Line
                points={maskShape.points}
                stroke={maskColor}
                strokeWidth={1 / Math.max(0.0001, zoom)}
                dash={[6 / zoom, 4 / zoom]}
                closed={false}
                listening={false}
              />
            )}
          </KonvaLayer>
        )}
        <KonvaLayer>
          <Transformer
            ref={transformerRef}
            rotateEnabled
            enabledAnchors={[
              'top-left',
              'top-center',
              'top-right',
              'middle-left',
              'middle-right',
              'bottom-left',
              'bottom-center',
              'bottom-right'
            ]}
            borderStroke="rgba(251,146,60,0.85)"
            anchorStroke="#fb923c"
            anchorFill="#fff"
            anchorSize={9}
            rotateAnchorOffset={28}
            keepRatio={false}
          />
        </KonvaLayer>
      </Stage>

      {mode === 'perspective' && selected && (
        <PerspectiveOverlay
          layer={selected}
          zoom={zoom}
          onCommit={() => onModeChange('normal')}
        />
      )}
      {mode === 'crop' && selected && (
        <CropOverlay
          layer={selected}
          zoom={zoom}
          onCommit={() => onModeChange('normal')}
        />
      )}
    </div>
  );
}

interface CanvasImageProps {
  layer: Layer;
  effLocked: boolean;
  isSelected: boolean;
  modeHidden: boolean;
  draggable: boolean;
  listening: boolean;
  pendingMaskStroke: BrushStroke | null;
  onSelect: (shift: boolean) => void;
  onChange: (patch: Partial<Layer>) => void;
  onDragMove: (ev: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd: () => void;
  registerNode: (node: Konva.Node | null) => void;
}

function CanvasImage({
  layer,
  effLocked,
  isSelected,
  modeHidden,
  draggable,
  listening,
  pendingMaskStroke,
  onSelect,
  onChange,
  onDragMove,
  onDragEnd,
  registerNode
}: CanvasImageProps): JSX.Element | null {
  const groupRef = useRef<Konva.Group>(null);
  const imageRef = useRef<Konva.Image>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const src = useMemo(() => layerDisplaySrc(layer), [layer.sourcePath, layer.cookedDataUri]);

  // 调整：当任何 adj* 字段变化时重新缓存并应用滤镜（色调用自定义滤镜 + 模糊用 Konva 内置）
  const adjParams = adjustParamsFromLayer(layer);
  const adjBlur = layer.adjBlur ?? 0;
  const adjActive = hasAnyAdjust(adjParams) || adjBlur > 0;
  const adjKey = JSON.stringify([adjParams, adjBlur]);

  useEffect(() => {
    const node = imageRef.current;
    if (!node) return;
    if (!img) return;
    if (!adjActive) {
      node.filters([]);
      node.clearCache();
      node.getLayer()?.batchDraw();
      return;
    }
    // 防抖 140ms：拖滑块时合并；停手才真正 cache + 应用滤镜。
    // 性能关键：把预览缓存降采样到长边 ≤ 1200px —— 自定义滤镜 + 卷积（锐化/降噪）
    // 在缩小后的位图上跑，4K 图也能瞬间完成；导出走 exportPNG 全分辨率，不受影响。
    const t = window.setTimeout(() => {
      if (!imageRef.current) return;
      try {
        const cw = layer.crop ? layer.crop.width : layer.width;
        const ch = layer.crop ? layer.crop.height : layer.height;
        const pixelRatio = Math.min(1, 1200 / Math.max(1, cw, ch));
        node.cache({ pixelRatio });
        // 把调色参数写到 node attr，供自定义滤镜读取
        node.setAttrs({
          mbBrightness: adjParams.brightness,
          mbContrast: adjParams.contrast,
          mbSaturation: adjParams.saturation,
          mbHue: adjParams.hue,
          mbTemperature: adjParams.temperature,
          mbExposure: adjParams.exposure,
          mbSharpen: adjParams.sharpen,
          mbDenoise: adjParams.denoise,
          mbGrayscale: adjParams.grayscale,
          mbInvert: adjParams.invert
        });
        const filters = [mengbiAdjustFilter];
        if (adjBlur > 0) {
          filters.push(Konva.Filters.Blur);
          node.blurRadius(adjBlur);
        }
        node.filters(filters);
        node.getLayer()?.batchDraw();
      } catch (e) {
        console.warn('[adjust filter] failed', e);
      }
    }, 80);
    return () => window.clearTimeout(t);
  }, [img, adjActive, adjKey, adjBlur]);

  useEffect(() => {
    if (!src) {
      setImg(null);
      return;
    }
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => setImg(im);
    im.onerror = () => {
      // 静默隐藏图层会让用户分不清「故意隐藏」还是「加载失败」；至少留日志便于排查
      // （不弹 toast：源目录被移动时可能整批失败，会造成 toast 风暴；资产库的孤儿检测已专门处理该场景）
      console.warn('[canvas] 图层图片加载失败', src);
      setImg(null);
    };
    im.src = src;
    return () => {
      im.onload = null;
      im.onerror = null;
    };
  }, [src]);

  useEffect(() => {
    registerNode(groupRef.current);
    return () => registerNode(null);
  }, [registerNode]);

  if (!img) return null;
  if (modeHidden) return null;

  return (
    <Group
      ref={groupRef}
      x={layer.x}
      y={layer.y}
      scaleX={layer.scaleX}
      scaleY={layer.scaleY}
      rotation={(layer.rotation * 180) / Math.PI}
      skewX={layer.skewX}
      skewY={layer.skewY}
      opacity={layer.opacity}
      globalCompositeOperation={layer.blendMode}
      draggable={draggable}
      listening={listening}
      onClick={(e) => onSelect(!!(e.evt as MouseEvent).shiftKey)}
      onTap={() => onSelect(false)}
      onDragMove={onDragMove}
      onDragEnd={(e) => {
        onChange({ x: e.target.x(), y: e.target.y() });
        onDragEnd();
      }}
      onTransformEnd={() => {
        const node = groupRef.current;
        if (!node) return;
        onChange({
          x: node.x(),
          y: node.y(),
          scaleX: node.scaleX(),
          scaleY: node.scaleY(),
          rotation: (node.rotation() * Math.PI) / 180,
          skewX: node.skewX(),
          skewY: node.skewY()
        });
      }}
    >
      <KonvaImage
        ref={imageRef}
        image={img}
        width={layer.crop ? layer.crop.width : layer.width}
        height={layer.crop ? layer.crop.height : layer.height}
        crop={layer.crop ?? undefined}
      />
      {/* 蒙版描边：destination-out = 隐藏；destination-in / 在已有 paint 上 = 显示 */}
      {(layer.maskStrokes ?? []).map((s) => (
        <Line
          key={s.id}
          points={s.points}
          stroke={s.tool === 'erase' ? 'rgba(0,0,0,1)' : 'rgba(255,255,255,1)'}
          strokeWidth={s.size}
          opacity={s.opacity}
          lineCap="round"
          lineJoin="round"
          tension={0.4}
          listening={false}
          globalCompositeOperation={s.tool === 'erase' ? 'destination-out' : 'source-over'}
        />
      ))}
      {pendingMaskStroke && pendingMaskStroke.points.length >= 2 && (
        <Line
          points={pendingMaskStroke.points}
          stroke={pendingMaskStroke.tool === 'erase' ? 'rgba(0,0,0,1)' : 'rgba(255,255,255,1)'}
          strokeWidth={pendingMaskStroke.size}
          opacity={pendingMaskStroke.opacity}
          lineCap="round"
          lineJoin="round"
          tension={0.4}
          listening={false}
          globalCompositeOperation={
            pendingMaskStroke.tool === 'erase' ? 'destination-out' : 'source-over'
          }
        />
      )}
      {isSelected && !effLocked && (
        <Rect
          x={0}
          y={0}
          width={layer.crop ? layer.crop.width : layer.width}
          height={layer.crop ? layer.crop.height : layer.height}
          stroke="rgba(251,146,60,0.4)"
          strokeWidth={1 / Math.max(0.0001, Math.abs(layer.scaleX))}
          listening={false}
        />
      )}
    </Group>
  );
}

interface BrushLayerNodeProps {
  layer: Layer;
  draggable: boolean;
  listening: boolean;
  pendingPaintStroke: BrushStroke | null;
  onSelect: (shift: boolean) => void;
  onChange: (patch: Partial<Layer>) => void;
  registerNode: (node: Konva.Node | null) => void;
}

function BrushLayerNode({
  layer,
  draggable,
  listening,
  pendingPaintStroke,
  onSelect,
  onChange,
  registerNode
}: BrushLayerNodeProps): JSX.Element {
  const groupRef = useRef<Konva.Group>(null);

  useEffect(() => {
    registerNode(groupRef.current);
    return () => registerNode(null);
  }, [registerNode]);

  const strokes = layer.strokes ?? [];

  return (
    <Group
      ref={groupRef}
      x={layer.x}
      y={layer.y}
      scaleX={layer.scaleX}
      scaleY={layer.scaleY}
      rotation={(layer.rotation * 180) / Math.PI}
      skewX={layer.skewX}
      skewY={layer.skewY}
      opacity={layer.opacity}
      globalCompositeOperation={layer.blendMode}
      draggable={draggable}
      listening={listening}
      onClick={(e) => onSelect(!!(e.evt as MouseEvent).shiftKey)}
      onTap={() => onSelect(false)}
      onDragEnd={(e) => onChange({ x: e.target.x(), y: e.target.y() })}
      onTransformEnd={() => {
        const node = groupRef.current;
        if (!node) return;
        onChange({
          x: node.x(),
          y: node.y(),
          scaleX: node.scaleX(),
          scaleY: node.scaleY(),
          rotation: (node.rotation() * Math.PI) / 180,
          skewX: node.skewX(),
          skewY: node.skewY()
        });
      }}
    >
      {strokes.map((s) => (
        <Line
          key={s.id}
          points={s.points}
          stroke={s.color}
          strokeWidth={s.size}
          opacity={s.opacity}
          lineCap="round"
          lineJoin="round"
          tension={0.4}
          listening={false}
          globalCompositeOperation={s.tool === 'erase' ? 'destination-out' : 'source-over'}
        />
      ))}
      {pendingPaintStroke && pendingPaintStroke.points.length >= 2 && (
        <Line
          points={pendingPaintStroke.points}
          stroke={pendingPaintStroke.color}
          strokeWidth={pendingPaintStroke.size}
          opacity={pendingPaintStroke.opacity}
          lineCap="round"
          lineJoin="round"
          tension={0.4}
          listening={false}
          globalCompositeOperation={
            pendingPaintStroke.tool === 'erase' ? 'destination-out' : 'source-over'
          }
        />
      )}
    </Group>
  );
}

interface TextNodeProps {
  layer: Layer;
  draggable: boolean;
  listening: boolean;
  onSelect: (shift: boolean) => void;
  onChange: (patch: Partial<Layer>) => void;
  registerNode: (node: Konva.Node | null) => void;
}

function TextNode({ layer, draggable, listening, onSelect, onChange, registerNode }: TextNodeProps): JSX.Element {
  const ref = useRef<Konva.Text>(null);
  useEffect(() => {
    registerNode(ref.current);
    return () => registerNode(null);
  }, [registerNode]);
  return (
    <KonvaText
      ref={ref}
      x={layer.x}
      y={layer.y}
      scaleX={layer.scaleX}
      scaleY={layer.scaleY}
      rotation={(layer.rotation * 180) / Math.PI}
      opacity={layer.opacity}
      globalCompositeOperation={layer.blendMode}
      text={layer.text ?? ''}
      fontSize={layer.fontSize ?? 32}
      fontFamily={layer.fontFamily ?? 'Inter'}
      fontStyle={
        [layer.fontStyle === 'italic' ? 'italic' : '', layer.fontWeight === 'bold' ? 'bold' : '']
          .filter(Boolean)
          .join(' ') || 'normal'
      }
      align={layer.align ?? 'left'}
      fill={layer.fillColor ?? '#ffffffff'}
      textDecoration={layer.textUnderline ? 'underline' : ''}
      stroke={layer.strokeColor || undefined}
      strokeWidth={layer.strokeWidth ?? 0}
      fillAfterStrokeEnabled
      shadowColor={layer.shadowColor || undefined}
      shadowBlur={layer.shadowBlur ?? 0}
      shadowOffsetX={layer.shadowOffsetX ?? 0}
      shadowOffsetY={layer.shadowOffsetY ?? 0}
      shadowOpacity={layer.shadowColor ? 1 : 0}
      width={layer.width}
      draggable={draggable}
      listening={listening}
      onClick={(e) => onSelect(!!(e.evt as MouseEvent).shiftKey)}
      onTap={() => onSelect(false)}
      onDragEnd={(e) => onChange({ x: e.target.x(), y: e.target.y() })}
      onTransformEnd={() => {
        const node = ref.current;
        if (!node) return;
        onChange({
          x: node.x(),
          y: node.y(),
          scaleX: node.scaleX(),
          scaleY: node.scaleY(),
          rotation: (node.rotation() * Math.PI) / 180
        });
      }}
    />
  );
}

interface ShapeNodeProps {
  layer: Layer;
  draggable: boolean;
  listening: boolean;
  onSelect: (shift: boolean) => void;
  onChange: (patch: Partial<Layer>) => void;
  registerNode: (node: Konva.Node | null) => void;
}

function ShapeNode({ layer, draggable, listening, onSelect, onChange, registerNode }: ShapeNodeProps): JSX.Element | null {
  const rectRef = useRef<Konva.Rect>(null);
  const ellRef = useRef<Konva.Ellipse>(null);

  useEffect(() => {
    const node = layer.shapeKind === 'rect' ? rectRef.current : ellRef.current;
    registerNode(node);
    return () => registerNode(null);
  }, [registerNode, layer.shapeKind]);

  const onClick = (e: Konva.KonvaEventObject<MouseEvent>): void =>
    onSelect(!!(e.evt as MouseEvent).shiftKey);
  const onTransformEnd = (): void => {
    const node = layer.shapeKind === 'rect' ? rectRef.current : ellRef.current;
    if (!node) return;
    onChange({
      x: node.x(),
      y: node.y(),
      scaleX: node.scaleX(),
      scaleY: node.scaleY(),
      rotation: (node.rotation() * Math.PI) / 180,
      skewX: node.skewX(),
      skewY: node.skewY()
    });
  };

  if (layer.shapeKind === 'rect') {
    return (
      <Rect
        ref={rectRef}
        x={layer.x}
        y={layer.y}
        scaleX={layer.scaleX}
        scaleY={layer.scaleY}
        rotation={(layer.rotation * 180) / Math.PI}
        opacity={layer.opacity}
        globalCompositeOperation={layer.blendMode}
        fill={layer.fillColor ?? '#fb923cff'}
        stroke={layer.strokeColor || undefined}
        strokeWidth={layer.strokeWidth ?? 0}
        width={layer.width}
        height={layer.height}
        draggable={draggable}
        listening={listening}
        onClick={onClick}
        onTap={() => onSelect(false)}
        onDragEnd={(e) => onChange({ x: e.target.x(), y: e.target.y() })}
        onTransformEnd={onTransformEnd}
      />
    );
  }
  return (
    <Ellipse
      ref={ellRef}
      x={layer.x + layer.width / 2}
      y={layer.y + layer.height / 2}
      scaleX={layer.scaleX}
      scaleY={layer.scaleY}
      rotation={(layer.rotation * 180) / Math.PI}
      opacity={layer.opacity}
      globalCompositeOperation={layer.blendMode}
      fill={layer.fillColor ?? '#fb923cff'}
      stroke={layer.strokeColor || undefined}
      strokeWidth={layer.strokeWidth ?? 0}
      radiusX={layer.width / 2}
      radiusY={layer.height / 2}
      draggable={draggable}
      listening={listening}
      onClick={onClick}
      onTap={() => onSelect(false)}
      onDragEnd={(e) =>
        onChange({
          x: e.target.x() - layer.width / 2,
          y: e.target.y() - layer.height / 2
        })
      }
      onTransformEnd={onTransformEnd}
    />
  );
}

/** 把世界坐标（画布 px）转换为图层局部坐标（用于笔刷写入） */
function worldToLocal(layer: Layer, x: number, y: number): { x: number; y: number } {
  // 反向应用：translate(layer.x,y) → rotate → scale → skew (近似忽略)
  const dx = x - layer.x;
  const dy = y - layer.y;
  const cos = Math.cos(-layer.rotation);
  const sin = Math.sin(-layer.rotation);
  const rx = dx * cos - dy * sin;
  const ry = dx * sin + dy * cos;
  const sx = layer.scaleX || 1;
  const sy = layer.scaleY || 1;
  return { x: rx / sx, y: ry / sy };
}
