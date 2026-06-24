/**
 * 视频供应商 / 模型「富配置」（跨进程共享 @shared/videoProviders）。
 *
 * 存储：内置默认（本文件 {@link BUILTIN_VIDEO_PROVIDERS}）作为模板，用户覆盖存 settings 表
 * `video_providers_json`（一个 JSON key），读取时 {@link mergeVideoProvidersConfig} 把用户覆盖叠加到内置之上。
 * 主进程 adapter 与渲染端设置页 / 画布节点**读同一份合并结果**，做到「所有能力从配置读取、零写死到节点」。
 *
 * 凭证（base_url + apiKey + model_mapping）仍走现有 api_configs(type='video')，本文件不存任何密钥。
 */

import type {
  VideoMode,
  VideoGenerationRequest,
  ValidationResult,
  ValidationIssue,
  CostEstimate
} from './video';

export type VideoAuthType = 'bearer' | 'header' | 'custom';

/** 模型能力开关（决定画布节点显示哪些模式 / 选项）。 */
export interface VideoModelCapabilities {
  textToVideo: boolean;
  imageToVideo: boolean;
  firstLastFrame: boolean;
  referenceImages: boolean;
  referenceVideo: boolean;
  referenceAudio: boolean;
  generateAudio: boolean;
  returnLastFrame: boolean;
  realPerson: boolean;
  continuousVideo: boolean;
}

/** 模型参数限制（驱动校验与 UI 取值范围）。 */
export interface VideoModelLimits {
  durationMin: number;
  durationMax: number;
  supportedResolutions: string[];
  supportedAspectRatios: string[];
  maxReferenceImages: number;
  maxReferenceVideos: number;
  maxReferenceAudios: number;
  /** 参考音频总时长上限（秒） */
  maxAudioDuration: number;
  supportSeed: boolean;
  supportNegativePrompt: boolean;
}

export interface VideoModelDefaultParams {
  duration: number;
  resolution: string;
  aspectRatio: string;
  generateAudio: boolean;
  returnLastFrame: boolean;
  seed?: number | null;
  mode: VideoMode;
}

export interface VideoModelConfig {
  modelId: string;
  displayName: string;
  /** 所属供应商 id（= video_kind） */
  providerId: string;
  enabled: boolean;
  isDefault: boolean;
  description?: string;
  /** 自由文本价格备注（不强制精确） */
  priceRemark?: string;
  /** 可选数值：每秒单价，用于粗略费用估算（null = 仅用 priceRemark 文案） */
  pricePerSecond?: number | null;
  capabilities: VideoModelCapabilities;
  limits: VideoModelLimits;
  defaultParams: VideoModelDefaultParams;
  advancedParams?: Record<string, unknown>;
}

export interface VideoProviderConfig {
  /** = video_kind（seedance / kling / sora / unified / custom …） */
  providerId: string;
  providerName: string;
  enabled: boolean;
  /** 留空 = 用 api_configs 的 base_url（推荐：凭证集中在视频模型配置里填） */
  baseUrl?: string;
  authType: VideoAuthType;
  generationEndpoint: string;
  /** 任务查询端点；留空 = adapter 自行从提交响应/默认规则推断（不写死） */
  taskQueryEndpoint: string;
  cancelEndpoint: string;
  uploadEndpoint: string;
  /** 图片上传端点（可选）：该站生成接口只收公网 URL（不收 base64）时，
   *  adapter 提交前自动把 data: 内联图 POST 到此端点（multipart file）换成 https URL。
   *  如 APIMart：/v1/uploads/images（≤20MB，返回 72h 有效公网 URL）。留空 = 不自动上传。 */
  imageUploadEndpoint?: string;
  /** 任务等待上限（毫秒）。**0 = 不限时（默认）**——只要上游报告进行中就一直轮询等待，
   *  上游报错才判失败（视频生成动辄十几分钟+，2026-06-12 起默认不设限）；>0 = 显式上限。 */
  timeout: number;
  pollingInterval: number;
  maxConcurrentTasks: number;
  defaultModel: string;
  remark?: string;
}

