import { describe, it, expect } from 'vitest';
import { normalizeVideoKind, VIDEO_KINDS_LIST, suggestVideoKind, autoCorrectVideoKind } from './domain';

describe('VIDEO_KINDS_LIST', () => {
  it('含全部 8 个合法 kind', () => {
    expect([...VIDEO_KINDS_LIST]).toEqual([
      'kling',
      'sora',
      'unified',
      'seedance',
      'veo',
      'runway',
      'fal',
      'custom',
    ]);
  });

  it('长度为 8 且无重复', () => {
    expect(VIDEO_KINDS_LIST).toHaveLength(8);
    expect(new Set(VIDEO_KINDS_LIST).size).toBe(8);
  });
});

describe('normalizeVideoKind · 合法 kind 原样返回', () => {
  for (const kind of VIDEO_KINDS_LIST) {
    it(`'${kind}' → '${kind}'`, () => {
      expect(normalizeVideoKind(kind)).toBe(kind);
    });
  }
});

describe('normalizeVideoKind · 非法值归一为 null', () => {
  it('未知字符串 → null', () => {
    expect(normalizeVideoKind('kling2')).toBeNull();
    expect(normalizeVideoKind('luma')).toBeNull();
    expect(normalizeVideoKind('')).toBeNull();
  });

  it('大小写敏感：大写合法 kind → null', () => {
    expect(normalizeVideoKind('Kling')).toBeNull();
    expect(normalizeVideoKind('SORA')).toBeNull();
  });

  it('数字 → null', () => {
    expect(normalizeVideoKind(0)).toBeNull();
    expect(normalizeVideoKind(1)).toBeNull();
  });

  it('null / undefined → null', () => {
    expect(normalizeVideoKind(null)).toBeNull();
    expect(normalizeVideoKind(undefined)).toBeNull();
  });

  it('布尔 → null', () => {
    expect(normalizeVideoKind(true)).toBeNull();
    expect(normalizeVideoKind(false)).toBeNull();
  });

  it('对象 / 数组 → null', () => {
    expect(normalizeVideoKind({})).toBeNull();
    expect(normalizeVideoKind({ kind: 'kling' })).toBeNull();
    expect(normalizeVideoKind(['kling'])).toBeNull();
  });
});

describe('suggestVideoKind · 按地址/模型推断协议', () => {
  it('APIMart 地址 → seedance（与模型无关）', () => {
    expect(suggestVideoKind('https://api.apimart.ai/v1')).toBe('seedance');
    expect(suggestVideoKind('https://api.apimart.ai/v1', 'kling-v2-1-master')).toBe('seedance');
  });
  it('Seedance / 豆包模型 → seedance（与地址无关）', () => {
    expect(suggestVideoKind('https://api.some-relay.com', 'doubao-seedance-2.0')).toBe('seedance');
    expect(suggestVideoKind('', 'seedance-1.0-pro')).toBe('seedance');
  });
  it('runway / fal 地址 → 对应协议', () => {
    expect(suggestVideoKind('https://api.runwayml.com')).toBe('runway');
    expect(suggestVideoKind('https://queue.fal.run')).toBe('fal');
  });
  it('识别不出 → null（尊重现配置）', () => {
    expect(suggestVideoKind('https://api.some-relay.com', 'kling-v2-1-master')).toBeNull();
    expect(suggestVideoKind('', '')).toBeNull();
  });
});

describe('autoCorrectVideoKind · 运行时协议纠偏', () => {
  it('legacy 配置 + APIMart/Seedance → 自动切 seedance（修「提交进错端点烧钱取不回」）', () => {
    expect(autoCorrectVideoKind('kling', 'https://api.apimart.ai/v1', 'doubao-seedance-2.0')).toBe('seedance');
    expect(autoCorrectVideoKind('unified', 'https://api.apimart.ai/v1', 'sora-2')).toBe('seedance');
    expect(autoCorrectVideoKind(null, 'https://api.x.com', 'doubao-seedance-2.0')).toBe('seedance');
  });
  it('显式 adapter 协议（seedance/veo/runway/fal/custom）永远尊重不动', () => {
    expect(autoCorrectVideoKind('veo', 'https://api.apimart.ai/v1', 'doubao-seedance-2.0')).toBe('veo');
    expect(autoCorrectVideoKind('custom', 'https://api.apimart.ai/v1')).toBe('custom');
  });
  it('legacy 配置 + 识别不出 → 保持原协议', () => {
    expect(autoCorrectVideoKind('kling', 'https://api.some-relay.com', 'kling-v2-1-master')).toBe('kling');
    expect(autoCorrectVideoKind('sora', 'https://api.openai.com', 'sora-2')).toBe('sora');
  });
});
