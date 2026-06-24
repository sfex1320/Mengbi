import { useEffect, useRef, useState } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { useSmartCanvasStore } from '@/store/smartCanvasStore';
import { computeUpstream, runVideoClipNode } from '@/lib/smartCanvasRunner';
import { localPathToImageUrl } from '@/lib/imageUrl';
import { captureVideoPoster } from '@/lib/videoPoster';
import { reconcileSegments, sameSegmentSrcs, layoutSegments, formatTimecode } from '@/lib/videoClip';
import { useVideoClipStudioStore } from '../VideoClipStudio';
import type { VideoClipNodeData, VideoClipSegment, SmartNodeData } from '@shared/smartCanvas';
import { NodeShell } from './NodeShell';
import { areaMenu, imageSaveAs, dragOutNative, showInFolder, openVideoPreview, hoverPreviewProps } from '../nodeArea';

function videoUrl(src?: string | null): string | null {
  if (!src) return null;
  return src.startsWith('data:') || src.startsWith('http') ? src : localPathToImageUrl(src);
}

// ── 视频时长测量（客户端 <video> 元数据，按 src 缓存，避免重复 decode）──
const durationCache = new Map<string, number>();
/** 测量一组视频 src 的时长（秒），返回 {src:dur} 映射 + 触发缺失项异步测量。 */
export function useVideoDurations(srcs: string[]): Record<string, number> {
  const [, force] = useState(0);
  useEffect(() => {
    let alive = true;
    const todo = srcs.filter((s) => s && !durationCache.has(s));
    if (!todo.length) return;
    todo.forEach((s) => {
      const url = videoUrl(s);
      if (!url) {
        durationCache.set(s, 0);
        return;
      }
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.muted = true;
      const done = (d: number): void => {
        durationCache.set(s, Number.isFinite(d) && d > 0 ? d : 0);
        v.removeAttribute('src');
        if (alive) force((n) => n + 1);
      };
      v.onloadedmetadata = () => done(v.duration);
      v.onerror = () => done(0);
      v.src = url;
    });
    return () => {
      alive = false;
    };
  }, [srcs.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const out: Record<string, number> = {};
  for (const s of srcs) out[s] = durationCache.get(s) ?? 0;
  return out;
}

// ── 片段首帧封面（时间轴片段块底图，让时间轴「看得懂」）：按 src 全局缓存，best-effort ──
const posterCache = new Map<string, string | null>();
/** 抓一组视频 src 的首帧 webp（仅成功的进结果）；缺失项异步抓取，失败静默回退渐变底。 */
export function useSegmentPosters(srcs: string[]): Record<string, string> {
  const [, force] = useState(0);
  useEffect(() => {
    let alive = true;
    const todo = srcs.filter((s) => s && !posterCache.has(s));
    if (!todo.length) return;
    todo.forEach((s) => posterCache.set(s, null)); // 占位防并发重复抓取
    void (async () => {
      for (const s of todo) {
        const url = videoUrl(s);
        const poster = url ? await captureVideoPoster(url).catch(() => null) : null;
        posterCache.set(s, poster);
        if (alive) force((n) => n + 1);
      }
    })();
    return () => {
      alive = false;
    };
  }, [srcs.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const out: Record<string, string> = {};
  for (const s of srcs) {
    const p = posterCache.get(s);
    if (p) out[s] = p;
  }
  return out;
}

/**
 * 视频剪辑节点（长条形 + 内嵌轻量时间轴）：上游视频自动成片段，时间轴上拖块排序、点块选中，
 * 选中段快速调 入/出点 + 转场；双击节点或点「剪辑工作台」进全宽弹窗做深度编辑（音频/变速/调色/文字）。
 */
export function VideoClipNode({ id, data }: NodeProps): JSX.Element {
  const update = useSmartCanvasStore((s) => s.updateNodeData);
  const remove = useSmartCanvasStore((s) => s.removeNode);
  const nodes = useSmartCanvasStore((s) => s.nodes);
  const edges = useSmartCanvasStore((s) => s.edges);
  const openStudio = useVideoClipStudioStore((s) => s.open);
  const d = data as unknown as VideoClipNodeData;
  const setF = (p: Partial<VideoClipNodeData>): void => update(id, p as Partial<SmartNodeData>);
  const [sel, setSel] = useState(0);
  const dragFrom = useRef<number | null>(null);

  const up = computeUpstream(nodes, edges, id);
  const upVideos = up.videos.filter((v) => v && !v.startsWith('data:'));

  // 上游视频 → 片段 reconcile（保留排序与编辑参数；仅 src 序列变化时写回，避免渲染循环）
  useEffect(() => {
    const next = reconcileSegments(upVideos, d.segments ?? []);
    if (!sameSegmentSrcs(next, d.segments ?? [])) setF({ segments: next });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upVideos.join('|')]);

  const segs = d.segments ?? [];
  const durMap = useVideoDurations(segs.map((s) => s.src));
  const durations = segs.map((s) => {
    const nat = durMap[s.src] || 0;
    const end = s.trimEnd > 0 ? s.trimEnd : nat;
    const len = Math.max(0, end - Math.max(0, s.trimStart));
    return len > 0 ? len / Math.max(0.5, Math.min(2, s.speed || 1)) : 0;
  });
  const { items, total } = layoutSegments(segs, durations);
  const outUrl = videoUrl(d.outputVideo);
  const running = d.status === 'running';
  const selIdx = Math.min(sel, Math.max(0, segs.length - 1));

  function patchSeg(i: number, p: Partial<VideoClipSegment>): void {
    const next = segs.map((s, idx) => (idx === i ? { ...s, ...p } : s));
    setF({ segments: next });
  }
  function reorder(from: number, to: number): void {
    if (from === to || from < 0 || to < 0 || from >= segs.length || to >= segs.length) return;
    const arr = segs.slice();
    const [m] = arr.splice(from, 1);
    arr.splice(to, 0, m);
    setF({ segments: arr });
    setSel(to);
  }

  const segName = (src: string): string => {
    const seg = (src.split('?')[0].split(/[\\/]/).pop() ?? '').trim();
    return seg || '片段';
  };

  return (
    <>
      <NodeResizer isVisible minWidth={360} minHeight={170} />
      <NodeShell title="视频剪辑" accent="is-video-clip" inputs outputs fill onDelete={() => remove(id)}>
        <div className="mb-sc-vclip nodrag" onDoubleClick={() => openStudio(id)}>
          <div className="mb-sc-vclip-head">
            <span className="mb-sc-vclip-meta">
              {segs.length ? `${segs.length} 段 · ${formatTimecode(total)}` : '连入视频来源后自动成片段'}
            </span>
            <span className="mb-sc-vclip-headbtns">
              <button
                className="mb-btn mb-btn-sm mb-btn-primary mb-sc-runbtn"
                disabled={running || segs.length === 0}
                onClick={() => void runVideoClipNode(id)}
              >
                {running ? '合成中…' : '运行'}
              </button>
              <button className="mb-btn mb-btn-sm mb-sc-vclip-studio" title="打开剪辑工作台（深度编辑：音频/变速/调色/文字）" onClick={() => openStudio(id)}>
                🎬 剪辑台
              </button>
            </span>
          </div>

          {segs.length === 0 ? (
            <div className="mb-sc-empty">连一个或多个「视频上传 / 视频生成 / 缩放 / 插帧」节点进来，每段视频成为时间轴上的一个片段</div>
          ) : (
            <>
              {/* 时间轴：片段块按时长比例排布，可拖动排序、点选 */}
              <div className="mb-sc-vclip-track">
                {items.map((it, i) => (
                  <div
                    key={`${it.src}-${i}`}
                    className={`mb-sc-vclip-seg ${i === selIdx ? 'is-sel' : ''}`}
                    style={{ width: `${Math.max(6, it.widthPct)}%` }}
                    title={`${segName(it.src)} · ${formatTimecode(it.durationSec)}（拖动排序 · 点击选中）`}
                    draggable
                    onDragStart={() => (dragFrom.current = i)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (dragFrom.current != null) reorder(dragFrom.current, i);
                      dragFrom.current = null;
                    }}
                    onClick={() => setSel(i)}
                  >
                    {segs[i].transition !== 'none' && i > 0 && <span className="mb-sc-vclip-trans" title="转场">⤬</span>}
                    <span className="mb-sc-vclip-segname">{i + 1}. {segName(it.src)}</span>
                    <span className="mb-sc-vclip-segdur">{formatTimecode(it.durationSec)}</span>
                  </div>
                ))}
              </div>

              {/* 选中段快速调：入/出点 + 转场（深度编辑进剪辑台） */}
              {segs[selIdx] && (
                <div className="mb-sc-vclip-quick">
                  <span className="mb-sc-vclip-qlabel">第 {selIdx + 1} 段</span>
                  <label>入 <input className="mb-input mb-sc-vclip-num" type="number" min={0} step={0.1} value={segs[selIdx].trimStart}
                    onChange={(e) => patchSeg(selIdx, { trimStart: Math.max(0, Number(e.target.value) || 0) })} onFocus={(e) => e.currentTarget.select()} /></label>
                  <label>出 <input className="mb-input mb-sc-vclip-num" type="number" min={0} step={0.1} value={segs[selIdx].trimEnd}
                    onChange={(e) => patchSeg(selIdx, { trimEnd: Math.max(0, Number(e.target.value) || 0) })} onFocus={(e) => e.currentTarget.select()} title="0=到结尾" /></label>
                  {selIdx > 0 && (
                    <label>转场
                      <select className="mb-select mb-sc-vclip-trsel" value={segs[selIdx].transition}
                        onChange={(e) => patchSeg(selIdx, { transition: e.target.value as VideoClipSegment['transition'] })}>
                        <option value="none">硬切</option>
                        <option value="fade">交叉淡化</option>
                        <option value="fadeblack">黑场</option>
                        <option value="dissolve">溶解</option>
                        <option value="wipeleft">左擦除</option>
                        <option value="slideright">右滑入</option>
                      </select>
                    </label>
                  )}
                </div>
              )}
            </>
          )}

          {d.error && <div className="mb-sc-result-err">{d.error}</div>}

          {outUrl && (
            <div className="mb-sc-vclip-out">
              <video
                className="mb-sc-video-player nodrag"
                src={outUrl}
                controls
                loop
                muted
                preload="metadata"
                {...hoverPreviewProps()}
                title="悬停自动预览 · 双击放大播放 · 右键更多"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  openVideoPreview([d.outputVideo ?? outUrl]);
                }}
                onContextMenu={(e) =>
                  areaMenu(e, [
                    { label: '放大播放', onClick: () => openVideoPreview([d.outputVideo ?? outUrl]) },
                    { label: '另存视频…', onClick: () => void imageSaveAs(d.outputVideo ?? '', 'clip.mp4') },
                    { label: '打开文件所在目录', onClick: () => void showInFolder(d.outputVideo ?? '') }
                  ])
                }
              />
              <div
                className="mb-sc-result-vidgrab nodrag"
                draggable
                onDragStart={(e) => dragOutNative(e, d.outputVideo ?? '', 'clip')}
                title="按住拖出：把视频原文件拖进其他软件直接用"
              >
                ⠿ 拖出{d.durationMs ? ` · 用时 ${(d.durationMs / 1000).toFixed(1)}s` : ''}
              </div>
            </div>
          )}
        </div>
      </NodeShell>
    </>
  );
}