export interface VideoProvidersConfig {
  version: number;
  /** 费用二次确认阈值（元）；预估金额 ≥ 此值或为高费用档时弹确认。默认 1。 */
  costConfirmThreshold?: number;
  /** 批量任务默认关闭，需用户显式开启。 */
  batchEnabled?: boolean;
  providers: Record<string, VideoProviderConfig>;
  models: Record<string, VideoModelConfig>;
}

// ───────────────────────── 内置模板：APIMart Seedance 2.0 ─────────────────────────

const SEEDANCE_ASPECTS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'];

function seedanceCaps(realPerson: boolean): VideoModelCapabilities {
  return {
    textToVideo: true,
    imageToVideo: true,
    firstLastFrame: true,
    referenceImages: true,
    referenceVideo: true,
    referenceAudio: true,
    generateAudio: true,
    returnLastFrame: true,
    realPerson,
    continuousVideo: true
  };
}

function seedanceLimits(allow1080: boolean): VideoModelLimits {
  return {
    durationMin: 4,
    durationMax: 15,
    supportedResolutions: allow1080 ? ['480p', '720p', '1080p'] : ['480p', '720p'],
    supportedAspectRatios: SEEDANCE_ASPECTS,
    maxReferenceImages: 9,
    maxReferenceVideos: 3,
    maxReferenceAudios: 3,
    maxAudioDuration: 15,
    supportSeed: true,
    supportNegativePrompt: true
  };
}

function seedanceDefaults(): VideoModelDefaultParams {
  return {
    duration: 5,
    resolution: '720p',
    aspectRatio: 'adaptive',
    generateAudio: false,
    returnLastFrame: true,
    seed: null,
    mode: 'text_to_video'
  };
}

function seedanceModel(
  modelId: string,
  displayName: string,
  opts: { allow1080: boolean; realPerson: boolean; isDefault?: boolean; description: string }
): VideoModelConfig {
  return {
    modelId,
    displayName,
    providerId: 'seedance',
    enabled: true,
    isDefault: !!opts.isDefault,
    description: opts.description,
    priceRemark: '按时长 / 分辨率计费，具体以 APIMart 控制台为准',
    pricePerSecond: null,
    capabilities: seedanceCaps(opts.realPerson),
    limits: seedanceLimits(opts.allow1080),
    defaultParams: seedanceDefaults()
  };
}

// ── 通用模型模板构造（veo/runway/fal 用，减少重复）──
function mkModel(
  modelId: string,
  displayName: string,
  providerId: string,
  o: {
    caps: Partial<VideoModelCapabilities>;
    durationMin: number;
    durationMax: number;
    resolutions: string[];
    aspects: string[];
    maxRefImages?: number;
    maxRefVideos?: number;
    maxRefAudios?: number;
    defResolution: string;
    defAspect: string;
    defDuration: number;
    isDefault?: boolean;
    description: string;
    priceRemark?: string;
  }
): VideoModelConfig {
  const caps: VideoModelCapabilities = {
    textToVideo: false,
    imageToVideo: false,
    firstLastFrame: false,
    referenceImages: false,
    referenceVideo: false,
    referenceAudio: false,
    generateAudio: false,
    returnLastFrame: false,
    realPerson: false,
    continuousVideo: false,
    ...o.caps
  };
  return {
    modelId,
    displayName,
    providerId,
    enabled: true,
    isDefault: !!o.isDefault,
    description: o.description,
    priceRemark: o.priceRemark ?? '以中转站/官方控制台计费为准',
    pricePerSecond: null,
    capabilities: caps,
    limits: {
      durationMin: o.durationMin,
      durationMax: o.durationMax,
      supportedResolutions: o.resolutions,
      supportedAspectRatios: o.aspects,
      maxReferenceImages: o.maxRefImages ?? 0,
      maxReferenceVideos: o.maxRefVideos ?? 0,
      maxReferenceAudios: o.maxRefAudios ?? 0,
      maxAudioDuration: 0,
      supportSeed: true,
      supportNegativePrompt: true
    },
    defaultParams: {
      duration: o.defDuration,
      resolution: o.defResolution,
      aspectRatio: o.defAspect,
      generateAudio: false,
      returnLastFrame: false,
      seed: null,
      mode: 'text_to_video'
    }
  };
}

