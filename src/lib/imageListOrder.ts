/**
 * 图片节点「九宫格列表」的纯逻辑（顺序 / 跳过 / 重排 / 插入）。
 *
 * 为什么抽出来：图序 = 提交给中转站的参考图顺序（用户提示词里写「图1/图2」全靠它），
 * 属于烧钱级正确性逻辑；runner/组件里内联会既难测又容易在改 UI 时悄悄破坏顺序。
 * 这里全部是纯函数，vitest 直接锁死行为。
 *
 * 数据模型（都存在 ImageNodeData 上，additive 可选字段）：
 * - srcs: string[]         按九宫格顺序排列的图（本地路径 / dataURI）
 * - disabledIdx?: number[] 被「Alt+点击」置灰跳过的格子**下标**（针对 srcs 原数组下标）
 *
 * 约定：跳过的格子不传下游、不占序号（角标序号 = 实际传下游的序号）；
 * 重排/插入/删除时禁用标记必须**跟着图走**（按下标存，所以每次结构变动都要重映射）。
 */

/** 传给下游的图列表：按格子顺序，剔除空值与被跳过的下标。 */
export function activeImageList(srcs: string[], disabledIdx?: number[]): string[] {
  const skip = new Set(disabledIdx ?? []);
  return srcs.filter((s, i) => !!s && !skip.has(i));
}

/**
 * 每个格子的展示角标：跳过的格子 ordinal=null；其余按「实际传下游的顺序」从 1 递增
 * （即角标序号自动重排，跳过的不占号——与 activeImageList 严格同序）。
 */
export function cellOrdinals(srcs: string[], disabledIdx?: number[]): Array<number | null> {
  const skip = new Set(disabledIdx ?? []);
  let n = 0;
  return srcs.map((s, i) => (!!s && !skip.has(i) ? ++n : null));
}

/** Alt+点击切换某格的「跳过」状态；返回新的 disabledIdx（去重、升序，便于持久化 diff 稳定）。 */
export function toggleSkipIdx(disabledIdx: number[] | undefined, i: number): number[] {
  const set = new Set(disabledIdx ?? []);
  if (set.has(i)) set.delete(i);
  else set.add(i);
  return [...set].sort((a, b) => a - b);
}

interface ListPatch {
  srcs: string[];
  disabledIdx: number[];
}

/** 把 srcs + disabledIdx 展开成「每格一条」的并联记录，结构变动后再折回下标 —— 保证禁用标记跟图走。 */
function toEntries(srcs: string[], disabledIdx?: number[]): Array<{ src: string; skip: boolean }> {
  const skip = new Set(disabledIdx ?? []);
  return srcs.map((src, i) => ({ src, skip: skip.has(i) }));
}

function fromEntries(entries: Array<{ src: string; skip: boolean }>): ListPatch {
  return {
    srcs: entries.map((e) => e.src),
    disabledIdx: entries.flatMap((e, i) => (e.skip ? [i] : []))
  };
}

/**
 * 格与格之间拖拽重排：把 from 位置的图**移动**到 to 位置（插入式，与 VideoClipNode 片段重排同语义）。
 * 禁用标记跟着被移动的图与被顺延的图一起重映射。越界/同位则原样返回。
 */
export function moveImageItem(srcs: string[], disabledIdx: number[] | undefined, from: number, to: number): ListPatch {
  const entries = toEntries(srcs, disabledIdx);
  if (from === to || from < 0 || from >= entries.length || to < 0 || to >= entries.length) {
    return fromEntries(entries);
  }
  const [moved] = entries.splice(from, 1);
  entries.splice(to, 0, moved);
  return fromEntries(entries);
}

/**
 * 把新图插到 at 位置（拖文件到某格 =「放进该位置」，原有图往后顺延；at 越界则追加到末尾）。
 * 新插入的图默认不跳过；原有格子的禁用标记随顺延重映射。
 */
export function insertImagesAt(srcs: string[], disabledIdx: number[] | undefined, at: number, add: string[]): ListPatch {
  const entries = toEntries(srcs, disabledIdx);
  const pos = at < 0 || at > entries.length ? entries.length : at;
  entries.splice(pos, 0, ...add.map((src) => ({ src, skip: false })));
  return fromEntries(entries);
}

/** 删除某格；后续格子的禁用标记下标重映射。越界原样返回。 */
export function removeImageAt(srcs: string[], disabledIdx: number[] | undefined, i: number): ListPatch {
  const entries = toEntries(srcs, disabledIdx);
  if (i < 0 || i >= entries.length) return fromEntries(entries);
  entries.splice(i, 1);
  return fromEntries(entries);
}
