import { useState } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { useSmartCanvasStore } from '@/store/smartCanvasStore';
import { localPathToImageUrl } from '@/lib/imageUrl';
import { isVideoFile, electronFilePath } from '@/lib/mediaFile';
import { toast } from '@/store/toastStore';
import type { VideoSourceNodeData, SmartNodeData } from '@shared/smartCanvas';
import { NodeShell } from './NodeShell';
import { areaMenu, imageSaveAs, openVideoPreview, showInFolder, hoverPreviewProps } from '../nodeArea';

function videoUrl(src?: string): string | null {
  if (!src) return null;
  return src.startsWith('data:') || src.startsWith('http') ? src : localPathToImageUrl(src);
}

/** 视频上传/来源节点：上传本地视频 / 填 URL → 卡上播放 → 输出视频给下游（视频反推 / 缩放 / 结果）。 */
export function VideoSourceNode({ id, data }: NodeProps): JSX.Element {
  const update = useSmartCanvasStore((s) => s.updateNodeData);
  const remove = useSmartCanvasStore((s) => s.removeNode);
  const d = data as unknown as VideoSourceNodeData;
  const [urlDraft, setUrlDraft] = useState('');
  const setF = (p: Partial<VideoSourceNodeData>): void => update(id, p as Partial<SmartNodeData>);
  const url = videoUrl(d.src);

  async function pick(): Promise<void> {
    const r = await window.electronAPI.storage.pickFile({ filters: [{ name: '视频', extensions: ['mp4', 'mov', 'webm', 'mkv', 'm4v'] }] });
    if (!r.ok || !r.data.filePath) return;
    const p = r.data.filePath;
    setF({ src: p, name: p.split(/[\\/]/).pop() ?? '视频' });
  }
  function applyUrl(): void {
    const u = urlDraft.trim();
    if (!u) return;
    if (!/^https?:\/\//.test(u)) {
      toast.error('请填公网视频 URL', '以 http(s):// 开头');
      return;
    }
    setF({ src: u, name: u.split('/').pop() ?? '视频' });
    setUrlDraft('');
  }

  // 拖一个视频文件直接放到节点上 = 换源（存路径不内联）
  function onNodeDrop(e: React.DragEvent): void {
    const f = Array.from(e.dataTransfer.files).find(isVideoFile);
    if (!f) return; // 非视频文件 → 交给画布的通用拖入
    e.preventDefault();
    e.stopPropagation();
    const p = electronFilePath(f);
    if (!p) {
      toast.error('拿不到视频文件路径', '请改用「上传本地视频」按钮');
      return;
    }
    setF({ src: p, name: f.name });
    toast.success('已载入视频', f.name);
  }

  return (
    <>
      <NodeResizer isVisible minWidth={200} minHeight={160} />
      <NodeShell title="视频上传" accent="is-video-source" outputs fill onDelete={() => remove(id)}>
        <div className="nodrag" style={{ display: 'contents' }} onDrop={onNodeDrop} onDragOver={(e) => e.preventDefault()}>
        {url ? (
          <>
            <video
              className="mb-sc-video-player nodrag"
              src={url}
              controls
              loop
              muted
              preload="metadata"
              {...hoverPreviewProps()}
              title="悬停自动预览 · 双击放大播放 · 右键更多 · 可直接拖视频文件到节点换源"
              onDoubleClick={() => openVideoPreview([d.src ?? url])}
              onContextMenu={(e) =>
                areaMenu(e, [
                  { label: '放大播放', onClick: () => openVideoPreview([d.src ?? url]) },
                  { label: '另存视频…', onClick: () => void imageSaveAs(d.src ?? '', 'video.mp4') },
                  ...(d.src && !d.src.startsWith('http') ? [{ label: '打开文件所在目录', onClick: () => void showInFolder(d.src ?? '') }] : [])
                ])
              }
            />
            <div className="mb-sc-work-model" title={d.src}>
              {d.name || '视频'}
            </div>
            <button className="mb-btn mb-btn-sm mb-btn-ghost nodrag" onClick={() => void pick()}>
              换视频
            </button>
          </>
        ) : (
          <div className="mb-sc-revctl nodrag">
            <button className="mb-btn mb-btn-sm mb-btn-primary" onClick={() => void pick()}>
              上传本地视频
            </button>
            <label className="mb-sc-revrow">
              或填 URL
              <input className="mb-input" value={urlDraft} placeholder="https://.../video.mp4" onChange={(e) => setUrlDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && applyUrl()} />
            </label>
            {urlDraft.trim() && (
              <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={applyUrl}>
                使用该 URL
              </button>
            )}
            <div className="mb-sc-empty">拖视频文件到这里 / 上传 / 填 URL → 输出给下游：视频反推 / 缩放 / 插帧 / 结果</div>
          </div>
        )}
        </div>
      </NodeShell>
    </>
  );
}