const EXTRA_PROVIDERS: Record<string, VideoProviderConfig> = {
  veo: {
    providerId: 'veo',
    providerName: 'Google Veo（中转 OpenAI 兼容）',
    enabled: true,
    baseUrl: '',
    authType: 'bearer',
    generationEndpoint: '/v1/videos/generations',
    taskQueryEndpoint: '/v1/videos/generations',
    cancelEndpoint: '',
    uploadEndpoint: '',
    timeout: 0, // 0 = 不限时（默认）
    pollingInterval: 8_000,
    maxConcurrentTasks: 1,
    defaultModel: 'veo-3.1',
    remark:
      'Veo 3.x：原生有声；文/图/首尾帧/参考图。中转站多走 POST /v1/videos/generations。Google 官方直连(Gemini/Vertex)协议不同，需另填端点或用中转。'
  },
  runway: {
    providerId: 'runway',
    providerName: 'Runway（官方 / 中转透传）',
    enabled: true,
    baseUrl: '',
    authType: 'bearer',
    generationEndpoint: '/runwayml/v1', // adapter 追加 /text_to_video|/image_to_video（官方去掉 /runwayml）
    taskQueryEndpoint: '/runwayml/v1/tasks',
    cancelEndpoint: '',
    uploadEndpoint: '',
    timeout: 0, // 0 = 不限时（默认）
    pollingInterval: 6_000,
    maxConcurrentTasks: 1,
    defaultModel: 'gen4_turbo',
    remark:
      'Gen-4/Gen-3：camelCase 请求，ratio 用分辨率串(如 1280:720)，必带 X-Runway-Version 头。官方端点用 /v1，去掉 /runwayml 前缀。'
  },
  fal: {
    providerId: 'fal',
    providerName: 'fal.ai（队列协议）',
    enabled: true,
    baseUrl: 'https://queue.fal.run',
    authType: 'custom', // fal 用 Authorization: Key {key}
    generationEndpoint: '', // model id（如 fal-ai/kling-video/...）本身即路径
    taskQueryEndpoint: '',
    cancelEndpoint: '',
    uploadEndpoint: '',
    timeout: 0, // 0 = 不限时（默认）
    pollingInterval: 6_000,
    maxConcurrentTasks: 1,
    defaultModel: 'fal-ai/kling-video/v2.1/master/text-to-video',
    remark:
      'fal 队列：POST queue.fal.run/{model_id}（model_id 即路径，t2v/i2v 由 slug 区分），鉴权 Authorization: Key。模型映射填完整 slug。'
  }
};

