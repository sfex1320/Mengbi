/**
 * SvgQualityScore —— 0-100 评分。
 *
 * 评分维度(用户清单 §14):
 *   1. SVG 完整性 (hasSvgTag + hasCloseTag)             20
 *   2. XML 合法性 (xmlValid)                           10
 *   3. 可见元素数量 (visibleElementCount > 0)          15
 *   4. path 数量是否合理 (1 < pathCount < 1000)         5
 *   5. 节点数量是否合理 (nodeCount > 10)                5
 *   6. 颜色数量是否合理 (colorCount > 0)                5
 *   7. 是否重复坐标 (duplicateCoordRatio == 0)         10
 *   8. 是否重复 path (duplicatePathRatio < 0.05)        5
 *   9. 渲染结果是否为空白(代理:文件大小 > 200B)        5
 *  10. 文件大小是否异常 (fileSizeBytes <= 5MB)          5
 *  11. 是否与输入图像尺寸比例匹配(暂时不算,留 0)       0
 *  12. 是否通过预览渲染(暂时跳过,留 0)                 0
 *  base                                                15
 *
 * 评分档位:
 *   80-100 excellent
 *   60-79  good
 *   40-59  fair
 *   20-39  poor
 *   0-19   invalid (建议回退)
 */
import type { SvgStats, VecQualityTier } from '../types';

export interface ScoreResult {
  score: number;
  tier: VecQualityTier;
  breakdown: Record<string, number>;
}

export function scoreSvg(stats: SvgStats): ScoreResult {
  const b: Record<string, number> = {};
  let total = 0;

  // 1) 完整性
  b.completeness = (stats.hasSvgTag ? 10 : 0) + (stats.hasCloseTag ? 10 : 0);
  total += b.completeness;

  // 2) XML 合法
  b.xmlValid = stats.xmlValid ? 10 : 0;
  total += b.xmlValid;

  // 3) 可见元素数量
  if (stats.visibleElementCount === 0) b.hasVisibleElements = 0;
  else if (stats.visibleElementCount === 1) b.hasVisibleElements = 5;
  else b.hasVisibleElements = 15;
  total += b.hasVisibleElements;

  // 4) path 数量合理
  if (stats.pathCount === 0) b.pathCountSane = 0;
  else if (stats.pathCount > 5000) b.pathCountSane = 2;
  else b.pathCountSane = 5;
  total += b.pathCountSane;

  // 5) 节点数量
  if (stats.nodeCount < 5) b.nodeCountSane = 0;
  else if (stats.nodeCount > 100000) b.nodeCountSane = 2;
  else b.nodeCountSane = 5;
  total += b.nodeCountSane;

  // 6) 颜色数量
  if (stats.colorCount === 0) b.colorCountSane = 0;
  else if (stats.colorCount === 1) b.colorCountSane = 3;
  else b.colorCountSane = 5;
  total += b.colorCountSane;

  // 7) 重复坐标(无 = 满分,>0.5 = 0)
  if (stats.duplicateCoordRatio === 0) b.noDupCoord = 10;
  else if (stats.duplicateCoordRatio < 0.1) b.noDupCoord = 7;
  else if (stats.duplicateCoordRatio < 0.3) b.noDupCoord = 3;
  else b.noDupCoord = 0;
  total += b.noDupCoord;

  // 8) 重复 path
  if (stats.duplicatePathRatio < 0.05) b.noDupPath = 5;
  else if (stats.duplicatePathRatio < 0.2) b.noDupPath = 2;
  else b.noDupPath = 0;
  total += b.noDupPath;

  // 9) 非空白渲染代理(文件大小 > 200B)
  b.notBlank = stats.fileSizeBytes > 200 ? 5 : 0;
  total += b.notBlank;

  // 10) 文件大小合理(< 5 MB 满分,< 20 MB 半分,> 20 MB 0)
  if (stats.fileSizeBytes < 5 * 1024 * 1024) b.fileSizeSane = 5;
  else if (stats.fileSizeBytes < 20 * 1024 * 1024) b.fileSizeSane = 2;
  else b.fileSizeSane = 0;
  total += b.fileSizeSane;

  // 11, 12 留 0(后续扩)
  b.sizeMatchInput = 0;
  b.previewRenderable = 0;

  // 11) 输入比例匹配(暂占 0,后续 phase 接 cairosvg 预览后填)
  // 12) 预览渲染(同上)

  // 基础分(凑齐 100)
  b.base = 15;
  total += b.base;

  const score = Math.max(0, Math.min(100, Math.round(total)));
  const tier = scoreToTier(score);
  return { score, tier, breakdown: b };
}

export function scoreToTier(score: number): VecQualityTier {
  if (score >= 80) return 'excellent';
  if (score >= 60) return 'good';
  if (score >= 40) return 'fair';
  if (score >= 20) return 'poor';
  return 'invalid';
}
