/**
 * 引擎注册表 —— 按 mode 取对应 EngineRunner。
 *
 * Phase 1: vtracer + potrace 已实装
 * Phase 2: autotrace 待加(spawn autotrace.exe)
 * Phase 3: starvector 待加(sidecar)
 * Phase 4: experimental 待加(sidecar)
 *
 * 未实装的引擎调用 getEngine(mode) 抛 NotImplementedError,
 * 由 fallbackManager 接住转回退到 vtracer。
 */
import type { EngineRunner, VecMode } from '../types';
import { getVTracerEngine } from './vtracerEngine';
import { getPotraceEngine } from './potraceEngine';
import { getAutotraceEngine } from './autotraceEngine';
import { getStarVectorEngine } from './starvectorEngine';

const _registry = new Map<VecMode, () => EngineRunner>();

_registry.set('vtracer', getVTracerEngine);
_registry.set('potrace', getPotraceEngine);
_registry.set('autotrace', getAutotraceEngine);
_registry.set('starvector', getStarVectorEngine);
// _registry.set('experimental', getExperimentalEngine); // Phase 4

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
export { getStarVectorEngine } from './starvectorEngine';
