/**
 * SvgCleaner —— 从引擎原始文本输出里提取干净的 <svg>...</svg>。
 *
 * 适用场景:
 *   - VTracer / Potrace 直接输出 <svg> 开头,Cleaner basically passthrough
 *   - AI 引擎可能输出:
 *       "Sure, here is the SVG:\n```svg\n<svg ...>...</svg>\n```\nHope it helps!"
 *     Cleaner 剥外壳,留 <svg>...</svg>
 *
 * 后续 pipeline:Validator → Repair → Simplifier → QualityScore。
 */

export interface CleanerResult {
  cleaned: string;
  acted: boolean;
}

/** 主入口:接受引擎原文 raw,返回剥干净的 <svg>...</svg> 字符串。 */
export function cleanSvg(raw: string): CleanerResult {
  const original = raw;
  let s = raw;

  // 1) 剥 markdown fence(```svg ... ``` / ```xml ... ``` / ```html ... ```)
  const fenceMatch = s.match(/```(?:svg|xml|html)?\s*\n([\s\S]*?)\n?```/i);
  if (fenceMatch) {
    s = fenceMatch[1];
  }

  // 2) 找 <svg>...</svg> 的最大跨度。如果有多个 svg 标签,取第一个开头到最后一个 </svg>。
  const svgStart = s.search(/<svg[\s>]/i);
  if (svgStart === -1) {
    // 没有 <svg> tag,直接返回(给 Validator 标 invalid)
    return { cleaned: s.trim(), acted: s.trim() !== original };
  }
  s = s.slice(svgStart);

  const lastClose = s.toLowerCase().lastIndexOf('</svg>');
  if (lastClose !== -1) {
    s = s.slice(0, lastClose + '</svg>'.length);
  }
  // 如果没找到 </svg>,留给 Repair 补

  // 3) 清非法 XML 字符(控制字符 0x00-0x08, 0x0B, 0x0C, 0x0E-0x1F,保留 \t \n \r)
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

  // 4) 修剪首尾空白
  s = s.trim();

  return { cleaned: s, acted: s !== original.trim() };
}
