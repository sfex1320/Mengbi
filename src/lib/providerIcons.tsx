/**
 * 模型厂商图标系统。
 *
 * 设计取舍：
 *   - 用「字母 + 品牌色」的方块徽章作内置预设，识别度足够 + 跨主题统一 +
 *     无需 bundle 一大堆 SVG（@lobehub/icons 整包 5MB+）。
 *   - 想要真品牌 mark 的用户可走「上传自定义」入口，把 PNG/SVG/JPG 转 dataURI
 *     存到 api_configs.icon 列；ProviderIcon 自动识别 data:/ 前缀渲染 <img>。
 *   - 预设 id 用 lobehub 同名 slug，方便日后无缝替换为真 SVG。
 *
 * 参考：https://lobehub.com/icons
 */

import type { CSSProperties } from 'react';

export interface ProviderPreset {
  /** lobehub slug；保存到 DB 的 api_configs.icon 列就是这个串 */
  id: string;
  /** 中文显示名（搜索匹配 + tooltip） */
  label: string;
  /** 1-3 个字母的徽章文字（自动 uppercase） */
  mark: string;
  /** 品牌色，作为徽章背景；用 hex 不依赖主题 token */
  color: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  // 海外大厂
  { id: 'openai', label: 'OpenAI', mark: 'OA', color: '#10A37F' },
  { id: 'anthropic', label: 'Anthropic / Claude', mark: 'A', color: '#D97757' },
  { id: 'gemini', label: 'Google Gemini', mark: 'G', color: '#4285F4' },
  { id: 'meta', label: 'Meta / Llama', mark: 'M', color: '#1877F2' },
  { id: 'mistral', label: 'Mistral', mark: 'Mi', color: '#FA520F' },
  { id: 'cohere', label: 'Cohere', mark: 'Co', color: '#39594D' },
  { id: 'xai', label: 'xAI / Grok', mark: 'X', color: '#000000' },
  { id: 'perplexity', label: 'Perplexity', mark: 'Px', color: '#22B8CD' },
  // 国内大模型厂商
  { id: 'deepseek', label: 'DeepSeek', mark: 'DS', color: '#4D6BFE' },
  { id: 'qwen', label: '通义千问 Qwen', mark: 'Q', color: '#615CED' },
  { id: 'moonshot', label: 'Moonshot / Kimi', mark: 'Ki', color: '#16191E' },
  { id: 'zhipu', label: '智谱 GLM', mark: 'GLM', color: '#0073FF' },
  { id: 'minimax', label: 'MiniMax', mark: 'MM', color: '#F23F5D' },
  { id: 'doubao', label: '豆包 Doubao', mark: 'D', color: '#0FA67D' },
  { id: 'yi', label: '零一 Yi', mark: 'Y', color: '#003D72' },
  { id: 'baichuan', label: '百川 Baichuan', mark: 'Bc', color: '#FF6933' },
  { id: 'spark', label: '讯飞 星火', mark: 'SP', color: '#0070F0' },
  { id: 'hunyuan', label: '腾讯 混元', mark: 'HY', color: '#0052D9' },
  // 本地 / 自部署
  { id: 'ollama', label: 'Ollama', mark: 'Ol', color: '#454545' },
  { id: 'lmstudio', label: 'LM Studio', mark: 'LM', color: '#4338CA' },
  { id: 'vllm', label: 'vLLM', mark: 'vL', color: '#FFCC00' },
  { id: 'llamacpp', label: 'llama.cpp', mark: 'Lc', color: '#FF6B6B' },
  { id: 'comfyui', label: 'ComfyUI', mark: 'Cf', color: '#7B61FF' },
  // 绘画 / 多媒体
  { id: 'midjourney', label: 'Midjourney', mark: 'MJ', color: '#1E1E1E' },
  { id: 'stability', label: 'Stability / SD', mark: 'SD', color: '#000B36' },
  { id: 'flux', label: 'Black Forest / FLUX', mark: 'FL', color: '#1A1A1A' },
  { id: 'recraft', label: 'Recraft', mark: 'Rc', color: '#000000' },
  { id: 'ideogram', label: 'Ideogram', mark: 'Id', color: '#7F00FF' },
  { id: 'runway', label: 'Runway', mark: 'R', color: '#000000' },
  // 平台 / 中转
  { id: 'huggingface', label: 'Hugging Face', mark: 'HF', color: '#FFD21E' },
  { id: 'replicate', label: 'Replicate', mark: 'Re', color: '#000000' },
  { id: 'openrouter', label: 'OpenRouter', mark: 'OR', color: '#6467F2' },
  { id: 'groq', label: 'Groq', mark: 'Gq', color: '#F55036' },
  { id: 'fireworks', label: 'Fireworks', mark: 'Fw', color: '#6720FF' },
  { id: 'together', label: 'Together', mark: 'To', color: '#0F6FFF' },
  { id: 'siliconflow', label: 'SiliconFlow 硅基流动', mark: 'SF', color: '#7C4DFF' },
  { id: 'aihubmix', label: 'AiHubMix', mark: 'AH', color: '#3F51B5' },
  { id: 'apimart', label: 'ApiMart', mark: 'AM', color: '#FB923C' },
  { id: 'grsai', label: 'GRSAI', mark: 'Gr', color: '#10B981' },
  { id: 'newapi', label: 'New API / one-api', mark: 'NA', color: '#06B6D4' }
];

