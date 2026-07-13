import { create } from 'zustand';
import { localPathToImageUrl } from '@/lib/imageUrl';
import { PROMPT_MALL_CATEGORIES, promptMallCategory, type PromptMallCard, type PromptMallLang } from '@/lib/promptMall/cardTypes';

// 提示词商城缩略图：默认用程序化 SVG 卡片（按大类配色 + 线条图标 + 卡片文字，零版权、即用）。
// 若用户在「缩略图文件夹」里放了 `<cardId>.png/.webp/.jpg`（自行用 ComfyUI / 绘画模型按 genPrompt 批量生成），
// 则优先显示该生成图。文件夹由用户选择（localStorage 记忆），可指向 ComfyUI 输出目录。

const LS_DIR = 'mengbi.promptMall.thumbDir.v1';

interface MallThumbsState {
  dir: string;
  /** cardId → 生成缩略图的本地绝对路径 */
  map: Record<string, string>;
  loading: boolean;
  setDir: (dir: string) => Promise<void>;
  load: () => Promise<void>;
}

/** 从文件名解析 cardId（去掉最后的扩展名；cardId 自身含点号，故只剥最后一段）。 */
function cardIdFromFile(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

export const useMallThumbsStore = create<MallThumbsState>((set, get) => ({
  dir: (typeof localStorage !== 'undefined' && localStorage.getItem(LS_DIR)) || '',
  map: {},
  loading: false,
  setDir: async (dir) => {
    try {
      localStorage.setItem(LS_DIR, dir);
    } catch {
      /* 配额/隐私模式：忽略 */
    }
    set({ dir });
    await get().load();
  },
  load: async () => {
    set({ loading: true });
    try {
      const dirs: string[] = [];
      // 1. 内置缩略图目录（随包发，extraResources，平铺 <cardId>.webp）——默认来源，一次扫描全命中。
      try {
        const b = await window.electronAPI.storage.mallThumbsDir();
        if (b.ok && b.data.dir) dirs.push(b.data.dir);
      } catch {
        /* 无内置目录（如未打包且没跑 build-mall-thumbs）→ 跳过 */
      }
      // 2. 用户自选目录（按大类落子文件夹 <总>/<cat>/<id>.png，兼容旧平铺布局）——后扫，覆盖内置。
      const userDir = get().dir;
      if (userDir) {
        const base = userDir.replace(/[\\/]+$/, '');
        dirs.push(userDir, ...PROMPT_MALL_CATEGORIES.map((c) => `${base}/${c.slug}`));
      }
      if (!dirs.length) {
        set({ map: {} });
        return;
      }
      // listImages 非递归，目录不存在会报错 → 各自吞掉、互不影响。
      const map: Record<string, string> = {};
      const results = await Promise.all(
        dirs.map((d) =>
          window.electronAPI.storage.listImages({ dir: d, kinds: ['image'] }).catch(() => ({ ok: false as const }))
        )
      );
      for (const r of results) {
        if (!r.ok) continue;
        for (const f of r.data.files) {
          if (f.kind === 'video') continue;
          const name = f.path.split(/[\\/]/).pop() ?? '';
          map[cardIdFromFile(name)] = f.path; // 后扫覆盖先扫 → 用户目录覆盖内置
        }
      }
      set({ map });
    } catch {
      /* 目录失效：保留旧 map */
    } finally {
      set({ loading: false });
    }
  }
}));

// ───────────────────────── 程序化缩略图（SVG 渐变 + 线条图标）─────────────────────────

/** 12 个大类线条图标（统一 viewBox 0 0 24 24 / fill none / stroke currentColor）。 */
const GLYPHS: Record<string, JSX.Element> = {
  person: (
    <>
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
    </>
  ),
  shirt: <path d="M8 4l-4 3 2 3 2-1.5V20h8V8.5L18 10l2-3-4-3-2 2.2L10 4z" />,
  brush: (
    <>
      <path d="M4 20c2 0 3-1 3-3 0-1.5-1-2.5-2.5-2.5S2 16 2 18c0 .8.3 1.4.7 2H4z" />
      <path d="M7 16L17 6l3 3L10 19" />
    </>
  ),
  camera: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2.5" />
      <circle cx="12" cy="13.5" r="3.5" />
      <path d="M8 7l1.5-2.5h5L16 7" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" />
    </>
  ),
  palette: (
    <>
      <path d="M12 3a9 9 0 1 0 0 18c1.3 0 2-1 2-2 0-1.5 1-2 2-2h1a4 4 0 0 0 4-4c0-4.5-4-8-9-8z" />
      <circle cx="7.5" cy="11" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="7.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="16.5" cy="11" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  cube: (
    <>
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
      <path d="M12 3v18M4 7.5l8 4.5 8-4.5" />
    </>
  ),
  mountain: <path d="M3 19l6-9 4 6 2.5-3.5L21 19z" />,
  sofa: (
    <>
      <path d="M4 11V9a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2" />
      <rect x="2.5" y="11" width="19" height="6" rx="2" />
      <path d="M5 17v2M19 17v2" />
    </>
  ),
  leaf: (
    <>
      <path d="M5 19c0-8 6-14 14-14 0 8-6 14-14 14z" />
      <path d="M5 19C9 15 13 11 17 8" />
    </>
  ),
  spark: <path d="M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6z" fill="currentColor" stroke="none" />,
  box: (
    <>
      <path d="M12 3l8 4v10l-8 4-8-4V7z" />
      <path d="M4 7l8 4 8-4M12 11v10" />
    </>
  ),
  gauge: (
    <>
      <path d="M4 18a8 8 0 1 1 16 0" />
      <path d="M12 18l4-5" />
    </>
  )
};

