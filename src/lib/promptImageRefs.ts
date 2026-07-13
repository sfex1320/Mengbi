/**
 * 提示词「@ 引用参考图」纯函数（配 promptImageRefs.test.ts）。
 *
 * 语义（2026-07-12）：生图节点接了多张参考图时，提示词里可用 `@图N` 引用第 N 张
 * （N = 下游生图节点收到的参考图序号，1 起，与「图序铁律」的提交顺序一致）。
 * `@` 是 UI 层的可视标记（提示词节点在 @ 上方悬浮小图作视觉连接）；
 * **发给模型前一律剥掉 @**（stripImageRefs：`@图1` → `图1`）——沿用中转站/模型已验证的
 * 「图1/图2」文字引用惯例，@ 不进请求体。
 */

/** 匹配一处图片引用标记：@图N（N ≥ 1 的整数）。 */
export const IMAGE_REF_RE = /@图(\d+)/g;

export interface ImageRefToken {
  /** 引用的参考图序号（1 起） */
  index: number;
  /** 标记在原文中的起始偏移（含 @） */
  start: number;
  /** 标记结束偏移（不含后续文本） */
  end: number;
}

/** 解析文本里的全部 `@图N` 标记（按出现顺序；N 解析失败/为 0 的跳过）。 */
export function parseImageRefs(text: string): ImageRefToken[] {
  const out: ImageRefToken[] = [];
  if (!text) return out;
  const re = new RegExp(IMAGE_REF_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const index = Number(m[1]);
    if (Number.isFinite(index) && index >= 1) {
      out.push({ index, start: m.index, end: m.index + m[0].length });
    }
  }
  return out;
}

/** 发给模型前剥掉 @ 标记：`@图1` → `图1`（其余文本原样）。 */
export function stripImageRefs(text: string): string {
  if (!text) return text;
  return text.replace(new RegExp(IMAGE_REF_RE.source, 'g'), '图$1');
}
