/**
 * 用户填的 base_url 形态各异：
 *   - https://api.openai.com/v1            (官方推荐)
 *   - https://api.openai.com               (省略 /v1)
 *   - https://xxx.com/api/v1               (中转站常见)
 *   - https://xxx.com                      (中转站常见)
 *
 * 这个 helper 把 base_url 与目标后缀（`chat/completions` / `images/generations` / `models`）
 * 拼成最终请求 URL，自动补 `/v1` 让"忘记加 /v1"的填法也能跑通。
 */

export function joinApiUrl(baseUrl: string, suffix: string): string {
  const trimmedBase = baseUrl.replace(/\/+$/, '');
  const trimmedSuffix = suffix.replace(/^\/+/, '');
  // 容错 1：用户把整条 endpoint 粘进 base_url（…/chat/completions）→ 原样返回不再重复拼
  if (trimmedBase.toLowerCase().endsWith(`/${trimmedSuffix.toLowerCase()}`)) return trimmedBase;
  // 容错 2：suffix 自带版本段（如 'v1/chat/completions'）→ 与 base 的版本段去重，避免双 /v1
  const baseHasVersion = /\/(v1|v1beta|v2|api)\/?$/i.test(trimmedBase);
  const suffixHasVersion = /^(v1|v1beta|v2)\//i.test(trimmedSuffix);
  if (suffixHasVersion) {
    return baseHasVersion
      ? `${trimmedBase}/${trimmedSuffix.replace(/^(v1|v1beta|v2)\//i, '')}`
      : `${trimmedBase}/${trimmedSuffix}`;
  }
  const root = baseHasVersion ? trimmedBase : `${trimmedBase}/v1`;
  return `${root}/${trimmedSuffix}`;
}

/**
 * 上游 HTTP 错误状态码 → 中文「做什么 + 怎么办」提示。
 * Kimi/MiniMax 等中转 404/403 时给用户可执行的排查方向，而不是裸状态码。
 */
export function httpStatusHint(status: number): string {
  if (status === 401) return 'API Key 无效或已过期：去 设置 → 模型方案 重新粘贴 Key';
  if (status === 403) return '无权限：检查账户是否欠费、该模型是否已在中转站/官方开通';
  if (status === 404) return '接口路径不存在：检查 base_url 是否多写/少写 /v1，或「对话 API 协议」与该模型不匹配（有的中转按模型原生协议路由，如 Claude/DeepSeek 需选 Anthropic 协议）';
  if (status === 429) return '请求被限流：稍候重试，或换一个模型/方案';
  if (status >= 500) return '上游服务故障：稍后再试；持续失败请联系中转站';
  if (status === 400) return '请求被上游拒绝：检查模型名映射是否正确（显示名 → 实际模型 ID）';
  return '请求失败：检查 base_url、API Key 与模型映射';
}

/**
 * 上游响应体是否「内容审核 / 敏感」拦截（与 base_url/Key 无关）。
 * 覆盖：MiniMax `new_sensitive`/1026、各家 content_policy / risk control / moderation、中文「审核/违规/敏感」、422 unprocessable。
 */
export function isContentModeration(body: string): boolean {
  const low = (body ?? '').toLowerCase();
  return /new_sensitive|sensitive|content[_-]?policy|risk[_\s-]?control|moderation|unprocessable_entity|审核|违规|敏感|\b1026\b/.test(low);
}

/** 内容审核拦截的中文「做什么 + 怎么办」（明确告诉用户不是配置问题）。 */
export function moderationHint(status: number): string {
  return `内容被上游「内容审核」拦截（HTTP ${status}，与 base_url / API Key 无关）：图片或提示词疑似含 人物肖像 / 政治 / 历史 / 名人 等敏感内容（国产模型尤其严格）。换一张图、改下措辞，或换一个审核更宽松的模型再试`;
}

/** 测试连通用：返回所有可能的探测端点候选（按顺序尝试） */
export function buildModelsEndpointCandidates(baseUrl: string): string[] {
  const trimmed = baseUrl.replace(/\/+$/, '');
  const result: string[] = [`${trimmed}/models`];
  const hasVersion = /\/(v1|v1beta|v2|api)\/?$/i.test(trimmed);
  if (!hasVersion) {
    result.push(`${trimmed}/v1/models`);
    result.push(`${trimmed}/v1/`);
  }
  result.push(`${trimmed}/`);
  return result;
}
