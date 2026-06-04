import { useCanvasStore, makeLayerFromImage } from '@/store/canvasStore';
import {
  useImageParamsStore,
  REF_TYPE_LABEL,
  type RefType,
  type RefImage
} from '@/store/imageParamsStore';
import { exportProjectAsPNG, blobToDataUri } from './canvasEngine/exportPNG';
import { toast } from '@/store/toastStore';

/**
 * 参考图管理面板（需求七节）。
 * 列出生图参考图，每张可设：名称 / 类型(8 类) / 权重 / 是否启用 / 图生图·局部重绘·仅视觉 标志。
 * 「在画板中编辑」把该参考图作为图层加入画板，复用画布的裁剪/旋转/缩放。
 */
export function ReferencePanel({ onClose }: { onClose: () => void }): JSX.Element {
  const refs = useImageParamsStore((s) => s.refs);
  const addRefs = useImageParamsStore((s) => s.addRefs);
  const removeRefAt = useImageParamsStore((s) => s.removeRefAt);
  const updateRefAt = useImageParamsStore((s) => s.updateRefAt);
  const clearRefs = useImageParamsStore((s) => s.clearRefs);
  const project = useCanvasStore((s) => s.project);
  const addLayer = useCanvasStore((s) => s.addLayer);

  async function handleUpload(): Promise<void> {
    const r = await window.electronAPI.storage.pickImages();
    if (!r.ok) {
      toast.error('打开文件失败', r.error.message);
      return;
    }
    const next: RefImage[] = [];
    for (const f of r.data.files) {
      const img = await loadImage(f.dataUri).catch(() => null);
      next.push({
        path: f.path,
        dataUri: f.dataUri,
        width: img?.naturalWidth,
        height: img?.naturalHeight,
        name: f.path.split(/[\\/]/).pop() ?? '参考图',
        refType: 'style',
        weight: 1,
        enabled: true
      });
    }
    if (next.length) addRefs(next);
  }

  async function handleFromCanvas(): Promise<void> {
    if (project.layers.length === 0) {
      toast.info('画板为空');
      return;
    }
    const blob = await exportProjectAsPNG(project);
    const dataUri = await blobToDataUri(blob);
    addRefs([
      { path: '', dataUri, width: project.width, height: project.height, name: '画板合成', refType: 'composition', weight: 1, enabled: true }
    ]);
    toast.success('已把当前画布加入参考图');
  }

  function editInCanvas(ref: RefImage): void {
    loadImage(ref.dataUri)
      .then((img) => {
        addLayer(
          makeLayerFromImage({
            name: ref.name || '参考图',
            sourcePath: ref.path || null,
            cookedDataUri: ref.path ? null : ref.dataUri,
            width: img.naturalWidth,
            height: img.naturalHeight,
            canvasWidth: project.width,
            canvasHeight: project.height
          })
        );
        toast.success('已加入画板', '用裁剪/旋转/缩放编辑后可重新导出');
        onClose();
      })
      .catch((e) => toast.error('加载失败', String(e)));
  }

  return (
    <div className="mb-modal-backdrop" onClick={onClose}>
      <div className="mb-modal mb-ref-panel" onClick={(e) => e.stopPropagation()}>
        <h3>参考图管理 · {refs.length}</h3>
        <div className="mb-canvas-props-btnrow">
          <button type="button" className="mb-canvas-props-actionbtn is-accent" onClick={handleUpload}>
            ＋ 上传参考图
          </button>
          <button type="button" className="mb-canvas-props-actionbtn" onClick={handleFromCanvas}>
            用当前画布
          </button>
          {refs.length > 0 && (
            <button type="button" className="mb-canvas-props-actionbtn is-danger" onClick={clearRefs}>
              清空
            </button>
          )}
        </div>

        <div className="mb-ref-list">
          {refs.length === 0 && <div className="mb-canvas-props-empty">暂无参考图</div>}
          {refs.map((ref, idx) => (
            <div key={idx} className={`mb-ref-item ${ref.enabled === false ? 'is-off' : ''}`}>
              <img className="mb-ref-thumb" src={ref.dataUri} alt={ref.name ?? ''} draggable={false} />
              <div className="mb-ref-fields">
                <input
                  className="mb-canvas-props-input"
                  value={ref.name ?? ''}
                  placeholder="名称"
                  onChange={(e) => updateRefAt(idx, { name: e.target.value })}
                />
                <div className="mb-ref-row">
                  <select
                    className="mb-canvas-props-select"
                    value={ref.refType ?? 'style'}
                    onChange={(e) => updateRefAt(idx, { refType: e.target.value as RefType })}
                  >
                    {(Object.keys(REF_TYPE_LABEL) as RefType[]).map((t) => (
                      <option key={t} value={t}>
                        {REF_TYPE_LABEL[t]}
                      </option>
                    ))}
                  </select>
                  <span className="mb-ref-weight">权重 {(ref.weight ?? 1).toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={200}
                  value={Math.round((ref.weight ?? 1) * 100)}
                  onChange={(e) => updateRefAt(idx, { weight: +e.target.value / 100 })}
                  className="mb-canvas-props-slider"
                />
                <div className="mb-ref-flags">
                  <label><input type="checkbox" checked={ref.enabled !== false} onChange={(e) => updateRefAt(idx, { enabled: e.target.checked })} />启用</label>
                  <label><input type="checkbox" checked={!!ref.forImg2img} onChange={(e) => updateRefAt(idx, { forImg2img: e.target.checked })} />图生图</label>
                  <label><input type="checkbox" checked={!!ref.forInpaint} onChange={(e) => updateRefAt(idx, { forInpaint: e.target.checked })} />重绘</label>
                  <label><input type="checkbox" checked={!!ref.visualOnly} onChange={(e) => updateRefAt(idx, { visualOnly: e.target.checked })} />仅视觉</label>
                </div>
                <div className="mb-canvas-props-btnrow">
                  <button type="button" className="mb-canvas-props-actionbtn" onClick={() => editInCanvas(ref)}>
                    在画板中编辑
                  </button>
                  <button type="button" className="mb-canvas-props-actionbtn is-danger" onClick={() => removeRefAt(idx)}>
                    删除
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mb-modal-actions">
          <button type="button" className="mb-btn" onClick={onClose}>
            完成
          </button>
        </div>
      </div>
    </div>
  );
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('image load failed'));
    im.src = src;
  });
}
