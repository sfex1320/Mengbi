import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { useSmartCanvasStore } from '@/store/smartCanvasStore';
import { useSmartDocsStore } from '@/store/smartDocsStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useImageParamsStore } from '@/store/imageParamsStore';
import { loadVideoNodeDefaults } from '@/lib/videoNodeDefaults';
import { listMappedModels } from '@/lib/modelMapping';
import { localPathToImageUrl } from '@/lib/imageUrl';
import { planGraph } from '@/lib/agentPlanner';
import { buildGraphFromSpec, type AgentBuildSources } from '@/lib/agentBuilder';
import { COMFY_NON_VALUE_KINDS, type AgentComfyTemplate } from '@/lib/agentBlueprint';
import type { AgentComfyTemplateInfo } from '@/lib/agentCatalog';
import { runAllNodes } from '@/lib/smartCanvasRunner';
import { toast } from '@/store/toastStore';
import type { InputControl } from '@shared/comfyui';
import { AgentIcon } from './icons';
import type { Node, Edge } from '@xyflow/react';

const WIN_KEY = 'mengbi.sc.agentwin.v1';
interface WinGeom {
  x: number;
  y: number;
  w: number;
  h: number;
}
function clampWin(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(Math.max(lo, hi), v));
}

/** AI 智能体面板开关（右下角悬浮按钮驱动）。 */
interface AgentPanelState {
  open: boolean;
  toggle: () => void;
  close: () => void;
}
export const useAgentPanelStore = create<AgentPanelState>((set) => ({
  open: false,
  toggle: () => set((s) => ({ open: !s.open })),
  close: () => set({ open: false })
}));

interface GalleryRow {
  id: number;
  file_path: string;
  thumbnail_path?: string | null;
  prompt_positive?: string | null;
}

type Phase = 'idle' | 'planning' | 'review';

/** 拉取全部 ComfyUI 模板（完整 controls 给 builder，精简给 planner）。失败返回空。 */
async function fetchComfyTemplates(): Promise<{ full: AgentComfyTemplate[]; info: AgentComfyTemplateInfo[] }> {
  try {
    const listR = await window.electronAPI.comfyui.templateList();
    if (!listR.ok) return { full: [], info: [] };
    const summaries = listR.data as Array<{ workflowId: string; name: string; typeTags?: string[] }>;
    const full: AgentComfyTemplate[] = [];
    for (const s of summaries) {
      const gR = await window.electronAPI.comfyui.templateGet({ workflowId: s.workflowId });
      if (gR.ok) {
        const t = gR.data as { workflowId: string; name: string; typeTags?: string[]; inputControls?: InputControl[] };
        full.push({ workflowId: t.workflowId, name: t.name, typeTags: t.typeTags, controls: t.inputControls ?? [] });
      }
    }
    const info: AgentComfyTemplateInfo[] = full.map((t) => ({
      name: t.name,
      controls: t.controls
        .filter((c) => !COMFY_NON_VALUE_KINDS.has(c.type))
        .map((c) => ({ label: c.label || c.id, type: c.type, options: c.options?.map((o) => o.label) }))
    }));
    return { full, info };
  } catch {
    return { full: [], info: [] };
  }
}

/**
 * AI 智能体：右下角悬浮按钮，点击展开成一个不遮挡画布主体的小面板。
 * 输入一句话 → 调文本模型规划节点图 → 以画布中心为锚确定性建图（不打乱已有布局）→
 * 默认停在确认闸门，确认后才 runAllNodes（付费）。设置「存储与系统 → 智能体自动生成」可切全自动。
 * portal 到 body：躲开路由级 framer transform，position:fixed 相对视口。
 */
