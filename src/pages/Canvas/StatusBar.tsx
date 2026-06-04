import { useCanvasStore } from '@/store/canvasStore';

interface Props {
  zoom: number;
  tool: 'select' | 'hand' | 'brush' | 'eraser' | 'mask';
  cursor: { x: number; y: number } | null;
}

const TOOL_LABEL: Record<Props['tool'], string> = {
  select: '↖ 选择',
  hand: '✋ 抓手',
  brush: '✎ 画笔',
  eraser: '⌫ 橡皮',
  mask: '◐ 蒙版'
};

/**
 * 底部状态栏：显示当前工具 / 缩放 / 鼠标坐标 / 选中图层信息。
 * 高 28px，复用主题 token。
 */
export function StatusBar({ zoom, tool, cursor }: Props): JSX.Element {
  const project = useCanvasStore((s) => s.project);
  const layer = project.layers.find((l) => l.id === project.selectedId) ?? null;

  return (
    <div className="mb-canvas-statusbar">
      <span className="mb-canvas-statusbar-cell">{TOOL_LABEL[tool]}</span>
      <span className="mb-canvas-statusbar-cell">缩放 {Math.round(zoom * 100)}%</span>
      <span className="mb-canvas-statusbar-cell">
        画板 {project.width}×{project.height}
      </span>
      <span className="mb-canvas-statusbar-cell">
        {cursor
          ? `坐标 ${Math.round(cursor.x)}, ${Math.round(cursor.y)}`
          : '坐标 —, —'}
      </span>
      <span className="mb-canvas-statusbar-cell mb-canvas-statusbar-flex">
        {layer ? (
          <>
            <span className="mb-canvas-statusbar-dot" />
            {layer.name} · {Math.round(layer.width * Math.abs(layer.scaleX))}×
            {Math.round(layer.height * Math.abs(layer.scaleY))}
            {layer.locked ? ' · 已锁' : ''}
            {!layer.visible ? ' · 已隐藏' : ''}
          </>
        ) : (
          <>未选中图层</>
        )}
      </span>
    </div>
  );
}
