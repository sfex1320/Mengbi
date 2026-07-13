import { useEffect, useMemo, useRef, useState } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { useSmartCanvasStore, useSmartTextStore } from '@/store/smartCanvasStore';
import { useSettingsStore } from '@/store/settingsStore';
import { runWithUpstream, sendLlmChat, computeUpstream } from '@/lib/smartCanvasRunner';
import { useLlmHistoryStore, type LlmHistoryEntry } from '@/store/llmHistoryStore';
import { listMappedModels } from '@/lib/modelMapping';
import { confirmDialog } from '@/components/ConfirmDialog';
import {
  LLM_OP_LABELS,
  LLM_OP_SUBS,
  LLM_PURPOSE_LABELS,
  LLM_PURPOSE_OPS,
  type LlmNodeData,
  type LlmOp,
  type LlmPurpose,
  type SmartNodeData
} from '@shared/smartCanvas';
import { NodeShell } from './NodeShell';
import {
  PortalPopover,
  ModelDropdownButton,
  SegmentedControl,
  type ModelGridItem
} from '../nodePanel/consoleControls';
import { IconChoiceGrid } from '../nodeControls';
import { optionIcon, OptionIcon } from '../optionIcons';
import { CopyButton, ToPromptButton, areaMenu, copyText, fitNodeHeight, makePromptNodeFrom, useFitNodeToContent } from '../nodeArea';

const LLM_OPS = Object.keys(LLM_OP_LABELS) as LlmOp[];
const PURPOSES: LlmPurpose[] = ['image', 'video', 'character', 'scene', 'free'];
/** 用途按钮的短标签（SegmentedControl 一行放下 5 个；完整名进 title） */
const PURPOSE_SHORT: Record<LlmPurpose, string> = {
  free: '自由',
  image: '生图',
  video: '视频',
  character: '角色',
  scene: '场景'
};

/** 当前方案下可用的对话(text)模型（带「中转站 /」前缀，与生图节点同款 ModelDropdownButton）。 */
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
 * LLM 节点：两块——「节点」单次操作 / 「聊天」流式对话。
 * 2026-07-11 重做：op 图标网格直选 + 模型按钮式下拉 + 「输出用途 / 本次意图」（注入 systemPrompt，
 * 让模型知道优化给谁用）+ 聊天底部跟随滚动 / 清空对话；输入被上游喂入时标黄禁手填（既有规则保留）。
 */
