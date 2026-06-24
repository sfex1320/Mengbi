import { describe, it, expect } from 'vitest';
import { buildComfyControlValues, availableComfyModes, comfyModeUnavailableReason, comfyInputSlots, comfySizeRole } from './comfyDispatch';
import type { InputControl } from '@/types/comfyui';

const ctl = (id: string, type: string, label = id): InputControl =>
  ({ id, type, label } as unknown as InputControl);

const TEXT1 = ctl('t1', 'prompt', '正向提示词');
const TEXT2 = ctl('t2', 'textarea', '负向提示词');
const IMG1 = ctl('i1', 'image', '输入图');
const IMG2 = ctl('i2', 'image', '第二图');
const MULTI = ctl('m1', 'multi_image', '参考图集');
const NUM_W = ctl('width', 'number', '宽度');
const NUM_H = ctl('h', 'number', '高');
const MASK1 = ctl('mk', 'mask', '局部重绘遮罩');

describe('comfyInputSlots / comfySizeRole', () => {
  it('按类型分文本/图片槽', () => {
    const s = comfyInputSlots([TEXT1, TEXT2, IMG1, MULTI, NUM_W]);
    expect(s.text.map((c) => c.id)).toEqual(['t1', 't2']);
    expect(s.image.map((c) => c.id)).toEqual(['i1', 'm1']);
  });
  it('宽高启发式：先判 height、识别不到返回 null', () => {
    expect(comfySizeRole(NUM_W)).toBe('width');
    expect(comfySizeRole(NUM_H)).toBe('height');
    expect(comfySizeRole(ctl('steps', 'number', '步数'))).toBeNull();
    expect(comfySizeRole(ctl('w', 'select', '宽'))).toBeNull(); // 非 number/slider 不参与
  });
});

describe('buildComfyControlValues（merge 现状语义）', () => {
  it('单文本控件：全部提示词合并', () => {
    const cv = buildComfyControlValues([TEXT1], { t1: '默认' }, { prompts: ['a', 'b'], images: [] });
    expect(cv.t1).toBe('a\nb');
  });
  it('多文本控件：按序分发，多出的并入最后一个', () => {
    const cv = buildComfyControlValues([TEXT1, TEXT2], {}, { prompts: ['a', 'b', 'c'], images: [] });
    expect(cv.t1).toBe('a');
    expect(cv.t2).toBe('b\nc');
  });
  it('无上游提示词：保留用户调好的值', () => {
    const cv = buildComfyControlValues([TEXT1], { t1: '用户值' }, { prompts: [], images: [] });
    expect(cv.t1).toBe('用户值');
  });
  it('多图按序进图片控件、不足回退首图、multi_image 吃全部', () => {
    const cv = buildComfyControlValues([IMG1, IMG2, MULTI], {}, { prompts: [], images: ['p1.png', 'p2.png'] });
    expect(cv.i1).toBe('p1.png');
    expect(cv.i2).toBe('p2.png');
    expect(cv.m1).toEqual(['p1.png', 'p2.png']);
  });
  it('上游尺寸喂宽高控件；emit=aspect 跳过', () => {
    const size = { aspect: '1:1', width: 1024, height: 768 };
    const cv = buildComfyControlValues([NUM_W, NUM_H], {}, { prompts: [], images: [], size });
    expect(cv.width).toBe(1024);
    expect(cv.h).toBe(768);
    const cv2 = buildComfyControlValues([NUM_W], {}, { prompts: [], images: [], size: { ...size, emit: 'aspect' as const } });
    expect(cv2.width).toBeUndefined();
  });
});

describe('buildComfyControlValues（override 批量语义）', () => {
  it('promptIndex：只喂该条到第一个文本控件', () => {
    const cv = buildComfyControlValues([TEXT1, TEXT2], {}, { prompts: ['a', 'b', 'c'], images: [] }, { promptIndex: 1 });
    expect(cv.t1).toBe('b');
    expect(cv.t2).toBeUndefined();
  });
  it('imageIndex：只喂该张到单图控件', () => {
    const cv = buildComfyControlValues([IMG1], {}, { prompts: [], images: ['p1.png', 'p2.png', 'p3.png'] }, { imageIndex: 2 });
    expect(cv.i1).toBe('p3.png');
  });
});

