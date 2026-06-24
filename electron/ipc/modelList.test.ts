import { describe, it, expect } from 'vitest';
import { extractModelEntries, extractModelIds, buildModelProtocols } from './modelList';

describe('extractModelEntries', () => {
  it('openmodel.ai 形态：data[] 带 supported_protocols', () => {
    const body = {
      object: 'list',
      data: [
        { id: 'deepseek-v4-flash', supported_protocols: ['messages'] },
        { id: 'gemini-3.5-flash', supported_protocols: ['gemini'] },
        { id: 'gpt-5.4', supported_protocols: ['responses'] },
        { id: '1024-x-1024/gpt-image-1.5', supported_protocols: ['images'] }
      ]
    };
    const entries = extractModelEntries(body);
    expect(entries).toEqual([
      { id: 'deepseek-v4-flash', protocols: ['messages'] },
      { id: 'gemini-3.5-flash', protocols: ['gemini'] },
      { id: 'gpt-5.4', protocols: ['responses'] },
      { id: '1024-x-1024/gpt-image-1.5', protocols: ['images'] }
    ]);
  });

  it('OpenAI 经典形态：data[].id 无协议字段', () => {
    const entries = extractModelEntries({ data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }] });
    expect(entries).toEqual([{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }]);
  });

  it('字符串数组形态', () => {
    expect(extractModelEntries(['a', 'b'])).toEqual([{ id: 'a' }, { id: 'b' }]);
  });

  it('models / result 容器 + id|model|name 兜底', () => {
    expect(extractModelEntries({ models: [{ model: 'm1' }] })).toEqual([{ id: 'm1' }]);
    expect(extractModelEntries({ result: [{ name: 'n1' }] })).toEqual([{ id: 'n1' }]);
  });

  it('supportedProtocols 驼峰别名也认；非字符串项过滤', () => {
    const entries = extractModelEntries({ data: [{ id: 'x', supportedProtocols: ['messages', 1, ''] }] });
    expect(entries).toEqual([{ id: 'x', protocols: ['messages'] }]);
  });

  it('空 supported_protocols → 不带 protocols 字段', () => {
    expect(extractModelEntries({ data: [{ id: 'x', supported_protocols: [] }] })).toEqual([{ id: 'x' }]);
  });

  it('非数组 / 空 → undefined', () => {
    expect(extractModelEntries(null)).toBeUndefined();
    expect(extractModelEntries({ foo: 1 })).toBeUndefined();
    expect(extractModelEntries({ data: [] })).toBeUndefined();
  });

  it('最多 64 条', () => {
    const data = Array.from({ length: 80 }, (_, i) => ({ id: `m${i}` }));
    expect(extractModelEntries({ data })?.length).toBe(64);
  });
});

describe('extractModelIds', () => {
  it('从条目派生 id 列表（向后兼容）', () => {
    expect(extractModelIds({ data: [{ id: 'a', supported_protocols: ['messages'] }, { id: 'b' }] })).toEqual(['a', 'b']);
  });
  it('非数组 → undefined', () => {
    expect(extractModelIds({})).toBeUndefined();
  });
});

describe('buildModelProtocols', () => {
  it('仅含声明了协议的模型', () => {
    const entries = extractModelEntries({
      data: [{ id: 'a', supported_protocols: ['messages'] }, { id: 'b' }, { id: 'c', supported_protocols: ['gemini'] }]
    });
    expect(buildModelProtocols(entries)).toEqual({ a: ['messages'], c: ['gemini'] });
  });

  it('无任何协议 → undefined', () => {
    const entries = extractModelEntries({ data: [{ id: 'a' }, { id: 'b' }] });
    expect(buildModelProtocols(entries)).toBeUndefined();
  });

  it('undefined 入参 → undefined', () => {
    expect(buildModelProtocols(undefined)).toBeUndefined();
  });
});