export const PROVIDER_BY_ID: Record<string, ProviderPreset> = PROVIDER_PRESETS.reduce(
  (acc, p) => {
    acc[p.id] = p;
    return acc;
  },
  {} as Record<string, ProviderPreset>
);

/**
 * 按 provider_name / base_url 猜一个默认 icon id。
 * 命中靠子串 + 大小写无关；猜不到返回 null（UI 显示通用回退徽章）。
 */
export function guessProviderIcon(opts: { providerName?: string; baseUrl?: string }): string | null {
  const hay = `${opts.providerName ?? ''} ${opts.baseUrl ?? ''}`.toLowerCase();
  if (!hay.trim()) return null;
  // 顺序敏感：长 / 更具体的子串先匹配（比如 nano-banana 不能落到 google）
  const rules: Array<[RegExp | string, string]> = [
    [/openai\.com|gpt|chatgpt/, 'openai'],
    [/anthropic|claude/, 'anthropic'],
    [/gemini|googleapis|google ai|aistudio/, 'gemini'],
    [/llama\.com|meta\.ai|llama-(?!cpp)/, 'meta'],
    [/mistral/, 'mistral'],
    [/cohere/, 'cohere'],
    [/x\.ai|grok/, 'xai'],
    [/perplexity/, 'perplexity'],
    [/deepseek/, 'deepseek'],
    [/dashscope|aliyun|qwen|通义/, 'qwen'],
    [/moonshot|kimi/, 'moonshot'],
    [/bigmodel|智谱|glm/, 'zhipu'],
    [/minimax/, 'minimax'],
    [/doubao|豆包|bytedance/, 'doubao'],
    [/yi-|01\.ai|零一/, 'yi'],
    [/baichuan|百川/, 'baichuan'],
    [/xfyun|讯飞|星火/, 'spark'],
    [/hunyuan|混元|tencent/, 'hunyuan'],
    [/ollama/, 'ollama'],
    [/lm[\s_-]?studio/, 'lmstudio'],
    [/vllm/, 'vllm'],
    [/llama[\s._-]cpp|llamacpp|\.gguf/, 'llamacpp'],
    [/comfyui|comfy/, 'comfyui'],
    [/midjourney/, 'midjourney'],
    [/stability|stable[\s-]?diffusion/, 'stability'],
    [/flux|black[\s_-]?forest|bfl/, 'flux'],
    [/recraft/, 'recraft'],
    [/ideogram/, 'ideogram'],
    [/runway/, 'runway'],
    [/huggingface|hugging/, 'huggingface'],
    [/replicate/, 'replicate'],
    [/openrouter/, 'openrouter'],
    [/groq/, 'groq'],
    [/fireworks/, 'fireworks'],
    [/together\.(xyz|ai)/, 'together'],
    [/siliconflow|silicon|硅基/, 'siliconflow'],
    [/aihubmix/, 'aihubmix'],
    [/apimart/, 'apimart'],
    [/grsai|dakka/, 'grsai'],
    [/new[\s-]?api|one[\s-]?api/, 'newapi']
  ];
  for (const [pat, id] of rules) {
    if (typeof pat === 'string' ? hay.includes(pat) : pat.test(hay)) return id;
  }
  return null;
}

