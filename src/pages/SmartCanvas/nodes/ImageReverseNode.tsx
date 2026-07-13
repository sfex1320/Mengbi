import { useMemo, useRef } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { useSmartCanvasStore } from '@/store/smartCanvasStore';
import { useSettingsStore } from '@/store/settingsStore';
import { computeUpstream, runImageReverseNode } from '@/lib/smartCanvasRunner';
import { listMappedModels } from '@/lib/modelMapping';
import {
  REVERSE_OUTPUT_LABELS,
  type ImageReverseNodeData,
  type ReverseOutputMode,
  type SmartNodeData
} from '@shared/smartCanvas';
import { NodeShell } from './NodeShell';
import { SegmentedControl, ClampNumberInput, ModelDropdownButton, type ModelGridItem } from '../nodePanel/consoleControls';
import { CopyButton, ToPromptButton, copyText, areaMenu, makePromptNodeFrom, useFitNodeToContent } from '../nodeArea';

const STATUS_TEXT: Record<string, string> = { idle: '待运行', running: '反推中…', success: '已完成', error: '失败' };

/** 当前方案的对话(text)模型（带中转站前缀区分同名模型；反推需视觉/识图能力）。 */
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
 * 反推节点（图/视频合一，kind 仍为 image-reverse）：
 * 自动识别上游输入形态——上游有视频 → 抽帧反推（显示抽帧数控件）；否则用上游图片；都没有 → 本地上传图兜底。
 * 输出模式五选：生图提示词（默认）/ 角色反推 / 详细描述 / 标签词 / 风格分析 → 文本喂下游。
 * 角色反推（2026-07-12）：照片 或 纯文字素材（上游提示词/LLM 文本）→ 五官/发色/衣着/妆容/配饰等极详细角色外观描述。
 */
export function ImageReverseNode({ id, data }: NodeProps): JSX.Element {
  const update = useSmartCanvasStore((s) => s.updateNodeData);
  const remove = useSmartCanvasStore((s) => s.removeNode);
  const nodes = useSmartCanvasStore((s) => s.nodes);
  const edges = useSmartCanvasStore((s) => s.edges);
  const d = data as unknown as ImageReverseNodeData;
  const models = useTextModelItems();
  const fileRef = useRef<HTMLInputElement>(null);
  const setF = (p: Partial<ImageReverseNodeData>): void => update(id, p as Partial<SmartNodeData>);
  const up = useMemo(() => computeUpstream(nodes, edges, id), [nodes, edges, id]);
  const running = d.status === 'running';
  // 输入形态判定与 runner 完全一致：视频优先 > 上游图 > 本地上传；角色反推可只凭上游文字素材运行
  const hasVideo = up.videos.length > 0;
  const hasUpImg = up.images.length > 0;
  const hasLocal = !!d.inputImage?.url;
  const hasUpText = up.prompts.length > 0;
  // 旧档兼容：outputMode 缺省时回退 reverseType（与 runner 同一判定）
  const mode: ReverseOutputMode = d.outputMode ?? d.reverseType ?? 'prompt';
  const canRun = hasVideo || hasUpImg || hasLocal || (mode === 'character' && hasUpText);

  // 节点高度贴合真实内容（fitwrap 实测：来源形态/输出模式切换、结果/报错变化都自动跟随；手动 > 自适应）。
  // 结果文本区在 .mb-sc-llm-out 内 max-height 封顶内滚，长输出不会把节点无限撑高。
  const fitRef = useRef<HTMLDivElement>(null);
  useFitNodeToContent(id, fitRef, 52, 700);

  function loadFile(file?: File | null): void {
    if (!file || !file.type.startsWith('image/')) return;
    const r = new FileReader();
    r.onload = () => setF({ inputImage: { url: String(r.result), name: file.name } });
    r.readAsDataURL(file);
  }

  return (
    <>
      <NodeResizer isVisible minWidth={220} minHeight={170} />
      <NodeShell
        title="反推"
        accent="is-image-reverse"
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
            placeholder="（选视觉对话模型）"
            emptyHint="当前方案没有对话模型，去设置页配置（需支持识图）"
            onChange={(v) => setF({ modelId: v })}
          />
          <SegmentedControl
            value={mode}
            size="sm"
            options={(Object.keys(REVERSE_OUTPUT_LABELS) as ReverseOutputMode[]).map((k) => ({
              value: k,
              label: REVERSE_OUTPUT_LABELS[k]
            }))}
            onChange={(v) => setF({ outputMode: v })}
          />
          {hasVideo && (
            <label className="mb-sc-revrow">
              抽帧数
              <ClampNumberInput min={1} max={12} value={d.frameCount ?? 6} onCommit={(v) => setF({ frameCount: v })} />
            </label>
          )}
          {/* 输入形态徽章：与 runner 的「视频 > 图片 > 本地上传 >（角色反推）文字素材」优先级一致 */}
          {hasVideo ? (
            <div className="mb-sc-fromup is-fed">🎬 视频由上游输入（{up.videos.length} 个）· 抽 {d.frameCount ?? 6} 帧反推</div>
          ) : hasUpImg ? (
            <div className="mb-sc-fromup is-fed">🖼 图片由上游输入（{up.images.length} 张），无需手填</div>
          ) : (
            <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={() => fileRef.current?.click()}>
              {hasLocal ? '换图' : mode === 'character' ? '上传人物照片（或连 图片 / 文字描述）' : '上传图片（或连 图片 / 视频 来源）'}
            </button>
          )}
          {hasUpText && (
            <div className="mb-sc-fromup is-fed">
              📝 文字素材 {up.prompts.length} 条（{mode === 'character' ? '角色素材，可无图直接反推' : '作补充说明一并参考'}）
            </div>
          )}
        </div>
        <button
          className="mb-btn mb-btn-sm mb-btn-primary nodrag"
          disabled={running || !d.modelId || !canRun}
          onClick={() => void runImageReverseNode(id)}
        >
          {running ? '反推中…' : '运行反推'}
        </button>
        {d.error && <div className="mb-sc-result-err nodrag">{d.error}</div>}
        {d.resultText?.trim() && (
          <div className="mb-sc-arearel">
            <CopyButton onClick={() => copyText(d.resultText ?? '')} />
            <pre
              className="mb-sc-llm-out nodrag nowheel"
              onContextMenu={(e) =>
                areaMenu(e, [
                  { label: '复制', onClick: () => copyText(d.resultText ?? '') },
                  { label: '用输出建提示词节点', onClick: () => makePromptNodeFrom(id, d.resultText ?? '') }
                ])
              }
            >
              {d.resultText.trim()}
            </pre>
            <ToPromptButton onClick={() => makePromptNodeFrom(id, d.resultText ?? '')} />
          </div>
        )}
        <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { loadFile(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
      </NodeShell>
    </>
  );
}
