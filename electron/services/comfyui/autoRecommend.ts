/**
 * 自动推荐绑定（非强制）：尽量多地把工作流里**字面量标量字段**变成可调控件 + parameter 绑定。
 *
 * 两步：
 *  1) 优先顺着采样器 positive/negative 连线，把真实的正/负提示词文本节点标成 prompt / negative
 *     （这样标签语义最准）。
 *  2) 通用扫描：遍历所有节点的所有**非连线**输入，凡字段名命中常见规则（text/text_g/text_l/
 *     seed/steps/cfg/denoise/width/height/sampler_name/scheduler/ckpt_name/...）就生成控件。
 *     已被第 1 步绑过的 (节点,字段) 跳过，避免重复。
 *
 * 值是连线（来自其它节点，如 Primitive 输入节点）的字段**不会**出现在这里——那属于连接级
 * 绑定，留待手动绑定 UI（后续阶段）。用户也可在 UI 里增删改这些控件。
 */
import type { ComfyApiWorkflow, InputControl, Binding } from '@shared/comfyui';

function asLink(v: unknown): [string, number] | null {
  if (Array.isArray(v) && v.length === 2 && typeof v[1] === 'number') {
    return [String(v[0]), v[1]];
  }
  return null;
}

function isScalar(v: unknown): v is string | number | boolean {
  return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
}

export interface Recommendation {
  inputControls: InputControl[];
  bindings: Binding[];
}

interface FieldRule {
  test: (name: string) => boolean;
  type: InputControl['type'];
  label: string;
  extra?: Partial<InputControl>;
  /** 仅当字段值是这些 JS 类型时才命中 */
  valueType?: 'string' | 'number' | 'boolean';
}

const RULES: FieldRule[] = [
  { test: (n) => n === 'seed' || n === 'noise_seed' || n === 'rand_seed', type: 'seed', label: '种子', valueType: 'number' },
  { test: (n) => n === 'steps', type: 'number', label: '步数', extra: { min: 1, max: 150, step: 1 }, valueType: 'number' },
  { test: (n) => n === 'cfg' || n === 'cfg_scale' || n === 'guidance', type: 'slider', label: 'CFG', extra: { min: 1, max: 30, step: 0.5 }, valueType: 'number' },
  { test: (n) => n === 'denoise' || n === 'denoising_strength', type: 'slider', label: '重绘幅度', extra: { min: 0, max: 1, step: 0.05 }, valueType: 'number' },
  { test: (n) => n === 'strength' || n === 'weight', type: 'slider', label: '强度', extra: { min: 0, max: 2, step: 0.05 }, valueType: 'number' },
  { test: (n) => n === 'width' || n === 'target_width' || n === 'tile_width', type: 'number', label: '宽', extra: { min: 64, max: 8192, step: 8 }, valueType: 'number' },
  { test: (n) => n === 'height' || n === 'target_height' || n === 'tile_height', type: 'number', label: '高', extra: { min: 64, max: 8192, step: 8 }, valueType: 'number' },
  { test: (n) => n === 'batch_size', type: 'number', label: '批量', extra: { min: 1, max: 16, step: 1 }, valueType: 'number' },
  { test: (n) => n === 'image', type: 'image', label: '图片', valueType: 'string' },
  { test: (n) => n === 'mask', type: 'mask', label: '遮罩', valueType: 'string' },
  { test: (n) => /^(text|prompt|text_g|text_l|positive|negative|wildcard_text|populated_text)$/.test(n), type: 'prompt', label: '文本', valueType: 'string' },
  { test: (n) => n === 'sampler_name', type: 'text', label: '采样器', valueType: 'string' },
  { test: (n) => n === 'scheduler', type: 'text', label: '调度器', valueType: 'string' },
  { test: (n) => /(ckpt_name|checkpoint|model_name|unet_name|vae_name|lora_name|control_net_name)/.test(n), type: 'text', label: '模型/权重', valueType: 'string' },
  { test: (n) => n === 'filename_prefix', type: 'text', label: '文件名前缀', valueType: 'string' }
];

function matchRule(name: string, value: unknown): FieldRule | null {
  for (const r of RULES) {
    if (!r.test(name)) continue;
    if (r.valueType && typeof value !== r.valueType) continue;
    return r;
  }
  return null;
}

