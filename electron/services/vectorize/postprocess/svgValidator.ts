/**
 * SvgValidator —— 给定 SVG 字符串,返回 SvgStats(供 Repair / QualityScore / report 用)。
 *
 * 不要求完美的 XML 解析(SVG 在野文件常带怪东西),用启发式正则 + 简单 well-formedness 检查。
 * 复杂 XML 验证可以后续接 fast-xml-parser。
 */
import type { SvgStats } from '../types';

const VISIBLE_TAGS = ['path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'line', 'text'] as const;

export function statsFromSvg(svg: string): SvgStats {
  const hasSvgTag = /<svg[\s>]/i.test(svg);
  const hasCloseTag = /<\/svg\s*>/i.test(svg);
  const hasViewBox = /\sviewBox\s*=\s*["']/i.test(svg);

  // 简单 well-formedness:计数 < 和 / 对应 <tag>...</tag>。
  // 不是严格 XML 验证,只做"括号配对"+"非法字符无"两道关。
  const xmlValid =
    hasSvgTag &&
    !/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(svg) &&
    // tag 数量大致配对(<x ... ></x> + <x ... /> 自闭合):
    tagsRoughlyBalanced(svg);

  const fileSizeBytes = Buffer.byteLength(svg, 'utf-8');

  // 各类可见元素计数
  const counts: Record<string, number> = {};
  for (const tag of VISIBLE_TAGS) {
    const re = new RegExp(`<${tag}[\\s>/]`, 'gi');
    counts[tag] = (svg.match(re) || []).length;
  }
  const pathCount = counts.path;
  const visibleElementCount = VISIBLE_TAGS.reduce((s, t) => s + counts[t], 0);

  // 颜色去重(只看 fill="..." / stroke="...")
  const colorSet = new Set<string>();
  const colorRe = /\b(?:fill|stroke)\s*=\s*"(#[0-9a-fA-F]{3,8}|rgb\([^)]+\)|[a-zA-Z]+)"/g;
  for (const m of svg.matchAll(colorRe)) {
    const c = m[1].toLowerCase();
    if (c !== 'none' && c !== 'transparent') colorSet.add(c);
  }

  // 节点数:近似为所有 d 属性里逗号/空格分割的坐标 token 数,加上其它可见元素本身
  const dAttrs = svg.match(/\sd\s*=\s*"([^"]*)"/gi) || [];
  let nodeCount = 0;
  for (const da of dAttrs) {
    // 提取数字 token
    const nums = (da.match(/-?\d+(?:\.\d+)?/g) || []).length;
    nodeCount += Math.ceil(nums / 2); // 一个 (x,y) 算一个节点
  }
  nodeCount += visibleElementCount - pathCount;

  // 重复坐标率(末尾 400 字符里 30 char 子串重复 ≥ 4 次的比例)
  const tail = svg.slice(-400);
  let duplicateCoordRatio = 0;
  for (let start = 0; start + 30 <= tail.length; start += 5) {
    const sub = tail.slice(start, start + 30);
    let occurrences = 0;
    let idx = -1;
    while ((idx = tail.indexOf(sub, idx + 1)) !== -1) occurrences++;
    if (occurrences >= 4) {
      duplicateCoordRatio = Math.min(1, occurrences / 10);
      break;
    }
  }

  // 重复 path d 属性比例
  const ds: string[] = [];
  for (const m of svg.matchAll(/\sd\s*=\s*"([^"]+)"/gi)) ds.push(m[1]);
  let dupPathCount = 0;
  if (ds.length > 1) {
    const seen = new Set<string>();
    for (const d of ds) {
      if (seen.has(d)) dupPathCount++;
      seen.add(d);
    }
  }
  const duplicatePathRatio = ds.length > 0 ? dupPathCount / ds.length : 0;

  return {
    hasSvgTag,
    hasCloseTag,
    xmlValid,
    hasViewBox,
    pathCount,
    rectCount: counts.rect,
    circleCount: counts.circle,
    ellipseCount: counts.ellipse,
    polygonCount: counts.polygon,
    polylineCount: counts.polyline,
    lineCount: counts.line,
    textCount: counts.text,
    visibleElementCount,
    colorCount: colorSet.size,
    nodeCount,
    fileSizeBytes,
    duplicateCoordRatio,
    duplicatePathRatio
  };
}

function tagsRoughlyBalanced(svg: string): boolean {
  // 统计:开标签 <foo> + 自闭合 <foo /> + 闭标签 </foo>
  // 期待 open == close + selfClose
  const opens = svg.match(/<[a-zA-Z][\w-]*(?:\s[^>]*)?(?<!\/)>/g) || [];
  const selfCloses = svg.match(/<[a-zA-Z][\w-]*(?:\s[^>]*)?\/>/g) || [];
  const closes = svg.match(/<\/[a-zA-Z][\w-]*\s*>/g) || [];
  return Math.abs(opens.length - selfCloses.length - closes.length) <= 2;
}
