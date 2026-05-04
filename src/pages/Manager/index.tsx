import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { toast } from '@/store/toastStore';
import { useImageParamsStore } from '@/store/imageParamsStore';
import { useUIStore } from '@/store/uiStore';
import { Modal } from '@/components/Modal';
import { Lightbox } from '@/components/Lightbox';
import { openContextMenu } from '@/components/ContextMenu';
import { confirmDialog } from '@/components/ConfirmDialog';
import {
  PlusIcon,
  SearchIcon,
  GalleryIcon,
  TrashIcon,
  FolderIcon,
  SparkleIcon,
  CopyIconShape
} from '@/components/Icon';
import { localPathToImageUrl } from '@/lib/imageUrl';
import { autoTag } from '@/lib/autoTag';
import './Manager.css';

interface PromptCategory {
  id: number;
  name: string;
  slug: string;
  is_builtin: number;
  sort_order: number;
}

interface PromptCard {
  id: number;
  title: string;
  text: string;
  negative_text: string | null;
  kind: string;
  category_id: number | null;
  tags: string;
  notes: string | null;
  related_image_ids: string | null;
  /** 服务端 join 出的关联图（v1 路径） */
  thumb_file_path: string | null;
  /** 服务端列直存的小 dataUri（反推 / 没有关联图时用） */
  thumb_data_uri: string | null;
}

interface ImageRow {
  id: number;
  task_id: number | null;
  file_path: string;
  thumbnail_path: string | null;
  prompt_positive: string | null;
  prompt_negative: string | null;
  model_used: string | null;
  params_json: string | null;
  rating: number;
  notes: string | null;
  created_at: string;
}

type Mode = 'prompt' | 'gallery';

const VIRTUAL_ALL = { id: 0, name: '全部记录', slug: 'all', is_builtin: 1, sort_order: 0 };

type DateFilter = 'all' | 'today' | 'week' | 'month';
type SortMode = 'newest' | 'oldest';

