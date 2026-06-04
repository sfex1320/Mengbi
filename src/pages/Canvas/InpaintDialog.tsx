import { useEffect, useMemo, useRef, useState } from 'react';
import { useSettingsStore } from '@/store/settingsStore';
import { useImageParamsStore } from '@/store/imageParamsStore';
import { useCanvasStore, makeLayerFromImage } from '@/store/canvasStore';
import { useInpaintMaskStore } from '@/store/inpaintMaskStore';
import {
  maskToEditAlphaPng,
  maskHasCoverage,
  cloneMaskCanvas,
  blurMaskEdge
} from './canvasEngine/maskEngine';
import { exportProjectAsPNG, blobToDataUri } from './canvasEngine/exportPNG';
import { localPathToImageUrl } from '@/lib/imageUrl';
import { autoSnapshot } from '@/store/snapshotStore';
import { toast } from '@/store/toastStore';

interface ImageDonePayload {
  taskId: number;
  paths?: string[];
  cancelled?: boolean;
  error?: string;
}

/**
 * 局部重绘工作流对话框。
 *
 * 流程（需求五节）：当前画布合成为底图 + 蒙版转成「透明 = 编辑区」PNG →
 * 走 api:image:generate（refs=[底图] + params.inpaint_mask）→ 监听 image:done →
 * 结果默认作为新图层叠加，原图不破坏，用户可对比后再合并。
 *
 * 第一阶段面向 OpenAI 兼容的 /images/edits 接口（refs 非空即走 edit）。
 */
