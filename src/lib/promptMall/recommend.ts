/**
 * 提示词商城「按描述推荐分类」：用户输入一段简短描述 → 对话模型识别主体 → 返回最相关的商城分类 slug。
 * 复用 `api:chat:optimize-prompt`（一发一收 + systemPrompt 覆盖），与 translateText 同源；纯前端、无新 IPC。
 */
import { useSettingsStore } from '@/store/settingsStore';
import { listMappedModels } from '../modelMapping';
import { extractJsonBlock } from '../jsonPrompt';

export async function recommendMallCategories(
  description: string,
  categories: { slug: string; zh: string }[],
  /** 指定对话模型（显示名）；不传 / 不可用则用首个可用 */
  modelId?: string
): Promise<{ ok: true; slugs: string[] } | { ok: false; reason: string }> {
  const t = description.trim();
  if (!t) return { ok: false, reason: '请先输入一段描述' };
  const { configs, activePlanId } = useSettingsStore.getState();
  if (activePlanId == null) return { ok: false, reason: '没有激活的方案，请到设置页选择/新建方案' };
  const models = listMappedModels(configs, activePlanId, 'text').filter((m) => m.usable);
  if (!models.length) return { ok: false, reason: '当前方案没有可用对话模型，请到设置页配置一个' };
  const chosen = modelId && models.find((m) => m.name === modelId) ? modelId : models[0].name;
  const list = categories.map((c) => `${c.slug} = ${c.zh}`).join('\n');
  const sys =
    `你是「提示词商城」导购。下面是可用商城分类（格式 slug = 中文名）：\n${list}\n\n` +
    '根据用户对想创作的图片/作品的描述，识别其主体与需求，挑出最相关的 3-8 个分类。' +
    '只输出一个 JSON 字符串数组，元素是分类 slug（必须取自上面列表），按相关度从高到低排序。不要任何解释、不要代码围栏外的文字。';
  const r = await window.electronAPI.chat.optimizePrompt({
    planId: activePlanId,
    modelId: chosen,
    userInput: t,
    systemPrompt: sys
  });
  if (!r.ok) return { ok: false, reason: r.error.message };
  if (!r.data.optimizedBy) return { ok: false, reason: r.data.reason || '推荐失败，请重试或换模型' };
  let arr: unknown = null;
  try {
    arr = JSON.parse(extractJsonBlock(r.data.optimized));
  } catch {
    arr = null;
  }
  const valid = new Set(categories.map((c) => c.slug));
  const slugs = Array.isArray(arr)
    ? Array.from(new Set(arr.filter((x): x is string => typeof x === 'string' && valid.has(x))))
    : [];
  if (!slugs.length) return { ok: false, reason: '没能匹配到分类，换个说法再试' };
  return { ok: true, slugs };
}
