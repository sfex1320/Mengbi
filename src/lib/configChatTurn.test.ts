import { describe, it, expect } from 'vitest';
import {
  parseConfigChatTurn,
  extractConfigFromText,
  mergeFields,
  missingFields,
  isReady,
  deriveNameFromUrl,
  templatedReply
} from './configChatTurn';

describe('parseConfigChatTurn', () => {
  it('正常 JSON', () => {
    const r = parseConfigChatTurn('{"reply":"还差 Key","fields":{"baseUrl":"https://api.x.ai/v1"},"ready":false,"missing":["API Key"]}');
    expect(r.ok).toBe(true);
    expect(r.turn?.reply).toBe('还差 Key');
    expect(r.turn?.fields.baseUrl).toBe('https://api.x.ai/v1');
    expect(r.turn?.ready).toBe(false);
    expect(r.turn?.missing).toEqual(['API Key']);
  });
  it('```json 围栏 + 空字段不进 fields', () => {
    const r = parseConfigChatTurn('```json\n{"reply":"ok","fields":{"name":"","apiKey":"sk-abc"},"ready":true}\n```');
    expect(r.turn?.fields.name).toBeUndefined();
    expect(r.turn?.fields.apiKey).toBe('sk-abc');
    expect(r.turn?.ready).toBe(true);
  });
  it('垃圾 / 非对象 → ok:false', () => {
    expect(parseConfigChatTurn('hi there').ok).toBe(false);
    expect(parseConfigChatTurn('').ok).toBe(false);
    expect(parseConfigChatTurn('[]').ok).toBe(false);
  });
});

describe('extractConfigFromText', () => {
  it('地址 + sk- Key', () => {
    const f = extractConfigFromText('地址 https://api.openmodel.ai/v1 我的key是 sk-AbC123def456ghi789');
    expect(f.baseUrl).toBe('https://api.openmodel.ai/v1');
    expect(f.apiKey).toBe('sk-AbC123def456ghi789');
  });
  it('om- 前缀 Key', () => {
    const f = extractConfigFromText('https://api.openmodel.ai/v1 om-5gG4hh5bmHic2kJdFZPVSjxYytWMZWV5');
    expect(f.apiKey).toBe('om-5gG4hh5bmHic2kJdFZPVSjxYytWMZWV5');
  });
  it('地址尾随中文标点被剥离', () => {
    const f = extractConfigFromText('地址是 https://api.x.com/v1。');
    expect(f.baseUrl).toBe('https://api.x.com/v1');
  });
  it('无前缀长 token 当 Key（且不误把地址当 Key）', () => {
    const f = extractConfigFromText('https://api.x.com/v1 然后 ABCDEFGHIJKLMNOPQRSTUVWX1234');
    expect(f.baseUrl).toBe('https://api.x.com/v1');
    expect(f.apiKey).toBe('ABCDEFGHIJKLMNOPQRSTUVWX1234');
  });
  it('只有地址 → 无 Key', () => {
    const f = extractConfigFromText('https://api.x.com/v1');
    expect(f.apiKey).toBeUndefined();
  });
});

describe('mergeFields', () => {
  it('非空覆盖，空不覆盖', () => {
    const out = mergeFields({ baseUrl: 'a', apiKey: 'k1' }, { apiKey: 'k2', name: '  ' });
    expect(out).toEqual({ baseUrl: 'a', apiKey: 'k2' });
  });
});

describe('missingFields / isReady', () => {
  it('缺地址和 Key', () => {
    expect(missingFields({})).toEqual(['API 地址', 'API Key']);
    expect(isReady({})).toBe(false);
  });
  it('齐了（名称不必填）', () => {
    expect(missingFields({ baseUrl: 'a', apiKey: 'k' })).toEqual([]);
    expect(isReady({ baseUrl: 'a', apiKey: 'k' })).toBe(true);
  });
});

describe('deriveNameFromUrl', () => {
  it('api.openmodel.ai → Openmodel', () => {
    expect(deriveNameFromUrl('https://api.openmodel.ai/v1')).toBe('Openmodel');
  });
  it('坏 URL → 中转站', () => {
    expect(deriveNameFromUrl('not a url')).toBe('中转站');
  });
});

describe('templatedReply', () => {
  it('齐了 → 开跑话术', () => {
    expect(templatedReply({ baseUrl: 'a', apiKey: 'k' }).reply).toContain('信息齐了');
  });
  it('缺 Key → 追问', () => {
    const r = templatedReply({ baseUrl: 'a' });
    expect(r.missing).toEqual(['API Key']);
    expect(r.reply).toContain('API Key');
  });
});
