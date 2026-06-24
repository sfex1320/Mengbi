import { describe, it, expect } from 'vitest';
import { applyBindings, applyBypass } from './bindings';
import type { ComfyApiWorkflow, InputControl, Binding } from '@shared/comfyui';

// 锁住「把控件值写进 workflow」(applyBindings) 与「绕过节点重连图」(applyBypass) 的逻辑。
// 二者都必须深拷贝、绝不污染原 workflow。

// ───────── helpers ─────────
function ctrl(id: string, type: InputControl['type'], extra: Partial<InputControl> = {}): InputControl {
  return { id, label: id, type, ...extra };
}
function node(class_type: string, inputs: Record<string, unknown>) {
  return { class_type, inputs };
}

describe('applyBindings — parameter 写入与类型 coerce', () => {
  it('parameter 模式按控件 type 把值 coerce 成数值/布尔', () => {
    const wf: ComfyApiWorkflow = {
      '1': node('KSampler', { steps: 20, cfg: 7, denoise: 1.0, add_noise: false }),
    };
    const controls = [
      ctrl('c_steps', 'number'),
      ctrl('c_cfg', 'slider'),
      ctrl('c_noise', 'switch'),
    ];
    const bindings: Binding[] = [
      { mode: 'parameter', controlId: 'c_steps', nodeId: '1', inputName: 'steps' },
      { mode: 'parameter', controlId: 'c_cfg', nodeId: '1', inputName: 'cfg' },
      { mode: 'parameter', controlId: 'c_noise', nodeId: '1', inputName: 'add_noise' },
    ];
    const out = applyBindings(wf, controls, bindings, {
      c_steps: '30', // string → Number(30)
      c_cfg: '8.5', // string → Number(8.5)
      c_noise: 1, // truthy → Boolean(true)
    });
    expect(out['1'].inputs.steps).toBe(30);
    expect(typeof out['1'].inputs.steps).toBe('number');
    expect(out['1'].inputs.cfg).toBe(8.5);
    expect(out['1'].inputs.add_noise).toBe(true);
  });

  it('无控件 type 时按 current 值类型推断 coerce（current=number → Number）', () => {
    const wf: ComfyApiWorkflow = { '1': node('N', { width: 512, flag: true }) };
    const bindings: Binding[] = [
      { mode: 'parameter', controlId: 'cw', nodeId: '1', inputName: 'width' },
      { mode: 'parameter', controlId: 'cf', nodeId: '1', inputName: 'flag' },
    ];
    // 控件无 type（type=text → coerce 落到 current 类型分支）
    const out = applyBindings(wf, [ctrl('cw', 'text'), ctrl('cf', 'text')], bindings, {
      cw: '768',
      cf: '', // 注意：'' 会被「留空 → 不覆盖」拦掉，故 flag 保持原值 true
    });
    expect(out['1'].inputs.width).toBe(768); // current 是 number → Number('768')
    expect(out['1'].inputs.flag).toBe(true); // cf 为 '' 被跳过，保留默认
  });

  it("留空（'' 或 undefined）不覆盖，保留工作流默认值", () => {
    const wf: ComfyApiWorkflow = { '1': node('N', { text: 'keep-me' }) };
    const bindings: Binding[] = [
      { mode: 'parameter', controlId: 'c1', nodeId: '1', inputName: 'text' },
    ];
    const out1 = applyBindings(wf, [ctrl('c1', 'text')], bindings, { c1: '' });
    expect(out1['1'].inputs.text).toBe('keep-me');
    const out2 = applyBindings(wf, [ctrl('c1', 'text')], bindings, {}); // value 缺失 → undefined
    expect(out2['1'].inputs.text).toBe('keep-me');
  });

  it('文本控件正常写入字符串（text 类不强转）', () => {
    const wf: ComfyApiWorkflow = { '1': node('CLIPTextEncode', { text: 'old' }) };
    const bindings: Binding[] = [
      { mode: 'parameter', controlId: 'c1', nodeId: '1', inputName: 'text' },
    ];
    const out = applyBindings(wf, [ctrl('c1', 'text')], bindings, { c1: 'a beautiful cat' });
    expect(out['1'].inputs.text).toBe('a beautiful cat');
  });

  it('节点不存在 / 无 inputs 时跳过该绑定，不报错', () => {
    const wf: ComfyApiWorkflow = { '1': node('N', { x: 1 }) };
    const bindings: Binding[] = [
      { mode: 'parameter', controlId: 'c1', nodeId: '999', inputName: 'x' }, // 节点不存在
    ];
    expect(() => applyBindings(wf, [ctrl('c1', 'number')], bindings, { c1: '5' })).not.toThrow();
    const out = applyBindings(wf, [ctrl('c1', 'number')], bindings, { c1: '5' });
    expect(out['1'].inputs.x).toBe(1);
  });

  it('非 parameter/file_upload 模式（connection/expression/preset…）被跳过', () => {
    const wf: ComfyApiWorkflow = { '1': node('N', { x: 'orig' }) };
    const bindings: Binding[] = [
      { mode: 'connection', controlId: 'c1', nodeId: '1', inputName: 'x', sourceNodeId: '2', sourceOutput: 0 },
    ];
    const out = applyBindings(wf, [ctrl('c1', 'text')], bindings, { c1: 'new' });
    expect(out['1'].inputs.x).toBe('orig');
  });
});

