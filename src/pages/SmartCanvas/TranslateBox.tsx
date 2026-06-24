import { useMemo, useState } from 'react';
import { translateText, detectTranslateDir, type TranslateDir } from '@/lib/translateText';
import { listMappedModels } from '@/lib/modelMapping';
import { useSettingsStore } from '@/store/settingsStore';
import { SearchableModelSelect } from './nodePanel/consoleControls';
import { copyText } from './nodeArea';
import { toast } from '@/store/toastStore';

/** 记住上次翻译用的对话模型（显示名） */
const MODEL_KEY = 'mengbi.sc.translateModel.v1';
type OutMode = 'both' | 'translated';

/**
 * 翻译对比小面板：翻译某段文本 → 上=原文 / 下=译文（上下排版），
 * 可「替换原文（永久）」或复制译文。提示词节点、文本放大窗共用。
 * 可选对话模型 + 记忆上次选择（避开会报 400 的模型）。
 */
export function TranslateBox({
  text,
  onReplace,
  replaceLabel = '替换原文（永久）'
}: {
  text: string;
  /** 提供则显示「替换/采用译文」按钮，回调拿到译文 */
  onReplace?: (translated: string) => void;
  replaceLabel?: string;
}): JSX.Element {
  const [dir, setDir] = useState<TranslateDir>(() => detectTranslateDir(text));
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const configs = useSettingsStore((s) => s.configs);
  const activePlanId = useSettingsStore((s) => s.activePlanId);
  const prefs = useSettingsStore((s) => s.prefs);
  const textModels = useMemo(
    () => listMappedModels(configs, activePlanId, 'text').filter((m) => m.usable),
    [configs, activePlanId]
  );
  const [model, setModel] = useState<string>(() => localStorage.getItem(MODEL_KEY) || '');
  // 默认翻译模型：本地记忆 > 设置页「快捷翻译模型」> 首个可用（用户可在设置页统一设，不必每次画布里二次选）
  const settingsModel = (prefs.quick_translate_model ?? '').trim();
  const effModel =
    textModels.find((m) => m.name === model)?.name ??
    textModels.find((m) => m.name === settingsModel)?.name ??
    textModels[0]?.name ??
    '';
  // 输出格式：原文+译文 / 仅译文（默认跟随设置页「翻译输出」）
  const [outMode, setOutMode] = useState<OutMode>(() => (prefs.quick_translate_output === 'translated' ? 'translated' : 'both'));

  function onModelChange(v: string): void {
    setModel(v);
    localStorage.setItem(MODEL_KEY, v);
  }

  async function run(): Promise<void> {
    setLoading(true);
    setResult(null);
    const r = await translateText(text, dir, effModel);
    setLoading(false);
    if (r.ok) setResult(r.text);
    else toast.error('翻译失败', r.reason);
  }

  return (
    <div className="mb-sc-translate nodrag">
      <div className="mb-sc-translate-bar">
        <button
          className="mb-btn mb-btn-sm mb-btn-ghost"
          onClick={() => setDir((d) => (d === 'zh-to-en' ? 'en-to-zh' : 'zh-to-en'))}
          title="切换翻译方向"
        >
          {dir === 'zh-to-en' ? '中 → 英' : '英 → 中'}
        </button>
        {textModels.length > 0 && (
          <div className="mb-sc-translate-model">
            <SearchableModelSelect
              value={effModel}
              options={textModels.map((m) => ({ value: m.name, label: m.label }))}
              placeholder="翻译模型"
              onChange={onModelChange}
            />
          </div>
        )}
        <button
          className="mb-btn mb-btn-sm mb-btn-ghost"
          onClick={() => setOutMode((m) => (m === 'both' ? 'translated' : 'both'))}
          title="切换输出：原文+译文 / 仅译文"
        >
          {outMode === 'both' ? '原文+译文' : '仅译文'}
        </button>
        <button className="mb-btn mb-btn-sm mb-btn-secondary" onClick={() => void run()} disabled={loading}>
          {loading ? '翻译中…' : '🌐 翻译'}
        </button>
        {result != null && (
          <>
            <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={() => copyText(result)}>
              复制译文
            </button>
            {onReplace && (
              <button className="mb-btn mb-btn-sm mb-btn-primary" onClick={() => onReplace(result)}>
                {replaceLabel}
              </button>
            )}
            <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={() => setResult(null)}>
              清除译文
            </button>
          </>
        )}
      </div>
      {result != null && (
        <div className="mb-sc-translate-cmp">
          {outMode === 'both' && (
            <div className="mb-sc-translate-col">
              <div className="mb-sc-translate-coltag">原文</div>
              <div className="mb-sc-translate-text">{text}</div>
            </div>
          )}
          <div className="mb-sc-translate-col">
            <div className="mb-sc-translate-coltag">译文</div>
            <div className="mb-sc-translate-text">{result}</div>
          </div>
        </div>
      )}
    </div>
  );
}
