import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { useSmartCanvasStore } from '@/store/smartCanvasStore';
import { computeUpstream, runVideoClipNode } from '@/lib/smartCanvasRunner';
import { localPathToImageUrl } from '@/lib/imageUrl';
import { reconcileSegments, sameSegmentSrcs, layoutSegments, formatTimecode } from '@/lib/videoClip';
import { useVideoDurations, useSegmentPosters } from './nodes/VideoClipNode';
import {
  VIDEO_TRANSITION_LABELS,
  type VideoClipNodeData,
  type VideoClipSegment,
  type VideoClipTextOverlay,
  type VideoTransition,
  type SmartNodeData
} from '@shared/smartCanvas';
import { openVideoPreview, useBackdropClose } from './nodeArea';

/** 剪辑工作台（弹窗）开关：哪个视频剪辑节点在编辑。VideoClipNode「剪辑台」按钮 / 双击驱动。 */
interface VideoClipStudioState {
  nodeId: string | null;
  open: (nodeId: string) => void;
  close: () => void;
}
export const useVideoClipStudioStore = create<VideoClipStudioState>((set) => ({
  nodeId: null,
  open: (nodeId) => set({ nodeId }),
  close: () => set({ nodeId: null })
}));

const TRANSITIONS = Object.keys(VIDEO_TRANSITION_LABELS) as VideoTransition[];
function uid(): string {
  return crypto.randomUUID();
}
function segName(src: string): string {
  return (src.split('?')[0].split(/[\\/]/).pop() ?? '').trim() || '片段';
}
function srcToUrl(src?: string | null): string | null {
  if (!src) return null;
  return src.startsWith('data:') || src.startsWith('http') ? src : localPathToImageUrl(src);
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * 剪辑工作台：全宽时间轴编辑器（参照剪映/PR）。左=宽时间轴(标尺+视频轨+文字轨) + 输出预览；
 * 右=属性面板(选中段 裁切/变速/音频/转场 · 整体调色 · 文字叠加)。所有改动实时写回节点数据。
 */
export function VideoClipStudio(): JSX.Element | null {
  const nodeId = useVideoClipStudioStore((s) => s.nodeId);
  const close = useVideoClipStudioStore((s) => s.close);
  const backdrop = useBackdropClose(close);
  const nodes = useSmartCanvasStore((s) => s.nodes);
  const edges = useSmartCanvasStore((s) => s.edges);
  const update = useSmartCanvasStore((s) => s.updateNodeData);
  const [sel, setSel] = useState(0);
  const [tab, setTab] = useState<'seg' | 'color' | 'text'>('seg');
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  // 边缘裁切：拖时间轴片段块左/右边手柄改裁切（带 px 预览，跟手不抖）
  const trackRef = useRef<HTMLDivElement>(null);
  const edgeDraggingRef = useRef(false);
  const [edgeDrag, setEdgeDrag] = useState<{ idx: number; leftPx: number; widthPx: number } | null>(null);

  const node = nodeId ? nodes.find((n) => n.id === nodeId) : undefined;
  const d = node?.type === 'video-clip' ? (node.data as unknown as VideoClipNodeData) : null;

  const up = useMemo(
    () => (nodeId && d ? computeUpstream(nodes, edges, nodeId) : { images: [], prompts: [], refs: [], videos: [], sizes: [] }),
    [nodes, edges, nodeId, d]
  );
  const upVideos = (up.videos || []).filter((v) => v && !v.startsWith('data:'));

  // 进工作台时 reconcile（与节点一致）
  useEffect(() => {
    if (!nodeId || !d) return;
    const next = reconcileSegments(upVideos, d.segments ?? []);
    if (!sameSegmentSrcs(next, d.segments ?? [])) update(nodeId, { segments: next } as Partial<SmartNodeData>);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, upVideos.join('|')]);

  // Esc 关闭
  useEffect(() => {
    if (!nodeId) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nodeId, close]);

  const segs = d?.segments ?? [];
  const durMap = useVideoDurations(segs.map((s) => s.src));
  const posters = useSegmentPosters(segs.map((s) => s.src));
  const durations = segs.map((s) => {
    const nat = durMap[s.src] || 0;
    const end = s.trimEnd > 0 ? s.trimEnd : nat;
    const len = Math.max(0, end - Math.max(0, s.trimStart));
    return len > 0 ? len / Math.max(0.5, Math.min(2, s.speed || 1)) : 0;
  });
  const { items, total } = layoutSegments(segs, durations);

  if (!nodeId || !d) return null;
  const setF = (p: Partial<VideoClipNodeData>): void => update(nodeId, p as Partial<SmartNodeData>);
  const selIdx = Math.min(sel, Math.max(0, segs.length - 1));
  const cur = segs[selIdx];
  const running = d.status === 'running';
  const outUrl = d.outputVideo ? (d.outputVideo.startsWith('http') ? d.outputVideo : localPathToImageUrl(d.outputVideo)) : null;

  function patchSeg(i: number, p: Partial<VideoClipSegment>): void {
    setF({ segments: segs.map((s, idx) => (idx === i ? { ...s, ...p } : s)) });
  }
  function reorder(from: number, to: number): void {
    if (from === to || from < 0 || to < 0 || from >= segs.length || to >= segs.length) return;
    const arr = segs.slice();
    const [m] = arr.splice(from, 1);
    arr.splice(to, 0, m);
    setF({ segments: arr });
    setSel(to);
  }
  // 直接拖片段块右边缘裁切出点：基线几何 + 固定比例尺 px 预览（右边贴手、左边钉住=与真实串联布局一致，松手不跳）。
  // 入点裁切走源监视器的入点手柄（在无缝串联时间轴上左边由前序片段钉死，拖左缘要么松手跳、要么脱手，故只在时间轴提供右缘裁切）。
  const startEdgeTrim = (i: number) => (e: React.PointerEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    const track = trackRef.current?.getBoundingClientRect();
    const seg = segs[i];
    const nat = durMap[seg.src] || 0;
    if (!track || !track.width || total <= 0 || nat <= 0) return; // 时长未测到/无法换算 → 不可拖
    edgeDraggingRef.current = true;
    setSel(i);
    setTab('seg');
    const trackW = track.width;
    const secPerPx = total / trackW;
    const speed = clamp(seg.speed || 1, 0.5, 2);
    const trimStart0 = Math.max(0, seg.trimStart || 0);
    const leftPx0 = (items[i].startPct / 100) * trackW;
    const minOut = 0.2; // 最短保留输出时长
    const apply = (clientX: number): void => {
      const xRel = clientX - track.left;
      const keptOut = clamp((xRel - leftPx0) * secPerPx, minOut, (nat - trimStart0) / speed);
      const newEnd = trimStart0 + keptOut * speed;
      patchSeg(i, { trimEnd: newEnd >= nat - 0.05 ? 0 : round1(newEnd) });
      setEdgeDrag({ idx: i, leftPx: leftPx0, widthPx: keptOut / secPerPx });
    };
    apply(e.clientX);
    const move = (ev: PointerEvent): void => apply(ev.clientX);
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setEdgeDrag(null);
      window.setTimeout(() => {
        edgeDraggingRef.current = false;
      }, 0);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  // 文字叠加
  const texts = d.texts ?? [];
  function addText(): void {
    const t: VideoClipTextOverlay = { id: uid(), text: '文字', start: 0, end: Math.min(3, total || 3), x: 0.5, y: 0.85, fontSize: 32, color: '#ffffff' };
    setF({ texts: [...texts, t] });
    setTab('text');
  }
  function patchText(tid: string, p: Partial<VideoClipTextOverlay>): void {
    setF({ texts: texts.map((t) => (t.id === tid ? { ...t, ...p } : t)) });
  }
  function removeText(tid: string): void {
    setF({ texts: texts.filter((t) => t.id !== tid) });
  }

  // 标尺刻度（按总时长取 ~6 段）
  const tickCount = total > 0 ? 6 : 0;
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => (total * i) / tickCount);

  return createPortal(
    <div className="mb-modal-backdrop" {...backdrop}>
      <div className="mb-vstudio mb-card" role="dialog" aria-label="剪辑工作台" onClick={(e) => e.stopPropagation()}>
        <div className="mb-vstudio-head">
          <h3>🎬 剪辑工作台</h3>
          <span className="mb-vstudio-meta">{segs.length} 段 · 总时长 {formatTimecode(total)}</span>
          <span className="mb-vstudio-headbtns">
            <button className="mb-btn mb-btn-sm mb-btn-primary mb-sc-runbtn" disabled={running || segs.length === 0} onClick={() => void runVideoClipNode(nodeId)}>
              {running ? '合成中…' : '运行剪辑'}
            </button>
            <button className="mb-sc-node-x" onClick={close} title="关闭">✕</button>
          </span>
        </div>

        <div className="mb-vstudio-body">
          {/* 左：时间轴 + 预览 */}
          <div className="mb-vstudio-left">
            {segs.length === 0 ? (
              <div className="mb-sc-empty">连入「视频上传 / 视频生成 / 缩放 / 插帧」节点 → 每段视频成为时间轴上的一个片段</div>
            ) : (
              <>
                {cur && (
                  <>
                    <div className="mb-vstudio-monitorcap">
                      源预览 · 第 {selIdx + 1}/{segs.length} 段：{segName(cur.src)}
                      <span className="mb-vstudio-caphint">拖两端手柄裁切 · 空格播放 · I 设入点 · O 设出点</span>
                    </div>
                    <SegmentMonitor
                      key={`${selIdx}:${cur.src}`}
                      src={cur.src}
                      naturalDuration={durMap[cur.src] || 0}
                      trimStart={cur.trimStart}
                      trimEnd={cur.trimEnd}
                      onTrim={(p) => patchSeg(selIdx, p)}
                      texts={texts}
                      onPatchText={patchText}
                      textEditing={tab === 'text'}
                    />
                  </>
                )}
                <div className="mb-vstudio-ruler">
                  {ticks.map((t, i) => (
                    <span key={i} className="mb-vstudio-tick" style={{ left: `${total > 0 ? (t / total) * 100 : 0}%` }}>
                      {formatTimecode(t)}
                    </span>
                  ))}
                </div>
                {/* total<=0（时长还没测到）→ 流式等宽布局，避免绝对定位全堆在 left:0；测到后切回时间轴 */}
                <div className={`mb-vstudio-track ${total > 0 ? '' : 'is-flow'}`} ref={trackRef}>
                  {total <= 0 && <span className="mb-vstudio-measuring">测量片段时长中…</span>}
                  {items.map((it, i) => {
                    const poster = posters[it.src];
                    const posStyle: React.CSSProperties = poster
                      ? {
                          backgroundImage: `linear-gradient(rgba(0,0,0,0.32),rgba(0,0,0,0.58)), url(${poster})`,
                          backgroundSize: 'cover',
                          backgroundPosition: 'center'
                        }
                      : {};
                    // 边缘拖动时被拖块用 px 预览（贴手），其余按时长比例 %
                    const dragging = !!edgeDrag && edgeDrag.idx === i;
                    const geom: React.CSSProperties =
                      edgeDrag && edgeDrag.idx === i
                        ? { left: `${edgeDrag.leftPx}px`, width: `${edgeDrag.widthPx}px` }
                        : total > 0
                          ? { left: `${it.startPct}%`, width: `${Math.max(4, it.widthPct)}%` }
                          : {};
                    return (
                    <div
                      key={`${it.src}-${i}`}
                      className={`mb-vstudio-seg ${i === selIdx ? 'is-sel' : ''} ${dragging ? 'is-edgedrag' : ''}`}
                      style={{ ...geom, ...posStyle }}
                      title={`${segName(it.src)} · ${formatTimecode(it.durationSec)}（拖块=排序 · 拖两端=裁切 · 点击选中）`}
                      draggable={!edgeDrag}
                      onDragStart={(e) => {
                        if (edgeDraggingRef.current) {
                          e.preventDefault();
                          return;
                        }
                        setDragFrom(i);
                      }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => {
                        if (dragFrom != null) reorder(dragFrom, i);
                        setDragFrom(null);
                      }}
                      onClick={() => {
                        setSel(i);
                        setTab('seg');
                      }}
                    >
                      {i > 0 && segs[i].transition !== 'none' && <span className="mb-vstudio-trans" title={VIDEO_TRANSITION_LABELS[segs[i].transition]}>⤬</span>}
                      <span className="mb-vstudio-segname">{i + 1}. {segName(it.src)}</span>
                      <span className="mb-vstudio-segdur">{formatTimecode(it.durationSec)}</span>
                      {total > 0 && <span className="mb-vstudio-edge is-r" onPointerDown={startEdgeTrim(i)} title="拖动裁切出点（入点用上方监视器）" />}
                    </div>
                    );
                  })}
                </div>
                {/* 文字轨 */}
                <div className="mb-vstudio-texttrack" title="文字叠加轨">
                  {texts.map((t) => (
                    <div
                      key={t.id}
                      className="mb-vstudio-textchip"
                      style={{ left: `${total > 0 ? (t.start / total) * 100 : 0}%`, width: `${total > 0 ? Math.max(4, ((t.end - t.start) / total) * 100) : 10}%` }}
                      title={t.text}
                      onClick={() => setTab('text')}
                    >
                      T {t.text}
                    </div>
                  ))}
                  {texts.length === 0 && <span className="mb-vstudio-textempty">文字轨（在右侧「文字」加叠加）</span>}
                </div>
              </>
            )}

            {outUrl && (
              <video
                className="mb-vstudio-preview nodrag"
                src={outUrl}
                controls
                title="双击放大播放"
                onDoubleClick={() => openVideoPreview([d.outputVideo ?? outUrl])}
              />
            )}
            {d.error && <div className="mb-sc-result-err">{d.error}</div>}
          </div>

          {/* 右：属性面板 */}
          <div className="mb-vstudio-right">
            <div className="mb-vstudio-tabs">
              <button className={tab === 'seg' ? 'is-active' : ''} onClick={() => setTab('seg')}>片段</button>
              <button className={tab === 'color' ? 'is-active' : ''} onClick={() => setTab('color')}>调色</button>
              <button className={tab === 'text' ? 'is-active' : ''} onClick={() => setTab('text')}>文字</button>
            </div>

            {tab === 'seg' && cur && (
              <div className="mb-vstudio-panel">
                <div className="mb-vstudio-segtitle">第 {selIdx + 1} 段 · {segName(cur.src)}</div>
                <Row label={`入点 ${cur.trimStart.toFixed(1)}s`}>
                  <input type="number" className="mb-input" min={0} step={0.1} value={cur.trimStart} onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => patchSeg(selIdx, { trimStart: Math.max(0, Number(e.target.value) || 0) })} />
                </Row>
                <Row label={`出点 ${cur.trimEnd > 0 ? cur.trimEnd.toFixed(1) + 's' : '到结尾'}`}>
                  <input type="number" className="mb-input" min={0} step={0.1} value={cur.trimEnd} title="0=到结尾" onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => patchSeg(selIdx, { trimEnd: Math.max(0, Number(e.target.value) || 0) })} />
                </Row>
                <Slider label={`变速 ${cur.speed.toFixed(2)}×`} min={0.5} max={2} step={0.05} value={cur.speed} onChange={(v) => patchSeg(selIdx, { speed: v })} />
                <label className="mb-sc-switch-row"><input type="checkbox" checked={cur.muted} onChange={(e) => patchSeg(selIdx, { muted: e.target.checked })} /> 静音本段</label>
                {!cur.muted && (
                  <>
                    <Slider label={`音量 ${cur.volume.toFixed(2)}×`} min={0} max={4} step={0.05} value={cur.volume} onChange={(v) => patchSeg(selIdx, { volume: v })} />
                    <Slider label={`音频淡入 ${cur.fadeIn.toFixed(1)}s`} min={0} max={10} step={0.1} value={cur.fadeIn} onChange={(v) => patchSeg(selIdx, { fadeIn: v })} />
                    <Slider label={`音频淡出 ${cur.fadeOut.toFixed(1)}s`} min={0} max={10} step={0.1} value={cur.fadeOut} onChange={(v) => patchSeg(selIdx, { fadeOut: v })} />
                  </>
                )}
                {selIdx > 0 && (
                  <>
                    <Row label="进入转场">
                      <select className="mb-select" value={cur.transition} onChange={(e) => patchSeg(selIdx, { transition: e.target.value as VideoTransition })}>
                        {TRANSITIONS.map((t) => (<option key={t} value={t}>{VIDEO_TRANSITION_LABELS[t]}</option>))}
                      </select>
                    </Row>
                    {cur.transition !== 'none' && (
                      <Slider label={`转场时长 ${cur.transitionDur.toFixed(1)}s`} min={0.1} max={3} step={0.1} value={cur.transitionDur} onChange={(v) => patchSeg(selIdx, { transitionDur: v })} />
                    )}
                  </>
                )}
                <div className="mb-vstudio-segmove">
                  <button className="mb-btn mb-btn-sm" disabled={selIdx === 0} onClick={() => reorder(selIdx, selIdx - 1)}>← 前移</button>
                  <button className="mb-btn mb-btn-sm" disabled={selIdx === segs.length - 1} onClick={() => reorder(selIdx, selIdx + 1)}>后移 →</button>
                </div>
              </div>
            )}

            {tab === 'color' && (
              <div className="mb-vstudio-panel">
                <div className="mb-vstudio-segtitle">整体调色（应用到成片）</div>
                <Slider label={`亮度 ${d.brightness.toFixed(2)}`} min={-1} max={1} step={0.05} value={d.brightness} onChange={(v) => setF({ brightness: v })} />
                <Slider label={`对比度 ${d.contrast.toFixed(2)}`} min={0} max={3} step={0.05} value={d.contrast} onChange={(v) => setF({ contrast: v })} />
                <Slider label={`饱和度 ${d.saturation.toFixed(2)}`} min={0} max={3} step={0.05} value={d.saturation} onChange={(v) => setF({ saturation: v })} />
                <Slider label={`伽马 ${d.gamma.toFixed(2)}`} min={0.1} max={3} step={0.05} value={d.gamma} onChange={(v) => setF({ gamma: v })} />
                <Slider label={`色相 ${d.hue}°`} min={-180} max={180} step={1} value={d.hue} onChange={(v) => setF({ hue: v })} />
                <Row label="成片帧率">
                  <select className="mb-select" value={d.fps} onChange={(e) => setF({ fps: Number(e.target.value) || 30 })}>
                    {[24, 25, 30, 48, 60].map((f) => (<option key={f} value={f}>{f} fps</option>))}
                  </select>
                </Row>
                <button className="mb-btn mb-btn-sm" onClick={() => setF({ brightness: 0, contrast: 1, saturation: 1, gamma: 1, hue: 0 })}>重置调色</button>
              </div>
            )}

            {tab === 'text' && (
              <div className="mb-vstudio-panel">
                <div className="mb-vstudio-segtitle">
                  文字叠加
                  <button className="mb-btn mb-btn-sm mb-btn-primary" onClick={addText}>+ 添加文字</button>
                </div>
                {texts.length === 0 && <div className="mb-sc-empty">还没有文字叠加。点上面「+ 添加文字」。</div>}
                {texts.map((t) => (
                  <div key={t.id} className="mb-vstudio-textitem">
                    <input className="mb-input" value={t.text} placeholder="文字内容" onChange={(e) => patchText(t.id, { text: e.target.value })} />
                    <div className="mb-vstudio-textrow">
                      <label>起 <input type="number" className="mb-input" min={0} step={0.1} value={t.start} onFocus={(e) => e.currentTarget.select()} onChange={(e) => patchText(t.id, { start: Math.max(0, Number(e.target.value) || 0) })} /></label>
                      <label>止 <input type="number" className="mb-input" min={0} step={0.1} value={t.end} onFocus={(e) => e.currentTarget.select()} onChange={(e) => patchText(t.id, { end: Math.max(0, Number(e.target.value) || 0) })} /></label>
                      <label>字号 <input type="number" className="mb-input" min={8} max={200} value={t.fontSize} onFocus={(e) => e.currentTarget.select()} onChange={(e) => patchText(t.id, { fontSize: Math.max(8, Number(e.target.value) || 32) })} /></label>
                      <input type="color" value={t.color} onChange={(e) => patchText(t.id, { color: e.target.value })} title="颜色" />
                    </div>
                    <Slider label={`水平位置 ${Math.round(t.x * 100)}%`} min={0} max={1} step={0.01} value={t.x} onChange={(v) => patchText(t.id, { x: v })} />
                    <Slider label={`垂直位置 ${Math.round(t.y * 100)}%`} min={0} max={1} step={0.01} value={t.y} onChange={(v) => patchText(t.id, { y: v })} />
                    <button className="mb-btn mb-btn-sm" onClick={() => removeText(t.id)}>删除此文字</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

/**
 * 源监视器（参照剪映/PR）：播放/拖动预览选中片段的「原始视频」，可视化入/出点手柄裁切，
 * 播放到某处「设入点/设出点」，入/出点之间循环预览；文字编辑时画面上可直接拖文字定位。
 * 所有操作只改 trim/文字坐标，不触发 ffmpeg。
 */
function SegmentMonitor({
  src,
  naturalDuration,
  trimStart,
  trimEnd,
  onTrim,
  texts,
  onPatchText,
  textEditing
}: {
  src: string;
  naturalDuration: number;
  trimStart: number;
  trimEnd: number;
  onTrim: (p: { trimStart?: number; trimEnd?: number }) => void;
  texts: VideoClipTextOverlay[];
  onPatchText: (id: string, p: Partial<VideoClipTextOverlay>) => void;
  textEditing: boolean;
}): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(naturalDuration || 0);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(false);
  const [box, setBox] = useState({ w: 0, h: 0 }); // 视频元素渲染尺寸
  const [nat, setNat] = useState({ w: 0, h: 0 }); // 视频自然尺寸（算 contain 内容区 + 文字缩放）
  const url = srcToUrl(src);
  const D = dur > 0 ? dur : naturalDuration || 0;
  const inT = Math.max(0, trimStart || 0);
  const outT = trimEnd > 0 ? trimEnd : D;
  const pct = (t: number): number => (D > 0 ? clamp((t / D) * 100, 0, 100) : 0);

  // contain 模式下视频内容区（去掉黑边）——文字叠加按真实画面坐标定位
  const content = (() => {
    if (!box.w || !box.h || !nat.w || !nat.h) return { x: 0, y: 0, w: box.w, h: box.h };
    const scale = Math.min(box.w / nat.w, box.h / nat.h);
    const w = nat.w * scale;
    const h = nat.h * scale;
    return { x: (box.w - w) / 2, y: (box.h - h) / 2, w, h };
  })();

  // 跟踪视频元素渲染尺寸（窗口/面板缩放时重算文字叠加层）
  useEffect(() => {
    const el = videoRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = (): void => setBox({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [url]);

  const seek = (t: number): void => {
    const v = videoRef.current;
    if (!v || !Number.isFinite(t)) return;
    v.currentTime = Math.max(0, Math.min(D || t, t));
    setCur(v.currentTime);
  };
  const toggle = (): void => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  };
  const setIn = (): void => onTrim({ trimStart: round1(Math.max(0, Math.min(cur, outT - 0.1))) });
  const setOut = (): void => {
    const v = Math.max(inT + 0.1, Math.min(D, cur));
    onTrim({ trimEnd: v >= D - 0.05 ? 0 : round1(v) });
  };

  // 播放进度：更新时码 + 循环预览（loop 开时到出点跳回入点）
  const onTime = (t: number): void => {
    setCur(t);
    if (loop && playing && (t >= outT - 0.03 || t < inT - 0.05)) seek(inT);
  };

  // 键盘快捷键经 ref 取最新闭包（避免 [] 依赖的 useEffect 抓到旧 cur/in/out）
  const actionsRef = useRef({ toggle, setIn, setOut });
  actionsRef.current = { toggle, setIn, setOut };
  // 空格=播放/暂停，I=设入点，O=设出点（参照 PR/剪映；不在输入框/下拉里时生效）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        actionsRef.current.toggle();
      } else if (e.code === 'KeyI') {
        e.preventDefault();
        actionsRef.current.setIn();
      } else if (e.code === 'KeyO') {
        e.preventDefault();
        actionsRef.current.setOut();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const timeFromX = (clientX: number): number => {
    const r = barRef.current?.getBoundingClientRect();
    if (!r || !D) return 0;
    return Math.max(0, Math.min(D, ((clientX - r.left) / r.width) * D));
  };
  // which: in=拖入点手柄 / out=拖出点手柄 / seek=点轨道拖动播放头
  const startDrag = (which: 'in' | 'out' | 'seek') => (e: React.PointerEvent): void => {
    e.preventDefault();
    if (which !== 'seek') e.stopPropagation();
    const apply = (clientX: number): void => {
      const t = timeFromX(clientX);
      if (which === 'in') onTrim({ trimStart: round1(Math.max(0, Math.min(t, outT - 0.1))) });
      else if (which === 'out') {
        const v = Math.max(inT + 0.1, Math.min(D, t));
        onTrim({ trimEnd: v >= D - 0.05 ? 0 : round1(v) });
      } else seek(t);
    };
    apply(e.clientX);
    const move = (ev: PointerEvent): void => apply(ev.clientX);
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // 画面上拖动文字 → 更新 x/y（0~1，与 ffmpeg `(w-tw)*x` 锚点语义一致：0=贴左 1=贴右 0.5=居中）
  const startTextDrag = (id: string) => (e: React.PointerEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    const apply = (clientX: number, clientY: number): void => {
      const r = layerRef.current?.getBoundingClientRect();
      if (!r || !r.width || !r.height) return;
      onPatchText(id, {
        x: round2(clamp((clientX - r.left) / r.width, 0, 1)),
        y: round2(clamp((clientY - r.top) / r.height, 0, 1))
      });
    };
    apply(e.clientX, e.clientY);
    const move = (ev: PointerEvent): void => apply(ev.clientX, ev.clientY);
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="mb-vstudio-monitor">
      <div className="mb-vstudio-screenwrap">
        {url ? (
          <video
            key={src}
            ref={videoRef}
            className="mb-vstudio-screen nodrag"
            src={url}
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              if (v.duration && Number.isFinite(v.duration)) setDur(v.duration);
              if (v.videoWidth && v.videoHeight) setNat({ w: v.videoWidth, h: v.videoHeight });
              setBox({ w: v.clientWidth, h: v.clientHeight });
            }}
            onTimeUpdate={(e) => onTime(e.currentTarget.currentTime)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onClick={toggle}
          />
        ) : (
          <div className="mb-sc-empty">无法加载该片段的预览</div>
        )}
        {/* 文字编辑时：画面上叠加可拖动的文字（定位即所见，无需调 X/Y 滑块） */}
        {textEditing && url && content.w > 0 && (
          <div className="mb-vstudio-textlayer" ref={layerRef} style={{ left: content.x, top: content.y, width: content.w, height: content.h }}>
            {texts.map((t) => {
              const fs = Math.max(8, (t.fontSize || 28) * (content.h / Math.max(1, nat.h || content.h)));
              return (
                <div
                  key={t.id}
                  className="mb-vstudio-textdrag"
                  style={{
                    left: `${clamp(t.x, 0, 1) * 100}%`,
                    top: `${clamp(t.y, 0, 1) * 100}%`,
                    transform: `translate(${-clamp(t.x, 0, 1) * 100}%, ${-clamp(t.y, 0, 1) * 100}%)`,
                    fontSize: `${fs}px`,
                    color: t.color
                  }}
                  onPointerDown={startTextDrag(t.id)}
                  title="拖动定位文字"
                >
                  {t.text || '文字'}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="mb-vstudio-transport">
        <button className="mb-btn mb-btn-sm mb-vstudio-play" onClick={toggle} title="播放/暂停（空格）">
          {playing ? '⏸' : '▶'}
        </button>
        <span className="mb-vstudio-tc">{formatTimecode(cur)} / {formatTimecode(D)}</span>
        <label className="mb-vstudio-loop" title="只在入点↔出点之间循环播放">
          <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} /> 循环
        </label>
        <button className="mb-btn mb-btn-sm" onClick={setIn} title="把当前播放位置设为入点（快捷键 I）">⇤ 设入点</button>
        <button className="mb-btn mb-btn-sm" onClick={setOut} title="把当前播放位置设为出点（快捷键 O）">设出点 ⇥</button>
      </div>

      <div className="mb-vstudio-trim" ref={barRef} onPointerDown={startDrag('seek')} title="点/拖 = 预览定位；拖两端手柄 = 裁切入/出点">
        <div className="mb-vstudio-trim-keep" style={{ left: `${pct(inT)}%`, right: `${100 - pct(outT)}%` }} />
        <div className="mb-vstudio-trim-h is-in" style={{ left: `${pct(inT)}%` }} onPointerDown={startDrag('in')} title={`入点 ${formatTimecode(inT)}`} />
        <div className="mb-vstudio-trim-h is-out" style={{ left: `${pct(outT)}%` }} onPointerDown={startDrag('out')} title={`出点 ${trimEnd > 0 ? formatTimecode(outT) : '到结尾'}`} />
        <div className="mb-vstudio-trim-play" style={{ left: `${pct(cur)}%` }} />
      </div>

      <div className="mb-vstudio-trimbtns">
        <button className="mb-btn mb-btn-sm" onClick={() => seek(inT)} title="跳到入点">⇤ 入点</button>
        <button className="mb-btn mb-btn-sm" onClick={() => seek(outT)} title="跳到出点">出点 ⇥</button>
        <button className="mb-btn mb-btn-sm" onClick={() => onTrim({ trimStart: 0, trimEnd: 0 })} title="恢复整段">清除裁切</button>
        <span className="mb-vstudio-keeplabel">保留 {formatTimecode(Math.max(0, outT - inT))}</span>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="mb-vstudio-row">
      <span className="mb-vstudio-rowlabel">{label}</span>
      {children}
    </div>
  );
}
function Slider({ label, min, max, step, value, onChange }: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void }): JSX.Element {
  return (
    <div className="mb-vstudio-slider">
      <span className="mb-vstudio-slabel">{label}</span>
      <input type="range" className="mb-sc-range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}
