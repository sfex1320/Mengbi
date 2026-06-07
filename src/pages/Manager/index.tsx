import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { toast } from '@/store/toastStore';
import { useImageParamsStore } from '@/store/imageParamsStore';
import { useSmartInboxStore } from '@/store/smartInboxStore';
import { useDeletedMediaStore } from '@/store/deletedMediaStore';
import { useUIStore } from '@/store/uiStore';
import { Modal } from '@/components/Modal';
import { Lightbox } from '@/components/Lightbox';
import { openContextMenu, type ContextMenuEntry } from '@/components/ContextMenu';
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
import { ImportTargetDialog } from '@/pages/Canvas/ImportTargetDialog';
import { importImageToCanvas } from '@/pages/Canvas/importToCanvas';
import { AlbumEditModal } from './AlbumEditModal';
import type { Album, AlbumInput } from '@/types/domain';
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
  album_ids: string | null;
  created_at: string;
}

type Mode = 'prompt' | 'gallery';

const VIRTUAL_ALL = { id: 0, name: '全部记录', slug: 'all', is_builtin: 1, sort_order: 0 };

type DateFilter = 'all' | 'today' | 'week' | 'month';
type SortMode = 'newest' | 'oldest';

export default function ManagerPage(): JSX.Element {
  const ui = useUIStore();
  // 提示词管家已下线：Manager 固定为「图库」视图。用 `as Mode` 保留联合类型（而非收窄成字面量），
  // 让下方休眠的提示词分支保持类型有效（运行时 mode 恒为 'gallery'，那些分支永不渲染）。
  const mode = 'gallery' as Mode;
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
  /** 相册（图库视图侧栏）：列表 + 当前选中（null=全部） + 正在编辑的相册表单 */
  const [albums, setAlbums] = useState<Album[]>([]);
  const [activeAlbumId, setActiveAlbumId] = useState<number | null>(null);
  const [albumEditing, setAlbumEditing] = useState<AlbumInput | null>(null);
  const [editing, setEditing] = useState<Partial<PromptCard> | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  /** 图库勾选模式 */
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  /**
   * "删除选中"模式下勾上 = 同时删除本地文件(磁盘 unlink + 硬删 DB)。
   * 默认关闭,只软删除卡片(可在回收站找回)。用户明确勾上才物理删除。
   */
  const [deleteLocalFile, setDeleteLocalFile] = useState(false);
  const [importDialog, setImportDialog] = useState<{
    open: boolean;
    source: { width: number; height: number; name?: string } | null;
    srcs: Array<{ sourcePath: string; dataUri: string | null; width: number; height: number; name: string }>;
  }>({ open: false, source: null, srcs: [] });

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
    refreshCategories();
    refreshAlbums();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (mode === 'prompt') refreshPrompts();
    else refreshImages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, activeSlug, activeAlbumId]);

  // 监听生图完成事件，自动刷新图库
  // 依赖 activeAlbumId：切相册（不切 mode）后 refreshImages 闭包会读到旧相册，必须重订阅
  useEffect(() => {
    if (!window.electronAPI?.on) return;
    const off = window.electronAPI.on('image:done', () => {
      if (mode === 'gallery') refreshImages();
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, activeAlbumId]);

  async function refreshCategories(): Promise<void> {
    const r = await window.electronAPI.prompt.categoryList();
    if (r.ok) setCategories(r.data as PromptCategory[]);
    else toast.error('加载分类失败', r.error.message);
  }

  async function refreshPrompts(): Promise<void> {
    const r = await window.electronAPI.prompt.list({ category_slug: activeSlug });
    if (r.ok) setPrompts(r.data as PromptCard[]);
    else toast.error('加载提示词失败', r.error.message);
  }

  async function refreshImages(): Promise<void> {
    const r = await window.electronAPI.gallery.list({ album_id: activeAlbumId ?? undefined });
    if (r.ok) setImages(r.data as ImageRow[]);
    else toast.error('加载图库失败', r.error.message);
  }

  async function refreshAlbums(): Promise<void> {
    const r = await window.electronAPI.album.list();
    if (r.ok) setAlbums(r.data as Album[]);
    // 相册加载失败不打扰（图库主流程不依赖它）
  }

  async function saveAlbum(input: AlbumInput): Promise<void> {
    const r = await window.electronAPI.album.upsert(input);
    if (r.ok) {
      toast.success(input.id ? '相册已更新' : '相册已创建');
      setAlbumEditing(null);
      await refreshAlbums();
      if (mode === 'gallery') refreshImages();
    } else {
      toast.error('保存相册失败', r.error.message);
    }
  }

  async function deleteAlbum(a: Album): Promise<void> {
    const ok = await confirmDialog({
      title: '删除相册',
      message: `删除相册「${a.name}」？`,
      detail: '只删除相册本身，相册里的图片不受影响（不会删图）。',
      okText: '删除',
      danger: true
    });
    if (!ok) return;
    const r = await window.electronAPI.album.delete(a.id);
    if (r.ok) {
      toast.success('相册已删除');
      if (activeAlbumId === a.id) setActiveAlbumId(null);
      await refreshAlbums();
    } else {
      toast.error('删除相册失败', r.error.message);
    }
  }

  /** 把一张图加入/移出某个手动相册（写 images.album_ids） */
  async function toggleImageAlbum(im: ImageRow, albumId: number): Promise<void> {
    let cur: number[] = [];
    try {
      const parsed = im.album_ids ? JSON.parse(im.album_ids) : [];
      if (Array.isArray(parsed)) cur = parsed.filter((x): x is number => typeof x === 'number');
    } catch {
      cur = [];
    }
    const has = cur.includes(albumId);
    const next = has ? cur.filter((x) => x !== albumId) : [...cur, albumId];
    const r = await window.electronAPI.gallery.update({ id: im.id, patch: { album_ids: next } });
    if (r.ok) {
      toast.success(has ? '已移出相册' : '已加入相册');
      refreshImages();
    } else {
      toast.error('操作失败', r.error.message);
    }
  }

  function openAlbumMenu(e: React.MouseEvent, a: Album): void {
    e.preventDefault();
    e.stopPropagation();
    openContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: '编辑相册',
          icon: <SparkleIcon size={12} />,
          onClick: () =>
            setAlbumEditing({
              id: a.id,
              name: a.name,
              type: a.type,
              smart_rules: a.smart_rules,
              cover_image_id: a.cover_image_id
            })
        },
        { separator: true },
        {
          label: '删除相册',
          variant: 'danger',
          icon: <TrashIcon size={12} />,
          onClick: () => void deleteAlbum(a)
        }
      ]
    });
  }

  /** 图片右键「加入相册」子菜单项（只列手动相册；当前已属的打勾切换移出） */
  function albumSubmenuItems(im: ImageRow): ContextMenuEntry[] {
    const manual = albums.filter((a) => a.type === 'manual');
    if (manual.length === 0) {
      return [
        {
          label: '新建手动相册…',
          icon: <PlusIcon size={11} />,
          onClick: () => setAlbumEditing({ name: '', type: 'manual', smart_rules: null })
        }
      ];
    }
    let curIds: number[] = [];
    try {
      const parsed = im.album_ids ? JSON.parse(im.album_ids) : [];
      if (Array.isArray(parsed)) curIds = parsed.filter((x): x is number => typeof x === 'number');
    } catch {
      curIds = [];
    }
    return manual.map((a) => ({
      label: `${curIds.includes(a.id) ? '✓ ' : '　'}${a.name}`,
      onClick: () => void toggleImageAlbum(im, a.id)
    }));
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
    setDeleteLocalFile(false); // 退出选择模式即复位，避免上次勾的「删本地文件」带到下一次误删
  }

  async function batchDeleteSelected(): Promise<void> {
    if (selectedIds.size === 0) return;
    const ok = await confirmDialog({
      title: deleteLocalFile ? '批量删除(含本地文件)' : '批量从图库移除',
      message: deleteLocalFile
        ? `物理删除 ${selectedIds.size} 张图的本地文件 + 卡片?`
        : `从图库移除选中的 ${selectedIds.size} 张图？`,
      detail: deleteLocalFile
        ? '⚠ 不可逆!磁盘上的源文件会被 unlink,DB 行硬删,不会进回收站。'
        : '仅在数据库打软删除标记，磁盘上的源文件不会删除。',
      okText: deleteLocalFile ? '全部物理删除' : '全部移除',
      danger: true
    });
    if (!ok) return;
    const ids = Array.from(selectedIds);

    if (deleteLocalFile) {
      const r = await window.electronAPI.gallery.batchDeleteWithFiles({ ids });
      if (!r.ok) {
        toast.error('批量删除失败', r.error.message);
        return;
      }
      toast.success(
        `已删除 ${r.data.deletedIds.length} 张卡片`,
        `本地文件:已删 ${r.data.fileDeleted} · 已缺失 ${r.data.fileMissing}`
      );
      // 跨功能同步：把这些图从智能画布等的结果预览里一并剔除
      useDeletedMediaStore
        .getState()
        .markDeleted(r.data.deletedIds.map((did) => images.find((x) => x.id === did)?.file_path ?? ''));
    } else {
      const ts = new Date().toISOString();
      const results = await Promise.all(
        ids.map((id) =>
          window.electronAPI.gallery.update({ id, patch: { deleted_at: ts } })
        )
      );
      // 只把「确实删成功」的 id 同步出去：部分失败时不能把失败项也当已删（否则跨功能状态不一致）
      const successfulIds = ids.filter((_id, i) => results[i].ok);
      const failed = ids.length - successfulIds.length;
      if (failed === 0) {
        toast.success('已移入回收站', `成功 ${ids.length} 张`);
      } else {
        toast.error('部分失败', `成功 ${successfulIds.length} / 失败 ${failed}`);
      }
      // 跨功能同步：软删也从智能画布结果预览里剔除（仅成功的；用户已从图库移除）
      useDeletedMediaStore
        .getState()
        .markDeleted(successfulIds.map((id) => images.find((x) => x.id === id)?.file_path ?? ''));
    }
    exitSelectMode();
    refreshImages();
  }

  /**
   * 把当前筛选结果中"file_path 已不在本地"的卡片自动选中。
   * 适合一键收集孤儿卡片用于清理。
   */
  async function selectMissingFilesInView(): Promise<void> {
    const ids = filteredImages.map((im) => im.id);
    if (ids.length === 0) return;
    const r = await window.electronAPI.gallery.probeMissingFiles({ ids });
    if (!r.ok) {
      toast.error('探测失败', r.error.message);
      return;
    }
    if (r.data.missing.length === 0) {
      toast.info('未发现无关联卡片', '当前筛选下,所有卡片的本地文件都存在');
      return;
    }
    setSelectedIds(new Set(r.data.missing));
    toast.success(`已选中 ${r.data.missing.length} 张无关联卡片`);
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
      const p = images.find((x) => x.id === id)?.file_path;
      if (p) useDeletedMediaStore.getState().markDeleted([p]);
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

  // 筛选条件变化即清空批量选择：避免「全选当前筛选 → 改筛选 → 批量删除」误删被筛掉的卡片
  useEffect(() => {
    setSelectedIds(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFilter, modelFilter, aspectFilter]);

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
  function applyAsPrompt(text: string | null): void {
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
          onClick: () => applyAsPrompt(p.text)
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
          label: '发送到智能画布',
          icon: <PlusIcon size={12} />,
          onClick: () => sendPromptToSmartCanvas(p.text)
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

  /** 卡片上右键弹菜单 —— 含二级菜单"转入工具箱…" */
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
        { separator: true },
        {
          label: '用作生图提示词',
          variant: 'accent',
          icon: <SparkleIcon size={12} />,
          disabled: !im.prompt_positive,
          onClick: () => applyAsPrompt(im.prompt_positive)
        },
        {
          label: '作为参考图发回生图',
          icon: <PlusIcon size={12} />,
          onClick: () => void sendAsReferenceToCreate(im)
        },
        {
          label: '加入相册…',
          icon: <FolderIcon size={12} />,
          children: albumSubmenuItems(im)
        },
        { separator: true },
        {
          label: '转入工具箱…',
          icon: <SparkleIcon size={12} />,
          children: [
            {
              label: '保真放大（Real-ESRGAN）',
              icon: <SparkleIcon size={11} />,
              onClick: () => void sendToTools(im, 'upscale')
            },
            {
              label: 'AI 修复放大 · HYPIR',
              icon: <SparkleIcon size={11} />,
              onClick: () => void sendToTools(im, 'hypir')
            }
          ]
        },
        {
          label: '导入画板',
          icon: <PlusIcon size={12} />,
          onClick: () => openImportToCanvas(im)
        },
        {
          label: '发送到智能画布',
          icon: <PlusIcon size={12} />,
          onClick: () => sendToSmartCanvas(im)
        },
        {
          label: '发送提示词到智能画布',
          icon: <PlusIcon size={12} />,
          disabled: !im.prompt_positive,
          onClick: () => sendPromptToSmartCanvas(im.prompt_positive ?? '')
        },
        { separator: true },
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

  /** 把这张图（本地路径）发送到智能画布的收件箱，跳过去后自动加成图片节点。 */
  function sendToSmartCanvas(im: ImageRow): void {
    useSmartInboxStore.getState().push([{ src: im.file_path, name: im.prompt_positive?.slice(0, 20) || '图库图' }]);
    navigate('/smart-canvas');
    toast.success('已发送到智能画布');
  }

  /** 把一段提示词文本发送到智能画布的收件箱，跳过去后自动加成提示词节点。 */
  function sendPromptToSmartCanvas(text: string): void {
    if (!text.trim()) return;
    useSmartInboxStore.getState().push([{ kind: 'prompt', text }]);
    navigate('/smart-canvas');
    toast.success('已发送提示词到智能画布');
  }

  /** 把这张图当作参考图传回 /，复用 imageParamsStore.addRefs */
  async function sendAsReferenceToCreate(im: ImageRow): Promise<void> {
    try {
      const url = localPathToImageUrl(im.file_path);
      const blob = await (await fetch(url)).blob();
      const dataUri = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(typeof r.result === 'string' ? r.result : '');
        r.onerror = () => rej(r.error);
        r.readAsDataURL(blob);
      });
      imgParams.addRefs?.([{ dataUri, path: im.file_path }]);
      navigate('/');
      toast.success('已作为参考图发到生图页');
    } catch (e) {
      toast.error('发送失败', String(e));
    }
  }

  /** 把图库这张图加载为 dataUri，写入 toolsStore.pendingImport + 切到指定 tab，跳到 /tools */
  async function sendToTools(
    im: ImageRow,
    target: 'upscale' | 'hypir' = 'upscale'
  ): Promise<void> {
    try {
      const url = localPathToImageUrl(im.file_path);
      const blob = await (await fetch(url)).blob();
      const dataUri = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(typeof r.result === 'string' ? r.result : '');
        r.onerror = () => rej(r.error);
        r.readAsDataURL(blob);
      });
      const { useToolsStore } = await import('@/store/toolsStore');
      useToolsStore.setState({ pendingImport: dataUri, activeTab: target });
      navigate('/tools');
    } catch (e) {
      toast.error('发送失败', String(e));
    }
  }

  async function openImportToCanvas(im: ImageRow): Promise<void> {
    try {
      const url = localPathToImageUrl(im.file_path);
      const dim = await new Promise<{ w: number; h: number }>((res, rej) => {
        const img = new Image();
        img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = () => rej(new Error('加载失败'));
        img.src = url;
      });
      const name = (im.file_path.split(/[\\/]/).pop() ?? '图层').replace(/\.[^.]+$/, '').slice(0, 30);
      setImportDialog({
        open: true,
        source: { width: dim.w, height: dim.h, name },
        srcs: [{ sourcePath: im.file_path, dataUri: null, width: dim.w, height: dim.h, name }]
      });
    } catch (e) {
      toast.error('打开图片失败', String(e));
    }
  }

  async function batchImportToCanvas(): Promise<void> {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    try {
      const srcs: Array<{ sourcePath: string; dataUri: null; width: number; height: number; name: string }> = [];
      let failed = 0;
      for (const id of ids) {
        const im = images.find((x) => x.id === id);
        if (!im) continue;
        try {
          const url = localPathToImageUrl(im.file_path);
          const dim = await new Promise<{ w: number; h: number }>((res, rej) => {
            const img = new Image();
            img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight });
            img.onerror = () => rej(new Error('skip'));
            img.src = url;
          });
          const name = (im.file_path.split(/[\\/]/).pop() ?? '图层').replace(/\.[^.]+$/, '').slice(0, 30);
          srcs.push({ sourcePath: im.file_path, dataUri: null, width: dim.w, height: dim.h, name });
        } catch {
          failed++; // 加载失败的计数，下面给用户反馈（原先静默跳过）
        }
      }
      if (srcs.length === 0) {
        toast.error('没有可导入的图片', failed ? `${failed} 张加载失败（文件可能已移动/损坏）` : undefined);
        return;
      }
      if (failed > 0) toast.info('部分图片已跳过', `${failed} 张加载失败`);
      // 多张图：用第一张做新画板尺寸预估，"加到当前"则全部 push
      const first = srcs[0];
      setImportDialog({
        open: true,
        source: { width: first.width, height: first.height, name: `${srcs.length} 张` },
        srcs
      });
    } catch (e) {
      toast.error('批量导入画板失败', String(e));
    }
  }

  const allCategories = [VIRTUAL_ALL, ...categories];

  return (
    <div className="mb-manager-root">
      <aside className="mb-manager-sidebar mb-card mb-marquee-glow">
        <div className="mb-manager-sidebar-head">
          <h2>
            <GalleryIcon size={18} /> 图库
          </h2>
          <p>收藏 / 整理 / 复用</p>
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
                  mounted ? (
                    <motion.span
                      layoutId="manager-cat-active"
                      className="mb-manager-cat-bg"
                      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                    />
                  ) : (
                    <span className="mb-manager-cat-bg" />
                  )
                )}
                <span style={{ position: 'relative' }}>{cat.name}</span>
              </button>
            ))}
          </div>
        )}

        {mode === 'gallery' && (
          <>
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

            <div className="mb-manager-albums">
              <div className="mb-manager-cat-label">
                <span>相册</span>
                <button
                  type="button"
                  className="mb-manager-album-add"
                  title="新建相册"
                  onClick={() => setAlbumEditing({ name: '', type: 'manual', smart_rules: null })}
                >
                  <PlusIcon size={12} />
                </button>
              </div>
              <button
                type="button"
                className={`mb-manager-cat ${activeAlbumId === null ? 'is-active' : ''}`}
                onClick={() => setActiveAlbumId(null)}
              >
                {activeAlbumId === null && <span className="mb-manager-cat-bg" />}
                <span style={{ position: 'relative' }}>全部图片</span>
              </button>
              {albums.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className={`mb-manager-cat ${activeAlbumId === a.id ? 'is-active' : ''}`}
                  onClick={() => setActiveAlbumId(a.id)}
                  onContextMenu={(e) => openAlbumMenu(e, a)}
                  title={a.type === 'smart' ? '智能相册：按规则实时匹配（右键编辑/删除）' : '手动相册（右键编辑/删除）'}
                >
                  {activeAlbumId === a.id && <span className="mb-manager-cat-bg" />}
                  <span style={{ position: 'relative' }}>
                    {a.type === 'smart' ? '✦ ' : ''}
                    {a.name}
                  </span>
                </button>
              ))}
              {albums.length === 0 && (
                <div className="mb-manager-album-empty">还没有相册，点上面的 + 新建</div>
              )}
            </div>
          </>
        )}

        {/* 共用：搜索框 + 总条数 + （仅 gallery）批量工具条 —— 全部从右侧 header 搬过来 */}
        <div className="mb-manager-side-actions">
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

          {mode === 'gallery' && (
            <div className="mb-gallery-toolbar">
              {!selectMode ? (
                <button
                  type="button"
                  className="mb-btn mb-btn-secondary mb-btn-sm mb-gallery-toolbar-btn"
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
                    className="mb-btn mb-btn-secondary mb-btn-sm mb-gallery-toolbar-btn"
                    onClick={selectAllInView}
                  >
                    全选当前筛选
                  </button>
                  <button
                    type="button"
                    className="mb-btn mb-btn-secondary mb-btn-sm mb-gallery-toolbar-btn"
                    onClick={invertSelectionInView}
                  >
                    反选
                  </button>
                  <button
                    type="button"
                    className="mb-btn mb-btn-secondary mb-btn-sm mb-gallery-toolbar-btn"
                    onClick={() => void selectMissingFilesInView()}
                    title="自动选中当前筛选下 file_path 已不在本地的孤儿卡片"
                  >
                    选中无关联
                  </button>
                  <button
                    type="button"
                    className="mb-btn mb-btn-secondary mb-btn-sm mb-gallery-toolbar-btn"
                    onClick={clearSelection}
                    disabled={selectedIds.size === 0}
                  >
                    清空选择
                  </button>
                  <button
                    type="button"
                    className="mb-btn mb-btn-secondary mb-btn-sm mb-gallery-toolbar-btn"
                    onClick={batchImportToCanvas}
                    disabled={selectedIds.size === 0}
                    title="把选中的图片全部导入画板"
                  >
                    <PlusIcon size={12} /> 导入画板（{selectedIds.size}）
                  </button>
                  <button
                    type="button"
                    className="mb-btn mb-btn-danger mb-btn-sm mb-gallery-toolbar-btn"
                    onClick={batchDeleteSelected}
                    disabled={selectedIds.size === 0}
                  >
                    <TrashIcon size={12} /> 删除选中（{selectedIds.size}）
                  </button>
                  <label
                    className="mb-gallery-toolbar-checkbox"
                    title={
                      deleteLocalFile
                        ? '勾上 = 同时物理删除本地文件(不可逆,不进回收站)'
                        : '默认关闭 = 只软删除卡片,本地文件保留'
                    }
                  >
                    <input
                      type="checkbox"
                      checked={deleteLocalFile}
                      onChange={(e) => setDeleteLocalFile(e.target.checked)}
                    />
                    <span>同时删本地文件</span>
                  </label>
                  <button
                    type="button"
                    className="mb-btn mb-btn-ghost mb-btn-sm mb-gallery-toolbar-btn"
                    onClick={exitSelectMode}
                  >
                    退出
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </aside>

      <section className="mb-manager-content mb-card mb-marquee-glow">
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
                <AnimatePresence initial={false}>
                  {filteredPrompts.map((p, i) => {
                    const isShortcut = ui.shortcutPromptIds.includes(p.id);
                    // 大量卡片时去掉「交错延迟」（昂贵），但保留轻量 opacity 淡入淡出，搜索/筛选仍有进出反馈
                    const lightMotion = filteredPrompts.length > 80;
                    return (
                      <motion.div
                        key={p.id}
                        {...(lightMotion
                          ? {
                              initial: { opacity: 0 },
                              animate: { opacity: 1 },
                              exit: { opacity: 0 },
                              transition: { duration: 0.15 }
                            }
                          : {
                              initial: { opacity: 0 },
                              animate: { opacity: 1 },
                              exit: { opacity: 0 },
                              transition: { delay: Math.min(i, 24) * 0.015, duration: 0.2 }
                            })}
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
                              loading="lazy"
                              decoding="async"
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
                {/* 大图库时不包 AnimatePresence——它会跟踪 N 张卡片的 exit 动画，
                    在 filter 切换时会让 N 张卡片都重新调度，造成连续掉帧。 */}
                {filteredImages.length > 80 ? (
                  filteredImages.map((im, i) => (
                    <ImageCard
                      key={im.id}
                      img={im}
                      index={i}
                      totalCount={filteredImages.length}
                      selectMode={selectMode}
                      selected={selectedIds.has(im.id)}
                      onToggleSelect={() => toggleSelect(im.id)}
                      onPreview={() => setPreviewSrc(localPathToImageUrl(im.file_path))}
                      onShowFolder={() => showInFolder(im.file_path)}
                      onDelete={() => softDeleteImage(im.id)}
                      onContextMenu={(e) => showImageMenu(e, im)}
                    />
                  ))
                ) : (
                  <AnimatePresence initial={false}>
                    {filteredImages.map((im, i) => (
                      <ImageCard
                        key={im.id}
                        img={im}
                        index={i}
                        totalCount={filteredImages.length}
                        selectMode={selectMode}
                        selected={selectedIds.has(im.id)}
                        onToggleSelect={() => toggleSelect(im.id)}
                        onPreview={() => setPreviewSrc(localPathToImageUrl(im.file_path))}
                        onShowFolder={() => showInFolder(im.file_path)}
                        onDelete={() => softDeleteImage(im.id)}
                        onContextMenu={(e) => showImageMenu(e, im)}
                      />
                    ))}
                  </AnimatePresence>
                )}
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

      <ImportTargetDialog
        open={importDialog.open}
        source={importDialog.source}
        onClose={() => setImportDialog({ open: false, source: null, srcs: [] })}
        onChoose={(mode) => {
          const srcs = importDialog.srcs;
          if (srcs.length === 0) {
            setImportDialog({ open: false, source: null, srcs: [] });
            return;
          }
          if (mode === 'new') {
            // 新建画板：第一张作为基准尺寸 + 首层；剩余的加到当前
            importImageToCanvas(srcs[0], 'new');
            for (let i = 1; i < srcs.length; i++) importImageToCanvas(srcs[i], 'current');
          } else {
            for (const s of srcs) importImageToCanvas(s, 'current');
          }
          toast.success(srcs.length > 1 ? `已导入 ${srcs.length} 张到画板` : '已导入到画板', '正在跳转 …');
          navigate('/canvas');
          setImportDialog({ open: false, source: null, srcs: [] });
        }}
      />

      <AlbumEditModal
        value={albumEditing}
        availableModels={availableModels}
        onClose={() => setAlbumEditing(null)}
        onSave={(input) => void saveAlbum(input)}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────
// 图库单卡
// ─────────────────────────────────────────────────────
function ImageCard({
  img,
  index,
  totalCount,
  selectMode,
  selected,
  onToggleSelect,
  onPreview,
  onShowFolder,
  onDelete,
  onContextMenu
}: {
  img: ImageRow;
  index: number;
  totalCount: number;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onPreview: () => void;
  onShowFolder: () => void;
  onDelete: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}): JSX.Element {
  // 卡片用缩略图（.thumbs/{base}.webp），没有就回退原图；预览 / 操作仍走原图。
  const thumbUrl = localPathToImageUrl(img.thumbnail_path || img.file_path);
  // 尺寸/比例仅从 params_json 推断——原版用 onLoad 读 naturalWidth 来精确化，
  // 但 N 张图同时触发 setState 会让大图库滚动严重卡顿。元数据兜底够用了。
  const meta = useMemo(() => extractMeta(img.params_json), [img.params_json]);
  const created = formatDateTime(img.created_at);

  const sizeLine = [meta.aspect, meta.size, meta.pixels].filter(Boolean).join(' · ');

  // 大图库（>80 张）关掉入场交错动画，避免一次性启动几百个 motion 轨道导致首次渲染卡死
  // 入场动画只用透明度（不再用 y/scale 的 transform）：transform + 卡片合成层在大图库 /
  // 全屏时与背景动画叠加易触发 Chromium 重绘错位（卡片错位 + 闪烁）。纯 opacity 稳定得多。
  const enableEnterAnim = totalCount <= 80;
  const motionProps = enableEnterAnim
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
        transition: { delay: Math.min(index, 24) * 0.015, duration: 0.2 }
      }
    : {};

  return (
    <motion.div
      {...motionProps}
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
          src={thumbUrl}
          alt={img.prompt_positive ?? ''}
          draggable={false}
          loading="lazy"
          decoding="async"
          // 缩略图加载失败（被删 / 系统休眠）就回退到原图，不让用户看到破图标
          onError={(e) => {
            const fallback = localPathToImageUrl(img.file_path);
            const cur = (e.currentTarget as HTMLImageElement).src;
            if (cur !== fallback) (e.currentTarget as HTMLImageElement).src = fallback;
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
