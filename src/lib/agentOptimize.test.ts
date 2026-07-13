import { describe, it, expect } from 'vitest';
import {
  collectSelectionContext,
  parseSuggestions,
  normalizeParamPatch,
  buildSuggestions,
  applySuggestion,
  type SelNodeLike,
  type SelEdgeLike,
  type RawSuggestion,
  type AgentSuggestion
} from './agentOptimize';

// ───────────────────────── 测试脚手架 ─────────────────────────

function node(id: string, type: string, data: Record<string, unknown> = {}): SelNodeLike {
  return { id, type, data };
}
function edge(source: string, target: string): SelEdgeLike {
  return { source, target };
}

describe('collectSelectionContext', () => {
  const nodes: SelNodeLike[] = [
    node('p1', 'prompt', { text: 'a'.repeat(200) }),
    node('w1', 'work', {
      modelId: 'gpt-image-2（FHL）',
      workType: 'image-generation',
      aspect: '16:9',
      imageSize: '2K',
      quality: 'high',
      n: 2,
      negativePrompt: 'blurry'
    }),
    node('llm1', 'llm', { op: 'optimize', instruction: '扩写' }),
    node('r1', 'result', {}) // 选区外的下游节点
  ];
  const edges: SelEdgeLike[] = [edge('p1', 'w1'), edge('llm1', 'p1'), edge('w1', 'r1')];

  it('提取选中节点的类型 + 关键参数 + 上下游邻居类型；edges 只含选区内部连线', () => {
    const ctx = collectSelectionContext(nodes, edges, ['p1', 'w1', 'llm1']);
    expect(ctx.nodes).toHaveLength(3);

    const w = ctx.nodes.find((n) => n.id === 'w1');
    expect(w).toMatchObject({ kind: 'work', model: 'gpt-image-2（FHL）', aspect: '16:9', resolution: '2K', quality: 'high', n: 2 });
    // 下游邻居含选区外的 result（供「生图没接结果节点」类结构诊断）
    expect(w?.downstream).toEqual(['result']);
    expect(w?.upstream).toEqual(['prompt']);

    // 内部连线不含 w1 → r1（r1 不在选区）
    expect(ctx.edges).toEqual(expect.arrayContaining([{ from: 'p1', to: 'w1' }, { from: 'llm1', to: 'p1' }]));
    expect(ctx.edges).toHaveLength(2);
  });

  it('长文本截断到 80 字 + 省略号；不带图片字节', () => {
    const ctx = collectSelectionContext(nodes, edges, ['p1']);
    const p = ctx.nodes[0];
    expect(typeof p.text).toBe('string');
    expect((p.text as string).length).toBe(81); // 80 字 + '…'
    expect((p.text as string).endsWith('…')).toBe(true);
  });

  it('提示词列表模式：条数封顶 8 条、每条截断', () => {
    const listNode = node('pl', 'prompt', { listMode: true, items: Array.from({ length: 20 }, (_, i) => `条目${i}-` + 'x'.repeat(120)) });
    const ctx = collectSelectionContext([listNode], [], ['pl']);
    const p = ctx.nodes[0];
    expect(p.list).toBe(true);
    expect(p.count).toBe(20);
    expect((p.items as string[]).length).toBe(8);
    for (const it of p.items as string[]) expect(it.length).toBeLessThanOrEqual(81);
  });

  it('总长控制 ~4KB：大量长文本节点时从尾部丢节点，序列化后 ≤ 4096', () => {
    const many: SelNodeLike[] = Array.from({ length: 40 }, (_, i) =>
      node(`p${i}`, 'prompt', { text: `第${i}条 ` + '烫'.repeat(120) })
    );
    const chain: SelEdgeLike[] = Array.from({ length: 39 }, (_, i) => edge(`p${i}`, `p${i + 1}`));
    const ctx = collectSelectionContext(many, chain, many.map((n) => n.id));
    expect(JSON.stringify(ctx).length).toBeLessThanOrEqual(4096);
    expect(ctx.nodes.length).toBeLessThan(40);
    // 被丢节点的内部连线也一并剔除（不产生悬空引用）
    const ids = new Set(ctx.nodes.map((n) => String(n.id)));
    for (const e of ctx.edges) {
      expect(ids.has(e.from)).toBe(true);
      expect(ids.has(e.to)).toBe(true);
    }
  });

  it('image 节点只给「已设图/张数」摘要，绝不带 src（防 data:URI 膨胀）', () => {
    const img = node('i1', 'image', { src: 'data:image/png;base64,AAAA', listMode: false });
    const ctx = collectSelectionContext([img], [], ['i1']);
    expect(JSON.stringify(ctx)).not.toContain('base64');
    expect(ctx.nodes[0].image).toBe('已设图');
  });
});

