import { describe, it, expect } from 'vitest';
import {
  parseBlueprint,
  sanitizeNodeParams,
  clampWorkForModel,
  pickModelName,
  layoutBlueprint,
  matchComfyTemplate,
  resolveComfyControls,
  type AgentComfyTemplate,
  type BlueprintNode,
  type BlueprintEdge
} from './agentBlueprint';
import { detectFamily } from '../types/imageModelFamilies';
import type { MappedModel } from './modelMapping';
import type { InputControl } from '../types/comfyui';

describe('parseBlueprint', () => {
  it('解析合法蓝图', () => {
    const t = JSON.stringify({
      summary: 's',
      nodes: [
        { id: 'n1', kind: 'prompt', params: { text: 'hi' } },
        { id: 'n2', kind: 'work', params: {} }
      ],
      edges: [{ from: 'n1', to: 'n2' }]
    });
    const r = parseBlueprint(t);
    expect(r.ok).toBe(true);
    expect(r.spec?.nodes).toHaveLength(2);
    expect(r.spec?.edges).toHaveLength(1);
    expect(r.spec?.summary).toBe('s');
  });
  it('去 markdown 围栏 + 前后文本', () => {
    const t = '好的，方案如下：\n```json\n{"nodes":[{"id":"a","kind":"prompt"}]}\n```\n以上。';
    expect(parseBlueprint(t).ok).toBe(true);
  });
  it('丢弃未知 kind 节点并记 warning', () => {
    const t = JSON.stringify({ nodes: [{ id: 'a', kind: 'prompt' }, { id: 'b', kind: 'xxx' }] });
    const r = parseBlueprint(t);
    expect(r.ok).toBe(true);
    expect(r.spec?.nodes).toHaveLength(1);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
  it('丢弃重复 id 的节点', () => {
    const t = JSON.stringify({ nodes: [{ id: 'a', kind: 'prompt' }, { id: 'a', kind: 'work' }] });
    expect(parseBlueprint(t).spec?.nodes).toHaveLength(1);
  });
  it('丢弃指向不存在节点 / 自连的连线，保留合法连线', () => {
    const t = JSON.stringify({
      nodes: [{ id: 'a', kind: 'prompt' }, { id: 'b', kind: 'work' }],
      edges: [{ from: 'a', to: 'zzz' }, { from: 'a', to: 'a' }, { from: 'a', to: 'b' }]
    });
    const r = parseBlueprint(t);
    expect(r.spec?.edges).toHaveLength(1);
    expect(r.spec?.edges[0]).toMatchObject({ from: 'a', to: 'b' });
  });
  it('去重相同连线', () => {
    const t = JSON.stringify({
      nodes: [{ id: 'a', kind: 'prompt' }, { id: 'b', kind: 'work' }],
      edges: [{ from: 'a', to: 'b' }, { from: 'a', to: 'b' }]
    });
    expect(parseBlueprint(t).spec?.edges).toHaveLength(1);
  });
  it('无节点 / 非 JSON → 失败', () => {
    expect(parseBlueprint('这不是 JSON').ok).toBe(false);
    expect(parseBlueprint(JSON.stringify({ nodes: [] })).ok).toBe(false);
    expect(parseBlueprint(JSON.stringify({ foo: 1 })).ok).toBe(false);
  });
  it('imageBindings 校验：丢非法 source / 不存在节点', () => {
    const t = JSON.stringify({
      nodes: [{ id: 'a', kind: 'work' }],
      imageBindings: [
        { node: 'a', source: 'attached', indexes: [0] },
        { node: 'a', source: 'bad' },
        { node: 'zzz', source: 'gallery' }
      ]
    });
    const r = parseBlueprint(t);
    expect(r.spec?.imageBindings).toHaveLength(1);
    expect(r.spec?.imageBindings[0]).toMatchObject({ node: 'a', source: 'attached' });
  });
});

describe('sanitizeNodeParams', () => {
  it('只保留目录声明的字段（丢弃 LLM 编造字段）', () => {
    expect(sanitizeNodeParams('prompt', { text: 'a', evil: 'x', modelId: 'hack' })).toEqual({ text: 'a' });
  });
  it('work：钳 n 到 1..4、丢非法 workType、保留合法 aspect', () => {
    const out = sanitizeNodeParams('work', { n: 9, workType: 'nope', aspect: '16:9' });
    expect(out.n).toBe(4);
    expect('workType' in out).toBe(false);
    expect(out.aspect).toBe('16:9');
  });
  it('work：合法 workType 保留', () => {
    expect(sanitizeNodeParams('work', { workType: 'image-edit' }).workType).toBe('image-edit');
  });
  it('ratio：非法 aspect/tier/emit 丢弃、合法保留', () => {
    const out = sanitizeNodeParams('ratio', { aspect: '16:9', tier: '99K', emit: 'weird' });
    expect(out.aspect).toBe('16:9');
    expect('tier' in out).toBe(false);
    expect('emit' in out).toBe(false);
  });
  it('llm：非法 op 丢弃、合法保留', () => {
    expect('op' in sanitizeNodeParams('llm', { op: 'xxx' })).toBe(false);
    expect(sanitizeNodeParams('llm', { op: 'optimize' }).op).toBe('optimize');
  });
  it('palette：count 钳到 2..12', () => {
    expect(sanitizeNodeParams('palette', { count: 99 }).count).toBe(12);
    expect(sanitizeNodeParams('palette', { count: 1 }).count).toBe(2);
  });
  it('work：quality 保留、strength 钳到 0..1', () => {
    const out = sanitizeNodeParams('work', { quality: 'high', strength: 3 });
    expect(out.quality).toBe('high');
    expect(out.strength).toBe(1);
  });
  it('light：合法 occlusion/effect 保留、非法丢弃', () => {
    const out = sanitizeNodeParams('light', { occlusion: 'leaves', effect: 'godrays', sourceType: 'nope' });
    expect(out.occlusion).toBe('leaves');
    expect(out.effect).toBe('godrays');
    expect('sourceType' in out).toBe(false);
  });
  it('comfy：保留 template(字符串) + controls(对象)，丢非对象 controls', () => {
    const out = sanitizeNodeParams('comfy', { template: '高清放大', controls: { steps: 30 }, evil: 1 });
    expect(out.template).toBe('高清放大');
    expect(out.controls).toEqual({ steps: 30 });
    expect('evil' in out).toBe(false);
    const out2 = sanitizeNodeParams('comfy', { template: 'x', controls: [1, 2] });
    expect('controls' in out2).toBe(false);
  });
});

describe('layoutBlueprint', () => {
  const nodes: BlueprintNode[] = [
    { id: 'n1', kind: 'prompt', params: {} },
    { id: 'n2', kind: 'work', params: {} },
    { id: 'n3', kind: 'result', params: {} }
  ];
  const edges: BlueprintEdge[] = [
    { from: 'n1', to: 'n2' },
    { from: 'n2', to: 'n3' }
  ];
  it('链式拓扑：上游在左、下游在右', () => {
    const pos = layoutBlueprint(nodes, edges, { x: 1000, y: 500 });
    expect(pos.get('n1')!.x).toBeLessThan(pos.get('n2')!.x);
    expect(pos.get('n2')!.x).toBeLessThan(pos.get('n3')!.x);
  });
  it('整簇以传入中心为锚（横向居中）', () => {
    const c = { x: 1000, y: 500 };
    const pos = layoutBlueprint(nodes, edges, c);
    const xs = [...pos.values()].map((p) => p.x);
    const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
    expect(mid).toBeCloseTo(c.x, 0);
  });
  it('无连线单节点也有坐标', () => {
    const p = layoutBlueprint([{ id: 'a', kind: 'image', params: {} }], [], { x: 0, y: 0 });
    expect(p.get('a')).toBeDefined();
  });
});

describe('matchComfyTemplate', () => {
  const tpls: AgentComfyTemplate[] = [
    { workflowId: 'w1', name: '高清放大', typeTags: ['upscale'], controls: [] },
    { workflowId: 'w2', name: '文生图', typeTags: ['text2image'], controls: [] }
  ];
  it('精确名 / 名称含 / 标签命中 / 空→首个 / 无匹配→null', () => {
    expect(matchComfyTemplate(tpls, '高清放大')?.workflowId).toBe('w1');
    expect(matchComfyTemplate(tpls, '放大')?.workflowId).toBe('w1');
    expect(matchComfyTemplate(tpls, 'upscale')?.workflowId).toBe('w1');
    expect(matchComfyTemplate(tpls, '')?.workflowId).toBe('w1');
    expect(matchComfyTemplate(tpls, '完全不存在')).toBeNull();
    expect(matchComfyTemplate([], 'x')).toBeNull();
  });
});

describe('resolveComfyControls', () => {
  const controls: InputControl[] = [
    { id: 'pos', label: '正向提示词', type: 'prompt', default: 'a' },
    { id: 'steps', label: 'Steps', type: 'number', default: 20, min: 1, max: 50 },
    { id: 'img', label: '输入图', type: 'image' },
    { id: 'sampler', label: 'Sampler', type: 'select', default: 'euler', options: [{ value: 'euler', label: 'Euler' }, { value: 'dpm', label: 'DPM++' }] }
  ];
  it('默认填底 + 按 id/label 设值 + 数字钳值 + 下拉项匹配 + 跳过图片控件 + 忽略未知键', () => {
    const cv = resolveComfyControls(controls, { Steps: 99, sampler: 'DPM++', 不存在: 1 });
    expect(cv.steps).toBe(50); // 钳到 max
    expect(cv.sampler).toBe('dpm'); // 按 label 匹配
    expect(cv.pos).toBe('a'); // 默认
    expect('img' in cv).toBe(false); // 图片控件跳过
    expect('不存在' in cv).toBe(false);
  });
  it('llmControls 为空时只填默认', () => {
    const cv = resolveComfyControls(controls, undefined);
    expect(cv).toEqual({ pos: 'a', steps: 20, sampler: 'euler' });
  });
});

describe('clampWorkForModel', () => {
  it('actualId 空时原样返回', () => {
    expect(clampWorkForModel({ aspect: '99:1' }, '')).toEqual({ aspect: '99:1' });
  });
  it('gpt-image-2：非法比例回退到该 family 支持的比例、n 钳到 maxN', () => {
    const out = clampWorkForModel({ aspect: '99:1', n: 9 }, 'gpt-image-2');
    const fam = detectFamily('gpt-image-2');
    expect(out.aspect).not.toBe('99:1');
    expect(fam.supportedAspects).toContain(out.aspect as string);
    expect(out.n as number).toBeLessThanOrEqual(fam.maxN);
  });
  it('nano-banana-flash 不支持 quality → 删除 quality', () => {
    const out = clampWorkForModel({ quality: 'high' }, 'nano-banana-flash');
    expect('quality' in out).toBe(false);
  });
});

describe('pickModelName', () => {
  const models: MappedModel[] = [
    { name: 'A', actualId: '', usable: false, providerName: 'p', label: 'p / A', ref: 'p / A' },
    { name: 'B', actualId: 'bb', usable: true, providerName: 'p', label: 'p / B', ref: 'p / B' }
  ];
  it('默认取首个可用', () => {
    expect(pickModelName(models)).toBe('B');
  });
  it('尊重可用的 override', () => {
    expect(pickModelName(models, 'B')).toBe('B');
  });
  it('override 不可用 → 退回首个可用', () => {
    expect(pickModelName(models, 'A')).toBe('B');
  });
  it('无可用模型 → 空串', () => {
    expect(pickModelName([])).toBe('');
  });

  // 同名不同中转站：模糊匹配（用户/LLM 说基础名或带中转站名都能命中正确那条）
  const relays: MappedModel[] = [
    { name: 'gpt-image-2（FHL）', actualId: 'gpt-image-2', usable: true, providerName: 'FHL', label: 'FHL / gpt-image-2（FHL）', ref: 'FHL / gpt-image-2（FHL）' },
    { name: 'gpt-image-2（Now Coding）', actualId: 'gpt-image-2', usable: true, providerName: 'Now Coding', label: 'Now Coding / gpt-image-2（Now Coding）', ref: 'Now Coding / gpt-image-2（Now Coding）' }
  ];
  it('基础名包含匹配（取首个含该名的）', () => {
    expect(pickModelName(relays, 'gpt-image-2')).toBe('gpt-image-2（FHL）');
  });
  it('带中转站名 → 词级全包含命中正确那条', () => {
    expect(pickModelName(relays, 'Now Coding gpt-image-2')).toBe('gpt-image-2（Now Coding）');
    expect(pickModelName(relays, 'FHL 的 gpt-image-2')).toBe('gpt-image-2（FHL）');
  });
  it('精确显示名优先', () => {
    expect(pickModelName(relays, 'gpt-image-2（Now Coding）')).toBe('gpt-image-2（Now Coding）');
  });
  it('完全匹配不到 → 退回首个可用', () => {
    expect(pickModelName(relays, 'flux-pro')).toBe('gpt-image-2（FHL）');
  });
});
