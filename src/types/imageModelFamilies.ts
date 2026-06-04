/**
 * 图像模型「系列（family）」一等公民化。
 *
 * 背景：当一个用户在 1:1 + 4K 的设置下喊"出 4K"，
 * 不同模型对参数的解释方式截然不同：
 *
 *   - GPT Image 2：要 size="WxH"，且必须满足像素预算 8.3MP。1:1 + 4K → 实际是 ~2880×2880。
 *   - Nano Banana 系列：要 image_size="4K" + aspect_ratio="1:1" 字面量；模型自己出真正 4K。
 *
 * 旧版生图把这三件（size / aspect_ratio / image_size）一股脑全发，导致
 * 中转站随机选一项，出现"4K 实际只出 1K"的 bug。
 *
 * 此文件把每个 family 的"参数能力"和"请求体构造"封装成 manifest，
 * 在 generate.ts 里 detectFamily(actualModelId).buildBody(...) 一行搞定。
 *
 * 这个模块跨进程使用：
 *   - electron/ipc/generate.ts 用 buildBody 构造请求体
 *   - src/pages/Create/index.tsx 用 supportedAspects / supportedTiers / supportsQuality
 *     做 UI 自适应（filter 出该 family 能识别的 aspect / 档位，不支持的项显示为禁用）
 *
 * 所有函数都是纯函数,不依赖 Node / DOM。
 */

export type ImageFamily =
  | 'gpt-image-2'
  | 'nano-banana-pro'
  | 'nano-banana-2'
  | 'nano-banana-flash'
  | 'default';

export type ImageSizeTier = '1K' | '2K' | '4K';

/** 给 buildBody 的入参——把 imageParamsStore.buildParams() 的输出拍平 */
export interface BodyBuilderInput {
  /** cfg.model_mapping[displayName] 解出来的真实模型 ID */
  modelId: string;
  prompt: string;
  /** 当前未从 store 接入；ChatPanel 里只有 positive，未来可补 */
  negativePrompt?: string;
  /** imageParamsStore.buildParams() 的输出（含 LoRA 拼好的 prompt 不在这里，外面拼） */
  params: {
    n?: number;
    width?: number;
    height?: number;
    aspect?: string;
    image_size?: string;
    quality?: string;
    /** 已拼好的 <lora:name:weight> 串；外面已经拼到 prompt 末尾，这里不再使用 */
    lora?: string;
  };
}

export interface FamilyManifest {
  id: ImageFamily;
  label: string;
  /** 一行说明，展示在 Create 页的 family 徽标 tooltip */
  description: string;
  /**
   * 该 family 能识别的"分辨率档位"。空数组 = 不使用 image_size 字段
   * （比如 GPT Image 2 用 size=WxH 字段表达分辨率，没有 1K/2K/4K 档）。
   */
  supportedTiers: ImageSizeTier[];
  /**
   * 该 family 能识别的 aspect_ratio。空数组 = 不传 aspect_ratio 字段。
   * 下面 COMMON_ASPECTS 提供一组通吃的；个别 family 可加 1:3 / 3:1 / 1:8 / 8:1 等。
   */
  supportedAspects: string[];
  supportsQuality: boolean;
  supportsNegativePrompt: boolean;
  maxN: number;
  /**
   * 单边像素预算 —— 仅 GPT Image 2 这种"按 WxH 走 size 字段"的 family 用。
   * Nano Banana 系列模型自己处理分辨率，这里设 0 表示"不需要客户端算 WxH"。
   */
  pixelBudget: number;
  /** 模型 ID 字符串识别——在 detectFamily 里按 FAMILIES 顺序逐个 match */
  matches: (modelId: string) => boolean;
  /** 构造请求体；仍会经过 applyBodyOverrides 做用户级覆盖 */
  buildBody: (input: BodyBuilderInput) => Record<string, unknown>;
  /**
   * 流式输出能力：仅 gpt-image-* 系列在 OpenAI 协议层真支持。
   * 配置后 runOpenAIImage 会自动给请求体加 `stream: true` + `partial_images: N`，
   * 并切换到 SSE 解析路径。中间步骤图作为心跳让中转的边缘代理不会因 60s 静默而切连接，
   * 解决 nowcoding 这类中转跑 GPT Image 4K 必超时的死局。
   *
   * partialImages: 0 = 只发完成事件（仍是 SSE 但无中间帧，对边缘超时帮助不大）
   * partialImages: 1–3 = 每次生成各发 N 张渐进图，N 越大心跳越密但带宽越高
   */
  streaming?: { partialImages: number };
}

const COMMON_ASPECTS = [
  '1:1',
  '4:5',
  '5:4',
  '3:4',
  '4:3',
  '2:3',
  '3:2',
  '9:16',
  '16:9',
  '21:9'
];

