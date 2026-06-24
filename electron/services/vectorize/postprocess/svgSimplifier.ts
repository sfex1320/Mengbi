/**
 * SvgSimplifier —— 后处理简化:
 *   1) 删空 path(d="" / 极短 d)
 *   2) 删 display:none / visibility:hidden / opacity:0
 *   3) 删除完全重复的 path
 *   4) 限制最大 path 数(超出按 d 长度排序保留最长的)
 *   5) 合并相近 fill 颜色(colorMergeDelta,RGB 距离阈值,只改色不动几何)
 */
import type { PostprocessOptions } from '../types';

export interface SimplifyResult {
  final: string;
  acted: boolean;
  pathsRemoved: number;
}

export function simplifySvg(svg: string, opts: PostprocessOptions = {}): SimplifyResult {
  const original = svg;
  let s = svg;
  let removed = 0;

  // 1) 删空 path:d="" 或 d 里没字母(非 SVG 路径命令)
  s = s.replace(/<path\b[^>]*\sd\s*=\s*"\s*"[^>]*\/?>/gi, () => {
    removed++;
    return '';
  });
  s = s.replace(/<path\b[^>]*\sd\s*=\s*"([^"]*)"[^>]*\/?>/gi, (match, d) => {
    if (typeof d !== 'string' || !/[a-zA-Z]/.test(d)) {
      removed++;
      return '';
    }
    return match;
  });

  // 2) 删 display:none / opacity:0 / visibility:hidden
  s = s.replace(/<[a-zA-Z][\w-]*\b[^>]*\sstyle\s*=\s*"[^"]*display\s*:\s*none[^"]*"[^>]*\/?>/gi, () => {
    removed++;
    return '';
  });
  s = s.replace(/<[a-zA-Z][\w-]*\b[^>]*\svisibility\s*=\s*["']hidden["'][^>]*\/?>/gi, () => {
    removed++;
    return '';
  });
  s = s.replace(/<[a-zA-Z][\w-]*\b[^>]*\sopacity\s*=\s*["']0["'][^>]*\/?>/gi, () => {
    removed++;
    return '';
  });

  // 3) 删完全重复的 path(同 d + 同 fill)
  const seenPathSig = new Set<string>();
  s = s.replace(/<path\b[^>]*?\/?>/gi, (match) => {
    const dM = match.match(/\sd\s*=\s*"([^"]+)"/i);
    const fillM = match.match(/\sfill\s*=\s*"([^"]+)"/i);
    if (!dM) return match;
    const sig = `${dM[1]}|${fillM?.[1] ?? ''}`;
    if (seenPathSig.has(sig)) {
      removed++;
      return '';
    }
    seenPathSig.add(sig);
    return match;
  });

  // 4) 限制最大 path 数(按 d 长度排序,保留最长的 maxPaths 条 = 信息量大的)
  if (opts.maxPaths && opts.maxPaths > 0) {
    const allPaths: Array<{ match: string; dLen: number }> = [];
    for (const m of s.matchAll(/<path\b[^>]*?\/?>/gi)) {
      const dM = m[0].match(/\sd\s*=\s*"([^"]+)"/i);
      allPaths.push({ match: m[0], dLen: dM ? dM[1].length : 0 });
    }
    if (allPaths.length > opts.maxPaths) {
      allPaths.sort((a, b) => b.dLen - a.dLen);
      const keep = new Set(allPaths.slice(0, opts.maxPaths).map((p) => p.match));
      let cur = s;
      let count = 0;
      cur = cur.replace(/<path\b[^>]*?\/?>/gi, (match) => {
        if (keep.has(match)) {
          // 防止同一字符串多次出现都被保留,只保留 maxPaths 个
          if (count < opts.maxPaths!) {
            count++;
            return match;
          }
        }
        removed++;
        return '';
      });
      s = cur;
    }
  }

  // 5) 合并相近颜色(colorMergeDelta): 相近 fill 色归一到代表色 → 减少颜色数,视觉更干净(只改色不动几何)
  if (opts.colorMergeDelta && opts.colorMergeDelta > 0) {
    s = mergeSimilarFills(s, opts.colorMergeDelta);
  }

  return { final: s, acted: s !== original, pathsRemoved: removed };
}

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r: number, g: number, b: number): string {
  const h = (v: number): string => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/**
 * 把 SVG 里 fill 的相近颜色归一到代表色（RGB 欧氏距离 ≤ delta 视为同色，归到先出现的代表色）。
 * 只改颜色属性、不动几何，安全。delta 取值同 colorMergeDelta(0-255)。
 */
export function mergeSimilarFills(svg: string, delta: number): string {
  if (!(delta > 0)) return svg;
  const reps: Array<[number, number, number]> = [];
  const cache = new Map<string, string>();
  const remap = (hex: string): string => {
    const cached = cache.get(hex);
    if (cached !== undefined) return cached;
    const rgb = hexToRgb(hex);
    if (!rgb) {
      cache.set(hex, hex);
      return hex;
    }
    for (const r of reps) {
      const dr = r[0] - rgb[0];
      const dg = r[1] - rgb[1];
      const db = r[2] - rgb[2];
      if (Math.sqrt(dr * dr + dg * dg + db * db) <= delta) {
        const rep = rgbToHex(r[0], r[1], r[2]);
        cache.set(hex, rep);
        return rep;
      }
    }
    reps.push(rgb);
    cache.set(hex, hex);
    return hex;
  };
  return svg.replace(/(\sfill\s*=\s*")(#[0-9a-fA-F]{6})(")/gi, (_m, pre, hex, post) => pre + remap(hex) + post);
}
