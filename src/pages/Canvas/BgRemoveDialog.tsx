import { useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/Modal';
import type { Layer } from './types';
import { useCanvasStore, layerDisplaySrc, makeLayerFromImage } from '@/store/canvasStore';
import { useInpaintMaskStore } from '@/store/inpaintMaskStore';
import { renderLayersToCanvas } from './canvasEngine/exportPNG';
import { maskFromAlpha } from './canvasEngine/maskEngine';
import { autoSnapshot } from '@/store/snapshotStore';
import { toast } from '@/store/toastStore';

interface Props {
  open: boolean;
  onClose: () => void;
  layer: Layer | null;
}

/**
 * 抠图弹窗：
 *   - 点"开始抠图"动态 import @imgly/background-removal（避免首屏加载时把 50MB 模型也拉进来）
 *   - 进度条 + 完成预览（原图 vs 抠后）
 *   - 用户确认 → 写入 layer.cookedDataUri
 *
 * 模型默认从 CDN 拉。Electron 离线场景下，把模型放在打包目录后通过 publicPath 指过去（v1.5+）。
 */
export function BgRemoveDialog({ open, onClose, layer }: Props): JSX.Element {
  const setCooked = useCanvasStore((s) => s.setCooked);
  const [phase, setPhase] = useState<'idle' | 'loading' | 'preview' | 'error'>('idle');
  const [progress, setProgress] = useState(0);
  const [resultUri, setResultUri] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [splitOutput, setSplitOutput] = useState(false);
  const cancelRef = useRef(false);

  useEffect(() => {
    if (!open) {
      setPhase('idle');
      setProgress(0);
      setResultUri(null);
      setErrorMsg('');
      cancelRef.current = false;
    }
  }, [open]);

  async function start(): Promise<void> {
    if (!layer) return;
    const src = layerDisplaySrc(layer);
    if (!src) {
      setErrorMsg('图层没有可抠图的源');
      setPhase('error');
      return;
    }
    setPhase('loading');
    setProgress(0);
    cancelRef.current = false;
    try {
      // 动态 import：首次抠图才拉这部分代码 + 远端模型
      const { removeBackground } = await import('@imgly/background-removal');
      const blob = await fetchToBlob(src);
      const out = await removeBackground(blob, {
        progress: (key: string, current: number, total: number) => {
          if (cancelRef.current) return;
          if (total > 0) {
            const p = Math.min(100, Math.round((current / total) * 100));
            // 多阶段进度：模型下载阶段 0~80%，推理阶段 80~100%
            if (key.includes('fetch') || key.includes('download')) {
              setProgress(Math.round(p * 0.8));
            } else {
              setProgress(80 + Math.round(p * 0.2));
            }
          }
        }
      });
      if (cancelRef.current) return;
      const dataUri = await blobToDataUri(out);
      setResultUri(dataUri);
      setPhase('preview');
      setProgress(100);
    } catch (e) {
      setErrorMsg(String(e));
      setPhase('error');
    }
  }

  async function applyAndClose(): Promise<void> {
    if (!layer || !resultUri) return;
    if (!splitOutput) {
      setCooked(layer.id, resultUri);
      toast.success('抠图已应用', '可在右侧"恢复原图"撤销');
      onClose();
      return;
    }
    // 拆分：主体图层 + 背景图层 + 主体蒙版（需求十节）
    autoSnapshot('抠图拆分前');
    try {
      const orig = await loadImageEl(origSrc);
      const subj = await loadImageEl(resultUri);
      const w = orig.naturalWidth;
      const h = orig.naturalHeight;
      // 背景 = 原图 - 主体（destination-out 抠掉主体像素）
      const bg = document.createElement('canvas');
      bg.width = w;
      bg.height = h;
      const bx = bg.getContext('2d')!;
      bx.drawImage(orig, 0, 0, w, h);
      bx.globalCompositeOperation = 'destination-out';
      bx.drawImage(subj, 0, 0, w, h);
      const bgUri = bg.toDataURL('image/png');

      const store = useCanvasStore.getState();
      const cur = store.project.layers.find((l) => l.id === layer.id);
      if (!cur) {
        onClose();
        return;
      }
      // 原图层 → 背景（保留变换）
      store.replaceLayerSource(layer.id, { sourcePath: null, cookedDataUri: bgUri, width: w, height: h });
      store.updateLayer(layer.id, { name: '背景' });
      // 主体新图层（复制原变换，叠在最上）
      const subjLayer = makeLayerFromImage({
        name: '主体',
        sourcePath: null,
        cookedDataUri: resultUri,
        width: subj.naturalWidth,
        height: subj.naturalHeight,
        canvasWidth: store.project.width,
        canvasHeight: store.project.height
      });
      subjLayer.x = cur.x;
      subjLayer.y = cur.y;
      subjLayer.scaleX = cur.scaleX;
      subjLayer.scaleY = cur.scaleY;
      subjLayer.rotation = cur.rotation;
      subjLayer.skewX = cur.skewX;
      subjLayer.skewY = cur.skewY;
      store.addLayer(subjLayer);
      // 主体蒙版（项目坐标）
      const projCanvas = await renderLayersToCanvas(useCanvasStore.getState().project, [subjLayer], false);
      const mask = maskFromAlpha(projCanvas, useInpaintMaskStore.getState().color);
      useInpaintMaskStore.getState().replaceCanvas(mask);
      toast.success('已拆分', '主体 / 背景 已分层，主体蒙版已生成');
      onClose();
    } catch (e) {
      setErrorMsg(String(e));
      setPhase('error');
    }
  }

  if (!layer) {
    return <Modal open={open} onClose={onClose} title="抠除背景"><p>未选择图层</p></Modal>;
  }

  const origSrc = layerDisplaySrc(layer) ?? '';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="抠除背景"
      width={580}
      footer={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {phase === 'idle' && (
            <>
              <button type="button" className="mb-canvas-toolbar-btn" onClick={onClose}>取消</button>
              <button type="button" className="mb-canvas-toolbar-btn is-primary" onClick={start}>
                开始抠图
              </button>
            </>
          )}
          {phase === 'loading' && (
            <button
              type="button"
              className="mb-canvas-toolbar-btn"
              onClick={() => {
                cancelRef.current = true;
                onClose();
              }}
            >
              取消
            </button>
          )}
          {phase === 'preview' && (
            <>
              <button type="button" className="mb-canvas-toolbar-btn" onClick={onClose}>放弃</button>
              <button type="button" className="mb-canvas-toolbar-btn is-primary" onClick={() => void applyAndClose()}>
                {splitOutput ? '拆分应用' : '应用'}
              </button>
            </>
          )}
          {phase === 'error' && (
            <button type="button" className="mb-canvas-toolbar-btn" onClick={onClose}>关闭</button>
          )}
        </div>
      }
    >
      {phase === 'idle' && (
        <p style={{ color: 'var(--mb-text-secondary)', fontSize: 'var(--mb-text-aux)', lineHeight: 1.6 }}>
          点「开始抠图」即可。首次需联网下载约 50MB 模型（仅一次，之后离线可用）。
          <br />
          完成后可选择：仅把背景变透明，或拆分为「主体图层 + 背景图层」并自动生成主体蒙版。
        </p>
      )}
      {phase === 'loading' && (
        <div className="mb-canvas-bg-progress">
          <div style={{ color: 'var(--mb-text-secondary)', fontSize: 'var(--mb-text-aux)' }}>
            正在抠图… {progress}%
          </div>
          <div className="mb-canvas-bg-progress-bar">
            <div className="mb-canvas-bg-progress-fill" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}
      {phase === 'preview' && resultUri && (
        <>
          <div className="mb-canvas-bg-preview-grid">
            <figure>
              <img src={origSrc} alt="原图" />
              <figcaption>原图</figcaption>
            </figure>
            <figure>
              <img src={resultUri} alt="抠后" />
              <figcaption>抠后</figcaption>
            </figure>
          </div>
          <label className="mb-ps-checkrow" style={{ marginTop: 10 }}>
            <input type="checkbox" checked={splitOutput} onChange={(e) => setSplitOutput(e.target.checked)} />
            拆分为「主体图层 + 背景图层」并生成主体蒙版（否则仅把背景变透明）
          </label>
        </>
      )}
      {phase === 'error' && (
        <div style={{ color: '#fca5a5', fontSize: 'var(--mb-text-aux)' }}>
          抠图失败：{errorMsg}
          <p style={{ color: 'var(--mb-text-muted)', marginTop: 8 }}>
            常见原因：网络无法访问模型 CDN；图片损坏；GPU/wasm 不支持。
          </p>
        </div>
      )}
    </Modal>
  );
}

function loadImageEl(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('image load failed'));
    im.src = src;
  });
}

async function fetchToBlob(src: string): Promise<Blob> {
  if (src.startsWith('data:')) {
    const r = await fetch(src);
    return r.blob();
  }
  // mengbi-image:// 也支持 fetch（main 已注册为 standard 协议 + supportFetchAPI）
  const r = await fetch(src);
  return r.blob();
}

function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
