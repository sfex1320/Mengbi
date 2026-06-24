import { describe, it, expect } from 'vitest';
import { buildIterationPlan, LoopError } from './loopEngine';
import type { LoopConfig } from '@shared/comfyui';

// base 在 buildIterationPlan 内部 `void base`（不参与合并，只产 overlays），
// 故各用例统一传空 base；合并语义在「base 合并」一节单独说明。
const BASE: Record<string, unknown> = {};

describe('single 模式', () => {
  it('恒为 1 轮、空 overlay、无 feedback', () => {
    const plan = buildIterationPlan({ mode: 'single' } as LoopConfig, BASE);
    expect(plan.overlays).toEqual([{}]);
    expect(plan.feedback).toBeUndefined();
  });
});

describe('feedback 模式', () => {
  it('按 maxIterations 给出 N 个空 overlay + 回灌目标控件', () => {
    const plan = buildIterationPlan(
      { mode: 'feedback', feedback: { toControlId: 'img_in', maxIterations: 3 } } as LoopConfig,
      BASE
    );
    expect(plan.overlays).toHaveLength(3);
    expect(plan.overlays.every((o) => Object.keys(o).length === 0)).toBe(true);
    expect(plan.feedback).toEqual({ toControlId: 'img_in' });
  });

  it('maxIterations 缺省回落到 1 轮（feedback 未配置则无回灌信息）', () => {
    const plan = buildIterationPlan({ mode: 'feedback' } as LoopConfig, BASE);
    expect(plan.overlays).toHaveLength(1);
    expect(plan.feedback).toBeUndefined();
  });

  it('maxIterations 超上限被钳到 MAX_ITERATIONS=500', () => {
    const plan = buildIterationPlan(
      { mode: 'feedback', feedback: { toControlId: 'x', maxIterations: 9999 } } as LoopConfig,
      BASE
    );
    expect(plan.overlays).toHaveLength(500);
  });

  it('maxIterations<1（如 0 / 负数）被钳到 1 轮', () => {
    const plan = buildIterationPlan(
      { mode: 'feedback', feedback: { toControlId: 'x', maxIterations: 0 } } as LoopConfig,
      BASE
    );
    expect(plan.overlays).toHaveLength(1);
  });
});

