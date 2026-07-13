import { describe, it, expect } from 'vitest';
import {
  detectFamily,
  getFamilyById,
  FAMILIES,
  mapGptTierSize,
  sizeFromAspectAndBudget,
  isValidImage2Size,
  clampToImage2Size,
  nearestSupportedAspect
} from './imageModelFamilies';

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

  it('quality 只在合法枚举时透传（gpt-image 官方枚举 auto|low|medium|high）', () => {
    const ok = fam.buildBody({ modelId: 'gpt-image-2', prompt: 'x', params: { aspect: '1:1', quality: 'high' } });
    expect(ok.quality).toBe('high');
    const auto = fam.buildBody({ modelId: 'gpt-image-2', prompt: 'x', params: { aspect: '1:1', quality: 'auto' } });
    expect(auto.quality).toBe('auto');
    const bad = fam.buildBody({ modelId: 'gpt-image-2', prompt: 'x', params: { aspect: '1:1', quality: 'ultra' } });
    expect(bad.quality).toBeUndefined();
  });

  // 历史 bug：UI 的「标准」(standard) 是 DALL·E 3 词表，gpt-image 系列上游 400
  //（"Invalid option: expected one of auto|low|medium|high"，失败仍可能计费）→ 必须映射 medium
  it('quality=standard → 映射到 medium（防上游 400 烧钱）', () => {
    const body = fam.buildBody({ modelId: 'gpt-image-2', prompt: 'x', params: { aspect: '1:1', quality: 'standard' } });
    expect(body.quality).toBe('medium');
  });

  // 1K/2K 历史 bug：预算反推出的任意 WxH（如 1248×832）在不少中转站被拒 → 改映射到安全枚举尺寸
  it('1K + 1:1 → 1024x1024（枚举，不再预算反推）', () => {
    const body = fam.buildBody({ modelId: 'gpt-image-2', prompt: 'x', params: { image_size: '1K', aspect: '1:1' } });
    expect(body.size).toBe('1024x1024');
  });

  it('1K + 16:9 → 1536x1024（吸附到最近枚举横版）；9:16 → 1024x1536', () => {
    const h = fam.buildBody({ modelId: 'gpt-image-2', prompt: 'x', params: { image_size: '1K', aspect: '16:9' } });
    expect(h.size).toBe('1536x1024');
    const v = fam.buildBody({ modelId: 'gpt-image-2', prompt: 'x', params: { image_size: '1K', aspect: '9:16' } });
    expect(v.size).toBe('1024x1536');
  });

  it('2K + 1:1 → 2048x2048；2K + 16:9 → 2048x1152', () => {
    const sq = fam.buildBody({ modelId: 'gpt-image-2', prompt: 'x', params: { image_size: '2K', aspect: '1:1' } });
    expect(sq.size).toBe('2048x2048');
    const wide = fam.buildBody({ modelId: 'gpt-image-2', prompt: 'x', params: { image_size: '2K', aspect: '16:9' } });
    expect(wide.size).toBe('2048x1152');
  });

  it('1K/2K 但用户给了精确宽高 → 精确值优先（尺寸来源节点）', () => {
    const body = fam.buildBody({
      modelId: 'gpt-image-2',
      prompt: 'x',
      params: { image_size: '1K', width: 1280, height: 768 }
    });
    expect(body.size).toBe('1280x768');
  });

  it('4K 不回归：仍按 8.3MP 预算反推', () => {
    const body = fam.buildBody({ modelId: 'gpt-image-2', prompt: 'x', params: { image_size: '4K', aspect: '1:1' } });
    expect(body.size).toBe('2880x2880');
  });

  // 有些中转站（如 Now Coding）把「分辨率」实际挂在 quality 上：不带 quality → 降级 ~1K 并无视 size。
  // 用户没显式选 quality 时按档位补一个，让「分辨率档位」对这类中转站也生效。
  it('档位自动带 quality（用户未显式选时）：4K→high / 2K→medium / 1K→low', () => {
    expect(fam.buildBody({ modelId: 'gpt-image-2', prompt: 'x', params: { image_size: '4K', aspect: '1:1' } }).quality).toBe('high');
    expect(fam.buildBody({ modelId: 'gpt-image-2', prompt: 'x', params: { image_size: '2K', aspect: '1:1' } }).quality).toBe('medium');
    expect(fam.buildBody({ modelId: 'gpt-image-2', prompt: 'x', params: { image_size: '1K', aspect: '1:1' } }).quality).toBe('low');
  });

  it('用户显式选了 quality 时不被档位覆盖；「默认」(空) 永不发空 quality（无档位→auto）', () => {
    // 4K 档但用户手动选 low → 尊重用户
    expect(
      fam.buildBody({ modelId: 'gpt-image-2', prompt: 'x', params: { image_size: '4K', aspect: '1:1', quality: 'low' } }).quality
    ).toBe('low');
    // 没选档位 + 默认质量 → auto（绝不发"空 quality"，否则部分中转站会降级到 ~1K）
    expect(fam.buildBody({ modelId: 'gpt-image-2', prompt: 'x', params: { aspect: '1:1' } }).quality).toBe('auto');
  });

  it('启用 SSE 流式（partial_image 心跳，穿透中转 60s 边缘超时）', () => {
    // 没有它，4K/高质量出图常 >60s 被中转站硬切连接（net::ERR_CONNECTION_CLOSED）。
    expect(fam.streaming?.partialImages).toBeGreaterThanOrEqual(1);
  });

  it('4K 极端比例单边 ≤3840（修 Now Coding「Invalid image size」400），仍 16 倍数且 ≤8.3MP', () => {
    for (const aspect of ['3:1', '1:3', '21:9', '9:21', '2:1', '1:2']) {
      const body = fam.buildBody({ modelId: 'gpt-image-2', prompt: 'x', params: { image_size: '4K', aspect } }) as { size: string };
      const [w, h] = body.size.split('x').map(Number);
      expect(Math.max(w, h)).toBeLessThanOrEqual(3840);
      expect(w * h).toBeLessThanOrEqual(8_294_400);
      expect(w % 16).toBe(0);
      expect(h % 16).toBe(0);
    }
  });
});

