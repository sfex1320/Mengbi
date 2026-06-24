import { describe, it, expect } from 'vitest';
import { detectFormat, parseApiWorkflow, substitutePlaceholders } from './parser';
import type { ComfyApiWorkflow } from '@shared/comfyui';

// 锁住 ComfyUI workflow 解析的三个纯函数行为：
// - detectFormat：API map / UI(save) / unknown 判定
// - parseApiWorkflow：连线 input(isLink) vs 字面参数拆分 + unknown class_type 标记
// - substitutePlaceholders：仅整串 {{var}} 替换、深拷贝不污染原对象、递归

// ───────────────────────── detectFormat ─────────────────────────

describe('detectFormat', () => {
  it('API 格式：每个值都是 {class_type, inputs} → api', () => {
    const api = {
      '1': { class_type: 'KSampler', inputs: { seed: 1 } },
      '2': { class_type: 'CLIPTextEncode', inputs: { text: 'hi' } }
    };
    expect(detectFormat(api)).toBe('api');
  });

  it('UI / save 格式：顶层有 nodes 数组 → ui', () => {
    const ui = { nodes: [{ id: 1, type: 'KSampler' }], links: [], groups: [] };
    expect(detectFormat(ui)).toBe('ui');
  });

  it('UI 格式优先级：即便其它值像 API 节点，有 nodes 数组就判 ui', () => {
    // nodes 数组分支在 every(looksLikeApiNode) 之前命中
    const ui = { nodes: [], '1': { class_type: 'X', inputs: {} } };
    expect(detectFormat(ui)).toBe('ui');
  });

  it('空对象 → unknown（values.length 为 0，不满足 api 条件）', () => {
    expect(detectFormat({})).toBe('unknown');
  });

  it('部分值不像 API 节点（缺 inputs） → unknown', () => {
    const mixed = {
      '1': { class_type: 'KSampler', inputs: { seed: 1 } },
      '2': { class_type: 'NoInputs' } // 缺 inputs → looksLikeApiNode 为 false
    };
    expect(detectFormat(mixed)).toBe('unknown');
  });

  it('非对象输入（null / 字符串 / 数字）→ unknown', () => {
    expect(detectFormat(null)).toBe('unknown');
    expect(detectFormat('not-an-object')).toBe('unknown');
    expect(detectFormat(42)).toBe('unknown');
    expect(detectFormat(undefined)).toBe('unknown');
  });

  it('class_type 不是字符串 → 该值不算 API 节点 → unknown', () => {
    const bad = { '1': { class_type: 123, inputs: {} } };
    expect(detectFormat(bad)).toBe('unknown');
  });
});

// ───────────────────────── parseApiWorkflow ─────────────────────────

