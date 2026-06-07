import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStoreApi } from '@xyflow/react';
import { useSmartCanvasStore, useSmartResultStore, useSmartCanvasUiStore, useSmartPreviewStore, absPosition } from '@/store/smartCanvasStore';
import { useImageParamsStore } from '@/store/imageParamsStore';
import { useSettingsStore } from '@/store/settingsStore';
import { runWithUpstream, cancelWork, computeUpstream, comfyInputSlots } from '@/lib/smartCanvasRunner';
import { toast } from '@/store/toastStore';
import { localPathToImageUrl } from '@/lib/imageUrl';
import { listMappedModels, diagnoseChatModel, type MappedModel } from '@/lib/modelMapping';
import { detectFamily } from '@shared/imageModelFamilies';
import type { WorkflowTemplateSummary, InputControl } from '@shared/comfyui';
import { renderComfyControl, COMFY_IMAGE_KINDS } from './comfyControl';
import { SegmentedControl } from './nodePanel/consoleControls';
import {
  WORK_TYPE_LABELS,
  RUN_MODE_LABELS,
  PROVIDER_LABELS,
  providerLabel,
  REAL_WORK_TYPES,
  RUN_STATUS_LABELS,
  LLM_OP_LABELS,
  LLM_IMAGE_OPS,
  type RunStatus,
  type WorkType,
  type RunMode,
  type WorkProvider,
  type WorkNodeData,
  type PromptNodeData,
  type ImageNodeData,
  type GroupNodeData,
  type LlmNodeData,
  type LlmOp,
  type ComfyNodeData,
  type AnglePromptNodeData,
  type ScaleNodeData,
  type ScaleMode,
  SCALE_MODE_LABELS,
  type SmartNodeData,
  type SmartNodeKind,
  type TextNodeData,
  type TextAlign,
  TEXT_FONTS,
  type LightNodeData,
  type LightOcclusion,
  type LightEffect,
  LIGHT_OCCLUSION_LABELS,
  LIGHT_EFFECT_LABELS
} from '@shared/smartCanvas';
import { buildLightPrompt } from '@/lib/lightPrompt';
import { buildAnglePrompt } from '@/lib/anglePrompt';
import { exportTextFile, fmtDur } from './nodeArea';
import { NODE_ICONS } from './icons';
import './nodePanel/nodePanel.css';

/** 节点类型 → 中文名（面板标题用，与工具坞一致）。 */
const NODE_TYPE_LABELS: Record<SmartNodeKind, string> = {
  image: '图片',
  prompt: '提示词',
  llm: 'LLM',
  'angle-prompt': '视角',
  scale: '缩放',
  ratio: '尺寸',
  work: '生成',
  comfy: 'ComfyUI',
  result: '结果',
  group: '分组',
  text: '文字',
  light: '光源',
  compare: '对比',
  video: '视频'
};

/** 运行状态胶囊（与生成控制台同款 mb-np-status，work/comfy/llm 共用）。 */
function StatusPill({ status }: { status: RunStatus }): JSX.Element {
  return (
    <span className={`mb-np-status is-${status}`}>
      <i className="mb-np-status-dot" />
      {RUN_STATUS_LABELS[status]}
    </span>
  );
}

/** 横向布局的「标签 + 控件」字段块（网格单元）。wide=占满整行（textarea / 滑块等放松内容）。
 *  只给 label 不给 children 时＝整行小标题。 */
function Field({
  label,
  wide,
  className,
  children
}: {
  label?: string;
  wide?: boolean;
  className?: string;
  children?: React.ReactNode;
}): JSX.Element {
  return (
    <div className={`mb-sc-fb${wide ? ' is-wide' : ''}${className ? ` ${className}` : ''}`}>
      {label != null ? <label className="mb-sc-flabel">{label}</label> : null}
      {children}
    </div>
  );
}

/** 拆 ComfyUI 控件标签「{字段} · {节点标题}」→ { field, group }。无分隔符时归到「常用」。
 *  用于把工作流参数按所属节点分类成一个个「模块」横向排布。 */
function comfyGroupOf(label: string): { field: string; group: string } {
  const idx = label.lastIndexOf(' · ');
  if (idx >= 0) return { field: label.slice(0, idx), group: label.slice(idx + 3) };
  return { field: label, group: '常用' };
}

/** 运行日志导出按钮（work/comfy/llm 共用）。 */
function ExportLogBtn({ title, logs, error }: { title: string; logs?: string[]; error?: string | null }): JSX.Element | null {
  if (!logs?.length && !error) return null;
  const text = [`# ${title} 运行日志`, ...(logs ?? []), error ? `错误：${error}` : ''].filter(Boolean).join('\n');
  return (
    <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={() => void exportTextFile('smart-canvas-log.txt', text)}>
      导出日志
    </button>
  );
}

/**
 * 受控数字输入：编辑时允许自由输入（含清空 / 中间态），失焦或回车才 clamp 并提交。
 * 解决「min 限制让 16 一直卡在输入框、无法清空重输」的问题（不再每次按键即 clamp）。
 */
