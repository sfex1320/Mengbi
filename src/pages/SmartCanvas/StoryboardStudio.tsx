import { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { useSmartCanvasStore, useSmartTextStore } from '@/store/smartCanvasStore';
import { useSettingsStore } from '@/store/settingsStore';
import { computeUpstream, runStoryboardNode, rerunStoryboardShots, rerunStoryboardTransitions } from '@/lib/smartCanvasRunner';
import { toast } from '@/store/toastStore';
import type { StoryboardNodeData, StoryboardConstraints, SmartNodeData } from '@shared/smartCanvas';
import { StepperInput, SearchableModelSelect } from './nodePanel/consoleControls';
import { areaMenu, copyText, useBackdropClose } from './nodeArea';

/** 分镜工作台（弹窗）开关：哪个分镜节点在编辑（null = 不显示）。 */
interface StoryboardStudioState {
  nodeId: string | null;
  open: (nodeId: string) => void;
  close: () => void;
}
export const useStoryboardStudioStore = create<StoryboardStudioState>((set) => ({
  nodeId: null,
  open: (nodeId) => set({ nodeId }),
  close: () => set({ nodeId: null })
}));

const STATUS_TEXT: Record<string, string> = { idle: '待运行', running: '生成中…', success: '已完成', error: '失败' };

/** 固定约束的 7 项表单定义（key + 标签 + 占位示例）。 */
export const CONSTRAINT_FIELDS: Array<[keyof StoryboardConstraints, string, string]> = [
  ['character', '角色', '如：红裙黑发少女，约 10 岁'],
  ['style', '风格', '如：吉卜力水彩 / 赛博朋克电影感'],
  ['camera', '镜头语言', '如：35mm 电影镜头，浅景深'],
  ['palette', '色彩氛围', '如：暖黄低饱和，黄昏色调'],
  ['world', '世界观', '如：蒸汽朋克的浮空城市'],
  ['scene', '场景基调', '如：故事发生在海边小镇'],
  ['wardrobe', '服装外貌', '如：永远穿红色连衣裙 + 草帽']
];

/** 把一条文本在节点右侧建成提示词节点（多条按序往下排；xOffset 区分 分镜/转场 两列）。 */
function textToPromptNode(nodeId: string, text: string, idx: number, label: string, xOffset = 60): void {
  const st = useSmartCanvasStore.getState();
  const self = st.nodes.find((n) => n.id === nodeId);
  const t = text.trim();
  if (!t) {
    toast.error(`该${label}没有内容`);
    return;
  }
  const pos = self ? { x: self.position.x + (self.width ?? 320) + xOffset, y: self.position.y + idx * 150 } : undefined;
  const nid = st.addNode('prompt', pos);
  st.updateNodeData(nid, { text: t } as Partial<SmartNodeData>);
  toast.success(`${label} ${idx + 1} 已拉出为提示词节点`);
}

/**
 * 分镜工作台：左=设定（模型/数量/固定约束/素材/运行），右=产出（图析/故事/分镜列表/转场列表）。
 * 节点卡只留摘要，详细编辑与逐条交互都在这里。运行链路复用 runStoryboardNode 等，零改动。
 */
export function StoryboardStudio(): JSX.Element | null {
  const nodeId = useStoryboardStudioStore((s) => s.nodeId);
  const close = useStoryboardStudioStore((s) => s.close);
  const backdrop = useBackdropClose(close);
  const nodes = useSmartCanvasStore((s) => s.nodes);
  const edges = useSmartCanvasStore((s) => s.edges);
  const update = useSmartCanvasStore((s) => s.updateNodeData);
  const openText = useSmartTextStore((s) => s.open);
  const configs = useSettingsStore((s) => s.configs);

  const node = nodeId ? nodes.find((n) => n.id === nodeId) : undefined;
  const d = node?.type === 'storyboard' ? (node.data as unknown as StoryboardNodeData) : null;
  const up = useMemo(
    () => (nodeId && d ? computeUpstream(nodes, edges, nodeId) : { images: [], prompts: [], refs: [], videos: [], sizes: [] }),
    [nodes, edges, nodeId, d]
  );

  const models = useMemo(() => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const c of configs) {
      if (c.type !== 'text') continue;
      for (const n of Object.keys(c.model_mapping ?? {})) if (!seen.has(n)) { seen.add(n); out.push(n); }
    }
    return out;
  }, [configs]);

  useEffect(() => {
    if (!nodeId) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nodeId, close]);
  useEffect(() => {
    if (nodeId && !d) close();
  }, [nodeId, d, close]);

  if (!nodeId || !d) return null;
  const setF = (p: Partial<StoryboardNodeData>): void => update(nodeId, p as Partial<SmartNodeData>);
  const running = d.status === 'running';
  const shots = d.shots ?? [];
  const meta = d.shotsMeta ?? [];
  const transitions = d.transitions ?? [];
  const upFed = up.prompts.length > 0;
  const upImgs = up.images.length;
  const constraints = d.constraints ?? {};

  function setConstraint(key: keyof StoryboardConstraints, v: string): void {
    setF({ constraints: { ...constraints, [key]: v } });
  }
  function dragShot(e: React.DragEvent, text: string): void {
    e.dataTransfer.setData('application/mengbi-sc-node', JSON.stringify({ kind: 'prompt', text }));
    e.dataTransfer.effectAllowed = 'copy';
  }
  function shotMetaLine(i: number): string | null {
    const m = meta[i];
    if (!m || (!m.scene && !m.shot && !m.detail && !m.characters && !m.action)) return null;
    return [m.characters && `人物：${m.characters}`, m.shot && `镜头：${m.shot}`, m.detail && `细节：${m.detail}`].filter(Boolean).join(' · ');
  }

  return createPortal(
    <div className="mb-modal-backdrop" {...backdrop}>
      <div className="mb-modal mb-sc-studio mb-card" onClick={(e) => e.stopPropagation()}>
        <div className="mb-sc-studio-head">
          <h3>分镜工作台</h3>
          <span className={`mb-sc-status is-${d.status}`}>
            {running && <span className="mb-sc-spinner" aria-hidden />}
            {STATUS_TEXT[d.status] ?? d.status}
          </span>
          <span className="mb-sc-studio-hint">右上输出口=分镜提示词 · 右下输出口=镜头转场提示词</span>
          <button className="mb-sc-node-x" onClick={close} title="关闭（Esc）">
            ✕
          </button>
        </div>

        <div className="mb-sc-studio-body is-two">
          {/* ── 左：设定 ── */}
          <div className="mb-sc-studio-right">
            <label className="mb-sc-flabel">对话模型</label>
            <SearchableModelSelect
              value={d.modelId}
              options={models}
              placeholder="（选对话模型）"
              onChange={(v) => setF({ modelId: v })}
            />
            <div className="mb-sc-sb-row">
              <span className="mb-sc-sb-lbl">分镜数量</span>
              <StepperInput value={Math.max(2, Math.min(20, d.shotCount || 4))} min={2} max={20} onChange={(v) => setF({ shotCount: v })} />
            </div>

            <label className="mb-sc-flabel">固定约束（拼进每条分镜开头，保证整组一致）</label>
            <div className="mb-sc-sb-cons">
              {CONSTRAINT_FIELDS.map(([key, label, ph]) => (
                <div key={key} className="mb-sc-sb-consrow">
                  <span className="mb-sc-sb-lbl">{label}</span>
                  <input
                    className="mb-input"
                    value={(key === 'style' ? constraints.style ?? d.style : constraints[key]) ?? ''}
                    placeholder={ph}
                    onChange={(e) => setConstraint(key, e.target.value)}
                  />
                </div>
              ))}
            </div>

            {upImgs > 0 && (
              <>
                <div className="mb-sc-fromup is-fed">参考图 {upImgs} 张（运行时自动分析{upImgs > 3 ? '，最多取前 3 张' : ''}，并入故事素材）</div>
                <label className="mb-sc-flabel">分析模型（视觉，需支持识图）</label>
                <SearchableModelSelect
                  value={d.analysisModelId ?? ''}
                  options={[{ value: '', label: '同对话模型' }, ...models.map((m) => ({ value: m, label: m }))]}
                  placeholder="同对话模型"
                  onChange={(v) => setF({ analysisModelId: v })}
                />
              </>
            )}

            <label className="mb-sc-flabel">故事素材</label>
            {upFed ? (
              <div className="mb-sc-fromup is-fed" style={{ cursor: 'pointer' }} title="点击查看上游输入全文" onClick={() => openText(up.prompts.join('\n\n'), '故事素材（由上游输入）')}>
                由上游输入（{up.prompts.length} 条，与运行时自动合并）· 点击查看
              </div>
            ) : (
              <textarea
                className="mb-textarea"
                rows={5}
                value={d.input}
                placeholder={upImgs ? '可补充文字素材（与参考图分析合并）；留空则纯按参考图编故事' : '输入一篇故事或一个短句（运行后先扩成完整故事，再按数量拆分镜）'}
                onChange={(e) => setF({ input: e.target.value })}
              />
            )}

            <div className="mb-sc-sb-runrow">
              <button className="mb-btn mb-btn-sm mb-btn-primary" disabled={running || !d.modelId} onClick={() => void runStoryboardNode(nodeId)}>
                {running ? '生成中…' : shots.length ? '重新生成分镜' : '生成分镜'}
              </button>
              {!!d.story?.trim() && !running && (
                <button className="mb-btn mb-btn-sm mb-btn-ghost" title="不重新生成故事，只用已有故事重新拆分镜（省一次故事调用）" onClick={() => void rerunStoryboardShots(nodeId)}>
                  重拆分镜
                </button>
              )}
              {shots.length > 1 && !running && (
                <button className="mb-btn mb-btn-sm mb-btn-ghost" title="只重新生成分镜之间的转场动态，不动分镜" onClick={() => void rerunStoryboardTransitions(nodeId)}>
                  {transitions.length ? '重生转场' : '生成转场'}
                </button>
              )}
            </div>
            {d.error && <div className="mb-sc-result-err">{d.error}</div>}
            {!d.error && running && d.logs?.length ? <div className="mb-sc-work-dur">{d.logs[d.logs.length - 1]}</div> : null}
          </div>

          {/* ── 右：产出 ── */}
          <div className="mb-sc-studio-right">
            {d.analysis?.trim() && (
              <div className="mb-sc-sb-story" title="参考图分析 · 点击放大" onClick={() => openText(d.analysis ?? '', '参考图分析')}>
                <b>图析：</b>
                {d.analysis}
              </div>
            )}
            {d.story?.trim() && (
              <div
                className="mb-sc-sb-story"
                title="完整故事 · 点击放大 · 右键复制"
                onClick={() => openText(d.story ?? '', '完整故事')}
                onContextMenu={(e) => areaMenu(e, [{ label: '复制完整故事', onClick: () => copyText(d.story ?? '') }])}
              >
                <b>故事：</b>
                {d.story}
              </div>
            )}

            {shots.length > 0 ? (
              <div className="mb-sc-sb-shots">
                <div className="mb-sc-sb-head">
                  <span>分镜（{shots.length}）· 右上输出口按序喂下游</span>
                  <button className="mb-btn mb-btn-sm mb-btn-ghost" title="把全部分镜各自拉出成提示词节点" onClick={() => shots.forEach((s, i) => textToPromptNode(nodeId, s, i, '分镜'))}>
                    全部 → 提示词节点
                  </button>
                </div>
                {shots.map((s, i) => (
                  <div
                    key={i}
                    className="mb-sc-sb-shot"
                    draggable
                    title="点击放大 · 拖到画布空白成提示词节点 · 右键更多"
                    onDragStart={(e) => dragShot(e, s)}
                    onClick={() => openText(s, `分镜 ${i + 1}`)}
                    onContextMenu={(e) =>
                      areaMenu(e, [
                        { label: '复制此分镜', onClick: () => copyText(s) },
                        { label: '→ 提示词节点', onClick: () => textToPromptNode(nodeId, s, i, '分镜') },
                        { label: '放大查看', onClick: () => openText(s, `分镜 ${i + 1}`) }
                      ])
                    }
                  >
                    <span className="mb-sc-sb-no">{i + 1}</span>
                    <span className="mb-sc-sb-text">
                      {meta[i]?.scene?.trim() || s}
                      {shotMetaLine(i) && <span className="mb-sc-sb-meta">{shotMetaLine(i)}</span>}
                    </span>
                    <button
                      className="mb-btn mb-btn-sm mb-btn-ghost mb-sc-sb-pull"
                      title="拉出成提示词节点"
                      onClick={(e) => {
                        e.stopPropagation();
                        textToPromptNode(nodeId, s, i, '分镜');
                      }}
                    >
                      →词
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mb-sc-empty">还没有分镜。左侧填好素材点「生成分镜」。</div>
            )}

            {shots.length > 1 && (
              <div className="mb-sc-sb-shots">
                <div className="mb-sc-sb-head">
                  <span>镜头转场（{transitions.length || `0/${shots.length - 1}`}）· 右下输出口喂下游</span>
                </div>
                {transitions.map((s, i) => (
                  <div
                    key={i}
                    className="mb-sc-sb-shot is-trans"
                    draggable
                    title="分镜之间的转场动态 · 点击放大 · 拖出成提示词节点 · 右键更多"
                    onDragStart={(e) => dragShot(e, s)}
                    onClick={() => openText(s, `转场 ${i + 1}（分镜 ${i + 1} → ${i + 2}）`)}
                    onContextMenu={(e) =>
                      areaMenu(e, [
                        { label: '复制此转场', onClick: () => copyText(s) },
                        { label: '→ 提示词节点', onClick: () => textToPromptNode(nodeId, s, i, '转场', 380) },
                        { label: '放大查看', onClick: () => openText(s, `转场 ${i + 1}（分镜 ${i + 1} → ${i + 2}）`) }
                      ])
                    }
                  >
                    <span className="mb-sc-sb-no">
                      {i + 1}→{i + 2}
                    </span>
                    <span className="mb-sc-sb-text">{s}</span>
                    <button
                      className="mb-btn mb-btn-sm mb-btn-ghost mb-sc-sb-pull"
                      title="拉出成提示词节点"
                      onClick={(e) => {
                        e.stopPropagation();
                        textToPromptNode(nodeId, s, i, '转场', 380);
                      }}
                    >
                      →词
                    </button>
                  </div>
                ))}
                {!transitions.length && <div className="mb-sc-note">转场=相邻分镜间的镜头运动/衔接/场景过渡（可喂视频节点串联成片）。左侧「生成转场」。</div>}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