/**
 * 从名称生成「首字图标」文字（无 preset / 自定义图时的回退）：
 *   - 英文开头 → 取第一个单词的首字母（大写）
 *   - 数字开头 → 取首位数字
 *   - 中文 / 其它（emoji…） → 取第一个字符
 * 空名 → '?'。
 */
export function providerInitial(name: string | undefined | null): string {
  const s = (name ?? '').trim();
  if (!s) return '?';
  const first = Array.from(s)[0] ?? '?';
  if (/[A-Za-z]/.test(first)) {
    const word = s.match(/[A-Za-z][A-Za-z0-9]*/);
    return (word ? word[0][0] : first).toUpperCase();
  }
  if (/[0-9]/.test(first)) return first;
  return first;
}

/** 名称 → 稳定底色（同名恒同色，用于首字图标的背景）。 */
export function providerInitialColor(name: string | undefined | null): string {
  const s = (name ?? '').trim() || '?';
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 46%, 45%)`;
}

interface ProviderIconProps {
  /** 取 lobehub slug（PROVIDER_PRESETS 里的 id）或 data:image/... 自定义 dataURI；null/undefined 走名称首字回退 */
  value: string | null | undefined;
  /** 无 preset/自定义图时，按名称生成首字图标（英文首字母 / 中文首字 + 稳定底色）；缺省才显示「?」 */
  name?: string;
  /** 像素尺寸，默认 32 */
  size?: number;
  /** 圆角，默认 8 */
  radius?: number;
  /** 额外 className */
  className?: string;
  /** 鼠标 tooltip */
  title?: string;
}

/**
 * 统一渲染厂商图标。来源优先级：
 *   - data:image/...  → 自定义上传的图片
 *   - 内置 preset id → 字母徽章 + 品牌色
 *   - 否则若给了 name → 名称首字徽章（英文首字母 / 中文首字 + 名称 hash 底色）
 *   - 都没有 → 灰色「?」回退徽章
 */
export function ProviderIcon({ value, name, size = 32, radius = 8, className, title }: ProviderIconProps): JSX.Element {
  const baseStyle: CSSProperties = {
    width: size,
    height: size,
    borderRadius: radius,
    overflow: 'hidden',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: Math.max(10, Math.floor(size * 0.42)),
    fontWeight: 700,
    letterSpacing: '-0.02em',
    color: '#fff',
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
    userSelect: 'none',
    flexShrink: 0
  };

  if (typeof value === 'string' && value.startsWith('data:')) {
    return (
      <span
        className={className}
        style={{ ...baseStyle, background: 'transparent', border: '1px solid rgba(255,255,255,0.08)' }}
        title={title}
      >
        <img src={value} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} draggable={false} />
      </span>
    );
  }

  const preset = value ? PROVIDER_BY_ID[value] : null;
  if (!preset) {
    // 无 preset/自定义图：给了名称就用「首字 + 名称底色」自动生成图标，否则才显示「?」
    const initial = name ? providerInitial(name) : '?';
    const bg = name && initial !== '?' ? providerInitialColor(name) : 'rgba(120,120,130,0.5)';
    return (
      <span
        className={className}
        style={{ ...baseStyle, background: bg }}
        title={title ?? name ?? '未指定厂商'}
      >
        {initial}
      </span>
    );
  }

  return (
    <span
      className={className}
      style={{ ...baseStyle, background: preset.color }}
      title={title ?? preset.label}
    >
      {preset.mark.toUpperCase()}
    </span>
  );
}
