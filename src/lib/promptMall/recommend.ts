/**
 * 提示词商城「按描述推荐分类」：用户输入一段简短描述 → 对话模型识别主体 → 返回最相关的商城分类 slug。
 * 复用 `api:chat:optimize-prompt`（一发一收 + systemPrompt 覆盖），与 translateText 同源；纯前端、无新 IPC。
 */
import { useSettingsStore } from '@/store/settingsStore';
import { listMappedModels } from '../modelMapping';
import { extractJsonBlock } from '../jsonPrompt';

export interface MallRecommendCat {
  slug: string;
  zh: string;
  subs: { slug: string; zh: string }[];
}
export interface MallRecommendResult {
  /** 推荐的大类 slug（按相关度高→低） */
  slugs: string[];
  /** 推荐的子类，键为 `大类slug/子类slug`（按相关度高→低） */
  subKeys: string[];
}

export async function recommendMallCategories(
  description: string,
  categories: MallRecommendCat[],
  /** 指定对话模型（显示名）；不传 / 不可用则用首个可用 */
  modelId?: string
): Promise<{ ok: true; result: MallRecommendResult } | { ok: false; reason: string }> {
  const t = description.trim();
  if (!t) return { ok: false, reason: '请先输入一段描述' };
  const { configs, activePlanId } = useSettingsStore.getState();
  if (activePlanId == null) return { ok: false, reason: '没有激活的方案，请到设置页选择/新建方案' };
  const models = listMappedModels(configs, activePlanId, 'text').filter((m) => m.usable);
  if (!models.length) return { ok: false, reason: '当前方案没有可用对话模型，请到设置页配置一个' };
  const chosen = modelId && models.find((m) => m.name === modelId) ? modelId : models[0].name;
  // 把「大类 + 其子类」一并喂给模型，让它既推大类、也推到具体子类
  const list = categories
    .map((c) => `${c.slug} = ${c.zh}${c.subs.length ? `（子类：${c.subs.map((s) => `${s.slug}=${s.zh}`).join('、')}）` : ''}`)
    .join('\n');
  const sys =
    `你是「提示词商城」导购。下面是可用商城大类与其子类（格式 大类slug = 中文名（子类：子slug=中文…））：\n${list}\n\n` +
    '根据用户对想创作的图片/作品的描述，识别其主体与需求，挑出最相关的 3-8 个大类，以及最相关的 4-12 个具体子类。' +
    '只输出一个 JSON 对象：{"cats":[大类slug…],"subs":["大类slug/子类slug"…]}（slug 必须取自上面列表），按相关度从高到低排序。不要任何解释、不要代码围栏外的文字。';
  const r = await window.electronAPI.chat.optimizePrompt({
    planId: activePlanId,
    modelId: chosen,
    userInput: t,
    systemPrompt: sys
  });
  if (!r.ok) return { ok: false, reason: r.error.message };
  if (!r.data.optimizedBy) return { ok: false, reason: r.data.reason || '推荐失败，请重试或换模型' };
  let obj: unknown = null;
  try {
    obj = JSON.parse(extractJsonBlock(r.data.optimized));
  } catch {
    obj = null;
  }
  const validCat = new Set(categories.map((c) => c.slug));
  const validSub = new Set<string>();
  for (const c of categories) for (const s of c.subs) validSub.add(`${c.slug}/${s.slug}`);
  // 兼容两种返回：对象 {cats,subs} 或退化成纯大类数组
  const rawCats = Array.isArray(obj) ? obj : (obj as { cats?: unknown })?.cats;
  const rawSubs = Array.isArray(obj) ? [] : (obj as { subs?: unknown })?.subs;
  const slugs = Array.isArray(rawCats)
    ? Array.from(new Set(rawCats.filter((x): x is string => typeof x === 'string' && validCat.has(x))))
    : [];
  const subKeys = Array.isArray(rawSubs)
    ? Array.from(new Set(rawSubs.filter((x): x is string => typeof x === 'string' && validSub.has(x))))
    : [];
  // 子类命中但其大类没在 cats 里 → 补进大类，保证点高亮子类能切过去
  for (const sk of subKeys) {
    const cat = sk.split('/')[0];
    if (!slugs.includes(cat)) slugs.push(cat);
  }
  if (!slugs.length && !subKeys.length) return { ok: false, reason: '没能匹配到分类，换个说法再试' };
  return { ok: true, result: { slugs, subKeys } };
}
