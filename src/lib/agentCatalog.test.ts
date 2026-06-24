import { describe, it, expect } from 'vitest';
import { CATALOG, ALL_AGENT_KINDS, isNodeKind, consumeKinds, produceKinds, buildAgentSystemPrompt } from './agentCatalog';

describe('agentCatalog 完整性', () => {
  it('覆盖全部 27 类节点', () => {
    expect(ALL_AGENT_KINDS).toHaveLength(27);
    expect(isNodeKind('work')).toBe(true);
    expect(isNodeKind('nonsense')).toBe(false);
    expect(isNodeKind(123)).toBe(false);
  });
  it('每个条目有 label / purpose / tier；params 的 key/desc 非空', () => {
    for (const k of ALL_AGENT_KINDS) {
      const e = CATALOG[k];
      expect(e.label).toBeTruthy();
      expect(e.purpose).toBeTruthy();
      expect(['core', 'extended']).toContain(e.tier);
      for (const p of e.params) {
        expect(p.key).toBeTruthy();
        expect(p.desc).toBeTruthy();
      }
    }
  });
  it('needsModel 的节点声明合法模型类型', () => {
    for (const k of ALL_AGENT_KINDS) {
      const nm = CATALOG[k].needsModel;
      if (nm) expect(['image', 'text', 'video']).toContain(nm);
    }
    expect(CATALOG.work.needsModel).toBe('image');
    expect(CATALOG.llm.needsModel).toBe('text');
    expect(CATALOG.video.needsModel).toBe('video');
  });
});

describe('连线推导（与 canvasConnectRules 单一真相一致）', () => {
  it('prompt 能输出到 work（生图）', () => {
    expect(produceKinds('prompt')).toContain('work');
  });
  it('work 能接收 prompt', () => {
    expect(consumeKinds('work')).toContain('prompt');
  });
  it('image 能输出到 work / 图像反推 / 对比，但不能到 prompt', () => {
    const p = produceKinds('image');
    expect(p).toContain('work');
    expect(p).toContain('image-reverse');
    expect(p).toContain('compare');
    expect(p).not.toContain('prompt');
  });
  it('result 节点可接收 work 的输出', () => {
    expect(consumeKinds('result')).toContain('work');
  });
  it('ratio（尺寸）只输出到 生图 / ComfyUI / 视频 / 结果', () => {
    expect(produceKinds('ratio').sort()).toEqual(['comfy', 'result', 'video', 'work'].sort());
  });
});

describe('buildAgentSystemPrompt', () => {
  it('含核心节点 / 输出格式 / 模型清单 / 规则段', () => {
    const sys = buildAgentSystemPrompt({
      imageModels: ['NanoBanana'],
      textModels: ['GPT'],
      videoModels: [],
      attachedCount: 1,
      selectedImageCount: 0,
      galleryAvailable: true
    });
    expect(sys).toContain('核心节点');
    expect(sys).toContain('进阶节点');
    expect(sys).toContain('imageBindings');
    expect(sys).toContain('summary');
    expect(sys).toContain('NanoBanana');
    expect(sys).toContain('上传 / 拖入：1 张');
  });
  it('未配置模型时显示占位', () => {
    const s2 = buildAgentSystemPrompt({
      imageModels: [],
      textModels: [],
      videoModels: [],
      attachedCount: 0,
      selectedImageCount: 0,
      galleryAvailable: false
    });
    expect(s2).toContain('（未配置）');
  });
  it('渲染 ComfyUI 模板段（有模板列名称 / 无模板给占位）', () => {
    const withT = buildAgentSystemPrompt({
      imageModels: [],
      textModels: ['t'],
      videoModels: [],
      attachedCount: 0,
      selectedImageCount: 0,
      galleryAvailable: false,
      comfyTemplates: [{ name: '高清放大', controls: [{ label: 'Steps', type: 'number' }] }]
    });
    expect(withT).toContain('可用 ComfyUI 模板');
    expect(withT).toContain('高清放大');
    const without = buildAgentSystemPrompt({
      imageModels: [],
      textModels: ['t'],
      videoModels: [],
      attachedCount: 0,
      selectedImageCount: 0,
      galleryAvailable: false
    });
    expect(without).toContain('无可用 ComfyUI 模板');
  });
});
