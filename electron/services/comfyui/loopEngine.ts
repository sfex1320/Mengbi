/**
 * 批量循环：把 LoopConfig 展开成"每轮的控件值覆盖表"数组（overlays）。
 * 由 mengbi 外部调度，不塞进 ComfyUI 工作流内部。
 * - single：1 轮
 * - range：数值递增/递减序列
 * - list：枚举列表
 * - zip：多变量按索引一一对应（取最短）
 * - cartesian：多变量笛卡尔积
 * - formula：i(轮次)/n(总数) + 安全函数（expr-eval，无 eval）
 * - feedback：固定轮数，上一轮输出回灌到某输入控件（实际注入在 queue 运行时做）
 */
import { Parser, type Value } from 'expr-eval';
import type { LoopConfig, LoopVar } from '@shared/comfyui';

export interface IterationPlan {
  overlays: Array<Record<string, unknown>>;
  feedback?: { toControlId: string };
}

const MAX_ITERATIONS = 500;

class LoopError extends Error {}

function expandRange(from: number, to: number, step: number): number[] {
  const s = step === 0 ? 1 : step;
  const out: number[] = [];
  if (s > 0) {
    for (let v = from; v <= to + 1e-9; v += s) out.push(+v.toFixed(6));
  } else {
    for (let v = from; v >= to - 1e-9; v += s) out.push(+v.toFixed(6));
  }
  if (out.length > MAX_ITERATIONS) out.length = MAX_ITERATIONS;
  return out;
}

function expandVar(v: LoopVar): Array<string | number> {
  if (v.kind === 'range') return expandRange(v.from, v.to, v.step);
  return v.values;
}

export function buildIterationPlan(config: LoopConfig, base: Record<string, unknown>): IterationPlan {
  void base;
  const mode = config.mode;

  if (mode === 'single') return { overlays: [{}] };

  if (mode === 'feedback') {
    const n = Math.max(1, Math.min(MAX_ITERATIONS, config.feedback?.maxIterations ?? 1));
    return {
      overlays: Array.from({ length: n }, () => ({})),
      feedback: config.feedback ? { toControlId: config.feedback.toControlId } : undefined
    };
  }

  if (mode === 'formula') {
    const f = config.formula;
    if (!f || !f.items.length) throw new LoopError('公式循环未配置任何变量');
    const count = Math.max(1, Math.min(MAX_ITERATIONS, f.count));
    const parser = new Parser();
    const overlays: Array<Record<string, unknown>> = [];
    let prev: Record<string, number> = {};
    for (let i = 0; i < count; i++) {
      const overlay: Record<string, unknown> = {};
      const scope: Record<string, unknown> = {
        i,
        n: count,
        rand: () => Math.random(),
        ...prev
      };
      for (const item of f.items) {
        let val: number;
        try {
          val = Number(parser.parse(item.expr).evaluate(scope as unknown as Value));
        } catch (e) {
          throw new LoopError(`公式解析失败「${item.expr}」：${(e as Error).message}`);
        }
        if (!Number.isFinite(val)) throw new LoopError(`公式「${item.expr}」结果不是有限数`);
        overlay[item.controlId] = val;
      }
      overlays.push(overlay);
      // prev 暴露本轮值（供下一轮 expr 里按 controlId 引用，若 id 是合法标识符）
      prev = {};
      for (const item of f.items) {
        const v = overlay[item.controlId];
        if (typeof v === 'number') prev[item.controlId] = v;
      }
    }
    return { overlays };
  }

  // range / list / zip / cartesian —— 统一先把每个变量展开成值数组
  const vars = config.vars ?? [];
  if (vars.length === 0) throw new LoopError('循环未配置任何变量');
  const lists = vars.map((v) => ({ controlId: v.controlId, values: expandVar(v) }));
  for (const l of lists) if (l.values.length === 0) throw new LoopError('某个循环变量没有可用值');

  let combos: Array<Record<string, unknown>>;
  if (mode === 'cartesian') {
    combos = [{}];
    for (const l of lists) {
      const next: Array<Record<string, unknown>> = [];
      for (const c of combos) {
        for (const val of l.values) {
          if (next.length >= MAX_ITERATIONS) break;
          next.push({ ...c, [l.controlId]: val });
        }
      }
      combos = next;
    }
  } else {
    // range / list / zip → 按索引锁步（取最短）
    const len = Math.min(...lists.map((l) => l.values.length), MAX_ITERATIONS);
    combos = [];
    for (let i = 0; i < len; i++) {
      const overlay: Record<string, unknown> = {};
      for (const l of lists) overlay[l.controlId] = l.values[i];
      combos.push(overlay);
    }
  }

  if (combos.length === 0) throw new LoopError('循环展开后没有任何任务');
  if (combos.length > MAX_ITERATIONS) {
    throw new LoopError(`循环任务数超过上限 ${MAX_ITERATIONS}，请缩小范围（笛卡尔积尤其容易爆炸）`);
  }
  return { overlays: combos };
}

export { LoopError };
