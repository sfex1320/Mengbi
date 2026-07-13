import { useMemo, useRef } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { useSmartCanvasStore, useSmartTextStore } from '@/store/smartCanvasStore';
import { useSettingsStore } from '@/store/settingsStore';
import { computeUpstream, runStoryboardNode } from '@/lib/smartCanvasRunner';
import { listMappedModels } from '@/lib/modelMapping';
import { resolveTimelinePlan, DURATION_PRESETS, DURATION_MIN, DURATION_MAX, SEC_PER_SHOT_MIN, SEC_PER_SHOT_MAX } from '@/lib/storyboardPrompt';
import type { StoryboardNodeData, SmartNodeData } from '@shared/smartCanvas';
import { NodeShell } from './NodeShell';
import { StepperInput, ClampNumberInput, ModelDropdownButton, type ModelGridItem } from '../nodePanel/consoleControls';
import { CopyButton, ToPromptButton, copyText, areaMenu, makePromptNodeFrom, useFitNodeToContent } from '../nodeArea';

const STATUS_TEXT: Record<string, string> = { idle: '待运行', running: '生成中…', success: '已完成', error: '失败' };

/** 当前方案的对话(text)模型（带中转站前缀区分同名模型）。 */
function useTextModelItems(): ModelGridItem[] {
  const configs = useSettingsStore((s) => s.configs);
  const activePlanId = useSettingsStore((s) => s.activePlanId);
  return useMemo(
    () =>
      listMappedModels(configs, activePlanId, 'text')
        .filter((m) => m.usable)
        .map((m) => ({ name: m.name, provider: m.providerName, ref: m.ref })),
    [configs, activePlanId]
  );
}

/**
 * 智能分镜节点（2026-07-12 重做）：上游传入 角色描述 + 简短故事（文本）→ 一次 LLM 调用
 * → **一整段连续**的视频分镜提示词（内嵌「第X-Y秒：…」时间轴，写清 场景/人物动作/物体变化/镜头运动，
 * 不分段不分节）→ 单输出口直接喂下游视频节点。
 */
