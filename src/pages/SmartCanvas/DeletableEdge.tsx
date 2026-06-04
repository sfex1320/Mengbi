import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  getStraightPath,
  getSmoothStepPath,
  type EdgeProps
} from '@xyflow/react';
import { useSmartCanvasStore } from '@/store/smartCanvasStore';
import { useSmartViewStore } from '@/store/smartViewStore';

/** 自定义连线：按视图偏好走 曲线/直线/折线 + 中点一个 × 圆钮删除该连线。颜色/箭头由 props（style/markerEnd）控制。 */
export function DeletableEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  selected
}: EdgeProps): JSX.Element {
  const removeEdge = useSmartCanvasStore((s) => s.removeEdge);
  const edgeStyle = useSmartViewStore((s) => s.edgeStyle);

  const geo = { sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition };
  const [path, labelX, labelY] =
    edgeStyle === 'straight'
      ? getStraightPath({ sourceX, sourceY, targetX, targetY })
      : edgeStyle === 'step'
        ? getSmoothStepPath(geo)
        : getBezierPath(geo);

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        <button
          className={`mb-sc-edge-x nodrag nopan ${selected ? 'is-selected' : ''}`}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          title="删除连线"
          onClick={(e) => {
            e.stopPropagation();
            removeEdge(id);
          }}
        >
          ×
        </button>
      </EdgeLabelRenderer>
    </>
  );
}
