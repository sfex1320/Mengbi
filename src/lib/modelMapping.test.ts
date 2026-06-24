import { describe, it, expect } from 'vitest';
import { modelRefValue, parseModelRef, resolveModelRef, listMappedModels, mappedModelOptions } from './modelMapping';
import type { ApiConfig } from '@/types/domain';

/** 构造最小可用的 image/text/video 配置（只填解析用得到的字段）。 */
function cfg(partial: Partial<ApiConfig> & Pick<ApiConfig, 'type' | 'provider_name' | 'model_mapping'>): ApiConfig {
  return {
    id: 0,
    plan_id: 1,
    base_url: '',
    api_key_encrypted: '',
    is_official: false,
    supports_web_search: false,
    supports_vision: false,
    ...partial
  } as unknown as ApiConfig;
}

describe('modelRefValue / parseModelRef', () => {
  it('provider 非空 → 复合「中转站 / 名」；为空 → 裸名', () => {
    expect(modelRefValue('FHL', 'gpt-image-2')).toBe('FHL / gpt-image-2');
    expect(modelRefValue('', 'gpt-image-2')).toBe('gpt-image-2');
    expect(modelRefValue('  ', 'x')).toBe('x');
  });
  it('parseModelRef：复合拆 provider+name；裸名 provider 为空', () => {
    expect(parseModelRef('FHL / gpt-image-2')).toEqual({ provider: 'FHL', name: 'gpt-image-2' });
    expect(parseModelRef('gpt-image-2')).toEqual({ provider: '', name: 'gpt-image-2' });
    // 名字里自带斜杠不受影响（只按首个 " / " 切）
    expect(parseModelRef('A / b / c')).toEqual({ provider: 'A', name: 'b / c' });
  });
  it('往返：parseModelRef(modelRefValue(p,n)) 还原', () => {
    expect(parseModelRef(modelRefValue('Now Coding', 'gpt-image-2'))).toEqual({ provider: 'Now Coding', name: 'gpt-image-2' });
  });
});

describe('listMappedModels：同名不同中转站各自保留（不再按裸名去重）', () => {
  const configs = [
    cfg({ type: 'image', provider_name: 'FHL', model_mapping: { 'gpt-image-2': 'gpt-image-2-fhl' } }),
    cfg({ type: 'image', provider_name: 'Now Coding', model_mapping: { 'gpt-image-2': 'gpt-image-2-nc' } })
  ];
  it('两个同名模型都在列表里、ref 各不相同', () => {
    const out = listMappedModels(configs, 1, 'image');
    expect(out).toHaveLength(2);
    expect(out.map((m) => m.ref).sort()).toEqual(['FHL / gpt-image-2', 'Now Coding / gpt-image-2']);
    expect(out.every((m) => m.usable)).toBe(true);
  });
  it('mappedModelOptions value=ref（下拉值带前缀，互不冲突）', () => {
    const opts = mappedModelOptions(listMappedModels(configs, 1, 'image'));
    expect(opts.map((o) => o.value).sort()).toEqual(['FHL / gpt-image-2', 'Now Coding / gpt-image-2']);
  });
  it('真正重复（同站同名）仍去重', () => {
    const dup = [
      cfg({ type: 'image', provider_name: 'FHL', model_mapping: { 'gpt-image-2': 'a' } }),
      cfg({ type: 'image', provider_name: 'FHL', model_mapping: { 'gpt-image-2': 'b' } })
    ];
    expect(listMappedModels(dup, 1, 'image')).toHaveLength(1);
  });
});

describe('resolveModelRef：复合精确命中 + 旧裸名向后兼容', () => {
  const configs = [
    cfg({ type: 'image', provider_name: 'FHL', model_mapping: { 'gpt-image-2': 'gpt-image-2-fhl' } }),
    cfg({ type: 'image', provider_name: 'Now Coding', model_mapping: { 'gpt-image-2': 'gpt-image-2-nc' } })
  ];
  it('复合标识命中对应中转站那条（区分同名）', () => {
    expect(resolveModelRef(configs, 'image', 'FHL / gpt-image-2')?.actualId).toBe('gpt-image-2-fhl');
    expect(resolveModelRef(configs, 'image', 'Now Coding / gpt-image-2')?.actualId).toBe('gpt-image-2-nc');
  });
  it('旧裸名 → 按名首个命中（等价旧逻辑，绝不退化）', () => {
    expect(resolveModelRef(configs, 'image', 'gpt-image-2')?.actualId).toBe('gpt-image-2-fhl');
  });
  it('复合的 provider 没匹配上 → 回退按名命中', () => {
    expect(resolveModelRef(configs, 'image', '不存在的站 / gpt-image-2')?.actualId).toBe('gpt-image-2-fhl');
  });
  it('完全找不到 → null', () => {
    expect(resolveModelRef(configs, 'image', 'FHL / flux-pro')).toBeNull();
    expect(resolveModelRef(configs, 'text', 'FHL / gpt-image-2')).toBeNull();
  });
  it('映射值为空（不可用）→ 视为未命中', () => {
    const empty = [cfg({ type: 'image', provider_name: 'X', model_mapping: { m: '' } })];
    expect(resolveModelRef(empty, 'image', 'X / m')).toBeNull();
    expect(resolveModelRef(empty, 'image', 'm')).toBeNull();
  });
});
