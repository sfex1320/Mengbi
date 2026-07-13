import { describe, it, expect } from 'vitest';
import {
  activeImageList,
  cellOrdinals,
  toggleSkipIdx,
  moveImageItem,
  insertImagesAt,
  removeImageAt
} from './imageListOrder';

// 图序 = 提交给中转站的参考图顺序（提示词「图1/图2」全靠它）——这里锁死顺序/跳过/重排语义。
describe('imageListOrder（九宫格图序/跳过/重排）', () => {
  const abc = ['a.png', 'b.png', 'c.png', 'd.png'];

  it('activeImageList：按格子顺序输出，跳过 disabledIdx、剔除空值', () => {
    expect(activeImageList(abc)).toEqual(abc);
    expect(activeImageList(abc, [1, 3])).toEqual(['a.png', 'c.png']);
    expect(activeImageList(['a.png', '', 'c.png'], [])).toEqual(['a.png', 'c.png']);
    // 顺序永远 = 数组顺序，disabledIdx 乱序/重复也不影响输出序
    expect(activeImageList(abc, [3, 1, 1])).toEqual(['a.png', 'c.png']);
  });

  it('cellOrdinals：跳过的格子不占号，后续序号自动重排（与 activeImageList 严格同序）', () => {
    expect(cellOrdinals(abc)).toEqual([1, 2, 3, 4]);
    // 跳过第 2 格（下标 1）→ 角标变 1 / 跳过 / 2 / 3
    expect(cellOrdinals(abc, [1])).toEqual([1, null, 2, 3]);
    // 角标为 n 的那张 = activeImageList 的第 n 张（所见即所发的一致性）
    const dis = [0, 2];
    const ords = cellOrdinals(abc, dis);
    const act = activeImageList(abc, dis);
    ords.forEach((o, i) => {
      if (o !== null) expect(act[o - 1]).toBe(abc[i]);
    });
  });

  it('toggleSkipIdx：切换跳过状态，结果去重升序', () => {
    expect(toggleSkipIdx(undefined, 2)).toEqual([2]);
    expect(toggleSkipIdx([2], 0)).toEqual([0, 2]);
    expect(toggleSkipIdx([0, 2], 2)).toEqual([0]);
  });

  it('moveImageItem：插入式重排，禁用标记跟着图走', () => {
    // b（下标 1）被跳过；把 b 从 1 移到 3 → 顺序 a c d b，跳过标记跟到新下标 3
    const r = moveImageItem(abc, [1], 1, 3);
    expect(r.srcs).toEqual(['a.png', 'c.png', 'd.png', 'b.png']);
    expect(r.disabledIdx).toEqual([3]);
    // 被顺延的图的禁用标记也要重映射：跳过 c（下标 2），把 a 从 0 移到 2 → b c a d，c 现在在下标 1
    const r2 = moveImageItem(abc, [2], 0, 2);
    expect(r2.srcs).toEqual(['b.png', 'c.png', 'a.png', 'd.png']);
    expect(r2.disabledIdx).toEqual([1]);
    // 同位 / 越界：原样
    expect(moveImageItem(abc, [1], 2, 2).srcs).toEqual(abc);
    expect(moveImageItem(abc, [1], 9, 0).srcs).toEqual(abc);
  });

  it('insertImagesAt：放进指定格（原图后移），禁用下标随顺延重映射；越界=追加', () => {
    // 跳过 b（下标 1）；在下标 1 插入 x → a x b c d，b 的跳过标记移到下标 2
    const r = insertImagesAt(abc, [1], 1, ['x.png']);
    expect(r.srcs).toEqual(['a.png', 'x.png', 'b.png', 'c.png', 'd.png']);
    expect(r.disabledIdx).toEqual([2]);
    // at=-1（缺省语义）= 追加到末尾
    const r2 = insertImagesAt(abc, [0], -1, ['x.png', 'y.png']);
    expect(r2.srcs).toEqual([...abc, 'x.png', 'y.png']);
    expect(r2.disabledIdx).toEqual([0]);
  });

  it('removeImageAt：删除后禁用下标重映射（删的是跳过格则标记消失）', () => {
    // 跳过 b(1)、d(3)；删掉 a(0) → b c d，跳过标记变 [0, 2]
    const r = removeImageAt(abc, [1, 3], 0);
    expect(r.srcs).toEqual(['b.png', 'c.png', 'd.png']);
    expect(r.disabledIdx).toEqual([0, 2]);
    // 删掉被跳过的 b(1) → 其标记随图消失，d 的标记左移到 2
    const r2 = removeImageAt(abc, [1, 3], 1);
    expect(r2.srcs).toEqual(['a.png', 'c.png', 'd.png']);
    expect(r2.disabledIdx).toEqual([2]);
  });

  it('组合场景：重排 + 跳过后的最终输出顺序（模拟用户「上传 6 张调图序」）', () => {
    const six = ['1', '2', '3', '4', '5', '6'];
    // 把第 6 张拖到第 1 格
    let st = moveImageItem(six, undefined, 5, 0);
    expect(st.srcs).toEqual(['6', '1', '2', '3', '4', '5']);
    // Alt+点击跳过现第 3 格（'2'）
    const dis = toggleSkipIdx(st.disabledIdx, 2);
    // 传下游 = 6 1 3 4 5；角标 = 1 2 跳过 3 4 5
    expect(activeImageList(st.srcs, dis)).toEqual(['6', '1', '3', '4', '5']);
    expect(cellOrdinals(st.srcs, dis)).toEqual([1, 2, null, 3, 4, 5]);
  });
});