describe('buildComfyControlValues（inputBindings 指定控件绑定）', () => {
  const IN = { prompts: ['a', 'b', 'c'], images: ['p1.png', 'p2.png'] };
  it('空绑定表 = 现状逐字节等价（回归锁定）', () => {
    const base = buildComfyControlValues([TEXT1, TEXT2, IMG1, IMG2, MULTI], { t1: 'x' }, IN);
    const withEmpty = buildComfyControlValues([TEXT1, TEXT2, IMG1, IMG2, MULTI], { t1: 'x' }, IN, undefined, {});
    expect(withEmpty).toEqual(base);
  });
  it('prompt 绑定：指定第 i 条进指定控件，被消费条从自动池剔除', () => {
    const cv = buildComfyControlValues([TEXT1, TEXT2], {}, IN, undefined, { t2: { kind: 'prompt', index: 0 } });
    expect(cv.t2).toBe('a'); // 显式绑定第 1 条
    expect(cv.t1).toBe('b\nc'); // 剩余条自动并入唯一剩余槽
  });
  it('prompt 绑定越界回退末项', () => {
    const cv = buildComfyControlValues([TEXT1], {}, IN, undefined, { t1: { kind: 'prompt', index: 9 } });
    expect(cv.t1).toBe('c');
  });
  it('off：该槽不接收上游、保留手填值；其余槽自动分发', () => {
    const cv = buildComfyControlValues([TEXT1, TEXT2], { t1: '手填' }, IN, undefined, { t1: { kind: 'off' } });
    expect(cv.t1).toBe('手填');
    expect(cv.t2).toBe('a\nb\nc');
  });
  it('image 绑定：指定第 j 张进指定单图控件，剩余图自动分发', () => {
    const cv = buildComfyControlValues([IMG1, IMG2], {}, IN, undefined, { i1: { kind: 'image', index: 1 } });
    expect(cv.i1).toBe('p2.png');
    expect(cv.i2).toBe('p1.png'); // 剩余池只剩 p1
  });
  it('all-images：multi_image 收全部、其余槽无图可分则不动', () => {
    const cv = buildComfyControlValues([MULTI, IMG1], { i1: '默认.png' }, IN, undefined, { m1: { kind: 'all-images' } });
    expect(cv.m1).toEqual(['p1.png', 'p2.png']);
    expect(cv.i1).toBe('默认.png'); // 全部图被消费，自动池空
  });
  it('image off 屏蔽 + 上游图只进未屏蔽槽', () => {
    const cv = buildComfyControlValues([IMG1, IMG2], { i1: '默认.png' }, IN, undefined, { i1: { kind: 'off' } });
    expect(cv.i1).toBe('默认.png');
    expect(cv.i2).toBe('p1.png');
  });
  it('override.promptIndex 与 prompt 绑定共存：迭代维度 override 赢、image 绑定仍生效', () => {
    const cv = buildComfyControlValues(
      [TEXT1, TEXT2, IMG1],
      {},
      IN,
      { promptIndex: 2 },
      { t2: { kind: 'prompt', index: 0 }, i1: { kind: 'image', index: 1 } }
    );
    expect(cv.t1).toBe('c'); // 逐条迭代：当前条进第一个文本槽（prompt 绑定被忽略）
    expect(cv.t2).toBeUndefined();
    expect(cv.i1).toBe('p2.png'); // 非迭代维度：image 绑定仍生效
  });
  it('override.imageIndex 与 image 绑定共存：image 绑定被忽略、prompt 绑定仍生效', () => {
    const cv = buildComfyControlValues(
      [TEXT1, IMG1],
      {},
      IN,
      { imageIndex: 0 },
      { i1: { kind: 'image', index: 1 }, t1: { kind: 'prompt', index: 1 } }
    );
    expect(cv.i1).toBe('p1.png'); // 逐张迭代：当前张
    expect(cv.t1).toBe('b'); // prompt 绑定生效
  });
  it('无上游提示词时 prompt 绑定不写值（保留默认）', () => {
    const cv = buildComfyControlValues([TEXT1], { t1: '默认' }, { prompts: [], images: [] }, undefined, { t1: { kind: 'prompt', index: 0 } });
    expect(cv.t1).toBe('默认');
  });
});

