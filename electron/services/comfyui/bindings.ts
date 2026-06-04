/**
 * 绑定运行时写入：把 mengbi 输入控件的值写进 runtime workflow 的真实节点字段。
 * 第二阶段实现 parameter 模式（字段级写入）+ seed 随机；connection/expression/preset/
 * file_upload/enabled_switch 留待 P3/P5（这里遇到先跳过，不报错）。
 * 永远深拷贝原始 workflow，绝不污染模板。
 */
import type { ComfyApiWorkflow, InputControl, Binding } from '@shared/comfyui';

function coerce(raw: unknown, ctrl: InputControl | undefined, current: unknown): unknown {
  const t = ctrl?.type;
  if (t === 'number' || t === 'slider' || t === 'seed') return Number(raw);
  if (t === 'switch') return Boolean(raw);
  if (typeof current === 'number') return Number(raw);
  if (typeof current === 'boolean') return Boolean(raw);
  return raw;
}

export function applyBindings(
  original: ComfyApiWorkflow,
  controls: InputControl[],
  bindings: Binding[],
  values: Record<string, unknown>,
  /** file_upload 绑定用：控件 id → 已上传到 ComfyUI 的文件名 */
  uploadedFileMap: Record<string, string> = {}
): ComfyApiWorkflow {
  const runtime = structuredClone(original) as ComfyApiWorkflow;
  const byId = new Map<string, InputControl>(controls.map((c) => [c.id, c]));

  for (const b of bindings) {
    // 文件上传：把上传后的文件名写进绑定字段（如 LoadImage.image）
    if (b.mode === 'file_upload') {
      const node = runtime[b.nodeId];
      if (!node || !node.inputs) continue;
      const name = uploadedFileMap[b.controlId];
      if (name) node.inputs[b.inputName] = name;
      continue;
    }

    if (b.mode !== 'parameter') continue; // connection/expression/preset/enabled_switch 后续阶段
    const node = runtime[b.nodeId];
    if (!node || !node.inputs) continue;
    const ctrl = byId.get(b.controlId);
    let raw = values[b.controlId];

    // 种子：-1 / 空 / 非有限数 → 本轮随机
    if (ctrl?.type === 'seed') {
      const n = Number(raw);
      if (raw === undefined || raw === null || !Number.isFinite(n) || n < 0) {
        raw = Math.floor(Math.random() * 2_000_000_000);
      }
    }
    // 留空 → 不覆盖（保留工作流自带值）
    if (raw === undefined || raw === '') continue;

    node.inputs[b.inputName] = coerce(raw, ctrl, node.inputs[b.inputName]);
  }

  return runtime;
}

/** input 值是否为连线 [nodeId, outputIndex]（如 ["12", 0]） */
function isLink(v: unknown): v is [string | number, number] {
  return Array.isArray(v) && v.length === 2 && typeof v[1] === 'number';
}

/**
 * 节点「忽略/绕过」：把 bypassIds 里的节点从执行图摘除，其下游对它的引用直接接到它的输入源
 * （passthrough，模仿 ComfyUI 的 Bypass）。
 * 通用启发式（无需 object_info）：被绕过节点按"输入连线出现顺序"取源列表 srcs；
 * 下游读它的第 k 个输出 → 取 srcs[k]，没有就退回 srcs[0]；都没有则删掉该悬空输入。
 * 支持连续多个节点被绕过（递归解析，带环保护）。永远深拷贝，不污染入参。
 */
export function applyBypass(original: ComfyApiWorkflow, bypassIds: Set<string>): ComfyApiWorkflow {
  if (bypassIds.size === 0) return original;
  const wf = structuredClone(original) as ComfyApiWorkflow;

  // 每个被绕过节点的输入连线源（按出现顺序）
  const srcMap = new Map<string, Array<[string, number]>>();
  for (const id of bypassIds) {
    const srcs: Array<[string, number]> = [];
    const inputs = wf[id]?.inputs;
    if (inputs) {
      for (const v of Object.values(inputs)) {
        if (isLink(v)) srcs.push([String(v[0]), v[1]]);
      }
    }
    srcMap.set(id, srcs);
  }

  // 解析某个 [node, slot] 最终接到哪：若 node 也被绕过则继续往上找
  const resolve = (node: string, slot: number, seen: Set<string>): [string, number] | null => {
    if (!bypassIds.has(node)) return [node, slot];
    if (seen.has(node)) return null; // 环：放弃
    seen.add(node);
    const srcs = srcMap.get(node) ?? [];
    const pick = srcs[slot] ?? srcs[0];
    if (!pick) return null;
    return resolve(pick[0], pick[1], seen);
  };

  // 重连所有非绕过节点对绕过节点的引用
  for (const [nid, node] of Object.entries(wf)) {
    if (bypassIds.has(nid) || !node?.inputs) continue;
    for (const [inName, v] of Object.entries(node.inputs)) {
      if (isLink(v) && bypassIds.has(String(v[0]))) {
        const resolved = resolve(String(v[0]), v[1], new Set());
        if (resolved) node.inputs[inName] = resolved;
        else delete node.inputs[inName]; // 找不到源 → 删悬空输入（下游用默认/可选值）
      }
    }
  }

  for (const id of bypassIds) delete wf[id];
  return wf;
}