describe('parseApiWorkflow', () => {
  it('区分连线输入（[nodeId, slot]）与字面参数', () => {
    const wf: ComfyApiWorkflow = {
      '3': {
        class_type: 'KSampler',
        inputs: {
          seed: 12345, // 字面参数
          steps: 20, // 字面参数
          model: ['4', 0], // 连线（字符串 nodeId）
          positive: ['6', 1] // 连线
        }
      }
    };
    const graph = parseApiWorkflow(wf);

    expect(graph.nodes).toHaveLength(1);
    const node = graph.nodes[0];
    expect(node.id).toBe('3');
    expect(node.classType).toBe('KSampler');

    // 字面参数：seed / steps，连线不进 params
    const paramNames = node.params.map((p) => p.name).sort();
    expect(paramNames).toEqual(['seed', 'steps']);
    expect(node.params.find((p) => p.name === 'seed')?.value).toBe(12345);

    // 连线 input 记到 linkedInputs
    expect(node.linkedInputs.sort()).toEqual(['model', 'positive']);

    // 两条边
    expect(graph.edges).toHaveLength(2);
    expect(graph.edges).toContainEqual({ fromNode: '4', fromOutput: 0, toNode: '3', toInput: 'model' });
    expect(graph.edges).toContainEqual({ fromNode: '6', fromOutput: 1, toNode: '3', toInput: 'positive' });
  });

  it('连线 nodeId 为数字时被 String() 归一化进 edge.fromNode', () => {
    const wf: ComfyApiWorkflow = {
      '1': { class_type: 'Foo', inputs: { latent: [4, 0] } } // 数字 nodeId
    };
    const graph = parseApiWorkflow(wf);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].fromNode).toBe('4'); // String(4)
    expect(graph.nodes[0].linkedInputs).toEqual(['latent']);
    expect(graph.nodes[0].params).toEqual([]);
  });

  it('数组但不是 [nodeId, slot] 形态（长度!=2 / slot 非 number）→ 当字面参数', () => {
    const wf: ComfyApiWorkflow = {
      '1': {
        class_type: 'Foo',
        inputs: {
          triple: [1, 2, 3], // 长度 3 → 非 link
          badSlot: ['2', 'notNumber'], // slot 非 number → 非 link
          size: [512, 512] // 第二项是 number 但第一项也是 number → 仍是 link！见下方专门用例
        }
      }
    };
    const graph = parseApiWorkflow(wf);
    const node = graph.nodes[0];
    // triple / badSlot 是字面参数；size 因 [number, number] 满足 isLink → 连线
    expect(node.params.map((p) => p.name).sort()).toEqual(['badSlot', 'triple']);
    expect(node.linkedInputs).toEqual(['size']);
  });

  it('[number, number] 满足 isLink（注意：源码把它当连线）', () => {
    // 标注：这是源码的实际行为——isLink 只看 (v[0] 是 string|number) && (v[1] 是 number)，
    // 所以 [512, 512] 这种「宽高数组」会被误判为连线。此用例锁住当前行为。
    const wf: ComfyApiWorkflow = {
      '1': { class_type: 'Foo', inputs: { dims: [512, 512] } }
    };
    const graph = parseApiWorkflow(wf);
    expect(graph.nodes[0].linkedInputs).toEqual(['dims']);
    expect(graph.edges[0]).toEqual({ fromNode: '512', fromOutput: 512, toNode: '1', toInput: 'dims' });
  });

  it('提取 _meta.title 到 node.title', () => {
    const wf: ComfyApiWorkflow = {
      '1': { class_type: 'KSampler', inputs: {}, _meta: { title: '采样器' } }
    };
    const graph = parseApiWorkflow(wf);
    expect(graph.nodes[0].title).toBe('采样器');
  });

  it('未知 class_type：knownClassTypes 不含时标 unknown=true，含时 false', () => {
    const wf: ComfyApiWorkflow = {
      '1': { class_type: 'KSampler', inputs: {} },
      '2': { class_type: 'CustomMysteryNode', inputs: {} }
    };
    const known = new Set(['KSampler', 'CLIPTextEncode']);
    const graph = parseApiWorkflow(wf, known);
    const byId = Object.fromEntries(graph.nodes.map((n) => [n.id, n]));
    expect(byId['1'].unknown).toBe(false); // 已知
    expect(byId['2'].unknown).toBe(true); // 未知
  });

  it('不传 knownClassTypes 时所有节点 unknown=false（第一阶段不阻塞）', () => {
    const wf: ComfyApiWorkflow = {
      '1': { class_type: 'AnythingGoes', inputs: {} }
    };
    const graph = parseApiWorkflow(wf);
    expect(graph.nodes[0].unknown).toBe(false);
  });

  it('跳过不像 API 节点的条目（缺 inputs / class_type）', () => {
    const wf = {
      '1': { class_type: 'KSampler', inputs: { seed: 1 } },
      '2': { class_type: 'NoInputs' }, // 缺 inputs → 跳过
      '3': { inputs: {} } // 缺 class_type → 跳过
    } as unknown as ComfyApiWorkflow;
    const graph = parseApiWorkflow(wf);
    expect(graph.nodes.map((n) => n.id)).toEqual(['1']);
  });

  it('空 workflow → 空 nodes/edges', () => {
    const graph = parseApiWorkflow({} as ComfyApiWorkflow);
    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
  });
});

