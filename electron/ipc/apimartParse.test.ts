import { describe, it, expect } from 'vitest';
import {
  apimartCode,
  extractApimartSubmit,
  extractApimartStatus,
  isApimartDone,
  isApimartFailed,
  extractApimartError,
  extractApimartImageUrls,
  resolveApimartStatusUrl
} from './apimartParse';

describe('extractApimartSubmit —— 提交响应抽 task_id / status_url', () => {
  it('官方形态：data[0].task_id', () => {
    const r = extractApimartSubmit({ code: 200, data: [{ status: 'submitted', task_id: 'task_01ABC' }] });
    expect(r.taskId).toBe('task_01ABC');
    expect(r.statusUrl).toBeUndefined();
  });

  it('新版 async-generations：task_id + status_url 在顶层（实测 bug 场景）', () => {
    const r = extractApimartSubmit({
      created: 1781735245,
      job_id: 'img_46f21b99c463343e284d98bc424410b2',
      status: 'pending',
      status_url: '/v1/images/async-generations/img_46f21b99c463343e284d98bc424410b2',
      task_id: 'img_46f21b99c463343e284d98bc424410b2'
    });
    expect(r.taskId).toBe('img_46f21b99c463343e284d98bc424410b2');
    expect(r.statusUrl).toBe('/v1/images/async-generations/img_46f21b99c463343e284d98bc424410b2');
  });

  it('只给 job_id（无 task_id）也能抽到', () => {
    expect(extractApimartSubmit({ job_id: 'img_x', status_url: '/p/img_x' })).toEqual({
      taskId: 'img_x',
      statusUrl: '/p/img_x'
    });
  });

  it('data 为对象形态', () => {
    expect(extractApimartSubmit({ data: { task_id: 'task_y' } }).taskId).toBe('task_y');
  });

  it('无任何 id → undefined', () => {
    expect(extractApimartSubmit({ created: 1 }).taskId).toBeUndefined();
    expect(extractApimartSubmit('nope').taskId).toBeUndefined();
  });
});

describe('apimartCode', () => {
  it('读 code；缺省 undefined（不拦新版无 code 形态）', () => {
    expect(apimartCode({ code: 200 })).toBe(200);
    expect(apimartCode({ code: 500 })).toBe(500);
    expect(apimartCode({ status: 'pending' })).toBeUndefined();
  });
});

describe('extractApimartStatus / done / failed', () => {
  it('data.status 优先，其次顶层 status，小写归一', () => {
    expect(extractApimartStatus({ data: { status: 'COMPLETED' } })).toBe('completed');
    expect(extractApimartStatus({ status: 'Pending' })).toBe('pending');
    expect(extractApimartStatus({})).toBe('');
  });
  it('done / failed 状态集合（兼容 completed/succeeded/success 与 failed/error/cancelled）', () => {
    expect(isApimartDone('completed')).toBe(true);
    expect(isApimartDone('succeeded')).toBe(true);
    expect(isApimartDone('success')).toBe(true);
    expect(isApimartDone('processing')).toBe(false);
    expect(isApimartFailed('failed')).toBe(true);
    expect(isApimartFailed('error')).toBe(true);
    expect(isApimartFailed('cancelled')).toBe(true);
    expect(isApimartFailed('pending')).toBe(false);
  });
});

describe('extractApimartError', () => {
  it('data.error / 顶层 error / message', () => {
    expect(extractApimartError({ data: { error: '内容审核' } })).toBe('内容审核');
    expect(extractApimartError({ message: '坏了' })).toBe('坏了');
    expect(extractApimartError({})).toBeUndefined();
  });
});

describe('extractApimartImageUrls —— 多形态抽图片 URL', () => {
  it('官方：data.result.images[].url[]（url 是数组）', () => {
    const json = {
      code: 200,
      data: { status: 'completed', result: { images: [{ url: ['https://u.apimart.ai/a.png'] }] } }
    };
    expect(extractApimartImageUrls(json)).toEqual(['https://u.apimart.ai/a.png']);
  });

  it('顶层 result.images[].url[]（新版可能不带 data 包裹）', () => {
    const json = { status: 'completed', result: { images: [{ url: ['https://u/b.png'] }, { url: ['https://u/c.png'] }] } };
    expect(extractApimartImageUrls(json)).toEqual(['https://u/b.png', 'https://u/c.png']);
  });

  it('OpenAI 风格 data:[{url}]', () => {
    expect(extractApimartImageUrls({ status: 'succeeded', data: [{ url: 'https://u/d.png' }] })).toEqual([
      'https://u/d.png'
    ]);
  });

  it('output 数组（裸串 / 带 url）+ images url 为字符串 + 顶层 url', () => {
    expect(extractApimartImageUrls({ output: ['https://u/e.png'] })).toEqual(['https://u/e.png']);
    expect(extractApimartImageUrls({ images: [{ url: 'https://u/f.png' }] })).toEqual(['https://u/f.png']);
    expect(extractApimartImageUrls({ url: 'https://u/g.png' })).toEqual(['https://u/g.png']);
  });

  it('去重 + 只收 http(s)（过滤掉 b64/相对路径）', () => {
    const json = {
      data: { result: { images: [{ url: ['https://u/h.png', 'https://u/h.png'] }] } },
      url: 'data:image/png;base64,xxxx'
    };
    expect(extractApimartImageUrls(json)).toEqual(['https://u/h.png']);
  });

  it('没图返回空数组', () => {
    expect(extractApimartImageUrls({ status: 'processing' })).toEqual([]);
  });
});

describe('resolveApimartStatusUrl —— 相对 status_url 挂到 origin，避免双 /v1', () => {
  it('base 含 /v1 + status_url 含 /v1 → 用 origin 拼，不双 /v1', () => {
    expect(
      resolveApimartStatusUrl('https://api.apimart.ai/v1', '/v1/images/async-generations/img_x')
    ).toBe('https://api.apimart.ai/v1/images/async-generations/img_x');
  });

  it('已是绝对地址原样返回', () => {
    expect(resolveApimartStatusUrl('https://api.apimart.ai/v1', 'https://other.host/poll/1')).toBe(
      'https://other.host/poll/1'
    );
  });

  it('status_url 不带前导斜杠也能拼', () => {
    expect(resolveApimartStatusUrl('https://h.ai/v1', 'p/123')).toBe('https://h.ai/p/123');
  });
});
