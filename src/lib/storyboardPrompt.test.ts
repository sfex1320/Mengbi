import { describe, it, expect } from 'vitest';
import {
  resolveTimelinePlan,
  timelineSystem,
  formatTimelineText,
  DURATION_PRESETS,
  DURATION_MIN,
  DURATION_MAX,
  SEC_PER_SHOT_MIN,
  SEC_PER_SHOT_MAX
} from './storyboardPrompt';

describe('resolveTimelinePlan（时长/段数规划）', () => {
  it('缺省：30s · 每段 5s · 6 段', () => {
    expect(resolveTimelinePlan({})).toEqual({ durationSec: 30, secPerShot: 5, count: 6 });
  });

  it('段数 = 总时长 ÷ 每段秒数（四舍五入）', () => {
    expect(resolveTimelinePlan({ videoDurationSec: 60, secPerShot: 5 }).count).toBe(12);
    expect(resolveTimelinePlan({ videoDurationSec: 15, secPerShot: 4 }).count).toBe(4);
  });

  it('总时长 clamp 4-600、每段秒数 clamp 2-15', () => {
    expect(resolveTimelinePlan({ videoDurationSec: 9999 }).durationSec).toBe(DURATION_MAX);
    expect(resolveTimelinePlan({ videoDurationSec: 1 }).durationSec).toBe(DURATION_MIN);
    expect(resolveTimelinePlan({ secPerShot: 99 }).secPerShot).toBe(SEC_PER_SHOT_MAX);
    expect(resolveTimelinePlan({ secPerShot: 0 }).secPerShot).toBe(SEC_PER_SHOT_MIN);
  });

  it('段数 clamp 2-30，且不超过总秒数（每段 ≥1s 护栏）', () => {
    // 600s / 2s = 300 段 → clamp 30
    expect(resolveTimelinePlan({ videoDurationSec: 600, secPerShot: 2 }).count).toBe(30);
    // 4s / 15s ≈ 0.27 段 → clamp 2
    expect(resolveTimelinePlan({ videoDurationSec: 4, secPerShot: 15 }).count).toBe(2);
  });
});

describe('timelineSystem（整段时间轴分镜脚本的系统提示词）', () => {
  const base = { durationSec: 30, secPerShot: 5, count: 6 };

  it('写入 总时长 / 段数 / 每段秒数 / 首尾覆盖', () => {
    const s = timelineSystem(base);
    expect(s).toContain('30 秒');
    expect(s).toContain('6 个时间段');
    expect(s).toContain('每段约 5 秒');
    expect(s).toContain('从 0 秒开始');
    expect(s).toContain('到 30 秒结束');
  });

  it('要求「第X-Y秒：」时间标注 + 四要素（场景/人物/物体变化/镜头运动）', () => {
    const s = timelineSystem(base);
    expect(s).toContain('第X-Y秒：');
    expect(s).toContain('场景与环境');
    expect(s).toContain('人物在做什么');
    expect(s).toContain('物体的变化');
    expect(s).toContain('镜头运动');
  });

  it('开头要求【定调】段（稳定全片风格/场景/内容物/光色）+ 每个时间段独立成段', () => {
    const s = timelineSystem(base);
    expect(s).toContain('【定调】');
    expect(s).toContain('画面风格');
    expect(s).toContain('光线与色彩基调');
    expect(s).toContain('每个时间段独立成段');
    expect(s).toContain('不要列表符号');
    expect(s).toContain('不要 Markdown');
  });

  it('extraNote 注入「额外要求」；未填不出现', () => {
    expect(timelineSystem({ ...base, extraNote: '赛博朋克霓虹风' })).toContain('额外要求：赛博朋克霓虹风');
    expect(timelineSystem(base)).not.toContain('额外要求');
    expect(timelineSystem({ ...base, extraNote: '  ' })).not.toContain('额外要求');
  });
});

describe('formatTimelineText（版式由代码保证：定调 + 每个时间段各占一段）', () => {
  it('单段原样', () => {
    expect(formatTimelineText('第0-5秒：她推开门，镜头缓慢推近。')).toBe('第0-5秒：她推开门，镜头缓慢推近。');
  });

  it('已分段的保持一段一行', () => {
    expect(formatTimelineText('【定调】水墨画风。\n第0-5秒：开场。\n第5-10秒：推进。')).toBe(
      '【定调】水墨画风。\n第0-5秒：开场。\n第5-10秒：推进。'
    );
  });

  it('挤成一坨的按「第X-Y秒：」强制拆段（一段一段往下）', () => {
    expect(formatTimelineText('【定调】胶片质感。第0-5秒：开场。第5-10秒：推进，第10-15秒：收尾。')).toBe(
      '【定调】胶片质感。\n第0-5秒：开场。\n第5-10秒：推进，\n第10-15秒：收尾。'
    );
  });

  it('支持 ~ / 至 等区间写法；正文里的「第3秒」不误拆', () => {
    expect(formatTimelineText('第0~5秒：开场。第5至10秒：推进。')).toBe('第0~5秒：开场。\n第5至10秒：推进。');
    expect(formatTimelineText('第0-5秒：在第3秒处她回头。')).toBe('第0-5秒：在第3秒处她回头。');
  });

  it('剥列表/编号记号与空行（段间只留单个换行）', () => {
    expect(formatTimelineText('- 第0-5秒：开场。\n\n1. 第5-10秒：推进。')).toBe('第0-5秒：开场。\n第5-10秒：推进。');
  });

  it('剥 markdown 代码围栏', () => {
    expect(formatTimelineText('```\n第0-5秒：开场。\n```')).toBe('第0-5秒：开场。');
    expect(formatTimelineText('```text\n第0-5秒：开场。\n```')).toBe('第0-5秒：开场。');
  });

  it('空/纯空白 → 空串', () => {
    expect(formatTimelineText('')).toBe('');
    expect(formatTimelineText('  \n  ')).toBe('');
  });
});

describe('预设常量（UI chips 数据）', () => {
  it('时长预设 15/30/60/120', () => {
    expect(DURATION_PRESETS.map((p) => p.value)).toEqual([15, 30, 60, 120]);
  });
});
