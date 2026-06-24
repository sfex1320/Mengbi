import { describe, it, expect } from 'vitest';
import { applyHeaderOverrides, validateHeaderOverrides } from './headerOverrides';

const base = (): Record<string, string> => ({
  'Content-Type': 'application/json',
  Authorization: 'Bearer sk-default'
});

describe('applyHeaderOverrides', () => {
  it('空 / null / 空白 → 原样返回 base', () => {
    expect(applyHeaderOverrides(base(), null)).toEqual(base());
    expect(applyHeaderOverrides(base(), undefined)).toEqual(base());
    expect(applyHeaderOverrides(base(), '   ')).toEqual(base());
  });

  it('非法 JSON / 非对象 → 原样返回 base（容错不抛）', () => {
    expect(applyHeaderOverrides(base(), '{bad')).toEqual(base());
    expect(applyHeaderOverrides(base(), '[]')).toEqual(base());
    expect(applyHeaderOverrides(base(), '"x"')).toEqual(base());
    expect(applyHeaderOverrides(base(), '42')).toEqual(base());
  });

  it('新增自定义 header', () => {
    const r = applyHeaderOverrides(base(), '{"X-Plan":"vip"}');
    expect(r['X-Plan']).toBe('vip');
    expect(r['Authorization']).toBe('Bearer sk-default');
  });

  it('大小写不敏感覆盖默认 Authorization（保留原键名，不产生两个鉴权头）', () => {
    const r = applyHeaderOverrides(base(), '{"authorization":"Token abc"}');
    expect(r['Authorization']).toBe('Token abc');
    expect(Object.keys(r).filter((k) => k.toLowerCase() === 'authorization')).toHaveLength(1);
  });

  it('null 值 → 删除该 header', () => {
    const r = applyHeaderOverrides(base(), '{"Authorization":null}');
    expect('Authorization' in r).toBe(false);
    expect(r['Content-Type']).toBe('application/json');
  });

  it('${key} / ${model} 变量替换（可内嵌）', () => {
    const r = applyHeaderOverrides(base(), '{"Authorization":"Token ${key}","x-model":"${model}"}', {
      key: 'sk-card-123',
      model: 'gpt-4o'
    });
    expect(r['Authorization']).toBe('Token sk-card-123');
    expect(r['x-model']).toBe('gpt-4o');
  });

  it('${key} 缺省值为空串；未知变量原样保留', () => {
    const r = applyHeaderOverrides(base(), '{"x-a":"${key}","x-b":"${nope}"}');
    expect(r['x-a']).toBe('');
    expect(r['x-b']).toBe('${nope}');
  });

  it('非字符串值转字符串', () => {
    const r = applyHeaderOverrides(base(), '{"x-n":123,"x-bool":true}');
    expect(r['x-n']).toBe('123');
    expect(r['x-bool']).toBe('true');
  });

  it('不污染传入的 base 对象', () => {
    const b = base();
    applyHeaderOverrides(b, '{"X-Plan":"vip","Authorization":null}');
    expect(b['Authorization']).toBe('Bearer sk-default');
    expect('X-Plan' in b).toBe(false);
  });
});

describe('validateHeaderOverrides', () => {
  it('空 → value null', () => {
    expect(validateHeaderOverrides('')).toEqual({ value: null });
    expect(validateHeaderOverrides('   ')).toEqual({ value: null });
    expect(validateHeaderOverrides(null)).toEqual({ value: null });
  });
  it('合法对象 → 归一字符串', () => {
    const r = validateHeaderOverrides('{"X-A":"1"}');
    expect(r).toEqual({ value: '{"X-A":"1"}' });
  });
  it('非法 JSON / 非对象 → error', () => {
    expect('error' in validateHeaderOverrides('{bad')).toBe(true);
    expect('error' in validateHeaderOverrides('[]')).toBe(true);
    expect('error' in validateHeaderOverrides('"x"')).toBe(true);
  });
});
