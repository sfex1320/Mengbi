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

export const TIER_PIXEL_BUDGET: Record<ImageSizeTier, number> = {
  '1K': 1_048_576,
  '2K': 4_194_304,
  '4K': 8_294_400
};

// ────────────────────────────────────────────────────
// GPT Image 2 官方尺寸约束 —— 单一真相
// 依据 image2-supported-sizes-and-limits.md：宽高均 16 的倍数，比例在 1:3~3:1，
// 任一边 ≤ 3840px，总像素在 [655360, 8294400]。所有 gpt-image-2 的尺寸规整都过这里。
// ────────────────────────────────────────────────────
export const IMAGE2_LIMITS = {
  /** 任一边像素上限（"4096×2160 不被接受"） */
  MAX_SIDE: 3840,
  /** 总像素下限（512×512=262144 会被拒） */
  MIN_PX: 655_360,
  /** 总像素上限（4K 级，3840×2160=8294400 即为上限） */
  MAX_PX: 8_294_400,
  /** 长短比上限（max/min ≤ 3，即 1:3 ~ 3:1） */
  MAX_RATIO: 3
} as const;

/**
 * 一个 W×H 是否是 gpt-image-2 可接受的尺寸（文档 §3 伪代码的直译，纯判定不修正）。
 * 供 UI 提示 / 单测对照官方规则用。
 */
export function isValidImage2Size(width: number, height: number): boolean {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return false;
  const px = width * height;
  const ratio = Math.max(width, height) / Math.min(width, height);
  return (
    width % 16 === 0 &&
    height % 16 === 0 &&
    Math.max(width, height) <= IMAGE2_LIMITS.MAX_SIDE &&
    ratio <= IMAGE2_LIMITS.MAX_RATIO &&
    px >= IMAGE2_LIMITS.MIN_PX &&
    px <= IMAGE2_LIMITS.MAX_PX
  );
}

/**
 * 把任意 W×H 规整成最接近的「合法 gpt-image-2 尺寸」。
 * 顺序：比例钳到 ≤3:1（缩长边）→ 单边等比缩到 ≤3840 → 总像素等比缩到 ≤8.3MP →
 * 过小则等比放到 ≥655360 → snap16 + 夹 [256,3840] → 收尾保证 4 条硬约束全满足。
 * 用于「自定义宽高 / 原尺寸来源 / 图生图 size」等绕过档位的路径，避免给 gpt-image-2
 * 发出会被上游 400 的尺寸（如 6000×4000 / 512×512 / 3840×1080 超 3:1）。
 */
export function clampToImage2Size(width: number, height: number): { w: number; h: number } {
  let w = Number.isFinite(width) && width > 0 ? width : 1024;
  let h = Number.isFinite(height) && height > 0 ? height : 1024;
  // 1) 比例钳到 ≤3:1（把长边缩到 3×短边）
  if (Math.max(w, h) / Math.min(w, h) > IMAGE2_LIMITS.MAX_RATIO) {
    if (w >= h) w = h * IMAGE2_LIMITS.MAX_RATIO;
    else h = w * IMAGE2_LIMITS.MAX_RATIO;
  }
  // 2) 单边 ≤ 3840（等比缩）
  const longest = Math.max(w, h);
  if (longest > IMAGE2_LIMITS.MAX_SIDE) {
    const s = IMAGE2_LIMITS.MAX_SIDE / longest;
    w *= s;
    h *= s;
  }
  // 3) 总像素 ≤ 8.3MP（等比缩）
  if (w * h > IMAGE2_LIMITS.MAX_PX) {
    const s = Math.sqrt(IMAGE2_LIMITS.MAX_PX / (w * h));
    w *= s;
    h *= s;
  }
  // 4) 总像素 ≥ 655360（等比放；放大不会破坏单边上限——同像素下方框更小）
  if (w * h < IMAGE2_LIMITS.MIN_PX) {
    const s = Math.sqrt(IMAGE2_LIMITS.MIN_PX / (w * h));
    w *= s;
    h *= s;
  }
  // 5) snap16 + 夹 [256, 3840]
  let W = clamp256ToMaxSide(Math.round(w / 16) * 16);
  let H = clamp256ToMaxSide(Math.round(h / 16) * 16);
  // 6a) 预算上限兜底（snap 向上取整可能略超）
  while (W * H > IMAGE2_LIMITS.MAX_PX && (W > 256 || H > 256)) {
    if (W >= H && W > 256) W -= 16;
    else if (H > 256) H -= 16;
    else break;
  }
  // 6b) 比例兜底（snap 把短边取小可能让 max/min 略超 3:1）
  const maxLong = Math.floor((Math.min(W, H) * IMAGE2_LIMITS.MAX_RATIO) / 16) * 16;
  if (Math.max(W, H) > maxLong && maxLong >= 256) {
    if (W >= H) W = maxLong;
    else H = maxLong;
  }
  // 6c) 像素下限兜底（极小尺寸放大；增短边只会拉低比例，安全）
  while (W * H < IMAGE2_LIMITS.MIN_PX && W < IMAGE2_LIMITS.MAX_SIDE && H < IMAGE2_LIMITS.MAX_SIDE) {
    if (W <= H) W += 16;
    else H += 16;
  }
  return { w: W, h: H };
}

