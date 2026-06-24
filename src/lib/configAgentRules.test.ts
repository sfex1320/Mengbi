import { describe, it, expect } from 'vitest';
import { classifyModelsDeterministic, buildConfigsFromPlan, guessImageKind } from './configAgentRules';
import type { ConfigPlan } from './configAgentPlan';

const CTX = {
  planId: 1,
  providerName: 'OpenModel',
  baseUrl: 'https://api.openmodel.ai/v1',
  apiKey: 'k',
  isOfficial: false,
  headerOverridesJson: null
};

describe('classifyModelsDeterministic — openmodel.ai（带 supported_protocols）', () => {
  const models = ['deepseek-v4-flash', 'claude-opus-4-8', 'gemini-3.5-flash', 'gpt-5.4', '1024-x-1024/gpt-image-1.5'];
  const protos: Record<string, string[]> = {
    'deepseek-v4-flash': ['messages'],
    'claude-opus-4-8': ['messages'],
    'gemini-3.5-flash': ['gemini'],
    'gpt-5.4': ['responses'],
    '1024-x-1024/gpt-image-1.5': ['images']
  };
  const plan = classifyModelsDeterministic(models, protos, 'https://api.openmodel.ai/v1');
  const byId = (id: string) => plan.models.find((m) => m.actualId === id)!;

  it('messages → 对话 anthropic', () => {
    expect(byId('deepseek-v4-flash')).toMatchObject({ type: 'text', official_kind: 'anthropic' });
    expect(byId('claude-opus-4-8').type).toBe('text');
  });
  it('gemini / responses → skip（梦笔暂不支持原生协议）', () => {
    expect(byId('gemini-3.5-flash').type).toBe('skip');
    expect(byId('gpt-5.4').type).toBe('skip');
  });
  it('images → 绘画', () => {
    expect(byId('1024-x-1024/gpt-image-1.5').type).toBe('image');
  });
});

describe('classifyModelsDeterministic — 无协议声明（按名 + URL）', () => {
  it('apimart 绘画/视频按 url，对话兜底', () => {
    const plan = classifyModelsDeterministic(['flux-dev', 'doubao-seedance-2.0', 'deepseek-chat'], undefined, 'https://api.apimart.ai/v1');
    const get = (id: string) => plan.models.find((m) => m.actualId === id)!;
    expect(get('flux-dev')).toMatchObject({ type: 'image', image_kind: 'apimart' });
    expect(get('doubao-seedance-2.0')).toMatchObject({ type: 'video', video_kind: 'seedance' });
    expect(get('deepseek-chat').type).toBe('text');
  });
  it('embedding → skip', () => {
    const plan = classifyModelsDeterministic(['text-embedding-3-large'], undefined, 'https://x.com/v1');
    expect(plan.models[0].type).toBe('skip');
  });
});

describe('guessImageKind', () => {
  it('grsai / openai / 其它中转', () => {
    expect(guessImageKind('https://grsai.dakka.com.cn')).toBe('grsai');
    expect(guessImageKind('https://api.openai.com/v1')).toBe('openai');
    expect(guessImageKind('https://relay.example.com/v1')).toBe('openai-compat');
  });
});

describe('buildConfigsFromPlan', () => {
  const plan: ConfigPlan = {
    summary: '',
    models: [
      { actualId: 'deepseek-v4-flash', type: 'text', displayName: 'deepseek-v4-flash', official_kind: 'anthropic' },
      { actualId: 'claude-opus-4-8', type: 'text', displayName: 'claude-opus-4-8', official_kind: 'anthropic' },
      { actualId: 'gpt-image', type: 'image', displayName: 'gpt-image', image_kind: 'openai' },
      { actualId: 'gpt-5.4', type: 'skip', displayName: 'gpt-5.4', reason: 'unsupported' }
    ]
  };
  const { configs, skipped } = buildConfigsFromPlan(plan, CTX);

  it('归并成 2 张卡（对话+绘画），skip 不进卡', () => {
    expect(configs.length).toBe(2);
    expect(skipped.length).toBe(1);
    const text = configs.find((c) => c.type === 'text')!;
    expect(Object.keys(text.model_mapping).length).toBe(2);
    expect(text.official_kind).toBe('anthropic');
    const img = configs.find((c) => c.type === 'image')!;
    expect(img.image_kind).toBe('openai');
  });

  it('继承 ctx 的方案/地址/Key/header', () => {
    const text = configs.find((c) => c.type === 'text')!;
    expect(text.plan_id).toBe(1);
    expect(text.base_url).toBe('https://api.openmodel.ai/v1');
    expect(text.api_key_plain).toBe('k');
    expect(text.header_overrides_json).toBeNull();
  });

  it('对话块能力由 detectModelCapabilities 补（gpt-4o → vision）', () => {
    const p: ConfigPlan = { summary: '', models: [{ actualId: 'gpt-4o', type: 'text', displayName: 'gpt-4o' }] };
    const text = buildConfigsFromPlan(p, CTX).configs[0];
    expect(text.supports_vision).toBe(true);
  });

  it('mapping displayName 去重', () => {
    const dup: ConfigPlan = {
      summary: '',
      models: [
        { actualId: 'a', type: 'text', displayName: 'X' },
        { actualId: 'b', type: 'text', displayName: 'X' }
      ]
    };
    const t = buildConfigsFromPlan(dup, CTX).configs[0];
    expect(Object.keys(t.model_mapping).sort()).toEqual(['X', 'X (2)']);
  });

  it('全 skip → 0 张卡', () => {
    const allSkip: ConfigPlan = { summary: '', models: [{ actualId: 'e', type: 'skip', displayName: 'e' }] };
    const r = buildConfigsFromPlan(allSkip, CTX);
    expect(r.configs.length).toBe(0);
    expect(r.skipped.length).toBe(1);
  });
});
