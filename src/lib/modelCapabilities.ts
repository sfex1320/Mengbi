/**
 * 按「真实模型 ID」启发式识别对话模型的能力：多模态(vision) / 思考(reasoning) / 原生联网搜索。
 * 纯名匹配表，即时、免费、不调接口；配合设置页的「测试连通/探测 /models」就是「两者结合」。
 * 识别结果只是默认值，用户可在开关上手动改。新模型出来时往这里加 pattern 即可。
 */
import type { ThinkingEffort } from '@shared/domain';

export interface ModelCapabilities {
  vision: boolean;
  thinking: boolean;
  webSearch: boolean;
  /** 思考强度建议（仅 thinking 时有意义） */
  thinkingEffort?: ThinkingEffort;
}

/** 多模态（能看图）。Gemini / Claude3+ / GPT-4o 系 / 各家 -VL 模型。 */
const VISION_RE = [
  /gpt-4o|gpt-4\.1|gpt-4-turbo|gpt-4-vision|chatgpt-4o|gpt-5/i,
  /\bo[134]\b/i, // o1 / o3 / o4（含全量版，mini 在下面排除）
  /claude-3|claude-3[.-]5|claude-3[.-]7|claude-4|claude-(opus|sonnet|haiku)-4|claude-(opus|sonnet)-/i,
  /gemini/i, // 所有 gemini 都多模态
  /qwen.*vl|qwen-vl|qvq|qwen2[.-]?5?-vl|qwen3-vl/i,
  /glm-4v|glm-4[.-]1v|glm-4[.-]5v|cogvlm/i,
  /yi-vision|yi-vl/i,
  /internvl|llava|minicpm-v|deepseek-vl|pixtral|step-1v|step-1o|step-3/i,
  /doubao.*vision|doubao-1[.-]5-vision/i,
  /grok-2-vision|grok-vision|grok-4/i,
  /llama-3[.-]2-(11b|90b)|molmo|kimi-vl|ernie.*vl|hunyuan.*vision/i
];
/** 明确不带 vision 的小杯推理模型，避免被上面的 o1/o3 误判 */
const VISION_DENY_RE = /o1-mini|o3-mini|o1-preview/i;

/** 思考 / 推理模型（reasoning_content / 思维链）。 */
const THINKING_RE = [
  /\bo1\b|o1-mini|o1-preview|\bo3\b|o3-mini|\bo4\b|o4-mini/i,
  /deepseek-r1|deepseek-reasoner|\br1\b/i,
  /qwq|qvq|qwen3|qwen-3/i,
  /glm-z1|glm-4[.-]5|glm-zero/i,
  /claude-3[.-]7|claude-opus-4|claude-sonnet-4|claude-.*think/i,
  /gemini-2[.-]0-flash-thinking|gemini-2[.-]5/i,
  /grok-3-mini|grok-4/i,
  /minimax-m1|minimax.*reason/i,
  /kimi.*think|k1[.-]5|kimi-k2-think/i,
  /-thinking|reasoner|reasoning/i
];

/** 自带原生联网（少数）。Perplexity sonar / OpenAI search-preview / Grok live search。 */
const WEBSEARCH_RE = [/sonar|perplexity/i, /search-preview|gpt-4o-search|gpt-4o-mini-search/i, /grok-.*search/i];

function anyMatch(res: RegExp[], id: string): boolean {
  return res.some((re) => re.test(id));
}

/** 识别单个模型 ID 的能力。 */
export function detectOne(modelId: string): ModelCapabilities {
  const id = (modelId || '').trim();
  const vision = anyMatch(VISION_RE, id) && !VISION_DENY_RE.test(id);
  const thinking = anyMatch(THINKING_RE, id);
  const webSearch = anyMatch(WEBSEARCH_RE, id);
  return { vision, thinking, webSearch, thinkingEffort: thinking ? 'high' : undefined };
}

/** 对一组模型 ID 取并集（任一支持即视为支持）。 */
export function detectModelCapabilities(modelIds: string[]): ModelCapabilities {
  const caps: ModelCapabilities = { vision: false, thinking: false, webSearch: false };
  for (const id of modelIds) {
    const c = detectOne(id);
    caps.vision ||= c.vision;
    caps.thinking ||= c.thinking;
    caps.webSearch ||= c.webSearch;
    if (c.thinking && !caps.thinkingEffort) caps.thinkingEffort = c.thinkingEffort;
  }
  return caps;
}

/** 给 toast 用的中文摘要。 */
export function summarizeCapabilities(c: ModelCapabilities): string {
  const on: string[] = [];
  if (c.vision) on.push('多模态');
  if (c.thinking) on.push('思考');
  if (c.webSearch) on.push('原生联网');
  return on.length ? `识别为：${on.join(' / ')}` : '识别为：纯对话模型（未命中多模态/思考/联网特征）';
}