/** 简单字符串 hash（同一卡片稳定的色相微调，使同类卡像「一家人」而非完全相同）。 */
function hashHue(id: string): number {
  // (id || '') 兜底：购物车条目来自持久化文档，脏数据 cardId 可能缺失——这里在渲染期跑，绝不能抛
  const s = id || '';
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (Math.abs(h) % 40) - 20; // -20..+19 度
}

/**
 * 提示词商城卡片缩略图：有生成图则显示生成图，否则程序化 SVG（大类渐变 + 线条图标 + 卡片文字）。
 * @param thumbUrl 该卡的生成缩略图本地路径（来自 useMallThumbsStore.map，父级订阅一次后传入）。
 */
export function PromptMallThumb({
  card,
  lang,
  thumbUrl
}: {
  card: PromptMallCard;
  lang: PromptMallLang;
  thumbUrl?: string;
}): JSX.Element {
  const text = (lang === 'zh' ? card.zh : card.en) || card.en || card.zh;
  // 用户卡片自带的缩略图（dataURI，新增卡片时拖入/粘贴/选文件）优先于文件夹生成图
  if (card.thumb) {
    return (
      <div className="mb-sc-mall-thumb is-img">
        <img src={card.thumb} alt={text} loading="lazy" decoding="async" draggable={false} />
        <span className="mb-sc-mall-thumb-cap">{text}</span>
      </div>
    );
  }
  if (thumbUrl) {
    return (
      <div className="mb-sc-mall-thumb is-img">
        <img src={localPathToImageUrl(thumbUrl)} alt={text} loading="lazy" decoding="async" draggable={false} />
        <span className="mb-sc-mall-thumb-cap">{text}</span>
      </div>
    );
  }
  const cat = promptMallCategory(card.cat);
  const [from, to] = cat?.grad ?? ['#8b9bb4', '#4a5a78'];
  const glyph = GLYPHS[cat?.glyph ?? 'gauge'] ?? GLYPHS.gauge;
  return (
    <div
      className="mb-sc-mall-thumb"
      style={{ background: `linear-gradient(135deg, ${from}, ${to})`, filter: `hue-rotate(${hashHue(card.id)}deg)` }}
    >
      <svg className="mb-sc-mall-thumb-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {glyph}
      </svg>
      <span className="mb-sc-mall-thumb-cap">{text}</span>
    </div>
  );
}
