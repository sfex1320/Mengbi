import { describe, it, expect } from 'vitest';
import { parseConfigPlan } from './configAgentPlan';

describe('parseConfigPlan', () => {
  it('正常 JSON', () => {
    const r = parseConfigPlan('{"summary":"ok","models":[{"actualId":"deepseek-v4-flash","type":"text","official_kind":"anthropic"}]}');
    expect(r.ok).toBe(true);
    expect(r.plan?.summary).toBe('ok');
    expect(r.plan?.models[0]).toMatchObject({ actualId: 'deepseek-v4-flash', type: 'text', official_kind: 'anthropic', displayName: 'deepseek-v4-flash' });
  });

  it('```json 围栏剥离', () => {
    const r = parseConfigPlan('```json\n{"models":[{"actualId":"x","type":"image","image_kind":"apimart"}]}\n```');
    expect(r.ok).toBe(true);
    expect(r.plan?.models[0]).toMatchObject({ type: 'image', image_kind: 'apimart' });
  });

  it('非法枚举 coerce 到 null', () => {
    const r = parseConfigPlan('{"models":[{"actualId":"x","type":"text","official_kind":"bogus"}]}');
    expect(r.plan?.models[0].official_kind).toBeNull();
  });

  it('未知 type → skip', () => {
    const r = parseConfigPlan('{"models":[{"actualId":"x","type":"weird"}]}');
    expect(r.plan?.models[0].type).toBe('skip');
  });

  it('缺 actualId 的项被丢弃', () => {
    const r = parseConfigPlan('{"models":[{"type":"text"},{"actualId":"y","type":"text"}]}');
    expect(r.plan?.models.length).toBe(1);
    expect(r.plan?.models[0].actualId).toBe('y');
  });

  it('跨字段清理：image 项不带 official_kind', () => {
    const r = parseConfigPlan('{"models":[{"actualId":"x","type":"image","official_kind":"anthropic","image_kind":"openai"}]}');
    expect(r.plan?.models[0].official_kind).toBeUndefined();
    expect(r.plan?.models[0].image_kind).toBe('openai');
  });

  it('video 枚举校验', () => {
    expect(parseConfigPlan('{"models":[{"actualId":"v","type":"video","video_kind":"seedance"}]}').plan?.models[0].video_kind).toBe('seedance');
    expect(parseConfigPlan('{"models":[{"actualId":"v","type":"video","video_kind":"nope"}]}').plan?.models[0].video_kind).toBeNull();
  });

  it('垃圾 / 缺 models / 顶层数组 → ok:false', () => {
    expect(parseConfigPlan('hello world').ok).toBe(false);
    expect(parseConfigPlan('').ok).toBe(false);
    expect(parseConfigPlan('{"summary":"x"}').ok).toBe(false);
    expect(parseConfigPlan('[]').ok).toBe(false);
    expect(parseConfigPlan('{"models":[]}').ok).toBe(false);
  });
});
