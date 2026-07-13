import { describe, it, expect } from 'vitest';
import {
  CARD_STYLES,
  SHEET_TYPES,
  SUBJECT_TYPES,
  cardStyleLabel,
  sheetTypeLabel,
  characterAnalysisSystem,
  characterCardSystem,
  characterSheetSystem
} from './characterCardPrompt';
import type { CharacterCardStyle, CharacterSheetType } from '@shared/smartCanvas';

describe('CARD_STYLES / SHEET_TYPES / SUBJECT_TYPES 与标签', () => {
  it('四种版面风格齐全（时尚杂志/手账拼贴/写真设定集/简约设计稿）', () => {
    expect(CARD_STYLES.map((s) => s.value)).toEqual(['magazine', 'journal', 'photoset', 'minimal']);
    for (const s of CARD_STYLES) {
      expect(s.label).toBeTruthy();
      expect(s.hint.length).toBeGreaterThan(4);
    }
  });

  it('六种输出类型齐全（设定卡/三视图/面部特写/表情九宫/身材比例/动作姿势）', () => {
    expect(SHEET_TYPES.map((s) => s.value)).toEqual(['card', 'turnaround', 'face', 'expressions', 'body', 'pose']);
    for (const s of SHEET_TYPES) {
      expect(s.label).toBeTruthy();
      expect(s.hint.length).toBeGreaterThan(4);
    }
  });

  it('主体类型：人物 / 动物', () => {
    expect(SUBJECT_TYPES.map((s) => s.value)).toEqual(['person', 'animal']);
  });

  it('cardStyleLabel：合法 value → 中文名；空/未知回退「时尚杂志」', () => {
    expect(cardStyleLabel('journal')).toBe('手账拼贴');
    expect(cardStyleLabel('')).toBe('时尚杂志');
    expect(cardStyleLabel('nope')).toBe('时尚杂志');
    expect(cardStyleLabel(undefined)).toBe('时尚杂志');
  });

  it('sheetTypeLabel：合法 value → 中文名；空/未知回退「设定卡」', () => {
    expect(sheetTypeLabel('turnaround')).toBe('三视图');
    expect(sheetTypeLabel('pose')).toBe('动作姿势');
    expect(sheetTypeLabel('')).toBe('设定卡');
    expect(sheetTypeLabel(undefined)).toBe('设定卡');
  });
});

describe('characterAnalysisSystem（第 ① 步：外观分析，人物/动物两套口径）', () => {
  it('人物版覆盖 五官/发色发型/衣着/妆容/配饰/配色 各要点', () => {
    const s = characterAnalysisSystem('person');
    for (const kw of ['五官', '发色', '发型', '衣着', '妆容', '配饰', '配色', '气质关键词']) {
      expect(s, `应包含「${kw}」`).toContain(kw);
    }
  });

  it('缺省 = 人物版', () => {
    expect(characterAnalysisSystem()).toBe(characterAnalysisSystem('person'));
  });

  it('动物版覆盖 品种/毛色花纹/头部特征/尾巴四肢 等要点', () => {
    const s = characterAnalysisSystem('animal');
    for (const kw of ['品种', '毛色', '花纹', '眼睛', '耳朵', '尾巴', '四肢', '气质关键词']) {
      expect(s, `应包含「${kw}」`).toContain(kw);
    }
  });

  it('两套口径都要求可稳定复现 + 只输出分析文本', () => {
    for (const subj of ['person', 'animal'] as const) {
      const s = characterAnalysisSystem(subj);
      expect(s).toContain('稳定复现');
      expect(s).toContain('只输出');
    }
  });
});

describe('characterSheetSystem（第 ② 步：按输出类型的生图提示词）', () => {
  const nonCard = SHEET_TYPES.map((s) => s.value).filter((v): v is Exclude<CharacterSheetType, 'card'> => v !== 'card');

  it('card：每种版面风格都含设定卡声明与一致性要求（人物）', () => {
    for (const st of CARD_STYLES.map((s) => s.value)) {
      const s = characterSheetSystem('card', st, 'person');
      expect(s).toContain('character reference sheet');
      expect(s).toContain('同一个角色');
      expect(s).toContain('只输出');
    }
    for (const st of ['magazine', 'photoset', 'minimal'] as const) {
      expect(characterSheetSystem('card', st, 'person')).toContain('三视图');
    }
  });

  it('card：风格差异体现在版面描述里', () => {
    expect(characterSheetSystem('card', 'magazine', 'person')).toContain('杂志');
    expect(characterSheetSystem('card', 'journal', 'person')).toContain('手账');
    expect(characterSheetSystem('card', 'photoset', 'person')).toContain('写真');
    expect(characterSheetSystem('card', 'minimal', 'person')).toContain('简约');
  });

  it('card + 动物：分区按物种合理化（服装拆解→配饰随身物品）+ 同一只动物一致性', () => {
    const s = characterSheetSystem('card', 'magazine', 'animal');
    expect(s).toContain('同一只动物');
    expect(s).toContain('项圈');
  });

  it('非 card 输出类型：人物/动物各有版面段，且都含一致性与「只输出」要求', () => {
    for (const sheet of nonCard) {
      const person = characterSheetSystem(sheet, 'magazine', 'person');
      const animal = characterSheetSystem(sheet, 'magazine', 'animal');
      expect(person).toContain('只输出');
      expect(animal).toContain('只输出');
      expect(person).toContain('同一个角色');
      expect(animal).toContain('同一只动物');
      expect(person).not.toBe(animal);
    }
  });

  it('非 card 的版面关键词到位（三视图/面部/表情/比例/姿势）', () => {
    expect(characterSheetSystem('turnaround', 'magazine', 'person')).toContain('turnaround');
    expect(characterSheetSystem('turnaround', 'magazine', 'person')).toContain('背面');
    expect(characterSheetSystem('face', 'magazine', 'person')).toContain('面部特写');
    expect(characterSheetSystem('face', 'magazine', 'animal')).toContain('头部特写');
    expect(characterSheetSystem('expressions', 'magazine', 'person')).toContain('3×3');
    expect(characterSheetSystem('body', 'magazine', 'person')).toContain('头身比');
    expect(characterSheetSystem('body', 'magazine', 'animal')).toContain('肩高');
    expect(characterSheetSystem('pose', 'magazine', 'person')).toContain('姿势');
  });

  it('characterCardSystem 旧签名 = characterSheetSystem("card", …)；未知风格回退 magazine', () => {
    expect(characterCardSystem('journal')).toBe(characterSheetSystem('card', 'journal', 'person'));
    expect(characterCardSystem('nope' as CharacterCardStyle)).toContain('杂志');
  });
});
