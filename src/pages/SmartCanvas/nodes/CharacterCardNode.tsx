import { useMemo, useRef } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { useSmartCanvasStore, useSmartTextStore } from '@/store/smartCanvasStore';
import { useSettingsStore } from '@/store/settingsStore';
import { computeUpstream, runCharacterCardNode } from '@/lib/smartCanvasRunner';
import { listMappedModels } from '@/lib/modelMapping';
import { CARD_STYLES, SHEET_TYPES, SUBJECT_TYPES, sheetTypeLabel } from '@/lib/characterCardPrompt';
import type {
  CharacterCardNodeData,
  CharacterCardStyle,
  CharacterSheetType,
  CharacterSubjectType,
  SmartNodeData
} from '@shared/smartCanvas';
import { NodeShell } from './NodeShell';
import { SegmentedControl, ModelDropdownButton, type ModelGridItem } from '../nodePanel/consoleControls';
import { CopyButton, ToPromptButton, copyText, areaMenu, makePromptNodeFrom, useFitNodeToContent } from '../nodeArea';

const STATUS_TEXT: Record<string, string> = { idle: '待运行', running: '生成中…', success: '已完成', error: '失败' };

/** 当前方案的对话(text)模型（角色卡需视觉/识图能力）。 */
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
 * 角色卡节点（2026-07-12）：人物/动物照片 + 简单描述 → ① 视觉模型详细分析外观
 * → ② 按「输出类型」组装生图提示词——完整设定卡（四种版面风格）/ 三视图 / 面部特写 /
 * 表情九宫格 / 身材比例 / 动作姿势 → 上口喂生图出图；下口输出角色描述提示词（外观分析）。
 */
