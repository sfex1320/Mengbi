/**
 * ComfyUI 节点「上游 → 控件值」分发（纯函数，从 smartCanvasRunner.runComfyNode 抽出，便于单测与批量复用）。
 * merge 语义与抽出前逐字节等价；override 用于「逐条提示词 / 逐张图」批量模式按条覆盖。
 */
import type { InputControl } from '@/types/comfyui';
import type { SizeSpec, ComfyMultiMode, ComfyInputBinding } from '@/types/smartCanvas';

export const COMFY_TEXT_KINDS = new Set(['text', 'textarea', 'prompt']);
export const COMFY_IMAGE_KINDS = new Set(['image', 'multi_image', 'mask']);

/**
 * 模板里哪些控件是「可被画布喂入」的输入槽：文本（提示词）+ 图片 + 遮罩（局部重绘 mask）。其余参数用工作流里调好的值。
 * image 只含 image/multi_image；mask（局部重绘遮罩）单独成槽，喂上游 inpaint 遮罩而非普通图。
 */
export function comfyInputSlots(controls: InputControl[]): { text: InputControl[]; image: InputControl[]; mask: InputControl[] } {
  return {
    text: controls.filter((c) => COMFY_TEXT_KINDS.has(c.type)),
    image: controls.filter((c) => c.type === 'image' || c.type === 'multi_image'),
    mask: controls.filter((c) => c.type === 'mask')
  };
}

/**
 * ComfyUI「尽力而为」尺寸匹配：判断一个数值控件是宽还是高（按 id/label/group 名字启发式）。
 * 先判 height（避免「宽高」同含时误判），仅 number/slider 参与；识别不到返回 null（不动用工作流默认）。
 */
export function comfySizeRole(c: InputControl): 'width' | 'height' | null {
  if (c.type !== 'number' && c.type !== 'slider') return null;
  const key = `${c.id} ${c.label} ${c.group ?? ''}`;
  if (/(^|[^a-z])h(eight)?([^a-z]|$)|高/i.test(key)) return 'height';
  if (/(^|[^a-z])w(idth)?([^a-z]|$)|宽/i.test(key)) return 'width';
  return null;
}

export interface ComfyDispatchInput {
  prompts: string[];
  images: string[];
  /** 上游局部重绘遮罩（OpenAI「透明=编辑区」PNG 的 dataURI/路径）；喂给工作流的 mask 控件（Flux Fill / inpaint）。 */
  masks?: string[];
  size?: SizeSpec;
}

/** 批量模式的按条覆盖：promptIndex=只喂该条提示词（第一个文本控件）；imageIndex=只喂该张图（唯一图片控件）。 */
export interface ComfyDispatchOverride {
  promptIndex?: number;
  imageIndex?: number;
}

/** 安全取第 i 项（越界回退末项；空列表返回 undefined）。 */
function pick<T>(arr: T[], i: number): T | undefined {
  if (!arr.length) return undefined;
  return arr[Math.min(Math.max(0, i), arr.length - 1)];
}

/**
 * 组装一次运行的 controlValues：用户调好的参数 + 上游提示词/图片覆盖输入槽 + 上游尺寸喂宽高控件。
 * 无 override / 无 bindings 时 = merge 现状语义（多提示词分发到多文本控件 / 多图按序进图片控件，逐字节等价）。
 * bindings（controlId → ComfyInputBinding）= 用户显式指定「上游第 i 条提示词/第 j 张图 → 哪个控件」：
 * 被显式消费的条目从自动分发池剔除，其余槽位继续按序自动分发；off = 该槽不接收上游。
 * override（逐条提示词/逐张图批量迭代）优先级最高——作用于迭代维度时该维度的 bindings 被忽略（每轮只有当前条）。
 */