describe('range 模式（浮点端点 / 步长方向 / 锁步）', () => {
  it('正步长、端点包含：0→1 step 0.25 共 5 轮', () => {
    const plan = buildIterationPlan(
      { mode: 'range', vars: [{ controlId: 'cfg', kind: 'range', from: 0, to: 1, step: 0.25 }] } as LoopConfig,
      BASE
    );
    expect(plan.overlays.map((o) => o.cfg)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it('整数正步长包含上界：1→5 step 1 共 5 轮', () => {
    const plan = buildIterationPlan(
      { mode: 'range', vars: [{ controlId: 's', kind: 'range', from: 1, to: 5, step: 1 }] } as LoopConfig,
      BASE
    );
    expect(plan.overlays.map((o) => o.s)).toEqual([1, 2, 3, 4, 5]);
  });

  it('负步长递减、端点包含：5→1 step -2 共 3 轮 [5,3,1]', () => {
    const plan = buildIterationPlan(
      { mode: 'range', vars: [{ controlId: 's', kind: 'range', from: 5, to: 1, step: -2 }] } as LoopConfig,
      BASE
    );
    expect(plan.overlays.map((o) => o.s)).toEqual([5, 3, 1]);
  });

  it('浮点容差：0→0.3 step 0.1 因 1e-9 容差仍含 0.3（值经 toFixed(6) 规整）', () => {
    const plan = buildIterationPlan(
      { mode: 'range', vars: [{ controlId: 'd', kind: 'range', from: 0, to: 0.3, step: 0.1 }] } as LoopConfig,
      BASE
    );
    const vals = plan.overlays.map((o) => o.d) as number[];
    expect(vals).toHaveLength(4);
    expect(vals[3]).toBeCloseTo(0.3, 6);
  });

  it('step=0 防呆按 1 处理（避免死循环）：0→3 共 4 轮', () => {
    const plan = buildIterationPlan(
      { mode: 'range', vars: [{ controlId: 's', kind: 'range', from: 0, to: 3, step: 0 }] } as LoopConfig,
      BASE
    );
    expect(plan.overlays.map((o) => o.s)).toEqual([0, 1, 2, 3]);
  });

  it('range 单值（from==to）只 1 轮', () => {
    const plan = buildIterationPlan(
      { mode: 'range', vars: [{ controlId: 's', kind: 'range', from: 2, to: 2, step: 1 }] } as LoopConfig,
      BASE
    );
    expect(plan.overlays).toEqual([{ s: 2 }]);
  });

  it('range 展开超 500 被截断到 MAX_ITERATIONS', () => {
    const plan = buildIterationPlan(
      { mode: 'range', vars: [{ controlId: 's', kind: 'range', from: 0, to: 10000, step: 1 }] } as LoopConfig,
      BASE
    );
    expect(plan.overlays).toHaveLength(500);
  });
});

describe('list 模式', () => {
  it('枚举值逐轮映射到 controlId', () => {
    const plan = buildIterationPlan(
      { mode: 'list', vars: [{ controlId: 'sampler', kind: 'list', values: ['euler', 'dpmpp', 'ddim'] }] } as LoopConfig,
      BASE
    );
    expect(plan.overlays).toEqual([{ sampler: 'euler' }, { sampler: 'dpmpp' }, { sampler: 'ddim' }]);
  });

  it('数值列表保留数值类型', () => {
    const plan = buildIterationPlan(
      { mode: 'list', vars: [{ controlId: 'seed', kind: 'list', values: [1, 2, 3] }] } as LoopConfig,
      BASE
    );
    expect(plan.overlays.map((o) => o.seed)).toEqual([1, 2, 3]);
  });
});

describe('zip 模式（多变量锁步取最短）', () => {
  it('等长：两变量按索引一一对应', () => {
    const plan = buildIterationPlan(
      {
        mode: 'zip',
        vars: [
          { controlId: 'a', kind: 'list', values: [1, 2] },
          { controlId: 'b', kind: 'list', values: ['x', 'y'] }
        ]
      } as LoopConfig,
      BASE
    );
    expect(plan.overlays).toEqual([
      { a: 1, b: 'x' },
      { a: 2, b: 'y' }
    ]);
  });

  it('不等长取最短：长度 3 与 2 → 仅 2 轮', () => {
    const plan = buildIterationPlan(
      {
        mode: 'zip',
        vars: [
          { controlId: 'a', kind: 'list', values: [1, 2, 3] },
          { controlId: 'b', kind: 'list', values: ['x', 'y'] }
        ]
      } as LoopConfig,
      BASE
    );
    expect(plan.overlays).toEqual([
      { a: 1, b: 'x' },
      { a: 2, b: 'y' }
    ]);
  });

  it('zip 混搭 range + list 仍按最短锁步', () => {
    const plan = buildIterationPlan(
      {
        mode: 'zip',
        vars: [
          { controlId: 'cfg', kind: 'range', from: 1, to: 10, step: 1 }, // 10 值
          { controlId: 'sampler', kind: 'list', values: ['euler', 'ddim'] } // 2 值
        ]
      } as LoopConfig,
      BASE
    );
    expect(plan.overlays).toEqual([
      { cfg: 1, sampler: 'euler' },
      { cfg: 2, sampler: 'ddim' }
    ]);
  });
});

describe('cartesian 模式（笛卡尔积 + 上限护栏）', () => {
  it('2×3 = 6 个组合，键集合为两个 controlId', () => {
    const plan = buildIterationPlan(
      {
        mode: 'cartesian',
        vars: [
          { controlId: 'a', kind: 'list', values: [1, 2] },
          { controlId: 'b', kind: 'list', values: ['x', 'y', 'z'] }
        ]
      } as LoopConfig,
      BASE
    );
    expect(plan.overlays).toHaveLength(6);
    for (const o of plan.overlays) {
      expect(Object.keys(o).sort()).toEqual(['a', 'b']);
    }
    // 含首尾两端组合，确认确为笛卡尔积
    expect(plan.overlays).toContainEqual({ a: 1, b: 'x' });
    expect(plan.overlays).toContainEqual({ a: 2, b: 'z' });
  });

  it('防爆护栏：超 500 的笛卡尔积被截断到 MAX_ITERATIONS（不无限膨胀成数百付费任务）', () => {
    // 30 × 30 = 900 > 500
    const v = (id: string) =>
      ({ controlId: id, kind: 'range', from: 1, to: 30, step: 1 }) as const;
    const plan = buildIterationPlan(
      { mode: 'cartesian', vars: [v('a'), v('b')] } as LoopConfig,
      BASE
    );
    expect(plan.overlays).toHaveLength(500);
  });

  it('三变量笛卡尔积数量 = 各维长度乘积（未超限时）', () => {
    const plan = buildIterationPlan(
      {
        mode: 'cartesian',
        vars: [
          { controlId: 'a', kind: 'list', values: [1, 2] },
          { controlId: 'b', kind: 'list', values: ['x', 'y'] },
          { controlId: 'c', kind: 'list', values: [true as unknown as number, false as unknown as number] }
        ]
      } as LoopConfig,
      BASE
    );
    expect(plan.overlays).toHaveLength(8);
  });
});

describe('formula 模式（expr-eval 安全求值）', () => {
  it('合法表达式：用轮次 i 计算每轮值（seed = 1000 + i*100）', () => {
    const plan = buildIterationPlan(
      { mode: 'formula', formula: { count: 3, items: [{ controlId: 'seed', expr: '1000 + i*100' }] } } as LoopConfig,
      BASE
    );
    expect(plan.overlays.map((o) => o.seed)).toEqual([1000, 1100, 1200]);
  });

  it('作用域变量 n（总轮数）可用', () => {
    const plan = buildIterationPlan(
      { mode: 'formula', formula: { count: 4, items: [{ controlId: 'total', expr: 'n' }] } } as LoopConfig,
      BASE
    );
    expect(plan.overlays.map((o) => o.total)).toEqual([4, 4, 4, 4]);
  });

  it('rand() 安全函数可用且落在 [0,1)', () => {
    const plan = buildIterationPlan(
      { mode: 'formula', formula: { count: 5, items: [{ controlId: 'r', expr: 'rand()' }] } } as LoopConfig,
      BASE
    );
    for (const o of plan.overlays) {
      const r = o.r as number;
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(1);
    }
  });

  it('prev（上一轮按 controlId 引用）：累加序列 v = prev_v? ... 这里用 i 验证 prev 注入到下一轮 scope', () => {
    // 第 0 轮 prev 为空，用 i；之后引用上一轮产出的 acc
    const plan = buildIterationPlan(
      { mode: 'formula', formula: { count: 3, items: [{ controlId: 'acc', expr: 'i == 0 ? 10 : acc + 5' }] } } as LoopConfig,
      BASE
    );
    expect(plan.overlays.map((o) => o.acc)).toEqual([10, 15, 20]);
  });

  it('count 被钳进 [1, 500]：count=0 → 至少 1 轮', () => {
    const plan = buildIterationPlan(
      { mode: 'formula', formula: { count: 0, items: [{ controlId: 'x', expr: 'i' }] } } as LoopConfig,
      BASE
    );
    expect(plan.overlays).toEqual([{ x: 0 }]);
  });

  it('未配置 formula / items 为空 → 抛 LoopError', () => {
    expect(() => buildIterationPlan({ mode: 'formula' } as LoopConfig, BASE)).toThrow(LoopError);
    expect(() =>
      buildIterationPlan({ mode: 'formula', formula: { count: 3, items: [] } } as LoopConfig, BASE)
    ).toThrow(LoopError);
  });

  it('安全断言：非法/无法解析的表达式抛 LoopError（不执行任意代码）', () => {
    expect(() =>
      buildIterationPlan(
        { mode: 'formula', formula: { count: 1, items: [{ controlId: 'x', expr: 'this is not valid (((' }] } } as LoopConfig,
        BASE
      )
    ).toThrow(LoopError);
  });

  it('安全断言：引用未知标识符（如 process）抛 LoopError 而非求值成功', () => {
    expect(() =>
      buildIterationPlan(
        { mode: 'formula', formula: { count: 1, items: [{ controlId: 'x', expr: 'process' }] } } as LoopConfig,
        BASE
      )
    ).toThrow(LoopError);
  });

  it('安全断言：结果非有限数（除零 → Infinity）抛 LoopError', () => {
    expect(() =>
      buildIterationPlan(
        { mode: 'formula', formula: { count: 1, items: [{ controlId: 'x', expr: '1/0' }] } } as LoopConfig,
        BASE
      )
    ).toThrow(LoopError);
  });
});

describe('range/list/zip/cartesian 公共错误护栏', () => {
  it('未配置任何变量 → 抛 LoopError', () => {
    expect(() => buildIterationPlan({ mode: 'range', vars: [] } as LoopConfig, BASE)).toThrow(LoopError);
    expect(() => buildIterationPlan({ mode: 'cartesian' } as LoopConfig, BASE)).toThrow(LoopError);
  });

  it('某变量没有可用值（空 list）→ 抛 LoopError', () => {
    expect(() =>
      buildIterationPlan(
        { mode: 'list', vars: [{ controlId: 'a', kind: 'list', values: [] }] } as LoopConfig,
        BASE
      )
    ).toThrow(LoopError);
  });
});

describe('base 合并语义', () => {
  it('overlays 只含每轮覆盖键、不含 base 字段（base 由调用方在运行时与 overlay 合并）', () => {
    const base = { seed: 42, prompt: 'a cat' };
    const plan = buildIterationPlan(
      { mode: 'list', vars: [{ controlId: 'sampler', kind: 'list', values: ['euler', 'ddim'] }] } as LoopConfig,
      base
    );
    // overlays 不携带 base 的 seed / prompt，仅给出差量覆盖
    expect(plan.overlays).toEqual([{ sampler: 'euler' }, { sampler: 'ddim' }]);
    for (const o of plan.overlays) {
      expect(o).not.toHaveProperty('seed');
      expect(o).not.toHaveProperty('prompt');
    }
    // 模拟运行端合并：base ⊕ overlay，overlay 同名键覆盖 base
    const merged = plan.overlays.map((o) => ({ ...base, ...o }));
    expect(merged[0]).toEqual({ seed: 42, prompt: 'a cat', sampler: 'euler' });
  });
});
