import type { PromptMallCard } from '../cardTypes';
import { CLOTHING_EXT_A } from './clothingExtA';
import { CLOTHING_EXT_B } from './clothingExtB';
import { CLOTHING_EXT_C } from './clothingExtC';
import { CLOTHING_EXT_D } from './clothingExtD';

// 服饰大类「追加」卡片（2026-06-24 扩充，不覆盖原 clothing.ts）。拆 3 个部分文件 + 补充。
export const CLOTHING_EXT_CARDS: PromptMallCard[] = [...CLOTHING_EXT_A, ...CLOTHING_EXT_B, ...CLOTHING_EXT_C, ...CLOTHING_EXT_D];
