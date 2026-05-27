/**
 * 引擎注册表 —— 按 mode 取对应 EngineRunner(2 模式,2026-05-28 最终态)。
 *
 *   - vtracer: @neplex/vectorizer Rust NAPI
 *   - potrace: potrace npm (纯 JS)
 *
 * 历史已砍:
 *   - autotrace (Pro):上游 0.31.10 NSIS 打包 bug,跑不了
 *   - starvector (AI):VLM 生成 SVG 实测失败
 *   - experimental (Lab):投入产出不成正比
 */
import type { EngineRunner, VecMode } from '../types';
import { getVTracerEngine } from './vtracerEngine';
import { getPotraceEngine } from './potraceEngine';

const _registry = new Map<VecMode, () => EngineRunner>();

_registry.set('vtracer', getVTracerEngine);
_registry.set('potrace', getPotraceEngine);

export function getEngine(mode: VecMode): EngineRunner | null {
  const factory = _registry.get(mode);
  return factory ? factory() : null;
}

export function isEngineImplemented(mode: VecMode): boolean {
  return _registry.has(mode);
}

export { getVTracerEngine } from './vtracerEngine';
export { getPotraceEngine } from './potraceEngine';
