/**
 * 生图「请求体 / 尺寸」纯函数 —— 从 generate.ts 抽出。
 *
 * 这里的函数全部是纯函数，**不依赖 electron / better-sqlite3 / 网络**，
 * 因此可以直接在 vitest（node 环境）里跑单测，锁住"参数流"的正确性
 * （尤其是「选 4K 实际出 1024」「请求体覆盖变量替换/null 删字段」这类历史 bug）。
 *
 * 调用方（generate.ts）：
 *   - resolveSize(params) 解出最终 size 字符串
 *   - applyBodyOverrides(body, json, vars, onWarn) 做用户级请求体覆盖
 *   - TIER_PIXEL_BUDGET / snapToGrid / pixelsByAspectAndBudget 给 grsai 等分支用
 */

// 比例 → 推荐 size（GPT Image 2 / default 兜底；总像素都压在 8.3MP 内）
const ASPECT_TO_SIZE: Record<string, string> = {
  '1:1': '1024x1024',
  '4:5': '1024x1280',
  '5:4': '1280x1024',
  '3:4': '1152x1536',
  '4:3': '1536x1152',
  '2:3': '1024x1536',
  '3:2': '1536x1024',
  '9:16': '1152x2048',
  '16:9': '2048x1152',
  '21:9': '1680x720',
  '9:21': '720x1680',
  '4:1': '2048x512',
  '1:4': '512x2048',
  '8:1': '2048x256',
  '1:8': '256x2048',
  '2:1': '1536x768',
  '1:2': '768x1536',
  '3:1': '1920x640',
  '1:3': '640x1920'
};

export const TIER_PIXEL_BUDGET: Record<string, number> = {
  '1K': 1_048_576, // 1 MP
  '2K': 4_194_304, // 4 MP
  '4K': 8_294_400 // 8.3 MP
};

export function snapToGrid(value: number): number {
  const snapped = Math.round(value / 16) * 16;
  return Math.max(256, Math.min(3840, snapped));
}

/** 严格向下取到 16 的倍数；用于"必须不超预算"的场景（4K 预算 8.3MP） */
function snapDown16(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 256;
  const snapped = Math.floor(value / 16) * 16;
  return Math.max(256, Math.min(3840, snapped));
}

/**
 * 给定比例字符串 + 总像素预算，反推 W×H。
 * 关键约束：snap 后 w*h 必须 **小于等于** totalPx——否则像 GPT Image 2 这种严格 8.3MP 上限的模型会拒绝。
 * 算法：先用 floor-to-16 取下，得到 w0/h0；若仍 > budget（极端比例下浮点误差），逐步把更长那边 -16 直到合规。
 */
export function pixelsByAspectAndBudget(aspect: string, totalPx: number): { w: number; h: number } {
  const [aw, ah] = aspect.split(':').map(Number);
  if (!Number.isFinite(aw) || !Number.isFinite(ah) || aw <= 0 || ah <= 0) {
    const side = Math.sqrt(totalPx);
    return { w: snapDown16(side), h: snapDown16(side) };
  }
  const hExact = Math.sqrt((totalPx * ah) / aw);
  const wExact = (hExact * aw) / ah;
  let w = snapDown16(wExact);
  let h = snapDown16(hExact);
  // 兜底：极端时再削一档
  while (w * h > totalPx && (w > 256 || h > 256)) {
    if (w >= h && w > 256) w -= 16;
    else if (h > 256) h -= 16;
    else break;
  }
  return { w, h };
}

/**
 * 解析 params 拿到最终 size 字符串。
 * 优先级：custom W×H > image_size 档位（按总像素） > aspect 比例预设 > 默认 1024x1024
 */
export function resolveSize(params: Record<string, unknown>): string {
  const w = Number(params.width);
  const h = Number(params.height);
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    return `${snapToGrid(w)}x${snapToGrid(h)}`;
  }
  const imageSize = typeof params.image_size === 'string' ? params.image_size : '';
  const aspect = typeof params.aspect === 'string' ? params.aspect : '1:1';
  const budget = TIER_PIXEL_BUDGET[imageSize];
  if (budget) {
    const { w: cw, h: ch } = pixelsByAspectAndBudget(aspect, budget);
    return `${cw}x${ch}`;
  }
  return ASPECT_TO_SIZE[aspect] ?? '1024x1024';
}

/**
 * 用户在方案配置里写的 JSON 请求体覆盖，与默认 body 顶层合并（详见 CLAUDE.md §13）。
 * 语义：① 整串 `${var}` 才替换为变量真实值（值为 null = 删字段）；② 合并后所有 null/undefined 字段删除。
 * onWarn：未知变量名（多半拼错）时回调一条警告——跳过该项覆盖、保留默认值，而不是静默删字段。
 */
export function applyBodyOverrides(
  body: Record<string, unknown>,
  overrideText: string | null | undefined,
  vars: Record<string, unknown>,
  onWarn?: (msg: string) => void
): void {
  if (!overrideText || !overrideText.trim()) return;
  let overrides: Record<string, unknown>;
  try {
    overrides = JSON.parse(overrideText) as Record<string, unknown>;
  } catch {
    // 理论上不会到这里（zod 已拦截）。万一发生，宁可静默跳过覆盖也不让生图失败。
    return;
  }
  for (const [k, v] of Object.entries(overrides)) {
    if (typeof v === 'string') {
      const m = v.match(/^\$\{(\w+)\}$/);
      if (m) {
        // 变量名在 vars 里才替换（含值为 null 时 → 删字段语义）；
        // 名字打错(vars 没这个键)时跳过此项覆盖、保留默认值，并记警告——
        // 而不是当成 undefined 把 body[k] 静默删掉（用户根本看不出覆盖失败）。
        if (m[1] in vars) {
          body[k] = vars[m[1]];
        } else {
          onWarn?.(
            `applyBodyOverrides: 未知变量 \${${m[1]}}（请求体覆盖里写错了？），已跳过对字段 "${k}" 的覆盖`
          );
        }
      } else {
        body[k] = v;
      }
    } else {
      body[k] = v;
    }
  }
  for (const k of Object.keys(body)) {
    if (body[k] === null || body[k] === undefined) delete body[k];
  }
}