const TIER_PIXEL_BUDGET: Record<ImageSizeTier, number> = {
  '1K': 1_048_576,
  '2K': 4_194_304,
  '4K': 8_294_400
};

// ────────────────────────────────────────────────────
// 5 个 manifest（按 detectFamily 优先级倒排：pro/flash/2 优先匹配，default 兜底）
// ────────────────────────────────────────────────────

const GPT_IMAGE_2: FamilyManifest = {
  id: 'gpt-image-2',
  label: 'GPT Image 2',
  description:
    'OpenAI /v1/images/generations。用 size="WxH"（snap 到 16，硬上限 4096，像素预算 8.3MP 封顶）。' +
    '档位 1K/2K/4K 用作"目标像素预算"——按所选档位的预算 × aspect 反推 W×H。' +
    '不发 image_size / aspect_ratio——避免与 size 冲突。',
  supportedTiers: ['1K', '2K', '4K'],
  supportedAspects: [...COMMON_ASPECTS, '1:3', '3:1'],
  supportsQuality: true,
  supportsNegativePrompt: false,
  maxN: 4,
  pixelBudget: 8_294_400,
  matches: (id) => /gpt[\s\-_]*image[\s\-_]*2|gptimage2/i.test(id),
  buildBody: (input) => {
    const tier = input.params.image_size as ImageSizeTier | undefined;
    // GI2 上限 8.3MP；1K/2K 是用户主动选小，用来在弱中转站避开 60s 硬超时
    const budget =
      tier && TIER_PIXEL_BUDGET[tier] ? TIER_PIXEL_BUDGET[tier] : 8_294_400;
    const size = computeSize(input.params, budget);
    const body: Record<string, unknown> = {
      model: input.modelId,
      prompt: input.prompt,
      size,
      n: clampN(input.params.n, 4),
      response_format: 'b64_json'
    };
    const q = input.params.quality;
    if (q === 'standard' || q === 'high' || q === 'low' || q === 'medium') {
      body.quality = q;
    }
    return body;
  }
};

const NANO_BANANA_PRO: FamilyManifest = {
  id: 'nano-banana-pro',
  label: 'Nano Banana Pro',
  description:
    'Pro 系列：image_size + aspect_ratio 字面量；不算 WxH（避免误降分辨率）。' +
    '模型最大 4K，支持 quality。',
  supportedTiers: ['1K', '2K', '4K'],
  supportedAspects: [...COMMON_ASPECTS, '1:4', '4:1', '1:8', '8:1'],
  supportsQuality: true,
  supportsNegativePrompt: true,
  maxN: 4,
  pixelBudget: 0,
  matches: (id) => /nano[\s\-_]*banana[\s\-_]*pro/i.test(id),
  buildBody: buildNanoBananaBody
};

const NANO_BANANA_FLASH: FamilyManifest = {
  id: 'nano-banana-flash',
  label: 'Nano Banana Flash',
  description:
    'Flash 轻量版：仅 1K/2K，不支持 quality。aspect_ratio + image_size 字面量。',
  supportedTiers: ['1K', '2K'],
  supportedAspects: [...COMMON_ASPECTS, '1:4', '4:1'],
  supportsQuality: false,
  supportsNegativePrompt: true,
  maxN: 4,
  pixelBudget: 0,
  // "nano-banana-flash" 或 "nano-banana-2.5-flash" 都识别
  matches: (id) => /nano[\s\-_]*banana[\s\-_]*(\d[\d.]*[\s\-_]*)?flash/i.test(id),
  buildBody: buildNanoBananaBody
};

const NANO_BANANA_2: FamilyManifest = {
  id: 'nano-banana-2',
  label: 'Nano Banana 2',
  description: '标准款：1K/2K/4K + aspect_ratio。不发 quality。',
  supportedTiers: ['1K', '2K', '4K'],
  supportedAspects: [...COMMON_ASPECTS, '1:4', '4:1', '1:8', '8:1'],
  supportsQuality: false,
  supportsNegativePrompt: true,
  maxN: 4,
  pixelBudget: 0,
  // "nano-banana", "nano-banana-2", "nano-banana-2.5" 等；排除 pro/flash 子型号
  matches: (id) =>
    /nano[\s\-_]*banana/i.test(id) &&
    !/pro|flash/i.test(id),
  buildBody: buildNanoBananaBody
};

