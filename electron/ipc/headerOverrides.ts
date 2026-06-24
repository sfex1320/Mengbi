/**
 * 自定义请求头覆盖（api_configs.header_overrides_json）。
 *
 * 让用户给某个中转站 / 官方卡密会员配一段 JSON（header 名 → 值），在默认请求头之上合并发出，
 * 解决「标准 sk- key 却用不了」这类需要特殊鉴权头 / 自定义头的接入：
 *   - 值里支持 `${key}` / `${model}` 变量替换（可内嵌，如 `"Authorization": "Token ${key}"`、`"x-api-key": "${key}"`）；
 *   - 值为 `null` → 删除该 header（如把默认的 `Authorization` 删掉换成别的鉴权头）；
 *   - header 名大小写不敏感地覆盖默认项（HTTP header 名本就不区分大小写）；
 *   - 解析失败 / 非对象 → 原样返回 base（容错，绝不抛）。
 *
 * 纯函数，便于单测；运行期在 chat / image / video / lab 各请求点调用。
 */
export interface HeaderOverrideVars {
  key?: string;
  model?: string;
}

export function applyHeaderOverrides(
  base: Record<string, string>,
  overridesJson: string | null | undefined,
  vars: HeaderOverrideVars = {}
): Record<string, string> {
  if (!overridesJson || !overridesJson.trim()) return base;
  let parsed: unknown;
  try {
    parsed = JSON.parse(overridesJson);
  } catch {
    return base;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return base;

  const result: Record<string, string> = { ...base };
  // lower(header 名) → 实际键，用于大小写不敏感的覆盖 / 删除
  const lowerToKey = new Map<string, string>();
  for (const k of Object.keys(result)) lowerToKey.set(k.toLowerCase(), k);

  for (const [rawName, rawVal] of Object.entries(parsed as Record<string, unknown>)) {
    const name = rawName.trim();
    if (!name) continue;
    const lower = name.toLowerCase();
    const existingKey = lowerToKey.get(lower);

    // null / undefined → 删除该 header
    if (rawVal === null || rawVal === undefined) {
      if (existingKey) {
        delete result[existingKey];
        lowerToKey.delete(lower);
      }
      continue;
    }

    let val = typeof rawVal === 'string' ? rawVal : String(rawVal);
    // 变量替换（可内嵌于字符串任意位置）
    val = val.replace(/\$\{(\w+)\}/g, (m, v: string) => {
      if (v === 'key') return vars.key ?? '';
      if (v === 'model') return vars.model ?? '';
      return m;
    });

    if (existingKey) {
      result[existingKey] = val;
    } else {
      result[name] = val;
      lowerToKey.set(lower, name);
    }
  }
  return result;
}

/**
 * 设置页落库前的校验/归一：空串 → null；非法（不是 JSON 对象）→ 返回错误原因。
 * 返回 `{ value }` 表示合法（value 为归一后的字符串或 null），`{ error }` 表示非法。
 */
export function validateHeaderOverrides(
  raw: string | null | undefined
): { value: string | null } | { error: string } {
  const s = (raw ?? '').trim();
  if (s === '') return { value: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(s);
  } catch (e) {
    return { error: `JSON 解析失败：${(e as Error).message}` };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { error: '必须是 JSON 对象（header 名 → 值）' };
  }
  return { value: s };
}
