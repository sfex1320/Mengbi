import { describe, it, expect } from 'vitest';
import {
  parseSegElements,
  parseProofElements,
  buildProofReport,
  severityColor
} from './visionSegment';

describe('parseSegElements — 坐标系容错', () => {
  it('归一化 0~1 [x,y,w,h] → 源图像素', () => {
    const raw = JSON.stringify([{ label: '猪肉', box: [0.1, 0.2, 0.3, 0.4], prompt: '一块红烧猪肉' }]);
    const els = parseSegElements(raw, 1000, 800);
    expect(els).toHaveLength(1);
    expect(els[0].label).toBe('猪肉');
    expect(els[0].prompt).toBe('一块红烧猪肉');
    expect(els[0].box).toEqual({ x: 100, y: 160, w: 300, h: 320 });
  });

  it('去掉 ```json 围栏后仍能解析', () => {
    const raw = '```json\n[{"label":"标题","box":[0,0,0.5,0.2]}]\n```';
    const els = parseSegElements(raw, 1000, 1000);
    expect(els).toHaveLength(1);
    expect(els[0].box).toEqual({ x: 0, y: 0, w: 500, h: 200 });
  });

  it('小图上的像素坐标按像素解释（不缩放）', () => {
    const raw = JSON.stringify([{ label: 'logo', box: [80, 60, 200, 150] }]);
    const els = parseSegElements(raw, 800, 600);
    expect(els[0].box).toEqual({ x: 80, y: 60, w: 200, h: 150 });
  });

  it('Gemini box_2d [ymin,xmin,ymax,xmax]（0~1000，大图）→ 角点换算', () => {
    const raw = JSON.stringify([{ label: '主体', box_2d: [200, 100, 600, 500] }]);
    const els = parseSegElements(raw, 2000, 2000);
    expect(els[0].box).toEqual({ x: 200, y: 400, w: 800, h: 800 });
  });

  it('角点格式 {x0,y0,x1,y1}（归一化）→ 宽高', () => {
    const raw = JSON.stringify([{ label: 'a', x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.6 }]);
    const els = parseSegElements(raw, 1000, 1000);
    expect(els[0].box).toEqual({ x: 100, y: 100, w: 400, h: 500 });
  });

  it('对象型 box {x,y,w,h}（归一化）', () => {
    const raw = JSON.stringify([{ label: 'b', box: { x: 0.2, y: 0.2, w: 0.2, h: 0.2 } }]);
    const els = parseSegElements(raw, 500, 500);
    expect(els[0].box).toEqual({ x: 100, y: 100, w: 100, h: 100 });
  });

  it('未声明角点但 w/h 实为右下角坐标 → 自动纠正成宽高', () => {
    // 归一化 [0.4,0.4,0.9,0.9]：若当 [x,y,w,h] 则 x+w=1.3>1.25 越界、且 w>x、h>y → 判为角点
    const raw = JSON.stringify([{ label: 'c', box: [0.4, 0.4, 0.9, 0.9] }]);
    const els = parseSegElements(raw, 1000, 1000);
    expect(els[0].box).toEqual({ x: 400, y: 400, w: 500, h: 500 });
  });

  it('越界框被夹回图像范围内', () => {
    const raw = JSON.stringify([{ label: 'd', box: [0.9, 0.9, 0.5, 0.5] }]);
    const els = parseSegElements(raw, 1000, 1000);
    expect(els[0].box.x).toBe(900);
    expect(els[0].box.w).toBe(100); // 夹到右边界
    expect(els[0].box.h).toBe(100);
  });

  it('缺少 box 的元素被跳过', () => {
    const raw = JSON.stringify([{ label: '无框' }, { label: '有框', box: [0, 0, 0.1, 0.1] }]);
    const els = parseSegElements(raw, 1000, 1000);
    expect(els).toHaveLength(1);
    expect(els[0].label).toBe('有框');
  });

  it('非法 JSON → 空数组', () => {
    expect(parseSegElements('抱歉我无法识别', 1000, 1000)).toEqual([]);
  });

  it('{elements:[...]} 包裹也能取出', () => {
    const raw = JSON.stringify({ elements: [{ label: 'x', box: [0, 0, 1, 1] }] });
    const els = parseSegElements(raw, 100, 100);
    expect(els).toHaveLength(1);
  });
});

describe('parseProofElements — 检错解析', () => {
  it('解析问题元素（类别/严重度/描述/建议）', () => {
    const raw = JSON.stringify([
      {
        label: '左手',
        box: [0.4, 0.5, 0.1, 0.2],
        ok: false,
        issue_types: ['shape'],
        severity: 'high',
        description: '只有 4 根手指',
        suggestion: '重绘手部为 5 指'
      }
    ]);
    const els = parseProofElements(raw, 1000, 1000);
    expect(els).toHaveLength(1);
    expect(els[0].ok).toBe(false);
    expect(els[0].issueTypes).toEqual(['shape']);
    expect(els[0].severity).toBe('high');
    expect(els[0].box).toEqual({ x: 400, y: 500, w: 100, h: 200 });
  });

  it('ok=true 时清空问题类别、严重度归 ok', () => {
    const raw = JSON.stringify([{ label: '背景', box: [0, 0, 1, 1], ok: true, issue_types: ['font'], severity: 'high' }]);
    const els = parseProofElements(raw, 100, 100);
    expect(els[0].ok).toBe(true);
    expect(els[0].issueTypes).toEqual([]);
    expect(els[0].severity).toBe('ok');
  });

  it('缺 ok 时按 issue_types 是否为空推断', () => {
    const raw = JSON.stringify([
      { label: 'a', box: [0, 0, 0.5, 0.5], issue_types: ['font'] },
      { label: 'b', box: [0.5, 0.5, 0.5, 0.5], issue_types: [] }
    ]);
    const els = parseProofElements(raw, 100, 100);
    expect(els[0].ok).toBe(false);
    expect(els[0].severity).toBe('medium'); // 有问题但没给 severity → medium
    expect(els[1].ok).toBe(true);
  });

  it('过滤非法 issue_type，字符串形式也接受', () => {
    const raw = JSON.stringify([{ label: 'x', box: [0, 0, 1, 1], ok: false, issue_types: 'font, 乱码, logo' }]);
    const els = parseProofElements(raw, 100, 100);
    expect(els[0].issueTypes.sort()).toEqual(['font', 'logo']);
  });
});

describe('buildProofReport', () => {
  it('无问题时给出正常结论', () => {
    const rpt = buildProofReport([
      { id: '1', label: 'a', box: { x: 0, y: 0, w: 1, h: 1 }, issueTypes: [], severity: 'ok', description: '', suggestion: '', ok: true }
    ]);
    expect(rpt).toContain('共检查 1 个元素');
    expect(rpt).toContain('未发现明显');
  });

  it('列出问题元素的类别/描述/建议', () => {
    const rpt = buildProofReport([
      { id: '1', label: '微信图标', box: { x: 0, y: 0, w: 1, h: 1 }, issueTypes: ['logo'], severity: 'high', description: '图标画崩', suggestion: '换标准图标', ok: false }
    ]);
    expect(rpt).toContain('发现 1 处问题');
    expect(rpt).toContain('微信图标');
    expect(rpt).toContain('Logo 错误');
    expect(rpt).toContain('图标画崩');
    expect(rpt).toContain('换标准图标');
  });
});

describe('severityColor', () => {
  it('按严重度给色', () => {
    expect(severityColor('high')).toBe('#ef4444');
    expect(severityColor('ok')).toBe('#22c55e');
  });
});
