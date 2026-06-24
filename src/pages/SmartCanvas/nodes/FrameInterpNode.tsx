import { useEffect, useState } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { useSmartCanvasStore } from '@/store/smartCanvasStore';
import { computeUpstream, runFrameInterpNode, cancelFrameInterp } from '@/lib/smartCanvasRunner';
import { localPathToImageUrl } from '@/lib/imageUrl';
import { toast } from '@/store/toastStore';
import type { FrameInterpNodeData, SmartNodeData } from '@shared/smartCanvas';
import type { InterpEngineStatus, InterpInstallProgressPayload } from '@shared/ipc';
import { NodeShell } from './NodeShell';
import { areaMenu, imageSaveAs, dragOutNative, showInFolder, openVideoPreview, hoverPreviewProps } from '../nodeArea';

function videoUrl(src?: string | null): string | null {
  if (!src) return null;
  return src.startsWith('data:') || src.startsWith('http') ? src : localPathToImageUrl(src);
}

const FPS_OPTIONS = [30, 48, 60] as const;

/** 插帧节点：接上游视频 → 本地 RIFE AI 运动插帧（24fps→60fps）→ 输出 mp4 喂下游。
 *  引擎不随包：首次使用在卡上一键安装（~40MB，GitHub + 国内镜像自动切换）。 */
export function FrameInterpNode({ id, data }: NodeProps): JSX.Element {
  const update = useSmartCanvasStore((s) => s.updateNodeData);
  const remove = useSmartCanvasStore((s) => s.removeNode);
  const nodes = useSmartCanvasStore((s) => s.nodes);
  const edges = useSmartCanvasStore((s) => s.edges);
  const d = data as unknown as FrameInterpNodeData;
  const setF = (p: Partial<FrameInterpNodeData>): void => update(id, p as Partial<SmartNodeData>);

  const [engine, setEngine] = useState<InterpEngineStatus | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installNote, setInstallNote] = useState('');

  useEffect(() => {
    let alive = true;
    void window.electronAPI.interp.status().then((r) => {
      if (alive && r.ok) setEngine(r.data);
    });
    return () => {
      alive = false;
    };
  }, []);

  // 安装期间订阅下载进度（仅本组件挂载时；安装是一次性的，无需全局监听）
  useEffect(() => {
    if (!installing) return;
    const off = window.electronAPI.on('interp:install-progress', (p) => {
      const e = p as InterpInstallProgressPayload;
      const mb = (n: number): string => (n / 1024 / 1024).toFixed(1);
      setInstallNote(
        e.total > 0 ? `${e.component} · ${mb(e.received)}/${mb(e.total)} MB` : `${e.component} · ${mb(e.received)} MB`
      );
    });
    return () => {
      off?.();
    };
  }, [installing]);

  async function install(): Promise<void> {
    setInstalling(true);
    setInstallNote('连接下载源…');
    try {
      const r = await window.electronAPI.interp.installEngine({ source: 'auto' });
      if (!r.ok) {
        toast.error(r.error.message, r.error.hint);
        return;
      }
      toast.success('插帧引擎安装完成', `模型：${r.data.models.join('、') || '(未扫到)'}`);
      const s = await window.electronAPI.interp.status();
      if (s.ok) setEngine(s.data);
    } finally {
      setInstalling(false);
      setInstallNote('');
    }
  }

  const up = computeUpstream(nodes, edges, id);
  const upVideo = up.videos[0];
  const outUrl = videoUrl(d.outputVideo);
  const running = d.status === 'running';

  return (
    <>
      <NodeResizer isVisible minWidth={220} minHeight={160} />
      <NodeShell title="插帧" accent="is-frame-interp" inputs outputs fill onDelete={() => remove(id)}>
        {engine && !engine.installed ? (
          <div className="mb-sc-revctl nodrag">
            <div className="mb-sc-work-model">本地 AI 插帧（RIFE）：把 24fps 视频补到 30/48/60fps，更流畅</div>
            <button className="mb-btn mb-btn-sm mb-btn-primary" disabled={installing} onClick={() => void install()}>
              {installing ? '安装中…' : '安装插帧引擎（约 40MB）'}
            </button>
            {installing && <div className="mb-sc-work-model">{installNote || '下载中…'}</div>}
            <div className="mb-sc-empty">一次安装长期使用 · 走 GitHub + 国内镜像自动切换 · 不占显存（用时才运行）</div>
          </div>
        ) : !upVideo ? (
          <div className="mb-sc-empty">连一个视频来源（视频上传 / 视频生成 / 缩放）→ 选目标帧率 → 开始插帧</div>
        ) : (
          <div className="mb-sc-revctl nodrag">
            <div className="mb-sc-work-model">
              {d.srcFps ? `源 ${d.srcFps}fps → ${d.targetFps}fps` : `目标 ${d.targetFps}fps（AI 运动插帧）`}
            </div>
            <div className="mb-sc-revrow">
              目标帧率
              <select
                className="mb-select"
                value={d.targetFps}
                disabled={running}
                onChange={(e) => setF({ targetFps: Number(e.target.value) || 60 })}
                title="生成模型多为固定 24fps；目标帧率越高处理越慢"
              >
                {FPS_OPTIONS.map((f) => (
                  <option key={f} value={f}>
                    {f} fps
                  </option>
                ))}
              </select>
            </div>
            <div className="mb-sc-revrow">
              {running ? (
                <button className="mb-btn mb-btn-sm" onClick={() => void cancelFrameInterp(id)}>
                  取消
                </button>
              ) : (
                <button className="mb-btn mb-btn-sm mb-btn-primary" onClick={() => void runFrameInterpNode(id)}>
                  {d.outputVideo ? '重新插帧' : '开始插帧'}
                </button>
              )}
            </div>
            {running && (
              <div className="mb-sc-video-prog nodrag">
                <div className="mb-sc-video-prog-track">
                  <i style={{ width: `${d.progress ?? 0}%` }} />
                </div>
                <span>{d.phase ?? '处理中…'}</span>
              </div>
            )}
            {d.error && <div className="mb-sc-result-err">{d.error}</div>}
            {outUrl && (
              <>
                <video
                  className="mb-sc-video-player nodrag"
                  src={outUrl}
                  controls
                  loop
                  muted
                  preload="metadata"
                  {...hoverPreviewProps()}
                  title="悬停自动预览 · 双击放大播放 · 右键更多"
                  onDoubleClick={() => openVideoPreview([d.outputVideo ?? outUrl])}
                  onContextMenu={(e) =>
                    areaMenu(e, [
                      { label: '放大播放', onClick: () => openVideoPreview([d.outputVideo ?? outUrl]) },
                      { label: '另存视频…', onClick: () => void imageSaveAs(d.outputVideo ?? '', `interp-${d.targetFps}fps.mp4`) },
                      { label: '打开文件所在目录', onClick: () => void showInFolder(d.outputVideo ?? '') }
                    ])
                  }
                />
                <div
                  className="mb-sc-result-vidgrab nodrag"
                  draggable
                  onDragStart={(e) => dragOutNative(e, d.outputVideo ?? '', `interp-${d.targetFps}fps`)}
                  title="按住拖出：把视频原文件拖进其他软件直接用"
                >
                  ⠿ 拖出视频{d.durationMs ? ` · 用时 ${(d.durationMs / 1000).toFixed(1)}s` : ''}
                </div>
              </>
            )}
          </div>
        )}
      </NodeShell>
    </>
  );
}
