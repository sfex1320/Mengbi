/**
 * 引擎注册表 —— 按 mode 取对应 EngineRunner(3 模式,2026-05-28)。
 *
 *   - vtracer:   @neplex/vectorizer Rust NAPI
 *   - potrace:   potrace npm (纯 JS)
 *   - autotrace: spawn autotrace.exe
 *
 * 砍除:starvector / experimental — AI 矢量化实测无用。
 */
import type { EngineRunner, VecMode } from '../types';
import { getVTracerEngine } from './vtracerEngine';
import { getPotraceEngine } from './potraceEngine';
import { getAutotraceEngine } from './autotraceEngine';

// 2026-05-28: AI 模式(StarVector / 实验精修)整体砍除 ——
//   AI 矢量化实际效果差;v3 留下 3 个工程化模式即可。
const _registry = new Map<VecMode, () => EngineRunner>();

_registry.set('vtracer', getVTracerEngine);
_registry.set('potrace', getPotraceEngine);
_registry.set('autotrace', getAutotraceEngine);

export function getEngine(mode: VecMode): EngineRunner | null {
  const factory = _registry.get(mode);
  return factory ? factory() : null;
}

export function isEngineImplemented(mode: VecMode): boolean {
  return _registry.has(mode);
}

export { getVTracerEngine } from './vtracerEngine';
export { getPotraceEngine } from './potraceEngine';
export { getAutotraceEngine } from './autotraceEngine';
