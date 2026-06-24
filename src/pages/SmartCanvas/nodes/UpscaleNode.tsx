import { useEffect, useState } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { useSmartCanvasStore, useSmartPreviewStore } from '@/store/smartCanvasStore';
import { computeUpstream, runUpscaleNode } from '@/lib/smartCanvasRunner';
import { localPathToImageUrl } from '@/lib/imageUrl';
import { toast } from '@/store/toastStore';
import type { UpscaleNodeData, SmartNodeData } from '@shared/smartCanvas';
import type { UpscaleEngineStatus, UpscaleInstallProgressPayload } from '@shared/ipc';
import { NodeShell } from './NodeShell';
import { areaMenu, imageSaveAs, dragOutNative, showInFolder } from '../nodeArea';

const SCALES = [2, 3, 4] as const;

function imgUrl(src?: string | null): string | null {
  if (!src) return null;
  return src.startsWith('data:') || src.startsWith('http') ? src : localPathToImageUrl(src);
}

/** 保真放大节点：接上游图 → 本地 Real-ESRGAN（api:upscale:run-single）→ 输出放大图喂下游。
 *  引擎不随包：首次在卡上一键安装（与插帧同款 ncnn 引擎模式）。1:1 复刻工具箱「保真放大」。 */
export function UpscaleNode({ id, data }: NodeProps): JSX.Element {
  const update = useSmartCanvasStore((s) => s.updateNodeData);
  const remove = useSmartCanvasStore((s) => s.removeNode);
  const nodes = useSmartCanvasStore((s) => s.nodes);
  const edges = useSmartCanvasStore((s) => s.edges);
  const d = data as unknown as UpscaleNodeData;
  const setF = (p: Partial<UpscaleNodeData>): void => update(id, p as Partial<SmartNodeData>);

  const [engine, setEngine] = useState<UpscaleEngineStatus | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installNote, setInstallNote] = useState('');

  useEffect(() => {
    let alive = true;
    void window.electronAPI.upscale.status().then((r) => {
      if (alive && r.ok) {
        setEngine(r.data);
        if (!d.modelName && r.data.models.length) setF({ modelName: r.data.models[0].name });
      }
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!installing) return;
    const off = window.electronAPI.on('upscale:install-progress', (p) => {
      const e = p as UpscaleInstallProgressPayload;
      const mb = (n: number): string => (n / 1024 / 1024).toFixed(1);
      setInstallNote(e.total > 0 ? `${e.component} · ${mb(e.received)}/${mb(e.total)} MB` : `${e.component} · ${mb(e.received)} MB`);
    });
    return () => {
      off?.();
    };
  }, [installing]);

  async function install(): Promise<void> {
    setInstalling(true);
    setInstallNote('连接下载源…');
    try {
      const r = await window.electronAPI.upscale.installEngine({ source: 'auto' });
      if (!r.ok) {
        toast.error(r.error.message, r.error.hint);
        return;
      }
      toast.success('放大引擎安装完成', `模型：${r.data.modelsInstalled.join('、') || '(未扫到)'}`);
      const s = await window.electronAPI.upscale.status();
      if (s.ok) {
        setEngine(s.data);
        if (!d.modelName && s.data.models.length) setF({ modelName: s.data.models[0].name });
      }
    } finally {
      setInstalling(false);
      setInstallNote('');
    }
  }

  const up = computeUpstream(nodes, edges, id);
  const hasInput = !!up.images[0];
  const running = d.status === 'running';
  const outUrl = imgUrl(d.outputImage);
  const models = engine?.models ?? [];

  const openImg = (): void => {
    if (!d.outputImage || !outUrl) return;
    useSmartPreviewStore.getState().open([{ src: outUrl, type: 'image', meta: { filePath: d.outputImage.startsWith('data:') ? undefined : d.outputImage } }], 0);
  };

  return (
    <>
      <NodeResizer isVisible minWidth={220} minHeight={160} />
      <NodeShell title="保真放大" accent="is-upscale" inputs outputs fill onDelete={() => remove(id)}>
        {engine && !engine.installed ? (
          <div className="mb-sc-revctl nodrag">
            <div className="mb-sc-work-model">本地保真放大（Real-ESRGAN）：2/3/4× 无损放大，不烧中转站</div>
            <button className="mb-btn mb-btn-sm mb-btn-primary" disabled={installing} onClick={() => void install()}>
              {installing ? '安装中…' : '安装放大引擎'}
            </button>
            {installing && <div className="mb-sc-work-model">{installNote || '下载中…'}</div>}
            <div className="mb-sc-empty">一次安装长期使用 · GitHub + 国内镜像自动切换</div>
          </div>
        ) : !hasInput ? (
          <div className="mb-sc-empty">连一个图片来源（图片 / 生图 / ComfyUI / 缩放 / 结果）→ 选模型 / 倍数 → 开始放大</div>
        ) : (
          <div className="mb-sc-revctl nodrag">
            <div className="mb-sc-revrow">
              模型
              <select className="mb-select" value={d.modelName} disabled={running} onChange={(e) => setF({ modelName: e.target.value })}>
                {models.length === 0 && <option value="">（无模型，先装引擎）</option>}
                {models.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="mb-sc-revrow">
              倍数
              <select className="mb-select" value={d.scale} disabled={running} onChange={(e) => setF({ scale: Number(e.target.value) as 2 | 3 | 4 })}>
                {SCALES.map((s) => (
                  <option key={s} value={s}>
                    {s}×
                  </option>
                ))}
              </select>
              格式
              <select className="mb-select" value={d.format} disabled={running} onChange={(e) => setF({ format: e.target.value as UpscaleNodeData['format'] })}>
                <option value="png">PNG</option>
                <option value="jpg">JPG</option>
                <option value="webp">WebP</option>
              </select>
            </div>
            <div className="mb-sc-revrow">
              <button className="mb-btn mb-btn-sm mb-btn-primary" disabled={running} onClick={() => void runUpscaleNode(id)}>
                {running ? '放大中…' : d.outputImage ? '重新放大' : '开始放大'}
              </button>
            </div>
            {d.error && <div className="mb-sc-result-err">{d.error}</div>}
            {outUrl && (
              <button
                type="button"
                className="mb-sc-upscale-out nodrag"
                draggable
                onDragStart={(e) => dragOutNative(e, d.outputImage ?? '', `upscale-${d.scale}x`)}
                onClick={openImg}
                onContextMenu={(e) =>
                  areaMenu(e, [
                    { label: '放大查看', onClick: openImg },
                    { label: '另存…', onClick: () => void imageSaveAs(d.outputImage ?? '', `upscale-${d.scale}x.${d.format}`) },
                    { label: '打开文件所在目录', onClick: () => void showInFolder(d.outputImage ?? '') }
                  ])
                }
                title="点击放大查看 · 拖出直用 · 右键更多"
              >
                <img src={outUrl} alt="放大结果" draggable={false} />
                {d.outW ? (
                  <span className="mb-sc-upscale-dim">
                    {d.outW}×{d.outH}
                  </span>
                ) : null}
              </button>
            )}
          </div>
        )}
      </NodeShell>
    </>
  );
}