describe('parseSuggestions', () => {
  it('解析裸数组（带围栏 + 前后赘文）', () => {
    const text = '好的，建议如下：\n```json\n[{"nodeId":"w1","title":"改比例","kind":"param","field":"aspect","newValue":"16:9","reason":"电影感"}]\n```\n以上。';
    const r = parseSuggestions(text);
    expect(r.ok).toBe(true);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ nodeId: 'w1', kind: 'param', field: 'aspect', newValue: '16:9' });
  });

  it('兼容 { suggestions: [...] } 包装形态', () => {
    const r = parseSuggestions(JSON.stringify({ suggestions: [{ nodeId: 'p1', title: 't', kind: 'prompt-rewrite', newValue: 'new', reason: 'r' }] }));
    expect(r.ok).toBe(true);
    expect(r.items).toHaveLength(1);
  });

  it('丢弃未知 kind 条目并记 warning；缺标题时用 reason 兜底', () => {
    const r = parseSuggestions(
      JSON.stringify([
        { nodeId: 'a', kind: 'magic', reason: 'x' },
        { nodeId: 'b', kind: 'structure', reason: '生图节点没接结果节点' }
      ])
    );
    expect(r.ok).toBe(true);
    expect(r.items).toHaveLength(1);
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.items[0].title).toBe('生图节点没接结果节点');
  });

  it('空数组 = ok（流程没问题）；非 JSON = 失败并给 reason', () => {
    expect(parseSuggestions('[]')).toMatchObject({ ok: true, items: [] });
    const bad = parseSuggestions('这段流程看起来不错！');
    expect(bad.ok).toBe(false);
    expect(bad.reason).toBeTruthy();
  });

  it('条数封顶 12 条', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ nodeId: `n${i}`, title: `t${i}`, kind: 'structure', reason: 'r' }));
    expect(parseSuggestions(JSON.stringify(many)).items).toHaveLength(12);
  });
});

describe('normalizeParamPatch（参数白名单 + 钳制）', () => {
  it('work：resolution/size 别名归一到 imageSize', () => {
    expect(normalizeParamPatch('work', 'resolution', '2K')).toEqual({ field: 'imageSize', value: '2K' });
    expect(normalizeParamPatch('work', 'size', '4K')).toEqual({ field: 'imageSize', value: '4K' });
    expect(normalizeParamPatch('work', 'negative_prompt', 'blurry')).toEqual({ field: 'negativePrompt', value: 'blurry' });
  });

  it('work：n 钳到 1–4、strength 钳到 0–1', () => {
    expect(normalizeParamPatch('work', 'n', 9)).toEqual({ field: 'n', value: 4 });
    expect(normalizeParamPatch('work', 'strength', 5)).toEqual({ field: 'strength', value: 1 });
  });

  it('白名单外字段 / 系统管理字段一律拒绝', () => {
    expect(normalizeParamPatch('work', 'modelId', 'x')).toBeNull();
    expect(normalizeParamPatch('work', 'seed', 42)).toBeNull();
    expect(normalizeParamPatch('prompt', 'text', 'x')).toBeNull(); // 提示词走 prompt-rewrite 专用通道
    expect(normalizeParamPatch('compare', 'slider', 50)).toBeNull(); // 该类型不支持自动改参
    expect(normalizeParamPatch('xxx', 'aspect', '1:1')).toBeNull(); // 未知节点类型
  });

  it('枚举校验复用 sanitizeNodeParams：video mode 非法被拒、合法通过', () => {
    expect(normalizeParamPatch('video', 'mode', 'not-a-mode')).toBeNull();
    expect(normalizeParamPatch('video', 'duration', '10')).toEqual({ field: 'duration', value: '10' });
  });
});

