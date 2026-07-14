import { describe, it, expect } from 'vitest';
import { parseImageRefs, stripImageRefs } from './promptImageRefs';

describe('parseImageRefs', () => {
  it('无标记 / 空文本 → 空数组', () => {
    expect(parseImageRefs('')).toEqual([]);
    expect(parseImageRefs('把它改成夜景')).toEqual([]);
  });

  it('解析单个标记（含偏移）', () => {
    const t = '把@图1的人物换到雪地里';
    expect(parseImageRefs(t)).toEqual([{ index: 1, start: 1, end: 4 }]);
  });

  it('多个标记按出现顺序；两位数序号可解析', () => {
    const t = '@图2的风格套到@图10上';
    const refs = parseImageRefs(t);
    expect(refs.map((r) => r.index)).toEqual([2, 10]);
    expect(t.slice(refs[1].start, refs[1].end)).toBe('@图10');
  });

  it('@图0 / 没有数字的「@图」不算标记', () => {
    expect(parseImageRefs('@图0 和 @图 都不是引用')).toEqual([]);
  });

  it('同一序号可重复引用', () => {
    expect(parseImageRefs('@图1和@图1').map((r) => r.index)).toEqual([1, 1]);
  });

  it('标记后的全角占位空格算进标记（end 含它）', () => {
    const t = '把@图1　的人物换掉';
    const refs = parseImageRefs(t);
    expect(refs).toEqual([{ index: 1, start: 1, end: 5 }]);
    expect(t.slice(refs[0].start, refs[0].end)).toBe('@图1　');
  });
});

describe('stripImageRefs（发给模型前剥 @）', () => {
  it('@图N → 图N，其余原样', () => {
    expect(stripImageRefs('把@图1的人物放进@图2的场景')).toBe('把图1的人物放进图2的场景');
  });

  it('无标记原样返回；空串原样', () => {
    expect(stripImageRefs('普通提示词')).toBe('普通提示词');
    expect(stripImageRefs('')).toBe('');
  });

  it('用户手写的「图1」（无 @）不受影响', () => {
    expect(stripImageRefs('图1 保持不变，@图2 换风格')).toBe('图1 保持不变，图2 换风格');
  });

  it('标记自带的全角占位空格归一成普通空格', () => {
    expect(stripImageRefs('把@图1　的人物放进@图2　的场景')).toBe('把图1 的人物放进图2 的场景');
    // 无占位空格的手写标记不多出空格
    expect(stripImageRefs('把@图1的人物换掉')).toBe('把图1的人物换掉');
  });
});
