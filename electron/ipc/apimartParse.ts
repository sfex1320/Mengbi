/**
 * apimart 异步生图响应解析（纯函数，无 electron/网络依赖，可单测）。
 *
 * 背景：apimart 同一个 image_kind 在不同渠道/版本下返回两种异步形态——
 *   ① 官方 gpt-image-2 文档：
 *      提交 → { code:200, data:[{ status:'submitted', task_id:'task_xxx' }] }
 *      轮询 GET /v1/tasks/{task_id} → { code:200, data:{ status, result:{ images:[{ url:["..."] }] } } }
 *   ② 新版 async-generations（实测）：task_id / job_id 放在**顶层**，并给一个自描述的 status_url：
 *      提交 → { created, job_id:'img_xxx', status:'pending',
 *               status_url:'/v1/images/async-generations/img_xxx', task_id:'img_xxx' }
 *      轮询 GET {origin}{status_url} → 形态不固定（result.images / data[].url / output[] 等）
 *
 * 原实现只认 `data[0].task_id` + 只轮询 `/tasks/{id}` + 只读 `data.result.images[].url[]`，
 * 碰到形态②时「提交未返回 task_id」直接判失败——但上游其实已生成并计费（图丢了）。
 * 这里把「抽 task_id / status_url」「抽状态」「抽图片 URL」做成对两种形态都鲁棒的纯函数。
 */

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}
function asObj(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}
function asArr(v: unknown): unknown[] | undefined {
  return Array.isArray(v) ? v : undefined;
}

/** 提交响应里的 code（非 200/0 视为提交失败；无 code 字段返回 undefined = 不拦）。 */
export function apimartCode(json: unknown): number | undefined {
  const c = asObj(json)?.code;
  return typeof c === 'number' ? c : undefined;
}

/**
 * 从提交响应抽 task_id + status_url（轮询地址）。
 * 兼容 data[0].{task_id|job_id|id} / data.{...} / 顶层 {task_id|job_id|id} 与各处的 status_url。
 */
export function extractApimartSubmit(json: unknown): { taskId?: string; statusUrl?: string } {
  const root = asObj(json);
  if (!root) return {};
  const d0 = asObj(asArr(root.data)?.[0]);
  const dObj = asObj(root.data);
  const taskId =
    str(d0?.task_id) ??
    str(d0?.job_id) ??
    str(d0?.id) ??
    str(dObj?.task_id) ??
    str(dObj?.job_id) ??
    str(dObj?.id) ??
    str(root.task_id) ??
    str(root.job_id) ??
    str(root.id);
  const statusUrl = str(d0?.status_url) ?? str(dObj?.status_url) ?? str(root.status_url);
  return { taskId, statusUrl };
}

/** 轮询响应的状态（小写归一）。data.status 优先，其次顶层 status。 */
export function extractApimartStatus(json: unknown): string {
  const root = asObj(json);
  const dObj = asObj(root?.data);
  return (str(dObj?.status) ?? str(root?.status) ?? '').toLowerCase();
}

const DONE_STATUSES = new Set(['completed', 'succeeded', 'success', 'done', 'finished']);
const FAILED_STATUSES = new Set(['failed', 'error', 'cancelled', 'canceled']);
export function isApimartDone(status: string): boolean {
  return DONE_STATUSES.has(status);
}
export function isApimartFailed(status: string): boolean {
  return FAILED_STATUSES.has(status);
}

/** 轮询响应里的错误文案。 */
export function extractApimartError(json: unknown): string | undefined {
  const root = asObj(json);
  const dObj = asObj(root?.data);
  return str(dObj?.error) ?? str(dObj?.message) ?? str(root?.error) ?? str(root?.message);
}

/**
 * 从轮询响应里尽可能抽出图片 URL（只收 http(s)）。兼容多种形态：
 *   result.images[].url（string 或 string[]） / images[].url / images[]（裸串）
 *   data[].url（OpenAI 风格） / output[].url / output[]（裸串） / 顶层 url
 * 在 root 与 root.data / root.result / root.data.result 多个层级各试一遍，去重。
 */
export function extractApimartImageUrls(json: unknown): string[] {
  const out: string[] = [];
  const pushUrl = (v: unknown): void => {
    const s = str(v);
    if (s && /^https?:\/\//i.test(s)) out.push(s);
  };
  const collectImages = (images: unknown): void => {
    for (const im of asArr(images) ?? []) {
      const imo = asObj(im);
      if (!imo) {
        pushUrl(im); // images:["http..."]
        continue;
      }
      const u = imo.url;
      if (Array.isArray(u)) u.forEach(pushUrl);
      else pushUrl(u);
      pushUrl(imo.image_url);
    }
  };

  const root = asObj(json);
  const levels: Array<Record<string, unknown> | undefined> = [
    root,
    asObj(root?.data),
    asObj(root?.result),
    asObj(asObj(root?.data)?.result)
  ];
  // data 为数组（OpenAI images 风格 [{url}|{b64_json 略}]）
  for (const it of asArr(root?.data) ?? []) pushUrl(asObj(it)?.url ?? it);

  for (const lv of levels) {
    if (!lv) continue;
    collectImages(lv.images);
    collectImages(asObj(lv.result)?.images);
    for (const it of asArr(lv.output) ?? []) pushUrl(asObj(it)?.url ?? it);
    pushUrl(lv.url);
  }
  return [...new Set(out)];
}

/**
 * 把相对 status_url 解析到 base_url 的 origin。
 * 关键：base_url 常已含 /v1，status_url 也常以 /v1 开头——必须挂到 origin（scheme+host）而非拼到 base_url，
 * 否则得到双 /v1。已是绝对地址则原样返回。
 */
export function resolveApimartStatusUrl(baseUrl: string, statusUrl: string): string {
  try {
    if (/^https?:\/\//i.test(statusUrl)) return statusUrl;
    const origin = new URL(baseUrl).origin;
    return origin + (statusUrl.startsWith('/') ? statusUrl : '/' + statusUrl);
  } catch {
    return statusUrl;
  }
}
