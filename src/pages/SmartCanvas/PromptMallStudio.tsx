import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { useSmartCanvasStore, useSmartTextStore } from '@/store/smartCanvasStore';
import { useSettingsStore } from '@/store/settingsStore';
import { computeUpstream, runPromptMallNode, generateMallThumb } from '@/lib/smartCanvasRunner';
import { PROMPT_MALL_CATEGORIES, catLabel, type PromptMallLang, type PromptMallCard } from '@/lib/promptMall/cardTypes';
import { PROMPT_MALL_CARDS } from '@/lib/promptMall/cards';
import { useMallUserCardsStore } from '@/lib/promptMall/userCards';
import { useMallCustomizeStore, buildMallCategories, applyCardOverride } from '@/lib/promptMall/mallCustomize';
import { recommendMallCategories } from '@/lib/promptMall/recommend';
import { PromptMallThumb, useMallThumbsStore } from './promptMall/mallThumbs';
import { buildThumbGenPrompt } from '@/lib/promptMall/thumbGen';
import type { PromptMallNodeData, PromptMallCartItem, PromptMallGroup, SmartNodeData } from '@shared/smartCanvas';
import { areaMenu, copyText, makePromptNodeFrom, useBackdropClose } from './nodeArea';
import { promptDialog } from '@/components/ConfirmDialog';
import { toast } from '@/store/toastStore';

/** 提示词商城工作台开关：哪个商城节点在编辑（null = 不显示）。 */
interface PromptMallStudioState {
  nodeId: string | null;
  open: (nodeId: string) => void;
  close: () => void;
}
export const usePromptMallStudioStore = create<PromptMallStudioState>((set) => ({
  nodeId: null,
  open: (nodeId) => set({ nodeId }),
  close: () => set({ nodeId: null })
}));

const CARD_MIME = 'application/mengbi-mall-card';
const LIBRARY_CAT = '__library';
const STATUS_TEXT: Record<string, string> = { idle: '待运行', running: '运行中…', success: '已完成', error: '失败' };

interface LibRow {
  id: number;
  title: string;
  text: string;
}

/** 把一段文本收藏进提示词库（kind='image'，标题取首行截断）。 */
async function favoriteToLibrary(text: string): Promise<void> {
  const t = text.trim();
  if (!t) {
    toast.info('没有可收藏的文本');
    return;
  }
  const title = (t.split('\n')[0] || '商城提示词').slice(0, 30);
  const r = await window.electronAPI.prompt.upsert({ title, text: t, kind: 'image' });
  if (r.ok) toast.success('已收藏进提示词库', '可在「资产库 → 提示词」查看');
  else toast.error('收藏失败', r.error.message);
}

/** 把图片压成 ≤256px webp dataURI（用作卡片自带缩略图，避免撑爆 localStorage）。 */
function shrinkToThumb(src: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const max = 256;
      const nw = img.naturalWidth || max;
      const nh = img.naturalHeight || max;
      const scale = Math.min(1, max / Math.max(nw, nh));
      const w = Math.max(1, Math.round(nw * scale));
      const h = Math.max(1, Math.round(nh * scale));
      const cv = document.createElement('canvas');
      cv.width = w;
      cv.height = h;
      const ctx = cv.getContext('2d');
      if (!ctx) return reject(new Error('no canvas'));
      ctx.drawImage(img, 0, 0, w, h);
      try {
        resolve(cv.toDataURL('image/webp', 0.85));
      } catch (e) {
        reject(e as Error);
      }
    };
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = src;
  });
}
// 输入弹窗：window.prompt 在 Electron 渲染进程必抛（历史坑），统一走应用内 promptDialog

/** File → dataURI。 */
function fileToDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error('读取失败'));
    fr.readAsDataURL(file);
  });
}

/**
 * 提示词商城工作台：三栏弹窗（左=分类栏 / 中=缩略图卡片墙 / 右=购物车 + 合成）。
 * 拖卡片进购物车则墙上消失；购物车按大类自动排布、可拖动重排；中/英切换控制显示与输出语言。
 * 缩略图默认程序化 SVG，用户可选「缩略图文件夹」放入自行生成的图（按 genPrompt + cardId 命名）。
 */
