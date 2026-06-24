import { describe, it, expect } from 'vitest';
import {
  hexToRgb,
  rgbToHex,
  rgbToCmyk,
  rgbToHsl,
  hslToRgb,
  rgbToHsb,
  colorValueStrings,
  colorName,
  deriveScheme,
  buildPalettePrompt,
  paletteCopyAllText
} from './paletteColor';

describe('hexToRgb / rgbToHex', () => {
  it('解析 6 位 HEX', () => {
    expect(hexToRgb('#E8734A')).toEqual({ r: 232, g: 115, b: 74 });
    expect(hexToRgb('e8734a')).toEqual({ r: 232, g: 115, b: 74 });
  });
  it('解析 3 位缩写 HEX', () => {
    expect(hexToRgb('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb('#f00')).toEqual({ r: 255, g: 0, b: 0 });
  });
  it('非法输入返回 null', () => {
    expect(hexToRgb('')).toBeNull();
    expect(hexToRgb('#12345')).toBeNull();
    expect(hexToRgb('红色')).toBeNull();
  });
  it('rgbToHex 大写 + clamp', () => {
    expect(rgbToHex(232, 115, 74)).toBe('#E8734A');
    expect(rgbToHex(-5, 300, 0)).toBe('#00FF00');
  });
  it('往返一致', () => {
    const rgb = hexToRgb('#1A2B3C')!;
    expect(rgbToHex(rgb.r, rgb.g, rgb.b)).toBe('#1A2B3C');
  });
});

describe('rgbToCmyk', () => {
  it('白色 → 0,0,0,0', () => {
    expect(rgbToCmyk(255, 255, 255)).toEqual({ c: 0, m: 0, y: 0, k: 0 });
  });
  it('黑色 → 0,0,0,100', () => {
    expect(rgbToCmyk(0, 0, 0)).toEqual({ c: 0, m: 0, y: 0, k: 100 });
  });
  it('纯红 → 0,100,100,0', () => {
    expect(rgbToCmyk(255, 0, 0)).toEqual({ c: 0, m: 100, y: 100, k: 0 });
  });
});

describe('rgbToHsl / hslToRgb / rgbToHsb', () => {
  it('纯红 HSL = 0,100,50', () => {
    expect(rgbToHsl(255, 0, 0)).toEqual({ h: 0, s: 100, l: 50 });
  });
  it('灰色 s=0', () => {
    expect(rgbToHsl(128, 128, 128).s).toBe(0);
  });
  it('hslToRgb 反推纯红', () => {
    expect(hslToRgb(0, 100, 50)).toEqual({ r: 255, g: 0, b: 0 });
  });
  it('hslToRgb 色相 wrap（360+120 = 120）', () => {
    expect(hslToRgb(480, 100, 50)).toEqual(hslToRgb(120, 100, 50));
  });
  it('纯红 HSB = 0,100,100', () => {
    expect(rgbToHsb(255, 0, 0)).toEqual({ h: 0, s: 100, b: 100 });
  });
});

describe('colorValueStrings', () => {
  it('五种格式齐全', () => {
    const vals = colorValueStrings('#FF0000');
    expect(vals.map((v) => v.label)).toEqual(['HEX', 'RGB', 'CMYK', 'HSL', 'HSB']);
    expect(vals[0].value).toBe('#FF0000');
    expect(vals[1].value).toBe('255, 0, 0');
    expect(vals[2].value).toBe('0, 100, 100, 0');
  });
});

describe('colorName', () => {
  it('黑白灰', () => {
    expect(colorName('#000000')).toBe('黑色');
    expect(colorName('#FFFFFF')).toBe('白色');
    expect(colorName('#808080')).toBe('灰色');
  });
  it('主色相', () => {
    expect(colorName('#FF0000')).toBe('红色');
    expect(colorName('#0000FF')).toContain('蓝');
    expect(colorName('#00FF00')).toContain('绿');
  });
  it('棕色特判（暗橙·高饱和）', () => {
    expect(colorName('#8B4513')).toContain('棕'); // 鞍棕 h≈25/s≈76/l≈31
  });
  it('低饱和暖暗色 = 棕/褐，不是红（修正 #4F3A36 误判深红）', () => {
    // #4F3A36 rgb(79,58,54) → h≈10 / s≈19% / l≈26%：肉眼是深棕/灰褐，绝不能叫「深红色」
    const name = colorName('#4F3A36');
    expect(name).toMatch(/棕|褐/);
    expect(name).not.toContain('红');
  });
  it('高饱和暗红仍归红（与低饱和暖暗区分）', () => {
    expect(colorName('#7A1010')).toBe('深红色'); // h=0 / s≈77% / l≈27%：真·暗红
  });
  it('低饱和冷色走偏灰柔和色名（不报鲜艳色名）', () => {
    // #5A6B7A rgb(90,107,122) → h≈206 / s≈15% / l≈42%：发灰的蓝
    expect(colorName('#5A6B7A')).toContain('灰蓝');
    // #6B7A5A rgb(107,122,90) → h≈80 / s≈15% / l≈42%：发灰的绿
    expect(colorName('#6B7A5A')).toContain('灰绿');
  });
  it('饱和色仍用鲜明色名', () => {
    expect(colorName('#2E7D32')).toContain('绿'); // 饱和绿
    expect(colorName('#1565C0')).toContain('蓝'); // 饱和蓝
  });
  it('非法输入', () => {
    expect(colorName('oops')).toBe('未知色');
  });
});

describe('deriveScheme', () => {
  it('互补：纯红 → 红 + 青', () => {
    expect(deriveScheme('#FF0000', 'complementary')).toEqual(['#FF0000', '#00FFFF']);
  });
  it('对比（三角）：三色相隔 120°', () => {
    expect(deriveScheme('#FF0000', 'contrast')).toEqual(['#FF0000', '#00FF00', '#0000FF']);
  });
  it('四角：四色', () => {
    expect(deriveScheme('#FF0000', 'tetradic')).toHaveLength(4);
  });
  it('邻近：首位是基准色，数量受 count 控制', () => {
    const out = deriveScheme('#FF0000', 'analogous', 5);
    expect(out).toHaveLength(5);
    expect(out[0]).toBe('#FF0000');
  });
  it('单色深浅：同色相、含基准色', () => {
    const out = deriveScheme('#E8734A', 'monochrome', 5);
    expect(out).toHaveLength(5);
    expect(out).toContain('#E8734A');
  });
  it('count 钳制 2-8', () => {
    expect(deriveScheme('#FF0000', 'analogous', 99)).toHaveLength(8);
    expect(deriveScheme('#FF0000', 'monochrome', 0)).toHaveLength(2);
  });
  it('非法基准色返回空', () => {
    expect(deriveScheme('nope', 'complementary')).toEqual([]);
  });
});

describe('buildPalettePrompt', () => {
  it('空色板返回空串', () => {
    expect(buildPalettePrompt([])).toBe('');
  });
  it('含色名 + HEX + 占比', () => {
    const s = buildPalettePrompt([
      { hex: '#FF0000', pct: 60 },
      { hex: '#0000FF', pct: 40 }
    ]);
    expect(s).toContain('红色 #FF0000');
    expect(s).toContain('占比约 60%');
    expect(s).toContain('辅以');
    expect(s).toContain('2 色配色方案');
  });
  it('includeValues=false 时不带 HEX', () => {
    const s = buildPalettePrompt([{ hex: '#FF0000' }], { includeValues: false });
    expect(s).not.toContain('#FF0000');
    expect(s).toContain('红色');
  });
  it('schemeLabel 拼进色彩关系', () => {
    const s = buildPalettePrompt([{ hex: '#FF0000' }, { hex: '#00FFFF' }], { schemeLabel: '互补色' });
    expect(s).toContain('色彩关系为互补色');
  });
  it('非法色被过滤（注意 "bad" 是合法 3 位 HEX，得用真非法串）', () => {
    expect(buildPalettePrompt([{ hex: 'zzz' }])).toBe('');
  });
});

describe('paletteCopyAllText', () => {
  it('一行一色含全部格式', () => {
    const t = paletteCopyAllText([{ hex: '#FF0000', pct: 51.4 }]);
    expect(t).toContain('1. 红色');
    expect(t).toContain('HEX(#FF0000)');
    expect(t).toContain('CMYK(0, 100, 100, 0)');
    expect(t).toContain('占比51%');
  });
});