function clamp256ToMaxSide(v: number): number {
  return Math.max(256, Math.min(IMAGE2_LIMITS.MAX_SIDE, v));
}

// ────────────────────────────────────────────────────
// GPT Image 2 的 1K/2K 枚举尺寸映射
// 历史 bug：1K/2K 档原按「像素预算 × aspect」反推任意 WxH（如 1248×832），
// 不少中转站/官方实现只接受规整枚举尺寸 → 直接报错。4K 的预算反推可用，保持不动。
// ────────────────────────────────────────────────────

/** 1K/2K 各档的安全枚举尺寸候选（官方 gpt-image 系列枚举 + 规整 2 次幂系）。 */
const GPT_TIER_CANDIDATES: Record<'1K' | '2K', Array<[number, number]>> = {
  '1K': [
    [1024, 1024],
    [1536, 1024],
    [1024, 1536]
  ],
  '2K': [
    [2048, 2048],
    [2048, 1536],
    [1536, 2048],
    [2048, 1152],
    [1152, 2048]
  ]
};

export interface GptTierSize {
  w: number;
  h: number;
  /** false = 所选比例被吸附到最近的枚举比例（前端据此提示实际生成尺寸） */
  exact: boolean;
}

/**
 * GPT Image 2 选 1K/2K 档时把 (档位, 比例) 映射到最近的安全枚举尺寸。
 * 4K / 非法档位返回 null（调用方走原预算反推路径）。aspect 缺省按 1:1。
 */
export function mapGptTierSize(tier: string | undefined, aspect: string | undefined): GptTierSize | null {
  if (tier !== '1K' && tier !== '2K') return null;
  const m = /^(\d+)\s*:\s*(\d+)$/.exec(aspect ?? '');
  const target = m && Number(m[2]) > 0 ? Number(m[1]) / Number(m[2]) : 1;
  let best = GPT_TIER_CANDIDATES[tier][0];
  let bestDiff = Infinity;
  for (const c of GPT_TIER_CANDIDATES[tier]) {
    const diff = Math.abs(Math.log(c[0] / c[1] / target));
    if (diff < bestDiff) {
      bestDiff = diff;
      best = c;
    }
  }
  const exact = Math.abs(best[0] / best[1] - target) / target < 0.02;
  return { w: best[0], h: best[1], exact };
}

// ────────────────────────────────────────────────────
// 5 个 manifest（按 detectFamily 优先级倒排：pro/flash/2 优先匹配，default 兜底）
// ────────────────────────────────────────────────────

