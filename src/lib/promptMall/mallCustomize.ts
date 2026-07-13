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

// ── localStorage 深度形状校验 ──
// 为什么：buildMallCategories 会对 userCats[i].subs / extraSubs[slug] 做数组展开（[...c.subs]），
// 且它跑在 PromptMallStudio 的 useMemo（渲染期）里——localStorage 里任何一条形状不符的旧数据
// （字段缺失 / 值不是数组）都会让整页在打开商城时抛错、被页面级 ErrorBoundary 兜住（历史「短暂崩溃」）。
// 修法：只在 load() 这个唯一入口做逐条校验/归一，运行期 action 写入的都是完整形状，无需重复防。
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

function normSub(x: unknown): PromptMallSub | null {
  if (!isObj(x) || typeof x.slug !== 'string' || !x.slug) return null;
  const zh = typeof x.zh === 'string' && x.zh ? x.zh : x.slug;
  const en = typeof x.en === 'string' && x.en ? x.en : zh;
  return { slug: x.slug, zh, en };
}

function normSubs(x: unknown): PromptMallSub[] {
  if (!Array.isArray(x)) return [];
  const out: PromptMallSub[] = [];
  for (const s of x) {
    const n = normSub(s);
    if (n) out.push(n);
  }
  return out;
}

function normUserCat(x: unknown): MallUserCategory | null {
  if (!isObj(x) || typeof x.slug !== 'string' || !x.slug) return null;
  const grad: [string, string] =
    Array.isArray(x.grad) && typeof x.grad[0] === 'string' && typeof x.grad[1] === 'string'
      ? [x.grad[0], x.grad[1]]
      : DEFAULT_GRAD;
  return {
    slug: x.slug,
    zh: typeof x.zh === 'string' && x.zh ? x.zh : x.slug,
    subs: normSubs(x.subs),
    grad,
    glyph: typeof x.glyph === 'string' && x.glyph ? x.glyph : 'box'
  };
}

/** 单卡覆盖：只保留类型正确的字段（脏值静默丢弃，卡片回退到内置数据，不崩）。 */
function normOverride(x: unknown): MallCardOverride | null {
  if (!isObj(x)) return null;
  const ov: MallCardOverride = {};
  if (typeof x.cat === 'string') ov.cat = x.cat;
  if (typeof x.sub === 'string') ov.sub = x.sub;
  if (typeof x.zh === 'string') ov.zh = x.zh;
  if (typeof x.en === 'string') ov.en = x.en;
  if (typeof x.genPrompt === 'string') ov.genPrompt = x.genPrompt;
  if (typeof x.hidden === 'boolean') ov.hidden = x.hidden;
  return ov;
}

function load(): Persisted {
  try {
    const raw = localStorage.getItem(LS);
    if (!raw) return EMPTY;
    const v = JSON.parse(raw) as Partial<Persisted>;
    const userCats: MallUserCategory[] = [];
    if (Array.isArray(v.userCats)) {
      for (const c of v.userCats) {
        const n = normUserCat(c);
        if (n) userCats.push(n);
      }
    }
    const extraSubs: Record<string, PromptMallSub[]> = {};
    if (isObj(v.extraSubs)) {
      // 值必须是子类数组，否则整键丢弃（防 buildMallCategories 展开非数组抛错）
      for (const [k, val] of Object.entries(v.extraSubs)) {
        if (Array.isArray(val)) extraSubs[k] = normSubs(val);
      }
    }
    const renameCats: Record<string, string> = {};
    if (isObj(v.renameCats)) {
      for (const [k, val] of Object.entries(v.renameCats)) {
        if (typeof val === 'string' && val) renameCats[k] = val;
      }
    }
    const hiddenCats = Array.isArray(v.hiddenCats) ? v.hiddenCats.filter((x): x is string => typeof x === 'string') : [];
    const overrides: Record<string, MallCardOverride> = {};
    if (isObj(v.overrides)) {
      for (const [k, val] of Object.entries(v.overrides)) {
        const n = normOverride(val);
        if (n) overrides[k] = n;
      }
    }
    return { userCats, extraSubs, renameCats, hiddenCats, overrides };
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
