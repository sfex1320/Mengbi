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
    // 为什么不只查 id/cat：卡片墙搜索会对每张卡的 zh/en/genPrompt 调 .toLowerCase()（渲染期），
    // 旧版本/手改过的 localStorage 条目若缺这些字段会直接抛 TypeError → 整页 ErrorBoundary。
    // 这里把缺失/类型不对的文本字段归一成空串，形状不符的条目整条丢弃。
    const out: PromptMallCard[] = [];
    for (const c of arr) {
      if (!c || typeof c !== 'object') continue;
      const r = c as Record<string, unknown>;
      if (typeof r.id !== 'string' || !r.id || typeof r.cat !== 'string') continue;
      const card: PromptMallCard = {
        id: r.id,
        cat: r.cat,
        sub: typeof r.sub === 'string' ? r.sub : '',
        zh: typeof r.zh === 'string' ? r.zh : '',
        en: typeof r.en === 'string' ? r.en : '',
        genPrompt: typeof r.genPrompt === 'string' ? r.genPrompt : ''
      };
      if (typeof r.thumb === 'string' && r.thumb) card.thumb = r.thumb;
      out.push(card);
    }
    return out;
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
  add: (c: { id?: string; cat: string; sub: string; zh: string; en: string; genPrompt?: string; thumb?: string }) => PromptMallCard;
  remove: (id: string) => void;
}

export const useMallUserCardsStore = create<MallUserCardsState>((set, get) => ({
  cards: loadCards(),
  add: (c) => {
    const slug = (c.zh || c.en || 'card').toLowerCase().replace(/[^a-z0-9一-龥]+/g, '-').slice(0, 16) || 'card';
    const id = c.id || `user.${c.cat}.${slug}-${Math.random().toString(36).slice(2, 7)}`;
    const card: PromptMallCard = { id, cat: c.cat, sub: c.sub, zh: c.zh.trim(), en: c.en.trim(), genPrompt: (c.genPrompt ?? '').trim() };
    if (c.thumb) card.thumb = c.thumb;
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
