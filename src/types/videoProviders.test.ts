import { describe, it, expect } from 'vitest';
import {
  BUILTIN_VIDEO_PROVIDERS,
  mergeVideoProvidersConfig,
  findVideoModel,
  validateVideoRequest,
  estimateVideoCost,
  needsCostConfirm
} from './videoProviders';
import { normalizeVideoMode, type VideoGenerationRequest } from './video';

function req(p: Partial<VideoGenerationRequest> = {}): VideoGenerationRequest {
  return {
    providerId: 'seedance',
    modelId: 'doubao-seedance-2.0-fast',
    mode: 'text_to_video',
    prompt: '一只猫在跑',
    duration: 5,
    aspectRatio: '16:9',
    resolution: '720p',
    ...p
  };
}

describe('mergeVideoProvidersConfig', () => {
  it('空输入返回内置模板（含 seedance + 4 模型）', () => {
    const cfg = mergeVideoProvidersConfig(null);
    expect(cfg.providers.seedance).toBeTruthy();
    expect(Object.keys(cfg.models)).toContain('doubao-seedance-2.0-fast');
    expect(cfg.models['doubao-seedance-2.0-fast'].isDefault).toBe(true);
  });
  it('用户覆盖叠加在内置之上（深合并）', () => {
    const userJson = JSON.stringify({ providers: { seedance: { pollingInterval: 3000 } } });
    const cfg = mergeVideoProvidersConfig(userJson);
    expect(cfg.providers.seedance.pollingInterval).toBe(3000);
    // 未覆盖字段仍来自内置
    expect(cfg.providers.seedance.generationEndpoint).toBe('/v1/videos/generations');
  });
  it('非法 JSON 回退内置', () => {
    expect(mergeVideoProvidersConfig('{bad').providers.seedance).toBeTruthy();
  });
  it('顶层费用阈值可覆盖', () => {
    const cfg = mergeVideoProvidersConfig(JSON.stringify({ costConfirmThreshold: 5 }));
    expect(cfg.costConfirmThreshold).toBe(5);
  });
});

describe('findVideoModel', () => {
  const cfg = BUILTIN_VIDEO_PROVIDERS;
  it('精确匹配', () => {
    expect(findVideoModel(cfg, 'doubao-seedance-2.0-fast')?.modelId).toBe('doubao-seedance-2.0-fast');
  });
  it('真实 id 含模板 id 时取最长前缀匹配', () => {
    // 'doubao-seedance-2.0-fast-xyz' 应匹配 fast 而非 base
    expect(findVideoModel(cfg, 'doubao-seedance-2.0-fast-xyz')?.modelId).toBe('doubao-seedance-2.0-fast');
  });
  it('未知模型返回 null', () => {
    expect(findVideoModel(cfg, 'totally-unknown')).toBeNull();
  });
});

describe('validateVideoRequest', () => {
  const fast = BUILTIN_VIDEO_PROVIDERS.models['doubao-seedance-2.0-fast'];
  const full = BUILTIN_VIDEO_PROVIDERS.models['doubao-seedance-2.0'];

  it('合法文生视频通过', () => {
    expect(validateVideoRequest(req(), fast).ok).toBe(true);
  });
  it('1080p 在 fast 模型上被拒（fast 不支持 1080p）', () => {
    const r = validateVideoRequest(req({ resolution: '1080p' }), fast);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.field === 'resolution')).toBe(true);
  });
  it('1080p 在完整模型上通过', () => {
    expect(validateVideoRequest(req({ resolution: '1080p', modelId: 'doubao-seedance-2.0' }), full).ok).toBe(true);
  });
  it('时长超范围被拒', () => {
    expect(validateVideoRequest(req({ duration: 30 }), fast).ok).toBe(false);
    expect(validateVideoRequest(req({ duration: 2 }), fast).ok).toBe(false);
  });
  it('首尾帧缺帧被拒', () => {
    const r = validateVideoRequest(req({ mode: 'first_last_frame', images: [{ url: 'a', role: 'first_frame' }] }), fast);
    expect(r.ok).toBe(false);
  });
  it('首尾帧齐全通过', () => {
    const r = validateVideoRequest(
      req({ mode: 'first_last_frame', images: [{ url: 'a', role: 'first_frame' }, { url: 'b', role: 'last_frame' }] }),
      fast
    );
    expect(r.ok).toBe(true);
  });
  it('image_urls 与 image_with_roles 冲突被拒', () => {
    const r = validateVideoRequest(
      req({ mode: 'reference_images', imageUrls: ['x'], images: [{ url: 'a', role: 'reference_image' }] }),
      fast
    );
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.field === 'images')).toBe(true);
  });
  it('参考图超上限被拒', () => {
    const many = Array.from({ length: 10 }, (_, i) => `img${i}`);
    const r = validateVideoRequest(req({ mode: 'reference_images', imageUrls: many }), fast);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.field === 'imageUrls')).toBe(true);
  });
  it('不支持的模式被拒', () => {
    // 构造一个能力关掉 firstLastFrame 的模型
    const noFLF = { ...fast, capabilities: { ...fast.capabilities, firstLastFrame: false } };
    const r = validateVideoRequest(
      req({ mode: 'first_last_frame', images: [{ url: 'a', role: 'first_frame' }, { url: 'b', role: 'last_frame' }] }),
      noFLF
    );
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.field === 'mode')).toBe(true);
  });
  it('无模型配置直接失败', () => {
    expect(validateVideoRequest(req(), null).ok).toBe(false);
  });
});

