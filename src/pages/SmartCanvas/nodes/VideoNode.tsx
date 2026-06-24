import { useEffect, useMemo } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { useSmartCanvasStore } from '@/store/smartCanvasStore';
import { computeUpstream } from '@/lib/smartCanvasRunner';
import { localPathToImageUrl } from '@/lib/imageUrl';
import { toast } from '@/store/toastStore';
import { VIDEO_MODE_LABELS, normalizeVideoMode, VIDEO_TASK_STATE_LABELS } from '@shared/video';
import type { VideoNodeData, SmartNodeData } from '@shared/smartCanvas';
import { NodeShell } from './NodeShell';
import { VideoRunControls } from '../nodePanel/VideoRunControls';
import { areaMenu, imageSaveAs, autoGrowNode, openVideoPreview, showInFolder, hoverPreviewProps } from '../nodeArea';

const STATUS_TEXT: Record<string, string> = { idle: '待运行', running: '生成中…', success: '已完成', error: '失败' };

function videoUrl(src?: string | null): string | null {
  if (!src) return null;
  return src.startsWith('data:') || src.startsWith('http') ? src : localPathToImageUrl(src);
}

/**
 * 视频生成节点「卡片」：紧凑（≈生图节点大小）—— 摘要 + 运行(共享 VideoRunControls) + 进度 + 视频播放 + 继续下一段。
 * 全部参数在选中后弹出的 NodeVideoConsole 里调（与生图控制台同设计语言、自适应大小）。
 */
export function VideoNode({ id, data }: NodeProps): JSX.Element {
  const update = useSmartCanvasStore((s) => s.updateNodeData);
  const remove = useSmartCanvasStore((s) => s.removeNode);
  const nodes = useSmartCanvasStore((s) => s.nodes);
  const edges = useSmartCanvasStore((s) => s.edges);
  const d = data as unknown as VideoNodeData;
  const running = d.status === 'running';
  const mode = normalizeVideoMode(d.mode);
  const setF = (patch: Partial<VideoNodeData>): void => update(id, patch as Partial<SmartNodeData>);

  const up = useMemo(() => computeUpstream(nodes, edges, id), [nodes, edges, id]);
  const url = videoUrl(d.videoPath);

  // 自适应增高：仅当内容（进度条 / 错误 / 播放器）超过默认高度时才撑高（只增不减）。
  // 摘要重叠已由 CSS（flex:0 0 auto + flex-shrink:0）根治，故基线低于默认高度即可。
  useEffect(() => {
    let need = 210; // 头 + 3 行摘要 + ⚠/运行行（默认 230 已容纳，基线不触发增长）
    if (running) need += 56; // 进度条
    if (d.error) need += 32;
    if (url) need += 188; // 播放器 + 下载行
    autoGrowNode(id, need);
  }, [id, running, d.error, url]);

  function continueNext(): void {
    if (!d.outLastFrameUrl) return;
    setF({
      previousLastFrameUrl: d.outLastFrameUrl,
      mode: 'continuous',
      returnLastFrame: true,
      videoPath: null,
      outLastFrameUrl: null,
      status: 'idle',
      error: null
    });
    toast.success('已切到「连续视频」', '上一段最后一帧已作本段首帧，点「生成视频」继续');
  }

  return (
    <>
      <NodeResizer isVisible minWidth={220} minHeight={150} />
      <NodeShell
        title="视频"
        accent="is-video"
        inputs
        outputs
        fill
        onDelete={() => remove(id)}
        headRight={
          <span className={`mb-sc-status is-${d.status}`}>
            {running && <span className="mb-sc-spinner" aria-hidden />}
            {STATUS_TEXT[d.status] ?? d.status}
          </span>
        }
      >
        <div className="mb-sc-work-line">
          {VIDEO_MODE_LABELS[mode]} · {d.duration}s · {d.aspect || (d.autoAspect ? `自动→${d.autoAspect}` : '自动')} · {d.resolution}
        </div>
        <div className="mb-sc-work-model" title={d.modelId}>
          {d.modelId || '未选模型（选中后在面板里选）'}
        </div>
        {/* 弹窗里调的参数也在卡片上预览一眼（免点进去确认） */}
        <div className="mb-sc-work-params" title="当前视频参数（在面板里调）">
          {[`seed ${d.seed ?? '随机'}`, d.generateAudio ? '有声' : null, d.returnLastFrame ? '末帧' : null]
            .filter(Boolean)
            .join(' · ')}
        </div>
        <div className="mb-sc-work-model">上游 {up.prompts.length} 词 / {up.images.length} 图 · ✎ 选中弹出设置</div>

        <VideoRunControls id={id} compact />

        {running && (
          <div className="mb-sc-video-prog nodrag">
            <div className="mb-sc-video-prog-track">
              <i style={{ width: `${d.progress ?? 0}%` }} />
            </div>
            <span>
              {d.taskState ? VIDEO_TASK_STATE_LABELS[d.taskState] : d.phase ?? '生成中'} {d.progress ?? 0}%
            </span>
          </div>
        )}
        {d.error && <div className="mb-sc-result-err nodrag">{d.error}</div>}

        {url && (
          <>
            <video
              className="mb-sc-video-player nodrag"
              src={url}
              controls
              loop
              preload="metadata"
              {...hoverPreviewProps()}
              title="悬停自动预览 · 双击放大播放 · 右键更多"
              onDoubleClick={() => openVideoPreview([d.videoPath ?? url])}
              onContextMenu={(e) =>
                areaMenu(e, [
                  { label: '放大播放', onClick: () => openVideoPreview([d.videoPath ?? url]) },
                  { label: '另存视频…', onClick: () => void imageSaveAs(d.videoPath ?? '', 'video.mp4') },
                  { label: '打开文件所在目录', onClick: () => void showInFolder(d.videoPath ?? '') }
                ])
              }
            />
            <div className="mb-sc-work-runrow nodrag">
              <button className="mb-btn mb-btn-sm mb-btn-secondary" onClick={() => void imageSaveAs(d.videoPath ?? '', 'video.mp4')}>
                下载
              </button>
              {d.outLastFrameUrl && (
                <button className="mb-btn mb-btn-sm mb-btn-secondary" onClick={continueNext} title="用最后一帧作下一段首帧">
                  继续下一段
                </button>
              )}
            </div>
          </>
        )}
      </NodeShell>
    </>
  );
}
