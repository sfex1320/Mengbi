import { describe, it, expect } from 'vitest';
import { parsePromptLines, parseSizeLines, rangeValues, buildLoopItems, chunkImages, MAX_LOOP_ITEMS } from './loopItems';
import type { LoopNodeData } from '@/types/smartCanvas';

const base: LoopNodeData = {
  sourceType: 'count',
  count: 3,
  rangeFrom: 1,
  rangeTo: 5,
  rangeStep: 1,
  rangeAs: 'text',
  promptLines: '',
  sizeLines: '',
  status: 'idle'
};

describe('parsePromptLines', () => {
  it('每行一条、去空行与首尾空白', () => {
    expect(parsePromptLines(' a \n\n b\r\nc ')).toEqual(['a', 'b', 'c']);
  });
  it('空输入返回空数组', () => {
    expect(parsePromptLines('')).toEqual([]);
  });
});

describe('parseSizeLines', () => {
  it('支持 x / X / × / , / 空格 分隔', () => {
    const r = parseSizeLines('1024x768\n800X600\n512×512\n1920,1080\n640 480');
    expect(r.map((s) => [s.width, s.height])).toEqual([
      [1024, 768],
      [800, 600],
      [512, 512],
      [1920, 1080],
      [640, 480]
    ]);
  });
  it('非法行/超界跳过 + 比例吸附', () => {
    const r = parseSizeLines('abc\n8x8\n1024x1024\n99999x100');
    expect(r).toHaveLength(1);
    expect(r[0].aspect).toBe('1:1');
  });
});

describe('rangeValues', () => {
  it('正向递增（含端点）', () => {
    expect(rangeValues(1, 5, 2)).toEqual([1, 3, 5]);
  });
  it('负步长递减', () => {
    expect(rangeValues(5, 1, -2)).toEqual([5, 3, 1]);
  });
  it('step=0 或方向不符 → []', () => {
    expect(rangeValues(1, 5, 0)).toEqual([]);
    expect(rangeValues(1, 5, -1)).toEqual([]);
  });
  it('小数步长按精度归整、上限钳制', () => {
    expect(rangeValues(0, 1, 0.25)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(rangeValues(0, 10_000_000, 1)).toHaveLength(MAX_LOOP_ITEMS);
  });
});

describe('buildLoopItems', () => {
  it('count：N 个序号项', () => {
    const items = buildLoopItems({ ...base, sourceType: 'count', count: 3 });
    expect(items).toHaveLength(3);
    expect(items[1].label).toBe('第 2 次');
  });
  it('range + text：数值作提示词', () => {
    const items = buildLoopItems({ ...base, sourceType: 'range', rangeFrom: 10, rangeTo: 30, rangeStep: 10 });
    expect(items.map((i) => i.prompt)).toEqual(['10', '20', '30']);
  });
  it('range + size-width：数值作宽、另一边固定', () => {
    const items = buildLoopItems({
      ...base,
      sourceType: 'range',
      rangeFrom: 512,
      rangeTo: 1024,
      rangeStep: 512,
      rangeAs: 'size-width',
      rangeOtherEdge: 768
    });
    expect(items.map((i) => [i.size?.width, i.size?.height])).toEqual([
      [512, 768],
      [1024, 768]
    ]);
  });
  it('prompts / sizes / folder', () => {
    expect(buildLoopItems({ ...base, sourceType: 'prompts', promptLines: 'a\nb' })).toHaveLength(2);
    expect(buildLoopItems({ ...base, sourceType: 'sizes', sizeLines: '1024x768' })[0].size?.width).toBe(1024);
    const f = buildLoopItems({ ...base, sourceType: 'folder', batchSize: 1 }, ['C:\\imgs\\a.png', 'C:\\imgs\\b.png']);
    expect(f.map((i) => i.label)).toEqual(['a.png', 'b.png']);
    expect(f[0].images).toEqual(['C:\\imgs\\a.png']);
  });
  it('images 来源：batchSize=1 每张一项（label=文件名 / 内嵌图片）', () => {
    const items = buildLoopItems({ ...base, sourceType: 'images', batchSize: 1, images: ['C:\\x\\1.png', 'data:image/png;base64,AAA'] });
    expect(items).toHaveLength(2);
    expect(items[0].label).toBe('1.png');
    expect(items[0].images).toEqual(['C:\\x\\1.png']);
    expect(items[1].label).toBe('内嵌图片');
  });
  it('images 来源：batchSize=2 每批两张、末批不足', () => {
    const items = buildLoopItems({ ...base, sourceType: 'images', batchSize: 2, images: ['a', 'b', 'c'] });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ label: '第 1 批 · 2 张', images: ['a', 'b'] });
    expect(items[1]).toMatchObject({ label: '第 2 批 · 1 张', images: ['c'] });
  });
  it('images / folder 空 → []', () => {
    expect(buildLoopItems({ ...base, sourceType: 'images', images: [] })).toEqual([]);
    expect(buildLoopItems({ ...base, sourceType: 'folder' }, [])).toEqual([]);
  });
});

describe('chunkImages', () => {
  it('按 size 切批，size≤1 每批一个', () => {
    expect(chunkImages(['a', 'b', 'c'], 1)).toEqual([['a'], ['b'], ['c']]);
    expect(chunkImages(['a', 'b', 'c', 'd'], 2)).toEqual([['a', 'b'], ['c', 'd']]);
    expect(chunkImages(['a', 'b', 'c'], 5)).toEqual([['a', 'b', 'c']]);
  });
  it('批数钳到 MAX_LOOP_ITEMS', () => {
    const big = Array.from({ length: MAX_LOOP_ITEMS + 50 }, (_, i) => String(i));
    expect(chunkImages(big, 1)).toHaveLength(MAX_LOOP_ITEMS);
  });
});
