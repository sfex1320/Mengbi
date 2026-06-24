import { create } from 'zustand';
import type { PromptMallCard } from './cardTypes';

// 用户自定义卡片：内置库是只读 TS 数据，用户新增的卡片另存 localStorage，运行时与内置库合并。
// 与内置卡片同形（PromptMallCard），可参与分类筛选 / 拖入购物车 / 缩略图（含 genPrompt 可生成）。

const LS = 'mengbi.promptMall.userCards.v1';

function loadCards(): PromptMallCard[] {
  try {
    const raw = localStorage.getItem(LS);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (c): c is PromptMallCard =>
        !!c && typeof c === 'object' && typeof (c as PromptMallCard).id === 'string' && typeof (c as PromptMallCard).cat === 'string'
    );
  } catch {
    return [];
  }
}

function persist(cards: PromptMallCard[]): void {
  try {
    localStorage.setItem(LS, JSON.stringify(cards));
  } catch {
    /* 配额/隐私模式：忽略 */
  }
}

interface MallUserCardsState {
  cards: PromptMallCard[];
  /** 新增（或按 id 覆盖）一张用户卡片；返回落定的卡片。 */
  add: (c: { id?: string; cat: string; sub: string; zh: string; en: string; genPrompt?: string }) => PromptMallCard;
  remove: (id: string) => void;
}

export const useMallUserCardsStore = create<MallUserCardsState>((set, get) => ({
  cards: loadCards(),
  add: (c) => {
    const slug = (c.zh || c.en || 'card').toLowerCase().replace(/[^a-z0-9一-龥]+/g, '-').slice(0, 16) || 'card';
    const id = c.id || `user.${c.cat}.${slug}-${Math.random().toString(36).slice(2, 7)}`;
    const card: PromptMallCard = { id, cat: c.cat, sub: c.sub, zh: c.zh.trim(), en: c.en.trim(), genPrompt: (c.genPrompt ?? '').trim() };
    const cards = [...get().cards.filter((x) => x.id !== id), card];
    persist(cards);
    set({ cards });
    return card;
  },
  remove: (id) => {
    const cards = get().cards.filter((x) => x.id !== id);
    persist(cards);
    set({ cards });
  }
}));
