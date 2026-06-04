import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { useSmartCanvasStore } from '@/store/smartCanvasStore';
import { localPathToImageUrl } from '@/lib/imageUrl';
import { toast } from '@/store/toastStore';

/** 图库选图：哪个图片节点在等选图（null = 不显示）。在 SmartCanvasPage 顶层挂一个 Dialog 消费。 */
interface GalleryPickerState {
  targetNodeId: string | null;
  open: (nodeId: string) => void;
  close: () => void;
}
export const useGalleryPickerStore = create<GalleryPickerState>((set) => ({
  targetNodeId: null,
  open: (targetNodeId) => set({ targetNodeId }),
  close: () => set({ targetNodeId: null })
}));

interface GalleryRow {
  id: number;
  file_path: string;
  thumbnail_path: string | null;
  prompt_positive?: string | null;
}

/** 从图库挑一张图填进图片节点（复用 api:gallery:list；点缩略图即选定）。 */
export function GalleryPickerDialog(): JSX.Element | null {
  const targetNodeId = useGalleryPickerStore((s) => s.targetNodeId);
  const close = useGalleryPickerStore((s) => s.close);
  const [rows, setRows] = useState<GalleryRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!targetNodeId) return;
    setLoading(true);
    void window.electronAPI.gallery
      .list({})
      .then((r) => {
        if (r.ok) setRows(r.data as unknown as GalleryRow[]);
        else toast.error(r.error.message, r.error.hint);
      })
      .finally(() => setLoading(false));
  }, [targetNodeId]);

  if (!targetNodeId) return null;

  function pick(row: GalleryRow): void {
    useSmartCanvasStore.getState().updateNodeData(targetNodeId as string, {
      src: row.file_path,
      name: row.prompt_positive?.slice(0, 20) || '图库图'
    });
    close();
    toast.success('已选入图片节点');
  }

  return (
    <div className="mb-modal-backdrop" onClick={close}>
      <div className="mb-modal mb-sc-gpick" onClick={(e) => e.stopPropagation()}>
        <div className="mb-sc-gpick-head">
          <h3>从图库选图</h3>
          <button className="mb-sc-node-x" onClick={close} title="关闭">
            ✕
          </button>
        </div>
        {loading ? (
          <div className="mb-sc-empty">加载中…</div>
        ) : rows.length === 0 ? (
          <div className="mb-sc-empty">图库还没有图片。</div>
        ) : (
          <div className="mb-sc-gpick-grid">
            {rows.map((row) => (
              <button
                key={row.id}
                className="mb-sc-gpick-item"
                title={row.prompt_positive ?? ''}
                onClick={() => pick(row)}
              >
                <img src={localPathToImageUrl(row.thumbnail_path || row.file_path)} alt="" draggable={false} />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
