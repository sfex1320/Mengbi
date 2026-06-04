import { useMemo } from 'react';
import { ReactFlow, Background, Controls, type Node, type Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useComfyuiStore } from '@/store/comfyuiStore';
import { nodeNameZh, portNameZh } from './nodeLabels';
import type { ParsedGraph } from '@shared/comfyui';

/** 简易分层布局：x 按"到根的最长路径"分列，y 按列内顺序。API 格式没有坐标，自动排。 */
function layout(graph: ParsedGraph): { nodes: Node[]; edges: Edge[] } {
  const depth = new Map<string, number>();
  // 预建 目标节点 → 父节点 索引，避免每节点 O(边数) 过滤（大工作流会卡）
  const parentsByNode = new Map<string, string[]>();
  for (const e of graph.edges) {
    const arr = parentsByNode.get(e.toNode);
    if (arr) arr.push(e.fromNode);
    else parentsByNode.set(e.toNode, [e.fromNode]);
  }

  const calc = (id: string, seen: Set<string>): number => {
    const cached = depth.get(id);
    if (cached !== undefined) return cached;
    if (seen.has(id)) return 0;
    seen.add(id);
    const ps = parentsByNode.get(id) ?? [];
    const d = ps.length ? Math.max(...ps.map((p) => calc(p, seen))) + 1 : 0;
    depth.set(id, d);
    return d;
  };
  for (const n of graph.nodes) calc(n.id, new Set());

  const colCount = new Map<number, number>();
  const nodes: Node[] = graph.nodes.map((n) => {
    const d = depth.get(n.id) ?? 0;
    const row = colCount.get(d) ?? 0;
    colCount.set(d, row + 1);
    return {
      id: n.id,
      position: { x: d * 240, y: row * 96 },
      data: { label: `${nodeNameZh(n.classType)}${n.unknown ? ' ⚠' : ''}  #${n.id}` },
      style: {
        fontSize: 11,
        borderRadius: 10,
        padding: 6,
        width: 200,
        border: '1px solid var(--mb-border)',
        background: 'var(--mb-bg-card-solid)',
        color: 'var(--mb-text-primary)'
      }
    };
  });

  const edges: Edge[] = graph.edges.map((e, i) => ({
    id: `e${i}-${e.fromNode}-${e.toNode}-${e.toInput}`,
    source: e.fromNode,
    target: e.toNode,
    // 连线功能：按目标输入端口名翻成中文（模型/潜空间/正向条件/图像…）
    label: portNameZh(e.toInput),
    labelStyle: { fontSize: 10, fill: 'var(--mb-text-secondary)' },
    labelBgStyle: { fill: 'var(--mb-bg-card-solid)', fillOpacity: 0.85 },
    style: { stroke: 'var(--mb-border-strong)' },
    animated: false
  }));

  return { nodes, edges };
}

export function GraphCanvas(): JSX.Element {
  const graph = useComfyuiStore((s) => s.activeGraph);
  const selectedNodeId = useComfyuiStore((s) => s.selectedNodeId);
  const setSelectedNode = useComfyuiStore((s) => s.setSelectedNode);
  const activeBindings = useComfyuiStore((s) => s.activeBindings);
  const base = useMemo(() => (graph ? layout(graph) : { nodes: [], edges: [] }), [graph]);

  const bypassed = useMemo(
    () => new Set(activeBindings.filter((b) => b.mode === 'bypass').map((b) => b.nodeId)),
    [activeBindings]
  );

  // 选中高亮 + 被绕过节点标记（虚线 + 淡化 + 标题前缀）
  const nodes = useMemo(
    () =>
      base.nodes.map((n) => {
        let style = n.style;
        let data = n.data;
        if (bypassed.has(n.id)) {
          style = {
            ...style,
            border: '1px dashed var(--mb-border-strong)',
            opacity: 0.45
          };
          data = { ...n.data, label: `⏭ 忽略 · ${String((n.data as { label?: string }).label ?? '')}` };
        }
        if (n.id === selectedNodeId) {
          style = { ...style, border: '2px solid var(--mb-accent)' };
        }
        return { ...n, style, data };
      }),
    [base.nodes, selectedNodeId, bypassed]
  );
  const edges = base.edges;

  if (!graph) {
    return <div className="mb-cfy-graph-empty">导入工作流后，这里显示节点流程图</div>;
  }

  return (
    <div className="mb-cfy-graph">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
        onNodeClick={(_e, node) => setSelectedNode(node.id)}
        proOptions={{ hideAttribution: true }}
        minZoom={0.1}
      >
        <Background gap={18} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