export function buildComfyControlValues(
  controls: InputControl[],
  controlValues: Record<string, unknown>,
  input: ComfyDispatchInput,
  override?: ComfyDispatchOverride,
  bindings?: Record<string, ComfyInputBinding>
): Record<string, unknown> {
  const cv: Record<string, unknown> = { ...controlValues };
  const slots = comfyInputSlots(controls);
  const bindOf = (c: InputControl): ComfyInputBinding | undefined => bindings?.[c.id];

  // ── 文本 ──
  // override.promptIndex（逐条迭代）时忽略 prompt 绑定：每轮只有当前条，绑定序号无意义。
  const promptBindingsActive = override?.promptIndex == null && !!bindings;
  const prompts =
    override?.promptIndex != null
      ? [input.prompts[override.promptIndex]].filter((x): x is string => !!x?.trim())
      : input.prompts;
  let tslots = slots.text;
  let autoPrompts = prompts;
  if (promptBindingsActive) {
    const consumed = new Set<number>();
    const autoSlots: InputControl[] = [];
    for (const c of tslots) {
      const b = bindOf(c);
      if (b?.kind === 'off') continue; // 不接收上游，保留手填/默认
      if (b?.kind === 'prompt') {
        const v = pick(prompts, b.index);
        if (v?.trim()) cv[c.id] = v;
        consumed.add(Math.min(Math.max(0, b.index), Math.max(0, prompts.length - 1)));
        continue;
      }
      autoSlots.push(c);
    }
    tslots = autoSlots;
    autoPrompts = prompts.filter((_, i) => !consumed.has(i));
  }
  // 多提示词分发到多文本控件（按顺序：第 i 个提示词 → 第 i 个文本控件；提示词比控件多时，多出的并入最后一个控件）。
  // 单文本控件时仍全部合并进它；override 单条时只有一条，天然落进第一个文本控件。
  if (tslots.length === 1) {
    if (autoPrompts.length) cv[tslots[0].id] = autoPrompts.join('\n');
  } else if (tslots.length > 1) {
    tslots.forEach((c, i) => {
      const part = i < tslots.length - 1 ? autoPrompts[i] : autoPrompts.slice(i).join('\n');
      if (part) cv[c.id] = part;
    });
  }

  // ── 图片 ──
  // override.imageIndex（逐张迭代）时忽略 image 绑定：每轮只有当前张。
  const imageBindingsActive = override?.imageIndex == null && !!bindings;
  const images = override?.imageIndex != null ? [input.images[override.imageIndex]].filter(Boolean) : input.images;
  let islots = slots.image;
  let autoImages = images;
  if (imageBindingsActive) {
    const consumed = new Set<number>();
    const autoSlots: InputControl[] = [];
    for (const c of islots) {
      const b = bindOf(c);
      if (b?.kind === 'off') continue;
      if (b?.kind === 'all-images') {
        if (images.length) cv[c.id] = c.type === 'multi_image' ? images : images[0];
        images.forEach((_, i) => consumed.add(i));
        continue;
      }
      if (b?.kind === 'image') {
        const v = pick(images, b.index);
        if (v) cv[c.id] = c.type === 'multi_image' ? [v] : v;
        consumed.add(Math.min(Math.max(0, b.index), Math.max(0, images.length - 1)));
        continue;
      }
      autoSlots.push(c);
    }
    islots = autoSlots;
    autoImages = images.filter((_, i) => !consumed.has(i));
  }
  // 多图分发到多图片控件（multi_image 给全部；单图控件按序，不足回退首图）。
  islots.forEach((c, i) => {
    if (c.type === 'multi_image') {
      if (autoImages.length) cv[c.id] = autoImages;
    } else {
      const img = autoImages[i] ?? autoImages[0];
      if (img) cv[c.id] = img;
    }
  });

  // ── 遮罩（局部重绘 mask 控件）──
  // mask 不参与 override 迭代维度（遮罩在批量里是常量）；显式绑定 kind:'mask' 指定第 i 个遮罩，其余按序自动。
  // 无 mask 控件 + 无上游遮罩时该段空操作 → 与历史图片分发逐字节等价。
  const masks = input.masks ?? [];
  let mslots = slots.mask;
  let autoMasks = masks;
  if (bindings && mslots.length) {
    const consumed = new Set<number>();
    const autoSlots: InputControl[] = [];
    for (const c of mslots) {
      const b = bindOf(c);
      if (b?.kind === 'off') continue;
      if (b?.kind === 'mask') {
        const v = pick(masks, b.index);
        if (v) cv[c.id] = v;
        consumed.add(Math.min(Math.max(0, b.index), Math.max(0, masks.length - 1)));
        continue;
      }
      autoSlots.push(c);
    }
    mslots = autoSlots;
    autoMasks = masks.filter((_, i) => !consumed.has(i));
  }
  mslots.forEach((c, i) => {
    const m = autoMasks[i] ?? autoMasks[0];
    if (m) cv[c.id] = m;
  });

  // 上游「尺寸来源」尽力而为：把宽/高喂给名字像 width/height/宽/高 的数值控件（识别不到则不动）；
  // emit='aspect'（只比例）时跳过——ComfyUI 需要具体像素，只给比例无意义。
  const upSize = input.size;
  if (upSize && (upSize.emit ?? 'both') !== 'aspect') {
    for (const c of controls) {
      const role = comfySizeRole(c);
      if (role === 'height') cv[c.id] = upSize.height;
      else if (role === 'width') cv[c.id] = upSize.width;
    }
  }
  return cv;
}

/**
 * 当前上游输入下，该 ComfyUI 节点可用的运行模式：
 * - merge 永远可用（现状单次）；
 * - per-prompt：≥2 条上游提示词 且 模板有 ≥1 个文本控件；
 * - per-image：≥2 张上游图 且 模板恰好 1 个「单图」控件（multi_image 不算——它本来就吃全部图）。
 */
export function availableComfyModes(controls: InputControl[], input: ComfyDispatchInput): ComfyMultiMode[] {
  const out: ComfyMultiMode[] = ['merge'];
  const slots = comfyInputSlots(controls);
  if (input.prompts.length > 1 && slots.text.length >= 1) out.push('per-prompt');
  const singleImageSlots = slots.image.filter((c) => c.type !== 'multi_image');
  if (input.images.length > 1 && singleImageSlots.length === 1) out.push('per-image');
  return out;
}

/** 某模式当前不可用的原因（检查器灰显说明）。可用时返回 null。 */
export function comfyModeUnavailableReason(
  mode: ComfyMultiMode,
  controls: InputControl[],
  input: ComfyDispatchInput
): string | null {
  if (mode === 'merge') return null;
  const slots = comfyInputSlots(controls);
  if (mode === 'per-prompt') {
    if (slots.text.length < 1) return '该工作流没有文本（提示词）控件';
    if (input.prompts.length < 2) return '需要 ≥2 条上游提示词（连入多条提示词 / 分镜后可用）';
    return null;
  }
  const singleImageSlots = slots.image.filter((c) => c.type !== 'multi_image');
  if (singleImageSlots.length !== 1) return '需要工作流恰好有 1 个单图输入控件';
  if (input.images.length < 2) return '需要 ≥2 张上游图片（连入多图 / 文件夹输入后可用）';
  return null;
}
