import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSmartCanvasStore, useSmartResultStore, useSmartPreviewStore, absPosition } from '@/store/smartCanvasStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useSmartViewStore } from '@/store/smartViewStore';
import { runWithUpstream, cancelWork } from '@/lib/smartCanvasRunner';
import { toast } from '@/store/toastStore';
import { detectFamily } from '@shared/imageModelFamilies';
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
import { SegmentedControl, StepperInput, SearchableModelSelect, type SegOption } from './consoleControls';
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
  const toggleFloat = useSmartViewStore((s) => s.toggleInspectorFloat);
  const configs = useSettingsStore((s) => s.configs);
  const reloadSettings = useSettingsStore((s) => s.load);
  const navigate = useNavigate();

  const [moreParams, setMoreParams] = useState(false);

  const imageModels = useMemo(() => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const c of configs) {
      if (c.type !== 'image' || c.image_kind === 'comfyui') continue;
      for (const [name, actualId] of Object.entries(c.model_mapping ?? {})) {
        if (seen.has(name) || !(actualId && actualId.trim())) continue;
        seen.add(name);
        out.push(name);
      }
    }
    return out;
  }, [configs]);

  if (!node) return null;
  const d = node.data as unknown as WorkNodeData;
  const setF: SetF = (patch) => update(id, patch as Partial<SmartNodeData>);
  const editProps: EditProps = { onFocus: beginEdit, onBlur: commitEdit };

  const realModelId = (displayName: string): string => {
    for (const c of configs) {
      const v = c.model_mapping?.[displayName];
      if (c.type === 'image' && v) return v;
    }
    return displayName;
  };
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
    ...aspectPresets.map((a) => ({ value: a, label: a })),
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
      <NodeHeaderBar d={d} setF={setF} editProps={editProps} typeLabel={typeLabel} onPin={toggleFloat} onClose={deselectAll} />

      <div className="mb-np-bar">
        <BarField label="绘画模型" className="mb-np-bf-model">
          {d.provider === 'mengbi' ? (
            <SearchableModelSelect
              value={d.modelId}
              options={imageModels}
              badge={d.modelId ? family.label : undefined}
              onChange={(v) => setF({ modelId: v })}
              onManage={() => navigate('/settings')}
              onRefresh={() => void reloadSettings()}
            />
          ) : (
            <div className="mb-np-note">Local Mock：占位结果</div>
          )}
        </BarField>

        <BarField label="生成类型">
          <select className="mb-select" value={d.workType} onChange={(e) => setF({ workType: e.target.value as WorkType })}>
            {WORK_TYPES.map((w) => (
              <option key={w} value={w}>
                {WORK_TYPE_LABELS[w]}
                {REAL_WORK_TYPES.has(w) ? '' : '（模拟）'}
              </option>
            ))}
          </select>
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
          <select className="mb-select" value={d.provider} onChange={(e) => setF({ provider: e.target.value as WorkProvider })}>
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {PROVIDER_LABELS[p]}
              </option>
            ))}
          </select>
        </BarField>

        {real ? (
          <>
            <div className="mb-np-bar-sep" />
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
              ) : (
                <div className="mb-np-note">由 size 决定</div>
              )}
            </BarField>
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

        <BarField label="输出格式">
          <select className="mb-select" value={d.outputFormat ?? ''} onChange={(e) => setF({ outputFormat: e.target.value })}>
            <option value="">默认</option>
            <option value="png">PNG</option>
            <option value="jpeg">JPEG</option>
            <option value="webp">WebP</option>
          </select>
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
  onPin,
  onClose
}: {
  d: WorkNodeData;
  setF: SetF;
  editProps: EditProps;
  typeLabel: string;
  onPin: () => void;
  onClose: () => void;
}): JSX.Element {
  return (
    <div className="mb-np-header">
      <div className="mb-np-header-left">
        <span className="mb-np-header-ico">
          <ImageNodeIcon size={16} />
        </span>
        <span className="mb-np-header-title">{typeLabel}节点</span>
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
        <button className="mb-np-hbtn mb-np-hbtn-ico" title="固定到右侧（纵向属性面板）" onClick={onPin}>
          📌
        </button>
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
            <input className="mb-input" type="number" min={0} value={d.mockDelayMin ?? 200} onChange={(e) => setF({ mockDelayMin: Math.max(0, Number(e.target.value) || 0) })} />
          </div>
          <div className="mb-np-field">
            <label className="mb-np-flabel">随机延迟上限 ms</label>
            <input className="mb-input" type="number" min={0} value={d.mockDelayMax ?? 800} onChange={(e) => setF({ mockDelayMax: Math.max(0, Number(e.target.value) || 0) })} />
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
