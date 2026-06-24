/**
 * 文本翻译（复用对话模型，走 `api:chat:optimize-prompt` 的「一发一收」+ systemPrompt 覆盖路径）。
 * 注意：`api:lab:translate` 的非 mock 实现是占位（NOT_IMPLEMENTED），真正能翻译的是这条；
 * 与智能画布 LLM 节点的「翻译」操作同源。纯前端，无新 IPC。
 */
import { useSettingsStore } from '@/store/settingsStore';
import { listMappedModels } from './modelMapping';

export type TranslateDir = 'zh-to-en' | 'en-to-zh';

/** 自动判向：含中日韩文字 → 译英，否则 → 译中。 */
export function detectTranslateDir(text: string): TranslateDir {
  return /[一-鿿぀-ヿ가-힯]/.test(text) ? 'zh-to-en' : 'en-to-zh';
}

const SYS: Record<TranslateDir, string> = {
  'zh-to-en': '你是翻译助手。把输入忠实、自然地翻译成英文，只输出译文，不要解释、不要引号包裹。',
  'en-to-zh': '你是翻译助手。把输入忠实、自然地翻译成中文，只输出译文，不要解释、不要引号包裹。'
};

export async function translateText(
  text: string,
  dir: TranslateDir,
  /** 指定用哪个对话模型（显示名）；不传或不可用则用首个可用对话模型 */
  modelId?: string
): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  const t = text.trim();
  if (!t) return { ok: false, reason: '没有可翻译的内容' };
  const { configs, activePlanId } = useSettingsStore.getState();
  if (activePlanId == null) return { ok: false, reason: '没有激活的方案，请到设置页选择/新建方案' };
  const models = listMappedModels(configs, activePlanId, 'text').filter((m) => m.usable);
  if (!models.length) return { ok: false, reason: '当前方案没有可用对话模型，请到设置页配置一个' };
  // 优先用指定模型（须在可用列表里），否则首个可用——让用户能避开会 400 的那个模型
  const chosen = (modelId && models.find((m) => m.name === modelId)) ? modelId : models[0].name;
  const r = await window.electronAPI.chat.optimizePrompt({
    planId: activePlanId,
    modelId: chosen,
    userInput: t,
    systemPrompt: SYS[dir]
  });
  if (!r.ok) return { ok: false, reason: r.error.message };
  // optimizedBy 为 null = 回退原文（失败）；reason 带上游具体原因
  if (!r.data.optimizedBy) return { ok: false, reason: r.data.reason || '翻译失败，请重试或换模型' };
  return { ok: true, text: r.data.optimized.trim() };
}
