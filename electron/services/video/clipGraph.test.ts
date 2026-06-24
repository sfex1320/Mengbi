import { describe, it, expect } from 'vitest';
import {
  buildClipFilterGraph,
  clipOutDuration,
  escapeDrawtext,
  escapeFontPath,
  ffColor,
  type ClipInput,
  type ClipGraphSpec
} from './clipGraph';

function clip(p: Partial<ClipInput>): ClipInput {
  return {
    trimStart: 0,
    trimEnd: 0,
    naturalDuration: 5,
    hasAudio: true,
    volume: 1,
    muted: false,
    fadeIn: 0,
    fadeOut: 0,
    speed: 1,
    transition: 'none',
    transitionDur: 0,
    ...p
  };
}
function spec(clips: ClipInput[], over: Partial<ClipGraphSpec> = {}): ClipGraphSpec {
  return {
    clips,
    width: 1280,
    height: 720,
    fps: 30,
    color: { brightness: 0, contrast: 1, saturation: 1, gamma: 1, hue: 0 },
    texts: [],
    ...over
  };
}

describe('clipOutDuration', () => {
  it('全段（trimEnd=0）用自然时长', () => {
    expect(clipOutDuration(clip({ naturalDuration: 5 }))).toBe(5);
  });
  it('裁切区间', () => {
    expect(clipOutDuration(clip({ trimStart: 1, trimEnd: 4 }))).toBe(3);
  });
  it('变速缩短时长', () => {
    expect(clipOutDuration(clip({ trimStart: 0, trimEnd: 4, speed: 2 }))).toBe(2);
  });
  it('未知自然时长且无出点 → 0', () => {
    expect(clipOutDuration(clip({ naturalDuration: 0, trimEnd: 0 }))).toBe(0);
  });
});

describe('escape helpers', () => {
  it('单引号包裹的 text：逗号/冒号不转义（单引号保护），仅处理反斜杠/单引号/换行', () => {
    // 含 ASCII 逗号冒号原样保留（不加多余反斜杠）
    expect(escapeDrawtext('Day 1, 12:00')).toBe('Day 1, 12:00');
    // 字面单引号用「关-转义-开」
    expect(escapeDrawtext("it's")).toBe("it'\\''s");
    // 反斜杠加倍
    expect(escapeDrawtext('a\\b')).toBe('a\\\\b');
  });
  it('换行变空格', () => {
    expect(escapeDrawtext('a\nb')).toBe('a b');
  });
  it('字体路径 Windows 盘符转义', () => {
    expect(escapeFontPath('C:\\Windows\\Fonts\\msyh.ttc')).toBe('C\\:/Windows/Fonts/msyh.ttc');
  });
  it('ffColor 解析 + 兜底', () => {
    expect(ffColor('#ff8800')).toBe('0xFF8800');
    expect(ffColor('bad')).toBe('0xFFFFFF');
  });
});

describe('buildClipFilterGraph — 单段', () => {
  it('裁切 + 变速 + 缩放，含音频', () => {
    const r = buildClipFilterGraph(spec([clip({ trimStart: 1, trimEnd: 4, speed: 2 })]));
    expect(r.filterComplex).toContain('[0:v]trim=start=1:end=4');
    expect(r.filterComplex).toContain('setpts=(PTS-STARTPTS)/2');
    expect(r.filterComplex).toContain('scale=1280:720');
    expect(r.filterComplex).toContain('[0:a]atrim=start=1:end=4');
    expect(r.filterComplex).toContain('atempo=2');
    expect(r.mapV).toBe('[v0]');
    expect(r.mapA).toBe('[a0]');
  });
  it('奇数分辨率对齐偶数', () => {
    const r = buildClipFilterGraph(spec([clip({})], { width: 1281, height: 721 }));
    expect(r.filterComplex).toContain('scale=1280:720');
  });
  it('静音段用 anullsrc 合成静音', () => {
    const r = buildClipFilterGraph(spec([clip({ muted: true, naturalDuration: 5 })]));
    expect(r.filterComplex).toContain('anullsrc=r=48000:cl=stereo,atrim=0:5');
    expect(r.mapA).toBe('[a0]');
  });
  it('音量/淡入淡出', () => {
    const r = buildClipFilterGraph(spec([clip({ volume: 0.5, fadeIn: 1, fadeOut: 2, naturalDuration: 10 })]));
    expect(r.filterComplex).toContain('volume=0.5');
    expect(r.filterComplex).toContain('afade=t=in:st=0:d=1');
    expect(r.filterComplex).toContain('afade=t=out:st=8:d=2'); // 10-2
  });
});

