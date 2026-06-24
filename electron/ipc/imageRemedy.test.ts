import { describe, it, expect } from 'vitest';
import { computeImageRemedy } from './imageRemedy';

describe('computeImageRemedy —— 失败信息 → 一键修复建议', () => {
  it('SSE 格式不被识别 → 加 {"stream": false}', () => {
    const r = computeImageRemedy('[parse] SSE 流结束但没识别出终态图（该中转站的图像流格式不被识别）', 'unity2 / gpt-image-2');
    expect(r?.bodyMerge).toEqual({ stream: false });
    expect(r?.modelId).toBe('unity2 / gpt-image-2');
    expect(r?.label).toContain('非流式');
  });

  it('response_format 被拒 → 加 {"response_format": null}', () => {
    expect(computeImageRemedy('400 Unknown parameter: response_format', 'm')?.bodyMerge).toEqual({ response_format: null });
    expect(computeImageRemedy('new_api_error bad_response_status_code', 'm')?.bodyMerge).toEqual({ response_format: null });
    expect(computeImageRemedy('UnsupportedParamsError', 'm')?.bodyMerge).toEqual({ response_format: null });
  });

  it('quality 枚举被拒 → 加 {"quality": null}', () => {
    const r = computeImageRemedy('Invalid option: expected one of auto|low|medium|high for quality', 'm');
    expect(r?.bodyMerge).toEqual({ quality: null });
  });

  it('无匹配 / 缺参 → undefined', () => {
    expect(computeImageRemedy('随便一个不认识的错误', 'm')).toBeUndefined();
    expect(computeImageRemedy('', 'm')).toBeUndefined();
    expect(computeImageRemedy('SSE 没识别出终态图', '')).toBeUndefined();
  });

  it('每条建议都带 label/detail/modelId（前端按钮可直接用）', () => {
    const r = computeImageRemedy('图像流格式不被识别', 'prov / x');
    expect(r?.label).toBeTruthy();
    expect(r?.detail).toBeTruthy();
    expect(r?.modelId).toBe('prov / x');
  });
});