export default function ManagerPage(): JSX.Element {
  const ui = useUIStore();
  const mode = ui.managerMode as Mode;
  const setMode = (m: Mode): void => ui.setManagerMode(m);
  const activeSlug = ui.managerSlug;
  const setActiveSlug = (s: string): void => ui.setManagerSlug(s);
  const search = ui.managerSearch;
  const setSearch = (s: string): void => ui.setManagerSearch(s);
  const dateFilter = ui.managerDateFilter;
  const setDateFilter = (s: DateFilter): void => ui.setManagerDateFilter(s);
  const modelFilter = ui.managerModelFilter;
  const setModelFilter = (s: string): void => ui.setManagerModelFilter(s);
  const aspectFilter = ui.managerAspectFilter;
  const setAspectFilter = (s: string): void => ui.setManagerAspectFilter(s);
  const sortMode = ui.managerSort;
  const setSortMode = (s: SortMode): void => ui.setManagerSort(s);

  const [categories, setCategories] = useState<PromptCategory[]>([]);
  const [prompts, setPrompts] = useState<PromptCard[]>([]);
  const [images, setImages] = useState<ImageRow[]>([]);
  const [editing, setEditing] = useState<Partial<PromptCard> | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  /** 图库勾选模式 */
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // 提示词标签筛选——从 ui store 加载，再 wrap 成 Set 保持原 API
  const activeTags = useMemo(() => new Set(ui.managerActiveTags), [ui.managerActiveTags]);
  const setActiveTags = (next: Set<string> | ((cur: Set<string>) => Set<string>)): void => {
    const resolved = typeof next === 'function' ? next(activeTags) : next;
    ui.setManagerActiveTags(Array.from(resolved));
  };

  const navigate = useNavigate();
  const imgParams = useImageParamsStore();

  // 打开管家页面时，默认进入图库视图（每次进入都重置一次——用户更习惯先看图）
  useEffect(() => {
    if (mode !== 'gallery') setMode('gallery');
    refreshCategories();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (mode === 'prompt') refreshPrompts();
    else refreshImages();
  }, [mode, activeSlug]);

  // 监听生图完成事件，自动刷新图库
  useEffect(() => {
    if (!window.electronAPI?.on) return;
    const off = window.electronAPI.on('image:done', () => {
      if (mode === 'gallery') refreshImages();
    });
    return off;
  }, [mode]);

  async function refreshCategories(): Promise<void> {
    const r = await window.electronAPI.prompt.categoryList();
    if (r.ok) setCategories(r.data as PromptCategory[]);
  }

  async function refreshPrompts(): Promise<void> {
    const r = await window.electronAPI.prompt.list({ category_slug: activeSlug });
    if (r.ok) setPrompts(r.data as PromptCard[]);
  }

  async function refreshImages(): Promise<void> {
    const r = await window.electronAPI.gallery.list({});
    if (r.ok) setImages(r.data as ImageRow[]);
  }

  async function deletePrompt(id: number): Promise<void> {
    const ok = await confirmDialog({
      title: '删除提示词',
      message: '删除这条提示词？',
      detail: '会被移入回收站，30 天内可恢复。',
      okText: '删除',
      danger: true
    });
    if (!ok) return;
    const r = await window.electronAPI.prompt.delete(id);
    if (r.ok) {
      toast.success('已移入回收站');
      refreshPrompts();
    } else {
      toast.error('删除失败', r.error.message);
    }
  }

  // ─── 图库批量勾选 ───
  function toggleSelect(id: number): void {
    setSelectedIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllInView(): void {
    setSelectedIds(new Set(filteredImages.map((im) => im.id)));
  }

  function invertSelectionInView(): void {
    setSelectedIds((cur) => {
      const next = new Set<number>();
      for (const im of filteredImages) {
        if (!cur.has(im.id)) next.add(im.id);
      }
      return next;
    });
  }

  function clearSelection(): void {
    setSelectedIds(new Set());
  }

  function exitSelectMode(): void {
    setSelectMode(false);
    setSelectedIds(new Set());
  }

  async function batchDeleteSelected(): Promise<void> {
    if (selectedIds.size === 0) return;
    const ok = await confirmDialog({
      title: '批量从图库移除',
      message: `从图库移除选中的 ${selectedIds.size} 张图？`,
      detail: '仅在数据库打软删除标记，磁盘上的源文件不会删除。',
      okText: '全部移除',
      danger: true
    });
    if (!ok) return;
    const ts = new Date().toISOString();
    const ids = Array.from(selectedIds);
    const results = await Promise.all(
      ids.map((id) =>
        window.electronAPI.gallery.update({ id, patch: { deleted_at: ts } })
      )
    );
    const failed = results.filter((r) => !r.ok).length;
    if (failed === 0) {
      toast.success('已移入回收站', `成功 ${ids.length} 张`);
    } else {
      toast.error(
        '部分失败',
        `成功 ${ids.length - failed} / 失败 ${failed}`
      );
    }
    exitSelectMode();
    refreshImages();
  }

  async function softDeleteImage(id: number): Promise<void> {
    const ok = await confirmDialog({
      title: '从图库移除',
      message: '从图库移除这张图？',
      detail: '仅在数据库打软删除标记，磁盘上的源文件不会删除。',
      okText: '移除',
      danger: true
    });
    if (!ok) return;
    const r = await window.electronAPI.gallery.update({
      id,
      patch: { deleted_at: new Date().toISOString() }
    });
    if (r.ok) {
      toast.success('已移入回收站');
      refreshImages();
    } else {
      toast.error('删除失败', r.error.message);
    }
  }

  async function showInFolder(filePath: string): Promise<void> {
    const r = await window.electronAPI.storage.showInFolder(filePath);
    if (!r.ok) toast.error('打开失败', r.error.message);
  }

  async function savePrompt(): Promise<void> {
    if (!editing) return;
    const title = (editing.title ?? '').trim();
    const text = (editing.text ?? '').trim();
    if (!title || !text) {
      toast.error('标题和正文不能为空');
      return;
    }
    const cat = categories.find((c) => c.slug === activeSlug);
    let userTagsArr: string[] = [];
    try {
      userTagsArr = (JSON.parse(editing.tags ?? '[]') as string[]) || [];
    } catch {
      userTagsArr = [];
    }
    let relatedIds: number[] = [];
    try {
      relatedIds = (JSON.parse(editing.related_image_ids ?? '[]') as number[]) || [];
    } catch {
      relatedIds = [];
    }
    // 自动打标：从正文里抽主体/风格/关键词，与用户手填 tags 合并去重
    // —— 用户手填始终在前，自动标签在后（保持用户优先级）
    const auto = autoTag(text, null, userTagsArr, 10);
    // editing.thumb_data_uri 三态：
    //   - undefined：用户没动它 → 不传给后端，保留原值
    //   - ''：用户清空了缩略图 → 传空字符串，后端会清掉
    //   - 数据 URI：用户上传了新图（已缩到 ≤256px）
    const thumbField =
      editing.thumb_data_uri === undefined
        ? undefined
        : (editing.thumb_data_uri as string);
    const r = await window.electronAPI.prompt.upsert({
      id: editing.id,
      title,
      text,
      negative_text: editing.negative_text ?? null,
      kind: (editing.kind as 'image') ?? (cat?.slug === 'video' ? 'video' : 'image'),
      category_id: cat && cat.slug !== 'all' ? cat.id : null,
      tags: auto.merged,
      notes: editing.notes ?? null,
      related_image_ids: relatedIds,
      thumb_data_uri: thumbField
    });
    if (r.ok) {
      toast.success(editing.id ? '已更新' : '已添加');
      setEditing(null);
      refreshPrompts();
    } else {
      toast.error('保存失败', r.error.message);
    }
  }

  // 所有出现过的标签（用作筛选 chip）
  const allTags = useMemo(() => {
    const s = new Set<string>();
    for (const p of prompts) {
      try {
        const arr = (JSON.parse(p.tags ?? '[]') as string[]) || [];
        for (const t of arr) if (t) s.add(t);
      } catch {
        /* ignore */
      }
    }
    return Array.from(s).sort();
  }, [prompts]);

  const filteredPrompts = useMemo(() => {
    return prompts.filter((p) => {
      if (search) {
        const hit =
          p.title.includes(search) ||
          p.text.includes(search) ||
          (p.notes ?? '').includes(search);
        if (!hit) return false;
      }
      if (activeTags.size > 0) {
        let tags: string[] = [];
        try {
          tags = (JSON.parse(p.tags ?? '[]') as string[]) || [];
        } catch {
          /* ignore */
        }
        // AND 语义：必须包含所有选中的标签
        for (const t of activeTags) {
          if (!tags.includes(t)) return false;
        }
      }
      return true;
    });
  }, [prompts, search, activeTags]);

  function toggleTagFilter(tag: string): void {
    setActiveTags((cur) => {
      const next = new Set(cur);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }

  // 模型 / 比例 候选项（按现有数据动态算）
  const availableModels = useMemo(() => {
    const s = new Set<string>();
    for (const im of images) if (im.model_used) s.add(im.model_used);
    return Array.from(s).sort();
  }, [images]);

  const availableAspects = useMemo(() => {
    const s = new Set<string>();
    for (const im of images) {
      const meta = extractMeta(im.params_json);
      if (meta.aspect) s.add(meta.aspect);
    }
    return Array.from(s).sort();
  }, [images]);

  const filteredImages = useMemo(() => {
    const q = search.toLowerCase();
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const cutoff =
      dateFilter === 'today'
        ? now - dayMs
        : dateFilter === 'week'
          ? now - 7 * dayMs
          : dateFilter === 'month'
            ? now - 30 * dayMs
            : 0;

    let arr = images.filter((im) => {
      if (q) {
        const hit =
          (im.prompt_positive?.toLowerCase() ?? '').includes(q) ||
          (im.notes?.toLowerCase() ?? '').includes(q) ||
          (im.model_used?.toLowerCase() ?? '').includes(q);
        if (!hit) return false;
      }
      if (cutoff > 0) {
        const t = new Date(im.created_at).getTime();
        if (!Number.isFinite(t) || t < cutoff) return false;
      }
      if (modelFilter !== 'all' && im.model_used !== modelFilter) return false;
      if (aspectFilter !== 'all') {
        const meta = extractMeta(im.params_json);
        if (meta.aspect !== aspectFilter) return false;
      }
      return true;
    });
    arr = [...arr].sort((a, b) => {
      const ta = new Date(a.created_at).getTime();
      const tb = new Date(b.created_at).getTime();
      return sortMode === 'newest' ? tb - ta : ta - tb;
    });
    return arr;
  }, [images, search, dateFilter, modelFilter, aspectFilter, sortMode]);

  /** 复制图片到系统剪贴板（PNG blob） */
  async function copyImageToClipboard(filePath: string): Promise<void> {
    try {
      const url = localPathToImageUrl(filePath);
      const r = await fetch(url);
      if (!r.ok) throw new Error(`fetch ${r.status}`);
      const blob = await r.blob();
      // 部分浏览器只允许 image/png；遇到 jpeg/webp 用 Canvas 转一下
      let pngBlob = blob;
      if (blob.type !== 'image/png') {
        pngBlob = await blobToPng(blob);
      }
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': pngBlob })
      ]);
      toast.success('图片已复制到剪贴板');
    } catch (e) {
      toast.error('复制图片失败', (e as Error).message);
    }
  }

  /** 复制图片提示词到剪贴板 */
  async function copyPrompt(text: string | null): Promise<void> {
    if (!text || !text.trim()) {
      toast.error('该图片没有保存提示词');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.success('提示词已复制');
    } catch {
      toast.error('复制失败');
    }
  }

  /** 把图片提示词扔到生图模块输入框 */
  function useAsPrompt(text: string | null): void {
    if (!text || !text.trim()) {
      toast.error('该图片没有保存提示词');
      return;
    }
    imgParams.setChatDraft(text);
    toast.success('已填到生图输入框', '切到生图页继续');
    navigate('/');
  }

  /** 提示词卡片：复制文本 */
  async function copyPromptText(text: string): Promise<void> {
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
      toast.success('提示词已复制');
    } catch {
      toast.error('复制失败');
    }
  }

  /** 提示词卡片：复制并跳到生图（同时塞剪贴板和 chatDraft） */
  async function copyAndUseForImage(text: string): Promise<void> {
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* 剪贴板失败不阻塞 */
    }
    imgParams.setChatDraft(text);
    navigate('/');
    toast.success('提示词已复制并填到生图输入框');
  }

  /** 提示词卡片：右键菜单 */
  function showPromptMenu(e: React.MouseEvent, p: PromptCard): void {
    e.preventDefault();
    e.stopPropagation();
    const inShortcuts = ui.shortcutPromptIds.includes(p.id);
    openContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: '复制提示词',
          icon: <CopyIconShape size={13} />,
          onClick: () => copyPromptText(p.text)
        },
        {
          label: '复制并生图',
          variant: 'accent',
          icon: <SparkleIcon size={12} />,
          onClick: () => copyAndUseForImage(p.text)
        },
        {
          label: '只填到生图（不复制）',
          icon: <SparkleIcon size={12} />,
          onClick: () => useAsPrompt(p.text)
        },
        {
          label: inShortcuts ? '从快捷栏移除' : '加入对话框快捷栏',
          icon: <PlusIcon size={12} />,
          onClick: () => {
            if (!inShortcuts) {
              ui.upsertShortcutPromptCache(p.id, { title: p.title, text: p.text });
            }
            ui.toggleShortcutPromptId(p.id);
            toast.success(inShortcuts ? '已从快捷栏移除' : '已加入快捷栏');
          }
        },
        {
          label: '编辑',
          onClick: () => setEditing({ ...p, tags: p.tags ?? '[]' })
        },
        {
          label: '删除',
          variant: 'danger',
          icon: <TrashIcon size={12} />,
          onClick: () => deletePrompt(p.id)
        }
      ]
    });
  }

  /** 卡片上右键弹菜单 */
  function showImageMenu(e: React.MouseEvent, im: ImageRow): void {
    e.preventDefault();
    openContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: '复制图片',
          icon: <CopyIconShape size={13} />,
          onClick: () => copyImageToClipboard(im.file_path)
        },
        {
          label: '复制提示词',
          icon: <CopyIconShape size={13} />,
          disabled: !im.prompt_positive,
          onClick: () => copyPrompt(im.prompt_positive)
        },
        {
          label: '用作生图提示词',
          variant: 'accent',
          icon: <SparkleIcon size={12} />,
          disabled: !im.prompt_positive,
          onClick: () => useAsPrompt(im.prompt_positive)
        },
        {
          label: '归档到提示词',
          icon: <PlusIcon size={12} />,
          disabled: !im.prompt_positive,
          onClick: () => archiveAsPrompt(im)
        },
        {
          label: '在文件夹中显示',
          icon: <FolderIcon size={12} />,
          onClick: () => showInFolder(im.file_path)
        },
        {
          label: '从图库移除',
          variant: 'danger',
          icon: <TrashIcon size={12} />,
          onClick: () => softDeleteImage(im.id)
        }
      ]
    });
  }

  /** 把一张已生成的图归档为提示词卡片 */
  async function archiveAsPrompt(im: ImageRow): Promise<void> {
    if (!im.prompt_positive) {
      toast.error('该图无可归档的提示词');
      return;
    }
    const auto = autoTag(im.prompt_positive, im.model_used ?? null, [], 10);
    const r = await window.electronAPI.prompt.upsert({
      title: im.prompt_positive.slice(0, 40),
      text: im.prompt_positive,
      negative_text: im.prompt_negative ?? null,
      kind: 'image',
      tags: auto.merged,
      notes: `来自图库 #${im.id}`,
      related_image_ids: [im.id]
    });
    if (r.ok) toast.success('已归档到提示词管理');
    else toast.error('归档失败', r.error.message);
  }

  const allCategories = [VIRTUAL_ALL, ...categories];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.18 }}
      className="mb-manager-root"
    >
      <aside className="mb-manager-sidebar mb-card mb-marquee-glow">
        <div className="mb-manager-sidebar-head">
          <h2>
            <GalleryIcon size={18} /> 提示词管家
          </h2>
          <p>收藏 / 整理 / 复用 · 图库</p>
        </div>

        <div className="mb-manager-mode-row">
          <button
            type="button"
            className={`mb-manager-mode ${mode === 'gallery' ? 'is-active' : ''}`}
            onClick={() => setMode('gallery')}
          >
            图库
          </button>
          <button
            type="button"
            className={`mb-manager-mode ${mode === 'prompt' ? 'is-active' : ''}`}
            onClick={() => setMode('prompt')}
          >
            提示词
          </button>
        </div>

        {mode === 'prompt' && (
          <button
            className="mb-btn mb-btn-primary"
            onClick={() => setEditing({ title: '', text: '', tags: '[]' })}
          >
            <PlusIcon size={14} /> 添加提示词
          </button>
        )}

        {mode === 'prompt' && (
          <div className="mb-manager-categories">
            <div className="mb-manager-cat-label">分类</div>
            {allCategories.map((cat) => (
              <button
                key={cat.slug}
                onClick={() => setActiveSlug(cat.slug)}
                className={`mb-manager-cat ${activeSlug === cat.slug ? 'is-active' : ''}`}
              >
                {activeSlug === cat.slug && (
                  <motion.span
                    layoutId="manager-cat-active"
                    className="mb-manager-cat-bg"
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  />
                )}
                <span style={{ position: 'relative' }}>{cat.name}</span>
              </button>
            ))}
          </div>
        )}

        {mode === 'gallery' && (
          <>
            <div className="mb-manager-gallery-tip">
              <SparkleIcon size={14} />
              <span>每次成功生图都会自动归入这里</span>
            </div>

            <div className="mb-manager-side-filters">
              <div className="mb-manager-side-filter">
                <label>日期</label>
                <select
                  className="mb-select"
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value as DateFilter)}
                >
                  <option value="all">全部</option>
                  <option value="today">今天</option>
                  <option value="week">最近 7 天</option>
                  <option value="month">最近 30 天</option>
                </select>
              </div>
              <div className="mb-manager-side-filter">
                <label>模型</label>
                <select
                  className="mb-select"
                  value={modelFilter}
                  onChange={(e) => setModelFilter(e.target.value)}
                >
                  <option value="all">全部</option>
                  {availableModels.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mb-manager-side-filter">
                <label>比例</label>
                <select
                  className="mb-select"
                  value={aspectFilter}
                  onChange={(e) => setAspectFilter(e.target.value)}
                >
                  <option value="all">全部</option>
                  {availableAspects.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mb-manager-side-filter">
                <label>排序</label>
                <select
                  className="mb-select"
                  value={sortMode}
                  onChange={(e) => setSortMode(e.target.value as SortMode)}
                >
                  <option value="newest">最新优先</option>
                  <option value="oldest">最旧优先</option>
                </select>
              </div>
            </div>
          </>
        )}
      </aside>

      <section className="mb-manager-content mb-card mb-marquee-glow">
        <header className="mb-manager-header">
          <div className="mb-manager-search">
            <SearchIcon size={16} />
            <input
              type="text"
              placeholder={mode === 'prompt' ? '搜索关键字…' : '搜索提示词 / 模型 / 备注…'}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="mb-manager-meta">
            共 {mode === 'prompt' ? filteredPrompts.length : filteredImages.length} 条记录
          </div>
        </header>

        {mode === 'prompt' && (
          <>
            {allTags.length > 0 && (
              <div className="mb-tag-filter-row">
                <span className="mb-tag-filter-label">标签筛选</span>
                {allTags.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`mb-tag-chip ${activeTags.has(t) ? 'is-active' : ''}`}
                    onClick={() => toggleTagFilter(t)}
                  >
                    #{t}
                  </button>
                ))}
                {activeTags.size > 0 && (
                  <button
                    type="button"
                    className="mb-tag-chip mb-tag-chip-clear"
                    onClick={() => setActiveTags(new Set())}
                  >
                    清空
                  </button>
                )}
              </div>
            )}
            {filteredPrompts.length === 0 ? (
              <div className="mb-manager-empty">
                <GalleryIcon size={28} />
                <div className="mb-manager-empty-title">还没有记录</div>
                <div className="mb-manager-empty-desc">
                  点击左侧「添加提示词」开始收藏第一条。
                </div>
              </div>
            ) : (
              <div className="mb-manager-grid">
                <AnimatePresence>
                  {filteredPrompts.map((p, i) => {
                    const isShortcut = ui.shortcutPromptIds.includes(p.id);
                    return (
                      <motion.div
                        key={p.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.96 }}
                        transition={{ delay: i * 0.025, duration: 0.25 }}
                        className={`mb-prompt-card mb-card-interactive mb-marquee-glow ${
                          isShortcut ? 'is-shortcut' : ''
                        }`}
                        onClick={() =>
                          setEditing({
                            ...p,
                            tags: p.tags ?? '[]'
                          })
                        }
                        onContextMenu={(e) => showPromptMenu(e, p)}
                      >
                        {(p.thumb_file_path || p.thumb_data_uri) && (
                          <div className="mb-prompt-card-thumb">
                            <img
                              src={
                                p.thumb_file_path
                                  ? localPathToImageUrl(p.thumb_file_path)
                                  : (p.thumb_data_uri ?? '')
                              }
                              alt=""
                              draggable={false}
                            />
                          </div>
                        )}
                        <div className="mb-prompt-card-body">
                          <div className="mb-prompt-card-header">
                            <span className="mb-prompt-card-tag">
                              {p.kind === 'video' ? '视频' : '图片'}
                            </span>
                            {isShortcut && (
                              <span className="mb-prompt-card-pin" title="已在快捷栏">
                                ⚡
                              </span>
                            )}
                            <button
                              className="mb-prompt-card-trash"
                              onClick={(e) => {
                                e.stopPropagation();
                                deletePrompt(p.id);
                              }}
                            >
                              <TrashIcon size={13} />
                            </button>
                          </div>
                          <h3>{p.title}</h3>
                          <p>{p.text.slice(0, 120)}</p>
                          {p.tags &&
                            (() => {
                              try {
                                const arr = JSON.parse(p.tags) as string[];
                                return arr.length > 0 ? (
                                  <div className="mb-prompt-card-tags">
                                    {arr.slice(0, 4).map((t) => (
                                      <span key={t} className="mb-tag">
                                        #{t}
                                      </span>
                                    ))}
                                  </div>
                                ) : null;
                              } catch {
                                return null;
                              }
                            })()}
                          <div className="mb-prompt-card-actions">
                            <button
                              type="button"
                              className="mb-prompt-card-action"
                              onClick={(e) => {
                                e.stopPropagation();
                                copyPromptText(p.text);
                              }}
                              title="复制提示词到剪贴板"
                            >
                              <CopyIconShape size={11} /> 复制
                            </button>
                            <button
                              type="button"
                              className="mb-prompt-card-action mb-prompt-card-action-accent"
                              onClick={(e) => {
                                e.stopPropagation();
                                copyAndUseForImage(p.text);
                              }}
                              title="复制 + 填到生图输入框"
                            >
                              <SparkleIcon size={11} /> 复制并生图
                            </button>
                            <button
                              type="button"
                              className={`mb-prompt-card-action ${isShortcut ? 'is-on' : ''}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!isShortcut) {
                                  ui.upsertShortcutPromptCache(p.id, {
                                    title: p.title,
                                    text: p.text
                                  });
                                }
                                ui.toggleShortcutPromptId(p.id);
                                toast.success(isShortcut ? '已从快捷栏移除' : '已加入快捷栏');
                              }}
                              title={isShortcut ? '从对话框快捷栏移除' : '加到对话框快捷栏'}
                            >
                              ⚡ {isShortcut ? '已加快捷' : '加快捷'}
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            )}
          </>
        )}

        {mode === 'gallery' && (
          <>
            {/* 批量操作工具条 */}
            <div className="mb-gallery-toolbar">
              {!selectMode ? (
                <button
                  type="button"
                  className="mb-btn mb-btn-secondary mb-btn-sm"
                  onClick={() => setSelectMode(true)}
                  disabled={filteredImages.length === 0}
                >
                  ✓ 批量选择
                </button>
              ) : (
                <>
                  <span className="mb-gallery-toolbar-count">
                    已选 <strong>{selectedIds.size}</strong> / {filteredImages.length}
                  </span>
                  <button
                    type="button"
                    className="mb-btn mb-btn-secondary mb-btn-sm"
                    onClick={selectAllInView}
                  >
                    全选当前筛选
                  </button>
                  <button
                    type="button"
                    className="mb-btn mb-btn-secondary mb-btn-sm"
                    onClick={invertSelectionInView}
                  >
                    反选
                  </button>
                  <button
                    type="button"
                    className="mb-btn mb-btn-secondary mb-btn-sm"
                    onClick={clearSelection}
                    disabled={selectedIds.size === 0}
                  >
                    清空选择
                  </button>
                  <button
                    type="button"
                    className="mb-btn mb-btn-danger mb-btn-sm"
                    onClick={batchDeleteSelected}
                    disabled={selectedIds.size === 0}
                  >
                    <TrashIcon size={12} /> 删除选中（{selectedIds.size}）
                  </button>
                  <button
                    type="button"
                    className="mb-btn mb-btn-ghost mb-btn-sm"
                    onClick={exitSelectMode}
                  >
                    退出
                  </button>
                </>
              )}
            </div>

            {filteredImages.length === 0 ? (
              <div className="mb-manager-empty">
                <GalleryIcon size={28} />
                <div className="mb-manager-empty-title">
                  {images.length === 0 ? '图库还是空的' : '没有匹配的图片'}
                </div>
                <div className="mb-manager-empty-desc">
                  {images.length === 0
                    ? '去生图页跑一张，完成后会自动归入这里。'
                    : '试试改一下筛选条件 / 搜索关键字'}
                </div>
              </div>
            ) : (
              <div className="mb-gallery-grid">
                <AnimatePresence>
                  {filteredImages.map((im, i) => (
                    <ImageCard
                      key={im.id}
                      img={im}
                      index={i}
                      selectMode={selectMode}
                      selected={selectedIds.has(im.id)}
                      onToggleSelect={() => toggleSelect(im.id)}
                      onPreview={() => setPreviewSrc(localPathToImageUrl(im.file_path))}
                      onShowFolder={() => showInFolder(im.file_path)}
                      onArchive={() => archiveAsPrompt(im)}
                      onDelete={() => softDeleteImage(im.id)}
                      onContextMenu={(e) => showImageMenu(e, im)}
                    />
                  ))}
                </AnimatePresence>
              </div>
            )}
          </>
        )}
      </section>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.id ? '编辑提示词' : '添加提示词'}
        width={580}
        footer={
          <>
            <button className="mb-btn mb-btn-ghost" onClick={() => setEditing(null)}>
              取消
            </button>
            <button className="mb-btn mb-btn-primary" onClick={savePrompt}>
              保存
            </button>
          </>
        }
      >
        {editing && (
          <div className="mb-prompt-form">
            <div>
              <label className="mb-label">缩略图（可选）</label>
              <ThumbUploader
                value={
                  editing.thumb_data_uri !== undefined
                    ? (editing.thumb_data_uri as string)
                    : (editing.thumb_file_path
                        ? localPathToImageUrl(editing.thumb_file_path)
                        : '')
                }
                onChange={(uri) =>
                  setEditing({ ...editing, thumb_data_uri: uri })
                }
              />
            </div>
            <div>
              <label className="mb-label">标题</label>
              <input
                className="mb-input"
                value={editing.title ?? ''}
                onChange={(e) => setEditing({ ...editing, title: e.target.value })}
              />
            </div>
            <div>
              <label className="mb-label">正向提示词</label>
              <textarea
                className="mb-textarea"
                rows={5}
                value={editing.text ?? ''}
                onChange={(e) => setEditing({ ...editing, text: e.target.value })}
              />
            </div>
            <div>
              <label className="mb-label">负向提示词（可选）</label>
              <textarea
                className="mb-textarea"
                rows={2}
                value={editing.negative_text ?? ''}
                onChange={(e) => setEditing({ ...editing, negative_text: e.target.value })}
              />
            </div>
            <div>
              <label className="mb-label">标签（用逗号或回车分隔）</label>
              <TagsEditor
                tags={
                  (() => {
                    try {
                      return JSON.parse(editing.tags ?? '[]') as string[];
                    } catch {
                      return [] as string[];
                    }
                  })()
                }
                onChange={(arr) =>
                  setEditing({ ...editing, tags: JSON.stringify(arr) })
                }
              />
            </div>
            <div>
              <label className="mb-label">备注（可选）</label>
              <input
                className="mb-input"
                value={editing.notes ?? ''}
                onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
              />
            </div>
          </div>
        )}
      </Modal>

      <Lightbox
        open={previewSrc !== null}
        src={previewSrc ?? ''}
        onClose={() => setPreviewSrc(null)}
      />
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────
// 图库单卡
// ─────────────────────────────────────────────────────
function ImageCard({
  img,
  index,
  selectMode,
  selected,
  onToggleSelect,
  onPreview,
  onShowFolder,
  onArchive,
  onDelete,
  onContextMenu
}: {
  img: ImageRow;
  index: number;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onPreview: () => void;
  onShowFolder: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}): JSX.Element {
  const url = localPathToImageUrl(img.file_path);
  // 真实分辨率从 <img> onLoad 读 naturalWidth/Height
  // （params_json 里的尺寸是"请求的"，上游可能返回不一样的；以图为准）
  const [actualSize, setActualSize] = useState<{ w: number; h: number } | null>(null);
  const meta = useMemo(() => extractMeta(img.params_json), [img.params_json]);
  const created = formatDateTime(img.created_at);

  // 优先用 onLoad 拿到的真实尺寸；拿不到回退到 params_json 推断
  const sizeStr = actualSize
    ? `${actualSize.w}×${actualSize.h} px`
    : meta.size;
  const aspectStr = actualSize
    ? computeAspect(actualSize.w, actualSize.h)
    : meta.aspect;
  const pixelsStr = actualSize
    ? formatPixels(actualSize.w * actualSize.h)
    : meta.pixels;
  const sizeLine = [aspectStr, sizeStr, pixelsStr].filter(Boolean).join(' · ');

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ delay: index * 0.02, duration: 0.22 }}
      className={`mb-gallery-card mb-card mb-marquee-glow ${
        selectMode ? 'is-select-mode' : ''
      } ${selected ? 'is-selected' : ''}`}
      onContextMenu={onContextMenu}
      onClick={selectMode ? onToggleSelect : undefined}
    >
      {selectMode && (
        <span
          className={`mb-gallery-checkbox ${selected ? 'is-checked' : ''}`}
          aria-label={selected ? '已选中' : '未选中'}
        >
          {selected ? '✓' : ''}
        </span>
      )}
      <button
        className="mb-gallery-thumb"
        onClick={(e) => {
          if (selectMode) {
            e.stopPropagation();
            onToggleSelect();
            return;
          }
          onPreview();
        }}
        title={selectMode ? '点击切换选中' : '点击放大预览'}
      >
        <img
          src={url}
          alt={img.prompt_positive ?? ''}
          draggable={false}
          onLoad={(e) => {
            const el = e.currentTarget;
            if (el.naturalWidth > 0 && el.naturalHeight > 0) {
              setActualSize({ w: el.naturalWidth, h: el.naturalHeight });
            }
          }}
        />
      </button>
      <div className="mb-gallery-body">
        <p className="mb-gallery-prompt" title={img.prompt_positive ?? ''}>
          {img.prompt_positive ?? '(无提示词)'}
        </p>
        {sizeLine && <div className="mb-gallery-sizeline">📐 {sizeLine}</div>}
        <div className="mb-gallery-meta">
          <span>🕐 {created}</span>
          {img.model_used && <span>🤖 {img.model_used}</span>}
        </div>
        <div className="mb-gallery-actions">
          <button
            className="mb-config-row-btn"
            onClick={onShowFolder}
            title="在文件夹中显示"
          >
            <FolderIcon size={12} /> 目录
          </button>
          <button className="mb-config-row-btn" onClick={onPreview} title="放大预览">
            <SparkleIcon size={12} /> 预览
          </button>
          <button
            className="mb-config-row-btn"
            onClick={onArchive}
            title="把这张图的提示词归档到提示词管理"
          >
            <PlusIcon size={12} /> 归档
          </button>
          <button
            className="mb-config-row-btn mb-config-row-btn-danger"
            onClick={onDelete}
            title="移除"
          >
            <TrashIcon size={12} />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

interface Meta {
  aspect: string;
  size: string;
  pixels: string;
}

function extractMeta(paramsJson: string | null): Meta {
  if (!paramsJson) return { aspect: '', size: '', pixels: '' };
  let p: Record<string, unknown> = {};
  try {
    p = JSON.parse(paramsJson) as Record<string, unknown>;
  } catch {
    return { aspect: '', size: '', pixels: '' };
  }
  const w = Number(p.width);
  const h = Number(p.height);
  let size = '';
  let pixels = '';
  let aspect = typeof p.aspect === 'string' ? p.aspect : '';

  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    size = `${w}×${h}`;
    pixels = formatPixels(w * h);
    if (!aspect) aspect = computeAspect(w, h);
  } else if (typeof p.image_size === 'string' && p.image_size) {
    size = String(p.image_size);
  }

  return { aspect, size, pixels };
}

function formatPixels(total: number): string {
  if (total >= 1_000_000) return `${(total / 1_000_000).toFixed(2)} MP`;
  if (total >= 1_000) return `${(total / 1_000).toFixed(0)} K`;
  return `${total}`;
}

function computeAspect(w: number, h: number): string {
  const g = gcd(w, h);
  return `${w / g}:${h / g}`;
}
function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

// ─────────────────────────────────────────────────────
// 标签编辑器（chip + input）
// ─────────────────────────────────────────────────────
function TagsEditor({
  tags,
  onChange
}: {
  tags: string[];
  onChange: (next: string[]) => void;
}): JSX.Element {
  const [draft, setDraft] = useState('');

  function commit(): void {
    const t = draft.trim().replace(/^#/, '');
    if (!t) return;
    if (tags.includes(t)) {
      setDraft('');
      return;
    }
    onChange([...tags, t]);
    setDraft('');
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter' || e.key === ',' || e.key === '，') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && draft === '' && tags.length > 0) {
      onChange(tags.slice(0, -1));
    }
  }

  return (
    <div className="mb-tag-editor">
      <div className="mb-tag-editor-chips">
        {tags.map((t) => (
          <span key={t} className="mb-tag mb-tag-removable">
            #{t}
            <button
              type="button"
              className="mb-tag-remove"
              onClick={() => onChange(tags.filter((x) => x !== t))}
              title="移除标签"
            >
              ×
            </button>
          </span>
        ))}
        <input
          className="mb-tag-editor-input"
          placeholder={tags.length === 0 ? '输入标签，回车 / 逗号 添加' : ''}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          onBlur={commit}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────
// 缩略图上传组件：拖入 / 选择文件 / 粘贴 三种方式都接
//   - 自动缩到最长边 ≤ 256px webp，控制 dataUri 体积 ~20-40KB
//   - value === '' 表示无图；value 非空 = data URI 或外部 URL
//   - onChange('') 表示用户主动清空
// ─────────────────────────────────────────────────────
function ThumbUploader({
  value,
  onChange
}: {
  value: string;
  onChange: (uri: string) => void;
}): JSX.Element {
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);

  async function ingestBlob(blob: Blob): Promise<void> {
    setBusy(true);
    try {
      const uri = await blobToThumbDataUri(blob, 256, 0.8);
      onChange(uri);
    } catch (e) {
      toast.error('读取图片失败', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function ingestFile(file: File): Promise<void> {
    if (!file.type.startsWith('image/')) {
      toast.error('只支持图片文件');
      return;
    }
    await ingestBlob(file);
  }

  async function pickFromDialog(): Promise<void> {
    const r = await window.electronAPI.storage.pickImages();
    if (!r.ok || r.data.files.length === 0) return;
    // pickImages 已经返回 dataUri；这里再缩一遍以保证 ≤256px
    const first = r.data.files[0];
    try {
      setBusy(true);
      const blob = await (await fetch(first.dataUri)).blob();
      const uri = await blobToThumbDataUri(blob, 256, 0.8);
      onChange(uri);
    } catch (e) {
      toast.error('处理图片失败', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function onDragOver(e: React.DragEvent): void {
    e.preventDefault();
    setDragOver(true);
  }
  function onDragLeave(): void {
    setDragOver(false);
  }
  async function onDrop(e: React.DragEvent): Promise<void> {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) await ingestFile(f);
  }

  // 在区域内按 Ctrl+V / Cmd+V 粘贴图片
  async function onPaste(e: React.ClipboardEvent): Promise<void> {
    const items = e.clipboardData?.items ?? [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.kind === 'file' && it.type.startsWith('image/')) {
        const f = it.getAsFile();
        if (f) {
          e.preventDefault();
          await ingestFile(f);
          return;
        }
      }
    }
  }

  return (
    <div
      className={`mb-thumb-uploader ${dragOver ? 'is-over' : ''} ${value ? 'has-image' : ''}`}
      tabIndex={0}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onPaste={onPaste}
      onClick={value ? undefined : pickFromDialog}
      title={value ? '已上传缩略图' : '点击选择 · 或拖入图片 · 或聚焦后 Ctrl+V 粘贴'}
    >
      {value ? (
        <>
          <img src={value} alt="缩略图" draggable={false} />
          <div className="mb-thumb-uploader-actions">
            <button
              type="button"
              className="mb-btn mb-btn-secondary mb-btn-sm"
              onClick={(e) => {
                e.stopPropagation();
                pickFromDialog();
              }}
              disabled={busy}
            >
              更换
            </button>
            <button
              type="button"
              className="mb-btn mb-btn-danger mb-btn-sm"
              onClick={(e) => {
                e.stopPropagation();
                onChange('');
              }}
              disabled={busy}
            >
              清空
            </button>
          </div>
        </>
      ) : (
        <div className="mb-thumb-uploader-tip">
          <PlusIcon size={16} />
          <span>{busy ? '处理中…' : '点击 · 拖入 · 粘贴 上传缩略图'}</span>
          <span className="mb-thumb-uploader-hint">
            会自动压成 ≤256px 的小图，节省空间
          </span>
        </div>
      )}
    </div>
  );
}

/** 把 Blob 缩成最长边 = maxEdge 的 webp dataUri */
async function blobToThumbDataUri(
  blob: Blob,
  maxEdge: number,
  quality: number
): Promise<string> {
  const bm = await createImageBitmap(blob);
  const ratio = Math.min(maxEdge / bm.width, maxEdge / bm.height, 1);
  const w = Math.max(1, Math.round(bm.width * ratio));
  const h = Math.max(1, Math.round(bm.height * ratio));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas ctx missing');
  ctx.drawImage(bm, 0, 0, w, h);
  bm.close?.();
  return canvas.toDataURL('image/webp', quality);
}

/** Blob → image/png Blob，用于 navigator.clipboard.write 兼容性 */
async function blobToPng(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return blob;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
  });
}

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    const Y = d.getFullYear();
    const M = String(d.getMonth() + 1).padStart(2, '0');
    const D = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${Y}-${M}-${D} ${h}:${m}`;
  } catch {
    return iso;
  }
}
