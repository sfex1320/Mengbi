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
  const hasVersion = /\/(v1|v1beta|v2|api)\/?$/i.test(trimmedBase);
  const root = hasVersion ? trimmedBase : `${trimmedBase}/v1`;
  return `${root}/${trimmedSuffix}`;
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
