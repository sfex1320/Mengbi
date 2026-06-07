import { useMemo } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { useSmartCanvasStore } from '@/store/smartCanvasStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useNavigate } from 'react-router-dom';
import { runVideoNode, cancelVideo, computeUpstream } from '@/lib/smartCanvasRunner';
import { localPathToImageUrl } from '@/lib/imageUrl';
import { VIDEO_MODE_LABELS, type VideoNodeData, type VideoMode, type SmartNodeData } from '@shared/smartCanvas';
import { NodeShell } from './NodeShell';
import { SegmentedControl } from '../nodePanel/consoleControls';
import { areaMenu, imageSaveAs } from '../nodeArea';

const DURATIONS = ['5', '10', '6', '8'];
const ASPECTS = ['16:9', '9:16', '1:1'];

function videoUrl(src?: string | null): string | null {
  if (!src) return null;
  return src.startsWith('data:') || src.startsWith('http') ? src : localPathToImageUrl(src);
}

/** 视频生成节点：选视频模型 + 参数 → 真实异步生成（kling/sora/unified）→ 节点上播放 mp4。 */
export function VideoNode({ id, data }: NodeProps): JSX.Element {
  const update = useSmartCanvasStore((s) => s.updateNodeData);
  const remove = useSmartCanvasStore((s) => s.removeNode);
  const nodes = useSmartCanvasStore((s) => s.nodes);
  const edges = useSmartCanvasStore((s) => s.edges);
  const configs = useSettingsStore((s) => s.configs);
  const navigate = useNavigate();
  const d = data as unknown as VideoNodeData;
  const running = d.status === 'running';
  const setF = (patch: Partial<VideoNodeData>): void => update(id, patch as Partial<SmartNodeData>);

  const videoModels = useMemo(() => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const c of configs) {
      if (c.type !== 'video') continue;
      for (const name of Object.keys(c.model_mapping ?? {})) {
        if (!seen.has(name)) {
          seen.add(name);
          out.push(name);
        }
      }
    }
    return out;
  }, [configs]);

  // 上游输入概览（提示词数 / 图片数）：有图自动作图生视频首帧
  const up = useMemo(() => computeUpstream(nodes, edges, id), [nodes, edges, id]);
  const url = videoUrl(d.videoPath);

  return (
    <>
      <NodeResizer isVisible minWidth={260} minHeight={300} />
      <NodeShell title="视频" accent="is-video" inputs outputs fill onDelete={() => remove(id)}>
        <div className="mb-sc-wctl nodrag">
          {videoModels.length === 0 ? (
            <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={() => navigate('/settings')}>
              ＋ 去「设置 → 视频模型」配置
            </button>
          ) : (
            <>
              <label className="mb-sc-wlabel">视频模型</label>
              <select className="mb-select" value={d.modelId} onChange={(e) => setF({ modelId: e.target.value })}>
                <option value="">（选择视频模型）</option>
                {videoModels.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </>
          )}

          <label className="mb-sc-wlabel">模式</label>
          <SegmentedControl
            value={d.mode}
            options={(Object.keys(VIDEO_MODE_LABELS) as VideoMode[]).map((m) => ({ value: m, label: VIDEO_MODE_LABELS[m] }))}
            onChange={(v) => setF({ mode: v as VideoMode })}
          />

          <div className="mb-sc-wgrid2">
            <div>
              <label className="mb-sc-wlabel">时长(s)</label>
              <SegmentedControl value={d.duration} options={DURATIONS.map((x) => ({ value: x, label: x }))} onChange={(v) => setF({ duration: v })} />
            </div>
            <div>
              <label className="mb-sc-wlabel">画幅</label>
              <SegmentedControl value={d.aspect} options={ASPECTS.map((x) => ({ value: x, label: x }))} onChange={(v) => setF({ aspect: v })} />
            </div>
          </div>

          <label className="mb-sc-wlabel">分辨率 / 档位</label>
          <input
            className="mb-input"
            value={d.resolution}
            placeholder="kling: std/pro · 其它: 720p/1080p · sora: 1280x720"
            onChange={(e) => setF({ resolution: e.target.value })}
          />

          <label className="mb-sc-wlabel">提示词（与上游合并，可留空）</label>
          <textarea
            className="mb-textarea mb-sc-itext"
            value={d.prompt}
            placeholder="描述画面 / 运动…"
            onChange={(e) => setF({ prompt: e.target.value })}
          />
        </div>

        <div className="mb-sc-work-model">
          上游：{up.prompts.length} 词 · {up.images.length} 图{up.images.length ? '（图生视频首帧）' : ''}
        </div>

        <div className="mb-sc-work-runrow nodrag">
          <button className="mb-btn mb-btn-sm mb-btn-primary" disabled={running || !d.modelId} onClick={() => void runVideoNode(id)}>
            {running ? '生成中…' : '生成视频'}
          </button>
          {running && (
            <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={() => cancelVideo(id)} title="取消生成">
              取消
            </button>
          )}
        </div>

        {running && (
          <div className="mb-sc-video-prog">
            <div className="mb-sc-video-prog-track">
              <i style={{ width: `${d.progress ?? 0}%` }} />
            </div>
            <span>{d.phase ?? '生成中'} {d.progress ?? 0}%（视频较慢，请耐心等待）</span>
          </div>
        )}
        {d.error && <div className="mb-sc-result-err">{d.error}</div>}

        {url && (
          <video
            className="mb-sc-video-player nodrag"
            src={url}
            controls
            loop
            onContextMenu={(e) =>
              areaMenu(e, [{ label: '另存视频…', onClick: () => void imageSaveAs(d.videoPath ?? '', 'video.mp4') }])
            }
          />
        )}
      </NodeShell>
    </>
  );
}
