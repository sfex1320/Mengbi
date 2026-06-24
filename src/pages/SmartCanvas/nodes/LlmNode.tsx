import { useEffect, useRef, useState } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { useSmartCanvasStore, useSmartTextStore } from '@/store/smartCanvasStore';
import { runWithUpstream, sendLlmChat } from '@/lib/smartCanvasRunner';
import { useLlmHistoryStore, type LlmHistoryEntry } from '@/store/llmHistoryStore';
import { LLM_OP_LABELS, type LlmNodeData, type SmartNodeData } from '@shared/smartCanvas';
import { NodeShell } from './NodeShell';
import { PortalPopover } from '../nodePanel/consoleControls';
import { CopyButton, areaMenu, copyText, fitNodeHeight, autoGrowNode, makePromptNodeFrom } from '../nodeArea';

/** LLM 节点：两块——「节点」单次操作 / 「聊天」流式对话（像生图页对话）。参数在弹出检查器里调。 */
export function LlmNode({ id, data }: NodeProps): JSX.Element {
  const update = useSmartCanvasStore((s) => s.updateNodeData);
  const remove = useSmartCanvasStore((s) => s.removeNode);
  const openText = useSmartTextStore((s) => s.open);
  const d = data as unknown as LlmNodeData;
  const running = d.status === 'running';
  const [draft, setDraft] = useState('');
  const outRef = useRef<HTMLPreElement>(null);

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

  // 节点模式：自适应贴合「op 行 + 模型 + 运行 + 输出」高度（输出在 .mb-sc-llm-out 内最高 110px 滚动，
  // 故按其可见高度估，避免像截图那样大片空白；双向贴合：输出清空即收回）。聊天模式不在此自适应（见下）。
  useEffect(() => {
    if (d.mode === 'chat') return;
    const need = 150 + (d.resultText?.trim() ? 130 : 0) + (d.error ? 28 : 0);
    autoGrowNode(id, need, 700);
  }, [id, d.mode, d.resultText, d.error]);

  // 聊天模式：**关闭自适应**（固定大小，避免每条消息都把窗口撑大、难以处理）；
  // 进入聊天时若窗口偏小，一次性给一个较大的固定尺寸（对话区/输入区都尽量大），之后由用户手动调。
  useEffect(() => {
    if (d.mode !== 'chat') return;
    const n = useSmartCanvasStore.getState().nodes.find((x) => x.id === id);
    if ((n?.data as { manualSize?: boolean } | undefined)?.manualSize) return;
    const curH = typeof n?.height === 'number' ? n.height : n?.measured?.height ?? 0;
    const curW = typeof n?.width === 'number' ? n.width : n?.measured?.width ?? 0;
    if (curH < 380 || curW < 300) {
      useSmartCanvasStore.getState().setNodeSize(id, { width: Math.max(320, curW), height: Math.max(440, curH) });
    }
  }, [id, d.mode]);

  const setMode = (mode: 'node' | 'chat'): void => update(id, { mode } as Partial<SmartNodeData>);
  function send(): void {
    const t = draft.trim();
    if (!t || d.chatStreaming) return;
    setDraft('');
    void sendLlmChat(id, t);
  }

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
        {d.mode === 'chat' ? (
          <div className="mb-sc-chat">
            <div className="mb-sc-chat-model">{d.modelId || '未选对话模型（选中后在检查器里选）'}</div>
            <div className="mb-sc-chat-msgs nodrag nowheel">
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
                placeholder="发消息（Enter 发送 / Shift+Enter 换行）· 上游连图片可让多模态模型识图 · 右下角可拖大"
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
          <>
            <div className="mb-sc-work-line">{LLM_OP_LABELS[d.op]}</div>
            <div className="mb-sc-work-model" title={d.modelId}>
              {d.modelId || '未选对话模型（选中后在检查器里选）'}
            </div>
            <button className="mb-btn mb-btn-sm mb-btn-primary nodrag" disabled={running} onClick={() => void runWithUpstream(id)}>
              {running ? (
                <>
                  <span className="mb-sc-spinner" aria-hidden />
                  运行中…
                </>
              ) : (
                '运行'
              )}
            </button>
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
                      { label: '清空输出', variant: 'danger', onClick: () => update(id, { resultText: '' } as Partial<SmartNodeData>) }
                    ]);
                  }}
                >
                  {d.resultText.trim()}
                </pre>
              </div>
            )}
            {d.error && <div className="mb-sc-result-err">{d.error}</div>}
          </>
        )}
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