function ClampNumberInput({
  value,
  min,
  max,
  onCommit,
  className = 'mb-input'
}: {
  value: number;
  min: number;
  max: number;
  onCommit: (v: number) => void;
  className?: string;
}): JSX.Element {
  const [text, setText] = useState(String(value));
  // 外部值变化（切换节点 / 提交后回写）时同步显示；编辑中 value 不变，不会打断输入
  useEffect(() => {
    setText(String(value));
  }, [value]);
  const commit = (): void => {
    const n = Number(text);
    if (text.trim() === '' || Number.isNaN(n)) {
      setText(String(value));
      return;
    }
    const clamped = Math.max(min, Math.min(max, Math.round(n)));
    setText(String(clamped));
    if (clamped !== value) onCommit(clamped);
  };
  return (
    <input
      className={className}
      type="number"
      inputMode="numeric"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

/** 本地路径/数据 URI → dataUri（入图库 / 另存 都要 dataUri）。 */
async function imageToDataUri(src: string): Promise<string | null> {
  if (src.startsWith('data:')) return src;
  try {
    const res = await fetch(localPathToImageUrl(src));
    const blob = await res.blob();
    return await new Promise<string | null>((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/** 结果图操作块：缩略图 + 另存 / 作参考图（发回生图页）。结果/工作/ComfyUI 节点共用。生成结果已自动入库，故不再有「入图库」。 */
function ResultActionsBlock({ images, durationMs }: { images: string[]; durationMs?: number }): JSX.Element | null {
  const navigate = useNavigate();
  const addRefs = useImageParamsStore((s) => s.addRefs);
  const openPreview = useSmartPreviewStore((s) => s.open);
  if (!images.length) return null;
  async function saveAs(src: string, i: number): Promise<void> {
    const du = await imageToDataUri(src);
    if (!du) {
      toast.error('读取图片失败');
      return;
    }
    const r = await window.electronAPI.storage.saveAs({ dataUri: du, defaultName: `smart-canvas-${i + 1}.png` });
    if (r.ok && r.data) toast.success('已另存', r.data.filePath);
    else if (!r.ok) toast.error(r.error.message, r.error.hint);
  }
  // 发回生图页当参考图（复用 imageParamsStore.addRefs，与图库/画板同一通道）
  async function toCreateRef(src: string): Promise<void> {
    const du = await imageToDataUri(src);
    if (!du) {
      toast.error('读取图片失败');
      return;
    }
    // path 为空串 = 仅 dataUri（拖拽/画板导入同约定，后端 refsToUploadable 用 path||dataUri）
    addRefs?.([{ dataUri: du, path: src.startsWith('data:') ? '' : src }]);
    navigate('/');
    toast.success('已作为参考图发到生图页');
  }
  return (
    <>
      <label className="mb-sc-flabel">
        结果（{images.length}）{durationMs != null ? ` · ${fmtDur(durationMs)}` : ''}
      </label>
      {/* 网格：按悬浮窗宽度一行排多个缩略图卡片（缩略图 + 另存 / 作参考图） */}
      <div className="mb-sc-rgrid">
        {images.map((p, i) => {
          const u = p.startsWith('data:') ? p : localPathToImageUrl(p);
          return (
            <div key={i} className="mb-sc-rcard">
              <img src={u} alt={`结果 ${i + 1}`} draggable={false} title="点击放大" onClick={() => openPreview(u)} />
              <div className="mb-sc-rcard-btns">
                <button className="mb-btn mb-btn-sm mb-btn-ghost nodrag" onClick={() => void saveAs(p, i)}>
                  另存
                </button>
                <button className="mb-btn mb-btn-sm mb-btn-ghost nodrag" onClick={() => void toCreateRef(p)}>
                  作参考图
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

const SCALE_MODES = Object.keys(SCALE_MODE_LABELS) as ScaleMode[];
const WORK_TYPES = Object.keys(WORK_TYPE_LABELS) as WorkType[];
const RUN_MODES = Object.keys(RUN_MODE_LABELS) as RunMode[];
const PROVIDERS = Object.keys(PROVIDER_LABELS) as WorkProvider[];
const LLM_OPS = Object.keys(LLM_OP_LABELS) as LlmOp[];
/** 需要上游底图、可用「绘画强度」的 img2img 类工作 */
const IMG2IMG = new Set<WorkType>(['image-edit', 'style-transfer', 'outpainting']);

/** 右侧检查器：编辑选中节点属性。生成节点在这里配类型/运行方式/后端/模型/提示词/张数并运行。 */
export function NodeInspector({ float = false }: { float?: boolean } = {}): JSX.Element {
  const nodes = useSmartCanvasStore((s) => s.nodes);
  const edges = useSmartCanvasStore((s) => s.edges);
  const update = useSmartCanvasStore((s) => s.updateNodeData);
  const beginEdit = useSmartCanvasStore((s) => s.beginEdit);
  const commitEdit = useSmartCanvasStore((s) => s.commitEdit);
  const resultAccum = useSmartResultStore((s) => s.accum);
  const clearResult = useSmartResultStore((s) => s.clear);
  const { configs, activePlanId, plans } = useSettingsStore();
  // 文本/属性编辑进撤销栈：聚焦快照、失焦若有改动则压栈
  const editProps = { onFocus: beginEdit, onBlur: commitEdit };

  // 绘画模型：跳过「实际ID为空」的映射（选了也跑不了）；保留 comfyui 排除逻辑
  const imageModels = useMemo(() => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const c of configs) {
      if (c.type !== 'image' || c.image_kind === 'comfyui') continue;
      for (const [name, actualId] of Object.entries(c.model_mapping)) {
        if (seen.has(name) || !(actualId && actualId.trim())) continue;
        seen.add(name);
        out.push(name);
      }
    }
    return out;
  }, [configs]);

  // 文本模型取当前方案（optimizePrompt 按 planId 解析）；保留不可用项用于下拉里标灰提示
  const textModels = useMemo<MappedModel[]>(
    () => listMappedModels(configs, activePlanId, 'text'),
    [configs, activePlanId]
  );

  /** 显示名 → 真实模型 ID（用于 detectFamily 判系列；查不到回退显示名本身）。 */
  function realModelId(displayName: string): string {
    for (const c of configs) {
      const v = c.model_mapping?.[displayName];
      if (c.type === 'image' && v) return v;
    }
    return displayName;
  }

  // ComfyUI 工作流模板列表（页面挂载时拉一次）
  const [comfyTemplates, setComfyTemplates] = useState<WorkflowTemplateSummary[]>([]);
  useEffect(() => {
    let alive = true;
    void window.electronAPI.comfyui.templateList().then((r) => {
      if (alive && r.ok) setComfyTemplates(r.data);
    });
    return () => {
      alive = false;
    };
  }, []);

  /** 选模板：拉取模板的 inputControls 快照写进节点，控件默认值填入 controlValues。 */
  async function pickComfyTemplate(nodeId: string, workflowId: string): Promise<void> {
    if (!workflowId) {
      update(nodeId, { workflowId: '', templateName: '', controls: [], controlValues: {} } as Partial<SmartNodeData>);
      return;
    }
    const r = await window.electronAPI.comfyui.templateGet({ workflowId });
    if (!r.ok) {
      toast.error(r.error.message, r.error.hint);
      return;
    }
    const tpl = r.data;
    // 预填每个控件的默认值进 controlValues，供在画布里直接调整（运行时随工作流发出）
    const controlValues: Record<string, unknown> = {};
    for (const c of tpl.inputControls) {
      if (c.default !== undefined) controlValues[c.id] = c.default;
    }
    update(nodeId, {
      workflowId,
      templateName: tpl.name,
      controls: tpl.inputControls,
      controlValues
    } as Partial<SmartNodeData>);
  }

  const sel = nodes.find((n) => n.selected);
  // 选中节点的真实上游（文本 / 图片）——用于把「被上游喂入」的输入框替换成黄色「由上游输入」提示。
  const up = useMemo(
    () => (sel ? computeUpstream(nodes, edges, sel.id) : { images: [], prompts: [], refs: [] }),
    [nodes, edges, sel?.id]
  );
  const collapsed = useSmartCanvasUiStore((s) => s.inspectorCollapsed);
  const toggleInspector = useSmartCanvasUiStore((s) => s.toggleInspector);
  const selKind = sel?.type as SmartNodeKind | undefined;
  const TypeIcon = selKind ? NODE_ICONS[selKind] : null;
  const typeLabel = selKind ? NODE_TYPE_LABELS[selKind] : '';

  // 浮动模式：把面板贴到选中节点旁（imperative：直接改 DOM 样式，不因平移/缩放触发整面板 re-render）。
  const storeApi = useStoreApi();
  const floatRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!float) return;
    let raf = 0;
    const reposition = (): void => {
      const el = floatRef.current;
      if (!el) return;
      const st = storeApi.getState();
      const tr = st.transform;
      const w = st.width;
      const h = st.height;
      const cnodes = useSmartCanvasStore.getState().nodes;
      const node = cnodes.find((n) => n.selected);
      if (!node) return;
      const abs = absPosition(node, cnodes);
      const nh = node.measured?.height ?? (typeof node.height === 'number' ? node.height : 120);
      const nw = node.measured?.width ?? (typeof node.width === 'number' ? node.width : 220);
      const zoom = tr[2];
      const PANEL_W = el.offsetWidth || 376;
      const GAP = 10;
      // 水平以节点中心对齐（悬浮窗在节点正下方居中），夹在画布内
      const nodeCx = (abs.x + nw / 2) * zoom + tr[0];
      let left = nodeCx - PANEL_W / 2;
      left = Math.max(8, Math.min(left, Math.max(8, w - PANEL_W - 8)));
      const nodeTop = abs.y * zoom + tr[1];
      const nodeBottom = (abs.y + nh) * zoom + tr[1];
      // 先放开高度量真实高度，再按上下可用空间决定方向并夹住（默认放节点下方）
      el.style.maxHeight = `${Math.max(140, h - 16)}px`;
      let ph = el.offsetHeight;
      const roomBelow = h - 8 - (nodeBottom + GAP);
      const roomAbove = nodeTop - GAP - 8;
      let top: number;
      if (roomBelow >= ph || roomBelow >= roomAbove) {
        top = nodeBottom + GAP; // 放下方
        const avail = h - 8 - top;
        if (ph > avail) el.style.maxHeight = `${Math.max(120, avail)}px`;
      } else {
        const avail = roomAbove; // 下方放不下且上方更宽 → 放上方
        if (ph > avail) {
          el.style.maxHeight = `${Math.max(120, avail)}px`;
          ph = avail;
        }
        top = nodeTop - GAP - ph;
      }
      el.style.left = `${left}px`;
      el.style.top = `${Math.max(8, top)}px`;
    };
    const onChange = (): void => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        reposition();
      });
    };
    reposition();
    const unsub = storeApi.subscribe(onChange);
    return () => {
      unsub();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [float, storeApi, sel?.id]);

  // 浮动模式下没有选中节点 → 不渲染（画布回到无边框无限感）
  if (float && !sel) return <></>;

  if (collapsed && !float) {
    return (
      <aside className="mb-sc-inspector is-collapsed mb-card">
        <button className="mb-sc-inspector-toggle" title="展开节点属性" onClick={toggleInspector}>
          ‹
        </button>
      </aside>
    );
  }

  return (
    <aside ref={floatRef} className={`mb-sc-inspector mb-card ${float ? 'is-float' : ''} ${selKind === 'comfy' ? 'is-comfy' : ''}`}>
      <div className="mb-np-header mb-sc-ins-head">
        <div className="mb-np-header-left">
          {TypeIcon ? (
            <span className="mb-np-header-ico">
              <TypeIcon size={15} />
            </span>
          ) : null}
          <span className="mb-np-header-title">{sel ? `${typeLabel}节点` : '节点属性'}</span>
        </div>
        <div className="mb-np-header-right">
          <button className="mb-np-hbtn mb-np-hbtn-ico" title="关闭（取消选中）" onClick={() => useSmartCanvasStore.getState().deselectAll()}>
            ✕
          </button>
        </div>
      </div>
      {!sel ? (
        <div className="mb-sc-empty">
          在画布上选中一个节点，这里编辑它的属性。生成节点的类型 / 运行方式 / 后端 / 模型都在这里配。
        </div>
      ) : sel.type === 'work' ? (
        (() => {
          const d = sel.data as unknown as WorkNodeData;
          const setF = (patch: Partial<WorkNodeData>): void => update(sel.id, patch as Partial<SmartNodeData>);
          const real = d.provider === 'mengbi' && REAL_WORK_TYPES.has(d.workType);
          return (
            <div className="mb-sc-form">
              <label className="mb-sc-flabel">生成类型</label>
              <select
                className="mb-select"
                value={d.workType}
                onChange={(e) => setF({ workType: e.target.value as WorkType })}
              >
                {WORK_TYPES.map((w) => (
                  <option key={w} value={w}>
                    {WORK_TYPE_LABELS[w]}
                    {REAL_WORK_TYPES.has(w) ? '' : '（模拟）'}
                  </option>
                ))}
              </select>

              <label className="mb-sc-flabel">运行方式</label>
              <select
                className="mb-select"
                value={d.runMode}
                onChange={(e) => setF({ runMode: e.target.value as RunMode })}
              >
                {RUN_MODES.map((m) => (
                  <option key={m} value={m}>
                    {RUN_MODE_LABELS[m]}
                  </option>
                ))}
              </select>

              <label className="mb-sc-flabel">执行后端（provider）</label>
              <select
                className="mb-select"
                value={d.provider}
                onChange={(e) => setF({ provider: e.target.value as WorkProvider })}
              >
                {PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {PROVIDER_LABELS[p]}
                  </option>
                ))}
              </select>

              {d.provider === 'mengbi' && (
                <>
                  <label className="mb-sc-flabel">绘画模型</label>
                  <select className="mb-select" value={d.modelId} onChange={(e) => setF({ modelId: e.target.value })}>
                    <option value="">（选择模型）</option>
                    {imageModels.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                  {!real && <div className="mb-sc-note">该类型暂无真实接口，运行走模拟。</div>}
                </>
              )}
              {d.provider === 'mock' && (
                <>
                  <div className="mb-sc-note">Local Mock：产出占位结果（可设延迟 / 错误率）。</div>
                  <label className="mb-sc-flabel">
                    随机延迟 {d.mockDelayMin ?? 200}–{d.mockDelayMax ?? 800} ms
                  </label>
                  <div className="mb-sc-seedrow">
                    <input
                      className="mb-input"
                      type="number"
                      min={0}
                      value={d.mockDelayMin ?? 200}
                      title="延迟下限 ms"
                      onChange={(e) => setF({ mockDelayMin: Math.max(0, Number(e.target.value) || 0) })}
                    />
                    <input
                      className="mb-input"
                      type="number"
                      min={0}
                      value={d.mockDelayMax ?? 800}
                      title="延迟上限 ms"
                      onChange={(e) => setF({ mockDelayMax: Math.max(0, Number(e.target.value) || 0) })}
                    />
                  </div>
                  <label className="mb-sc-flabel">随机失败概率 {Math.round((d.mockErrorRate ?? 0) * 100)}%</label>
                  <input
                    className="mb-sc-range"
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={d.mockErrorRate ?? 0}
                    onChange={(e) => setF({ mockErrorRate: Number(e.target.value) })}
                  />
                </>
              )}

              {d.provider === 'mengbi' &&
                REAL_WORK_TYPES.has(d.workType) &&
                (() => {
                  const family = detectFamily(realModelId(d.modelId || ''));
                  return (
                    <>
                      <label className="mb-sc-flabel">比例（{family.label}）</label>
                      <select className="mb-select" value={d.aspect ?? ''} onChange={(e) => setF({ aspect: e.target.value })}>
                        <option value="">自动</option>
                        {family.supportedAspects.map((a) => (
                          <option key={a} value={a}>
                            {a}
                          </option>
                        ))}
                      </select>
                      {!d.aspect && (
                        <div className="mb-sc-note">
                          {IMG2IMG.has(d.workType) ? '自动：跟随输入图片的比例（吸附到最近的常用比例）' : '自动：不指定，由模型按提示词决定比例'}
                        </div>
                      )}

                      <label className="mb-sc-flabel">分辨率</label>
                      {family.supportedTiers.length > 0 ? (
                        <select
                          className="mb-select"
                          value={d.imageSize ?? ''}
                          onChange={(e) => setF({ imageSize: e.target.value })}
                        >
                          <option value="">（默认）</option>
                          {family.supportedTiers.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div className="mb-sc-note">该系列由 size 决定分辨率（不用 1K/2K/4K 档）。</div>
                      )}

                      {family.supportsQuality && (
                        <>
                          <label className="mb-sc-flabel">质量</label>
                          <select
                            className="mb-select"
                            value={d.quality ?? ''}
                            onChange={(e) => setF({ quality: e.target.value })}
                          >
                            <option value="">（默认）</option>
                            <option value="standard">standard</option>
                            <option value="high">high</option>
                          </select>
                        </>
                      )}

                      {IMG2IMG.has(d.workType) && (
                        <>
                          <label className="mb-sc-flabel">绘画强度 {Math.round((d.strength ?? 0.6) * 100)}%</label>
                          <input
                            className="mb-sc-range"
                            type="range"
                            min={0}
                            max={1}
                            step={0.05}
                            value={d.strength ?? 0.6}
                            onChange={(e) => setF({ strength: Number(e.target.value) })}
                          />
                        </>
                      )}
                    </>
                  );
                })()}

              <div className="mb-sc-note">提示词从上游「提示词 / LLM」节点连入；此处只调 模型 · 比例 · 质量 · 张数。</div>

              {d.provider === 'mengbi' && REAL_WORK_TYPES.has(d.workType) && (
                <>
                  <label className="mb-sc-flabel">种子 seed（空 = 随机；loop 模式按轮 +1）</label>
                  <div className="mb-sc-seedrow">
                    <input
                      className="mb-input"
                      type="number"
                      value={d.seed ?? ''}
                      placeholder="随机"
                      onChange={(e) => {
                        const v = e.target.value.trim();
                        const num = Number(v);
                        setF({ seed: v === '' || Number.isNaN(num) ? null : Math.trunc(num) });
                      }}
                    />
                    <button
                      className="mb-btn mb-btn-sm"
                      type="button"
                      onClick={() => setF({ seed: Math.floor(Math.random() * 2_000_000_000) })}
                    >
                      随机
                    </button>
                    <button className="mb-btn mb-btn-sm mb-btn-ghost" type="button" onClick={() => setF({ seed: null })}>
                      清空
                    </button>
                  </div>
                </>
              )}

              <label className="mb-sc-flabel">张数（1-4）</label>
              <input
                className="mb-input"
                type="number"
                min={1}
                max={4}
                value={d.n}
                onChange={(e) => setF({ n: Math.max(1, Math.min(4, Number(e.target.value) || 1)) })}
              />

              {d.inputRefs.length > 0 && (
                <>
                  <label className="mb-sc-flabel">上游输入（inputRefs）</label>
                  <div className="mb-sc-refs">
                    {d.inputRefs.map((r, i) => (
                      <div key={i} className="mb-sc-ref">
                        <span className="mb-sc-ref-kind">{r.kind === 'image' ? '图' : r.kind === 'prompt' ? '词' : '果'}</span>
                        <span className="mb-sc-ref-prev">{r.preview ?? r.from}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div className="mb-sc-statusrow"><StatusPill status={d.status} /></div>
              {d.error && <div className="mb-sc-result-err">{d.error}</div>}

              <button
                className="mb-btn mb-btn-primary mb-sc-run"
                disabled={d.status === 'running'}
                onClick={() => void runWithUpstream(sel.id)}
              >
                {d.status === 'running' ? '运行中…' : '运行此节点'}
              </button>
              {d.status === 'running' && (
                <button
                  className="mb-btn mb-btn-ghost mb-sc-run"
                  onClick={() => cancelWork(sel.id)}
                  title="取消并释放队列槽，可立即重试（拥挤模型卡住时用）"
                >
                  取消运行
                </button>
              )}
              <ExportLogBtn title="生成节点" logs={d.logs} error={d.error} />
              {d.result?.images?.length ? (
                <ResultActionsBlock images={d.result.images} durationMs={d.result?.durationMs ?? undefined} />
              ) : null}
            </div>
          );
        })()
      ) : sel.type === 'llm' ? (
        (() => {
          const d = sel.data as unknown as LlmNodeData;
          const setF = (patch: Partial<LlmNodeData>): void => update(sel.id, patch as Partial<SmartNodeData>);
          const isImageOp = LLM_IMAGE_OPS.has(d.op);
          return (
            <div className="mb-sc-form">
              <Field label="操作">
                <select className="mb-select" value={d.op} onChange={(e) => setF({ op: e.target.value as LlmOp })}>
                  {LLM_OPS.map((o) => (
                    <option key={o} value={o}>
                      {LLM_OP_LABELS[o]}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label={`对话模型${isImageOp ? '（需 vision）' : ''}`}>
                <select className="mb-select" value={d.modelId} onChange={(e) => setF({ modelId: e.target.value })}>
                  <option value="">（选择模型）</option>
                  {/* 已选模型不在当前可选列表（换方案后失效等）→ 仍占位显示，让用户看到要改 */}
                  {d.modelId && !textModels.some((m) => m.name === d.modelId) && (
                    <option value={d.modelId} disabled>
                      {d.modelId}（已失效）
                    </option>
                  )}
                  {textModels.map((m) => (
                    <option key={m.name} value={m.name} disabled={!m.usable}>
                      {m.usable ? m.name : `${m.name}（实际ID未填）`}
                    </option>
                  ))}
                </select>
              </Field>

              {isImageOp ? (
                <Field label="反推类型">
                  <SegmentedControl
                    value={d.reverseType}
                    options={[
                      { value: 'description', label: '描述' },
                      { value: 'tags', label: '标签' },
                      { value: 'style', label: '风格' }
                    ]}
                    onChange={(v) => setF({ reverseType: v as LlmNodeData['reverseType'] })}
                  />
                </Field>
              ) : (
                <Field label="额外指令（可选）">
                  <input
                    className="mb-input"
                    value={d.instruction}
                    {...editProps}
                    onChange={(e) => setF({ instruction: e.target.value })}
                    placeholder="例如：偏写实 / 限 50 词以内"
                  />
                </Field>
              )}

              {textModels.length === 0 && <div className="mb-sc-note">当前方案没有对话模型，请到设置页配置。</div>}
              {(() => {
                const why = d.modelId ? diagnoseChatModel(configs, plans, activePlanId, d.modelId) : null;
                return why ? <div className="mb-sc-result-err">{why}</div> : null;
              })()}

              {isImageOp ? (
                <div className="mb-sc-note">连一个上游图片节点，反推成提示词文本喂给下游。</div>
              ) : up.prompts.length > 0 ? (
                <div className="mb-sc-fromup is-fed">输入文本由上游输入（{up.prompts.length} 段），无需手填</div>
              ) : (
                <Field label="输入文本（与上游文本/提示词合并）" wide>
                  <textarea
                    className="mb-textarea mb-sc-itext"
                    value={d.input}
                    {...editProps}
                    onChange={(e) => setF({ input: e.target.value })}
                    placeholder="可留空，仅用上游提示词…"
                  />
                </Field>
              )}

              <div className="mb-sc-fb is-wide mb-sc-runrow">
                <button
                  className="mb-btn mb-btn-primary mb-sc-run"
                  disabled={d.status === 'running'}
                  onClick={() => void runWithUpstream(sel.id)}
                >
                  {d.status === 'running' ? '运行中…' : '运行此节点'}
                </button>
                <StatusPill status={d.status} />
                <ExportLogBtn title="LLM 节点" logs={d.logs} error={d.error} />
              </div>
              {d.error && <div className="mb-sc-result-err">{d.error}</div>}
              {d.resultText?.trim() && (
                <Field label="输出文本" wide>
                  <textarea className="mb-textarea mb-sc-itext" readOnly value={d.resultText} />
                </Field>
              )}
            </div>
          );
        })()
      ) : sel.type === 'comfy' ? (
        (() => {
          const d = sel.data as unknown as ComfyNodeData;
          const setCv = (cid: string, v: unknown): void =>
            update(sel.id, { controlValues: { ...d.controlValues, [cid]: v } } as Partial<SmartNodeData>);
          return (
            <div className="mb-sc-form">
              <Field label="工作流模板" wide>
                <select
                  className="mb-select"
                  value={d.workflowId}
                  onChange={(e) => void pickComfyTemplate(sel.id, e.target.value)}
                >
                  <option value="">（选择模板）</option>
                  {comfyTemplates.map((t) => (
                    <option key={t.workflowId} value={t.workflowId}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </Field>
              {comfyTemplates.length === 0 && (
                <div className="mb-sc-note">「工作流」模块（Ctrl+4）里还没保存模板，先去建一个并保存。</div>
              )}

              {d.workflowId && (
                <>
                  <Field label="工作流参数（按所属节点分模块，运行时随工作流发出）" wide />
                  {(() => {
                    // 按「节点标题」把控件分类成一个个模块卡片，横向铺开（3:1~4:1 宽屏）
                    const visible = d.controls.filter((c) => c.visible !== false);
                    if (visible.length === 0) return null;
                    // 哪些输入槽会被上游覆盖（与运行引擎 runComfyNode 同逻辑）：
                    //   文本槽 i 被喂入 ⟺ 上游提示词数 > i；图片槽被喂入 ⟺ 有上游图片。
                    const slots = comfyInputSlots(visible);
                    const fedText = new Set<string>();
                    slots.text.forEach((c, i) => {
                      if (up.prompts.length > i) fedText.add(c.id);
                    });
                    const imagesFed = up.images.length > 0;
                    const modules = new Map<string, InputControl[]>();
                    for (const c of visible) {
                      const { group } = comfyGroupOf(c.label);
                      const arr = modules.get(group);
                      if (arr) arr.push(c);
                      else modules.set(group, [c]);
                    }
                    // 被上游喂入的输入：去掉输入框、改黄色「由上游输入」一行字（省空间 + 防误填）
                    const renderCtl = (c: InputControl): JSX.Element => {
                      const field = comfyGroupOf(c.label).field;
                      if (COMFY_IMAGE_KINDS.has(c.type)) {
                        return (
                          <div key={c.id} className={`mb-sc-fromup ${imagesFed ? 'is-fed' : ''}`}>
                            {field}：{imagesFed ? '由上游输入图片' : '由上游喂入（未接则用工作流默认）'}
                          </div>
                        );
                      }
                      if (fedText.has(c.id)) {
                        return (
                          <div key={c.id} className="mb-sc-fromup is-fed">
                            {field}：由上游输入（无需手填）
                          </div>
                        );
                      }
                      return renderComfyControl({ ...c, label: field }, d.controlValues[c.id], setCv);
                    };
                    return (
                      <div className="mb-sc-modules">
                        {[...modules].map(([g, cs]) => (
                          <div className="mb-sc-module" key={g}>
                            <div className="mb-sc-module-h">{g}</div>
                            <div className="mb-sc-module-b">{cs.map(renderCtl)}</div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                  <div className="mb-sc-note">图片 / 文本输入由上游节点喂入；其余参数在此调。</div>
                </>
              )}

              <div className="mb-sc-fb is-wide mb-sc-runrow">
                <button
                  className="mb-btn mb-btn-primary mb-sc-run"
                  disabled={d.status === 'running' || !d.workflowId}
                  onClick={() => void runWithUpstream(sel.id)}
                >
                  {d.status === 'running' ? '运行中…' : '运行此节点'}
                </button>
                <StatusPill status={d.status} />
                <ExportLogBtn title="ComfyUI 节点" logs={d.logs} error={d.error} />
              </div>
              {d.error && <div className="mb-sc-result-err">{d.error}</div>}
              {/* 结果模块已去除（作用不大）：结果在节点卡上看 / 连「结果」节点查看 */}
            </div>
          );
        })()
      ) : sel.type === 'prompt' ? (
        <div className="mb-sc-form">
          <label className="mb-sc-flabel">提示词</label>
          <textarea
            className="mb-textarea mb-sc-itext"
            value={(sel.data as unknown as PromptNodeData).text ?? ''}
            {...editProps}
            onChange={(e) => update(sel.id, { text: e.target.value } as Partial<SmartNodeData>)}
          />
        </div>
      ) : sel.type === 'group' ? (
        <div className="mb-sc-form">
          <Field label="分组名" wide>
            <input
              className="mb-input"
              value={(sel.data as unknown as GroupNodeData).title ?? ''}
              onChange={(e) => update(sel.id, { title: e.target.value } as Partial<SmartNodeData>)}
            />
          </Field>
          <div className="mb-sc-note">把图片 / 提示词连进来，再连到生成节点。</div>
        </div>
      ) : sel.type === 'image' ? (
        (() => {
          const im = sel.data as unknown as ImageNodeData;
          return (
            <div className="mb-sc-form">
              <div className="mb-sc-note">
                {im.src ? '已设置图片。' : '在画布上的图片节点里上传 / 拖入 / 粘贴图片。拖角可调整尺寸。'}
              </div>
              {im.name && <div className="mb-sc-result-meta">文件：{im.name}</div>}
              {im.naturalW && im.naturalH && (
                <div className="mb-sc-result-meta">尺寸：{im.naturalW} × {im.naturalH}</div>
              )}
            </div>
          );
        })()
      ) : sel.type === 'angle-prompt' ? (
        (() => {
          const a = sel.data as unknown as AnglePromptNodeData;
          const setA = (p: Partial<AnglePromptNodeData>): void => {
            const next = { ...a, ...p };
            next.generatedPrompt = buildAnglePrompt(
              next.horizontalAngle,
              next.verticalAngle,
              next.distance,
              next.appendConsistencyInstruction
            );
            update(sel.id, next as Partial<SmartNodeData>);
          };
          return (
            <div className="mb-sc-form">
              <div className="mb-sc-note">接入图片 → 拖滑块 / 预览上拖动调角度 → 输出「改视角」提示词。</div>

              <label className="mb-sc-flabel">
                水平旋转：{a.horizontalAngle > 0 ? `向右 ${a.horizontalAngle}°` : a.horizontalAngle < 0 ? `向左 ${-a.horizontalAngle}°` : '正面'}
              </label>
              <input
                className="mb-sc-range"
                type="range"
                min={-90}
                max={90}
                step={1}
                value={a.horizontalAngle}
                onChange={(e) => setA({ horizontalAngle: Number(e.target.value) })}
              />

              <label className="mb-sc-flabel">
                垂直俯仰：{a.verticalAngle > 0 ? `俯视 ${a.verticalAngle}°` : a.verticalAngle < 0 ? `仰视 ${-a.verticalAngle}°` : '平视'}
              </label>
              <input
                className="mb-sc-range"
                type="range"
                min={-90}
                max={90}
                step={1}
                value={a.verticalAngle}
                onChange={(e) => setA({ verticalAngle: Number(e.target.value) })}
              />

              <label className="mb-sc-flabel">
                镜头距离：{a.distance.toFixed(1)}（{a.distance > 4 ? '广角' : a.distance < 4 ? '特写' : '标准'}）
              </label>
              <input
                className="mb-sc-range"
                type="range"
                min={0.1}
                max={8}
                step={0.1}
                value={a.distance}
                onChange={(e) => setA({ distance: Number(e.target.value) })}
              />

              <label className="mb-sc-switch-row">
                <input
                  type="checkbox"
                  checked={a.appendConsistencyInstruction}
                  onChange={(e) => setA({ appendConsistencyInstruction: e.target.checked })}
                />
                追加一致性约束句
              </label>
              <button
                className="mb-btn mb-btn-sm mb-btn-ghost"
                onClick={() => setA({ horizontalAngle: 0, verticalAngle: 0, distance: 4 })}
              >
                全部重置
              </button>

              <label className="mb-sc-flabel">生成的视角提示词（实时输出给下游）</label>
              <textarea className="mb-textarea mb-sc-itext" readOnly value={a.generatedPrompt} />
            </div>
          );
        })()
      ) : sel.type === 'scale' ? (
        (() => {
          const d = sel.data as unknown as ScaleNodeData;
          const setF = (patch: Partial<ScaleNodeData>): void => update(sel.id, patch as Partial<SmartNodeData>);
          const edgeMode = d.mode === 'longest' || d.mode === 'shortest' || d.mode === 'width' || d.mode === 'height';
          const boxMode = d.mode === 'fit' || d.mode === 'exact';
          return (
            <div className="mb-sc-form">
              <Field label="缩放模式">
                <select className="mb-select" value={d.mode} onChange={(e) => setF({ mode: e.target.value as ScaleMode })}>
                  {SCALE_MODES.map((m) => (
                    <option key={m} value={m}>
                      {SCALE_MODE_LABELS[m]}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="输出格式">
                <SegmentedControl
                  value={d.format}
                  options={[
                    { value: 'png', label: 'PNG' },
                    { value: 'jpeg', label: 'JPEG' },
                    { value: 'webp', label: 'WebP' }
                  ]}
                  onChange={(v) => setF({ format: v as 'png' | 'jpeg' | 'webp' })}
                />
              </Field>

              {d.mode === 'factor' && (
                <Field label={`倍数 ×${d.factor}`} wide>
                  <input className="mb-sc-range" type="range" min={0.1} max={4} step={0.1} value={d.factor} onChange={(e) => setF({ factor: Number(e.target.value) })} />
                </Field>
              )}
              {edgeMode && (
                <Field label="目标像素（px）">
                  <ClampNumberInput value={d.edge} min={16} max={8192} onCommit={(v) => setF({ edge: v })} />
                </Field>
              )}
              {boxMode && (
                <Field label={`${d.mode === 'fit' ? '限制框 宽×高' : '目标 宽×高'}（px）`}>
                  <div className="mb-sc-seedrow">
                    <ClampNumberInput value={d.fitW} min={1} max={8192} onCommit={(v) => setF({ fitW: v })} />
                    <ClampNumberInput value={d.fitH} min={1} max={8192} onCommit={(v) => setF({ fitH: v })} />
                  </div>
                </Field>
              )}
              {d.mode === 'pixels' && (
                <Field label={`总像素 ${d.megapixels} MP`} wide>
                  <input className="mb-sc-range" type="range" min={0.25} max={16} step={0.25} value={d.megapixels} onChange={(e) => setF({ megapixels: Number(e.target.value) })} />
                </Field>
              )}

              {d.mode === 'exact' && (
                <Field>
                  <label className="mb-sc-switch-row">
                    <input type="checkbox" checked={d.keepAspect} onChange={(e) => setF({ keepAspect: e.target.checked })} /> 等比缩到框内
                  </label>
                </Field>
              )}
              <Field>
                <label className="mb-sc-switch-row">
                  <input type="checkbox" checked={d.noUpscale} onChange={(e) => setF({ noUpscale: e.target.checked })} /> 仅缩小不放大
                </label>
              </Field>

              {d.inW && d.outW ? (
                <div className="mb-sc-result-meta">
                  输入 {d.inW}×{d.inH} → 输出 {d.outW}×{d.outH}
                </div>
              ) : (
                <div className="mb-sc-note">连一个图片来源进来即自动缩放（预处理，非高清化）。</div>
              )}
            </div>
          );
        })()
      ) : sel.type === 'ratio' ? (
        <div className="mb-sc-form">
          <div className="mb-sc-note">
            尺寸分析：连一个图片来源进来，节点上显示最接近的常用比例 + 各档（1K/2K/4K）实际分辨率 + GPT Image 2 像素预算尺寸。纯参考，不输出。
          </div>
        </div>
      ) : sel.type === 'light' ? (
        (() => {
          const l = sel.data as unknown as LightNodeData;
          const setL = (patch: Partial<LightNodeData>): void => {
            const next = { ...l, ...patch };
            next.generatedPrompt = buildLightPrompt(next);
            update(sel.id, next as Partial<SmartNodeData>);
          };
          const OCCS = Object.keys(LIGHT_OCCLUSION_LABELS) as LightOcclusion[];
          const EFFS = Object.keys(LIGHT_EFFECT_LABELS) as LightEffect[];
          return (
            <div className="mb-sc-form">
              <div className="mb-sc-note">接入图片 → 在节点上拖光点 / 调下列参数 → 输出光照提示词喂下游。</div>

              <label className="mb-sc-flabel">方位角 {l.azimuth}°（0 正前 / 90 右 / 180 逆光 / -90 左）</label>
              <input className="mb-sc-range" type="range" min={-180} max={180} step={1} value={l.azimuth} onChange={(e) => setL({ azimuth: Number(e.target.value) })} />

              <label className="mb-sc-flabel">高度角 {l.elevation}°（0 地平线 / 90 头顶）</label>
              <input className="mb-sc-range" type="range" min={0} max={90} step={1} value={l.elevation} onChange={(e) => setL({ elevation: Number(e.target.value) })} />

              <label className="mb-sc-flabel">强度 {l.intensity}</label>
              <input className="mb-sc-range" type="range" min={0} max={100} step={1} value={l.intensity} onChange={(e) => setL({ intensity: Number(e.target.value) })} />

              <label className="mb-sc-flabel">色温 {l.warmth}（负 = 冷 / 正 = 暖）</label>
              <input className="mb-sc-range" type="range" min={-100} max={100} step={1} value={l.warmth} onChange={(e) => setL({ warmth: Number(e.target.value) })} />

              <label className="mb-sc-flabel">遮挡</label>
              <select className="mb-select" value={l.occlusion} onChange={(e) => setL({ occlusion: e.target.value as LightOcclusion })}>
                {OCCS.map((o) => (
                  <option key={o} value={o}>
                    {LIGHT_OCCLUSION_LABELS[o]}
                  </option>
                ))}
              </select>

              <label className="mb-sc-flabel">光效</label>
              <select className="mb-select" value={l.effect} onChange={(e) => setL({ effect: e.target.value as LightEffect })}>
                {EFFS.map((o) => (
                  <option key={o} value={o}>
                    {LIGHT_EFFECT_LABELS[o]}
                  </option>
                ))}
              </select>

              <label className="mb-sc-switch-row">
                <input type="checkbox" checked={l.appendConsistencyInstruction} onChange={(e) => setL({ appendConsistencyInstruction: e.target.checked })} />
                一致性约束（只改光照）
              </label>
              <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={() => setL({ azimuth: 35, elevation: 55, intensity: 60, warmth: 30, occlusion: 'none', effect: 'none' })}>
                全部重置
              </button>

              <label className="mb-sc-flabel">生成的光照提示词（实时输出给下游）</label>
              <textarea className="mb-textarea mb-sc-itext" readOnly value={l.generatedPrompt} />
            </div>
          );
        })()
      ) : sel.type === 'text' ? (
        (() => {
          const t = sel.data as unknown as TextNodeData;
          const setT = (patch: Partial<TextNodeData>): void => update(sel.id, patch as Partial<SmartNodeData>);
          const ALIGNS: Array<{ v: TextAlign; label: string }> = [
            { v: 'left', label: '左' },
            { v: 'center', label: '中' },
            { v: 'right', label: '右' }
          ];
          return (
            <div className="mb-sc-form">
              <Field label="文字内容" wide>
                <textarea
                  className="mb-textarea mb-sc-itext"
                  value={t.text}
                  {...editProps}
                  placeholder="输入文字…"
                  onChange={(e) => setT({ text: e.target.value })}
                />
              </Field>

              <Field label="字体">
                <select className="mb-select" value={t.fontFamily} onChange={(e) => setT({ fontFamily: e.target.value })}>
                  {TEXT_FONTS.map((f) => (
                    <option key={f.label} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="颜色">
                <div className="mb-sc-seedrow">
                  <input
                    className="mb-input"
                    type="color"
                    value={t.color || '#e6e6e6'}
                    title="文字颜色"
                    onChange={(e) => setT({ color: e.target.value })}
                  />
                  <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={() => setT({ color: '' })} title="跟随主题文字色">
                    跟随主题
                  </button>
                </div>
              </Field>

              <Field label="样式">
                <div className="mb-sc-seedrow">
                  <button className={`mb-btn mb-btn-sm ${t.bold ? '' : 'mb-btn-ghost'}`} onClick={() => setT({ bold: !t.bold })} title="加粗">
                    <b>B</b>
                  </button>
                  <button className={`mb-btn mb-btn-sm ${t.italic ? '' : 'mb-btn-ghost'}`} onClick={() => setT({ italic: !t.italic })} title="斜体">
                    <i>I</i>
                  </button>
                </div>
              </Field>

              <Field label="对齐">
                <SegmentedControl
                  value={t.align ?? 'left'}
                  options={ALIGNS.map((a) => ({ value: a.v, label: a.label }))}
                  onChange={(v) => setT({ align: v as TextAlign })}
                />
              </Field>

              <Field label={`字号 ${t.fontSize ?? 22}px`} wide>
                <input
                  className="mb-sc-range"
                  type="range"
                  min={10}
                  max={120}
                  step={1}
                  value={t.fontSize ?? 22}
                  onChange={(e) => setT({ fontSize: Number(e.target.value) })}
                />
              </Field>
              <div className="mb-sc-note">双击画布上的文字即可编辑内容。</div>
            </div>
          );
        })()
      ) : (
        (() => {
          const acc = resultAccum[sel.id] ?? [];
          const allImages = acc.flatMap((r) => r.images);
          const allTexts = acc.flatMap((r) => r.texts ?? []);
          const allVideos = acc.flatMap((r) => r.videos ?? []);
          const last = acc[acc.length - 1];
          const metaParts: string[] = [];
          if (allImages.length) metaParts.push(`${allImages.length} 图`);
          if (allTexts.length) metaParts.push(`${allTexts.length} 文本`);
          if (allVideos.length) metaParts.push(`${allVideos.length} 视频`);
          return (
            <div className="mb-sc-form">
              {acc.length === 0 ? (
                <div className="mb-sc-note">连 生成 / ComfyUI 的图或 LLM 的文本，结果在此累积（重启清空），每项可拖出成节点。</div>
              ) : (
                <>
                  <div className="mb-sc-result-meta">
                    {metaParts.join(' / ')} · {acc.length} 次生成
                    {last ? ` · 最近 ${providerLabel(last.provider)}` : ''}
                  </div>
                  {last?.error && <div className="mb-sc-result-err">{last.error}</div>}
                  {allImages.length > 0 && (
                    <div className="mb-sc-fb is-wide">
                      <ResultActionsBlock images={allImages} durationMs={last?.durationMs} />
                    </div>
                  )}
                  {allTexts.length > 0 && (
                    <Field label={`文本输出（${allTexts.length}）`} wide>
                      <textarea className="mb-textarea mb-sc-itext" readOnly value={allTexts.join('\n\n')} />
                    </Field>
                  )}
                  {allVideos.length > 0 && (
                    <Field label={`视频输出（${allVideos.length}）`} wide>
                      <div className="mb-sc-result-videos">
                        {allVideos.map((v, i) => (
                          <video
                            key={i}
                            className="mb-sc-result-video"
                            src={v.startsWith('data:') || v.startsWith('http') ? v : localPathToImageUrl(v)}
                            controls
                          />
                        ))}
                      </div>
                    </Field>
                  )}
                  <div className="mb-sc-fb is-wide">
                    <button
                      className="mb-btn mb-btn-sm mb-btn-ghost"
                      onClick={() => {
                        clearResult(sel.id);
                        update(sel.id, { result: null } as Partial<SmartNodeData>);
                      }}
                    >
                      清空累积结果
                    </button>
                  </div>
                  {last?.logs.length ? <pre className="mb-sc-logs">{last.logs.join('\n')}</pre> : null}
                </>
              )}
            </div>
          );
        })()
      )}
    </aside>
  );
}