const EXTRA_MODELS: Record<string, VideoModelConfig> = {
  'veo-3.1': mkModel('veo-3.1', 'Google Veo 3.1', 'veo', {
    caps: { textToVideo: true, imageToVideo: true, firstLastFrame: true, referenceImages: true, generateAudio: true, continuousVideo: true },
    durationMin: 4,
    durationMax: 8,
    resolutions: ['720p', '1080p', '4k'],
    aspects: ['16:9', '9:16'],
    maxRefImages: 3,
    defResolution: '720p',
    defAspect: '16:9',
    defDuration: 8,
    isDefault: true,
    description: 'Veo 3.1：文/图/首尾帧/参考图，原生有声，支持视频延展。'
  }),
  'veo-3': mkModel('veo-3', 'Google Veo 3', 'veo', {
    caps: { textToVideo: true, imageToVideo: true, generateAudio: true },
    durationMin: 8,
    durationMax: 8,
    resolutions: ['720p', '1080p'],
    aspects: ['16:9', '9:16'],
    defResolution: '720p',
    defAspect: '16:9',
    defDuration: 8,
    description: 'Veo 3.0：固定 8 秒，原生有声。'
  }),
  gen4_turbo: mkModel('gen4_turbo', 'Runway Gen-4 Turbo', 'runway', {
    caps: { textToVideo: true, imageToVideo: true, firstLastFrame: true, referenceImages: true },
    durationMin: 5,
    durationMax: 10,
    resolutions: ['1280:720', '1584:672', '1104:832', '720:1280', '832:1104', '960:960'],
    aspects: ['16:9', '9:16', '1:1'],
    maxRefImages: 3,
    defResolution: '1280:720',
    defAspect: '16:9',
    defDuration: 5,
    isDefault: true,
    description: 'Gen-4 Turbo：文/图/首尾帧/参考图。ratio 为分辨率串。'
  }),
  gen3a_turbo: mkModel('gen3a_turbo', 'Runway Gen-3 Alpha Turbo', 'runway', {
    caps: { textToVideo: true, imageToVideo: true, firstLastFrame: true },
    durationMin: 5,
    durationMax: 10,
    resolutions: ['1280:768', '768:1280'],
    aspects: ['16:9', '9:16'],
    defResolution: '1280:768',
    defAspect: '16:9',
    defDuration: 5,
    description: 'Gen-3 Alpha Turbo：文/图/首尾帧。'
  }),
  'fal-ai/kling-video/v2.1/master/text-to-video': mkModel(
    'fal-ai/kling-video/v2.1/master/text-to-video',
    'fal · Kling 2.1 Master（文生）',
    'fal',
    {
      caps: { textToVideo: true, imageToVideo: true, firstLastFrame: true },
      durationMin: 5,
      durationMax: 10,
      resolutions: [],
      aspects: ['16:9', '9:16', '1:1'],
      defResolution: '',
      defAspect: '16:9',
      defDuration: 5,
      isDefault: true,
      description: 'fal 托管 Kling 2.1 Master；图生视频请映射 .../image-to-video slug。'
    }
  ),
  'fal-ai/veo3.1': mkModel('fal-ai/veo3.1', 'fal · Veo 3.1', 'fal', {
    caps: { textToVideo: true, imageToVideo: true, referenceImages: true, generateAudio: true },
    durationMin: 4,
    durationMax: 8,
    resolutions: ['720p', '1080p', '4k'],
    aspects: ['16:9', '9:16'],
    maxRefImages: 3,
    defResolution: '720p',
    defAspect: '16:9',
    defDuration: 8,
    description: 'fal 托管 Veo 3.1；参考图用 .../reference-to-video slug。'
  })
};

/**
 * 出厂内置供应商 / 模型模板。**用户可改、可删、可加**——这是默认值不是写死。
 * APIMart Seedance / Veo / Runway / fal 都只是默认条目；新增供应商 = 再加一条 provider + 对应 adapter。
 */
export const BUILTIN_VIDEO_PROVIDERS: VideoProvidersConfig = {
  version: 1,
  costConfirmThreshold: 1,
  batchEnabled: false,
  providers: {
    ...EXTRA_PROVIDERS,
    seedance: {
      providerId: 'seedance',
      providerName: 'APIMart（Seedance 2.0）',
      enabled: true,
      baseUrl: '', // 留空 = 用 api_configs 的 base_url（如 https://api.apimart.ai 或 …/v1，joinUrl 防双 /v1）
      authType: 'bearer',
      generationEndpoint: '/v1/videos/generations',
      // APIMart 官方文档：异步任务用 GET /v1/tasks/{task_id} 查询（data.status + data.result.videos[] + data.progress）
      taskQueryEndpoint: '/v1/tasks/{task_id}',
      cancelEndpoint: '',
      uploadEndpoint: '',
      // APIMart 生成接口只收 http/https 或 asset:// 图片 URL（不收 base64）→
      // 官方 POST /v1/uploads/images（multipart file ≤20MB）换 72h 有效公网 URL，adapter 提交前自动上传
      imageUploadEndpoint: '/v1/uploads/images',
      timeout: 0, // 0 = 不限时（默认）
      pollingInterval: 8_000,
      maxConcurrentTasks: 1,
      defaultModel: 'doubao-seedance-2.0-fast',
      remark: 'Seedance 2.0：文/图/首尾帧/参考图·视频·音频/有声/连续。1080p 仅 doubao-seedance-2.0 与 -face。'
    },
    custom: {
      providerId: 'custom',
      providerName: '自定义中转站（基础预留）',
      enabled: false,
      baseUrl: '',
      authType: 'bearer',
      generationEndpoint: '/v1/videos/generations',
      taskQueryEndpoint: '',
      cancelEndpoint: '',
      uploadEndpoint: '',
      timeout: 0, // 0 = 不限时（默认）
      pollingInterval: 8_000,
      maxConcurrentTasks: 1,
      defaultModel: '',
      remark: '自定义端点 / 字段映射（v1 基础预留：走与 unified 类似的通用解析）。'
    }
  },
  models: {
    ...EXTRA_MODELS,
    'doubao-seedance-2.0-fast': seedanceModel('doubao-seedance-2.0-fast', 'Seedance 2.0 Fast（草稿/默认）', {
      allow1080: false,
      realPerson: false,
      isDefault: true,
      description: '快速预览、低成本草稿，默认优先使用。'
    }),
    'doubao-seedance-2.0': seedanceModel('doubao-seedance-2.0', 'Seedance 2.0（高质量）', {
      allow1080: true,
      realPerson: false,
      description: '正式高质量生成，支持 1080p。'
    }),
    'doubao-seedance-2.0-fast-face': seedanceModel('doubao-seedance-2.0-fast-face', 'Seedance 2.0 Fast Face（真人草稿）', {
      allow1080: false,
      realPerson: true,
      description: '真人素材快速生成。'
    }),
    'doubao-seedance-2.0-face': seedanceModel('doubao-seedance-2.0-face', 'Seedance 2.0 Face（真人高质量）', {
      allow1080: true,
      realPerson: true,
      description: '真人素材高质量生成，支持 1080p。'
    })
  }
};

