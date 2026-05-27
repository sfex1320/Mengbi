/**
 * SvgRepair —— 给定 SvgValidator 返回的 stats,补救 SVG。
 *
 * 修复:
 *   1) 缺 </svg> → 补
 *   2) 缺 viewBox → 从 width/height 推或补默认 0 0 200 200
 *   3) 缺 width/height → 从 viewBox 推
 *   4) 完全没 viewBox 也没 width/height → 补默认
 */
import type { SvgStats } from '../types';

export interface RepairResult {
  repaired: string;
  acted: boolean;
}

export function repairSvg(svg: string, stats: SvgStats): RepairResult {
  const original = svg;
  let s = svg.trim();

  // 1) 缺 </svg>
  if (stats.hasSvgTag && !stats.hasCloseTag) {
    s += '\n</svg>';
  }

  // 2) 解析现有 viewBox / width / height
  const viewBoxMatch = s.match(/<svg[^>]*\sviewBox\s*=\s*["']([^"']+)["']/i);
  const widthMatch = s.match(/<svg[^>]*\swidth\s*=\s*["']([^"']+)["']/i);
  const heightMatch = s.match(/<svg[^>]*\sheight\s*=\s*["']([^"']+)["']/i);

  const hasViewBox = !!viewBoxMatch;
  const hasWidth = !!widthMatch;
  const hasHeight = !!heightMatch;

  if (!hasViewBox) {
    // 如果有 width/height,用它们;否则给个默认
    let vbStr: string;
    if (hasWidth && hasHeight) {
      const w = parseFloat(widthMatch![1]) || 200;
      const h = parseFloat(heightMatch![1]) || 200;
      vbStr = `0 0 ${w} ${h}`;
    } else {
      vbStr = '0 0 200 200';
    }
    s = s.replace(/<svg(\s|>)/i, `<svg viewBox="${vbStr}"$1`);
  }

  if (!hasWidth || !hasHeight) {
    // 从 viewBox 抽尺寸补
    const finalVbMatch = s.match(/<svg[^>]*\sviewBox\s*=\s*["']([^"']+)["']/i);
    if (finalVbMatch) {
      const parts = finalVbMatch[1].split(/\s+/).map((x) => parseFloat(x));
      if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
        const w = parts[2];
        const h = parts[3];
        if (!hasWidth) {
          s = s.replace(/<svg(\s|>)/i, `<svg width="${w}"$1`);
        }
        if (!hasHeight) {
          s = s.replace(/<svg(\s|>)/i, `<svg height="${h}"$1`);
        }
      }
    }
  }

  // 3) 补 xmlns 如果没有
  if (!/<svg[^>]*\sxmlns\s*=/i.test(s)) {
    s = s.replace(/<svg(\s|>)/i, '<svg xmlns="http://www.w3.org/2000/svg"$1');
  }

  return { repaired: s, acted: s !== original };
}