describe('buildClipFilterGraph — 多段折叠', () => {
  it('硬切：concat 视频 + 音频', () => {
    const r = buildClipFilterGraph(spec([clip({ naturalDuration: 5 }), clip({ naturalDuration: 3 })]));
    expect(r.filterComplex).toContain('[v0][v1]concat=n=2:v=1:a=0[vc1]');
    expect(r.filterComplex).toContain('[a0][a1]concat=n=2:v=0:a=1[ac1]');
    expect(r.mapV).toBe('[vc1]');
    expect(r.mapA).toBe('[ac1]');
  });
  it('转场 xfade：offset = 段0时长 - d', () => {
    const r = buildClipFilterGraph(
      spec([clip({ naturalDuration: 5 }), clip({ naturalDuration: 5, transition: 'fade', transitionDur: 1 })])
    );
    expect(r.filterComplex).toContain('xfade=transition=fade:duration=1:offset=4'); // 5-1
    expect(r.filterComplex).toContain('acrossfade=d=1');
    expect(r.mapV).toBe('[vx1]');
  });
  it('转场时长被钳到相邻段 0.9 上限', () => {
    const r = buildClipFilterGraph(
      spec([clip({ naturalDuration: 2 }), clip({ naturalDuration: 2, transition: 'fade', transitionDur: 999 })])
    );
    // min(2,2)*0.9 = 1.8 → offset = 2-1.8 = 0.2
    expect(r.filterComplex).toContain('duration=1.8:offset=0.2');
  });
  it('三段混用 切 + 转场', () => {
    const r = buildClipFilterGraph(
      spec([
        clip({ naturalDuration: 4 }),
        clip({ naturalDuration: 4, transition: 'none' }),
        clip({ naturalDuration: 4, transition: 'dissolve', transitionDur: 1 })
      ])
    );
    expect(r.filterComplex).toContain('[v0][v1]concat=n=2:v=1:a=0[vc1]');
    expect(r.filterComplex).toContain('[vc1][v2]xfade=transition=dissolve:duration=1:offset=7'); // 8-1
  });
});

describe('buildClipFilterGraph — 时长未知降级 + 调色 + 文字', () => {
  it('某段时长未知 → 纯画面输出（mapA null，无 anullsrc）', () => {
    const r = buildClipFilterGraph(spec([clip({ naturalDuration: 0, trimEnd: 0 }), clip({ naturalDuration: 5 })]));
    expect(r.mapA).toBeNull();
    expect(r.filterComplex).not.toContain('anullsrc');
    expect(r.filterComplex).toContain('concat=n=2:v=1:a=0');
  });
  it('调色 eq + hue', () => {
    const r = buildClipFilterGraph(spec([clip({})], { color: { brightness: 0.1, contrast: 1.2, saturation: 1, gamma: 1, hue: 30 } }));
    expect(r.filterComplex).toContain('eq=brightness=0.1:contrast=1.2');
    expect(r.filterComplex).toContain('hue=h=30');
    expect(r.mapV).toBe('[vcolor]');
  });
  it('文字叠加 drawtext（有字体）', () => {
    const r = buildClipFilterGraph(
      spec([clip({})], {
        fontFile: 'C:\\Windows\\Fonts\\msyh.ttc',
        texts: [{ text: '标题', start: 0, end: 2, x: 0.5, y: 0.85, fontSize: 32, color: '#ffffff' }]
      })
    );
    expect(r.filterComplex).toContain("text='标题'");
    expect(r.filterComplex).toContain('fontsize=32');
    expect(r.filterComplex).toContain("enable='between(t,0,2)'"); // 单引号内逗号不转义
    expect(r.filterComplex).toContain('fontfile=C\\:/Windows/Fonts/msyh.ttc'); // 不加引号 + 转义盘符冒号
    expect(r.mapV).toBe('[vt0]');
  });
  it('文字含 ASCII 逗号/冒号/单引号：成片不出多余反斜杠、单引号正确闭合', () => {
    const r = buildClipFilterGraph(
      spec([clip({})], {
        fontFile: 'C:\\Windows\\Fonts\\msyh.ttc',
        texts: [{ text: "Day 1, it's 12:00", start: 0, end: 2, x: 0.5, y: 0.85, fontSize: 28, color: '#fff' }]
      })
    );
    expect(r.filterComplex).toContain("text='Day 1, it'\\''s 12:00'");
    expect(r.filterComplex).not.toContain('\\,'); // 单引号内逗号不应有反斜杠
  });
  it('无字体则不渲染文字', () => {
    const r = buildClipFilterGraph(spec([clip({})], { fontFile: null, texts: [{ text: 'x', start: 0, end: 1, x: 0.5, y: 0.8, fontSize: 20, color: '#fff' }] }));
    expect(r.filterComplex).not.toContain('drawtext');
  });
  it('空 clips 抛错', () => {
    expect(() => buildClipFilterGraph(spec([]))).toThrow();
  });
});
