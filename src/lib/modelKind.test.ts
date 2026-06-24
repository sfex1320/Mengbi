import { describe, it, expect } from 'vitest';
import { modelKindOf, describeModelKind } from './modelKind';

describe('modelKindOf', () => {
  it('绘图模型', () => {
    for (const id of ['gpt-image-1.5', '1024-x-1024/gpt-image-1.5', 'dall-e-3', 'flux-dev', 'nano-banana-2', 'sora-image', 'sdxl-turbo', 'midjourney-v6'])
      expect(modelKindOf(id)).toBe('image');
  });
  it('视频模型', () => {
    for (const id of ['kling-v2', 'doubao-seedance-2.0', 'veo-3', 'runway-gen4', 'hailuo-02', 'wan-2.1', 'sora-video'])
      expect(modelKindOf(id)).toBe('video');
  });
  it('embedding / rerank / audio', () => {
    expect(modelKindOf('text-embedding-3-large')).toBe('embedding');
    expect(modelKindOf('bge-reranker-v2')).toBe('rerank');
    expect(modelKindOf('whisper-1')).toBe('audio');
    expect(modelKindOf('tts-1-hd')).toBe('audio');
  });
  it('对话兜底（含 vision / coder / 通用）', () => {
    for (const id of ['deepseek-v4-flash', 'claude-opus-4-8', 'gpt-5.4', 'qwen3-max', 'kimi-k2.5', 'gpt-4o', 'gpt-5.3-codex'])
      expect(modelKindOf(id)).toBe('chat');
  });
  it('绘图优先于视频（sora-image vs sora-video）', () => {
    expect(modelKindOf('sora-image-2')).toBe('image');
    expect(modelKindOf('sora-video-2')).toBe('video');
  });
  it('describeModelKind 给中文描述', () => {
    expect(describeModelKind('flux-dev')).toContain('绘图');
    expect(describeModelKind('deepseek-v4-flash')).toContain('对话');
  });
});