/** 从 /object_info 取某节点某字段的 combo 选项（如 sampler_name 的全部采样器）。 */
function comboOptions(
  objectInfo: Record<string, unknown> | null | undefined,
  classType: string,
  field: string
): string[] | null {
  if (!objectInfo) return null;
  const node = objectInfo[classType];
  if (!node || typeof node !== 'object') return null;
  const input = (node as Record<string, unknown>).input;
  if (!input || typeof input !== 'object') return null;
  const req = (input as Record<string, unknown>).required;
  const opt = (input as Record<string, unknown>).optional;
  const pick = (o: unknown): unknown =>
    o && typeof o === 'object' ? (o as Record<string, unknown>)[field] : undefined;
  const spec = pick(req) ?? pick(opt);
  if (Array.isArray(spec) && Array.isArray(spec[0]) && spec[0].every((x) => typeof x === 'string')) {
    return spec[0] as string[];
  }
  return null;
}

const MAX_CONTROLS = 48;

export function recommendControls(
  workflow: ComfyApiWorkflow,
  objectInfo?: Record<string, unknown> | null
): Recommendation {
  const inputControls: InputControl[] = [];
  const bindings: Binding[] = [];
  const bound = new Set<string>(); // `${nodeId}::${inputName}`
  const key = (id: string, f: string): string => `${id}::${f}`;

  const add = (
    controlId: string,
    label: string,
    type: InputControl['type'],
    nodeId: string,
    inputName: string,
    extra?: Partial<InputControl>
  ): void => {
    if (bound.has(key(nodeId, inputName)) || inputControls.length >= MAX_CONTROLS) return;
    bound.add(key(nodeId, inputName));
    const isFile = type === 'image' || type === 'mask' || type === 'multi_image';
    inputControls.push({
      id: controlId,
      label,
      type,
      // 文件类控件默认值不放节点里的原文件名（避免误当作可填文本）
      default: isFile ? undefined : workflow[nodeId]?.inputs?.[inputName],
      group: isFile ? '参考图' : '常用',
      ...extra
    });
    bindings.push(
      isFile
        ? { mode: 'file_upload', controlId, nodeId, inputName }
        : { mode: 'parameter', controlId, nodeId, inputName }
    );
  };

  const entries = Object.entries(workflow);

  // ── 第 1 步：采样器 positive/negative → 真实提示词节点 ──
  for (const [, node] of entries) {
    const inp = node.inputs ?? {};
    const pos = asLink(inp.positive);
    const neg = asLink(inp.negative);
    if (!pos || !neg) continue;
    for (const [linkId, label, cid] of [
      [pos[0], '正向提示词', 'prompt'],
      [neg[0], '负向提示词', 'negative']
    ] as const) {
      const target = workflow[linkId]?.inputs ?? {};
      // 该文本节点上找一个字面量文本字段
      const textField = ['text', 'text_g', 'text_l', 'prompt', 'wildcard_text'].find(
        (f) => typeof target[f] === 'string'
      );
      if (textField) add(cid, label, cid === 'negative' ? 'textarea' : 'prompt', linkId, textField);
    }
    break;
  }

  // ── 第 2 步：通用扫描所有节点的字面量标量字段 ──
  for (const [id, node] of entries) {
    const inp = node.inputs ?? {};
    const title = node._meta?.title;
    for (const [field, value] of Object.entries(inp)) {
      if (asLink(value) || !isScalar(value)) continue; // 连线 / 非标量跳过
      const rule = matchRule(field, value);
      if (!rule) continue;
      // 文本类用节点标题做标签更可读；其余用规则标签
      const label =
        rule.type === 'prompt' || rule.type === 'textarea'
          ? (title ? `提示词 · ${title}` : `提示词（${node.class_type}）`)
          : title
            ? `${rule.label} · ${title}`
            : rule.label;
      // enum 字段（采样器/调度器/模型…）若 object_info 有选项 → 升级成下拉
      let type = rule.type;
      let extra = rule.extra;
      if (type === 'text') {
        const opts = comboOptions(objectInfo, node.class_type, field);
        if (opts && opts.length) {
          type = 'select';
          extra = { ...extra, options: opts.map((v) => ({ value: v, label: v })) };
        }
      }
      add(`${id}:${field}`, label, type, id, field, extra);
    }
  }

  return { inputControls, bindings };
}