export function CharacterCardNode({ id, data }: NodeProps): JSX.Element {
  const update = useSmartCanvasStore((s) => s.updateNodeData);
  const remove = useSmartCanvasStore((s) => s.removeNode);
  const nodes = useSmartCanvasStore((s) => s.nodes);
  const edges = useSmartCanvasStore((s) => s.edges);
  const openText = useSmartTextStore((s) => s.open);
  const d = data as unknown as CharacterCardNodeData;
  const models = useTextModelItems();
  const fileRef = useRef<HTMLInputElement>(null);
  const setF = (p: Partial<CharacterCardNodeData>): void => update(id, p as Partial<SmartNodeData>);
  const up = useMemo(() => computeUpstream(nodes, edges, id), [nodes, edges, id]);
  const running = d.status === 'running';
  const hasUpImg = up.images.length > 0;
  const hasUpText = up.prompts.length > 0;
  const hasLocal = !!d.inputImage?.url;
  const canRun = hasUpImg || hasLocal || hasUpText || !!d.desc.trim();
  const analysis = (d.analysisText ?? '').trim();
  const result = (d.resultText ?? '').trim();
  const sheet = d.sheetType ?? 'card';
  const subject = d.subjectType ?? 'person';
  const subjectWord = subject === 'animal' ? '动物' : '人物';
  const sheetLabel = sheetTypeLabel(sheet);

  // 节点高度贴合真实内容（fitwrap 实测；手动 > 自适应）。结果区 max-height 封顶内滚。
  const fitRef = useRef<HTMLDivElement>(null);
  useFitNodeToContent(id, fitRef, 52, 720);

  function loadFile(file?: File | null): void {
    if (!file || !file.type.startsWith('image/')) return;
    const r = new FileReader();
    r.onload = () => setF({ inputImage: { url: String(r.result), name: file.name } });
    r.readAsDataURL(file);
  }

  return (
    <>
      <NodeResizer isVisible minWidth={240} minHeight={220} />
      <NodeShell
        title="角色卡"
        accent="is-character-card"
        inputs
        outputs={[
          { id: 'out', title: '角色卡生图提示词（上口）：整张角色设定卡的版面提示词，连生图节点出卡' },
          { id: 'out-desc', title: '角色描述提示词（下口）：外貌/风格详细描述，连 分镜/生图/LLM 作角色设定' }
        ]}
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
          {/* 主体类型：人物 / 动物（分析口径与版面按物种适配） */}
          <SegmentedControl
            value={subject}
            size="sm"
            options={SUBJECT_TYPES.map((s) => ({ value: s.value, label: s.label, title: s.hint }))}
            onChange={(v) => setF({ subjectType: v as CharacterSubjectType })}
          />
          {/* 输出类型：设定卡 / 三视图 / 面部特写 / 表情九宫 / 身材比例 / 动作姿势 */}
          <SegmentedControl
            value={sheet}
            size="sm"
            options={SHEET_TYPES.map((s) => ({ value: s.value, label: s.label, title: s.hint }))}
            onChange={(v) => setF({ sheetType: v as CharacterSheetType })}
          />
          {/* 版面风格：仅「设定卡」输出类型生效（其余输出类型是中性参考图版面） */}
          {sheet === 'card' && (
            <SegmentedControl
              value={d.cardStyle ?? 'magazine'}
              size="sm"
              options={CARD_STYLES.map((s) => ({ value: s.value, label: s.label, title: s.hint }))}
              onChange={(v) => setF({ cardStyle: v as CharacterCardStyle })}
            />
          )}
          {/* 照片来源徽章：上游图优先，本地上传兜底 */}
          {hasUpImg ? (
            <div className="mb-sc-fromup is-fed">🖼 {subjectWord}照片由上游输入（{up.images.length} 张，取第 1 张）</div>
          ) : (
            <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={() => fileRef.current?.click()}>
              {hasLocal ? `换${subjectWord}照片（${d.inputImage?.name ?? '已上传'}）` : `上传${subjectWord}照片（或连 图片 来源；纯文字也可）`}
            </button>
          )}
          {hasUpText && (
            <div
              className="mb-sc-fromup is-fed"
              style={{ cursor: 'pointer' }}
              title="点击查看上游文字素材"
              onClick={() => openText(up.prompts.join('\n\n'), '角色素材（由上游输入）')}
            >
              📝 角色描述由上游输入（{up.prompts.length} 条）· 点击查看
            </div>
          )}
          <textarea
            className="mb-sc-input mb-sc-sb-ta"
            rows={2}
            value={d.desc}
            placeholder="简单描述（可选）：如「21 岁舞台表演者，气质清冷锋利」"
            onChange={(e) => setF({ desc: e.target.value })}
          />
        </div>

        <button
          className="mb-btn mb-btn-sm mb-btn-primary nodrag"
          disabled={running || !d.modelId || !canRun}
          onClick={() => void runCharacterCardNode(id)}
        >
          {running ? '生成中…' : `${result ? '重新' : ''}生成「${sheetLabel}」提示词`}
        </button>

        {d.error && <div className="mb-sc-result-err nodrag">{d.error}</div>}
        {!d.error && running && d.logs?.length ? <div className="mb-sc-work-dur nodrag">{d.logs[d.logs.length - 1]}</div> : null}

        {analysis && !running && (
          <div
            className="mb-sc-note nodrag"
            style={{ cursor: 'pointer' }}
            title="第 ① 步的外貌分析全文 · 点击放大"
            onClick={() => openText(analysis, '外貌分析')}
          >
            外貌分析 ✓ · 点击查看
          </div>
        )}
        {result && (
          <div className="mb-sc-arearel">
            <CopyButton onClick={() => copyText(result)} />
            <pre
              className="mb-sc-llm-out nodrag nowheel"
              title="角色卡生图提示词 · 右键更多"
              onContextMenu={(e) =>
                areaMenu(e, [
                  { label: '复制', onClick: () => copyText(result) },
                  { label: '放大查看', onClick: () => openText(result, '角色卡提示词') },
                  { label: '用输出建提示词节点', onClick: () => makePromptNodeFrom(id, result) }
                ])
              }
            >
              {result}
            </pre>
            <ToPromptButton onClick={() => makePromptNodeFrom(id, result)} />
          </div>
        )}
        {result && <div className="mb-sc-note nodrag">上口=设定卡生图提示词（连生图出卡） · 下口=角色描述提示词（连分镜/生图作设定）</div>}
        <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { loadFile(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
      </NodeShell>
    </>
  );
}