// ───────────────────────── 合并 / 查找 ─────────────────────────

/** 深合并用户覆盖到内置默认之上（对象递归，数组与基本值整体替换）。 */
function deepMerge<T>(base: T, override: unknown): T {
  if (override === null || override === undefined) return base;
  if (Array.isArray(base) || typeof base !== 'object' || typeof override !== 'object' || Array.isArray(override)) {
    return override as T;
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const k of Object.keys(override as Record<string, unknown>)) {
    const bv = (base as Record<string, unknown>)[k];
    const ov = (override as Record<string, unknown>)[k];
    out[k] = bv !== undefined && bv !== null && typeof bv === 'object' && !Array.isArray(bv)
      ? deepMerge(bv, ov)
      : ov;
  }
  return out as T;
}

/**
 * 读取合并后的视频供应商配置。
 * @param userJson settings 表 `video_providers_json` 的原文（可空）。
 */
export function mergeVideoProvidersConfig(userJson: string | null | undefined): VideoProvidersConfig {
  if (!userJson || !userJson.trim()) return clone(BUILTIN_VIDEO_PROVIDERS);
  let parsed: unknown;
  try {
    parsed = JSON.parse(userJson);
  } catch {
    return clone(BUILTIN_VIDEO_PROVIDERS);
  }
  if (typeof parsed !== 'object' || parsed === null) return clone(BUILTIN_VIDEO_PROVIDERS);
  const u = parsed as Partial<VideoProvidersConfig>;
  const merged: VideoProvidersConfig = {
    version: BUILTIN_VIDEO_PROVIDERS.version,
    costConfirmThreshold:
      typeof u.costConfirmThreshold === 'number' ? u.costConfirmThreshold : BUILTIN_VIDEO_PROVIDERS.costConfirmThreshold,
    batchEnabled: typeof u.batchEnabled === 'boolean' ? u.batchEnabled : BUILTIN_VIDEO_PROVIDERS.batchEnabled,
    providers: { ...clone(BUILTIN_VIDEO_PROVIDERS.providers) },
    models: { ...clone(BUILTIN_VIDEO_PROVIDERS.models) }
  };
  if (u.providers && typeof u.providers === 'object') {
    for (const [k, v] of Object.entries(u.providers)) {
      merged.providers[k] = merged.providers[k] ? deepMerge(merged.providers[k], v) : (v as VideoProviderConfig);
    }
  }
  if (u.models && typeof u.models === 'object') {
    for (const [k, v] of Object.entries(u.models)) {
      merged.models[k] = merged.models[k] ? deepMerge(merged.models[k], v) : (v as VideoModelConfig);
    }
  }
  // 2026-06-12 一次性归一：旧默认上限 600000（10 分钟）→ 0（不限时）。
  // 10 分钟对视频生成必误杀；600000 是旧模板默认值（用户极少恰好手填这个数），显式设过其它值的保留。
  for (const p of Object.values(merged.providers)) {
    if (p.timeout === 600_000) p.timeout = 0;
  }
  return merged;
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** 按真实模型 id 查模型模板：精确优先，否则取「modelId 作为子串能匹配上的最长 key」。 */
export function findVideoModel(cfg: VideoProvidersConfig, actualModelId: string): VideoModelConfig | null {
  if (!actualModelId) return null;
  if (cfg.models[actualModelId]) return cfg.models[actualModelId];
  let best: VideoModelConfig | null = null;
  for (const m of Object.values(cfg.models)) {
    if (actualModelId.includes(m.modelId) && (!best || m.modelId.length > best.modelId.length)) best = m;
  }
  return best;
}

export function getVideoProvider(cfg: VideoProvidersConfig, providerId: string): VideoProviderConfig | null {
  return cfg.providers[providerId] ?? null;
}

/** 是否需要费用二次确认：高费用档 或 估算金额 ≥ 阈值。 */
export function needsCostConfirm(cost: CostEstimate, cfg: VideoProvidersConfig): boolean {
  if (cost.tier === 'high') return true;
  const th = cfg.costConfirmThreshold;
  return cost.amount != null && typeof th === 'number' && cost.amount >= th;
}

// ───────────────────────── 校验（纯函数，dry-run 与主进程共用）─────────────────────────

/** 该模式需要哪类能力。 */
function modeCapability(mode: VideoMode): keyof VideoModelCapabilities {
  switch (mode) {
    case 'text_to_video':
      return 'textToVideo';
    case 'image_to_video':
      return 'imageToVideo';
    case 'first_last_frame':
      return 'firstLastFrame';
    case 'reference_images':
      return 'referenceImages';
    case 'reference_video':
      return 'referenceVideo';
    case 'reference_audio':
      return 'referenceAudio';
    case 'continuous':
      return 'continuousVideo';
  }
}

/**
 * 校验统一请求是否满足模型能力 / 限制。纯函数、不联网、不烧钱。
 * 覆盖：模式支持 / 时长范围 / 分辨率 / 比例 / 参考数量 / 首尾帧完整性 / image_urls 与 image_with_roles 冲突 / 音频时长 / 负向支持。
 */
export function validateVideoRequest(
  req: VideoGenerationRequest,
  model: VideoModelConfig | null
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const add = (field: string, message: string): void => {
    issues.push({ field, message });
  };

  if (!model) {
    add('model', '未找到该模型的能力配置；请在「设置 → 视频模型配置中心」添加或导入模板。');
    return { ok: false, issues };
  }
  const { capabilities: cap, limits: lim } = model;

  if (!req.prompt || !req.prompt.trim()) {
    if (req.mode === 'text_to_video') add('prompt', '文生视频必须填写提示词。');
  }

  const need = modeCapability(req.mode);
  if (!cap[need]) add('mode', `当前模型不支持「${req.mode}」模式。`);

  if (req.duration < lim.durationMin || req.duration > lim.durationMax) {
    add('duration', `时长需在 ${lim.durationMin}-${lim.durationMax} 秒之间（当前 ${req.duration}）。`);
  }
  if (req.resolution && !lim.supportedResolutions.includes(req.resolution)) {
    add('resolution', `该模型不支持分辨率「${req.resolution}」，可选：${lim.supportedResolutions.join(' / ')}。`);
  }
  if (req.aspectRatio && !lim.supportedAspectRatios.includes(req.aspectRatio)) {
    add('aspectRatio', `该模型不支持比例「${req.aspectRatio}」，可选：${lim.supportedAspectRatios.join(' / ')}。`);
  }
  if (req.negativePrompt && req.negativePrompt.trim() && !lim.supportNegativePrompt) {
    add('negativePrompt', '该模型不支持负向提示词。');
  }
  if (req.seed != null && !lim.supportSeed) {
    add('seed', '该模型不支持 seed（将被忽略）。');
  }

  const roleImgs = req.images ?? [];
  const firstFrames = roleImgs.filter((i) => i.role === 'first_frame');
  const lastFrames = roleImgs.filter((i) => i.role === 'last_frame');
  // imageUrls 仅在「多参考图」模式语义上算参考图；i2v/连续/参考音频 里它是首帧/辅助，不计入参考图上限
  const refImgsCount =
    (req.mode === 'reference_images' ? (req.imageUrls?.length ?? 0) : 0) +
    roleImgs.filter((i) => i.role === 'reference_image').length;

  // image_urls 与 image_with_roles 不能同时使用
  if ((req.imageUrls?.length ?? 0) > 0 && roleImgs.length > 0) {
    add('images', 'image_urls 与带角色的 image_with_roles 不能同时使用，请二选一。');
  }
  // 首尾帧必须各有一张
  if (req.mode === 'first_last_frame') {
    if (firstFrames.length < 1) add('images', '首尾帧模式缺少首帧（first_frame）。');
    if (lastFrames.length < 1) add('images', '首尾帧模式缺少尾帧（last_frame）。');
    if ((req.videoUrls?.length ?? 0) > 0 && (req.audioUrls?.length ?? 0) > 0) {
      add('images', '首尾帧模式下不能同时使用参考视频和参考音频。');
    }
  }
  if (req.mode === 'image_to_video' && firstFrames.length < 1 && (req.imageUrls?.length ?? 0) < 1) {
    add('images', '图生视频缺少首帧图。');
  }
  if (req.mode === 'reference_images' && refImgsCount < 1) {
    add('imageUrls', '多参考图模式至少需要 1 张参考图。');
  }

  if (refImgsCount > lim.maxReferenceImages) {
    add('imageUrls', `参考图最多 ${lim.maxReferenceImages} 张（当前 ${refImgsCount}）。`);
  }
  if ((req.videoUrls?.length ?? 0) > lim.maxReferenceVideos) {
    add('videoUrls', `参考视频最多 ${lim.maxReferenceVideos} 个（当前 ${req.videoUrls?.length}）。`);
  }
  if (req.mode === 'reference_video' && (req.videoUrls?.length ?? 0) < 1) {
    add('videoUrls', '参考视频模式至少需要 1 个视频 URL。');
  }
  if ((req.audioUrls?.length ?? 0) > lim.maxReferenceAudios) {
    add('audioUrls', `参考音频最多 ${lim.maxReferenceAudios} 个（当前 ${req.audioUrls?.length}）。`);
  }
  if (req.mode === 'reference_audio' && (req.audioUrls?.length ?? 0) < 1) {
    add('audioUrls', '参考音频模式至少需要 1 个音频 URL。');
  }

  return { ok: issues.length === 0, issues };
}

// ───────────────────────── 费用预估（纯函数，粗略）─────────────────────────

const RES_MULT: Record<string, number> = { '480p': 0.6, '720p': 1, '1080p': 2.2 };

/**
 * 粗略费用预估：有 pricePerSecond 则按 时长 × 分辨率系数 × (有声 ×1.2) 估算；
 * 否则只给 tier + priceRemark 文案。tier 用于决定是否需要二次确认。
 */
export function estimateVideoCost(req: VideoGenerationRequest, model: VideoModelConfig | null): CostEstimate {
  const note = model?.priceRemark ? `价格备注：${model.priceRemark}` : '该模型未填价格备注，费用仅供参考。';
  const resMult = RES_MULT[req.resolution] ?? 1;
  const audioMult = req.generateAudio ? 1.2 : 1;
  let amount: number | null = null;
  if (model?.pricePerSecond != null && model.pricePerSecond > 0) {
    amount = Math.round(model.pricePerSecond * req.duration * resMult * audioMult * 100) / 100;
  }

  // tier：优先按金额，否则按 时长/分辨率/有声 的启发式
  let tier: CostEstimate['tier'] = 'low';
  if (amount != null) {
    tier = amount >= 2 ? 'high' : amount >= 0.5 ? 'medium' : 'low';
  } else {
    const heavy = req.resolution === '1080p' || req.duration >= 10 || !!req.generateAudio;
    const mid = req.resolution === '720p' || req.duration >= 7;
    tier = heavy ? 'high' : mid ? 'medium' : 'low';
  }
  return { amount, currency: 'CNY', tier, note };
}
