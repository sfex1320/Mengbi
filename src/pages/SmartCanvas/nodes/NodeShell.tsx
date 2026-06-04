import { Handle, Position } from '@xyflow/react';

/**
 * 节点外壳（CanvasNode 基座）：彩色标题条 + 左输入/右输出连接点 + 删除。
 * 左口=输入（可从它拖出 → 建「上游」节点）；右口=输出（拖出 → 建「下游」节点）。
 * 交互元素需加 `nodrag` 防止拖动节点时误触。
 */
export function NodeShell({
  title,
  accent,
  inputs,
  outputs,
  fill,
  onDelete,
  headRight,
  label,
  labelColor,
  children
}: {
  title: string;
  accent: string;
  inputs?: boolean;
  outputs?: boolean;
  /** 可调尺寸节点：撑满 React Flow 节点框 */
  fill?: boolean;
  onDelete?: () => void;
  headRight?: React.ReactNode;
  /** 用户标签 / 注释（彩色小条，显示在标题条下方） */
  label?: string;
  labelColor?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className={`mb-sc-node ${accent} ${fill ? 'is-fill' : ''}`}>
      {inputs && (
        <Handle
          id="in"
          type="target"
          position={Position.Left}
          isConnectableStart
          className="mb-sc-handle mb-sc-handle-in"
        />
      )}
      <div className="mb-sc-node-head">
        <span className="mb-sc-node-title">{title}</span>
        <div className="mb-sc-node-headright">
          {headRight}
          {onDelete && (
            <button className="mb-sc-node-x nodrag" onClick={onDelete} title="删除节点">
              ✕
            </button>
          )}
        </div>
      </div>
      {label ? (
        <div className="mb-sc-node-tag" style={{ background: labelColor || 'var(--mb-accent)' }} title={label}>
          {label}
        </div>
      ) : null}
      <div className="mb-sc-node-body">{children}</div>
      {outputs && <Handle id="out" type="source" position={Position.Right} className="mb-sc-handle mb-sc-handle-out" />}
    </div>
  );
}