const GPT_IMAGE_2: FamilyManifest = {
  id: 'gpt-image-2',
  label: 'GPT Image 2',
  description:
    'OpenAI /v1/images/generations。用 size="WxH"。1K/2K 档映射到安全枚举尺寸' +
    '（1024/1536 系、2048 系——任意 WxH 在不少中转站会被拒）；4K 档按像素预算 × aspect 反推（snap 16，8.3MP 封顶）。' +
    '不发 image_size / aspect_ratio——避免与 size 冲突。',
  supportedTiers: ['1K', '2K', '4K'],
  supportedAspects: [...COMMON_ASPECTS, '2:1', '1:2', '9:21', '1:3', '3:1'],
  supportsQuality: true,
  supportsNegativePrompt: false,
  maxN: 4,
  pixelBudget: 8_294_400,
  // 走 SSE 流式：4K/高质量出图常 60–120s，而不少中转站（Now Coding 等）的边缘代理按
  // 「连接静默」60s 硬超时切连接（net::ERR_CONNECTION_CLOSED）。partial_image 心跳每来一次
  // 就清零静默计时，让长耗时也能跑通。runOpenAIImage 见此字段即走 runOpenAIImageStreaming；
  // 中转站不支持 SSE（直接回普通 JSON）时该函数会兜底按普通响应抢救出图，不二次扣费。
  streaming: { partialImages: 2 },
  matches: (id) => /gpt[\s\-_]*image[\s\-_]*2|gptimage2/i.test(id),
  buildBody: (input) => {
    const tier = input.params.image_size as ImageSizeTier | undefined;
    // 1K/2K → 枚举尺寸映射（除非用户/尺寸节点给了精确宽高，精确值优先）；4K → 预算反推
    const mapped =
      !input.params.width && !input.params.height ? mapGptTierSize(tier, input.params.aspect) : null;
    const budget =
      tier && TIER_PIXEL_BUDGET[tier] ? TIER_PIXEL_BUDGET[tier] : 8_294_400;
    const size = mapped ? `${mapped.w}x${mapped.h}` : computeSize(input.params, budget);
    const body: Record<string, unknown> = {
      model: input.modelId,
      prompt: input.prompt,
      size,
      n: clampN(input.params.n, 4),
      response_format: 'b64_json'
    };
    // gpt-image 系列 quality 官方枚举 = auto|low|medium|high。
    // UI 的「标准」(standard) 是 DALL·E 3 词表——严格校验的中转站会 400
    //（"Invalid option: expected one of auto|low|medium|high"，且失败也可能被计费）→ 映射到 medium。
    let q = input.params.quality === 'standard' ? 'medium' : input.params.quality;
    // 「默认」(空) = 自动按分辨率智能选 quality，且**绝不再发"空 quality"**：
    //   有些中转站（如 Now Coding）把「分辨率」实际挂在 quality 上——不带 quality 字段会降级到
    //   ~1K 并无视 size（连 aspect 都丢），只有带 quality 才按 size 出全分辨率。故：
    //     4K→high / 2K→medium / 1K→low / 未选档位→auto（交给模型）。
    //   用户显式选了 quality（标准/高）则一律以用户为准。
    if (!q) {
      q = tier === '4K' ? 'high' : tier === '2K' ? 'medium' : tier === '1K' ? 'low' : 'auto';
    }
    if (q === 'auto' || q === 'low' || q === 'medium' || q === 'high') {
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
 * GPT Image 2 用（computeSize 只被 GPT_IMAGE_2.buildBody 调用）：
 *   - 自定义 W×H 优先 —— 规整到合法 gpt-image-2 尺寸（16 倍数 / 单边≤3840 / 比例≤3:1 / 655360..8.3MP）
 *   - 否则按 aspect + 像素预算反推 W×H
 *   - 否则回退 1024x1024
 */
function computeSize(params: BodyBuilderInput['params'], budget: number): string {
  if (params.width && params.height) {
    const c = clampToImage2Size(params.width, params.height);
    return `${c.w}x${c.h}`;
  }
  if (params.aspect && params.aspect !== 'auto') {
    const r = sizeFromAspectAndBudget(params.aspect, budget);
    if (r) return `${r.w}x${r.h}`;
  }
  return '1024x1024';
}

export function sizeFromAspectAndBudget(
  aspect: string,
  budget: number
): { w: number; h: number } | null {
  const m = /^(\d+)\s*:\s*(\d+)$/.exec(aspect);
  if (!m) return null;
  const aw = Number(m[1]);
  const ah = Number(m[2]);
  if (!Number.isFinite(aw) || !Number.isFinite(ah) || aw <= 0 || ah <= 0) return null;
  // gpt-image-2 官方约束：单边 ≤ 3840px（"4096×2160 不被接受"），长短比 ≤ 3:1，
  // 双边 16 的倍数，总像素 ≤ 8.3MP。早先用 4096 会让极端比例（2:1/21:9/3:1/9:21…）
  // 算出 4096 边而被中转/模型 400「Invalid image size」——与图生图路径(imageBody.snapToGrid)
  // 早已用的 3840 对齐到此。
  const MAX = 3840;
  let hExact = Math.sqrt((budget * ah) / aw);
  let wExact = (hExact * aw) / ah;
  // 极端比例下「长边按预算反推会超过单边上限 3840」：原先各自独立 clamp 会把长边砍到上限、
  // 短边不变 → 实际比例失真（如 3:1 出成 ~2.46:1）。改为：钉长边到上限后按目标比例回算短边，
  // 保持比例忠实（宁可面积少于预算，也不让比例跑偏）。1:1/16:9 等非极端比例不触发此分支，行为不变。
  if (wExact > MAX || hExact > MAX) {
    if (wExact >= hExact) {
      wExact = MAX;
      hExact = (MAX * ah) / aw;
    } else {
      hExact = MAX;
      wExact = (MAX * aw) / ah;
    }
  }
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

export function snap16(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 256;
  return Math.max(256, Math.floor(v / 16) * 16);
}

export function clamp256_4096(v: number): number {
  return Math.max(256, Math.min(4096, v));
}

function clampN(n: number | undefined, max: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(max, Math.floor(n)));
}
