import { describe, it, expect, vi } from 'vitest';
import {
  resolveSize,
  applyBodyOverrides,
  pixelsByAspectAndBudget,
  snapToGrid,
  TIER_PIXEL_BUDGET
} from './imageBody';

describe('snapToGrid', () => {
  it('取到最近的 16 倍数，并 clamp 到 256–3840', () => {
    expect(snapToGrid(1000) % 16).toBe(0);
    expect(snapToGrid(10)).toBe(256); // 下限
    expect(snapToGrid(99999)).toBe(3840); // 上限
  });
});

describe('pixelsByAspectAndBudget', () => {
  it('结果总像素不超预算，且比例接近目标', () => {
    const { w, h } = pixelsByAspectAndBudget('16:9', TIER_PIXEL_BUDGET['4K']);
    expect(w * h).toBeLessThanOrEqual(TIER_PIXEL_BUDGET['4K']);
    expect(w % 16).toBe(0);
    expect(h % 16).toBe(0);
    expect(w / h).toBeCloseTo(16 / 9, 1);
  });

  it('非法比例退化成正方形', () => {
    const { w, h } = pixelsByAspectAndBudget('bad', TIER_PIXEL_BUDGET['1K']);
    expect(w).toBe(h);
  });
});

describe('resolveSize —— 优先级 width/height > 档位 > 比例预设 > 1024', () => {
  it('自定义 width/height 优先（snap 16）', () => {
    expect(resolveSize({ width: 1024, height: 1024 })).toBe('1024x1024');
  });

  it('档位 4K + 1:1 → 接近 8.3MP（回归：绝不是 1024x1024）', () => {
    const s = resolveSize({ image_size: '4K', aspect: '1:1' });
    expect(s).toBe('2880x2880');
    expect(s).not.toBe('1024x1024');
    const [w, h] = s.split('x').map(Number);
    expect(w * h).toBeLessThanOrEqual(TIER_PIXEL_BUDGET['4K']);
  });

  it('仅比例 → 命中预设表', () => {
    expect(resolveSize({ aspect: '16:9' })).toBe('2048x1152');
  });

  it('空参数 → 默认 1024x1024；未知比例 → 1024x1024', () => {
    expect(resolveSize({})).toBe('1024x1024');
    expect(resolveSize({ aspect: '7:13' })).toBe('1024x1024');
  });
});

describe('applyBodyOverrides —— 顶层合并 + ${var} 替换 + null 删字段', () => {
  it('null 值删除字段（屏蔽 response_format）', () => {
    const body: Record<string, unknown> = { size: '1024x1024', response_format: 'b64_json' };
    applyBodyOverrides(body, '{"response_format": null}', {});
    expect(body.response_format).toBeUndefined();
    expect(body.size).toBe('1024x1024');
  });

  it('完整 ${var} 替换为真实值', () => {
    const body: Record<string, unknown> = {};
    applyBodyOverrides(body, '{"quality": "${quality}"}', { quality: 'high' });
    expect(body.quality).toBe('high');
  });

  it('${var} 的值为 null → 走删字段语义', () => {
    const body: Record<string, unknown> = { quality: 'standard' };
    applyBodyOverrides(body, '{"quality": "${quality}"}', { quality: null });
    expect(body.quality).toBeUndefined();
  });

  it('未知变量名 → 跳过该项、保留默认值、回调 onWarn（不静默删字段）', () => {
    const body: Record<string, unknown> = { quality: 'standard' };
    const onWarn = vi.fn();
    applyBodyOverrides(body, '{"quality": "${qualtiy}"}', { quality: 'high' }, onWarn);
    expect(body.quality).toBe('standard'); // 默认值保住，没被删
    expect(onWarn).toHaveBeenCalledOnce();
    expect(onWarn.mock.calls[0][0]).toContain('qualtiy');
  });

  it('普通字符串 / 布尔 / 0 原样合并（0 与 false 不被当成空值删）', () => {
    const body: Record<string, unknown> = {};
    applyBodyOverrides(body, '{"style": "vivid", "enable_watermark": false, "n": 0}', {});
    expect(body.style).toBe('vivid');
    expect(body.enable_watermark).toBe(false);
    expect(body.n).toBe(0);
  });

  it('先删默认 size 再加 width/height 双字段', () => {
    const body: Record<string, unknown> = { size: '1024x1024' };
    applyBodyOverrides(body, '{"size": null, "width": 1024, "height": 1024}', {});
    expect(body.size).toBeUndefined();
    expect(body.width).toBe(1024);
    expect(body.height).toBe(1024);
  });

  it('空 / null 覆盖文本 → 完全不动 body', () => {
    const body: Record<string, unknown> = { size: '1024x1024' };
    applyBodyOverrides(body, '', {});
    applyBodyOverrides(body, null, {});
    expect(body).toEqual({ size: '1024x1024' });
  });
});
