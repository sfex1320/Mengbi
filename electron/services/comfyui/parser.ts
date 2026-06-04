/**
 * ComfyUI workflow 解析（纯函数，无 IO）。
 * - detectFormat：区分 API 格式 / UI(save) 格式 / 无法识别
 * - parseApiWorkflow：抽节点 + 连线
 * - substitutePlaceholders：第一阶段用占位符把可选输入写进 workflow（沿用生图侧语义）
 */
import type {
  ComfyApiWorkflow,
  ComfyApiNode,
  ParsedGraph,
  ParsedNode,
  ParsedEdge,
  WorkflowFormat
} from '@shared/comfyui';

/** input 值是否为连线：[nodeId, outputIndex] 形如 ["12", 0] */
function isLink(v: unknown): v is [string | number, number] {
  return (
    Array.isArray(v) &&
    v.length === 2 &&
    (typeof v[0] === 'string' || typeof v[0] === 'number') &&
    typeof v[1] === 'number'
  );
}

/** 一个值是否长得像 API 节点：{ class_type:string, inputs:object } */
function looksLikeApiNode(v: unknown): v is ComfyApiNode {
  if (!v || typeof v !== 'object') return false;
  const n = v as Record<string, unknown>;
  return typeof n.class_type === 'string' && !!n.inputs && typeof n.inputs === 'object';
}

export function detectFormat(json: unknown): WorkflowFormat {
  if (!json || typeof json !== 'object') return 'unknown';
  const obj = json as Record<string, unknown>;
  // UI / save 格式：顶层有 nodes 数组（+ 通常 links / groups）
  if (Array.isArray(obj.nodes)) return 'ui';
  // API 格式：是一个 { nodeId: {class_type, inputs} } 的 map
  const values = Object.values(obj);
  if (values.length > 0 && values.every((v) => looksLikeApiNode(v))) return 'api';
  return 'unknown';
}

/**
 * 解析 API workflow 为节点图。
 * @param knownClassTypes 可选：object_info 里已知的 class_type 集合，用于标记 unknown 节点。
 *   不传则所有节点 unknown=false（第一阶段没拉 object_info 时不阻塞）。
 */
export function parseApiWorkflow(
  workflow: ComfyApiWorkflow,
  knownClassTypes?: Set<string>
): ParsedGraph {
  const nodes: ParsedNode[] = [];
  const edges: ParsedEdge[] = [];

  for (const [id, node] of Object.entries(workflow)) {
    if (!looksLikeApiNode(node)) continue;
    const params: ParsedNode['params'] = [];
    const linkedInputs: string[] = [];

    for (const [inputName, value] of Object.entries(node.inputs ?? {})) {
      if (isLink(value)) {
        linkedInputs.push(inputName);
        edges.push({
          fromNode: String(value[0]),
          fromOutput: value[1],
          toNode: id,
          toInput: inputName
        });
      } else {
        params.push({ name: inputName, value });
      }
    }

    nodes.push({
      id,
      classType: node.class_type,
      title: node._meta?.title,
      params,
      linkedInputs,
      unknown: knownClassTypes ? !knownClassTypes.has(node.class_type) : false
    });
  }

  return { nodes, edges };
}

/**
 * 递归把值为完整 `{{var}}` 字符串的字段替换为 variables[var]。
 * 子串拼接（"prefix-{{var}}"）不替换。返回深拷贝，不改原对象。
 */
export function substitutePlaceholders(
  obj: unknown,
  variables: Record<string, string | number>
): unknown {
  if (typeof obj === 'string') {
    const m = /^\{\{(\w+)\}\}$/.exec(obj.trim());
    if (m && m[1] in variables) return variables[m[1]];
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map((x) => substitutePlaceholders(x, variables));
  }
  if (obj && typeof obj === 'object') {
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      next[k] = substitutePlaceholders(v, variables);
    }
    return next;
  }
  return obj;
}