describe('buildComfyControlValues（遮罩 mask 分发）', () => {
  it('comfyInputSlots：mask 单独成槽，不混入 image', () => {
    const s = comfyInputSlots([IMG1, MULTI, MASK1]);
    expect(s.image.map((c) => c.id)).toEqual(['i1', 'm1']);
    expect(s.mask.map((c) => c.id)).toEqual(['mk']);
  });
  it('mask 控件自动收上游遮罩，不抢图片槽', () => {
    const cv = buildComfyControlValues([IMG1, MASK1], {}, { prompts: [], images: ['p1.png'], masks: ['mask1.png'] });
    expect(cv.i1).toBe('p1.png');
    expect(cv.mk).toBe('mask1.png');
  });
  it('无上游遮罩 → mask 控件保留默认值', () => {
    const cv = buildComfyControlValues([MASK1], { mk: '默认遮罩.png' }, { prompts: [], images: [] });
    expect(cv.mk).toBe('默认遮罩.png');
  });
  it('mask 显式绑定第 i 个遮罩', () => {
    const cv = buildComfyControlValues([MASK1], {}, { prompts: [], images: [], masks: ['mA.png', 'mB.png'] }, undefined, { mk: { kind: 'mask', index: 1 } });
    expect(cv.mk).toBe('mB.png');
  });
  it('mask off：不接收上游遮罩、保留手填', () => {
    const cv = buildComfyControlValues([MASK1], { mk: '默认' }, { prompts: [], images: [], masks: ['mA.png'] }, undefined, { mk: { kind: 'off' } });
    expect(cv.mk).toBe('默认');
  });
  it('无 mask 控件 + 有上游遮罩：图片路径逐字节等价（masks 不影响图片分发）', () => {
    const noMask = buildComfyControlValues([IMG1, IMG2], {}, { prompts: [], images: ['p1.png', 'p2.png'] });
    const withMasks = buildComfyControlValues([IMG1, IMG2], {}, { prompts: [], images: ['p1.png', 'p2.png'], masks: ['mA.png'] });
    expect(withMasks).toEqual(noMask);
  });
});

describe('availableComfyModes / 不可用原因', () => {
  it('merge 永远可用', () => {
    expect(availableComfyModes([], { prompts: [], images: [] })).toEqual(['merge']);
  });
  it('per-prompt 需 ≥2 条提示词且 ≥1 文本控件', () => {
    expect(availableComfyModes([TEXT1], { prompts: ['a', 'b'], images: [] })).toContain('per-prompt');
    expect(availableComfyModes([TEXT1], { prompts: ['a'], images: [] })).not.toContain('per-prompt');
    expect(availableComfyModes([IMG1], { prompts: ['a', 'b'], images: [] })).not.toContain('per-prompt');
    expect(comfyModeUnavailableReason('per-prompt', [TEXT1], { prompts: ['a'], images: [] })).toMatch(/2 条/);
  });
  it('per-image 需 ≥2 张图且恰好 1 个单图控件', () => {
    expect(availableComfyModes([IMG1], { prompts: [], images: ['a', 'b'] })).toContain('per-image');
    expect(availableComfyModes([IMG1, IMG2], { prompts: [], images: ['a', 'b'] })).not.toContain('per-image');
    expect(availableComfyModes([MULTI], { prompts: [], images: ['a', 'b'] })).not.toContain('per-image');
    expect(comfyModeUnavailableReason('per-image', [IMG1], { prompts: [], images: ['a'] })).toMatch(/2 张/);
  });
});
