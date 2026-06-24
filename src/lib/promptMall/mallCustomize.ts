import { create } from 'zustand';
import { PROMPT_MALL_CATEGORIES, type PromptMallCard, type PromptMallCategory, type PromptMallSub } from './cardTypes';

// 提示词商城「自定义层」：内置分类/卡片是只读 TS 数据，用户对它们的增删改另存 localStorage、运行时叠加。
//   - userCats：用户新增的大类（带自己的子类）
//   - extraSubs：给任意大类（内置或自建）追加的子类
//   - renameCats：内置大类的改名（中文名覆盖）
//   - hiddenCats：被「删除」的内置大类（从分类栏隐藏，卡片仍可搜索）
//   - overrides：按 cardId 覆盖某张卡（移分类/改文案/隐藏）；对内置与用户卡片都生效
// 这样卡片数据文件、cardTypes 完全不动，仍是只读、零迁移。

const LS = 'mengbi.promptMall.customize.v1';

/** 单张卡的覆盖：移分类(cat/sub) / 改文案(zh/en/genPrompt) / 隐藏(hidden) */
export interface MallCardOverride {
  cat?: string;
  sub?: string;
  zh?: string;
  en?: string;
  genPrompt?: string;
  hidden?: boolean;
}

export interface MallUserCategory {
  slug: string;
  zh: string;
  subs: PromptMallSub[];
  grad: [string, string];
  glyph: string;
}

interface Persisted {
  userCats: MallUserCategory[];
  extraSubs: Record<string, PromptMallSub[]>;
  renameCats: Record<string, string>;
  hiddenCats: string[];
  overrides: Record<string, MallCardOverride>;
}

const EMPTY: Persisted = { userCats: [], extraSubs: {}, renameCats: {}, hiddenCats: [], overrides: {} };

function load(): Persisted {
  try {
    const raw = localStorage.getItem(LS);
    if (!raw) return EMPTY;
    const v = JSON.parse(raw) as Partial<Persisted>;
    return {
      userCats: Array.isArray(v.userCats) ? v.userCats : [],
      extraSubs: v.extraSubs && typeof v.extraSubs === 'object' ? v.extraSubs : {},
      renameCats: v.renameCats && typeof v.renameCats === 'object' ? v.renameCats : {},
      hiddenCats: Array.isArray(v.hiddenCats) ? v.hiddenCats : [],
      overrides: v.overrides && typeof v.overrides === 'object' ? v.overrides : {}
    };
  } catch {
    return EMPTY;
  }
}

function save(s: Persisted): void {
  try {
    localStorage.setItem(LS, JSON.stringify(s));
  } catch {
    /* 配额/隐私模式：忽略 */
  }
}

const rid = (p: string): string => `${p}-${Math.random().toString(36).slice(2, 8)}`;
const BUILTIN_SLUGS = new Set(PROMPT_MALL_CATEGORIES.map((c) => c.slug));
const DEFAULT_GRAD: [string, string] = ['#7c83ff', '#46c2ff'];

interface State extends Persisted {
  /** 新增一个用户大类，返回新 slug。 */
  addCategory: (zh: string) => string | null;
  /** 大类改名（内置→renameCats 覆盖；用户→改 userCats）。 */
  renameCategory: (slug: string, zh: string) => void;
  /** 删除大类（用户→移除；内置→hiddenCats 隐藏）。 */
  deleteCategory: (slug: string) => void;
  /** 给某大类追加一个子类，返回新 sub slug。 */
  addSub: (catSlug: string, zh: string) => string | null;
  /** 设置某张卡的覆盖（移分类/改文案）。 */
  setCardOverride: (id: string, patch: MallCardOverride) => void;
  /** 隐藏某张卡（内置「删除」用；用户卡建议直接 useMallUserCardsStore.remove）。 */
  hideCard: (id: string) => void;
}

export const useMallCustomizeStore = create<State>((set, get) => ({
  ...load(),
  addCategory: (zh) => {
    const name = zh.trim();
    if (!name) return null;
    const slug = rid('uc');
    const userCats = [...get().userCats, { slug, zh: name, subs: [], grad: DEFAULT_GRAD, glyph: 'box' }];
    const next = { ...get(), userCats };
    save(next);
    set({ userCats });
    return slug;
  },
  renameCategory: (slug, zh) => {
    const name = zh.trim();
    if (!name) return;
    if (BUILTIN_SLUGS.has(slug)) {
      const renameCats = { ...get().renameCats, [slug]: name };
      save({ ...get(), renameCats });
      set({ renameCats });
    } else {
      const userCats = get().userCats.map((c) => (c.slug === slug ? { ...c, zh: name } : c));
      save({ ...get(), userCats });
      set({ userCats });
    }
  },
  deleteCategory: (slug) => {
    if (BUILTIN_SLUGS.has(slug)) {
      if (get().hiddenCats.includes(slug)) return;
      const hiddenCats = [...get().hiddenCats, slug];
      save({ ...get(), hiddenCats });
      set({ hiddenCats });
    } else {
      const userCats = get().userCats.filter((c) => c.slug !== slug);
      save({ ...get(), userCats });
      set({ userCats });
    }
  },
  addSub: (catSlug, zh) => {
    const name = zh.trim();
    if (!name) return null;
    const slug = rid('us');
    const cur = get().extraSubs[catSlug] ?? [];
    const extraSubs = { ...get().extraSubs, [catSlug]: [...cur, { slug, zh: name, en: name }] };
    save({ ...get(), extraSubs });
    set({ extraSubs });
    return slug;
  },
  setCardOverride: (id, patch) => {
    const cur = get().overrides[id] ?? {};
    const merged = { ...cur, ...patch };
    const overrides = { ...get().overrides, [id]: merged };
    save({ ...get(), overrides });
    set({ overrides });
  },
  hideCard: (id) => {
    get().setCardOverride(id, { hidden: true });
  }
}));

/** 合并出「有效大类列表」（内置去隐藏 + 改名 + 追加子类，再接用户大类）。 */
export function buildMallCategories(s: {
  userCats: MallUserCategory[];
  extraSubs: Record<string, PromptMallSub[]>;
  renameCats: Record<string, string>;
  hiddenCats: string[];
}): PromptMallCategory[] {
  const hidden = new Set(s.hiddenCats);
  const builtin = PROMPT_MALL_CATEGORIES.filter((c) => !hidden.has(c.slug)).map((c) => ({
    ...c,
    zh: s.renameCats[c.slug] ?? c.zh,
    subs: [...c.subs, ...(s.extraSubs[c.slug] ?? [])]
  }));
  const user: PromptMallCategory[] = s.userCats.map((c) => ({
    slug: c.slug,
    zh: c.zh,
    en: c.zh,
    grad: c.grad,
    glyph: c.glyph,
    subs: [...c.subs, ...(s.extraSubs[c.slug] ?? [])]
  }));
  return [...builtin, ...user];
}

/** 对一张卡应用覆盖：返回覆盖后的卡，或 null（被隐藏=删除）。 */
export function applyCardOverride(card: PromptMallCard, ov?: MallCardOverride): PromptMallCard | null {
  if (!ov) return card;
  if (ov.hidden) return null;
  return {
    ...card,
    cat: ov.cat ?? card.cat,
    sub: ov.sub ?? card.sub,
    zh: ov.zh ?? card.zh,
    en: ov.en ?? card.en,
    genPrompt: ov.genPrompt ?? card.genPrompt
  };
}
