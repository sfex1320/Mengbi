import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useConversationStore } from '@/store/conversationStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useImageParamsStore } from '@/store/imageParamsStore';
import { useUIStore } from '@/store/uiStore';
import { toast } from '@/store/toastStore';
import { SendIcon, PlusIcon, XIcon, SparkleIcon, CheckIcon, TrashIcon } from './Icon';
import { openContextMenu } from './ContextMenu';
import './ChatPanel.css';

type Mode = 'chat' | 'image';

export function ChatPanel(): JSX.Element {
  const {
    list,
    activeId,
    messages,
    loadList,
    setActive,
    createConversation,
    appendUser,
    appendAssistantPlaceholder,
    appendDelta,
    markDone
  } = useConversationStore();
  const { plans, configs, activePlanId } = useSettingsStore();
  const params = useImageParamsStore();
  const ui = useUIStore();

  // 共享 draft，让右侧"AI 优化"按钮也能改写它
  const draft = params.chatDraft;
  const setDraft = params.setChatDraft;
  const mode = ui.chatMode as Mode;
  const setMode = (m: Mode): void => ui.setChatMode(m);
  const [pendingAssistantId, setPendingAssistantId] = useState<string | null>(null);
  const [pendingMessageId, setPendingMessageId] = useState<string | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 当前 plan 下所有"对话/多模态"模型映射的显示名
  const textModels = configs
    .filter((c) => c.plan_id === activePlanId && c.type === 'text')
    .flatMap((c) => Object.keys(c.model_mapping ?? {}));

  // 当前 plan 下所有绘画模型显示名
  const imageModels = configs
    .filter((c) => c.plan_id === activePlanId && c.type === 'image')
    .flatMap((c) => Object.keys(c.model_mapping ?? {}));

  const modelId = ui.chatModelId;
  const setModelId = (id: string): void => ui.setChatModelId(id);
  // 绘图模型从共享 store 取（右侧"绘图参数"面板控制）
  const imageModelId = params.imageModelId;


  useEffect(() => {
    if (textModels.length > 0 && !modelId) setModelId(textModels[0]);
  }, [textModels.join(','), modelId]);

  useEffect(() => {
    loadList().catch(() => undefined);
  }, [loadList]);

  // 监听 chat:chunk / chat:done
  useEffect(() => {
    if (!window.electronAPI?.on) return;
    const offChunk = window.electronAPI.on('chat:chunk', (payload) => {
      const p = payload as { id: string; delta: string };
      if (pendingMessageId && p.id === pendingMessageId && pendingAssistantId) {
        appendDelta(pendingAssistantId, p.delta);
        requestAnimationFrame(() => scrollToBottom());
      }
    });
    const offDone = window.electronAPI.on('chat:done', (payload) => {
      const p = payload as { id: string; cancelled?: boolean; error?: string };
      if (pendingMessageId && p.id === pendingMessageId && pendingAssistantId) {
        markDone(pendingAssistantId, { cancelled: p.cancelled });
        if (p.error) toast.error('对话失败', p.error);
        else if (p.cancelled) toast.info('已取消');
        setPendingAssistantId(null);
        setPendingMessageId(null);
      }
    });
    return () => {
      offChunk();
      offDone();
    };
  }, [pendingAssistantId, pendingMessageId, appendDelta, markDone]);

  function scrollToBottom(): void {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }

  async function newChat(): Promise<void> {
    if (plans.length === 0 || !activePlanId) {
      toast.error('请先在设置页创建一个方案');
      return;
    }
    if (textModels.length === 0) {
      toast.error('当前方案下还没有对话模型');
      return;
    }
    const modelToUse = modelId || textModels[0];
    const id = await createConversation('新对话', activePlanId, modelToUse);
    if (id) toast.success('已新建对话');
  }

  async function clearAllChats(): Promise<void> {
    if (
      !confirm(
        '确认清空全部对话？所有历史消息会被永久删除（图库中的图不受影响）。'
      )
    ) {
      return;
    }
    const r = await window.electronAPI.chat.clearAll();
    if (r.ok) {
      toast.success('已清空对话', `删除 ${r.data.removed} 条`);
      await loadList();
      setActive(null);
    } else {
      toast.error('清空失败', r.error.message);
    }
  }

  async function sendChat(): Promise<void> {
    if (!activeId) {
      await newChat();
      return;
    }
    const content = draft.trim();
    if (!content) return;
    if (!modelId) {
      toast.error('请先选择对话模型');
      return;
    }
    setDraft('');
    appendUser(content);
    const aid = appendAssistantPlaceholder();
    setPendingAssistantId(aid);
    requestAnimationFrame(() => scrollToBottom());
    const r = await window.electronAPI.chat.send({ conversationId: activeId, content });
    if (!r.ok) {
      toast.error('发送失败', r.error.message);
      markDone(aid);
      setPendingAssistantId(null);
      return;
    }
    setPendingMessageId(r.data.messageId);
  }

  async function generateImage(): Promise<void> {
    const content = draft.trim();
    if (!content) return;
    if (!activePlanId) {
      toast.error('请先在设置页创建一个方案');
      return;
    }
    if (imageModels.length === 0) {
      toast.error('当前方案下还没有绘画模型');
      return;
    }
    const imageModelToUse = imageModelId || imageModels[0];
    setImageBusy(true);

    setDraft('');
    if (activeId) {
      appendUser(content);
      const aid = appendAssistantPlaceholder();
      appendDelta(
        aid,
        [`🎨 已提交生图任务`, `Model: ${imageModelToUse}`, `Prompt: ${content}`].join('\n')
      );
      markDone(aid);
    }
    requestAnimationFrame(() => scrollToBottom());

    const r = await window.electronAPI.image.generate({
      modelId: imageModelToUse,
      positivePrompt: content,
      params: params.buildParams(),
      referenceImages: params.refPaths().length > 0 ? params.refPaths() : undefined
    });
    setImageBusy(false);
    if (!r.ok) {
      toast.error('生图提交失败', r.error.message);
      return;
    }
    toast.info('生图已入队', `任务 #${r.data.taskId}`);
  }

  async function copyText(text: string, setCopied: (v: boolean) => void): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      toast.error('复制失败');
    }
  }

  function useAsPrompt(text: string): void {
    setDraft(text);
    setMode('image');
    toast.info('已填入输入框', '可改 / 直接回车开始生图');
  }

  /** 通用：弹出右键菜单（复制 / 粘贴 / 用作生图） */
  function showCtx(
    e: React.MouseEvent,
    options: {
      /** 当前光标所在范围的内容（气泡全文 / textarea 全文） */
      fullText: string;
      /** 是否允许"粘贴"——只在可写入的输入框上显示 */
      canPaste?: boolean;
      /** 粘贴时的回写——把剪贴板内容塞进哪 */
      onPaste?: (text: string) => void;
    }
  ): void {
    e.preventDefault();
    const sel = (window.getSelection()?.toString() ?? '').trim();
    const targetForPrompt = sel.length > 0 ? sel : options.fullText;
    openContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: sel ? '复制选中' : '复制',
          disabled: !sel && !options.fullText,
          onClick: async () => {
            try {
              await navigator.clipboard.writeText(sel || options.fullText);
              toast.success('已复制');
            } catch {
              toast.error('复制失败');
            }
          }
        },
        ...(options.canPaste && options.onPaste
          ? [
              {
                label: '粘贴',
                onClick: async () => {
                  try {
                    const t = await navigator.clipboard.readText();
                    if (t) options.onPaste!(t);
                  } catch {
                    toast.error('粘贴失败');
                  }
                }
              }
            ]
          : []),
        {
          label: sel ? '用选中文字生图' : '用整段生图',
          variant: 'accent' as const,
          disabled: targetForPrompt.trim().length === 0,
          icon: <SparkleIcon size={12} />,
          onClick: () => useAsPrompt(targetForPrompt)
        }
      ]
    });
  }

  async function cancel(): Promise<void> {
    if (!pendingMessageId) return;
    await window.electronAPI.chat.cancel(pendingMessageId);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (mode === 'image') generateImage();
      else sendChat();
    }
    if (e.key === 'Escape' && pendingMessageId) {
      e.preventDefault();
      cancel();
    }
  }

  return (
    <div className="mb-chat">
      <div className="mb-chat-header">
        <select
          className="mb-chat-conv-select"
          value={activeId ?? ''}
          onChange={(e) => setActive(e.target.value || null)}
        >
          <option value="">选择对话…</option>
          {list.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
        <select
          className="mb-chat-model-select"
          value={modelId}
          onChange={(e) => setModelId(e.target.value)}
          title="对话模型 / AI 优化也用它"
        >
          {textModels.length === 0 && <option value="">未配置对话模型</option>}
          {textModels.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <button className="mb-btn mb-btn-secondary mb-btn-sm" onClick={newChat}>
          <PlusIcon size={14} /> 新建
        </button>
        <button
          className="mb-btn mb-btn-danger mb-btn-sm"
          onClick={clearAllChats}
          title="清空所有对话历史（不影响图库）"
        >
          <TrashIcon size={13} />
        </button>
      </div>

      <div ref={scrollRef} className="mb-chat-messages">
        <AnimatePresence initial={false}>
          {messages.length === 0 && (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mb-chat-empty"
            >
              <div>开始一段对话或直接生图</div>
              <div className="mb-chat-empty-hint">
                Enter 发送 · Shift+Enter 换行 · Esc 中断
              </div>
            </motion.div>
          )}
          {messages.map((m) => (
            <ChatBubble
              key={m.id}
              message={m}
              onCopy={(t, fn) => copyText(t, fn)}
              onUseAsPrompt={(t) => useAsPrompt(t)}
              onContextMenu={(e) =>
                showCtx(e, { fullText: m.content, canPaste: false })
              }
            />
          ))}
        </AnimatePresence>
      </div>

      <div className="mb-chat-composer">
        <div className="mb-chat-mode-row">
          <div className="mb-chat-mode-pills">
            <button
              type="button"
              className={`mb-chat-mode-pill ${mode === 'chat' ? 'is-active' : ''}`}
              onClick={() => setMode('chat')}
            >
              <SendIcon size={12} /> 对话
            </button>
            <button
              type="button"
              className={`mb-chat-mode-pill ${mode === 'image' ? 'is-active' : ''}`}
              onClick={() => setMode('image')}
            >
              <SparkleIcon size={12} /> 生图
            </button>
          </div>
        </div>
        <textarea
          className="mb-textarea"
          placeholder={
            mode === 'chat'
              ? activeId
                ? '问点什么…'
                : '点上方"新建"开始一段对话'
              : '一只趴在窗台的橘色猫咪…（按右侧"开始生图"或回车提交）'
          }
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onContextMenu={(e) =>
            showCtx(e, {
              fullText: draft,
              canPaste: true,
              onPaste: (t) => setDraft(draft + t)
            })
          }
        />
        <div className="mb-chat-composer-row">
          {pendingMessageId ? (
            <button className="mb-btn mb-btn-danger mb-btn-sm" onClick={cancel}>
              <XIcon size={14} /> 中断 (Esc)
            </button>
          ) : (
            <span className="mb-chat-tip">
              {mode === 'chat'
                ? 'Enter 发送 · Shift+Enter 换行'
                : '使用右侧面板的尺寸 / 参考图设置'}
            </span>
          )}
          <span style={{ flex: 1 }} />
          {mode === 'chat' ? (
            <button
              className="mb-btn mb-btn-primary mb-btn-sm"
              onClick={sendChat}
              disabled={!!pendingMessageId || !draft.trim()}
            >
              <SendIcon size={14} /> 发送
            </button>
          ) : (
            <button
              className="mb-btn mb-btn-primary mb-btn-sm"
              onClick={generateImage}
              disabled={imageBusy || !draft.trim()}
            >
              <SparkleIcon size={14} /> {imageBusy ? '生图中…' : '开始生图'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────
// 单条消息气泡：选中文字、整段复制、用作提示词
// ─────────────────────────────────────────────────────
interface ChatMessageLike {
  id: string;
  role: string;
  content: string;
  streaming?: boolean;
  cancelled?: boolean;
}

function ChatBubble({
  message,
  onCopy,
  onUseAsPrompt,
  onContextMenu
}: {
  message: ChatMessageLike;
  onCopy: (text: string, setCopied: (v: boolean) => void) => void;
  onUseAsPrompt: (text: string) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}): JSX.Element {
  const [copied, setCopied] = useState(false);
  // 选中片段后，光标停下时 capture 一下，让"用作提示词"按钮拿到选区
  const [selection, setSelection] = useState('');
  const bubbleRef = useRef<HTMLDivElement>(null);

  function captureSelection(): void {
    const sel = window.getSelection();
    if (!sel || sel.toString().trim().length === 0) {
      setSelection('');
      return;
    }
    if (bubbleRef.current && bubbleRef.current.contains(sel.anchorNode)) {
      setSelection(sel.toString());
    } else {
      setSelection('');
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className={`mb-chat-message mb-chat-${message.role}`}
    >
      <div
        ref={bubbleRef}
        className="mb-chat-bubble"
        onMouseUp={captureSelection}
        onKeyUp={captureSelection}
        onContextMenu={onContextMenu}
      >
        <div className="mb-chat-bubble-text">
          {message.content}
          {message.streaming && <span className="mb-chat-cursor" />}
          {message.cancelled && <span className="mb-chat-meta">·已取消</span>}
        </div>
        {!message.streaming && message.content.length > 0 && (
          <div className="mb-chat-bubble-actions">
            <button
              type="button"
              className="mb-bubble-action"
              onClick={() => onCopy(message.content, setCopied)}
              title="复制整段"
            >
              {copied ? <CheckIcon size={11} /> : <CopyGlyph />} {copied ? '已复制' : '复制'}
            </button>
            <button
              type="button"
              className="mb-bubble-action"
              onClick={() => onUseAsPrompt(selection.trim() || message.content)}
              title={selection ? '用选中的片段作为提示词' : '用整段作为提示词'}
            >
              <SparkleIcon size={11} /> {selection ? '选中片段生图' : '整段生图'}
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}

/** 极简 copy 图标（避免再加 import） */
function CopyGlyph(): JSX.Element {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
      <rect
        x="4.5"
        y="4.5"
        width="9"
        height="10"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path
        d="M11 4.5V3a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 3v8.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

void TrashIcon;
