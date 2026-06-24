import { describe, it, expect } from 'vitest';
import { joinUrl, fillTaskUrl, extractTaskId, extractVideoUrl, normalizeStatusState, statusRaw } from './adapter';

// 锁住按 APIMart 官方文档对账出来的请求/响应形态（提交 data[0].task_id、查询 GET /v1/tasks/{task_id}、
// 成功 data.result.videos[]、状态 data.status pending|processing|completed|failed|cancelled）。

describe('joinUrl 防双 /v1', () => {
  it('base 已含 /v1 且 endpoint 也以 /v1 开头 → 折叠成单个 /v1', () => {
    expect(joinUrl('https://api.apimart.ai/v1', '/v1/videos/generations')).toBe('https://api.apimart.ai/v1/videos/generations');
    expect(joinUrl('https://api.apimart.ai/v1/', '/v1/tasks/{task_id}')).toBe('https://api.apimart.ai/v1/tasks/{task_id}');
  });
  it('base 不含 /v1 → 正常补 /v1', () => {
    expect(joinUrl('https://api.apimart.ai', '/v1/videos/generations')).toBe('https://api.apimart.ai/v1/videos/generations');
  });
  it('非 /v1 开头的 endpoint 不被误删（runway）', () => {
    expect(joinUrl('https://api.apimart.ai/v1', '/runwayml/v1')).toBe('https://api.apimart.ai/v1/runwayml/v1');
  });
  it('空 endpoint → 返回去尾斜杠的 base（fal）', () => {
    expect(joinUrl('https://queue.fal.run/', '')).toBe('https://queue.fal.run');
  });
});

describe('extractTaskId', () => {
  it('读 APIMart 数组形态 data[0].task_id', () => {
    expect(extractTaskId({ code: 200, data: [{ status: 'submitted', task_id: 'task_01ABC' }] })).toBe('task_01ABC');
  });
  it('读对象形态 data.task_id', () => {
    expect(extractTaskId({ data: { task_id: 'x' } })).toBe('x');
  });
  it('读顶层 id', () => {
    expect(extractTaskId({ id: 'y' })).toBe('y');
  });
  it('缺失返回 undefined', () => {
    expect(extractTaskId({ code: 200, data: [{ status: 'submitted' }] })).toBeUndefined();
  });
});

describe('extractVideoUrl', () => {
  it('读 APIMart data.result.videos[0].url', () => {
    expect(extractVideoUrl({ data: { status: 'completed', result: { videos: [{ url: 'https://x/v.mp4' }] } } })).toBe('https://x/v.mp4');
  });
  it('读 kling data.task_result.videos[0].url', () => {
    expect(extractVideoUrl({ data: { task_result: { videos: [{ url: 'https://k/v.mp4' }] } } })).toBe('https://k/v.mp4');
  });
  it('读 runway output[0]', () => {
    expect(extractVideoUrl({ output: ['https://r/v.mp4'] })).toBe('https://r/v.mp4');
  });
});

describe('状态归一', () => {
  it('映射 APIMart 状态串', () => {
    expect(normalizeStatusState('completed')).toBe('succeeded');
    expect(normalizeStatusState('pending')).toBe('processing');
    expect(normalizeStatusState('processing')).toBe('processing');
    expect(normalizeStatusState('failed')).toBe('failed');
    expect(normalizeStatusState('cancelled')).toBe('failed');
  });
  it('statusRaw 读 data.status', () => {
    expect(statusRaw({ data: { status: 'processing' } })).toBe('processing');
  });
});

describe('fillTaskUrl', () => {
  it('替换 {task_id} 占位', () => {
    expect(fillTaskUrl('https://api.apimart.ai/v1/tasks/{task_id}', 'task_01ABC')).toBe('https://api.apimart.ai/v1/tasks/task_01ABC');
  });
});
