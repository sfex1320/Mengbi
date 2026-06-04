/**
 * 把中转站文档里粘贴过来的 SDK 代码示例（Python / TypeScript / curl）regex 抽出
 *   - base_url
 *   - api_key
 *   - 默认 model id
 * 三个字段，让用户省掉手填配置的步骤。
 *
 * 设计决策：
 * - 仅 regex，不引入 AST。中转站给的示例都很标准，regex 命中率 > 95%；
 *   想写出 5% 边角的健壮版需要 babel-parser，得不偿失。
 * - 三种语言**复用同一组顶层正则**——因为关键 token（base_url / api_key / model）
 *   通常都用引号包裹相同字符串，差异只在赋值符号（=  /  :）。
 */

export interface ParsedSnippet {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  /** 解析推断出的语言，仅用于 UI 提示。 */
  language?: 'python' | 'typescript' | 'curl' | 'unknown';
}

/**
 * 主入口：传入用户粘贴的整段代码，返回解析结果。
 * 任何字段无法识别 → 不出现在结果对象里（不返回空字符串）。
 */
export function parseSdkSnippet(text: string): ParsedSnippet {
  if (!text || typeof text !== 'string') return { language: 'unknown' };

  const language = detectLanguage(text);

  // base_url / baseURL / base-url 各种变体
  const baseUrl = pickFirst(text, [
    /base[_-]?url\s*[:=]\s*["']([^"']+)["']/i,
    /baseURL\s*[:=]\s*["']([^"']+)["']/,
    // curl 形式：从 URL 中扒到 /v1 之前那段
    /curl\s+(?:-\w+\s+\S+\s+)*["']?(https?:\/\/[^\s"'/]+(?:\/v\d+)?)/i
  ]);

  const apiKey = pickFirst(text, [
    /api[_-]?key\s*[:=]\s*["']([^"']+)["']/i,
    /apiKey\s*[:=]\s*["']([^"']+)["']/,
    // curl Authorization Bearer 头
    /-H\s+["']Authorization:\s*Bearer\s+([^"'\s]+)["']/i,
    /Authorization:\s*Bearer\s+([A-Za-z0-9_\-.]+)/i
  ]);

  // 默认模型 ID：python `model="..."`、ts `model: '...'`、json/curl `"model":"..."`
  const model = pickFirst(text, [
    /\bmodel\s*[:=]\s*["']([^"']+)["']/i
  ]);

  const result: ParsedSnippet = { language };
  if (baseUrl) result.baseUrl = normalizeBaseUrl(baseUrl);
  if (apiKey && !isPlaceholderKey(apiKey)) result.apiKey = apiKey;
  if (model && !isPlaceholderModel(model)) result.model = model;
  return result;
}

/**
 * 在多个候选正则里，按顺序找第一个能在文本里匹配到的，返回其首个捕获组。
 */
function pickFirst(text: string, patterns: RegExp[]): string | undefined {
  for (const re of patterns) {
    const m = re.exec(text);
    if (m && m[1]) return m[1].trim();
  }
  return undefined;
}

function detectLanguage(text: string): ParsedSnippet['language'] {
  const t = text.trim();
  if (/^\s*curl\b/i.test(t) || /\s+curl\s+(?:-\w+\s+)?https?:\/\//i.test(t)) {
    return 'curl';
  }
  if (/from\s+openai\s+import|import\s+openai\b/i.test(t)) return 'python';
  if (/import\s+OpenAI|from\s+["']openai["']|new\s+OpenAI\s*\(/.test(t)) return 'typescript';
  // python 风格的 dict/构造（base_url=, api_key=）
  if (/\bbase_url\s*=|\bapi_key\s*=/i.test(t)) return 'python';
  // ts 风格的对象字面量（baseURL:, apiKey:）
  if (/\bbaseURL\s*:|\bapiKey\s*:/.test(t)) return 'typescript';
  return 'unknown';
}

/**
 * 用户粘贴的 base_url 形式可能五花八门：
 *   - https://api.openai.com/v1   ← 期望
 *   - https://api.openai.com/v1/  ← 末尾斜杠
 *   - https://api.openai.com/v1/chat/completions  ← 完整端点（curl 里常见）
 *   - https://api.openai.com      ← 没带 /v1
 * 统一规整为 `https://host(/v1)?` 形式，去掉具体端点路径。
 */
function normalizeBaseUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, '');
  // 砍掉 /chat/completions / /completions / /messages / /images/generations 等具体端点
  url = url.replace(
    /\/(chat\/completions|completions|messages|images\/(?:generations|edits)|embeddings|models)\/?$/i,
    ''
  );
  return url;
}

/**
 * 常见的占位 key —— 用户复制示例代码时可能没替换掉。检出后不要填进 form。
 */
function isPlaceholderKey(s: string): boolean {
  const lower = s.toLowerCase();
  return (
    lower.includes('your') ||
    lower.includes('xxx') ||
    lower.includes('<') ||
    lower.includes('placeholder') ||
    lower === 'sk-...' ||
    lower === 'sk-' ||
    /^(your[_-]?api[_-]?key|api[_-]?key[_-]?here|insert[_-]?key)/.test(lower)
  );
}

function isPlaceholderModel(s: string): boolean {
  const lower = s.toLowerCase();
  return lower.includes('<') || lower === '...' || lower === 'model_id';
}
