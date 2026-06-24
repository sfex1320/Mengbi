/**
 * VTracer 路径拟合模式映射（纯函数，零依赖，便于单测）。
 *
 * 把 UI 的 pathMode 映射到 @neplex/vectorizer 的 PathSimplifyMode 枚举值。
 * 缺省 / 未知 → Spline（保持历史默认行为，避免回归）。
 */
export type VtracerPathMode = 'none' | 'polygon' | 'spline';

export function resolvePathSimplifyMode(
  pathMode: VtracerPathMode | undefined,
  enumObj: { None: number; Polygon: number; Spline: number }
): number {
  if (pathMode === 'none') return enumObj.None;
  if (pathMode === 'polygon') return enumObj.Polygon;
  return enumObj.Spline;
}