const DEFAULT: FamilyManifest = {
  id: 'default',
  label: '通用 (OpenAI 兼容)',
  description:
    '未识别为已知 family —— 把 size / aspect_ratio / image_size 都尝试发出，让上游中转挑。',
  supportedTiers: ['1K', '2K', '4K'],
  supportedAspects: [...COMMON_ASPECTS, '1:3', '3:1', '1:4', '4:1'],
  supportsQuality: true,
  supportsNegativePrompt: false,
  maxN: 4,
  pixelBudget: 8_294_400,
  matches: () => true,
  buildBody: (input) => {
    const body: Record<string, unknown> = {
      model: input.modelId,
      prompt: input.prompt,
      n: clampN(input.params.n, 4),
      response_format: 'b64_json'
    };
    // 自定义 W×H 优先
    if (input.params.width && input.params.height) {
      body.size = `${snap16(input.params.width)}x${snap16(input.params.height)}`;
    } else if (input.params.aspect) {
      const tier = input.params.image_size as ImageSizeTier | undefined;
      const budget =
        tier && TIER_PIXEL_BUDGET[tier] ? TIER_PIXEL_BUDGET[tier] : 8_294_400;
      const r = sizeFromAspectAndBudget(input.params.aspect, budget);
      if (r) body.size = `${r.w}x${r.h}`;
    }
    if (input.params.aspect && input.params.aspect !== 'auto') {
      body.aspect_ratio = input.params.aspect;
    }
    if (input.params.image_size) body.image_size = input.params.image_size;
    if (input.params.quality === 'standard' || input.params.quality === 'high') {
      body.quality = input.params.quality;
    }
    return body;
  }
};

/** 检测顺序：先具体（pro/flash/2）再通用（gpt-image-2）最后兜底 default */
const FAMILIES_ORDERED: FamilyManifest[] = [
  NANO_BANANA_PRO,
  NANO_BANANA_FLASH,
  NANO_BANANA_2,
  GPT_IMAGE_2,
  DEFAULT
];

/** 给 UI 用的列表（含 default，便于"系列覆盖"下拉显示） */
export const FAMILIES: FamilyManifest[] = FAMILIES_ORDERED;

/**
 * 用模型 ID 自动判定 family。永远不返回 null —— 兜底走 'default'。
 * 用户在设置里可以用 family override（如选 'gpt-image-2' 强制）覆盖判定结果。
 */
export function detectFamily(modelId: string): FamilyManifest {
  for (const f of FAMILIES_ORDERED) {
    if (f.id === 'default') continue;
    if (f.matches(modelId)) return f;
  }
  return DEFAULT;
}

/** 按 family.id 直接取 manifest——给"family override"下拉用 */
export function getFamilyById(id: ImageFamily): FamilyManifest {
  return FAMILIES_ORDERED.find((f) => f.id === id) ?? DEFAULT;
}

// ────────────────────────────────────────────────────
// 内部工具
// ────────────────────────────────────────────────────

function buildNanoBananaBody(input: BodyBuilderInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: input.modelId,
    prompt: input.prompt,
    n: clampN(input.params.n, 4),
    response_format: 'b64_json'
  };
  // Nano Banana：直接用字面量；模型自己出真分辨率
  if (
    input.params.image_size === '1K' ||
    input.params.image_size === '2K' ||
    input.params.image_size === '4K'
  ) {
    body.image_size = input.params.image_size;
  }
  if (input.params.aspect && input.params.aspect !== 'auto') {
    body.aspect_ratio = input.params.aspect;
  }
  if (input.negativePrompt && input.negativePrompt.trim()) {
    body.negative_prompt = input.negativePrompt.trim();
  }
  return body;
}

/**
 * GPT Image 2 / default 用：
 *   - 自定义 W×H 优先（snap 16，clamp 256–4096）
 *   - 否则按 aspect + 像素预算反推 W×H
 *   - 否则回退 1024x1024
 */
function computeSize(params: BodyBuilderInput['params'], budget: number): string {
  if (params.width && params.height) {
    return `${snap16(params.width)}x${snap16(params.height)}`;
  }
  if (params.aspect && params.aspect !== 'auto') {
    const r = sizeFromAspectAndBudget(params.aspect, budget);
    if (r) return `${r.w}x${r.h}`;
  }
  return '1024x1024';
}

function sizeFromAspectAndBudget(
  aspect: string,
  budget: number
): { w: number; h: number } | null {
  const m = /^(\d+)\s*:\s*(\d+)$/.exec(aspect);
  if (!m) return null;
  const aw = Number(m[1]);
  const ah = Number(m[2]);
  if (!Number.isFinite(aw) || !Number.isFinite(ah) || aw <= 0 || ah <= 0) return null;
  const hExact = Math.sqrt((budget * ah) / aw);
  const wExact = (hExact * aw) / ah;
  let w = clamp256_4096(snap16(wExact));
  let h = clamp256_4096(snap16(hExact));
  // 二次 dec：snap 后可能略超预算，按短边收一格
  while (w * h > budget && (w > 256 || h > 256)) {
    if (w >= h && w > 256) w -= 16;
    else if (h > 256) h -= 16;
    else break;
  }
  return { w, h };
}

function snap16(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 256;
  return Math.max(256, Math.floor(v / 16) * 16);
}

function clamp256_4096(v: number): number {
  return Math.max(256, Math.min(4096, v));
}

function clampN(n: number | undefined, max: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(max, Math.floor(n)));
}