describe('estimateVideoCost + needsCostConfirm', () => {
  const fast = BUILTIN_VIDEO_PROVIDERS.models['doubao-seedance-2.0-fast'];
  it('无单价时按启发式给档位', () => {
    const low = estimateVideoCost(req({ resolution: '480p', duration: 5 }), fast);
    expect(low.amount).toBeNull();
    expect(low.tier).toBe('low');
    const high = estimateVideoCost(req({ resolution: '1080p', modelId: 'doubao-seedance-2.0' }), BUILTIN_VIDEO_PROVIDERS.models['doubao-seedance-2.0']);
    expect(high.tier).toBe('high');
  });
  it('有单价时算金额', () => {
    const priced = { ...fast, pricePerSecond: 0.5 };
    const c = estimateVideoCost(req({ duration: 10, resolution: '720p' }), priced);
    expect(c.amount).toBeGreaterThan(0);
  });
  it('高费用档需要二次确认', () => {
    const cfg = BUILTIN_VIDEO_PROVIDERS;
    expect(needsCostConfirm({ amount: null, currency: 'CNY', tier: 'high', note: '' }, cfg)).toBe(true);
    expect(needsCostConfirm({ amount: 0.1, currency: 'CNY', tier: 'low', note: '' }, cfg)).toBe(false);
    expect(needsCostConfirm({ amount: 5, currency: 'CNY', tier: 'low', note: '' }, cfg)).toBe(true);
  });
});

describe('内置 veo/runway/fal 模板', () => {
  const cfg = BUILTIN_VIDEO_PROVIDERS;
  it('三家 provider 都在', () => {
    expect(cfg.providers.veo).toBeTruthy();
    expect(cfg.providers.runway).toBeTruthy();
    expect(cfg.providers.fal).toBeTruthy();
  });
  it('代表模型可按 id 查到', () => {
    expect(findVideoModel(cfg, 'veo-3.1')?.providerId).toBe('veo');
    expect(findVideoModel(cfg, 'gen4_turbo')?.providerId).toBe('runway');
    expect(findVideoModel(cfg, 'fal-ai/kling-video/v2.1/master/text-to-video')?.providerId).toBe('fal');
  });
  it('veo 不支持 1:1 比例（校验拦截）', () => {
    const veo = findVideoModel(cfg, 'veo-3.1');
    const r = validateVideoRequest(req({ providerId: 'veo', modelId: 'veo-3.1', aspectRatio: '1:1' }), veo);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.field === 'aspectRatio')).toBe(true);
  });
  it('runway gen4_turbo 合法文生通过', () => {
    const gw = findVideoModel(cfg, 'gen4_turbo');
    const r = validateVideoRequest(
      req({ providerId: 'runway', modelId: 'gen4_turbo', aspectRatio: '16:9', resolution: '1280:720', duration: 5 }),
      gw
    );
    expect(r.ok).toBe(true);
  });
  it('continuous 模式按 continuousVideo 能力放行（veo-3.1 returnLastFrame=false 也应通过）', () => {
    const veo = findVideoModel(cfg, 'veo-3.1');
    expect(veo?.capabilities.continuousVideo).toBe(true);
    expect(veo?.capabilities.returnLastFrame).toBe(false);
    const r = validateVideoRequest(req({ providerId: 'veo', modelId: 'veo-3.1', mode: 'continuous', aspectRatio: '16:9', duration: 8 }), veo);
    expect(r.ok).toBe(true);
  });
  it('image_to_video 用 imageUrls 作首帧，不被 maxReferenceImages=0 误拦', () => {
    const veo3 = findVideoModel(cfg, 'veo-3');
    expect(veo3?.limits.maxReferenceImages).toBe(0);
    const r = validateVideoRequest(
      req({ providerId: 'veo', modelId: 'veo-3', mode: 'image_to_video', aspectRatio: '16:9', duration: 8, imageUrls: ['https://x/a.png'] }),
      veo3
    );
    expect(r.ok).toBe(true);
  });
});

describe('normalizeVideoMode', () => {
  it('旧两档迁移到新模式', () => {
    expect(normalizeVideoMode('text-to-video')).toBe('text_to_video');
    expect(normalizeVideoMode('image-to-video')).toBe('image_to_video');
  });
  it('未知值回退 text_to_video', () => {
    expect(normalizeVideoMode('garbage')).toBe('text_to_video');
    expect(normalizeVideoMode(undefined)).toBe('text_to_video');
  });
  it('合法新值原样', () => {
    expect(normalizeVideoMode('first_last_frame')).toBe('first_last_frame');
  });
});
