import { Modal } from '@/components/Modal';
import { useCanvasStore } from '@/store/canvasStore';

interface Props {
  open: boolean;
  /** 待导入图片的描述（用于预估新画板尺寸） */
  source: { width: number; height: number; name?: string } | null;
  onChoose: (mode: 'new' | 'current') => void;
  onClose: () => void;
}

/**
 * 询问用户：把这张图导入"新画板"还是"当前正在编辑的画板"。
 * 始终展示两个选项；只有当当前画板**已有图层**时，才特别提示"当前正在编辑"会保留。
 *
 * 新画板尺寸预估：图像比例 × 最大边 ≤ 4096。
 */
export function ImportTargetDialog({ open, source, onChoose, onClose }: Props): JSX.Element {
  const project = useCanvasStore((s) => s.project);
  const hasContent = project.layers.length > 0;

  const newSize = source
    ? (() => {
        const scale = Math.min(1, 4096 / Math.max(source.width, source.height));
        return {
          w: Math.max(64, Math.round(source.width * scale)),
          h: Math.max(64, Math.round(source.height * scale))
        };
      })()
    : null;

  return (
    <Modal open={open} onClose={onClose} title="导入到画板" width={420}>
      {!source ? (
        <p>没有可导入的图片</p>
      ) : (
        <>
          <p style={{ color: 'var(--mb-text-secondary)', fontSize: 'var(--mb-text-aux)', marginTop: 0 }}>
            原图 {source.width} × {source.height}
          </p>
          <div className="mb-canvas-import-grid">
            <button
              type="button"
              className="mb-canvas-import-card"
              onClick={() => onChoose('new')}
            >
              <div className="mb-canvas-import-card-title">新建画板</div>
              <div className="mb-canvas-import-card-desc">
                {newSize ? `${newSize.w} × ${newSize.h}（按图比例，最大 4096）` : ''}
                {hasContent && <div style={{ marginTop: 4, color: '#fb923c' }}>当前画板内容会被替换 ⚠</div>}
              </div>
            </button>
            <button
              type="button"
              className="mb-canvas-import-card"
              onClick={() => onChoose('current')}
            >
              <div className="mb-canvas-import-card-title">加到当前画板</div>
              <div className="mb-canvas-import-card-desc">
                {hasContent
                  ? `当前画板已有 ${project.layers.filter((l) => !l.isGroup).length} 层，新增一层`
                  : '当前画板为空，加为首层'}
              </div>
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