export function StoryboardNode({ id, data }: NodeProps): JSX.Element {
  const update = useSmartCanvasStore((s) => s.updateNodeData);
  const remove = useSmartCanvasStore((s) => s.removeNode);
  const nodes = useSmartCanvasStore((s) => s.nodes);
  const edges = useSmartCanvasStore((s) => s.edges);
  const openText = useSmartTextStore((s) => s.open);
  const d = data as unknown as StoryboardNodeData;
  const models = useTextModelItems();
  const fileRef = useRef<HTMLInputElement>(null);
  const setF = (p: Partial<StoryboardNodeData>): void => update(id, p as Partial<SmartNodeData>);
  const up = useMemo(() => computeUpstream(nodes, edges, id), [nodes, edges, id]);
  const running = d.status === 'running';
  const upFed = up.prompts.length > 0;
  const hasUpImg = up.images.length > 0;
  const hasLocal = !!d.inputImage?.url;
  const plan = resolveTimelinePlan(d);
  const result = (d.resultText ?? '').trim();

  function loadFile(file?: File | null): void {
    if (!file || !file.type.startsWith('image/')) return;
    const r = new FileReader();
    r.onload = () => setF({ inputImage: { url: String(r.result), name: file.name } });
    r.readAsDataURL(file);
  }

  // 节点高度贴合真实内容（fitwrap 实测，选项变化/结果/报错都自动跟随；手动 > 自适应）
  const fitRef = useRef<HTMLDivElement>(null);
  useFitNodeToContent(id, fitRef, 52, 720);

  return (
    <>
      <NodeResizer isVisible minWidth={250} minHeight={220} />
      <NodeShell
        title="智能分镜"
        accent="is-storyboard"
        inputs
        outputs
        fill
        onDelete={() => remove(id)}
        headRight={
          <span className={`mb-sc-status is-${d.status}`}>
            {running && <span className="mb-sc-spinner" aria-hidden />}
            {STATUS_TEXT[d.status] ?? d.status}
          </span>
        }
      >
        <div className="mb-sc-fitwrap nowheel" ref={fitRef}>
        <div className="mb-sc-revctl nodrag">
          <ModelDropdownButton
            value={d.modelId}
            options={models}
            placeholder="（选对话模型）"
            emptyHint="当前方案没有对话模型，去设置页配置"
            onChange={(v) => setF({ modelId: v })}
          />

          {/* 视频总时长：预设 chips + 自定义秒数（时间轴按它铺） */}
          <div className="mb-sc-sb-row">
            <span className="mb-sc-sb-lbl">总时长</span>
            <div className="mb-sc-sb-chips">
              {DURATION_PRESETS.map((p) => (
                <button
                  key={p.value}
                  className={`mb-sc-sb-chip ${plan.durationSec === p.value ? 'is-on' : ''}`}
                  title={`视频总时长 ${p.value} 秒`}
                  onClick={() => setF({ videoDurationSec: p.value })}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <ClampNumberInput
              className="mb-input mb-sc-sb-num"
              value={plan.durationSec}
              min={DURATION_MIN}
              max={DURATION_MAX}
              onCommit={(v) => setF({ videoDurationSec: v })}
            />
            <span className="mb-sc-sb-lbl">秒</span>
          </div>

          {/* 时间轴颗粒度：每段约 N 秒 → 估算段数 */}
          <div className="mb-sc-sb-row">
            <span className="mb-sc-sb-lbl">每段约</span>
            <StepperInput value={plan.secPerShot} min={SEC_PER_SHOT_MIN} max={SEC_PER_SHOT_MAX} onChange={(v) => setF({ secPerShot: v })} />
            <span className="mb-sc-sb-lbl">秒 · ≈ {plan.count} 段</span>
          </div>

          <input
            className="mb-input"
            value={d.extraNote ?? ''}
            placeholder="额外要求（可选：风格 / 节奏 / 镜头偏好）"
            onChange={(e) => setF({ extraNote: e.target.value })}
          />

          {/* 参考图（2026-07-14）：上游图片来源优先，卡上传兜底；运行时经视觉模型读图（人物形象/分镜片段）并入素材 */}
          {hasUpImg ? (
            <div className="mb-sc-fromup is-fed">🖼 参考图由上游输入（{up.images.length} 张：人物形象 / 场景 / 分镜片段）</div>
          ) : (
            <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={() => fileRef.current?.click()}>
              {hasLocal ? `换参考图（${d.inputImage?.name ?? '已上传'}）` : '上传参考图（可选：人物形象 / 分镜片段图）'}
            </button>
          )}
          {hasLocal && !hasUpImg && (
            <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={() => setF({ inputImage: undefined })}>
              ✕ 移除参考图
            </button>
          )}

          {upFed ? (
            <div
              className="mb-sc-fromup is-fed"
              style={{ cursor: 'pointer' }}
              title="点击查看上游输入全文"
              onClick={() => openText(up.prompts.join('\n\n'), '素材（由上游输入）')}
            >
              素材由上游输入（{up.prompts.length} 条：角色描述 / 简短故事）· 点击查看
            </div>
          ) : (
            <textarea
              className="mb-sc-input mb-sc-sb-ta"
              rows={3}
              value={d.input}
              placeholder="粘贴 角色描述 + 简短故事（推荐连上游 提示词 / LLM / 角色反推 节点传入）"
              onChange={(e) => setF({ input: e.target.value })}
            />
          )}
        </div>

        <div className="mb-sc-sb-runrow nodrag">
          <button className="mb-btn mb-btn-sm mb-btn-primary" disabled={running || !d.modelId} onClick={() => void runStoryboardNode(id)}>
            {running ? '生成中…' : result ? '重新生成分镜' : '生成分镜'}
          </button>
        </div>

        {d.error && <div className="mb-sc-result-err nodrag">{d.error}</div>}
        {!d.error && running && d.logs?.length ? <div className="mb-sc-work-dur nodrag">{d.logs[d.logs.length - 1]}</div> : null}

        {result && (
          <div className="mb-sc-arearel">
            <CopyButton onClick={() => copyText(result)} />
            <pre
              className="mb-sc-llm-out nodrag nowheel"
              title="整段分镜脚本（内嵌时间轴）· 右键更多"
              onContextMenu={(e) =>
                areaMenu(e, [
                  { label: '复制', onClick: () => copyText(result) },
                  { label: '放大查看', onClick: () => openText(result, '分镜脚本') },
                  { label: '用输出建提示词节点', onClick: () => makePromptNodeFrom(id, result) }
                ])
              }
            >
              {result}
            </pre>
            <ToPromptButton onClick={() => makePromptNodeFrom(id, result)} />
          </div>
        )}
        {result && <div className="mb-sc-note nodrag">【定调】+ 按时间段逐段分镜 · 整份连视频节点直接生成</div>}
        <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { loadFile(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
      </NodeShell>
    </>
  );
}
