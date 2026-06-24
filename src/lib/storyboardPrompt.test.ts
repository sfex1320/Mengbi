import { describe, it, expect } from 'vitest';
import { buildFixedBlock, composeShotPrompt, parseShots, shotsSystem, transitionsSystem, transitionsUser, parseTransitions } from './storyboardPrompt';

describe('buildFixedBlock', () => {
  it('空/未传 → 空串', () => {
    expect(buildFixedBlock()).toBe('');
    expect(buildFixedBlock({})).toBe('');
    expect(buildFixedBlock({ character: '  ' })).toBe('');
  });

  it('按 角色/风格/… 顺序拼非空项', () => {
    expect(buildFixedBlock({ style: '吉卜力水彩', character: '红裙少女' })).toBe(
      '角色：红裙少女，风格：吉卜力水彩'
    );
  });

  it('七项全填', () => {
    const s = buildFixedBlock({
      character: 'A',
      style: 'B',
      camera: 'C',
      palette: 'D',
      world: 'E',
      scene: 'F',
      wardrobe: 'G'
    });
    expect(s).toBe('角色：A，风格：B，镜头语言：C，色彩氛围：D，世界观：E，场景基调：F，服装外貌：G');
  });
});

describe('composeShotPrompt', () => {
  it('固定段 + 元信息对象', () => {
    expect(composeShotPrompt('角色：红裙少女', { scene: '她走进森林', shot: '广角', detail: '晨雾' })).toBe(
      '角色：红裙少女。她走进森林，广角，晨雾'
    );
  });

  it('固定段 + 字符串分镜', () => {
    expect(composeShotPrompt('风格：水彩', '少女抬头看天')).toBe('风格：水彩。少女抬头看天');
  });

  it('无固定段 → 只有正文', () => {
    expect(composeShotPrompt('', { scene: 'X' })).toBe('X');
  });

  it('正文为空 → 退回固定段', () => {
    expect(composeShotPrompt('风格：水彩', { scene: '' })).toBe('风格：水彩');
  });
});

describe('parseShots', () => {
  it('字符串数组', () => {
    const r = parseShots('["镜头一内容","镜头二内容"]', 2);
    expect(r.shots).toEqual(['镜头一内容', '镜头二内容']);
    expect(r.meta).toBeUndefined();
  });

  it('对象数组（scene/shot/detail）→ 提取文本 + meta（不再产出 [object Object]）', () => {
    const raw = JSON.stringify([
      { scene: '少女醒来', shot: '特写', detail: '晨光' },
      { scene: '她推开门', shot: '中景', detail: '逆光' }
    ]);
    const r = parseShots(raw, 2);
    expect(r.shots).toEqual(['少女醒来，特写，晨光', '她推开门，中景，逆光']);
    expect(r.meta?.[0]).toMatchObject({ scene: '少女醒来', shot: '特写', detail: '晨光' });
    expect(r.shots.join('')).not.toContain('[object Object]');
  });

  it('电影化五字段对象（scene/characters/action/shot/detail）→ 按 场景,人物,动作,镜头,细节 顺序拼接', () => {
    const raw = JSON.stringify([
      { scene: '黄昏的海边', characters: '红裙黑发少女，赤脚奔跑，神情急切', action: '浪花打湿裙摆', shot: '中景，平视机位，缓慢推近', detail: '逆光剪影，暖橙色调' }
    ]);
    const r = parseShots(raw, 1);
    expect(r.shots).toEqual(['黄昏的海边，红裙黑发少女，赤脚奔跑，神情急切，浪花打湿裙摆，中景，平视机位，缓慢推近，逆光剪影，暖橙色调']);
    expect(r.meta?.[0]).toMatchObject({ characters: '红裙黑发少女，赤脚奔跑，神情急切', action: '浪花打湿裙摆' });
  });

  it('camera 字段作为 shot 的别名', () => {
    const r = parseShots('[{"scene":"教室","camera":"俯拍全景"}]', 1);
    expect(r.shots).toEqual(['教室，俯拍全景']);
    expect(r.meta?.[0]?.shot).toBe('俯拍全景');
  });

  it('对象数组（prompt/description 替代字段）', () => {
    const r = parseShots('[{"prompt":"一条提示词"},{"description":"另一条"}]', 2);
    expect(r.shots).toEqual(['一条提示词', '另一条']);
  });

  it('对象数组（未知字段）→ 取最长字符串值，绝不 [object Object]', () => {
    const r = parseShots('[{"foo":"短","bar":"这是比较长的那个字符串"}]', 1);
    expect(r.shots).toEqual(['这是比较长的那个字符串']);
  });

  it('markdown 围栏包裹的 JSON', () => {
    const r = parseShots('```json\n["分镜甲内容","分镜乙内容"]\n```', 2);
    expect(r.shots).toEqual(['分镜甲内容', '分镜乙内容']);
  });

  it('非 JSON → 编号行兜底', () => {
    const raw = '分镜1：少女在森林里奔跑\n分镜2：她停在湖边回头看';
    const r = parseShots(raw, 2);
    expect(r.shots).toEqual(['少女在森林里奔跑', '她停在湖边回头看']);
  });

  it('超出 n 截断', () => {
    const r = parseShots('["a1234","b1234","c1234"]', 2);
    expect(r.shots).toHaveLength(2);
  });
});

