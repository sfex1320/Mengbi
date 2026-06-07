import { useEffect, useRef, useState } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { useSmartCanvasStore, useSmartTextStore } from '@/store/smartCanvasStore';
import { runWithUpstream, sendLlmChat } from '@/lib/smartCanvasRunner';
import { LLM_OP_LABELS, type LlmNodeData, type SmartNodeData } from '@shared/smartCanvas';
import { NodeShell } from './NodeShell';
import { CopyButton, areaMenu, copyText, fitNodeHeight, estimateTextHeight, autoGrowNode, getNodeWidth, makePromptNodeFrom } from '../nodeArea';

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

  // 自适应增高：节点模式按 输入/输出 文本估高；聊天模式按全部对话消息估高，
  // 切到聊天 / 每来一条消息都把节点撑高，尽量完整展示对话（封顶后内部滚动）。
  useEffect(() => {
    const width = getNodeWidth(id);
    if (d.mode === 'chat') {
      const msgsH = d.chatMessages.reduce((sum, m) => sum + estimateTextHeight(m.content || '…', width) + 14, 0);
      const need = 184 + Math.max(70, msgsH); // 标题 + 模型行 + 输入框 + 消息区
      autoGrowNode(id, need, 1100);
      return;
    }
    const need = 150 + estimateTextHeight(d.input ?? '', width) + estimateTextHeight(d.resultText ?? '', width);
    autoGrowNode(id, need);
  }, [id, d.mode, d.input, d.resultText, d.chatMessages]);

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
            <div className="mb-sc-chat-msgs nodrag">
              {d.chatMessages.length === 0 && <div className="mb-sc-empty">和模型流式对话…</div>}
              {d.chatMessages.map((m, i) => (
                <div
                  key={i}
                  className={`mb-sc-chat-msg is-${m.role}`}
                  onContextMenu={(e) => m.content && chatMsgMenu(e, m.content)}
                  title="右键：复制 / 选段建提示词节点 / 放大查看"
                >
                  {m.content || (d.chatStreaming && i === d.chatMessages.length - 1 ? '…' : '')}
                </div>
              ))}
            </div>
            <div className="mb-sc-chat-input nodrag">
              <textarea
                className="mb-sc-input mb-sc-chat-ta"
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
                  className="mb-sc-llm-out nodrag"
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
