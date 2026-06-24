import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { useSmartCanvasStore, useSmartPreviewStore, getSmartViewCenter } from '@/store/smartCanvasStore';
import { localPathToImageUrl } from '@/lib/imageUrl';
import { toast } from '@/store/toastStore';
import type { SmartNodeData } from '@shared/smartCanvas';
import { MeasuredThumb, thumbPair } from './MeasuredThumb';
import { useDragScroll } from '@/lib/useDragScroll';
import { areaMenu, copyImage, imageSaveAs, dragOutNative, showInFolder, imageAsCreateRef } from './nodeArea';

/** 便携资产库面板开关（工具栏「资产库」按钮驱动；非模态思路，但盖一层背板点击可关）。 */
interface SmartGalleryPanelState {
  open: boolean;
  toggle: () => void;
  close: () => void;
}
export const useSmartGalleryPanelStore = create<SmartGalleryPanelState>((set) => ({
  open: false,
  toggle: () => set((s) => ({ open: !s.open })),
  close: () => set({ open: false })
}));

interface GalleryRow {
  id: number;
  file_path: string;
  thumbnail_path?: string | null;
  prompt_positive?: string | null;
  model_used?: string | null;
  created_at?: string;
}
interface AlbumRow {
  id: number;
  name: string;
}

/**
 * 智能画布的「便携资产库」：完整复用资产库数据通道（api:gallery:list + 相册筛选 + 搜索 + 缩略图），
 * 在画布里随手取图——点击放大（原图）、拖出（原文件，可拖进画布建图片节点 / 拖到其他软件直接用）、
 * 右键 加到画布 / 作参考图 / 复制 / 另存 / 打开目录。
 * 画布中心悬浮窗（与文字放大框同尺寸规格，vw/vh 随窗口自适应）、无遮罩——画布保持可交互。
 */
const VIDEO_PATH_RE = /\.(mp4|webm|mov|mkv|m4v|avi)$/i;
/** 分批渲染步长：一次性挂 500 张 <img> 是面板卡顿来源之一，先渲一屏多一点、按需加载更多。 */
const SHOW_STEP = 160;