describe('applyBindings — seed 模式', () => {
  it('seed=-1 / 空 / 非有限数 → 随机非负整数', () => {
    const wf: ComfyApiWorkflow = { '1': node('KSampler', { seed: 0 }) };
    const bindings: Binding[] = [
      { mode: 'parameter', controlId: 's', nodeId: '1', inputName: 'seed' },
    ];
    const controls = [ctrl('s', 'seed')];
    for (const v of [-1, '', 'abc', NaN, -5]) {
      const out = applyBindings(wf, controls, bindings, { s: v });
      const seed = out['1'].inputs.seed as number;
      expect(typeof seed).toBe('number');
      expect(Number.isFinite(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThan(2_000_000_000);
    }
  });

  it('seed 给定有效非负数 → 原样写入（coerce 成 number）', () => {
    const wf: ComfyApiWorkflow = { '1': node('KSampler', { seed: 0 }) };
    const bindings: Binding[] = [
      { mode: 'parameter', controlId: 's', nodeId: '1', inputName: 'seed' },
    ];
    const out = applyBindings(wf, [ctrl('s', 'seed')], bindings, { s: '12345' });
    expect(out['1'].inputs.seed).toBe(12345);
  });

  it('seed=undefined（值缺失）→ 仍随机（不走「留空不覆盖」，因被替换成随机数）', () => {
    const wf: ComfyApiWorkflow = { '1': node('KSampler', { seed: 99 }) };
    const bindings: Binding[] = [
      { mode: 'parameter', controlId: 's', nodeId: '1', inputName: 'seed' },
    ];
    const out = applyBindings(wf, [ctrl('s', 'seed')], bindings, {}); // raw undefined → 随机
    const seed = out['1'].inputs.seed as number;
    expect(seed).not.toBe(99);
    expect(seed).toBeGreaterThanOrEqual(0);
  });
});

describe('applyBindings — file_upload 模式', () => {
  it('把已上传文件名写进绑定字段', () => {
    const wf: ComfyApiWorkflow = { '5': node('LoadImage', { image: 'placeholder.png' }) };
    const bindings: Binding[] = [
      { mode: 'file_upload', controlId: 'img', nodeId: '5', inputName: 'image' },
    ];
    const out = applyBindings(wf, [ctrl('img', 'image')], bindings, {}, { img: 'uploaded_abc.png' });
    expect(out['5'].inputs.image).toBe('uploaded_abc.png');
  });

  it('uploadedFileMap 缺该控件 → 不改字段', () => {
    const wf: ComfyApiWorkflow = { '5': node('LoadImage', { image: 'placeholder.png' }) };
    const bindings: Binding[] = [
      { mode: 'file_upload', controlId: 'img', nodeId: '5', inputName: 'image' },
    ];
    const out = applyBindings(wf, [ctrl('img', 'image')], bindings, {}, {});
    expect(out['5'].inputs.image).toBe('placeholder.png');
  });
});

describe('applyBindings — 深拷贝不污染 original', () => {
  it('改 runtime 不影响入参 workflow', () => {
    const wf: ComfyApiWorkflow = { '1': node('N', { steps: 10 }) };
    const before = JSON.stringify(wf);
    const bindings: Binding[] = [
      { mode: 'parameter', controlId: 'c', nodeId: '1', inputName: 'steps' },
    ];
    const out = applyBindings(wf, [ctrl('c', 'number')], bindings, { c: '50' });
    expect(out['1'].inputs.steps).toBe(50);
    expect(wf['1'].inputs.steps).toBe(10); // original 不变
    expect(JSON.stringify(wf)).toBe(before);
    expect(out).not.toBe(wf);
    expect(out['1']).not.toBe(wf['1']); // 深拷贝
  });
});

describe('applyBypass — 单节点直通', () => {
  it('下游对被绕过节点的引用重连到其输入源', () => {
    // 2 -> 1(bypass) -> 3：3.x 读 1 的输出，应重连到 2
    const wf: ComfyApiWorkflow = {
      '1': node('Bypassed', { in0: ['2', 0] }),
      '2': node('Source', { val: 1 }),
      '3': node('Sink', { x: ['1', 0] }),
    };
    const out = applyBypass(wf, new Set(['1']));
    expect(out['1']).toBeUndefined(); // 被摘除
    expect(out['3'].inputs.x).toEqual(['2', 0]); // 重连到源
    expect(out['2']).toBeDefined();
  });

  it('bypassIds 为空 → 原样返回（同一引用，提前 return original）', () => {
    const wf: ComfyApiWorkflow = { '1': node('N', { x: 1 }) };
    const out = applyBypass(wf, new Set());
    expect(out).toBe(wf); // 源码 size===0 直接 return original
  });
});

describe('applyBypass — 连续多节点递归直通', () => {
  it('链式 4 -> 3(bypass) -> 2(bypass) -> 1：1 重连到 4', () => {
    const wf: ComfyApiWorkflow = {
      '1': node('Sink', { x: ['2', 0] }),
      '2': node('Mid', { in: ['3', 0] }),
      '3': node('Mid', { in: ['4', 0] }),
      '4': node('Source', { v: 1 }),
    };
    const out = applyBypass(wf, new Set(['2', '3']));
    expect(out['2']).toBeUndefined();
    expect(out['3']).toBeUndefined();
    expect(out['1'].inputs.x).toEqual(['4', 0]); // 递归穿透 3 与 2 → 源 4
    expect(out['4']).toBeDefined();
  });
});

describe('applyBypass — slot 回退 srcs[slot] ?? srcs[0]', () => {
  it('被绕过节点只有 1 个输入源，下游读其 slot 1 → 回退到 srcs[0]', () => {
    // 1(bypass) 只有一个连线输入源 [9,0]；3 读 1 的第 1 个输出（slot=1）
    const wf: ComfyApiWorkflow = {
      '1': node('Bypassed', { a: ['9', 0], scalar: 5 }), // 只有一个 link 源
      '9': node('Source', { v: 1 }),
      '3': node('Sink', { x: ['1', 1] }), // slot 1
    };
    const out = applyBypass(wf, new Set(['1']));
    expect(out['3'].inputs.x).toEqual(['9', 0]); // srcs[1] 不存在 → srcs[0]
  });

  it('按输入连线出现顺序取多源，slot 命中对应源', () => {
    const wf: ComfyApiWorkflow = {
      '1': node('Bypassed', { first: ['7', 0], second: ['8', 0] }), // srcs=[[7,0],[8,0]]
      '7': node('A', { v: 1 }),
      '8': node('B', { v: 2 }),
      '3': node('Sink', { x: ['1', 1] }), // slot 1 → srcs[1]=[8,0]
    };
    const out = applyBypass(wf, new Set(['1']));
    expect(out['3'].inputs.x).toEqual(['8', 0]);
  });
});

describe('applyBypass — 找不到源则删悬空输入', () => {
  it('被绕过节点没有任何连线输入 → 下游引用被删除', () => {
    const wf: ComfyApiWorkflow = {
      '1': node('Bypassed', { scalar: 5 }), // 无 link 输入 → srcs 空
      '3': node('Sink', { x: ['1', 0], keep: 'yes' }),
    };
    const out = applyBypass(wf, new Set(['1']));
    expect(out['1']).toBeUndefined();
    expect('x' in out['3'].inputs).toBe(false); // 悬空输入被删
    expect(out['3'].inputs.keep).toBe('yes'); // 其它输入保留
  });
});

describe('applyBypass — 环保护', () => {
  it('成环（互相引用且都被绕过）不死循环，按源码删悬空输入', () => {
    // 1<->2 互为输入源，且都被 bypass；下游 3 读 1 → resolve 遇环返回 null → 删 x
    const wf: ComfyApiWorkflow = {
      '1': node('A', { in: ['2', 0] }),
      '2': node('B', { in: ['1', 0] }),
      '3': node('Sink', { x: ['1', 0], y: 1 }),
    };
    let out: ComfyApiWorkflow | undefined;
    expect(() => {
      out = applyBypass(wf, new Set(['1', '2']));
    }).not.toThrow(); // 不死循环
    expect(out!['1']).toBeUndefined();
    expect(out!['2']).toBeUndefined();
    expect('x' in out!['3'].inputs).toBe(false); // 环 → null → 删悬空输入
    expect(out!['3'].inputs.y).toBe(1);
  });
});

describe('applyBypass — 深拷贝不污染 original', () => {
  it('改 runtime 不影响入参 workflow', () => {
    const wf: ComfyApiWorkflow = {
      '1': node('Bypassed', { in: ['2', 0] }),
      '2': node('Source', { v: 1 }),
      '3': node('Sink', { x: ['1', 0] }),
    };
    const before = JSON.stringify(wf);
    const out = applyBypass(wf, new Set(['1']));
    expect(out['3'].inputs.x).toEqual(['2', 0]);
    expect(wf['1']).toBeDefined(); // original 仍含被绕过节点
    expect(wf['3'].inputs.x).toEqual(['1', 0]); // original 引用不变
    expect(JSON.stringify(wf)).toBe(before);
    expect(out).not.toBe(wf);
  });

  it('非连线输入（标量 / 非 [id,number] 形态）不被当作链接误重连', () => {
    const wf: ComfyApiWorkflow = {
      '1': node('Bypassed', { in: ['2', 0] }),
      '2': node('Source', { v: 1 }),
      // 形似但不是 link：长度 3 / 第二项非 number
      '3': node('Sink', { a: ['1', 0, 'x'], b: ['1', 'name'], c: ['1', 0] }),
    };
    const out = applyBypass(wf, new Set(['1']));
    expect(out['3'].inputs.a).toEqual(['1', 0, 'x']); // 非 link，原样保留
    expect(out['3'].inputs.b).toEqual(['1', 'name']); // 非 link，原样保留
    expect(out['3'].inputs.c).toEqual(['2', 0]); // 真 link，重连
  });
});
