import { describe, it, expect } from 'vitest';
import { protocolToOfficialKind } from './relayProtocol';

describe('protocolToOfficialKind', () => {
  it('messages → Anthropic（可用）', () => {
    const m = protocolToOfficialKind(['messages']);
    expect(m.kind).toBe('anthropic');
    expect(m.supported).toBe(true);
    expect(m.badge).toBe('messages');
  });

  it('anthropic 别名 → Anthropic', () => {
    expect(protocolToOfficialKind(['anthropic']).kind).toBe('anthropic');
  });

  it('responses → 不支持（无对话适配）', () => {
    const m = protocolToOfficialKind(['responses']);
    expect(m.kind).toBeNull();
    expect(m.supported).toBe(false);
    expect(m.reason).toMatch(/Responses/);
    expect(m.badge).toBe('responses');
  });

  it('gemini → gemini 但标记不支持原生对话', () => {
    const m = protocolToOfficialKind(['gemini']);
    expect(m.kind).toBe('gemini');
    expect(m.supported).toBe(false);
    expect(m.badge).toBe('gemini');
  });

  it('images → 非对话模型（不支持）', () => {
    const m = protocolToOfficialKind(['images']);
    expect(m.supported).toBe(false);
    expect(m.badge).toBe('images');
    expect(m.reason).toMatch(/绘图/);
  });

  it('messages 优先于 responses（混合声明）', () => {
    expect(protocolToOfficialKind(['responses', 'messages']).kind).toBe('anthropic');
  });

  it('含 chat 的普通声明 → openai-compat（可用）', () => {
    const m = protocolToOfficialKind(['chat']);
    expect(m.kind).toBe('openai-compat');
    expect(m.supported).toBe(true);
  });

  it('空数组 / undefined → 当作 openai-compat（兜底）', () => {
    expect(protocolToOfficialKind([]).kind).toBe('openai-compat');
    expect(protocolToOfficialKind([]).supported).toBe(true);
    expect(protocolToOfficialKind(undefined).kind).toBe('openai-compat');
  });

  it('大小写 / 连字符归一', () => {
    expect(protocolToOfficialKind([' Messages ']).kind).toBe('anthropic');
    expect(protocolToOfficialKind(['IMAGE']).supported).toBe(false);
  });
});