export function AgentPanel(): JSX.Element | null {
  const open = useAgentPanelStore((s) => s.open);
  const toggle = useAgentPanelStore((s) => s.toggle);
  const close = useAgentPanelStore((s) => s.close);
  const activeDocId = useSmartDocsStore((s) => s.activeDocId);

  const configs = useSettingsStore((s) => s.configs);
  const planId = useSettingsStore((s) => s.activePlanId);
  const selectedImageCount = useSmartCanvasStore((s) =>
    s.nodes.reduce((a, n) => a + (n.selected && n.type === 'image' && (n.data as { src?: string }).src ? 1 : 0), 0)
  );

  const textModels = useMemo(() => listMappedModels(configs, planId, 'text'), [configs, planId]);
  const imageModels = useMemo(() => listMappedModels(configs, planId, 'image'), [configs, planId]);
  const videoModels = useMemo(() => listMappedModels(configs, planId, 'video'), [configs, planId]);
  const usableText = useMemo(() => textModels.filter((m) => m.usable), [textModels]);
  const hasImageModel = imageModels.some((m) => m.usable);
  const prefs = useSettingsStore((s) => s.prefs);

  // 智能体用的模型在「设置 → 系统与体验 → 智能体模型」里选。这里解析实际用于「规划」的文本模型：
  // 设置里选的若可用就用它，否则退回首个可用。绘画/视频模型作为 override 透传给建图器（modelFor）。
  const planningModel = useMemo(() => {
    const pref = (prefs.agent_text_model || '').trim();
    if (pref && usableText.some((m) => m.name === pref)) return pref;
    return usableText[0]?.name ?? '';
  }, [prefs.agent_text_model, usableText]);

  const [input, setInput] = useState('');
  const [attached, setAttached] = useState<Array<{ src: string; name: string }>>([]);
  const [picked, setPicked] = useState<GalleryRow[]>([]);
  const [showGallery, setShowGallery] = useState(false);
  const [galleryRows, setGalleryRows] = useState<GalleryRow[]>([]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<{ summary: string; count: number; warnings: string[] } | null>(null);
  const snapRef = useRef<{ nodes: Node[]; edges: Edge[] } | null>(null);

  useEffect(() => {
    if (!open) {
      setPhase('idle');
      setReview(null);
      setError(null);
      setShowGallery(false);
    }
  }, [open]);

  useEffect(() => {
    if (!showGallery) return;
    void window.electronAPI.gallery.list({}).then((r) => {
      if (r.ok) setGalleryRows(r.data as unknown as GalleryRow[]);
      else toast.error(r.error.message, r.error.hint);
    });
  }, [showGallery]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  // ── 悬浮窗：默认右上角，可拖动标题栏移动、拖右下角缩放；位置/尺寸记忆（铁律 20）──
  const [win, setWin] = useState<WinGeom | null>(null);
  const winRef = useRef<WinGeom | null>(null);
  winRef.current = win;
  function persistWin(v: WinGeom): void {
    try {
      localStorage.setItem(WIN_KEY, JSON.stringify(v));
    } catch {
      /* 配额满等忽略 */
    }
  }
  // 打开时初始化窗口几何：优先读记忆，否则默认右上角
  useEffect(() => {
    if (!open || win) return;
    let saved: WinGeom | null = null;
    try {
      const s = localStorage.getItem(WIN_KEY);
      if (s) saved = JSON.parse(s) as WinGeom;
    } catch {
      /* ignore */
    }
    const W = saved?.w && Number.isFinite(saved.w) ? saved.w : 380;
    const H = saved?.h && Number.isFinite(saved.h) ? saved.h : Math.min(580, window.innerHeight - 110);
    const x =
      saved && Number.isFinite(saved.x) ? clampWin(saved.x, 0, window.innerWidth - 120) : Math.max(12, window.innerWidth - W - 24);
    const y = saved && Number.isFinite(saved.y) ? clampWin(saved.y, 0, window.innerHeight - 60) : 68;
    setWin({ x, y, w: W, h: H });
  }, [open, win]);

  function startDrag(e: React.PointerEvent): void {
    if ((e.target as HTMLElement).closest('button')) return; // 点标题栏按钮不触发拖动
    e.preventDefault();
    const sx = e.clientX;
    const sy = e.clientY;
    const base = winRef.current;
    if (!base) return;
    const onMove = (ev: PointerEvent): void => {
      const nx = clampWin(base.x + (ev.clientX - sx), 0, window.innerWidth - 120);
      const ny = clampWin(base.y + (ev.clientY - sy), 0, window.innerHeight - 48);
      setWin((p) => (p ? { ...p, x: nx, y: ny } : p));
    };
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (winRef.current) persistWin(winRef.current);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  function startResize(e: React.PointerEvent): void {
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX;
    const sy = e.clientY;
    const base = winRef.current;
    if (!base) return;
    const onMove = (ev: PointerEvent): void => {
      const nw = clampWin(base.w + (ev.clientX - sx), 320, window.innerWidth - base.x - 8);
      const nh = clampWin(base.h + (ev.clientY - sy), 260, window.innerHeight - base.y - 8);
      setWin((p) => (p ? { ...p, w: nw, h: nh } : p));
    };
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (winRef.current) persistWin(winRef.current);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  function resetWin(): void {
    const W = 380;
    const H = Math.min(580, window.innerHeight - 110);
    const v = { x: Math.max(12, window.innerWidth - W - 24), y: 68, w: W, h: H };
    setWin(v);
    persistWin(v);
  }

  // 只在画布工作区显示（启动页不显示）
  if (activeDocId == null) return null;

  function onFiles(files: FileList | null): void {
    if (!files) return;
    Array.from(files).forEach((f) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') setAttached((a) => [...a, { src: reader.result as string, name: f.name }]);
      };
      reader.readAsDataURL(f);
    });
  }

  function togglePick(row: GalleryRow): void {
    setPicked((p) => (p.some((x) => x.id === row.id) ? p.filter((x) => x.id !== row.id) : [...p, row]));
  }

  async function handlePlan(): Promise<void> {
    if (!input.trim()) {
      toast.error('先描述你想要的画面', '例如「画一只戴帽子的柴犬，电影感，16:9」');
      return;
    }
    if (planId == null) {
      toast.error('没有激活的方案', '去设置页选择 / 新建一个方案');
      return;
    }
    if (!planningModel) {
      toast.error('没有可用的文本模型', '去 设置 → 系统与体验 → 智能体模型 选一个文本模型（或给当前方案配置对话模型）');
      return;
    }
    setPhase('planning');
    setError(null);

    // 选中图片节点快照（建图 addNode 会清选区，必须先取；id 与 src 并行保序）
    const selNodes = useSmartCanvasStore
      .getState()
      .nodes.filter((n) => n.selected && n.type === 'image' && (n.data as { src?: string }).src);
    const selectedNodeIds = selNodes.map((n) => n.id);
    const selectedSrcs = selNodes.map((n) => (n.data as { src?: string }).src as string);

    const comfy = await fetchComfyTemplates();

    const res = await planGraph({
      planId,
      textModel: planningModel,
      userInput: input.trim(),
      imageModels: imageModels.filter((m) => m.usable).map((m) => m.name),
      textModels: usableText.map((m) => m.name),
      videoModels: videoModels.filter((m) => m.usable).map((m) => m.name),
      attachedCount: attached.length,
      selectedImageCount: selectedSrcs.length,
      galleryAvailable: true,
      comfyTemplates: comfy.info
    });

    if (!res.ok || !res.spec) {
      setPhase('idle');
      setError(res.reason ?? '规划失败，请重试或换个文本模型');
      return;
    }

    const st = useSmartCanvasStore.getState();
    snapRef.current = { nodes: st.nodes, edges: st.edges };

    const sources: AgentBuildSources = {
      attached: attached.map((a) => a.src),
      selected: selectedSrcs,
      selectedNodeIds,
      gallery: picked.map((g) => g.file_path),
      comfyTemplates: comfy.full
    };
    // 绘画/视频模型优先级：设置里明确选的 > 最近在生图/视频里用过的 > 自动（首个可用）。
    // 「自动（用首个可用）」时回退到用户最近选用的模型，更贴合用户当前在用的那套（用户反馈）。
    const lastImageModel = useImageParamsStore.getState().imageModelId.trim();
    const lastVideoModel = (loadVideoNodeDefaults()?.modelId ?? '').trim();
    const build = buildGraphFromSpec(res.spec, sources, {
      textModelOverride: planningModel,
      imageModelOverride: (prefs.agent_image_model || '').trim() || lastImageModel || undefined,
      videoModelOverride: (prefs.agent_video_model || '').trim() || lastVideoModel || undefined
    });
    const warnings = [...res.warnings, ...build.warnings];
    setReview({ summary: res.spec.summary || '已根据你的需求搭好节点图', count: build.createdIds.length, warnings });

    const autoRun = useSettingsStore.getState().prefs.agent_auto_run === '1';
    if (autoRun) {
      close();
      void runAllNodes();
      toast.success('智能体已建图并开始生成', warnings.length ? `有 ${warnings.length} 条提醒` : undefined);
    } else {
      setPhase('review');
    }
  }

  function confirmRun(): void {
    close();
    void runAllNodes();
    toast.success('开始生成');
  }
  function keepGraph(): void {
    close();
    toast.success('已建好节点图（未生成）', '在画布上检查 / 调整后点「运行全部」');
  }
  function undoBuild(): void {
    if (snapRef.current) useSmartCanvasStore.getState().load(snapRef.current.nodes, snapRef.current.edges);
    setPhase('idle');
    setReview(null);
    toast.info('已撤销本次建图');
  }

  return createPortal(
    <>
      {open && win && (
        <div
          className="mb-sc-agent-window mb-card"
          role="dialog"
          aria-label="AI 智能体"
          style={{ left: win.x, top: win.y, width: win.w, height: win.h }}
        >
          <div className="mb-sc-agent-head mb-sc-agent-titlebar" onPointerDown={startDrag} title="拖动标题栏移动窗口">
            <h3>🤖 AI 智能体</h3>
            <button className="mb-sc-node-x" onClick={resetWin} title="复位到右上角">
              ⤢
            </button>
            <button className="mb-sc-node-x" onClick={close} title="收起（Esc）">
              ✕
            </button>
          </div>

          <div className="mb-sc-agent-scroll">
          {phase === 'review' && review ? (
            <div className="mb-sc-agent-review">
              <div className="mb-sc-agent-review-summary">{review.summary}</div>
              <div className="mb-sc-agent-review-meta">已在画布上创建 {review.count} 个节点。请检查后决定是否生成。</div>
              {review.warnings.length > 0 && (
                <ul className="mb-sc-agent-warns">
                  {review.warnings.map((w, i) => (
                    <li key={i}>⚠ {w}</li>
                  ))}
                </ul>
              )}
              <div className="mb-sc-agent-actions">
                <button className="mb-btn mb-btn-primary mb-sc-agent-go" onClick={confirmRun}>
                  确认生成
                </button>
                <button className="mb-btn mb-btn-ghost" onClick={keepGraph}>
                  仅建图
                </button>
                <button className="mb-btn mb-btn-ghost mb-sc-agent-undo" onClick={undoBuild}>
                  撤销
                </button>
              </div>
              <div className="mb-sc-agent-hint">设置 → 存储与系统 → 「智能体自动生成」可跳过这一步。</div>
            </div>
          ) : (
            <div className="mb-sc-agent-body">
              <textarea
                className="mb-textarea mb-sc-agent-input"
                placeholder="描述你想要的画面或工作流，例如：&#10;· 画一只戴宇航头盔的柴犬，电影感，16:9，出 2 张&#10;· 把我选中的图改成水彩风&#10;· 用 ComfyUI 高清放大模板放大这张图"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                autoFocus
              />

              <div className="mb-sc-agent-imgrow">
                <label className="mb-btn mb-btn-sm mb-btn-ghost mb-sc-agent-upload">
                  上传图片
                  <input type="file" accept="image/*" multiple hidden onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} />
                </label>
                <button
                  className={`mb-btn mb-btn-sm mb-btn-ghost ${showGallery ? 'is-on' : ''}`}
                  onClick={() => setShowGallery((v) => !v)}
                >
                  资产库选图{picked.length ? `（${picked.length}）` : ''}
                </button>
              </div>
              {selectedImageCount > 0 && <div className="mb-sc-agent-selnote">画布已选中 {selectedImageCount} 张图（直接复用，不会复制）</div>}

              {(attached.length > 0 || picked.length > 0) && (
                <div className="mb-sc-agent-thumbs">
                  {attached.map((a, i) => (
                    <div key={`a${i}`} className="mb-sc-agent-thumb" title={a.name}>
                      <img src={a.src} alt={a.name} />
                      <button className="mb-sc-agent-thumb-x" onClick={() => setAttached((arr) => arr.filter((_, j) => j !== i))}>
                        ✕
                      </button>
                    </div>
                  ))}
                  {picked.map((g) => (
                    <div key={`g${g.id}`} className="mb-sc-agent-thumb" title="资产库图">
                      <img src={localPathToImageUrl(g.thumbnail_path || g.file_path)} alt="" />
                      <button className="mb-sc-agent-thumb-x" onClick={() => setPicked((arr) => arr.filter((x) => x.id !== g.id))}>
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {showGallery && (
                <div className="mb-sc-agent-gallery">
                  {galleryRows.length === 0 ? (
                    <div className="mb-sc-empty">资产库暂无图片</div>
                  ) : (
                    galleryRows.slice(0, 48).map((row) => (
                      <button
                        key={row.id}
                        className={`mb-sc-agent-grow ${picked.some((x) => x.id === row.id) ? 'is-picked' : ''}`}
                        onClick={() => togglePick(row)}
                      >
                        <img src={localPathToImageUrl(row.thumbnail_path || row.file_path)} alt="" loading="lazy" />
                      </button>
                    ))
                  )}
                </div>
              )}

              <div className="mb-sc-agent-modelinfo">
                {planningModel ? (
                  <>
                    文本模型 <b>{planningModel}</b> · 各功能用哪款模型在 设置 → 系统与体验 → 智能体模型 里选
                  </>
                ) : (
                  <>没有可用文本模型 · 去 设置 → 系统与体验 → 智能体模型 配置</>
                )}
              </div>

              {!hasImageModel && (
                <div className="mb-sc-agent-warns mb-sc-agent-warns-inline">⚠ 当前方案没有可用绘画模型，生图节点将无法运行（可先建图，去设置页配置后再运行）。</div>
              )}
              {error && <div className="mb-sc-agent-error">{error}</div>}

              <div className="mb-sc-agent-actions">
                <button className="mb-btn mb-btn-primary mb-sc-agent-go" onClick={() => void handlePlan()} disabled={phase === 'planning' || !planningModel}>
                  {phase === 'planning' ? '规划中…' : '开始规划'}
                </button>
              </div>
              <div className="mb-sc-agent-hint">规划免费；默认建好图后停下来等你确认，确认才会调用绘画模型生成。</div>
            </div>
          )}
          </div>
          <div className="mb-sc-agent-resize" onPointerDown={startResize} title="拖右下角缩放窗口" />
        </div>
      )}

      <button
        className={`mb-sc-agentfab ${open ? 'is-open' : ''}`}
        onClick={toggle}
        title="AI 智能体：一句话自动建图 / 生成"
        aria-label="AI 智能体"
      >
        <AgentIcon size={24} />
      </button>
    </>,
    document.body
  );
}
