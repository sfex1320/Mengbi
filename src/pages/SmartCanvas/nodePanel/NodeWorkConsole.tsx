import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSmartCanvasStore, useSmartResultStore, useSmartPreviewStore, absPosition } from '@/store/smartCanvasStore';
import { useSettingsStore } from '@/store/settingsStore';
import { runWithUpstream, cancelWork, computeUpstream } from '@/lib/smartCanvasRunner';
import { toast } from '@/store/toastStore';
import { detectFamily } from '@shared/imageModelFamilies';
import { modelRefValue, resolveModelRef, parseModelRef } from '@/lib/modelMapping';
import {
  WORK_TYPE_LABELS,
  RUN_MODE_LABELS,
  PROVIDER_LABELS,
  REAL_WORK_TYPES,
  RUN_STATUS_LABELS,
  type WorkType,
  type RunMode,
  type WorkProvider,
  type WorkNodeData,
  type SmartNodeData
} from '@shared/smartCanvas';
import { ImageNodeIcon } from '../icons';
import { ResizablePanelWrapper } from './ResizablePanelWrapper';
import { SegmentedControl, StepperInput, ModelDropdownButton, ClampNumberInput, type SegOption } from './consoleControls';
import { AspectGlyph } from '../nodeControls';
import { CustomSelect } from '@/components/CustomSelect';
import './nodePanel.css';

const STORAGE_KEY = 'mengbi.smartCanvas.workConsole.geom.v3';
const WORK_TYPES = Object.keys(WORK_TYPE_LABELS) as WorkType[];
const RUN_MODES = Object.keys(RUN_MODE_LABELS) as RunMode[];
const PROVIDERS = Object.keys(PROVIDER_LABELS) as WorkProvider[];
const IMG2IMG = new Set<WorkType>(['image-edit', 'style-transfer', 'outpainting']);
/** 运行方式短标签（去掉「运行」二字，覆盖全部 RunMode）。 */
const runModeShort = (m: RunMode): string => RUN_MODE_LABELS[m].replace('运行', '');
const TIER_PX: Record<string, string> = { '1K': '1024', '2K': '2048', '4K': '4096' };

type EditProps = { onFocus: () => void; onBlur: () => void };
type SetF = (patch: Partial<WorkNodeData>) => void;

/** 智能画布「图片生成节点」横向控制台（长条形）。仅当选中节点为 work 时由 CanvasWorkspace 渲染（浮动模式）。 */
export function NodeWorkConsole(): JSX.Element | null {
  const sel = useSmartCanvasStore((s) => s.nodes.find((x) => x.selected && x.type === 'work') ?? null);
  if (!sel) return null;
  const w = sel.measured?.width ?? (typeof sel.width === 'number' ? sel.width : 220);
  const h = sel.measured?.height ?? (typeof sel.height === 'number' ? sel.height : 120);
  const abs = absPosition(sel, useSmartCanvasStore.getState().nodes);
  const anchor = { x: abs.x, y: abs.y, w, h };
  return (
    <ResizablePanelWrapper storageKey={STORAGE_KEY} anchor={anchor} autoSize className="mb-np-console">
      <WorkConsoleInner key={sel.id} id={sel.id} />
    </ResizablePanelWrapper>
  );
}

/** 一个竖向的「标签 + 控件」字段块，多个横向排成长条。 */
function BarField({ label, className, children }: { label: string; className?: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className={`mb-np-bf ${className ?? ''}`}>
      <label className="mb-np-flabel">{label}</label>
      {children}
    </div>
  );
}
function StatusPill({ status }: { status: WorkNodeData['status'] }): JSX.Element {
  return (
    <span className={`mb-np-status is-${status}`}>
      <i className="mb-np-status-dot" />
      {RUN_STATUS_LABELS[status]}
    </span>
  );
}

