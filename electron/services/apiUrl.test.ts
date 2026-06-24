import { describe, it, expect } from 'vitest';
import { joinApiUrl, httpStatusHint } from './apiUrl';

describe('joinApiUrl', () => {
  it('base 带 /v1 → 直接拼', () => {
    expect(joinApiUrl('https://api.openai.com/v1', 'chat/completions')).toBe(
      'https://api.openai.com/v1/chat/completions'
    );
  });

  it('base 不带 /v1 → 自动补', () => {
    expect(joinApiUrl('https://api.openai.com', 'chat/completions')).toBe(
      'https://api.openai.com/v1/chat/completions'
    );
  });

  it('base 带尾斜杠 → 去重', () => {
    expect(joinApiUrl('https://x.com/v1/', 'chat/completions')).toBe('https://x.com/v1/chat/completions');
    expect(joinApiUrl('https://x.com///', 'models')).toBe('https://x.com/v1/models');
  });

  it('中转站 /api/v1 形态', () => {
    expect(joinApiUrl('https://relay.com/api/v1', 'chat/completions')).toBe(
      'https://relay.com/api/v1/chat/completions'
    );
  });

  it('用户把整条 endpoint 粘进 base_url → 原样返回不重复拼', () => {
    expect(joinApiUrl('https://x.com/v1/chat/completions', 'chat/completions')).toBe(
      'https://x.com/v1/chat/completions'
    );
    expect(joinApiUrl('https://x.com/v1/chat/completions/', 'chat/completions')).toBe(
      'https://x.com/v1/chat/completions'
    );
    // 大小写不敏感
    expect(joinApiUrl('https://x.com/v1/Chat/Completions', 'chat/completions')).toBe(
      'https://x.com/v1/Chat/Completions'
    );
  });

  it('suffix 自带 v1/ 且 base 以 /v1 结尾 → 防双 /v1', () => {
    expect(joinApiUrl('https://x.com/v1', 'v1/chat/completions')).toBe('https://x.com/v1/chat/completions');
  });

  it('suffix 自带 v1/ 而 base 不带版本段 → 不重复补 /v1', () => {
    expect(joinApiUrl('https://x.com', 'v1/chat/completions')).toBe('https://x.com/v1/chat/completions');
  });
});

describe('httpStatusHint', () => {
  it('401 → Key 提示', () => {
    expect(httpStatusHint(401)).toContain('API Key');
  });
  it('403 → 权限/欠费提示', () => {
    expect(httpStatusHint(403)).toContain('权限');
  });
  it('404 → base_url /v1 提示', () => {
    expect(httpStatusHint(404)).toContain('/v1');
  });
  it('429 → 限流提示', () => {
    expect(httpStatusHint(429)).toContain('限流');
  });
  it('5xx → 上游故障提示', () => {
    expect(httpStatusHint(500)).toContain('上游');
    expect(httpStatusHint(503)).toContain('上游');
  });
  it('400 → 模型映射提示', () => {
    expect(httpStatusHint(400)).toContain('模型');
  });
  it('其它 → 通用提示', () => {
    expect(httpStatusHint(418)).toContain('base_url');
  });
});