describe('mapGptTierSize —— 1K/2K 枚举尺寸映射纯函数', () => {
  it('1K：方/横/竖 三方向', () => {
    expect(mapGptTierSize('1K', '1:1')).toEqual({ w: 1024, h: 1024, exact: true });
    expect(mapGptTierSize('1K', '3:2')).toEqual({ w: 1536, h: 1024, exact: true });
    expect(mapGptTierSize('1K', '2:3')).toEqual({ w: 1024, h: 1536, exact: true });
  });

  it('1K + 16:9 → 吸附 1536x1024（exact=false，前端提示实际尺寸）', () => {
    const r = mapGptTierSize('1K', '16:9');
    expect(r).toMatchObject({ w: 1536, h: 1024, exact: false });
  });

  it('2K 候选含 16:9 系（2048x1152 精确）', () => {
    expect(mapGptTierSize('2K', '16:9')).toEqual({ w: 2048, h: 1152, exact: true });
    expect(mapGptTierSize('2K', '9:16')).toEqual({ w: 1152, h: 2048, exact: true });
    expect(mapGptTierSize('2K', '4:3')).toEqual({ w: 2048, h: 1536, exact: true });
  });

  it('aspect 缺省/非法 → 按 1:1', () => {
    expect(mapGptTierSize('1K', undefined)).toEqual({ w: 1024, h: 1024, exact: true });
    expect(mapGptTierSize('2K', 'auto')).toEqual({ w: 2048, h: 2048, exact: true });
  });

  it('4K / 非法档位 → null（调用方走预算反推）', () => {
    expect(mapGptTierSize('4K', '1:1')).toBeNull();
    expect(mapGptTierSize(undefined, '1:1')).toBeNull();
    expect(mapGptTierSize('8K', '1:1')).toBeNull();
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

  it('只有精确宽高没档位 → 按最长边折算档位（尺寸节点 custom 路径不再静默回 1K）', () => {
    const fam = getFamilyById('nano-banana-2');
    const b1 = fam.buildBody({ modelId: 'nano-banana-2', prompt: 'x', params: { width: 1024, height: 576 } });
    expect(b1.image_size).toBe('1K');
    const b2 = fam.buildBody({ modelId: 'nano-banana-2', prompt: 'x', params: { width: 2048, height: 1152 } });
    expect(b2.image_size).toBe('2K');
    const b4 = fam.buildBody({ modelId: 'nano-banana-2', prompt: 'x', params: { width: 4096, height: 2304 } });
    expect(b4.image_size).toBe('4K');
  });

  it('flash 档位封顶 2K（4K 请求降为 2K，不发它不认的档）', () => {
    const fam = getFamilyById('nano-banana-flash');
    const body = fam.buildBody({ modelId: 'nano-banana-flash', prompt: 'x', params: { image_size: '4K', aspect: '1:1' } });
    expect(body.image_size).toBe('2K');
  });

  it('不支持的比例吸附到最近支持档（3:1 之类不再原样发出被 400）', () => {
    const fam = getFamilyById('nano-banana-2');
    const body = fam.buildBody({ modelId: 'nano-banana-2', prompt: 'x', params: { image_size: '2K', aspect: '3:1' } });
    // 3:1 不在 nano-banana 支持列表；log 距离下 21:9(≈2.33) 比 4:1 更近
    expect(body.aspect_ratio).toBe('21:9');
  });
});

describe('nearestSupportedAspect', () => {
  const SUP = ['1:1', '4:3', '3:4', '16:9', '9:16', '21:9', '4:1', '1:4'];
  it('已支持的比例原样返回', () => {
    expect(nearestSupportedAspect('16:9', SUP)).toBe('16:9');
  });
  it('自定义化简比例吸附到最近档（横竖对称）', () => {
    expect(nearestSupportedAspect('137:100', SUP)).toBe('4:3');
    expect(nearestSupportedAspect('100:137', SUP)).toBe('3:4');
    // 3:1(=3.0)：log 距离下 21:9(≈2.33, 0.251) < 4:1(4.0, 0.288) → 21:9
    expect(nearestSupportedAspect('3:1', SUP)).toBe('21:9');
    expect(nearestSupportedAspect('1:3', SUP)).toBe('1:4');
  });
  it('auto / 空 / 非法比例返回 null（调用方不发字段）', () => {
    expect(nearestSupportedAspect('auto', SUP)).toBeNull();
    expect(nearestSupportedAspect(undefined, SUP)).toBeNull();
    expect(nearestSupportedAspect('abc', SUP)).toBeNull();
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

describe('sizeFromAspectAndBudget（极端比例保持比例不失真）', () => {
  const B4K = 8_294_400;
  const ratio = (s: { w: number; h: number } | null): number => (s ? s.w / s.h : NaN);

  it('非极端比例（长边未超 3840）按预算反推，比例精确', () => {
    const s = sizeFromAspectAndBudget('16:9', B4K)!;
    expect(s.w).toBeLessThanOrEqual(3840);
    expect(s.h).toBeLessThanOrEqual(3840);
    expect(ratio(s)).toBeCloseTo(16 / 9, 1);
  });

  it('1:1 落在预算内，方形', () => {
    const s = sizeFromAspectAndBudget('1:1', B4K)!;
    expect(s.w).toBe(s.h);
  });

  it('极端横向 3:1：钉长边到 3840（gpt-image-2 单边上限）并按比例回算短边（不再被砍成 ~2.46:1）', () => {
    const s = sizeFromAspectAndBudget('3:1', B4K)!;
    expect(Math.max(s.w, s.h)).toBe(3840);
    // 旧实现会得到 ~2.46:1；修复后应贴近 3:1（容许 snap16 粒度误差）
    expect(ratio(s)).toBeGreaterThan(2.9);
    expect(ratio(s)).toBeLessThan(3.1);
  });

  it('极端竖向 9:21 / 1:3：长边钉 3840，比例忠实', () => {
    const a = sizeFromAspectAndBudget('9:21', B4K)!;
    expect(Math.max(a.w, a.h)).toBe(3840);
    expect(ratio(a)).toBeCloseTo(9 / 21, 1);
    const b = sizeFromAspectAndBudget('1:3', B4K)!;
    expect(Math.max(b.w, b.h)).toBe(3840);
    expect(ratio(b)).toBeGreaterThan(0.32);
    expect(ratio(b)).toBeLessThan(0.35);
  });

  it('2:1 / 1:2：长边钉 3840、单边不超上限、比例精确', () => {
    const a = sizeFromAspectAndBudget('2:1', B4K)!;
    expect(ratio(a)).toBeCloseTo(2, 1);
    expect(Math.max(a.w, a.h)).toBe(3840);
    const b = sizeFromAspectAndBudget('1:2', B4K)!;
    expect(ratio(b)).toBeCloseTo(0.5, 1);
    expect(Math.max(b.w, b.h)).toBe(3840);
  });

  it('非法比例字符串返回 null', () => {
    expect(sizeFromAspectAndBudget('auto', B4K)).toBeNull();
    expect(sizeFromAspectAndBudget('abc', B4K)).toBeNull();
  });
});

// 对照 image2-supported-sizes-and-limits.md 的官方规则（§3/§4/§5）
describe('isValidImage2Size —— 文档官方规则的直译', () => {
  it('文档 §4「常用有效尺寸」全部判定为合法', () => {
    const valid: Array<[number, number]> = [
      [1024, 1024],
      [2048, 2048],
      [1536, 1024],
      [1024, 1536],
      [1536, 864],
      [2048, 1152],
      [2560, 1440],
      [3840, 2160],
      [1152, 2048],
      [2160, 3840],
      [2496, 832], // 3:1 比例边界
      [832, 2496], // 1:3 比例边界
      [1376, 480] // 接近总像素下限
    ];
    for (const [w, h] of valid) expect(isValidImage2Size(w, h)).toBe(true);
  });

  it('文档 §5「无效尺寸」全部判定为非法', () => {
    expect(isValidImage2Size(512, 512)).toBe(false); // 总像素 < 655360
    expect(isValidImage2Size(1920, 1080)).toBe(false); // 1080 非 16 倍数
    expect(isValidImage2Size(3840, 1080)).toBe(false); // 比例 ~3.56:1 > 3:1
    expect(isValidImage2Size(4096, 2160)).toBe(false); // 长边 4096 > 3840
    expect(isValidImage2Size(3840, 3840)).toBe(false); // 总像素 > 8.3MP
    expect(isValidImage2Size(3000, 1000)).toBe(false); // 宽高都不是 16 倍数
    expect(isValidImage2Size(320, 2048)).toBe(false); // 比例 1:6.4 > 1:3
    expect(isValidImage2Size(800, 800)).toBe(false); // 总像素 640000 < 655360
  });
});

describe('clampToImage2Size —— 任意尺寸规整成合法 gpt-image-2 尺寸', () => {
  it('文档列出的非法尺寸规整后都合法', () => {
    const cases: Array<[number, number]> = [
      [512, 512],
      [1920, 1080],
      [3840, 1080],
      [4096, 2160],
      [3840, 3840],
      [3000, 1000],
      [320, 2048],
      [800, 800],
      [6000, 4000], // 超大照片（原尺寸来源）
      [8000, 8000], // 极端正方
      [240, 100] // 极小
    ];
    for (const [w, h] of cases) {
      const c = clampToImage2Size(w, h);
      expect(isValidImage2Size(c.w, c.h)).toBe(true);
    }
  });

  it('已合法的尺寸保持不变', () => {
    for (const [w, h] of [
      [1024, 1024],
      [1536, 1024],
      [2048, 1152],
      [3840, 2160]
    ] as Array<[number, number]>) {
      expect(clampToImage2Size(w, h)).toEqual({ w, h });
    }
  });

  it('超 3:1 的横幅缩到比例边界（单边 ≤3840）', () => {
    const c = clampToImage2Size(3840, 1080);
    expect(Math.max(c.w, c.h) / Math.min(c.w, c.h)).toBeLessThanOrEqual(3);
    expect(Math.max(c.w, c.h)).toBeLessThanOrEqual(3840);
  });

  it('非法/缺省入参兜底为方图', () => {
    const c = clampToImage2Size(NaN, -5);
    expect(isValidImage2Size(c.w, c.h)).toBe(true);
  });
});

describe('GPT Image 2 buildBody —— 自定义/原尺寸宽高规整到合法尺寸', () => {
  const fam = getFamilyById('gpt-image-2');
  it('超大原图尺寸（6000×4000）不再原样发出，规整到合法 size', () => {
    const body = fam.buildBody({
      modelId: 'gpt-image-2',
      prompt: 'x',
      params: { width: 6000, height: 4000 }
    }) as { size: string };
    const [w, h] = body.size.split('x').map(Number);
    expect(isValidImage2Size(w, h)).toBe(true);
  });

  it('过小自定义尺寸（512×512）被放大到合法下限', () => {
    const body = fam.buildBody({
      modelId: 'gpt-image-2',
      prompt: 'x',
      params: { width: 512, height: 512 }
    }) as { size: string };
    const [w, h] = body.size.split('x').map(Number);
    expect(isValidImage2Size(w, h)).toBe(true);
    expect(w * h).toBeGreaterThanOrEqual(655360);
  });
});
