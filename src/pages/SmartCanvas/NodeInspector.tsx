import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSmartCanvasStore, useSmartResultStore, useSmartCanvasUiStore } from '@/store/smartCanvasStore';
import { useImageParamsStore } from '@/store/imageParamsStore';
import { useSettingsStore } from '@/store/settingsStore';
import { runWithUpstream, cancelWork } from '@/lib/smartCanvasRunner';
import { toast } from '@/store/toastStore';
import { localPathToImageUrl } from '@/lib/imageUrl';
import { listMappedModels, diagnoseChatModel, type MappedModel } from '@/lib/modelMapping';
import { detectFamily } from '@shared/imageModelFamilies';
import type { WorkflowTemplateSummary, InputControl } from '@shared/comfyui';
import {
  WORK_TYPE_LABELS,
  RUN_MODE_LABELS,
  PROVIDER_LABELS,
  providerLabel,
  REAL_WORK_TYPES,
  LLM_OP_LABELS,
  LLM_IMAGE_OPS,
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
  type NodeMeta,
  type SmartNodeData
} from '@shared/smartCanvas';
import { buildAnglePrompt } from '@/lib/anglePrompt';
import { exportTextFile, fmtDur } from './nodeArea';

/** 标签颜色候选（取主题 token；带字面量回退，沿用项目既有 var(--mb-x, #..) 写法）。 */
const LABEL_COLORS = [
  'var(--mb-accent)',
  'var(--mb-success, #3fb950)',
  'var(--mb-danger, #f85149)',
  'var(--mb-warning, #d29922)',
  'var(--mb-info, #58a6ff)',
  'var(--mb-text-muted)'
];

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
      <div className="mb-sc-rlist">
        {images.map((p, i) => (
          <div key={i} className="mb-sc-rrow">
            <img src={p.startsWith('data:') ? p : localPathToImageUrl(p)} alt={`结果 ${i + 1}`} draggable={false} />
            <button className="mb-btn mb-btn-sm mb-btn-ghost nodrag" onClick={() => void saveAs(p, i)}>
              另存
            </button>
            <button className="mb-btn mb-btn-sm mb-btn-ghost nodrag" onClick={() => void toCreateRef(p)}>
              作参考图
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

const COMFY_IMAGE_KINDS = new Set(['image', 'multi_image', 'mask', 'video', 'audio', 'file']);

/** 渲染一个 ComfyUI 工作流控件为可编辑表单项（图片类只读提示，由上游喂入）。 */
function renderComfyControl(c: InputControl, value: unknown, setCv: (id: string, v: unknown) => void): JSX.Element {
  const cid = c.id;
  const label = c.label || cid;
  if (COMFY_IMAGE_KINDS.has(c.type)) {
    return (
      <div key={cid} className="mb-sc-note">
        {label}：由画布上游喂入
      </div>
    );
  }
  const val = value ?? c.default ?? '';
  const num = typeof val === 'number' ? val : Number(val) || 0;
  let field: JSX.Element;
  switch (c.type) {
    case 'textarea':
    case 'json':
    case 'prompt':
      field = (
        <textarea className="mb-textarea mb-sc-itext" value={String(val)} onChange={(e) => setCv(cid, e.target.value)} />
      );
      break;
    case 'number':
    case 'seed':
      field = <input className="mb-input" type="number" value={num} onChange={(e) => setCv(cid, Number(e.target.value))} />;
      break;
    case 'slider':
      field = (
        <input
          className="mb-sc-range"
          type="range"
          min={c.min ?? 0}
          max={c.max ?? 1}
          step={c.step ?? 0.01}
          value={num}
          onChange={(e) => setCv(cid, Number(e.target.value))}
        />
      );
      break;
    case 'select':
      field = (
        <select className="mb-select" value={String(val)} onChange={(e) => setCv(cid, e.target.value)}>
          {(c.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
      break;
    case 'switch':
      field = (
        <label className="mb-sc-switch-row">
          <input type="checkbox" checked={!!val} onChange={(e) => setCv(cid, e.target.checked)} /> 开启
        </label>
      );
      break;
    case 'color':
      field = <input type="color" value={String(val) || '#000000'} onChange={(e) => setCv(cid, e.target.value)} />;
      break;
    default:
      field = <input className="mb-input" value={String(val)} onChange={(e) => setCv(cid, e.target.value)} />;
  }
  return (
    <div key={cid} className="mb-sc-cfield">
      <label className="mb-sc-flabel">
        {label}
        {c.type === 'slider' ? ` · ${num}` : ''}
      </label>
      {field}
    </div>
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
export function NodeInspector(): JSX.Element {
  const nodes = useSmartCanvasStore((s) => s.nodes);
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
  const collapsed = useSmartCanvasUiStore((s) => s.inspectorCollapsed);
  const toggleInspector = useSmartCanvasUiStore((s) => s.toggleInspector);

  if (collapsed) {
    return (
      <aside className="mb-sc-inspector is-collapsed mb-card">
        <button className="mb-sc-inspector-toggle" title="展开节点属性" onClick={toggleInspector}>
          ‹
        </button>
      </aside>
    );
  }

  return (
    <aside className="mb-sc-inspector mb-card">
      <div className="mb-sc-inspector-title">
        节点属性
        <button className="mb-sc-inspector-toggle" title="收起" onClick={toggleInspector}>
          ›
        </button>
      </div>
      {sel && (
        <div className="mb-sc-labeledit">
          <label className="mb-sc-flabel">标签 / 注释（颜色分类）</label>
          <input
            className="mb-input"
            placeholder="给节点加个标签…"
            value={(sel.data as NodeMeta).label ?? ''}
            {...editProps}
            onChange={(e) => update(sel.id, { label: e.target.value } as Partial<SmartNodeData>)}
          />
          <div className="mb-sc-swatches">
            {LABEL_COLORS.map((c) => (
              <button
                key={c}
                className={`mb-sc-swatch ${(sel.data as NodeMeta).labelColor === c ? 'is-on' : ''}`}
                style={{ background: c }}
                title="标签颜色"
                onClick={() => update(sel.id, { labelColor: c } as Partial<SmartNodeData>)}
              />
            ))}
            <button
              className="mb-sc-swatch is-clear"
              title="清除标签"
              onClick={() => update(sel.id, { label: '', labelColor: '' } as Partial<SmartNodeData>)}
            >
              ✕
            </button>
          </div>
        </div>
      )}
      {!sel ? (
        <div className="mb-sc-empty">
          在画布上选中一个节点，这里编辑它的属性。生成节点的类型 / 运行方式 / 后端 / 模型 / 提示词都在这里配。
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
                  {!real && <div className="mb-sc-note">该生成类型暂无真实接口，运行将走模拟（后续接 api:upscale / 视频后端）。</div>}
                </>
              )}
              {d.provider === 'mock' && (
                <>
                  <div className="mb-sc-note">Local Mock：不调用真实模型，产出占位结果用于联调连线/流程。可设随机延迟与错误率模拟真实运行。</div>
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
                          <div className="mb-sc-note">强度对 OpenAI 协议无效；ComfyUI 等支持 denoise 的后端接入后生效。</div>
                        </>
                      )}
                    </>
                  );
                })()}

              <label className="mb-sc-flabel">提示词（与上游提示词节点合并）</label>
              <textarea
                className="mb-textarea mb-sc-itext"
                value={d.prompt}
                {...editProps}
                onChange={(e) => setF({ prompt: e.target.value })}
                placeholder="本节点的提示词…"
              />

              {d.provider === 'mengbi' && REAL_WORK_TYPES.has(d.workType) && (
                <>
                  <label className="mb-sc-flabel">负向提示词（不想要的内容，可空）</label>
                  <textarea
                    className="mb-textarea mb-sc-itext"
                    value={d.negativePrompt ?? ''}
                    onChange={(e) => setF({ negativePrompt: e.target.value })}
                    placeholder="如：低分辨率、多余手指、水印…"
                  />

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

              <div className={`mb-sc-status is-${d.status}`}>状态：{d.status}</div>
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
              <label className="mb-sc-flabel">操作</label>
              <select className="mb-select" value={d.op} onChange={(e) => setF({ op: e.target.value as LlmOp })}>
                {LLM_OPS.map((o) => (
                  <option key={o} value={o}>
                    {LLM_OP_LABELS[o]}
                  </option>
                ))}
              </select>

              <label className="mb-sc-flabel">对话模型{isImageOp ? '（需 vision）' : ''}</label>
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
              {textModels.length === 0 && <div className="mb-sc-note">当前方案没有对话模型，请到设置页配置。</div>}
              {(() => {
                const why = d.modelId ? diagnoseChatModel(configs, plans, activePlanId, d.modelId) : null;
                return why ? <div className="mb-sc-result-err">{why}</div> : null;
              })()}

              {isImageOp ? (
                <>
                  <label className="mb-sc-flabel">反推类型</label>
                  <select
                    className="mb-select"
                    value={d.reverseType}
                    onChange={(e) => setF({ reverseType: e.target.value as LlmNodeData['reverseType'] })}
                  >
                    <option value="description">描述</option>
                    <option value="tags">标签</option>
                    <option value="style">风格</option>
                  </select>
                  <div className="mb-sc-note">连一个上游图片节点，反推成提示词文本喂给下游。</div>
                </>
              ) : (
                <>
                  <label className="mb-sc-flabel">输入文本（与上游文本/提示词合并）</label>
                  <textarea
                    className="mb-textarea mb-sc-itext"
                    value={d.input}
                    {...editProps}
                    onChange={(e) => setF({ input: e.target.value })}
                    placeholder="可留空，仅用上游提示词…"
                  />
                  <label className="mb-sc-flabel">额外指令（可选）</label>
                  <input
                    className="mb-input"
                    value={d.instruction}
                    {...editProps}
                    onChange={(e) => setF({ instruction: e.target.value })}
                    placeholder="例如：偏写实 / 限 50 词以内"
                  />
                </>
              )}

              <button
                className="mb-btn mb-btn-primary mb-sc-run"
                disabled={d.status === 'running'}
                onClick={() => void runWithUpstream(sel.id)}
              >
                {d.status === 'running' ? '运行中…' : '运行此节点'}
              </button>
              <div className={`mb-sc-status is-${d.status}`}>状态：{d.status}</div>
              {d.error && <div className="mb-sc-result-err">{d.error}</div>}
              <ExportLogBtn title="LLM 节点" logs={d.logs} error={d.error} />
              {d.resultText?.trim() && (
                <>
                  <label className="mb-sc-flabel">输出文本</label>
                  <textarea className="mb-textarea mb-sc-itext" readOnly value={d.resultText} />
                </>
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
              <label className="mb-sc-flabel">工作流模板</label>
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
              {comfyTemplates.length === 0 && (
                <div className="mb-sc-note">「工作流」模块（Ctrl+4）里还没保存模板，先去建一个并保存。</div>
              )}

              {d.workflowId && (
                <>
                  <label className="mb-sc-flabel">工作流参数（在此调整，运行时随工作流发出）</label>
                  {d.controls.filter((c) => c.visible !== false).map((c) => renderComfyControl(c, d.controlValues[c.id], setCv))}
                  <div className="mb-sc-note">
                    图片 / 文本输入控件由画布上游节点喂入（连图片 / 提示词节点进来即覆盖）；其余参数在此调好即可，一次配置重复运行。
                  </div>
                </>
              )}

              <button
                className="mb-btn mb-btn-primary mb-sc-run"
                disabled={d.status === 'running' || !d.workflowId}
                onClick={() => void runWithUpstream(sel.id)}
              >
                {d.status === 'running' ? '运行中…' : '运行此节点'}
              </button>
              <div className={`mb-sc-status is-${d.status}`}>状态：{d.status}</div>
              {d.error && <div className="mb-sc-result-err">{d.error}</div>}
              <ExportLogBtn title="ComfyUI 节点" logs={d.logs} error={d.error} />
              {d.result?.images?.length ? (
                <ResultActionsBlock images={d.result.images} durationMs={d.result?.durationMs ?? undefined} />
              ) : null}
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
          <label className="mb-sc-flabel">分组名</label>
          <input
            className="mb-input"
            value={(sel.data as unknown as GroupNodeData).title ?? ''}
            onChange={(e) => update(sel.id, { title: e.target.value } as Partial<SmartNodeData>)}
          />
          <div className="mb-sc-note">分组是聚合器：把图片/提示词连进来，再连到生成节点。拖角可调整尺寸。</div>
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
              <div className="mb-sc-note">接入一张图片（或在节点里上传）→ 拖滑块 / 在预览上拖动调三向角度 → 实时生成「改视角」提示词输出给下游。</div>

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
              <label className="mb-sc-flabel">缩放模式</label>
              <select className="mb-select" value={d.mode} onChange={(e) => setF({ mode: e.target.value as ScaleMode })}>
                {SCALE_MODES.map((m) => (
                  <option key={m} value={m}>
                    {SCALE_MODE_LABELS[m]}
                  </option>
                ))}
              </select>

              {d.mode === 'factor' && (
                <>
                  <label className="mb-sc-flabel">倍数 ×{d.factor}</label>
                  <input className="mb-sc-range" type="range" min={0.1} max={4} step={0.1} value={d.factor} onChange={(e) => setF({ factor: Number(e.target.value) })} />
                </>
              )}
              {edgeMode && (
                <>
                  <label className="mb-sc-flabel">目标像素（px）</label>
                  <ClampNumberInput value={d.edge} min={16} max={8192} onCommit={(v) => setF({ edge: v })} />
                </>
              )}
              {boxMode && (
                <>
                  <label className="mb-sc-flabel">{d.mode === 'fit' ? '限制框 宽×高' : '目标 宽×高'}（px）</label>
                  <div className="mb-sc-seedrow">
                    <ClampNumberInput value={d.fitW} min={1} max={8192} onCommit={(v) => setF({ fitW: v })} />
                    <ClampNumberInput value={d.fitH} min={1} max={8192} onCommit={(v) => setF({ fitH: v })} />
                  </div>
                </>
              )}
              {d.mode === 'pixels' && (
                <>
                  <label className="mb-sc-flabel">总像素 {d.megapixels} MP</label>
                  <input className="mb-sc-range" type="range" min={0.25} max={16} step={0.25} value={d.megapixels} onChange={(e) => setF({ megapixels: Number(e.target.value) })} />
                </>
              )}
              {d.mode === 'exact' && (
                <label className="mb-sc-switch-row">
                  <input type="checkbox" checked={d.keepAspect} onChange={(e) => setF({ keepAspect: e.target.checked })} /> 等比（不拉伸，缩到框内）
                </label>
              )}
              <label className="mb-sc-switch-row">
                <input type="checkbox" checked={d.noUpscale} onChange={(e) => setF({ noUpscale: e.target.checked })} /> 仅缩小不放大
              </label>
              <label className="mb-sc-flabel">输出格式</label>
              <select className="mb-select" value={d.format} onChange={(e) => setF({ format: e.target.value as 'png' | 'jpeg' | 'webp' })}>
                <option value="png">PNG（无损）</option>
                <option value="jpeg">JPEG（更小）</option>
                <option value="webp">WebP</option>
              </select>
              {d.inW && d.outW ? (
                <div className="mb-sc-result-meta">
                  输入 {d.inW}×{d.inH} → 输出 {d.outW}×{d.outH}
                </div>
              ) : (
                <div className="mb-sc-note">连一个图片来源进来即自动按上面设定缩放。</div>
              )}
              <div className="mb-sc-note">预处理（非高清化）：解决「输入图过大模型不收」「图太小达不到效果」。</div>
            </div>
          );
        })()
      ) : sel.type === 'ratio' ? (
        <div className="mb-sc-form">
          <div className="mb-sc-note">
            尺寸分析：连一个图片来源进来，节点上显示最接近的常用比例 + 各档（1K/2K/4K）实际分辨率 + GPT Image 2 像素预算尺寸。纯参考，不输出。
          </div>
        </div>
      ) : (
        (() => {
          const acc = resultAccum[sel.id] ?? [];
          const allImages = acc.flatMap((r) => r.images);
          const allTexts = acc.flatMap((r) => r.texts ?? []);
          const last = acc[acc.length - 1];
          const metaParts: string[] = [];
          if (allImages.length) metaParts.push(`${allImages.length} 图`);
          if (allTexts.length) metaParts.push(`${allTexts.length} 文本`);
          return (
            <div className="mb-sc-form">
              {acc.length === 0 ? (
                <div className="mb-sc-note">
                  结果节点（统一集合）：连接 生成 / ComfyUI 的图或 LLM 的文本，每次运行结果都累积在这里（重启清空）。每项可在画布上拖出成节点，本节点也能继续往下连。
                </div>
              ) : (
                <>
                  <div className="mb-sc-result-meta">
                    {metaParts.join(' / ')} · {acc.length} 次生成
                    {last ? ` · 最近 ${providerLabel(last.provider)}` : ''}
                  </div>
                  {last?.error && <div className="mb-sc-result-err">{last.error}</div>}
                  {allImages.length > 0 && <ResultActionsBlock images={allImages} durationMs={last?.durationMs} />}
                  {allTexts.length > 0 && (
                    <>
                      <label className="mb-sc-flabel">文本输出（{allTexts.length}）</label>
                      <textarea className="mb-textarea mb-sc-itext" readOnly value={allTexts.join('\n\n')} />
                    </>
                  )}
                  <button
                    className="mb-btn mb-btn-sm mb-btn-ghost"
                    onClick={() => {
                      clearResult(sel.id);
                      update(sel.id, { result: null } as Partial<SmartNodeData>);
                    }}
                  >
                    清空累积结果
                  </button>
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