export function SmartGalleryPanel(): JSX.Element | null {
  const open = useSmartGalleryPanelStore((s) => s.open);
  const close = useSmartGalleryPanelStore((s) => s.close);
  const openPreview = useSmartPreviewStore((s) => s.open);
  const [rows, setRows] = useState<GalleryRow[]>([]);
  const [albums, setAlbums] = useState<AlbumRow[]>([]);
  const [albumId, setAlbumId] = useState<number | 'all'>('all');
  const [kind, setKind] = useState<'all' | 'image' | 'video'>('all');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [showCount, setShowCount] = useState(SHOW_STEP);
  const gridRef = useDragScroll<HTMLDivElement>();
  // 响应竞态守卫：快速打字时多个 refresh 在途，旧响应后到会覆盖新结果——只认最后一次请求
  const reqSeq = useRef(0);

  async function refresh(album: number | 'all', search: string): Promise<void> {
    const seq = ++reqSeq.current;
    setLoading(true);
    try {
      const r = await window.electronAPI.gallery.list({
        album_id: album === 'all' ? undefined : album,
        search: search.trim() || undefined
      });
      if (seq !== reqSeq.current) return; // 已有更新的请求在途/完成，丢弃旧响应
      if (r.ok) {
        setRows(r.data as unknown as GalleryRow[]);
        setShowCount(SHOW_STEP);
      } else toast.error(r.error.message, r.error.hint);
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  }

  // 打开面板：拉相册列表 + 首屏图
  useEffect(() => {
    if (!open) return;
    void window.electronAPI.album.list().then((r) => {
      if (r.ok) setAlbums(r.data as unknown as AlbumRow[]);
    });
    void refresh(albumId, q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, albumId]);

  // 已打开时 生图完成 / 资产库内容有变（产物自动入库广播）自动刷新（独立订阅，避免闭包里 albumId/q 过期）
  useEffect(() => {
    if (!open) return;
    const doRefresh = (): void => void refresh(albumId, q);
    const offDone = window.electronAPI.on('image:done', doRefresh);
    const offChanged = window.electronAPI.on('gallery:changed', doRefresh);
    return () => {
      offDone();
      offChanged();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, albumId, q]);

  // Esc 关闭（非模态面板没有背板可点）
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  // 搜索去抖
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => void refresh(albumId, q), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  // 类型分拣：全部 / 图片 / 视频（其它文档类在便携库里不展示，主资产库 Manager 才需要）
  const shown = useMemo(() => {
    if (kind === 'all') return rows;
    return rows.filter((r) => {
      const isVideo = VIDEO_PATH_RE.test(r.file_path);
      return kind === 'video' ? isVideo : !isVideo;
    });
  }, [rows, kind]);
  if (!open) return null;

  /** 在当前视图中心把图/视频加成画布节点（图→图片节点；视频→视频上传节点）。 */
  function addToCanvas(row: GalleryRow): void {
    const st = useSmartCanvasStore.getState();
    const center = getSmartViewCenter();
    if (VIDEO_PATH_RE.test(row.file_path)) {
      const id = st.addNode('video-source', center);
      st.updateNodeData(id, { src: row.file_path, name: `资产库视频 #${row.id}` } as Partial<SmartNodeData>);
      toast.success('已加到画布中心（视频上传节点）');
      return;
    }
    const id = st.addNode('image', center);
    st.updateNodeData(id, { src: row.file_path, name: `资产库 #${row.id}` } as Partial<SmartNodeData>);
    toast.success('已加到画布中心');
  }

  /** 统一预览：当前列表全集 + 起始 index（←→ 跨图切换 + 右键菜单）。 */
  function openRowPreview(row: GalleryRow): void {
    const items = shown.map((r) => ({
      src: localPathToImageUrl(r.file_path),
      type: (/\.(mp4|webm|mov)$/i.test(r.file_path) ? 'video' : 'image') as 'video' | 'image',
      meta: { prompt: r.prompt_positive ?? undefined, filePath: r.file_path, modelId: r.model_used ?? undefined }
    }));
    const idx = shown.findIndex((r) => r.id === row.id);
    openPreview(items, Math.max(0, idx));
  }

  function rowMenu(e: React.MouseEvent, row: GalleryRow): void {
    const full = localPathToImageUrl(row.file_path);
    areaMenu(e, [
      { label: VIDEO_PATH_RE.test(row.file_path) ? '加到画布（视频上传节点）' : '加到画布（图片节点）', onClick: () => addToCanvas(row) },
      { label: VIDEO_PATH_RE.test(row.file_path) ? '放大播放' : '放大预览', onClick: () => openRowPreview(row) },
      { label: '作参考图（发到生图页）', onClick: () => void imageAsCreateRef(row.file_path) },
      { separator: true },
      { label: '复制图片', onClick: () => void copyImage(full) },
      { label: '另存…', onClick: () => void imageSaveAs(row.file_path, `gallery-${row.id}.png`) },
      { label: '打开文件所在目录', onClick: () => void showInFolder(row.file_path) }
    ]);
  }

  return createPortal(
    // 画布中心悬浮窗（非模态、无背板）：画布保持可交互，从面板把图直接拖到画布空白即可建图片节点。
    // 资产库规范：不固定占画布底部；中心悬浮（与文字放大框同尺寸）+ 中心 Lightbox 放大预览。
    // portal 到 body（仿 SmartTextViewer）：路由级 framer transform 会让页内 fixed 相对页面而非视口。
    <div className="mb-sc-glp mb-card" role="dialog" aria-label="便携资产库">
        <div className="mb-sc-glp-head">
          <h3>资产库</h3>
          <span className="mb-sc-glp-count">{loading ? '加载中…' : `${shown.length} 张`}</span>
          <button className="mb-sc-node-x" onClick={close} title="关闭">
            ✕
          </button>
        </div>
        <div className="mb-sc-glp-bar">
          <input
            className="mb-input mb-sc-glp-search"
            placeholder="搜索提示词 / 备注…"
            value={q}
            autoFocus
            onChange={(e) => setQ(e.target.value)}
          />
          <select
            className="mb-select mb-sc-glp-album"
            value={albumId === 'all' ? 'all' : String(albumId)}
            onChange={(e) => setAlbumId(e.target.value === 'all' ? 'all' : Number(e.target.value))}
          >
            <option value="all">全部图片</option>
            {albums.map((a) => (
              <option key={a.id} value={String(a.id)}>
                {a.name}
              </option>
            ))}
          </select>
          <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={() => void refresh(albumId, q)}>
            刷新
          </button>
        </div>
        <div className="mb-sc-glp-kinds">
          {([['all', '全部'], ['image', '图片'], ['video', '视频']] as Array<['all' | 'image' | 'video', string]>).map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={`mb-sc-glp-kindbtn ${kind === k ? 'is-active' : ''}`}
              onClick={() => setKind(k)}
            >
              {label}
            </button>
          ))}
        </div>
        {shown.length === 0 && !loading ? (
          <div className="mb-sc-empty">没有图片。生成或导入后这里会自动出现。</div>
        ) : (
          <div className="mb-sc-glp-grid mb-dragscroll" ref={gridRef}>
            {shown.slice(0, showCount).map((row) => {
              const isVideo = VIDEO_PATH_RE.test(row.file_path);
              // 无封面的视频：<img src=mp4> 必然加载失败成裂图 → 用 🎬 占位卡（点击仍可放大播放）
              if (isVideo && !row.thumbnail_path) {
                return (
                  <div
                    key={row.id}
                    className="mb-sc-glp-vph"
                    title="视频 · 点击放大播放 · 右键更多"
                    draggable
                    onDragStart={(e) => dragOutNative(e, row.file_path, `gallery-${row.id}`)}
                    onClick={() => openRowPreview(row)}
                    onContextMenu={(e) => rowMenu(e, row)}
                  >
                    🎬
                  </div>
                );
              }
              const t = row.thumbnail_path
                ? { thumb: localPathToImageUrl(row.thumbnail_path), full: localPathToImageUrl(row.file_path) }
                : thumbPair(row.file_path);
              return (
                <MeasuredThumb
                  key={row.id}
                  src={t.thumb}
                  fullSrc={t.full}
                  noDims
                  alt={row.prompt_positive ?? `图 ${row.id}`}
                  title={`${isVideo ? '视频 · ' : ''}点击放大 · 拖到画布建图片节点 / 拖到其他软件直接用 · 右键更多`}
                  draggable
                  onDragStart={(e) => dragOutNative(e, row.file_path, `gallery-${row.id}`)}
                  onClick={() => openRowPreview(row)}
                  onContextMenu={(e) => rowMenu(e, row)}
                />
              );
            })}
            {shown.length > showCount && (
              <button className="mb-btn mb-btn-sm mb-btn-ghost mb-sc-glp-more" onClick={() => setShowCount((c) => c + SHOW_STEP)}>
                加载更多（还有 {shown.length - showCount} 张）
              </button>
            )}
          </div>
        )}
        <div className="mb-sc-glp-hint">拖图到画布空白=建图片节点 · 拖到其他软件=原文件直接使用 · 右键有更多操作 · Esc 关闭</div>
    </div>,
    document.body
  );
}
