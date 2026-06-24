import type { PromptMallCard } from '../cardTypes';
import { CHARACTER_EXT_HAIR } from './characterExtHair';
import { CHARACTER_EXT_FACE } from './characterExtFace';
import { CHARACTER_EXT_IDENTITY } from './characterExtIdentity';
import { CHARACTER_EXT_POSE } from './characterExtPose';
import { CHARACTER_EXT_MORE } from './characterExtMore';

// 人物大类「追加」卡片（2026-06-24 扩充，不覆盖原 character.ts）。按 头发/面部身材/身份/姿态 拆 4 个部分文件 + 补充。
export const CHARACTER_EXT_CARDS: PromptMallCard[] = [
  ...CHARACTER_EXT_HAIR,
  ...CHARACTER_EXT_FACE,
  ...CHARACTER_EXT_IDENTITY,
  ...CHARACTER_EXT_POSE,
  ...CHARACTER_EXT_MORE
];