function WorkConsoleInner({ id }: { id: string }): JSX.Element | null {
  const node = useSmartCanvasStore((s) => s.nodes.find((n) => n.id === id));
  const update = useSmartCanvasStore((s) => s.updateNodeData);
  const beginEdit = useSmartCanvasStore((s) => s.beginEdit);
  const commitEdit = useSmartCanvasStore((s) => s.commitEdit);
  const deselectAll = useSmartCanvasStore((s) => s.deselectAll);
  const configs = useSettingsStore((s) => s.configs);
  const nodes = useSmartCanvasStore((s) => s.nodes);
  const edges = useSmartCanvasStore((s) => s.edges);
  const reloadSettings = useSettingsStore((s) => s.load);
  const navigate = useNavigate();

  const [moreParams, setMoreParams] = useState(false);

  const imageModels = useMemo(() => {
    const out: { name: string; provider: string; ref: string }[] = [];
    const seen = new Set<string>();
    for (const c of configs) {
      if (c.type !== 'image' || c.image_kind === 'comfyui') continue;
      const prov = (c.provider_name ?? '').trim();
      for (const [name, actualId] of Object.entries(c.model_mapping ?? {})) {
        if (!(actualId && actualId.trim())) continue;
        const ref = modelRefValue(prov, name);
        if (seen.has(ref)) continue;
        seen.add(ref);
        out.push({ name, provider: prov, ref });
      }
    }
    return out;
  }, [configs]);

  const up = useMemo(() => computeUpstream(nodes, edges, id), [nodes, edges, id]);

  if (!node) return null;
  const d = node.data as unknown as WorkNodeData;
  const upSize = up.sizes[0];
  const upEmit = upSize?.emit ?? 'both';
  const aspectFed = !!upSize && upEmit !== 'resolution';
  const tierFed = !!upSize && upEmit !== 'aspect';
  const setF: SetF = (patch) => update(id, patch as Partial<SmartNodeData>);
  const editProps: EditProps = { onFocus: beginEdit, onBlur: commitEdit };

  // 复合标识（中转站 / 名）或旧裸名 → 真实模型 ID（detectFamily 判系列；查不到回退 name 段）
  const realModelId = (ref: string): string =>
    resolveModelRef(configs, 'image', ref)?.actualId ?? parseModelRef(ref).name;
  const family = detectFamily(realModelId(d.modelId || ''));
  const typeLabel = WORK_TYPE_LABELS[d.workType];
  const real = d.provider === 'mengbi' && REAL_WORK_TYPES.has(d.workType);
  const running = d.status === 'running';
  const hasAdv = IMG2IMG.has(d.workType) || d.provider === 'mock';

  // 比例
  const aspectPresets = family.supportedAspects;
  const aspectIsCustom = !!d.aspect && !aspectPresets.includes(d.aspect);
  const aspectOpts: SegOption<string>[] = [
    { value: '', label: '自动' },
    ...aspectPresets.map((a) => ({ value: a, label: a, icon: <AspectGlyph ratio={a} size={14} /> })),
    { value: '__custom__', label: '自定义' }
  ];
  const aspectCur = !d.aspect ? '' : aspectPresets.includes(d.aspect) ? d.aspect : '__custom__';
  // 分辨率
  const tierPresets = family.supportedTiers as readonly string[];
  const tierIsCustom = !!d.imageSize && !tierPresets.includes(d.imageSize);
  const tierOpts: SegOption<string>[] = [
    { value: '', label: '默认' },
    ...tierPresets.map((t) => ({ value: t, label: t, sub: TIER_PX[t] })),
    { value: '__custom__', label: '自定义' }
  ];
  const tierCur = !d.imageSize ? '' : tierPresets.includes(d.imageSize) ? d.imageSize : '__custom__';

  const previewOutput = (): void => {
    const arr = useSmartResultStore.getState().accum[id] ?? [];
    const imgs = arr[arr.length - 1]?.images;
    const src = (imgs && imgs.length ? imgs[imgs.length - 1] : undefined) ?? d.result?.images?.[0];
    if (src) useSmartPreviewStore.getState().open(src);
    else toast.info('暂无输出', '先运行此节点');
  };
  const clearOutput = (): void => {
    useSmartResultStore.getState().clear(id);
    setF({ result: null, error: null, logs: [] });
    toast.success('已清除输出');
  };

  return (
    <div className="mb-np-root">
      <NodeHeaderBar d={d} setF={setF} editProps={editProps} typeLabel={typeLabel} onClose={deselectAll} />

      <div className="mb-np-bar">
        <BarField label="绘画模型" className="mb-np-bf-model">
          {d.provider === 'mengbi' ? (
            <>
              <ModelDropdownButton value={d.modelId} options={imageModels} onChange={(v) => setF({ modelId: v })} />
              <div className="mb-np-modelgrid-foot">
                {d.modelId ? <span className="mb-np-modelgrid-fam">{family.label}</span> : null}
                <button type="button" className="mb-np-modelgrid-link" onClick={() => navigate('/settings')}>
                  模型管理
                </button>
                <button type="button" className="mb-np-modelgrid-link" onClick={() => void reloadSettings()}>
                  刷新
                </button>
              </div>
            </>
          ) : (
            <div className="mb-np-note">Local Mock：占位结果</div>
          )}
        </BarField>

        <BarField label="生成类型">
          <CustomSelect<WorkType>
            value={d.workType}
            options={WORK_TYPES.map((w) => ({ value: w, label: `${WORK_TYPE_LABELS[w]}${REAL_WORK_TYPES.has(w) ? '' : '（模拟）'}` }))}
            onChange={(v) => setF({ workType: v })}
          />
        </BarField>

        <BarField label="运行方式">
          <SegmentedControl
            value={d.runMode}
            size="sm"
            options={RUN_MODES.map((m) => ({ value: m, label: runModeShort(m), title: RUN_MODE_LABELS[m] }))}
            onChange={(v) => setF({ runMode: v })}
          />
        </BarField>

        <BarField label="执行后端">
          <CustomSelect<WorkProvider>
            value={d.provider}
            options={PROVIDERS.map((p) => ({ value: p, label: PROVIDER_LABELS[p] }))}
            onChange={(v) => setF({ provider: v })}
          />
        </BarField>

        {real ? (
          <>
            <div className="mb-np-bar-sep" />
            {aspectFed ? (
              <BarField label={`比例（${family.label}）`}>
                <div className="mb-sc-fromup is-fed">由上游尺寸来源输入（{upSize?.aspect}）</div>
              </BarField>
            ) : (
              <BarField label={`比例（${family.label}）`}>
                <SegmentedControl
                  value={aspectCur}
                  size="sm"
                  options={aspectOpts}
                  onChange={(v) => {
                    if (v === '__custom__') {
                      if (!aspectIsCustom) setF({ aspect: '16:10' });
                    } else setF({ aspect: v });
                  }}
                />
                {aspectIsCustom ? (
                  <input className="mb-input mb-np-custom" value={d.aspect ?? ''} placeholder="如 16:10" onChange={(e) => setF({ aspect: e.target.value })} />
                ) : null}
              </BarField>
            )}
            {tierFed ? (
              <BarField label="分辨率">
                <div className="mb-sc-fromup is-fed">由上游尺寸来源输入（{upSize?.width}×{upSize?.height}）</div>
              </BarField>
            ) : (
              <BarField label="分辨率">
                {tierPresets.length > 0 ? (
                  <>
                    <SegmentedControl
                      value={tierCur}
                      size="sm"
                      options={tierOpts}
                      onChange={(v) => {
                        if (v === '__custom__') {
                          if (!tierIsCustom) setF({ imageSize: '3K' });
                        } else setF({ imageSize: v });
                      }}
                    />
                    {tierIsCustom ? (
                      <input className="mb-input mb-np-custom" value={d.imageSize ?? ''} placeholder="如 3K" onChange={(e) => setF({ imageSize: e.target.value })} />
                    ) : null}
                  </>
                ) : null}
              </BarField>
            )}
            {family.supportsQuality ? (
              <BarField label="质量">
                <SegmentedControl
                  value={d.quality ?? ''}
                  size="sm"
                  options={[
                    { value: '', label: '默认' },
                    { value: 'standard', label: '标准' },
                    { value: 'high', label: '高质量' }
                  ]}
                  onChange={(v) => setF({ quality: v })}
                />
              </BarField>
            ) : null}
          </>
        ) : null}

        <div className="mb-np-bar-sep" />

        <BarField label="Seed（种子）" className="mb-np-bf-seed">
          <div className="mb-np-seedrow">
            <input
              className="mb-input"
              type="number"
              value={d.seed ?? ''}
              placeholder="随机"
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => {
                const v = e.target.value.trim();
                const num = Number(v);
                setF({ seed: v === '' || Number.isNaN(num) ? null : Math.trunc(num) });
              }}
            />
            <button className="mb-btn mb-btn-sm" type="button" title="随机种子" onClick={() => setF({ seed: Math.floor(Math.random() * 2_000_000_000) })}>
              🎲
            </button>
            <button className="mb-btn mb-btn-sm mb-btn-ghost" type="button" title="清空（随机）" onClick={() => setF({ seed: null })}>
              ✕
            </button>
          </div>
        </BarField>

        <BarField label="张数">
          <StepperInput value={d.n} min={1} max={4} onChange={(v) => setF({ n: v })} />
        </BarField>

        <BarField label="多条提示词">
          <SegmentedControl
            value={d.promptConcurrency ? 'parallel' : 'serial'}
            size="sm"
            options={[
              { value: 'serial', label: '顺序', title: '多条上游提示词按连入顺序逐条生图（中转站不支持并发时用）' },
              { value: 'parallel', label: '并发', title: '多条上游提示词同时提交（中转站支持并发时更快，结果仍按顺序排列）' }
            ]}
            onChange={(v) => setF({ promptConcurrency: v === 'parallel' })}
          />
        </BarField>

        {d.workType !== 'image-generation' && (
          <BarField label="多张输入图">
            <SegmentedControl
              value={d.imageEach ? 'each' : 'merge'}
              size="sm"
              options={[
                { value: 'merge', label: '合并参考', title: '多张上游图作为一组参考图，喂给一次生成（多图融合/参考）' },
                { value: 'each', label: '逐张各跑', title: '每张上游图各跑一次生成（N 张 = N 次结果，批量改图常用）。词数==图数时按序配对。' }
              ]}
              onChange={(v) => setF({ imageEach: v === 'each' })}
            />
          </BarField>
        )}

        <BarField label="输出格式（暂未生效）">
          <CustomSelect
            value={d.outputFormat ?? ''}
            options={[
              { value: '', label: '默认' },
              { value: 'png', label: 'PNG' },
              { value: 'jpeg', label: 'JPEG' },
              { value: 'webp', label: 'WebP' }
            ]}
            onChange={(v) => setF({ outputFormat: v })}
          />
        </BarField>

        {hasAdv ? (
          <BarField label="高级">
            <button className="mb-np-more" onClick={() => setMoreParams(!moreParams)}>
              <span>{moreParams ? '收起' : '更多'}</span>
              <span>{moreParams ? '∧' : '▾'}</span>
            </button>
          </BarField>
        ) : null}

        <div className="mb-np-bar-sep" />

        <div className="mb-np-bar-run">
          <button className="mb-np-run" disabled={running} onClick={() => void runWithUpstream(id)}>
            ▶ {running ? '运行中…' : '运行'}
          </button>
          {/* 预览 / 清除 / 状态 排在运行按钮右侧，一行铺开 */}
          <div className="mb-np-run-side">
            {running ? (
              <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={() => cancelWork(id)} title="取消并释放队列槽">
                ■ 取消
              </button>
            ) : null}
            <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={previewOutput}>◳ 预览</button>
            <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={clearOutput}>🗑 清除</button>
            <StatusPill status={d.status} />
          </div>
        </div>
      </div>

      {moreParams ? (
        <div className="mb-np-bar-more">
          <AdvParams d={d} setF={setF} />
        </div>
      ) : null}
      {d.provider === 'mengbi' && !real ? <div className="mb-np-note mb-np-bar-note">该类型暂无真实接口，运行走模拟。</div> : null}
      {d.error ? <div className="mb-np-adv-err mb-np-bar-note">{d.error}</div> : null}
    </div>
  );
}

