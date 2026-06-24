import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { useSmartCanvasStore } from '@/store/smartCanvasStore';
import { localPathToImageUrl } from '@/lib/imageUrl';
import { toast } from '@/store/toastStore';
import { useDragScroll } from '@/lib/useDragScroll';
import { useBackdropClose } from './nodeArea';

/** 资产库选图：哪个图片节点在等选图（null = 不显示）。在 SmartCanvasPage 顶层挂一个 Dialog 消费。 */
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

/** 从资产库挑一张图填进图片节点（复用 api:gallery:list；点缩略图即选定）。 */
export function GalleryPickerDialog(): JSX.Element | null {
  const targetNodeId = useGalleryPickerStore((s) => s.targetNodeId);
  const close = useGalleryPickerStore((s) => s.close);
  const [rows, setRows] = useState<GalleryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const backdrop = useBackdropClose(close);
  const gridRef = useDragScroll<HTMLDivElement>();

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
    const st = useSmartCanvasStore.getState();
    const node = st.nodes.find((n) => n.id === targetNodeId);
    const d = node?.data as unknown as { listMode?: boolean; srcs?: string[] } | undefined;
    if (d?.listMode) {
      // 列表模式：追加到 srcs，不关闭弹窗（可连续多选）
      st.updateNodeData(targetNodeId as string, { srcs: [...(d.srcs ?? []), row.file_path] });
      toast.success('已加入列表', '可继续点选，或关闭弹窗');
      return;
    }
    st.updateNodeData(targetNodeId as string, {
      src: row.file_path,
      name: row.prompt_positive?.slice(0, 20) || '资产库图',
      // 换成全新一张图：清掉旧图的「最初始图 / 重绘遮罩」血缘
      originalSrc: undefined,
      inpaintMaskSrc: undefined
    });
    close();
    toast.success('已选入图片节点');
  }

  return (
    <div className="mb-modal-backdrop" {...backdrop}>
      <div className="mb-modal mb-sc-gpick" onClick={(e) => e.stopPropagation()}>
        <div className="mb-sc-gpick-head">
          <h3>从资产库选图</h3>
          <button className="mb-sc-node-x" onClick={close} title="关闭">
            ✕
          </button>
        </div>
        {loading ? (
          <div className="mb-sc-empty">加载中…</div>
        ) : rows.length === 0 ? (
          <div className="mb-sc-empty">资产库还没有图片。</div>
        ) : (
          <div className="mb-sc-gpick-grid mb-dragscroll" ref={gridRef}>
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