export function PromptMallStudio(): JSX.Element | null {
  const nodeId = usePromptMallStudioStore((s) => s.nodeId);
  const close = usePromptMallStudioStore((s) => s.close);
  const backdrop = useBackdropClose(close);
  const nodes = useSmartCanvasStore((s) => s.nodes);
  const edges = useSmartCanvasStore((s) => s.edges);
  const update = useSmartCanvasStore((s) => s.updateNodeData);
  const openText = useSmartTextStore((s) => s.open);
  const configs = useSettingsStore((s) => s.configs);

  const thumbMap = useMallThumbsStore((s) => s.map);
  const thumbDir = useMallThumbsStore((s) => s.dir);
  const loadThumbs = useMallThumbsStore((s) => s.load);
  const userCards = useMallUserCardsStore((s) => s.cards);
  const addUserCard = useMallUserCardsStore((s) => s.add);
  const removeUserCard = useMallUserCardsStore((s) => s.remove);

  const [cat, setCat] = useState<string>(PROMPT_MALL_CATEGORIES[0].slug);
  const [sub, setSub] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [custom, setCustom] = useState('');
  const [libRows, setLibRows] = useState<LibRow[]>([]);
  const [gen, setGen] = useState<{ running: boolean; done: number; total: number }>({ running: false, done: 0, total: 0 });
  const [overwrite, setOverwrite] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [nc, setNc] = useState({ cat: 'character', sub: 'gender-age', zh: '', en: '', genPrompt: '' });
  // 新增卡片时自带的缩略图（拖入/粘贴/选文件 → 压缩后的 dataURI）
  const [ncThumb, setNcThumb] = useState<string | null>(null);
  const stopGen = useRef(false);
  const dragUid = useRef<string | null>(null);
  const thumbFileRef = useRef<HTMLInputElement>(null);
  const [editGroup, setEditGroup] = useState<string | null>(null);

  const node = nodeId ? nodes.find((n) => n.id === nodeId) : undefined;
  const d = node?.type === 'prompt-mall' ? (node.data as unknown as PromptMallNodeData) : null;
  const setF = (p: Partial<PromptMallNodeData>): void => {
    if (nodeId) update(nodeId, p as Partial<SmartNodeData>);
  };
  const lang: PromptMallLang = d?.lang === 'en' ? 'en' : 'zh';
  // Array.isArray 兜底：cart/groups 来自持久化画布文档，损坏/旧版形状（非数组）会让下面的 map/filter 在渲染期抛错
  const cart = Array.isArray(d?.cart) ? d.cart : [];
  const groups: PromptMallGroup[] = Array.isArray(d?.groups) && d.groups.length ? d.groups : [{ id: 'g1', name: '组 1' }];
  const groupIds = useMemo(() => new Set(groups.map((g) => g.id)), [groups]);
  const activeGroup = d?.activeGroup && groupIds.has(d.activeGroup) ? d.activeGroup : groups[0].id;
  const exclusive = d?.exclusive !== false;
  /** 条目实际归属的分组（group 缺失或指向已删组 → 落到第一组）。 */
  const resolved = (it: PromptMallCartItem): string => (it.group && groupIds.has(it.group) ? it.group : groups[0].id);
  /** 每张卡片被用了几次（跨所有分组），驱动卡片墙右下角「×N」角标。 */
  const usageCount = useMemo(() => {
    const m: Record<string, number> = {};
    for (const it of cart) m[it.cardId] = (m[it.cardId] ?? 0) + 1;
    return m;
  }, [cart]);
  // 自定义层（分类/卡片的增删改叠加在只读内置数据之上）
  const userCats = useMallCustomizeStore((s) => s.userCats);
  const extraSubs = useMallCustomizeStore((s) => s.extraSubs);
  const renameCats = useMallCustomizeStore((s) => s.renameCats);
  const hiddenCats = useMallCustomizeStore((s) => s.hiddenCats);
  const overrides = useMallCustomizeStore((s) => s.overrides);

  /** 有效大类（内置去隐藏 + 改名 + 追加子类，再接用户大类） */
  const categories = useMemo(
    () => buildMallCategories({ userCats, extraSubs, renameCats, hiddenCats }),
    [userCats, extraSubs, renameCats, hiddenCats]
  );
  /** 有效卡片（内置+用户，按 overrides 移分类/改文案/隐藏后） */
  const allCards = useMemo(() => {
    const out: PromptMallCard[] = [];
    for (const c of [...PROMPT_MALL_CARDS, ...userCards]) {
      const e = applyCardOverride(c, overrides[c.id]);
      if (e) out.push(e);
    }
    return out;
  }, [userCards, overrides]);
  const catCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of allCards) m[c.cat] = (m[c.cat] ?? 0) + 1;
    return m;
  }, [allCards]);
  const userIds = useMemo(() => new Set(userCards.map((c) => c.id)), [userCards]);

  // ── 卡片管理：多选 / 编辑 / 按描述推荐分类 ──
  const [multiSel, setMultiSel] = useState(false);
  const [selCards, setSelCards] = useState<Set<string>>(new Set());
  const [editCard, setEditCard] = useState<{ id: string; zh: string; en: string; genPrompt: string } | null>(null);
  const [desc, setDesc] = useState('');
  const [recommending, setRecommending] = useState(false);
  const [recommended, setRecommended] = useState<Set<string>>(new Set());
  // 推荐命中的子类（键 `大类slug/子类slug`）：高亮子类 chip
  const [recommendedSubs, setRecommendedSubs] = useState<Set<string>>(new Set());

  const up = useMemo(
    () => (nodeId && d ? computeUpstream(nodes, edges, nodeId) : { images: [], prompts: [], refs: [], videos: [], sizes: [] }),
    [nodes, edges, nodeId, d]
  );

  const textModels = useMemo(() => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const c of configs) {
      if (c.type !== 'text') continue;
      for (const n of Object.keys(c.model_mapping ?? {})) if (!seen.has(n)) { seen.add(n); out.push(n); }
    }
    return out;
  }, [configs]);
  const imageModels = useMemo(() => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const c of configs) {
      if (c.type !== 'image') continue;
      for (const n of Object.keys(c.model_mapping ?? {})) if (!seen.has(n)) { seen.add(n); out.push(n); }
    }
    return out;
  }, [configs]);
  const [genModel, setGenModel] = useState('');
  useEffect(() => {
    if (!genModel && imageModels.length) setGenModel(imageModels[0]);
  }, [imageModels, genModel]);

  // Esc 关闭 + 节点删除自动关 + 打开时刷新缩略图
  useEffect(() => {
    if (!nodeId) return;
    void loadThumbs();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nodeId, close, loadThumbs]);
  useEffect(() => {
    if (nodeId && !d) close();
  }, [nodeId, d, close]);

  // 选「我的提示词库」时按需加载用户提示词
  useEffect(() => {
    if (cat !== LIBRARY_CAT) return;
    let alive = true;
    void window.electronAPI.prompt.list({}).then((r) => {
      if (!alive || !r.ok) return;
      const rows = (r.data as Array<Record<string, unknown>>).map((x) => ({
        id: Number(x.id),
        title: String(x.title ?? ''),
        text: String(x.text ?? '')
      }));
      setLibRows(rows);
    });
    return () => {
      alive = false;
    };
  }, [cat]);

  if (!nodeId || !d) return null;

  // ── 分组操作（图片的组成部分）──
  const newUid = (cardId: string): string => `${cardId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  function addGroup(): void {
    const id = `g${Date.now().toString(36)}`;
    setF({ groups: [...groups, { id, name: `组 ${groups.length + 1}` }], activeGroup: id });
  }
  function renameGroup(id: string, name: string): void {
    setF({ groups: groups.map((g) => (g.id === id ? { ...g, name } : g)) });
  }
  function deleteGroup(id: string): void {
    if (groups.length <= 1) return;
    const remaining = groups.filter((g) => g.id !== id);
    const fallback = remaining[0].id;
    setF({
      groups: remaining,
      cart: cart.map((it) => (resolved(it) === id ? { ...it, group: fallback } : it)),
      activeGroup: activeGroup === id ? fallback : activeGroup
    });
  }
  function setActiveGroup(id: string): void {
    setF({ activeGroup: id });
  }

  // ── 购物车操作（分组 + 排斥）──
  /** 加卡到指定组：排斥开启时先移除该组内同 (cat,sub) 的旧卡（自定义/上游片段不参与排斥）。 */
  function addCardToGroup(card: { id: string; cat: string; sub: string; zh: string; en: string; custom?: boolean }, groupId: string): void {
    if (!card.id) return;
    const item: PromptMallCartItem = {
      uid: newUid(card.id),
      cardId: card.id,
      cat: card.cat,
      sub: card.sub,
      zh: card.zh,
      en: card.en,
      group: groupId,
      ...(card.custom ? { custom: true } : {})
    };
    const exclusable = exclusive && !item.custom && card.cat !== '_custom' && card.cat !== '_upstream';
    const next = exclusable
      ? cart.filter((it) => !(resolved(it) === groupId && it.cat === card.cat && it.sub === card.sub && !it.custom))
      : cart;
    setF({ cart: [...next, item] });
  }
  function addCardById(cardId: string): void {
    const c = allCards.find((x) => x.id === cardId);
    if (!c) return;
    addCardToGroup({ id: c.id, cat: c.cat, sub: c.sub, zh: c.zh, en: c.en }, activeGroup);
  }
  function saveNewCard(): void {
    const zh = nc.zh.trim();
    const en = nc.en.trim();
    if (!zh && !en) {
      toast.info('请至少填中文或英文片段');
      return;
    }
    const subSlug = nc.sub || categories.find((c) => c.slug === nc.cat)?.subs[0]?.slug || '';
    addUserCard({ cat: nc.cat, sub: subSlug, zh: zh || en, en: en || zh, genPrompt: nc.genPrompt, thumb: ncThumb ?? undefined });
    toast.success('已新增卡片', ncThumb ? '已带自定义缩略图，在该分类里可拖入购物车' : '在该分类里可找到并拖入购物车');
    setNc({ ...nc, zh: '', en: '', genPrompt: '' });
    setNcThumb(null);
  }
  /** 设置新卡缩略图：File（拖入/选文件/粘贴）→ 压成 ≤256px webp dataURI。 */
  async function setThumbFromFile(file: File | null | undefined): Promise<void> {
    if (!file || !file.type.startsWith('image/')) return;
    try {
      const uri = await fileToDataUri(file);
      setNcThumb(await shrinkToThumb(uri));
    } catch {
      toast.error('图片读取失败', '换一张图试试');
    }
  }

  // ── 分类管理（增 / 改 / 删；删=用户类移除、内置类隐藏）──
  function addCategory(): void {
    void promptDialog({ message: '新建分类名称' }).then((name) => {
      if (!name?.trim()) return;
      const slug = useMallCustomizeStore.getState().addCategory(name);
      if (slug) {
        setCat(slug);
        setSub('all');
        toast.success('已新建分类', '可在「➕ 新增卡片」里把卡片归到它');
      }
    });
  }
  function renameCategory(slug: string): void {
    const cur = categories.find((c) => c.slug === slug);
    void promptDialog({ message: '重命名分类', initial: cur?.zh ?? '' }).then((name) => {
      if (name?.trim()) useMallCustomizeStore.getState().renameCategory(slug, name);
    });
  }
  function deleteCategory(slug: string): void {
    const isBuiltin = PROMPT_MALL_CATEGORIES.some((c) => c.slug === slug);
    void confirmRemoveCategory(slug, isBuiltin);
  }
  async function confirmRemoveCategory(slug: string, isBuiltin: boolean): Promise<void> {
    const name = categories.find((c) => c.slug === slug)?.zh ?? slug;
    const ok = window.confirm(isBuiltin ? `隐藏内置分类「${name}」？（卡片仍可搜索，可日后恢复）` : `删除自定义分类「${name}」？`);
    if (!ok) return;
    useMallCustomizeStore.getState().deleteCategory(slug);
    if (cat === slug) setCat(categories[0]?.slug ?? PROMPT_MALL_CATEGORIES[0].slug);
    toast.success(isBuiltin ? '已隐藏分类' : '已删除分类');
  }
  function addSubToActive(): void {
    void promptDialog({ message: '给当前分类新增子类' }).then((name) => {
      if (name?.trim()) useMallCustomizeStore.getState().addSub(cat, name);
    });
  }

  // ── 卡片管理（移分类 / 移子类 / 编辑 / 删除 / 多选批量）──
  // subSlug 省略=移到大类（清空子类）；传入=连子类一起改（拖到子类 chip / 右键「移到子类」用）
  function moveCardToCategory(cardId: string, catSlug: string, subSlug = ''): void {
    useMallCustomizeStore.getState().setCardOverride(cardId, { cat: catSlug, sub: subSlug });
  }
  function deleteCard(cardId: string): void {
    if (userIds.has(cardId)) removeUserCard(cardId);
    else useMallCustomizeStore.getState().hideCard(cardId);
  }
  function saveEditCard(): void {
    if (!editCard) return;
    const zh = editCard.zh.trim();
    const en = editCard.en.trim();
    if (!zh && !en) {
      toast.info('中/英片段不能都为空');
      return;
    }
    useMallCustomizeStore.getState().setCardOverride(editCard.id, {
      zh: zh || en,
      en: en || zh,
      genPrompt: editCard.genPrompt.trim()
    });
    setEditCard(null);
    toast.success('卡片已更新');
  }
  function toggleSelCard(id: string): void {
    setSelCards((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function clearSel(): void {
    setSelCards(new Set());
  }
  function batchMoveSelected(catSlug: string, subSlug = ''): void {
    const cz = useMallCustomizeStore.getState();
    for (const id of selCards) cz.setCardOverride(id, { cat: catSlug, sub: subSlug });
    toast.success(`已移动 ${selCards.size} 张卡片`);
    clearSel();
    setMultiSel(false);
  }
  function batchDeleteSelected(): void {
    if (!window.confirm(`删除/隐藏选中的 ${selCards.size} 张卡片？`)) return;
    for (const id of selCards) deleteCard(id);
    toast.success(`已删除 ${selCards.size} 张卡片`);
    clearSel();
    setMultiSel(false);
  }
  /** 卡片右键统一菜单（单选态用）：加入组 / 编辑 / 移到分类 / 移到子类 / 删除。 */
  function cardMenu(e: React.MouseEvent, c: PromptMallCard): void {
    const ownCat = categories.find((g) => g.slug === c.cat);
    areaMenu(e, [
      { label: `加入「${groups.find((g) => g.id === activeGroup)?.name ?? '组'}」`, onClick: () => addCardById(c.id) },
      { label: '编辑卡片…', onClick: () => setEditCard({ id: c.id, zh: c.zh, en: c.en, genPrompt: c.genPrompt }) },
      {
        label: '移到分类…',
        children: categories
          .filter((g) => g.slug !== c.cat)
          .map((g) => ({ label: g.zh, onClick: () => moveCardToCategory(c.id, g.slug) }))
      },
      // 移到本大类的某个子类（新建子分类后用它把卡片归进去）
      ...(ownCat && ownCat.subs.length
        ? [
            {
              label: '移到子类…',
              children: ownCat.subs
                .filter((s) => s.slug !== c.sub)
                .map((s) => ({ label: s.zh, onClick: () => moveCardToCategory(c.id, c.cat, s.slug) }))
            }
          ]
        : []),
      { label: userIds.has(c.id) ? '删除卡片' : '删除（隐藏）卡片', onClick: () => deleteCard(c.id) }
    ]);
  }
  /** 描述 → 推荐分类（LLM）：高亮命中的分类，点击即跳过去。 */
  async function runRecommend(): Promise<void> {
    if (!desc.trim() || recommending) return;
    setRecommending(true);
    const r = await recommendMallCategories(
      desc,
      categories.map((c) => ({ slug: c.slug, zh: c.zh, subs: c.subs.map((s) => ({ slug: s.slug, zh: s.zh })) })),
      d?.modelId || undefined
    );
    setRecommending(false);
    if (!r.ok) {
      toast.error('推荐失败', r.reason);
      return;
    }
    setRecommended(new Set(r.result.slugs));
    setRecommendedSubs(new Set(r.result.subKeys));
    // 自动跳到第一个推荐分类（优先有推荐子类的那个，并切到该子类）
    const firstSub = r.result.subKeys[0];
    if (firstSub) {
      const [c, s] = firstSub.split('/');
      setCat(c);
      setSub(s);
      setQuery('');
    } else if (r.result.slugs[0]) {
      setCat(r.result.slugs[0]);
      setSub('all');
      setQuery('');
    }
    toast.success(`推荐 ${r.result.slugs.length} 个分类 · ${r.result.subKeys.length} 个子类`, '已高亮，点击切换查看');
  }
  function removeByUid(uid: string): void {
    setF({ cart: cart.filter((it) => it.uid !== uid) });
  }
  /** 把 srcUid 移到 targetUid 之前，并归到 target 所在组（支持跨组拖动重排）。 */
  function moveBeforeUid(srcUid: string, targetUid: string): void {
    if (srcUid === targetUid) return;
    const arr = cart.slice();
    const fi = arr.findIndex((c) => c.uid === srcUid);
    const target = arr.find((c) => c.uid === targetUid);
    if (fi < 0 || !target) return;
    const [m] = arr.splice(fi, 1);
    m.group = resolved(target);
    const ti = arr.findIndex((c) => c.uid === targetUid);
    arr.splice(ti < 0 ? arr.length : ti, 0, m);
    setF({ cart: arr });
  }
  /** 把 srcUid 移到某组末尾（拖到组容器空白处时）。 */
  function moveToGroupEnd(srcUid: string, groupId: string): void {
    const arr = cart.slice();
    const fi = arr.findIndex((c) => c.uid === srcUid);
    if (fi < 0) return;
    const [m] = arr.splice(fi, 1);
    m.group = groupId;
    arr.push(m);
    setF({ cart: arr });
  }
  function clearCart(): void {
    setF({ cart: [] });
  }
  function addCustomFragment(): void {
    const t = custom.trim();
    if (!t) return;
    addCardToGroup({ id: `custom-${Date.now()}`, cat: '_custom', sub: '', zh: t, en: t, custom: true }, activeGroup);
    setCustom('');
  }

  // ── 中间卡片墙（按分类/子类/搜索过滤，已入车的剔除）──
  const q = query.trim().toLowerCase();
  const gridCards =
    cat === LIBRARY_CAT
      ? []
      : allCards.filter((c) => {
          // 拖进购物车后卡片不再从墙上消失（用右下角「×N」角标提示用了几次）
          if (!q) {
            if (c.cat !== cat) return false;
            if (sub !== 'all' && c.sub !== sub) return false;
            return true;
          }
          // (x || '') 兜底：这段过滤跑在渲染期，任何一张脏卡（字段缺失）抛错都会打崩整页
          return (c.zh || '').toLowerCase().includes(q) || (c.en || '').toLowerCase().includes(q) || (c.genPrompt || '').toLowerCase().includes(q);
        }).slice(0, 400);

  const activeCat = categories.find((c) => c.slug === cat);
  const cartCats = new Set(cart.map((c) => c.cat));

  // ── 缩略图批量生成（用绘画模型，逐卡，可停）──
  async function batchGenThumbs(): Promise<void> {
    if (!thumbDir) {
      toast.error('先选择缩略图文件夹', '生成的缩略图会落到该文件夹（也可指向 ComfyUI 输出目录）');
      return;
    }
    if (!genModel) {
      toast.error('先选一个绘画模型');
      return;
    }
    const pool = cat === LIBRARY_CAT ? allCards : allCards.filter((c) => c.cat === cat);
    const targets = overwrite ? pool : pool.filter((c) => !thumbMap[c.id]);
    if (!targets.length) {
      toast.info(overwrite ? '该分类没有卡片' : '该分类缩略图已齐全', '换个分类，或勾「覆盖已有」重生成');
      return;
    }
    stopGen.current = false;
    setGen({ running: true, done: 0, total: targets.length });
    for (let i = 0; i < targets.length; i++) {
      if (stopGen.current) break;
      const c = targets[i];
      const r = await generateMallThumb(c, genModel, thumbDir, overwrite);
      if (!r.ok) {
        toast.error(`「${c.zh}」缩略图生成失败`, r.error);
        break; // 失败即止（多半是模型/配额问题，避免连环烧钱）
      }
      setGen({ running: true, done: i + 1, total: targets.length });
      await loadThumbs();
    }
    setGen((g) => ({ ...g, running: false }));
  }

  function exportGenList(): void {
    const targets = cat === LIBRARY_CAT ? allCards : allCards.filter((c) => c.cat === cat);
    const payload = {
      format: 'mengbi-prompt-mall-thumbs',
      note: '把每条 genPrompt 喂给 ComfyUI / 绘画模型生成方图，导出文件命名为 <id>.png 放进缩略图总文件夹或其 <分类> 子文件夹即可被识别',
      cards: targets.map((c) => ({ id: c.id, zh: c.zh, en: c.en, genPrompt: buildThumbGenPrompt(c) }))
    };
    void window.electronAPI.storage.saveAs({
      dataUri: `data:application/json;base64,${btoa(unescape(encodeURIComponent(JSON.stringify(payload, null, 2))))}`,
      defaultName: `prompt-mall-thumbs-${cat}.json`
    });
  }

  async function pickThumbDir(): Promise<void> {
    const r = await window.electronAPI.storage.selectFolder();
    if (r.ok && r.data) await useMallThumbsStore.getState().setDir(r.data.path);
  }

  return createPortal(
    <div className="mb-modal-backdrop" {...backdrop}>
      <div className="mb-modal mb-sc-studio mb-sc-mallstudio mb-card" onClick={(e) => e.stopPropagation()}>
        <div className="mb-sc-studio-head">
          <h3>提示词商城</h3>
          <span className={`mb-sc-status is-${d.status}`}>{STATUS_TEXT[d.status] ?? d.status}</span>
          <span className="mb-sc-studio-hint">逛店选购式提示词构建 · 拖卡片进右侧购物车 → 合成一条提示词</span>
          <button className="mb-sc-node-x" title="关闭（Esc）" onClick={close}>
            ✕
          </button>
        </div>

        <div className="mb-sc-studio-body">
          {/* 左：分类栏 */}
          <div className="mb-sc-studio-left mb-sc-mall-rail">
            <input
              className="mb-input mb-sc-mall-search"
              placeholder="搜索全部片段…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="mb-sc-mall-cats mb-dragscroll">
              {categories.map((c) => (
                <button
                  key={c.slug}
                  className={`mb-sc-mall-cat ${cat === c.slug && !q ? 'is-on' : ''} ${recommended.has(c.slug) ? 'is-recommended' : ''}`}
                  onClick={() => {
                    setCat(c.slug);
                    setSub('all');
                    setQuery('');
                  }}
                  onContextMenu={(e) =>
                    areaMenu(e, [
                      { label: '重命名…', onClick: () => renameCategory(c.slug) },
                      { label: '新增子类…', onClick: () => addSubToActive() },
                      {
                        label: PROMPT_MALL_CATEGORIES.some((b) => b.slug === c.slug) ? '隐藏分类' : '删除分类',
                        onClick: () => deleteCategory(c.slug)
                      }
                    ])
                  }
                  // 把卡片拖到分类上 = 改该卡分类（支持多选批量）
                  onDragOver={(e) => {
                    if (e.dataTransfer.types.includes(CARD_MIME)) e.preventDefault();
                  }}
                  onDrop={(e) => {
                    const raw = e.dataTransfer.getData(CARD_MIME);
                    if (!raw) return;
                    e.preventDefault();
                    try {
                      const { cardId } = JSON.parse(raw) as { cardId: string };
                      if (multiSel && selCards.size > 0) {
                        batchMoveSelected(c.slug);
                      } else {
                        moveCardToCategory(cardId, c.slug);
                        toast.success(`已移到「${c.zh}」`);
                      }
                    } catch {
                      /* ignore */
                    }
                  }}
                  title="单击查看 · 右键重命名/删除 · 把卡片拖到这里可改其分类"
                >
                  <span className="mb-sc-mall-cat-name">{c.zh}</span>
                  <span className="mb-sc-mall-cat-cnt">{catCounts[c.slug] ?? 0}</span>
                  {cartCats.has(c.slug) && <span className="mb-sc-mall-cat-dot" aria-hidden />}
                </button>
              ))}
              <button
                className={`mb-sc-mall-cat ${cat === LIBRARY_CAT ? 'is-on' : ''}`}
                onClick={() => {
                  setCat(LIBRARY_CAT);
                  setQuery('');
                }}
              >
                <span className="mb-sc-mall-cat-name">📚 我的提示词库</span>
              </button>
            </div>
            <button className="mb-btn mb-btn-xs mb-btn-ghost mb-sc-mall-addcat" onClick={addCategory}>
              ➕ 新建分类
            </button>
            {/* 按描述推荐分类（LLM） */}
            <div className="mb-sc-mall-recommend">
              <textarea
                className="mb-textarea mb-sc-mall-descbox nowheel"
                placeholder="描述你想做的图（如：复古港风女生半身照），AI 帮你推荐分类…"
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                rows={2}
              />
              <button
                className="mb-btn mb-btn-xs mb-btn-primary"
                disabled={recommending || !desc.trim()}
                onClick={() => void runRecommend()}
              >
                {recommending ? '识别中…' : '✨ 推荐分类'}
              </button>
              {(recommended.size > 0 || recommendedSubs.size > 0) && (
                <button
                  className="mb-btn mb-btn-xs mb-btn-ghost"
                  onClick={() => {
                    setRecommended(new Set());
                    setRecommendedSubs(new Set());
                  }}
                >
                  清除高亮
                </button>
              )}
            </div>
          </div>

          {/* 中：缩略图卡片墙 */}
          <div
            className="mb-sc-studio-center mb-sc-mall-center"
            // 把购物车里的卡片拖回卡片墙 = 从购物车移除（拖出即删）
            onDragOver={(e) => {
              if (dragUid.current && !e.dataTransfer.types.includes(CARD_MIME)) e.preventDefault();
            }}
            onDrop={(e) => {
              if (dragUid.current && !e.dataTransfer.types.includes(CARD_MIME)) {
                e.preventDefault();
                removeByUid(dragUid.current);
                dragUid.current = null;
                toast.success('已从购物车移除');
              }
            }}
          >
            {/* 子类筛选 + 缩略图工具条 */}
            {activeCat && !q && cat !== LIBRARY_CAT && (
              <div className="mb-sc-mall-subs">
                <button className={`mb-sc-mall-subchip ${sub === 'all' ? 'is-on' : ''}`} onClick={() => setSub('all')}>
                  全部
                </button>
                {activeCat.subs.map((s) => (
                  <button
                    key={s.slug}
                    className={`mb-sc-mall-subchip ${sub === s.slug ? 'is-on' : ''} ${recommendedSubs.has(`${cat}/${s.slug}`) ? 'is-recommended' : ''}`}
                    onClick={() => setSub(s.slug)}
                    // 把卡片拖到子类 chip = 归到该子类（新建子类后用它装卡片）
                    onDragOver={(e) => {
                      if (e.dataTransfer.types.includes(CARD_MIME)) e.preventDefault();
                    }}
                    onDrop={(e) => {
                      const raw = e.dataTransfer.getData(CARD_MIME);
                      if (!raw) return;
                      e.preventDefault();
                      try {
                        const { cardId } = JSON.parse(raw) as { cardId: string };
                        if (multiSel && selCards.size > 0) batchMoveSelected(cat, s.slug);
                        else {
                          moveCardToCategory(cardId, cat, s.slug);
                          toast.success(`已移到「${s.zh}」子类`);
                        }
                      } catch {
                        /* ignore */
                      }
                    }}
                    title="单击筛选 · 把卡片拖到这里可归到该子类"
                  >
                    {s.zh}
                  </button>
                ))}
              </div>
            )}

            <div className="mb-sc-mall-thumbbar">
              <span className="mb-sc-mall-thumbdir" title={thumbDir || '未设置'}>
                缩略图文件夹：{thumbDir ? thumbDir.split(/[\\/]/).pop() : '未设置（用程序化卡片）'}
              </span>
              <button className="mb-btn mb-btn-xs mb-btn-ghost" onClick={() => void pickThumbDir()}>选择文件夹</button>
              <button className="mb-btn mb-btn-xs mb-btn-ghost" onClick={() => void loadThumbs()}>刷新</button>
              <label className="mb-sc-mall-opt" title="勾选=连已有缩略图的卡片也重新生成并覆盖（改了 genPrompt 后整套刷新用）">
                <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
                覆盖已有
              </label>
              <button className="mb-btn mb-btn-xs mb-btn-ghost" onClick={exportGenList} title="导出该分类全部 genPrompt（自行用 ComfyUI 批量生成）">导出生成清单</button>
              <button
                className={`mb-btn mb-btn-xs ${multiSel ? 'mb-btn-primary' : 'mb-btn-ghost'}`}
                onClick={() => {
                  setMultiSel((v) => !v);
                  clearSel();
                }}
                title="多选模式：点卡片勾选，可批量改分类 / 删除"
              >
                {multiSel ? '退出多选' : '☑ 多选'}
              </button>
              {imageModels.length > 0 && (
                <>
                  <select className="mb-select mb-sc-mall-genmodel" value={genModel} onChange={(e) => setGenModel(e.target.value)}>
                    {imageModels.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                  {gen.running ? (
                    <button className="mb-btn mb-btn-xs is-stop" onClick={() => (stopGen.current = true)}>
                      停止 {gen.done}/{gen.total}
                    </button>
                  ) : (
                    <button className="mb-btn mb-btn-xs" onClick={() => void batchGenThumbs()} title="用绘画模型按 genPrompt 生成本分类缺失的缩略图（也会进资产库）">
                      生成本类缩略图
                    </button>
                  )}
                </>
              )}
            </div>

            {multiSel && (
              <div className="mb-sc-mall-batchbar">
                <span>已选 <b>{selCards.size}</b> 张</span>
                <button
                  className="mb-btn mb-btn-xs mb-btn-ghost"
                  disabled={selCards.size === 0}
                  onClick={(e) =>
                    areaMenu(
                      e,
                      categories.map((g) => ({ label: g.zh, onClick: () => batchMoveSelected(g.slug) }))
                    )
                  }
                >
                  移到分类…
                </button>
                <button className="mb-btn mb-btn-xs is-stop" disabled={selCards.size === 0} onClick={batchDeleteSelected}>
                  删除选中
                </button>
                <button className="mb-btn mb-btn-xs mb-btn-ghost" disabled={selCards.size === 0} onClick={clearSel}>
                  清除选择
                </button>
              </div>
            )}

            {cat === LIBRARY_CAT ? (
              <div className="mb-sc-mall-grid mb-sc-mall-libgrid">
                {libRows.length === 0 && <div className="mb-sc-empty">提示词库为空（在「资产库 → 提示词」里添加，或在购物车右键「收藏进提示词库」）</div>}
                {libRows.map((row) => (
                  <button
                    key={row.id}
                    className="mb-sc-mall-libcard"
                    title={row.text}
                    onClick={() => addCardToGroup({ id: `lib-${row.id}`, cat: '_custom', sub: '', zh: row.text, en: row.text, custom: true }, activeGroup)}
                  >
                    <b>{row.title || '提示词'}</b>
                    <span>{row.text.slice(0, 60)}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="mb-sc-mall-grid">
                {gridCards.length === 0 && <div className="mb-sc-empty">该分类卡片都在购物车里了，或搜索无结果</div>}
                {gridCards.map((c) => {
                  const used = usageCount[c.id] ?? 0;
                  const isSel = selCards.has(c.id);
                  return (
                    <div
                      key={c.id}
                      className={`mb-sc-mall-card ${used > 0 ? 'is-used' : ''} ${multiSel && isSel ? 'is-selected' : ''}`}
                      draggable={!multiSel}
                      onDragStart={(e) => {
                        // 拖拽载荷既给购物车（加卡）也给左侧分类栏（改分类）识别
                        e.dataTransfer.setData(CARD_MIME, JSON.stringify({ cardId: c.id }));
                        e.dataTransfer.effectAllowed = 'copyMove';
                      }}
                      onClick={() => (multiSel ? toggleSelCard(c.id) : addCardById(c.id))}
                      onContextMenu={(e) => cardMenu(e, c)}
                      title={`${c.zh} / ${c.en}${userIds.has(c.id) ? '\n（自定义卡片）' : ''}\n${
                        multiSel ? '点击勾选 / 取消' : '点击加入购物车 · 拖到左侧分类可改分类 · 右键更多'
                      }`}
                    >
                      <PromptMallThumb card={c} lang={lang} thumbUrl={thumbMap[c.id]} />
                      {used > 0 && <span className="mb-sc-mall-usebadge" title={`已加入购物车 ${used} 次`}>×{used}</span>}
                      {multiSel && <span className={`mb-sc-mall-selbox ${isSel ? 'is-on' : ''}`}>{isSel ? '✓' : ''}</span>}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="mb-sc-mall-customrow">
              <input
                className="mb-input"
                placeholder="+ 自定义片段（直接输入，回车加入购物车）"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addCustomFragment();
                }}
              />
              <button className="mb-btn mb-btn-sm" onClick={addCustomFragment}>加入</button>
              <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={() => setAddOpen((o) => !o)}>
                {addOpen ? '收起' : '➕ 新增卡片'}
              </button>
            </div>
            {addOpen && (
              <div className="mb-sc-mall-addform">
                <div className="mb-sc-mall-addrow">
                  {/* 左侧：缩略图方框（拖入 / 聚焦后粘贴 Ctrl+V / 点击选文件）；不填则用程序化卡片 */}
                  <div
                    className={`mb-sc-mall-thumbbox ${ncThumb ? 'has-img' : ''}`}
                    tabIndex={0}
                    title="卡片缩略图：拖入图片 / 聚焦后粘贴(Ctrl+V) / 点击选择文件（不填则用默认程序化卡片）"
                    onDragOver={(e) => {
                      if (Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      void setThumbFromFile(e.dataTransfer.files?.[0]);
                    }}
                    onPaste={(e) => {
                      const f = Array.from(e.clipboardData?.files ?? [])[0];
                      if (f) {
                        e.preventDefault();
                        void setThumbFromFile(f);
                      }
                    }}
                    onClick={() => thumbFileRef.current?.click()}
                  >
                    {ncThumb ? (
                      <>
                        <img src={ncThumb} alt="缩略图" draggable={false} />
                        <button
                          className="mb-sc-mall-thumbclear"
                          title="清除缩略图"
                          onClick={(e) => {
                            e.stopPropagation();
                            setNcThumb(null);
                          }}
                        >
                          ✕
                        </button>
                      </>
                    ) : (
                      <span className="mb-sc-mall-thumbhint">＋ 缩略图<br />拖入 / 粘贴 / 选文件</span>
                    )}
                    <input
                      ref={thumbFileRef}
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={(e) => {
                        void setThumbFromFile(e.target.files?.[0]);
                        e.target.value = '';
                      }}
                    />
                  </div>
                  {/* 右侧：分类 / 子类 / 中英片段 / 生成提示词 */}
                  <div className="mb-sc-mall-addfields">
                    <div className="mb-sc-mall-addgrid">
                      <select
                        className="mb-select"
                        value={nc.cat}
                        onChange={(e) =>
                          setNc({ ...nc, cat: e.target.value, sub: categories.find((c) => c.slug === e.target.value)?.subs[0]?.slug ?? '' })
                        }
                      >
                        {categories.map((c) => (
                          <option key={c.slug} value={c.slug}>{c.zh}</option>
                        ))}
                      </select>
                      <select className="mb-select" value={nc.sub} onChange={(e) => setNc({ ...nc, sub: e.target.value })}>
                        {(categories.find((c) => c.slug === nc.cat)?.subs ?? []).map((s) => (
                          <option key={s.slug} value={s.slug}>{s.zh}</option>
                        ))}
                      </select>
                    </div>
                    <input className="mb-input" placeholder="中文片段（如 波浪长发）" value={nc.zh} onChange={(e) => setNc({ ...nc, zh: e.target.value })} />
                    <input className="mb-input" placeholder="English fragment (e.g. long wavy hair)" value={nc.en} onChange={(e) => setNc({ ...nc, en: e.target.value })} />
                    <input className="mb-input" placeholder="缩略图生成提示词（英文，可空）" value={nc.genPrompt} onChange={(e) => setNc({ ...nc, genPrompt: e.target.value })} />
                  </div>
                </div>
                <button className="mb-btn mb-btn-sm mb-btn-primary" onClick={saveNewCard}>保存到「{catLabel(nc.cat, 'zh')}」</button>
              </div>
            )}
          </div>

          {/* 右：购物车 + 合成 */}
          <div className="mb-sc-studio-right mb-sc-mall-cartcol">
            <div className="mb-sc-mall-carthead">
              <b>🛒 购物车（{cart.length}）</b>
              <label
                className="mb-sc-mall-opt"
                title="排斥：同一组里相关联（同类）的卡片只能选一个，例如一个人物选了圆脸就不能再选其他脸型；不同组互不影响"
              >
                <input type="checkbox" checked={exclusive} onChange={(e) => setF({ exclusive: e.target.checked })} />
                同组排斥
              </label>
              {cart.length > 0 && (
                <button className="mb-btn mb-btn-xs mb-btn-ghost" onClick={clearCart}>
                  清空
                </button>
              )}
            </div>

            <div
              className="mb-sc-mall-cart mb-dragscroll"
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes(CARD_MIME) || dragUid.current) e.preventDefault();
              }}
              onDrop={(e) => {
                // 落在分组之间的空隙：grid 卡片→活动组；车内卡片→活动组末尾
                const raw = e.dataTransfer.getData(CARD_MIME);
                if (raw) {
                  try {
                    const { cardId } = JSON.parse(raw) as { cardId: string };
                    addCardById(cardId);
                  } catch {
                    /* ignore */
                  }
                } else if (dragUid.current) {
                  moveToGroupEnd(dragUid.current, activeGroup);
                }
                dragUid.current = null;
              }}
            >
              {up.prompts.length > 0 && (
                <div className="mb-sc-fromup is-fed">上游 {up.prompts.length} 条提示词将一并并入合成（排在末尾）</div>
              )}

              {groups.map((g) => {
                const items = cart.filter((it) => resolved(it) === g.id);
                const isActive = activeGroup === g.id;
                return (
                  <div
                    key={g.id}
                    className={`mb-sc-mall-cartgroup ${isActive ? 'is-active' : ''}`}
                    onDragOver={(e) => {
                      if (e.dataTransfer.types.includes(CARD_MIME) || dragUid.current) e.preventDefault();
                    }}
                    onDrop={(e) => {
                      e.stopPropagation();
                      const raw = e.dataTransfer.getData(CARD_MIME);
                      if (raw) {
                        try {
                          const { cardId } = JSON.parse(raw) as { cardId: string };
                          const c = allCards.find((x) => x.id === cardId);
                          if (c) addCardToGroup({ id: c.id, cat: c.cat, sub: c.sub, zh: c.zh, en: c.en }, g.id);
                        } catch {
                          /* ignore */
                        }
                      } else if (dragUid.current) {
                        moveToGroupEnd(dragUid.current, g.id);
                      }
                      dragUid.current = null;
                    }}
                  >
                    <div className="mb-sc-mall-cartgrouphead">
                      <button
                        className="mb-sc-mall-grouppick"
                        title={isActive ? '当前活动组（新卡片落到这里）' : '设为活动组'}
                        onClick={() => setActiveGroup(g.id)}
                      >
                        {isActive ? '●' : '○'}
                      </button>
                      {editGroup === g.id ? (
                        <input
                          className="mb-input mb-sc-mall-groupinput"
                          autoFocus
                          defaultValue={g.name}
                          onBlur={(e) => {
                            renameGroup(g.id, e.target.value.trim() || g.name);
                            setEditGroup(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                            if (e.key === 'Escape') setEditGroup(null);
                          }}
                        />
                      ) : (
                        <span
                          className="mb-sc-mall-groupname"
                          title="双击重命名（改过的名字会作为该组提示词前缀，如「左边的女孩」）"
                          onDoubleClick={() => setEditGroup(g.id)}
                        >
                          {g.name}
                        </span>
                      )}
                      <span className="mb-sc-mall-groupcnt">{items.length}</span>
                      {groups.length > 1 && (
                        <button className="mb-sc-mall-groupdel" title="删除该组（卡片并入第一组）" onClick={() => deleteGroup(g.id)}>
                          ×
                        </button>
                      )}
                    </div>
                    <div className="mb-sc-mall-cartgrid">
                      {items.length === 0 && <div className="mb-sc-mall-cartempty">把卡片拖到这一组</div>}
                      {items.map((it) => (
                        <div
                          key={it.uid}
                          className="mb-sc-mall-cartcard"
                          draggable
                          onDragStart={(e) => {
                            dragUid.current = it.uid;
                            e.dataTransfer.effectAllowed = 'move';
                          }}
                          onDragOver={(e) => {
                            if (dragUid.current) e.preventDefault();
                          }}
                          onDrop={(e) => {
                            e.stopPropagation();
                            if (dragUid.current) moveBeforeUid(dragUid.current, it.uid);
                            dragUid.current = null;
                          }}
                          onContextMenu={(e) =>
                            areaMenu(e, [
                              ...groups
                                .filter((gg) => gg.id !== g.id)
                                .map((gg) => ({ label: `移到「${gg.name}」`, onClick: () => moveToGroupEnd(it.uid, gg.id) })),
                              { label: '收藏进提示词库', onClick: () => void favoriteToLibrary((lang === 'zh' ? it.zh : it.en) || it.en || it.zh) },
                              { label: '移出购物车', onClick: () => removeByUid(it.uid) }
                            ])
                          }
                          title={`${it.zh} / ${it.en}\n拖动可排序 / 跨组 · 右键移到其他组`}
                        >
                          <PromptMallThumb
                            card={{ id: it.cardId, cat: it.cat, sub: it.sub, zh: it.zh, en: it.en, genPrompt: '' }}
                            lang={lang}
                            thumbUrl={thumbMap[it.cardId]}
                          />
                          <button className="mb-sc-mall-cartcardx" title="移出" onClick={() => removeByUid(it.uid)}>
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}

              <button className="mb-sc-mall-groupadd" title="新增分组（图片的另一个组成部分，如另一个人物 / 背景）" onClick={addGroup}>
                ＋ 新增分组
              </button>
            </div>

            {/* 合成设置 + 运行 */}
            <div className="mb-sc-mall-checkout nodrag">
              {/* 组装方式：片段列表（逗号拼接，可选优化合并）/ 一整段自然语言（对话模型从头写） */}
              <div className="mb-sc-mall-modetoggle" role="group" aria-label="组装方式">
                <button
                  className={`mb-sc-mall-modebtn ${(d.assembleMode ?? 'fragments') === 'fragments' ? 'is-on' : ''}`}
                  title="逐段片段逗号拼接（可再勾「优化合并」让模型整理成连贯一条）"
                  onClick={() => setF({ assembleMode: 'fragments' })}
                >
                  片段列表
                </button>
                <button
                  className={`mb-sc-mall-modebtn ${d.assembleMode === 'paragraph' ? 'is-on' : ''}`}
                  title="对话模型把所有元素从头写成一整段连贯自然语言描述（需选对话模型）"
                  onClick={() => setF({ assembleMode: 'paragraph' })}
                >
                  整段自然语言
                </button>
              </div>
              <div className="mb-sc-mall-row">
                <div className="mb-sc-mall-langtoggle" role="group" aria-label="输出语言">
                  <button className={`mb-sc-mall-langbtn ${lang === 'zh' ? 'is-on' : ''}`} onClick={() => setF({ lang: 'zh' })}>中文输出</button>
                  <button className={`mb-sc-mall-langbtn ${lang === 'en' ? 'is-on' : ''}`} onClick={() => setF({ lang: 'en' })}>English</button>
                </div>
                {d.assembleMode !== 'paragraph' && (
                  <label className="mb-sc-mall-opt" title="勾选=对话模型合并去重成更连贯的一条；不勾=纯拼接（零 API）">
                    <input type="checkbox" checked={!!d.optimize} onChange={(e) => setF({ optimize: e.target.checked })} />
                    优化合并
                  </label>
                )}
              </div>
              {(d.optimize || d.assembleMode === 'paragraph') && (
                <select className="mb-select" value={d.modelId} onChange={(e) => setF({ modelId: e.target.value })}>
                  <option value="">（选对话模型 · {d.assembleMode === 'paragraph' ? '整段撰写' : '合并优化'}）</option>
                  {textModels.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              )}
              <button className="mb-btn mb-btn-primary mb-sc-run" disabled={d.status === 'running'} onClick={() => void runPromptMallNode(nodeId)}>
                {d.status === 'running' ? '合成中…' : d.assembleMode === 'paragraph' ? '组装成整段' : d.optimize ? '组装并优化' : '组装（纯拼接）'}
              </button>
              {d.error && <div className="mb-sc-result-err">{d.error}</div>}
              {d.assembled?.trim() && (
                <div
                  className="mb-sc-sb-story"
                  title="合成结果 · 点击放大 · 右键更多"
                  onClick={() => openText(d.assembled ?? '', '提示词商城 · 合成结果')}
                  onContextMenu={(e) =>
                    areaMenu(e, [
                      { label: '复制提示词', onClick: () => copyText(d.assembled ?? '') },
                      { label: '→ 提示词节点', onClick: () => makePromptNodeFrom(nodeId, d.assembled ?? '') },
                      { label: '收藏进提示词库', onClick: () => void favoriteToLibrary(d.assembled ?? '') }
                    ])
                  }
                >
                  <b>合成：</b>
                  {d.assembled}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 编辑卡片浮层（移分类走右键/拖拽，这里改文案 + 缩略图提示词） */}
        {editCard && (
          <div className="mb-sc-mall-editmask" onClick={() => setEditCard(null)}>
            <div className="mb-sc-mall-editcard mb-card" onClick={(e) => e.stopPropagation()}>
              <h4>编辑卡片</h4>
              <label className="mb-sc-mall-editlabel">中文片段</label>
              <input className="mb-input" value={editCard.zh} onChange={(e) => setEditCard({ ...editCard, zh: e.target.value })} />
              <label className="mb-sc-mall-editlabel">English fragment</label>
              <input className="mb-input" value={editCard.en} onChange={(e) => setEditCard({ ...editCard, en: e.target.value })} />
              <label className="mb-sc-mall-editlabel">缩略图生成提示词（英文，可空）</label>
              <textarea
                className="mb-textarea nowheel"
                rows={2}
                value={editCard.genPrompt}
                onChange={(e) => setEditCard({ ...editCard, genPrompt: e.target.value })}
              />
              <div className="mb-sc-mall-editbtns">
                <button className="mb-btn mb-btn-ghost mb-btn-sm" onClick={() => setEditCard(null)}>
                  取消
                </button>
                <button className="mb-btn mb-btn-primary mb-btn-sm" onClick={saveEditCard}>
                  保存
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