export function InpaintDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const { configs, activePlanId } = useSettingsStore();
  const project = useCanvasStore((s) => s.project);
  const addLayer = useCanvasStore((s) => s.addLayer);
  const maskCanvas = useInpaintMaskStore((s) => s.canvas);
  const lastImageModelId = useImageParamsStore((s) => s.imageModelId);

  const imageModels = useMemo(
    () =>
      configs
        .filter((c) => c.plan_id === activePlanId && c.type === 'image' && c.image_kind !== 'comfyui')
        .flatMap((c) => Object.keys(c.model_mapping ?? {})),
    [configs, activePlanId]
  );

  const [modelId, setModelId] = useState(lastImageModelId || imageModels[0] || '');
  const [prompt, setPrompt] = useState('');
  const [negative, setNegative] = useState('');
  const [strength, setStrength] = useState(0.8);
  const [feather, setFeather] = useState(4);
  const [n, setN] = useState(1);
  const [seed, setSeed] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const pendingTaskRef = useRef<number | null>(null);

  // 监听 image:done，匹配本次提交的 taskId → 导入结果
  useEffect(() => {
    const off = window.electronAPI.on('image:done', (payload) => {
      const p = payload as ImageDonePayload;
      if (pendingTaskRef.current === null || p.taskId !== pendingTaskRef.current) return;
      pendingTaskRef.current = null;
      setSubmitting(false);
      if (p.cancelled) {
        toast.info('局部重绘已取消');
        return;
      }
      if (p.error) {
        toast.error('局部重绘失败', p.error);
        return;
      }
      void importResults(p.paths ?? []);
    });
    return () => {
      off();
      pendingTaskRef.current = null; // 卸载时清掉，避免下次开对话框时旧 taskId 撞号误导入
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function importResults(paths: string[]): Promise<void> {
    if (paths.length === 0) {
      toast.error('局部重绘无结果', '上游未返回图片');
      return;
    }
    for (const p of paths) {
      try {
        const url = localPathToImageUrl(p);
        const img = await loadImage(url);
        const layer = makeLayerFromImage({
          name: '局部重绘',
          sourcePath: p,
          width: img.naturalWidth,
          height: img.naturalHeight,
          canvasWidth: project.width,
          canvasHeight: project.height
        });
        addLayer(layer);
      } catch (e) {
        toast.error('结果导入失败', String(e));
      }
    }
    toast.success('局部重绘完成', `已作为新图层叠加（${paths.length} 张），原图保留可对比`);
    onClose();
  }

  async function handleSubmit(): Promise<void> {
    if (!modelId) {
      toast.error('未选择模型', '请先在设置里配置一个绘画模型');
      return;
    }
    if (!maskCanvas || !maskHasCoverage(maskCanvas)) {
      toast.error('蒙版为空', '请先用「蒙版」工具涂抹要重绘的区域');
      return;
    }
    if (!prompt.trim()) {
      toast.error('未填写提示词', '描述这块区域要变成什么');
      return;
    }
    if (project.layers.length === 0) {
      toast.error('画板为空', '没有底图可重绘');
      return;
    }
    setSubmitting(true);
    autoSnapshot('局部重绘前');
    try {
      // 底图：当前画布合成
      const baseBlob = await exportProjectAsPNG(project);
      const baseDataUri = await blobToDataUri(baseBlob);
      // 蒙版：克隆 → 羽化 → 转“透明=编辑区”PNG
      const mc = cloneMaskCanvas(maskCanvas);
      if (feather > 0) blurMaskEdge(mc, feather);
      const maskBlob = await maskToEditAlphaPng(mc);
      const maskDataUri = await blobToDataUri(maskBlob);

      const params: Record<string, unknown> = {
        n,
        inpaint_mask: maskDataUri,
        strength
      };
      const seedNum = parseInt(seed, 10);
      if (Number.isFinite(seedNum)) params.seed = seedNum;

      const r = await window.electronAPI.image.generate({
        modelId,
        positivePrompt: prompt.trim(),
        negativePrompt: negative.trim() || undefined,
        params,
        referenceImages: [baseDataUri]
      });
      if (!r.ok) {
        setSubmitting(false);
        toast.error('提交失败', r.error.message);
        return;
      }
      pendingTaskRef.current = r.data.taskId;
      toast.info('已提交局部重绘', '完成后结果会作为新图层叠加');
    } catch (e) {
      setSubmitting(false);
      toast.error('提交失败', String(e));
    }
  }

  return (
    <div className="mb-modal-backdrop" onClick={submitting ? undefined : onClose}>
      <div className="mb-modal mb-inpaint-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>局部重绘</h3>
        <p className="mb-mask-rule">用「蒙版」工具涂抹的白色区域将被重绘，其余保持不变</p>

        <div className="mb-ps-field">
          <label>模型</label>
          <select
            className="mb-canvas-props-select"
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
          >
            {imageModels.length === 0 && <option value="">（无可用绘画模型）</option>}
            {imageModels.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>

        <div className="mb-ps-field">
          <label>提示词</label>
          <textarea
            className="mb-canvas-props-input"
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="这块区域要变成什么…"
            style={{ width: '100%', fontFamily: 'inherit' }}
          />
        </div>

        <div className="mb-ps-field">
          <label>反向提示词（可选）</label>
          <textarea
            className="mb-canvas-props-input"
            rows={2}
            value={negative}
            onChange={(e) => setNegative(e.target.value)}
            style={{ width: '100%', fontFamily: 'inherit' }}
          />
        </div>

        <div className="mb-canvas-props-row">
          <label style={{ minWidth: 64 }}>重绘强度</label>
          <input
            type="range"
            min={10}
            max={100}
            value={Math.round(strength * 100)}
            onChange={(e) => setStrength(+e.target.value / 100)}
            className="mb-canvas-props-slider"
          />
          <span style={{ minWidth: 42, textAlign: 'right' }}>{Math.round(strength * 100)}%</span>
        </div>
        <div className="mb-canvas-props-row">
          <label style={{ minWidth: 64 }}>蒙版羽化</label>
          <input
            type="range"
            min={0}
            max={40}
            value={feather}
            onChange={(e) => setFeather(+e.target.value)}
            className="mb-canvas-props-slider"
          />
          <span style={{ minWidth: 42, textAlign: 'right' }}>{feather}px</span>
        </div>
        <div className="mb-outpaint-dirs">
          <div className="mb-canvas-props-row">
            <label style={{ minWidth: 40 }}>张数</label>
            <select
              className="mb-canvas-props-select"
              value={n}
              onChange={(e) => setN(+e.target.value)}
            >
              {[1, 2, 3, 4].map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </div>
          <div className="mb-canvas-props-row">
            <label style={{ minWidth: 40 }}>种子</label>
            <input
              type="text"
              inputMode="numeric"
              className="mb-canvas-props-input"
              value={seed}
              placeholder="随机"
              onChange={(e) => setSeed(e.target.value.replace(/[^0-9]/g, ''))}
            />
          </div>
        </div>

        <div className="mb-modal-actions">
          <button type="button" className="mb-btn" onClick={onClose} disabled={submitting}>
            取消
          </button>
          <button
            type="button"
            className="mb-btn mb-btn-primary"
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? '生成中…' : '生成'}
          </button>
        </div>
      </div>
    </div>
  );
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('image load failed'));
    im.src = src;
  });
}
