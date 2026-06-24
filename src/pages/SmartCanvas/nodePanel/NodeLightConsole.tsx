import { useMemo } from 'react';
import { useSmartCanvasStore, absPosition } from '@/store/smartCanvasStore';
import { buildLightPrompt } from '@/lib/lightPrompt';
import {
  LIGHT_OCCLUSION_LABELS,
  LIGHT_EFFECT_LABELS,
  LIGHT_SOURCE_LABELS,
  LIGHT_POSITION_PRESETS,
  type LightNodeData,
  type LightOcclusion,
  type LightEffect,
  type LightSourceType,
  type SmartNodeData
} from '@shared/smartCanvas';
import { ResizablePanelWrapper } from './ResizablePanelWrapper';
import { IconChoiceGrid, type IconChoiceOption } from '../nodeControls';
import { optionIcon } from '../optionIcons';
import { copyText, makePromptNodeFrom } from '../nodeArea';
import './nodePanel.css';

const STORAGE_KEY = 'mengbi.smartCanvas.lightConsole.geom.v1';

const OCCLUSIONS = Object.keys(LIGHT_OCCLUSION_LABELS) as LightOcclusion[];
const EFFECTS = Object.keys(LIGHT_EFFECT_LABELS) as LightEffect[];
const SOURCES = Object.keys(LIGHT_SOURCE_LABELS) as LightSourceType[];
const OCC_OPTS: IconChoiceOption<LightOcclusion>[] = OCCLUSIONS.map((v) => ({ value: v, label: LIGHT_OCCLUSION_LABELS[v], icon: optionIcon('occlusion', v) }));
const EFFECT_OPTS: IconChoiceOption<LightEffect>[] = EFFECTS.map((v) => ({ value: v, label: LIGHT_EFFECT_LABELS[v], icon: optionIcon('effect', v) }));
const SOURCE_OPTS: IconChoiceOption<LightSourceType>[] = SOURCES.map((v) => ({ value: v, label: LIGHT_SOURCE_LABELS[v], icon: optionIcon('lightSource', v) }));
const POS_OPTS: IconChoiceOption<string>[] = LIGHT_POSITION_PRESETS.map((p) => ({
  value: p.key,
  label: p.label,
  icon: optionIcon('lightPosition', p.key),
  title: `${p.label}：方位 ${p.azimuth}° / 高度 ${p.elevation}°`
}));

/** 光源节点高级设置弹窗（基础调整在节点卡上：拖光点 + 强度 + 色温；高级在这里）。 */
export function NodeLightConsole(): JSX.Element | null {
  const sel = useSmartCanvasStore((s) => s.nodes.find((x) => x.selected && x.type === 'light') ?? null);
  if (!sel) return null;
  const w = sel.measured?.width ?? (typeof sel.width === 'number' ? sel.width : 264);
  const h = sel.measured?.height ?? (typeof sel.height === 'number' ? sel.height : 320);
  const abs = absPosition(sel, useSmartCanvasStore.getState().nodes);
  const anchor = { x: abs.x, y: abs.y, w, h };
  return (
    <ResizablePanelWrapper storageKey={STORAGE_KEY} anchor={anchor} autoSize className="mb-np-console">
      <LightConsoleInner key={sel.id} id={sel.id} />
    </ResizablePanelWrapper>
  );
}

function LightConsoleInner({ id }: { id: string }): JSX.Element | null {
  const node = useSmartCanvasStore((s) => s.nodes.find((n) => n.id === id));
  const update = useSmartCanvasStore((s) => s.updateNodeData);
  const deselectAll = useSmartCanvasStore((s) => s.deselectAll);
  if (!node) return null;
  const d = node.data as unknown as LightNodeData;

  function patch(p: Partial<LightNodeData>): void {
    const next = { ...d, ...p };
    next.generatedPrompt = buildLightPrompt(next);
    update(id, next as Partial<SmartNodeData>);
  }
  const posKey = useMemo(
    () => LIGHT_POSITION_PRESETS.find((p) => p.azimuth === d.azimuth && p.elevation === d.elevation)?.key ?? '',
    [d.azimuth, d.elevation]
  );

  return (
    <div className="mb-np-root">
      <div className="mb-np-header">
        <div className="mb-np-header-left">
          <span className="mb-np-header-ico">💡</span>
          <span className="mb-np-header-title">光源节点</span>
          <span className="mb-np-header-dot">·</span>
          <span className="mb-np-header-sub">高级光照</span>
        </div>
        <div className="mb-np-header-right">
          <button className="mb-np-hbtn mb-np-hbtn-ico" title="关闭（取消选中）" onClick={deselectAll}>✕</button>
        </div>
      </div>

      <div className="mb-np-cam">
        <div className="mb-np-cam-field">
          <label className="mb-np-flabel">光位（一键设方向 / 高度，可在节点上拖光点微调）</label>
          <IconChoiceGrid<string>
            value={posKey}
            options={POS_OPTS}
            onChange={(k) => {
              const p = LIGHT_POSITION_PRESETS.find((x) => x.key === k);
              if (p) patch({ azimuth: p.azimuth, elevation: p.elevation, posX: undefined, posY: undefined });
            }}
          />
        </div>
        <div className="mb-np-cam-field">
          <label className="mb-np-flabel">光源类型（这束光从何而来）</label>
          <IconChoiceGrid<LightSourceType> value={d.sourceType ?? 'none'} options={SOURCE_OPTS} onChange={(v) => patch({ sourceType: v })} />
        </div>
        <div className="mb-np-cam-field">
          <label className="mb-np-flabel">遮挡（光线穿过什么）</label>
          <IconChoiceGrid<LightOcclusion> value={d.occlusion} options={OCC_OPTS} onChange={(v) => patch({ occlusion: v })} />
        </div>
        <div className="mb-np-cam-field">
          <label className="mb-np-flabel">光效</label>
          <IconChoiceGrid<LightEffect> value={d.effect} options={EFFECT_OPTS} onChange={(v) => patch({ effect: v })} />
        </div>

        <div className="mb-np-cam-actions">
          <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={() => patch({ occlusion: 'none', effect: 'none', sourceType: 'none' })}>
            清空高级
          </button>
          <label className="mb-sc-switch-row">
            <input type="checkbox" checked={d.appendConsistencyInstruction} onChange={(e) => patch({ appendConsistencyInstruction: e.target.checked })} />
            一致性约束（只改光照）
          </label>
        </div>

        <div className="mb-np-cam-prompt-wrap">
          <label className="mb-np-flabel">光照提示词（实时输出给下游）</label>
          <div className="mb-np-cam-prompt">{d.generatedPrompt}</div>
          <div className="mb-np-cam-prompt-actions">
            <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={() => copyText(d.generatedPrompt)}>复制</button>
            <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={() => makePromptNodeFrom(id, d.generatedPrompt)}>→ 提示词节点</button>
          </div>
        </div>
      </div>
    </div>
  );
}
