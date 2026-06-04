import { describe, it, expect } from 'vitest';
import { detectFamily, getFamilyById, FAMILIES } from './imageModelFamilies';

describe('detectFamily', () => {
  it('识别 gpt-image-2', () => {
    expect(detectFamily('gpt-image-2').id).toBe('gpt-image-2');
    expect(detectFamily('GPT_Image_2').id).toBe('gpt-image-2');
    expect(detectFamily('my-gptimage2-alias').id).toBe('gpt-image-2');
  });

  it('识别 nano-banana 三档（pro / flash / 2），且优先级正确', () => {
    expect(detectFamily('nano-banana-pro').id).toBe('nano-banana-pro');
    expect(detectFamily('nano-banana-flash').id).toBe('nano-banana-flash');
    // 带版本号的 flash 也要落到 flash，而不是 nano-banana-2
    expect(detectFamily('nano-banana-2.5-flash').id).toBe('nano-banana-flash');
    expect(detectFamily('nano-banana-2').id).toBe('nano-banana-2');
    expect(detectFamily('nano-banana-2.5').id).toBe('nano-banana-2');
    // 裸 nano-banana 落到标准款（非 pro/flash）
    expect(detectFamily('nano-banana').id).toBe('nano-banana-2');
  });

  it('未知模型兜底到 default', () => {
    expect(detectFamily('flux-1-dev').id).toBe('default');
    expect(detectFamily('').id).toBe('default');
  });
});

describe('getFamilyById', () => {
  it('按 id 取到对应 manifest，未知 id 兜底 default', () => {
    expect(getFamilyById('gpt-image-2').id).toBe('gpt-image-2');
    expect(getFamilyById('nano-banana-2').id).toBe('nano-banana-2');
    // @ts-expect-error 故意传非法 id
    expect(getFamilyById('not-a-family').id).toBe('default');
  });

  it('FAMILIES 暴露全部 5 个 family（含 default）', () => {
    const ids = FAMILIES.map((f) => f.id).sort();
    expect(ids).toEqual(
      ['default', 'gpt-image-2', 'nano-banana-2', 'nano-banana-flash', 'nano-banana-pro'].sort()
    );
  });
});

describe('GPT Image 2 buildBody —— 用 size=WxH，按像素预算反推', () => {
  const fam = getFamilyById('gpt-image-2');

  it('1:1 + 4K → 接近 8.3MP 的 size（绝不退化成 1024）', () => {
    const body = fam.buildBody({ modelId: 'gpt-image-2', prompt: 'x', params: { image_size: '4K', aspect: '1:1' } });
    expect(body.size).toBe('2880x2880'); // sqrt(8.3MP) ≈ 2880，snap 到 16
    // GPT Image 2 只发 size，不发 aspect_ratio / image_size，避免与 size 冲突
    expect(body.aspect_ratio).toBeUndefined();
    expect(body.image_size).toBeUndefined();
    expect(body.response_format).toBe('b64_json');
  });

  it('size 的总像素不超 8.3MP 预算', () => {
    const body = fam.buildBody({ modelId: 'gpt-image-2', prompt: 'x', params: { image_size: '4K', aspect: '16:9' } }) as {
      size: string;
    };
    const [w, h] = body.size.split('x').map(Number);
    expect(w * h).toBeLessThanOrEqual(8_294_400);
    expect(w / h).toBeCloseTo(16 / 9, 1);
  });

  it('quality 只在合法枚举时透传', () => {
    const ok = fam.buildBody({ modelId: 'gpt-image-2', prompt: 'x', params: { aspect: '1:1', quality: 'high' } });
    expect(ok.quality).toBe('high');
    const bad = fam.buildBody({ modelId: 'gpt-image-2', prompt: 'x', params: { aspect: '1:1', quality: 'ultra' } });
    expect(bad.quality).toBeUndefined();
  });
});

describe('Nano Banana buildBody —— 用 image_size 字面量，模型自己出真分辨率', () => {
  it('nano-banana-2 + 4K → image_size="4K" 字面量（这正是「点 4K 出 1K」的修复点）', () => {
    const fam = getFamilyById('nano-banana-2');
    const body = fam.buildBody({ modelId: 'nano-banana-2', prompt: 'x', params: { image_size: '4K', aspect: '16:9' } });
    expect(body.image_size).toBe('4K');
    expect(body.aspect_ratio).toBe('16:9');
    // 标准款不发 quality，也不发 size（不替模型算 WxH）
    expect(body.quality).toBeUndefined();
    expect(body.size).toBeUndefined();
  });

  it('aspect="auto" 时不发 aspect_ratio', () => {
    const fam = getFamilyById('nano-banana-2');
    const body = fam.buildBody({ modelId: 'nano-banana-2', prompt: 'x', params: { image_size: '2K', aspect: 'auto' } });
    expect(body.aspect_ratio).toBeUndefined();
    expect(body.image_size).toBe('2K');
  });

  it('negativePrompt 透传到 negative_prompt（去空白）', () => {
    const fam = getFamilyById('nano-banana-2');
    const body = fam.buildBody({
      modelId: 'nano-banana-2',
      prompt: 'x',
      negativePrompt: '  低质量  ',
      params: { image_size: '1K' }
    });
    expect(body.negative_prompt).toBe('低质量');
  });

  it('非法 image_size 不发该字段', () => {
    const fam = getFamilyById('nano-banana-2');
    const body = fam.buildBody({ modelId: 'nano-banana-2', prompt: 'x', params: { image_size: '8K', aspect: '1:1' } });
    expect(body.image_size).toBeUndefined();
  });
});

describe('default family —— size + aspect_ratio + image_size 都尝试发', () => {
  const fam = getFamilyById('default');
  it('同时带 size 与 aspect_ratio 与 image_size，让上游中转挑', () => {
    const body = fam.buildBody({ modelId: 'whatever', prompt: 'x', params: { image_size: '2K', aspect: '4:3' } });
    expect(typeof body.size).toBe('string');
    expect(body.aspect_ratio).toBe('4:3');
    expect(body.image_size).toBe('2K');
  });
});
