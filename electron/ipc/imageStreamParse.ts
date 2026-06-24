/**
 * 图像 SSE 流事件解析（纯函数，无 electron/网络依赖，可单测）。
 *
 * 背景：gpt-image 系列走 `stream:true` 的 `/v1/images/generations` 或 `/v1/responses` 时，
 * 上游按 SSE 推 中间步骤图（partial）+ 终态图（completed）。OpenAI 官方终态图放 `b64_json`，
 * 但各中转站（如 unity2 等）会把终态图放在 `url` / `data[0].url` / `image.url` / `images[0]` 等位置，
 * 或事件类型名不同 —— 原解析器只认 `image_generation.completed` + `b64_json`，于是「后台已出图（已计费）、
 * 前端却报『没收到 completed 事件』丢图」。这里把「从一个事件 JSON 抽图片载荷」做成对多形态鲁棒的纯函数。
 */

/** 图像 SSE 事件里的归一化图片载荷（b64 或 url，二选一）。 */
export interface StreamImg {
  b64?: string;
  url?: string;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}
function obj(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}
function arr0(v: unknown): Record<string, unknown> | undefined {
  return Array.isArray(v) ? obj(v[0]) : undefined;
}

/**
 * 从一个图像 SSE 事件 JSON 里尽量抽出图片载荷（b64 优先于 url）——兼容各中转站字段差异。
 * 覆盖：`b64_json` / `partial_image_b64` / `result` / `data[0].b64_json|url` / `image.{b64_json|url}` /
 * `images[0]`（裸 http 串或 {b64_json|url}）/ 顶层 `url` / `image_url`。抽不到返回 null。
 */
export function pickStreamImage(json: Record<string, unknown>): StreamImg | null {
  const data0 = arr0(json.data);
  const img = obj(json.image);
  const images0 = arr0(json.images);
  const imagesFirstStr = Array.isArray(json.images) ? str(json.images[0]) : undefined;

  const b64 =
    str(json.b64_json) ??
    str(json.partial_image_b64) ??
    str(json.result) ??
    str(data0?.b64_json) ??
    str(img?.b64_json) ??
    str(images0?.b64_json);
  if (b64) return { b64 };

  const url =
    str(json.url) ??
    str(json.image_url) ??
    str(data0?.url) ??
    str(img?.url) ??
    str(images0?.url) ??
    (imagesFirstStr && /^https?:\/\//i.test(imagesFirstStr) ? imagesFirstStr : undefined);
  if (url) return { url };

  return null;
}
