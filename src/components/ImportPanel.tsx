import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { toast } from '@/store/toastStore';
import { localPathToImageUrl } from '@/lib/imageUrl';
import { Modal } from '@/components/Modal';
import { FolderIcon, ImageIcon, GalleryIcon, TrashIcon } from '@/components/Icon';
import './ImportPanel.css';

interface Props {
  /** 当前已加载的图（dataUri）；空表示还没载入 */
  value: string | null;
  /** 用户加载新图时回调，传 dataUri */
  onChange: (dataUri: string | null) => void;
  /** 可选：限制最大边（像素），超过会前端缩放避免后续推理 OOM */
  maxDim?: number;
}

/**
 * 工具箱共用的"图片输入"组件。
 *
 * 5 个入口：
 * - 拖入（HTML5 dragover/drop）
 * - 系统粘贴（监听 paste 事件，从 clipboard 取 image item）
 * - 「打开文件」按钮（input[type=file]）
 * - 「从图库导入」按钮（弹出图库选择对话框）
 * - 跨页面预填（由调用方 setValue 触发，不在本组件内处理）
 *
 * 加载后展示缩略图 + 「移除」按钮回到空态。
 */
export function ImportPanel({ value, onChange, maxDim }: Props): JSX.Element {
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function loadFromFile(file: File): Promise<void> {
    if (!file.type.startsWith('image/')) {
      toast.error('仅支持图片');
      return;
    }
    const dataUri = await readFileAsDataUri(file);
    if (!dataUri) {
      toast.error('读取文件失败');
      return;
    }
    const final = maxDim ? await maybeDownscale(dataUri, maxDim) : dataUri;
    onChange(final);
  }

  // 全局监听粘贴
  useEffect(() => {
    function onPaste(e: ClipboardEvent): void {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const it of Array.from(items)) {
        if (it.kind === 'file' && it.type.startsWith('image/')) {
          const f = it.getAsFile();
          if (f) {
            void loadFromFile(f);
            e.preventDefault();
            return;
          }
        }
      }
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
    // loadFromFile 不写进依赖：useEffect 只装一次，loadFromFile 内部用最新 props 通过闭包没问题
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxDim]);

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
    const f = e.dataTransfer.files[0];
    if (f) await loadFromFile(f);
  }

  async function pickFromDialog(): Promise<void> {
    const r = await window.electronAPI.storage.pickImages();
    if (!r.ok) {
      toast.error('打开失败', r.error.message);
      return;
    }
    const f = r.data.files[0];
    if (!f) return;
    const final = maxDim ? await maybeDownscale(f.dataUri, maxDim) : f.dataUri;
    onChange(final);
  }

  if (value) {
    return (
      <div className="mb-import-panel mb-import-panel-loaded">
        <img src={value} alt="输入图" className="mb-import-thumb" />
        <button
          className="mb-btn mb-btn-ghost mb-btn-sm"
          onClick={() => onChange(null)}
          title="移除并重新选图"
        >
          <TrashIcon size={13} /> 移除
        </button>
      </div>
    );
  }

  return (
    <>
      <div
        className={`mb-import-panel ${dragOver ? 'is-dragover' : ''}`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
          className="mb-import-empty"
        >
          <ImageIcon size={32} />
          <div className="mb-import-empty-title">拖入图片到此处</div>
          <div className="mb-import-empty-hint">支持 PNG / JPG / WebP；也可粘贴 / 打开文件 / 从图库导入</div>
          <div className="mb-import-actions">
            <button
              className="mb-btn mb-btn-secondary mb-btn-sm"
              onClick={() => fileInputRef.current?.click()}
            >
              <FolderIcon size={14} /> 打开文件
            </button>
            <button
              className="mb-btn mb-btn-secondary mb-btn-sm"
              onClick={pickFromDialog}
              title="从系统文件选择对话框"
            >
              <FolderIcon size={14} /> 系统选取
            </button>
            <button
              className="mb-btn mb-btn-secondary mb-btn-sm"
              onClick={() => setGalleryOpen(true)}
            >
              <GalleryIcon size={14} /> 从图库导入
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) await loadFromFile(f);
              e.target.value = '';
            }}
          />
        </motion.div>
      </div>
      <GalleryPicker
        open={galleryOpen}
        onClose={() => setGalleryOpen(false)}
        onPick={async (filePath) => {
          setGalleryOpen(false);
          // 把图库本地文件转 dataUri 加载
          try {
            const url = localPathToImageUrl(filePath);
            const r = await fetch(url);
            const blob = await r.blob();
            const dataUri = await blobToDataUri(blob);
            const final = maxDim ? await maybeDownscale(dataUri, maxDim) : dataUri;
            onChange(final);
          } catch (e) {
            toast.error('载入失败', String(e));
          }
        }}
      />
    </>
  );
}

interface GalleryRow {
  id: number;
  file_path: string;
  prompt_positive?: string;
  created_at?: string;
}

function GalleryPicker({
  open,
  onClose,
  onPick
}: {
  open: boolean;
  onClose: () => void;
  onPick: (filePath: string) => void;
}): JSX.Element {
  const [rows, setRows] = useState<GalleryRow[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    void window.electronAPI.gallery
      .list()
      .then((r) => {
        if (r.ok) setRows(r.data.slice(0, 60) as GalleryRow[]);
      })
      .finally(() => setLoading(false));
  }, [open]);
  return (
    <Modal open={open} onClose={onClose} title="从图库导入" width={720} dismissOnBackdrop>
      <div className="mb-gallery-picker">
        {loading && <div className="mb-gallery-picker-loading">加载中…</div>}
        {!loading && rows.length === 0 && (
          <div className="mb-gallery-picker-empty">图库为空——先去生图页生成几张图</div>
        )}
        <div className="mb-gallery-picker-grid">
          {rows.map((r) => (
            <button
              key={r.id}
              className="mb-gallery-picker-cell"
              onClick={() => onPick(r.file_path)}
              title={r.prompt_positive ?? ''}
            >
              <img src={localPathToImageUrl(r.file_path)} alt="" />
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function readFileAsDataUri(f: File): Promise<string | null> {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(typeof r.result === 'string' ? r.result : null);
    r.onerror = () => resolve(null);
    r.readAsDataURL(f);
  });
}

function blobToDataUri(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(typeof r.result === 'string' ? r.result : '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });
}

/**
 * 单边超过 maxDim 时，等比例缩到 maxDim 再返回新 dataUri。
 * 用 Canvas 做（OffscreenCanvas 兼容性 still patchy in 2026 Electron），主线程很短开销可接受。
 */
async function maybeDownscale(dataUri: string, maxDim: number): Promise<string> {
  const img = await loadImage(dataUri);
  const max = Math.max(img.naturalWidth, img.naturalHeight);
  if (max <= maxDim) return dataUri;
  const ratio = maxDim / max;
  const w = Math.round(img.naturalWidth * ratio);
  const h = Math.round(img.naturalHeight * ratio);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUri;
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/png');
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('加载图片失败'));
    img.src = src;
  });
}
