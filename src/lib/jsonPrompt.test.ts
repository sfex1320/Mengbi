import { describe, it, expect } from 'vitest';
import { extractJsonBlock } from './jsonPrompt';

describe('extractJsonBlock', () => {
  it('纯 JSON 对象 → 解析后规范化美化', () => {
    const out = extractJsonBlock('{"subject":"cat","style":"realistic"}');
    expect(JSON.parse(out)).toEqual({ subject: 'cat', style: 'realistic' });
    expect(out).toContain('\n'); // 美化后带换行/缩进
  });

  it('```json 围栏剥离', () => {
    const out = extractJsonBlock('```json\n{"a":1}\n```');
    expect(JSON.parse(out)).toEqual({ a: 1 });
  });

  it('``` 无语言标记围栏也剥离', () => {
    const out = extractJsonBlock('```\n{"a":1}\n```');
    expect(JSON.parse(out)).toEqual({ a: 1 });
  });

  it('前后有说明文字 → 只取 JSON 块', () => {
    const out = extractJsonBlock('好的，这是结果：\n{"subject":"dog"}\n希望有帮助');
    expect(JSON.parse(out)).toEqual({ subject: 'dog' });
  });

  it('嵌套对象/数组保结构', () => {
    const src = { camera: { lens: '85mm', angle: '平视' }, tags: ['a', 'b'] };
    const out = extractJsonBlock(JSON.stringify(src));
    expect(JSON.parse(out)).toEqual(src);
  });

  it('顶层数组也支持', () => {
    const out = extractJsonBlock('[{"id":1},{"id":2}]');
    expect(JSON.parse(out)).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('字符串值里含 { } / 引号 不干扰平衡扫描', () => {
    const src = { note: 'use {curly} and "quotes"', n: 1 };
    const out = extractJsonBlock('前缀 ' + JSON.stringify(src) + ' 后缀');
    expect(JSON.parse(out)).toEqual(src);
  });

  it('截到块但非法 JSON → 退回该块原文（不抛）', () => {
    const out = extractJsonBlock('{subject: cat, no quotes}');
    expect(out).toBe('{subject: cat, no quotes}');
  });

  it('完全没有 JSON → 退回 trim 文本（不抛）', () => {
    expect(extractJsonBlock('  就是一句普通的话  ')).toBe('就是一句普通的话');
  });

  it('空 / 非字符串 → 空串，不抛', () => {
    expect(extractJsonBlock('')).toBe('');
    // @ts-expect-error 故意传非字符串
    expect(extractJsonBlock(null)).toBe('');
  });
});
