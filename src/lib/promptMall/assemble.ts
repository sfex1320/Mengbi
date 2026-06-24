// 提示词商城「购物车 → 一条提示词」的纯函数（确定性文本映射，配 vitest 锁定）。
// 组装规则：按大类顺序分组 → 去重 → 逗号拼接成正向提示词；负面词单独放结尾的「负面：」行。
// 勾「优化」时，把这条原始拼接交给对话模型（PROMPT_MALL_SYSTEM）合并去重成更连贯的一条。

import type { PromptMallLang } from './cardTypes';
import { PROMPT_MALL_ASSEMBLY_ORDER, isNegativeCard } from './cardTypes';

/** 购物车条目（PromptMallCartItem 满足此形状）。 */
export interface AssembleItem {
  cat: string;
  sub: string;
  zh: string;
  en: string;
}

/** 取条目在某语言下的文本（缺失则回退另一语言）。 */
export function cartItemText(item: AssembleItem, lang: PromptMallLang): string {
  const primary = (lang === 'zh' ? item.zh : item.en) ?? '';
  const fallback = (lang === 'zh' ? item.en : item.zh) ?? '';
  return (primary.trim() || fallback.trim()).trim();
}

function isNegative(item: AssembleItem): boolean {
  return isNegativeCard(item.cat, item.sub);
}

function catRank(cat: string): number {
  const i = PROMPT_MALL_ASSEMBLY_ORDER.indexOf(cat);
  return i < 0 ? PROMPT_MALL_ASSEMBLY_ORDER.length : i;
}

/** 去重（大小写不敏感、按出现顺序保留首个）。 */
function dedupe(texts: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of texts) {
    const key = t.toLowerCase();
    if (!t || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/**
 * 把购物车合成为一条原始提示词（未经模型优化）。
 * - 正向片段按大类顺序稳定排序、去重、逗号拼接。
 * - 负面片段（quality/negative）单独放到结尾的「负面：/ Negative:」行。
 */
export function assembleCart(items: AssembleItem[], lang: PromptMallLang): string {
  const sep = lang === 'zh' ? '，' : ', ';
  const pos = items.filter((it) => !isNegative(it));
  const neg = items.filter(isNegative);

  // 稳定排序：大类顺序 + 原始下标兜底（同大类保持加入顺序）
  const ordered = pos
    .map((it, i) => ({ it, i }))
    .sort((a, b) => catRank(a.it.cat) - catRank(b.it.cat) || a.i - b.i)
    .map((x) => x.it);

  const positive = dedupe(ordered.map((it) => cartItemText(it, lang)).filter(Boolean)).join(sep);
  const negative = dedupe(neg.map((it) => cartItemText(it, lang)).filter(Boolean)).join(sep);

  const parts: string[] = [];
  if (positive) parts.push(positive);
  if (negative) parts.push(lang === 'zh' ? `负面：${negative}` : `Negative: ${negative}`);
  return parts.join(lang === 'zh' ? '。' : '. ');
}

/** 默认分组 id（购物车里 group 缺省的条目都归到这一组）。 */
export const DEFAULT_MALL_GROUP = 'g1';

/** 带分组的购物车条目（PromptMallCartItem 满足此形状）。 */
export interface GroupedAssembleItem extends AssembleItem {
  group?: string;
}

/** 分组（= 一张图的一个组成部分）。 */
export interface AssembleGroup {
  id: string;
  name: string;
}

/** 组名是否为「默认名」（组 N / Group N）——默认名不写进提示词，用户改过的名字才作前缀。 */
function isDefaultGroupName(name: string): boolean {
  const t = (name ?? '').trim();
  return !t || /^(组|group)\s*\d+$/i.test(t);
}

/**
 * 把带分组的购物车合成为一条提示词。
 * - 每个分组（图片的一个组成部分）内部按大类顺序排序、去重 → 一个正向片段；用户命名过的组以「组名：」作前缀。
 * - 多个分组的正向片段用句号连接（组间互不影响、各自独立）。
 * - 负面词跨所有分组汇总到结尾的「负面：」一行（负面是图片全局的，不分组）。
 * - 退化为单个默认组时，输出与 assembleCart 完全一致（向后兼容）。
 */
export function assembleCartGrouped(
  items: GroupedAssembleItem[],
  groups: AssembleGroup[],
  lang: PromptMallLang
): string {
  const gidOf = (it: GroupedAssembleItem): string => it.group || DEFAULT_MALL_GROUP;
  const pos = items.filter((it) => !isNegative(it));
  const neg = items.filter(isNegative);

  // 分组顺序：先按 groups 数组顺序，再补上 items 里引用到但不在 groups 的组（按首次出现）。
  const order: string[] = [];
  const push = (g: string): void => {
    if (!order.includes(g)) order.push(g);
  };
  for (const g of groups) push(g.id);
  for (const it of pos) push(gidOf(it));
  const nameOf = (id: string): string => groups.find((g) => g.id === id)?.name ?? '';

  const segments: string[] = [];
  for (const id of order) {
    const groupItems = pos.filter((it) => gidOf(it) === id);
    if (!groupItems.length) continue;
    const seg = assembleCart(groupItems, lang); // 只含正向 → 返回纯正向片段
    if (!seg) continue;
    const name = nameOf(id);
    segments.push(isDefaultGroupName(name) ? seg : `${name}${lang === 'zh' ? '：' : ': '}${seg}`);
  }

  const positive = segments.join(lang === 'zh' ? '。' : '. ');
  const negSep = lang === 'zh' ? '，' : ', ';
  const negative = dedupe(neg.map((it) => cartItemText(it, lang)).filter(Boolean)).join(negSep);

  const parts: string[] = [];
  if (positive) parts.push(positive);
  if (negative) parts.push(lang === 'zh' ? `负面：${negative}` : `Negative: ${negative}`);
  return parts.join(lang === 'zh' ? '。' : '. ');
}

/** 优化用 systemPrompt（按输出语言）。 */
export const PROMPT_MALL_SYSTEM: Record<PromptMallLang, string> = {
  zh: '你是 AI 绘画提示词整合助手。下面是用户从「提示词商城」挑选的若干提示词片段，请把它们合并、去重、按合理顺序组织成「一条」连贯、自然、可直接用于 AI 绘画的中文提示词。要求：保留每一个概念不要遗漏；不要新增用户没有选择的元素；若片段中出现以「负面：」开头的内容，请把这些不希望出现的内容单独放在结尾的「负面：」一行。只输出最终提示词本身，不要任何解释、不要代码块、不要前后缀。',
  en: 'You are an AI image-prompt integration assistant. Below are prompt fragments the user picked from a Prompt Mall. Merge, de-duplicate, and organize them into ONE coherent, natural English image-generation prompt. Keep every concept (omit nothing); do NOT add elements the user did not pick; if any fragment is introduced by "Negative:", place those undesired elements on a single trailing "Negative:" line. Output ONLY the final prompt itself — no explanation, no code fences, no preamble.'
};

/** 去掉模型回复里可能包裹的 ``` 代码块（best-effort，永不抛）。 */
export function stripFences(raw: string): string {
  let s = (raw ?? '').trim();
  s = s.replace(/^```[a-zA-Z]*\s*\n?/, '').replace(/\n?\s*```$/, '').trim();
  return s;
}