describe('shotsSystem（电影分镜师）', () => {
  it('有约束 → 声明固定设定由系统附加在每条开头', () => {
    expect(shotsSystem(4, true)).toContain('由系统统一附加在每条开头');
  });
  it('无约束 → 要求保持整组一致', () => {
    expect(shotsSystem(4, false)).toContain('保持整组角色外观与画面风格一致');
  });
  it('数量写入 + 电影化要求（≥60 字 / 完整复述 / 衔接）', () => {
    const s = shotsSystem(7, false);
    expect(s).toContain('恰好 7 个');
    expect(s).toContain('不少于 60 字');
    expect(s).toContain('完整复述核心人物特征与场景特征');
    expect(s).toContain('衔接');
  });
});

describe('transitions（镜头转场）', () => {
  it('transitionsSystem：N 镜 → N-1 条', () => {
    const s = transitionsSystem(5);
    expect(s).toContain('5 条');
    expect(s).toContain('恰好 4 条');
  });
  it('transitionsUser：编号列出分镜', () => {
    expect(transitionsUser(['a', 'b'])).toBe('分镜 1：a\n分镜 2：b');
  });
  it('parseTransitions：对象数组（motion/transition/change/subject 拼接）', () => {
    const raw = JSON.stringify([
      { motion: '镜头从特写缓缓拉远', transition: '叠化', change: '黄昏转入夜晚', subject: '少女从奔跑转为驻足' }
    ]);
    expect(parseTransitions(raw, 2)).toEqual(['镜头从特写缓缓拉远，叠化，黄昏转入夜晚，少女从奔跑转为驻足']);
  });
  it('parseTransitions：字符串数组 + 截断到 n-1', () => {
    expect(parseTransitions('["转场甲内容","转场乙内容","转场丙内容"]', 3)).toEqual(['转场甲内容', '转场乙内容']);
  });
  it('parseTransitions：编号行兜底（含 1→2 形式）', () => {
    const raw = '转场1→2：镜头向右甩出切到海边\n转场2→3：俯冲下摇接人物特写';
    expect(parseTransitions(raw, 3)).toEqual(['镜头向右甩出切到海边', '俯冲下摇接人物特写']);
  });
  it('parseTransitions：未知字段对象取最长字符串、n<2 返回空', () => {
    expect(parseTransitions('[{"foo":"短","bar":"这是比较长的转场描述内容"}]', 2)).toEqual(['这是比较长的转场描述内容']);
    expect(parseTransitions('["x"]', 1)).toEqual([]);
  });
});