describe('buildSuggestions（可应用性标注）', () => {
  const nodes: SelNodeLike[] = [
    node('p1', 'prompt', { text: '旧提示词' }),
    node('pl', 'prompt', { listMode: true, items: ['a', 'b'] }),
    node('w1', 'work', { modelId: 'm', workType: 'image-generation' })
  ];
  function raw(partial: Partial<RawSuggestion>): RawSuggestion {
    return { nodeId: '', title: 't', kind: 'structure', reason: 'r', ...partial };
  }

  it('prompt-rewrite：普通提示词节点可应用；列表模式不可自动应用', () => {
    const [a, b] = buildSuggestions(
      [raw({ nodeId: 'p1', kind: 'prompt-rewrite', newValue: '新提示词' }), raw({ nodeId: 'pl', kind: 'prompt-rewrite', newValue: '新' })],
      nodes
    );
    expect(a.applicable).toBe(true);
    expect(b.applicable).toBe(false);
    expect(b.applyNote).toContain('列表模式');
  });

  it('param：白名单通过给 patch；越界值已被钳（预览与应用一致）', () => {
    const [s] = buildSuggestions([raw({ nodeId: 'w1', kind: 'param', field: 'n', newValue: 8 })], nodes);
    expect(s.applicable).toBe(true);
    expect(s.patch).toEqual({ field: 'n', value: 4 });
  });

  it('param：白名单外 / 目标节点不存在 → 不可应用', () => {
    const [a, b] = buildSuggestions(
      [raw({ nodeId: 'w1', kind: 'param', field: 'modelId', newValue: 'x' }), raw({ nodeId: 'gone', kind: 'param', field: 'n', newValue: 2 })],
      nodes
    );
    expect(a.applicable).toBe(false);
    expect(b.applicable).toBe(false);
    expect(b.applyNote).toContain('不存在');
  });

  it('structure：永不自动应用', () => {
    const [s] = buildSuggestions([raw({ nodeId: 'w1', kind: 'structure', reason: '没接结果节点' })], nodes);
    expect(s.applicable).toBe(false);
    expect(s.applyNote).toContain('手动');
  });
});

describe('applySuggestion（注入 store 动作，含 family 钳制）', () => {
  function sug(partial: Partial<AgentSuggestion>): AgentSuggestion {
    return { id: 's1', nodeId: '', title: 't', kind: 'param', reason: 'r', applicable: true, ...partial };
  }
  function recorder(): { calls: Array<{ id: string; patch: Record<string, unknown> }>; fn: (id: string, patch: Record<string, unknown>) => void } {
    const calls: Array<{ id: string; patch: Record<string, unknown> }> = [];
    return { calls, fn: (id, patch) => calls.push({ id, patch }) };
  }

  it('prompt-rewrite：写入提示词节点 text', () => {
    const rec = recorder();
    const r = applySuggestion(sug({ nodeId: 'p1', kind: 'prompt-rewrite', newValue: '  新提示词  ' }), {
      nodes: [node('p1', 'prompt', { text: '旧' })],
      updateNodeData: rec.fn
    });
    expect(r.ok).toBe(true);
    expect(rec.calls).toEqual([{ id: 'p1', patch: { text: '新提示词' } }]);
  });

  it('param：work 档位越界按模型 family 钳制（nano-banana-2 不支持 8K → 退 2K）', () => {
    const rec = recorder();
    const r = applySuggestion(sug({ nodeId: 'w1', field: 'imageSize', newValue: '8K' }), {
      nodes: [node('w1', 'work', { modelId: 'nb2' })],
      updateNodeData: rec.fn,
      imageModels: [{ name: 'nb2', actualId: 'nano-banana-2' }]
    });
    expect(r.ok).toBe(true);
    expect(rec.calls).toEqual([{ id: 'w1', patch: { imageSize: '2K' } }]);
  });

  it('param：family 不支持 quality → 拒绝应用且不写 store', () => {
    const rec = recorder();
    const r = applySuggestion(sug({ nodeId: 'w1', field: 'quality', newValue: 'high' }), {
      nodes: [node('w1', 'work', { modelId: 'nb2' })],
      updateNodeData: rec.fn,
      imageModels: [{ name: 'nb2', actualId: 'nano-banana-2' }]
    });
    expect(r.ok).toBe(false);
    expect(rec.calls).toHaveLength(0);
  });

  it('structure / 节点不存在 / 列表模式提示词 → 拒绝且不写 store', () => {
    const rec = recorder();
    expect(applySuggestion(sug({ kind: 'structure' }), { nodes: [], updateNodeData: rec.fn }).ok).toBe(false);
    expect(applySuggestion(sug({ nodeId: 'gone', field: 'n', newValue: 2 }), { nodes: [], updateNodeData: rec.fn }).ok).toBe(false);
    expect(
      applySuggestion(sug({ nodeId: 'pl', kind: 'prompt-rewrite', newValue: 'x' }), {
        nodes: [node('pl', 'prompt', { listMode: true })],
        updateNodeData: rec.fn
      }).ok
    ).toBe(false);
    expect(rec.calls).toHaveLength(0);
  });
});