// ───────────────────────── substitutePlaceholders ─────────────────────────

describe('substitutePlaceholders', () => {
  it('整串 {{var}} 才替换；子串拼接 prefix-{{x}} 不替换', () => {
    const out = substitutePlaceholders(
      { full: '{{prompt}}', partial: 'prefix-{{prompt}}', mixed: '{{prompt}} tail' },
      { prompt: 'a cat' }
    ) as Record<string, unknown>;
    expect(out.full).toBe('a cat'); // 整串替换
    expect(out.partial).toBe('prefix-{{prompt}}'); // 子串不替换
    expect(out.mixed).toBe('{{prompt}} tail'); // 子串不替换
  });

  it('替换为变量的真实类型（数字保留为 number）', () => {
    const out = substitutePlaceholders({ seed: '{{seed}}' }, { seed: 42 }) as Record<string, unknown>;
    expect(out.seed).toBe(42);
    expect(typeof out.seed).toBe('number');
  });

  it('未知变量保留原样（{{nope}} 不在 variables 里）', () => {
    const out = substitutePlaceholders({ x: '{{nope}}' }, { prompt: 'hi' }) as Record<string, unknown>;
    expect(out.x).toBe('{{nope}}');
  });

  it('两端空白被 trim 后匹配（"  {{prompt}}  " → 替换）', () => {
    // 源码用 obj.trim() 后再匹配 ^\{\{(\w+)\}\}$
    const out = substitutePlaceholders({ x: '  {{prompt}}  ' }, { prompt: 'v' }) as Record<string, unknown>;
    expect(out.x).toBe('v');
  });

  it('递归进入嵌套对象与数组', () => {
    const out = substitutePlaceholders(
      {
        a: { b: { c: '{{prompt}}' } },
        list: ['{{seed}}', 'static', '{{prompt}}']
      },
      { prompt: 'p', seed: 7 }
    ) as { a: { b: { c: unknown } }; list: unknown[] };
    expect(out.a.b.c).toBe('p');
    expect(out.list).toEqual([7, 'static', 'p']);
  });

  it('深拷贝、绝不污染原对象', () => {
    const original = {
      prompt: '{{prompt}}',
      nested: { seed: '{{seed}}' },
      arr: ['{{prompt}}']
    };
    const snapshot = JSON.parse(JSON.stringify(original));
    const out = substitutePlaceholders(original, { prompt: 'X', seed: 9 }) as Record<string, unknown>;

    // 原对象逐字节未变
    expect(original).toEqual(snapshot);
    expect(original.prompt).toBe('{{prompt}}');
    expect(original.nested.seed).toBe('{{seed}}');
    expect(original.arr[0]).toBe('{{prompt}}');

    // 返回的是不同引用（新对象 / 新数组）
    expect(out).not.toBe(original);
    expect((out as { nested: unknown }).nested).not.toBe(original.nested);
    expect((out as { arr: unknown }).arr).not.toBe(original.arr);
  });

  it('非字符串标量（number / boolean / null）原样返回', () => {
    expect(substitutePlaceholders(123, { prompt: 'x' })).toBe(123);
    expect(substitutePlaceholders(true, { prompt: 'x' })).toBe(true);
    expect(substitutePlaceholders(null, { prompt: 'x' })).toBe(null);
  });

  it('数组里嵌套对象也递归', () => {
    const out = substitutePlaceholders([{ k: '{{prompt}}' }], { prompt: 'deep' }) as Array<{ k: unknown }>;
    expect(out[0].k).toBe('deep');
  });
});