// ───────────────────────── 顶部标题栏 ─────────────────────────
function NodeHeaderBar({
  d,
  setF,
  editProps,
  typeLabel,
  onClose
}: {
  d: WorkNodeData;
  setF: SetF;
  editProps: EditProps;
  typeLabel: string;
  onClose: () => void;
}): JSX.Element {
  return (
    <div className="mb-np-header">
      <div className="mb-np-header-left">
        <span className="mb-np-header-ico">
          <ImageNodeIcon size={16} />
        </span>
        <span className="mb-np-header-title">生图节点</span>
        <span className="mb-np-header-dot">·</span>
        <span className="mb-np-header-sub">{typeLabel}</span>
        <span className="mb-np-header-dot">·</span>
        <input
          className="mb-np-header-name"
          value={d.name ?? ''}
          placeholder="未命名"
          {...editProps}
          onChange={(e) => setF({ name: e.target.value })}
          title="节点名称（点击编辑）"
        />
      </div>
      <div className="mb-np-header-right">
        <button className="mb-np-hbtn mb-np-hbtn-ico" title="关闭（取消选中）" onClick={onClose}>
          ✕
        </button>
      </div>
    </div>
  );
}

// ───────────────────────── 高级参数（更多展开）─────────────────────────
function AdvParams({ d, setF }: { d: WorkNodeData; setF: SetF }): JSX.Element {
  return (
    <div className="mb-np-adv-params">
      {IMG2IMG.has(d.workType) ? (
        <div className="mb-np-field mb-np-field-full">
          <label className="mb-np-flabel">绘画强度 {Math.round((d.strength ?? 0.6) * 100)}%</label>
          <input className="mb-np-range" type="range" min={0} max={1} step={0.05} value={d.strength ?? 0.6} onChange={(e) => setF({ strength: Number(e.target.value) })} />
        </div>
      ) : null}
      {d.provider === 'mock' ? (
        <>
          <div className="mb-np-field">
            <label className="mb-np-flabel">随机延迟下限 ms</label>
            <ClampNumberInput min={0} max={600000} value={d.mockDelayMin ?? 200} onCommit={(v) => setF({ mockDelayMin: v })} />
          </div>
          <div className="mb-np-field">
            <label className="mb-np-flabel">随机延迟上限 ms</label>
            <ClampNumberInput min={0} max={600000} value={d.mockDelayMax ?? 800} onCommit={(v) => setF({ mockDelayMax: v })} />
          </div>
          <div className="mb-np-field mb-np-field-full">
            <label className="mb-np-flabel">随机失败概率 {Math.round((d.mockErrorRate ?? 0) * 100)}%</label>
            <input className="mb-np-range" type="range" min={0} max={1} step={0.05} value={d.mockErrorRate ?? 0} onChange={(e) => setF({ mockErrorRate: Number(e.target.value) })} />
          </div>
        </>
      ) : null}
    </div>
  );
}