export function LlmNode({ id, data }: NodeProps): JSX.Element {
  const update = useSmartCanvasStore((s) => s.updateNodeData);
  const remove = useSmartCanvasStore((s) => s.removeNode);
  const nodes = useSmartCanvasStore((s) => s.nodes);
  const edges = useSmartCanvasStore((s) => s.edges);
  const openText = useSmartTextStore((s) => s.open);
  const d = data as unknown as LlmNodeData;
  const running = d.status === 'running';
  const [draft, setDraft] = useState('');
  const [opsOpen, setOpsOpen] = useState(false);
  const outRef = useRef<HTMLPreElement>(null);
  const msgsRef = useRef<HTMLDivElement>(null);
  // 聊天是否停在底部：只有本就在底部时新消息才自动跟随（用户上翻查历史时不抢滚动）
  const atBottomRef = useRef(true);
  const textModels = useTextModelItems();
  const setF = (patch: Partial<LlmNodeData>): void => update(id, patch as Partial<SmartNodeData>);

  const up = useMemo(() => computeUpstream(nodes, edges, id), [nodes, edges, id]);
  const purpose: LlmPurpose = d.purpose ?? 'free';
  const purposeApplicable = LLM_PURPOSE_OPS.has(d.op);
  const isReverse = d.op === 'reverse';
  // 与 runner 同口径：外接指令开启时上游作指令、本地 input 是待处理文本；否则上游即待处理文本（标黄禁手填）
  const fromUp = !!d.instructionFromUpstream && up.prompts.length > 0;
  const inputFed = !isReverse && !fromUp && up.prompts.length > 0;

  function makePromptFrom(text: string): void {
    makePromptNodeFrom(id, text);
  }

  function chatMsgMenu(e: React.MouseEvent, full: string): void {
    const sel = (window.getSelection()?.toString() ?? '').trim();
    areaMenu(e, [
      ...(sel ? [{ label: '复制选中文字', onClick: () => copyText(sel) }] : []),
      { label: '复制整条', onClick: () => copyText(full) },
      { label: `用${sel ? '选中' : '整条'}文字建提示词节点`, onClick: () => makePromptFrom(sel || full) },
      { separator: true as const },
      { label: '放大查看', onClick: () => openText(full, 'LLM 回复') }
    ]);
  }

  // 节点高度贴合真实内容（fitwrap 实测：op/用途/模式切换、展开网格、输出/报错变化都自动跟随；手动 > 自适应）。
  // 聊天模式不再无限长高：对话记录区自身 max-height + 内滚（CSS .mb-sc-chat-msgs），底部智能跟随滚动照常工作。
  const fitRef = useRef<HTMLDivElement>(null);
  useFitNodeToContent(id, fitRef, 52, 900);

  // 聊天底部跟随：新消息 / 流式片段到达时，若用户本就在底部则滚到底（lastLen 让流式逐字也跟随）
  const lastMsg = d.chatMessages.length ? d.chatMessages[d.chatMessages.length - 1] : null;
  const lastLen = lastMsg ? lastMsg.content.length : 0;
  useEffect(() => {
    if (d.mode !== 'chat') return;
    const el = msgsRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [d.mode, d.chatMessages.length, lastLen]);

  const setMode = (mode: 'node' | 'chat'): void => {
    if (mode === 'chat') atBottomRef.current = true; // 进聊天先回到底部
    setOpsOpen(false);
    update(id, { mode } as Partial<SmartNodeData>);
  };
  function send(): void {
    const t = draft.trim();
    if (!t || d.chatStreaming) return;
    setDraft('');
    atBottomRef.current = true; // 自己发消息 = 必然想看到回复，强制跟随
    void sendLlmChat(id, t);
  }
  async function clearChat(): Promise<void> {
    if (!d.chatMessages.length || d.chatStreaming) return;
    const ok = await confirmDialog({
      message: '清空这段对话？（🕘 历史记录里已保存的对话不受影响）',
      danger: true,
      okText: '清空'
    });
    if (ok) setF({ chatMessages: [] });
  }

  // 用途/意图摘要（聊天头部提示 + op 行 tooltip 用）
  const goalSummary =
    purpose !== 'free' || (d.intent ?? '').trim()
      ? [purpose !== 'free' ? LLM_PURPOSE_LABELS[purpose] : '', (d.intent ?? '').trim()].filter(Boolean).join(' · ')
      : '';

  return (
    <>
      <NodeResizer isVisible minWidth={220} minHeight={170} />
      <NodeShell
        title="LLM"
        accent="is-llm"
        inputs
        outputs
        fill
        onDelete={() => remove(id)}
        headRight={
          <div className="mb-sc-tabs nodrag">
            <LlmHistoryButton nodeId={id} />
            <button className={`mb-sc-tab ${d.mode !== 'chat' ? 'is-on' : ''}`} onClick={() => setMode('node')}>
              节点
            </button>
            <button className={`mb-sc-tab ${d.mode === 'chat' ? 'is-on' : ''}`} onClick={() => setMode('chat')}>
              聊天
            </button>
          </div>
        }
      >
        <div className="mb-sc-fitwrap nowheel" ref={fitRef}>
        {d.mode === 'chat' ? (
          <div className="mb-sc-chat">
            <div className="mb-sc-chat-head nodrag">
              <span className="mb-sc-chat-model" title={d.modelId}>
                {d.modelId || '未选对话模型（切到「节点」页选）'}
              </span>
              {goalSummary && (
                <span className="mb-sc-chat-goal" title={`输出用途/意图已注入对话（在「节点」页调整）：${goalSummary}`}>
                  <OptionIcon category="llmPurpose" value={purpose === 'free' ? 'free' : purpose} size={12} />
                  {goalSummary}
                </span>
              )}
              <button
                className="mb-sc-chat-clear"
                title="清空这段对话（历史记录不受影响）"
                disabled={!d.chatMessages.length || !!d.chatStreaming}
                onClick={() => void clearChat()}
              >
                清空
              </button>
            </div>
            <div
              ref={msgsRef}
              className="mb-sc-chat-msgs nodrag nowheel"
              onScroll={(e) => {
                // 距底 < 48px 视为「在底部」→ 新片段自动跟随；上翻则停住不抢
                const el = e.currentTarget;
                atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
              }}
            >
              {d.chatMessages.length === 0 && <div className="mb-sc-empty">和模型流式对话…</div>}
              {d.chatMessages.map((m, i) => (
                <div
                  key={i}
                  className={`mb-sc-chat-msg is-${m.role}`}
                  onContextMenu={(e) => m.content && chatMsgMenu(e, m.content)}
                  onClick={() => {
                    // 无选区时点一下 = 放大查看；有选区（正在框选复制）则不抢，留给右键建提示词节点
                    const sel = (window.getSelection()?.toString() ?? '').trim();
                    if (!sel && m.content) openText(m.content, 'LLM 回复');
                  }}
                  title="点击放大 · 右键：复制 / 选段建提示词节点"
                >
                  {m.content || (d.chatStreaming && i === d.chatMessages.length - 1 ? '…' : '')}
                </div>
              ))}
            </div>
            <div className="mb-sc-chat-input nodrag">
              <textarea
                className="mb-sc-input mb-sc-chat-ta nowheel"
                rows={3}
                value={draft}
                placeholder="发消息（Enter 发送 / Shift+Enter 换行）· 上游连图片可让多模态模型识图"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
              />
              <button className="mb-btn mb-btn-sm mb-btn-primary" disabled={d.chatStreaming || !draft.trim()} onClick={send}>
                {d.chatStreaming ? '…' : '发送'}
              </button>
            </div>
          </div>
        ) : (
          <div className="mb-sc-wctl nodrag">
            {/* ① 操作：当前 op 图标+名（点击展开图标网格直选，替代原生下拉） */}
            <button
              type="button"
              className={`mb-sc-llm-oprow ${opsOpen ? 'is-open' : ''}`}
              title={`${LLM_OP_LABELS[d.op]} —— ${LLM_OP_SUBS[d.op]}（点击${opsOpen ? '收起' : '换操作'}）`}
              onClick={() => setOpsOpen((v) => !v)}
            >
              <span className="mb-sc-llm-opico">
                <OptionIcon category="llmOp" value={d.op} size={16} />
              </span>
              <span className="mb-sc-llm-opname">{LLM_OP_LABELS[d.op]}</span>
              <span className="mb-sc-llm-opsub">{LLM_OP_SUBS[d.op]}</span>
              <span className="mb-sc-llm-opcaret">{opsOpen ? '▴' : '▾'}</span>
            </button>
            {opsOpen && (
              <IconChoiceGrid
                compact
                value={d.op}
                options={LLM_OPS.map((o) => ({
                  value: o,
                  label: LLM_OP_LABELS[o],
                  icon: optionIcon('llmOp', o, 16),
                  title: `${LLM_OP_LABELS[o]} —— ${LLM_OP_SUBS[o]}`
                }))}
                onChange={(v) => {
                  setF({ op: v });
                  setOpsOpen(false);
                }}
              />
            )}

            {/* ② 模型：按钮式下拉（带「中转站 /」前缀，与生图节点同款） */}
            <ModelDropdownButton
              value={d.modelId}
              options={textModels}
              placeholder={isReverse ? '选择视觉对话模型' : '选择对话模型'}
              emptyHint="当前方案没有对话模型，去设置页配置"
              onChange={(v) => setF({ modelId: v })}
            />

            {/* ③ 用途 / 意图（仅文本类 op）：告诉模型「优化给谁用、要达到什么目的」 */}
            {purposeApplicable && (
              <>
                <SegmentedControl
                  size="sm"
                  value={purpose}
                  options={PURPOSES.map((p) => ({
                    value: p,
                    label: PURPOSE_SHORT[p],
                    icon: optionIcon('llmPurpose', p, 13),
                    title: `输出用途：${LLM_PURPOSE_LABELS[p]}${p === 'free' ? '（不注入用途导向）' : ''}`
                  }))}
                  onChange={(v) => setF({ purpose: v })}
                />
                <input
                  className="mb-input"
                  value={d.intent ?? ''}
                  placeholder="要用来做什么？例：电商主图、突出金属质感、白底"
                  title="一句话意图：注入系统提示词，一切改写围绕它展开（可留空）"
                  onChange={(e) => setF({ intent: e.target.value })}
                />
              </>
            )}

            {/* ④ 反推：类型 + 上游图状态（reverse 走视觉模型，用途/意图不注入） */}
            {isReverse && (
              <>
                <SegmentedControl
                  size="sm"
                  value={d.reverseType}
                  options={[
                    { value: 'description', label: '描述' },
                    { value: 'tags', label: '标签' },
                    { value: 'style', label: '风格' }
                  ]}
                  onChange={(v) => setF({ reverseType: v as LlmNodeData['reverseType'] })}
                />
                {up.images.length > 0 ? (
                  <div className="mb-sc-fromup is-fed">图片由上游输入（{up.images.length} 张）</div>
                ) : (
                  <div className="mb-sc-fromup">连一个上游图片节点，反推成提示词文本</div>
                )}
              </>
            )}

            {/* ⑤ 输入区：上游喂入 = 标黄禁手填（既有规则）；否则卡上直接输入 */}
            {!isReverse &&
              (inputFed ? (
                <div className="mb-sc-fromup is-fed">输入文本由上游输入（{up.prompts.length} 段），无需手填</div>
              ) : (
                <textarea
                  className="mb-sc-input mb-sc-llm-in nowheel"
                  rows={3}
                  value={d.input}
                  placeholder={fromUp ? '待处理文本（上游提示词已作为指令）' : '输入要处理的文字，或连一个提示词节点…'}
                  onChange={(e) => setF({ input: e.target.value })}
                />
              ))}

            {/* ⑥ 运行 */}
            <button className="mb-btn mb-btn-sm mb-btn-primary" disabled={running} onClick={() => void runWithUpstream(id)}>
              {running ? (
                <>
                  <span className="mb-sc-spinner" aria-hidden />
                  运行中…
                </>
              ) : (
                '运行'
              )}
            </button>

            {/* ⑦ 输出区：预览 + 复制 / 放大 / → 提示词节点 */}
            {d.resultText?.trim() && (
              <div className="mb-sc-arearel">
                <CopyButton onClick={() => copyText(d.resultText ?? '')} />
                <pre
                  ref={outRef}
                  className="mb-sc-llm-out nodrag nowheel"
                  title="点击放大查看 · 右键：复制 / 选中文字建提示词节点"
                  onClick={() => {
                    // 无选区时点一下 = 放大查看；有选区（正在框选）则不抢，让用户右键「用选中文字建提示词节点」
                    const sel = (window.getSelection()?.toString() ?? '').trim();
                    if (!sel) openText(d.resultText ?? '', 'LLM 输出');
                  }}
                  onContextMenu={(e) => {
                    const sel = (window.getSelection()?.toString() ?? '').trim();
                    areaMenu(e, [
                      ...(sel
                        ? [
                            { label: '复制选中文字', onClick: () => copyText(sel) },
                            { label: '用选中文字建提示词节点', onClick: () => makePromptFrom(sel) },
                            { separator: true as const }
                          ]
                        : []),
                      { label: '放大查看', onClick: () => openText(d.resultText ?? '', 'LLM 输出') },
                      { label: sel ? '复制全部输出' : '复制输出', onClick: () => copyText(d.resultText ?? '') },
                      { label: sel ? '用全部输出建提示词节点' : '用输出建提示词节点', onClick: () => makePromptFrom(d.resultText ?? '') },
                      { label: '适配高度', onClick: () => fitNodeHeight(id, outRef.current) },
                      { separator: true },
                      { label: '清空输出', variant: 'danger', onClick: () => setF({ resultText: '' }) }
                    ]);
                  }}
                >
                  {d.resultText.trim()}
                </pre>
                <ToPromptButton onClick={() => makePromptFrom(d.resultText ?? '')} />
              </div>
            )}
            {d.error && <div className="mb-sc-result-err">{d.error}</div>}
          </div>
        )}
        </div>
      </NodeShell>
    </>
  );
}

/**
 * LLM 历史记录按钮 + 弹层：列出本机存的智能画布 LLM 历史（对话 / 单次操作），
 * 点条目「回放」到当前节点（对话→聊天模式还原消息；操作→节点模式还原输入/输出）。
 * 与生图主功能对话**完全隔离**（localStorage，关软件不丢）。
 */
function LlmHistoryButton({ nodeId }: { nodeId: string }): JSX.Element {
  const update = useSmartCanvasStore((s) => s.updateNodeData);
  const entries = useLlmHistoryStore((s) => s.entries);
  const remove = useLlmHistoryStore((s) => s.remove);
  const clear = useLlmHistoryStore((s) => s.clear);
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  function restore(e: LlmHistoryEntry): void {
    if (e.kind === 'chat') {
      update(nodeId, { mode: 'chat', chatMessages: e.messages ?? [], chatStreaming: false, modelId: e.modelId } as Partial<SmartNodeData>);
    } else {
      update(nodeId, {
        mode: 'node',
        op: e.op ?? 'optimize',
        input: e.input ?? '',
        resultText: e.output ?? '',
        modelId: e.modelId,
        status: 'idle',
        error: null
      } as Partial<SmartNodeData>);
    }
    setOpen(false);
  }

  return (
    <>
      <button ref={btnRef} className="mb-sc-tab mb-sc-llmhist-btn" title="历史记录（对话 / 优化）· 点条目回放" onClick={() => setOpen((v) => !v)}>
        🕘
      </button>
      <PortalPopover anchorRef={btnRef} open={open} onClose={() => setOpen(false)} className="mb-sc-llmhist-pop mb-card nodrag">
        <div className="mb-sc-llmhist-head">
          <span>LLM 历史（{entries.length}）</span>
          {entries.length > 0 && (
            <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={() => clear()}>
              清空
            </button>
          )}
        </div>
        {entries.length === 0 ? (
          <div className="mb-sc-llmhist-empty">还没有历史记录。对话或运行一次操作后会自动保存在本机。</div>
        ) : (
          <div className="mb-sc-llmhist-list">
            {entries.map((e) => (
              <div key={e.id} className="mb-sc-llmhist-item" onClick={() => restore(e)} title="点击回放到当前节点">
                <div className="mb-sc-llmhist-itemtop">
                  <span className="mb-sc-llmhist-kind">{e.kind === 'chat' ? '对话' : LLM_OP_LABELS[e.op ?? 'optimize']}</span>
                  <span className="mb-sc-llmhist-model">{e.modelId}</span>
                  <button
                    className="mb-sc-llmhist-del"
                    title="删除此条"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      remove(e.id);
                    }}
                  >
                    ✕
                  </button>
                </div>
                <div className="mb-sc-llmhist-title">{e.title}</div>
              </div>
            ))}
          </div>
        )}
      </PortalPopover>
    </>
  );
}
