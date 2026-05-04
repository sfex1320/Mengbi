import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useConversationStore } from '@/store/conversationStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useImageParamsStore } from '@/store/imageParamsStore';
import { useUIStore } from '@/store/uiStore';
import { toast } from '@/store/toastStore';
import { SendIcon, PlusIcon, XIcon, SparkleIcon, CheckIcon, TrashIcon } from './Icon';
import { openContextMenu } from './ContextMenu';
import { Lightbox } from './Lightbox';
import { confirmDialog } from './ConfirmDialog';
import { autoTag } from '@/lib/autoTag';
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
  const [previewImageSrc, setPreviewImageSrc] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 用户拖到对话区的待发送图片（多模态用）；下次 sendChat / generateImage 提交后清空
  const [attachedImages, setAttachedImages] = useState<
    Array<{ dataUri: string; path?: string }>
  >([]);
  const [composerDragOver, setComposerDragOver] = useState(false);

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

  // 流式 chunk 频率可能很高（每字符一条），按 rAF 批一次再写到 store，
  // 否则长回复（如几千字代码）会把 React 渲染压垮 → UI 卡死
  const chunkBufferRef = useRef('');
  const chunkFlushRafRef = useRef(0);

  // 监听 chat:chunk / chat:done
  useEffect(() => {
    if (!window.electronAPI?.on) return;
    const offChunk = window.electronAPI.on('chat:chunk', (payload) => {
      const p = payload as { id: string; delta: string };
      if (!pendingMessageId || p.id !== pendingMessageId || !pendingAssistantId) {
        return;
      }
      chunkBufferRef.current += p.delta;
      if (chunkFlushRafRef.current === 0) {
        chunkFlushRafRef.current = requestAnimationFrame(() => {
          chunkFlushRafRef.current = 0;
          const buf = chunkBufferRef.current;
          chunkBufferRef.current = '';
          if (buf && pendingAssistantId) {
            appendDelta(pendingAssistantId, buf);
            scrollToBottom();
          }
        });
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

  // 跨页面记住滚动位置：每次滚动节流写到 ui store；mount + 消息变化时恢复
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    function onScroll(): void {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        ui.setChatScrollTop(el!.scrollTop);
      });
    }
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('scroll', onScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 挂载 + messages 变化时把滚动条恢复到上次位置
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // 等下一帧让 DOM 真正渲染完
    requestAnimationFrame(() => {
      const target = ui.chatScrollTop;
      // 若上次接近底部（差距 < 200），就跟随到底；否则严格还原
      if (
        target > 0 &&
        Math.abs(el.scrollHeight - target - el.clientHeight) < 200
      ) {
        el.scrollTop = el.scrollHeight;
      } else {
        el.scrollTop = target;
      }
    });
    // 只在 messages 长度从 0→N（首次填充）时跑；之后用户滚动以 store 为准
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length === 0]);

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
    const ok = await confirmDialog({
      title: '清空全部对话',
      message: '确认清空全部对话？',
      detail: '所有历史消息会被永久删除（图库中的图不受影响）。',
      okText: '清空',
      danger: true
    });
    if (!ok) return;
    const r = await window.electronAPI.chat.clearAll();
    if (r.ok) {
      toast.success('已清空对话', `删除 ${r.data.removed} 条`);
      await loadList();
      setActive(null);
    } else {
      toast.error('清空失败', r.error.message);
    }
  }

  async function deleteCurrentChat(): Promise<void> {
    if (!activeId) return;
    const ok = await confirmDialog({
      title: '删除对话',
      message: '删除当前这条对话？',
      detail: '仅删除这一条，其他对话不受影响。',
      okText: '删除',
      danger: true
    });
    if (!ok) return;
    const r = await window.electronAPI.chat.delete(activeId);
    if (r.ok) {
      toast.success('已删除');
      await loadList();
      setActive(null);
    } else {
      toast.error('删除失败', r.error.message);
    }
  }

  /**
   * 把对话重命名为 "MM-DD HH:MM：第一句话前 24 字"。
   * 仅在标题还是默认占位时触发，避免覆盖用户手动改的名字。
   */
  async function autoRenameConversation(content: string): Promise<void> {
    if (!activeId) return;
    const cur = list.find((c) => c.id === activeId);
    if (!cur) return;
    if (cur.title !== '新对话' && !/^\d{2}-\d{2} \d{2}:\d{2}：/.test(cur.title)) return;
    const d = new Date();
    const stamp =
      String(d.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(d.getDate()).padStart(2, '0') +
      ' ' +
      String(d.getHours()).padStart(2, '0') +
      ':' +
      String(d.getMinutes()).padStart(2, '0');
    const summary = content.replace(/\s+/g, ' ').trim().slice(0, 24) || '（无文本）';
    const title = `${stamp}：${summary}`;
    const r = await window.electronAPI.chat.rename({ id: activeId, title });
    if (r.ok) loadList();
  }

  async function sendChat(): Promise<void> {
    if (!activeId) {
      await newChat();
      return;
    }
    const content = draft.trim();
    if (!content && attachedImages.length === 0) return;
    if (!modelId) {
      toast.error('请先选择对话模型');
      return;
    }
    // 附图但当前模型没勾 vision —— 警告而不是直接拒绝（避免阻塞用户）
    if (attachedImages.length > 0) {
      const cur = configs.find(
        (c) =>
          c.plan_id === activePlanId &&
          c.type === 'text' &&
          (c.model_mapping ?? {})[modelId] !== undefined
      );
      if (cur && !cur.supports_vision) {
        const ok = await confirmDialog({
          title: '此模型未标记支持 vision',
          message: `当前模型「${modelId}」没有勾"支持 vision"。`,
          detail:
            '强行附图发送可能：\n· 模型不识别图片，回复无关内容（如代码 / 乱码）\n· 上游报错或挂起\n\n建议先在设置里勾上 vision 或换 GPT-4o / Claude / Gemini / Qwen-VL 等多模态模型。',
          okText: '继续发送',
          danger: true
        });
        if (!ok) return;
      }
    }
    const images = attachedImages.map((a) => a.dataUri);
    setDraft('');
    setAttachedImages([]);
    // 重要：不把 dataUri 拼进 content 文本——一张 1MB 图变成 megabytes 的字符串，
    // React 每次重渲都要 diff 这个字符串 → UI 卡死。改为单独 attachments 字段。
    appendUser(content, images);
    // 第一句话出去时把对话名改成 "时间：内容摘要"，更容易在列表里区分
    void autoRenameConversation(content || (images.length > 0 ? '[发送了图片]' : ''));
    const aid = appendAssistantPlaceholder();
    setPendingAssistantId(aid);
    requestAnimationFrame(() => scrollToBottom());
    const r = await window.electronAPI.chat.send({
      conversationId: activeId,
      content,
      attachedImages: images.length > 0 ? images : undefined
    });
    if (!r.ok) {
      toast.error('发送失败', r.error.message);
      markDone(aid);
      setPendingAssistantId(null);
      return;
    }
    setPendingMessageId(r.data.messageId);
  }

  // ─── 拖拽进对话区 ───
  function probe(dataUri: string): Promise<{ w: number; h: number }> {
    return new Promise((resolve) => {
      const im = new Image();
      im.onload = () => resolve({ w: im.naturalWidth, h: im.naturalHeight });
      im.onerror = () => resolve({ w: 0, h: 0 });
      im.src = dataUri;
    });
  }

  async function attachFiles(files: FileList | File[]): Promise<void> {
    const arr = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (arr.length === 0) return;
    const next: typeof attachedImages = [];
    for (const f of arr.slice(0, 8)) {
      const dataUri = await new Promise<string>((res) => {
        const r = new FileReader();
        r.onload = () => res(typeof r.result === 'string' ? r.result : '');
        r.onerror = () => res('');
        r.readAsDataURL(f);
      });
      if (!dataUri) continue;
      next.push({ dataUri, path: (f as File & { path?: string }).path });
    }
    if (next.length === 0) {
      toast.error('图片读取失败');
      return;
    }
    setAttachedImages((cur) => [...cur, ...next].slice(0, 8));
  }

  /** 接受从右侧参考图区拖过来的：dataTransfer.types 含 mb-ref-uri 时 */
  function handleComposerDrop(e: React.DragEvent): void {
    e.preventDefault();
    setComposerDragOver(false);
    const refUri = e.dataTransfer.getData('mb-ref-uri');
    if (refUri) {
      setAttachedImages((cur) => [...cur, { dataUri: refUri }].slice(0, 8));
      return;
    }
    if (e.dataTransfer.files?.length) {
      void attachFiles(e.dataTransfer.files);
    }
  }

  /** 把附图加到右侧参考图（双向流动） */
  async function sendAttachToRefs(idx: number): Promise<void> {
    const a = attachedImages[idx];
    if (!a) return;
    const { w, h } = await probe(a.dataUri);
    params.addRefs([{ path: a.path ?? '', dataUri: a.dataUri, width: w, height: h }]);
    toast.success('已添加到参考图');
  }

  function removeAttach(idx: number): void {
    setAttachedImages((cur) => cur.filter((_, i) => i !== idx));
  }

  /** 气泡里已发出的图片右键菜单：复制 / 加到参考图 */
  async function showBubbleImageMenu(e: React.MouseEvent, src: string): Promise<void> {
    openContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: '复制图片',
          onClick: async () => {
            try {
              const r = await fetch(src);
              const blob = await r.blob();
              const out = blob.type === 'image/png' ? blob : await rasterizeToPng(blob);
              await navigator.clipboard.write([
                new ClipboardItem({ 'image/png': out })
              ]);
              toast.success('图片已复制');
            } catch (err) {
              toast.error('复制失败', (err as Error).message);
            }
          }
        },
        {
          label: '加到参考图',
          variant: 'accent',
          icon: <PlusIcon size={12} />,
          onClick: async () => {
            const probed = await new Promise<{ w: number; h: number }>((res) => {
              const im = new Image();
              im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight });
              im.onerror = () => res({ w: 0, h: 0 });
              im.src = src;
            });
            params.addRefs([
              { path: '', dataUri: src, width: probed.w, height: probed.h }
            ]);
            toast.success('已加到参考图');
          }
        }
      ]
    });
  }

  function showAttachMenu(e: React.MouseEvent, idx: number): void {
    e.preventDefault();
    const a = attachedImages[idx];
    if (!a) return;
    openContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: '复制图片',
          onClick: async () => {
            try {
              const r = await fetch(a.dataUri);
              const blob = await r.blob();
              await navigator.clipboard.write([
                new ClipboardItem({ [blob.type]: blob })
              ]);
              toast.success('已复制图片');
            } catch {
              toast.error('复制失败');
            }
          }
        },
        {
          label: '加到参考图',
          variant: 'accent',
          icon: <PlusIcon size={12} />,
          onClick: () => sendAttachToRefs(idx)
        },
        {
          label: '移除',
          variant: 'danger',
          icon: <TrashIcon size={12} />,
          onClick: () => removeAttach(idx)
        }
      ]
    });
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
        },
        {
          label: sel ? '加入提示词管家（选中）' : '加入提示词管家（整段）',
          icon: <PlusIcon size={12} />,
          disabled: targetForPrompt.trim().length === 0,
          onClick: () => saveToPromptLibrary(targetForPrompt)
        }
      ]
    });
  }

  /** 把一段文字直接归档到提示词管家（图片类，自动打标签） */
  async function saveToPromptLibrary(text: string): Promise<void> {
    const t = text.trim();
    if (!t) return;
    const auto = autoTag(t, modelId || null, [], 10);
    const r = await window.electronAPI.prompt.upsert({
      title: t.slice(0, 40),
      text: t,
      kind: 'image',
      tags: auto.merged,
      notes: '从对话中归档'
    });
    if (r.ok) toast.success('已加入提示词管家');
    else toast.error('归档失败', r.error.message);
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
          className="mb-btn mb-btn-secondary mb-btn-sm"
          onClick={deleteCurrentChat}
          disabled={!activeId}
          title="只删除当前这一条对话"
        >
          <TrashIcon size={12} /> 删
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
              onPreviewImage={(src) => setPreviewImageSrc(src)}
              onImageContextMenu={(e, src) => showBubbleImageMenu(e, src)}
              onContextMenu={(e) =>
                showCtx(e, { fullText: m.content, canPaste: false })
              }
            />
          ))}
        </AnimatePresence>
      </div>

      <div
        className={`mb-chat-composer ${composerDragOver ? 'is-dragover' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setComposerDragOver(true);
        }}
        onDragLeave={() => setComposerDragOver(false)}
        onDrop={handleComposerDrop}
      >
        {attachedImages.length > 0 && (
          <div className="mb-chat-attach-row">
            {attachedImages.map((a, i) => (
              <div
                key={i}
                className="mb-chat-attach-thumb"
                onContextMenu={(e) => showAttachMenu(e, i)}
                title="右键 复制 / 加到参考图 / 移除"
              >
                <img src={a.dataUri} alt={`附图 ${i + 1}`} draggable={false} />
                <button
                  type="button"
                  className="mb-chat-attach-x"
                  onClick={() => removeAttach(i)}
                  title="移除"
                >
                  ×
                </button>
              </div>
            ))}
            <div className="mb-chat-attach-hint">{attachedImages.length} / 8 · 右键有更多</div>
          </div>
        )}
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
        {/* 提示词快捷按钮：在管家里勾"加快捷"的 prompt 出现在这里 */}
        {ui.shortcutPromptIds.length > 0 && (
          <div className="mb-chat-shortcuts">
            {ui.shortcutPromptIds.map((id) => {
              const cached = ui.shortcutPromptCache[id];
              if (!cached) return null;
              return (
                <button
                  key={id}
                  type="button"
                  className="mb-chat-shortcut"
                  onClick={() => setDraft(cached.text)}
                  title={cached.text}
                >
                  <span className="mb-chat-shortcut-icon">⚡</span>
                  <span className="mb-chat-shortcut-label">{cached.title}</span>
                </button>
              );
            })}
          </div>
        )}
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

      <Lightbox
        open={previewImageSrc !== null}
        src={previewImageSrc ?? ''}
        onClose={() => setPreviewImageSrc(null)}
      />
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
  attachments?: string[];
  streaming?: boolean;
  cancelled?: boolean;
}

function ChatBubble({
  message,
  onCopy,
  onUseAsPrompt,
  onContextMenu,
  onPreviewImage,
  onImageContextMenu
}: {
  message: ChatMessageLike;
  onCopy: (text: string, setCopied: (v: boolean) => void) => void;
  onUseAsPrompt: (text: string) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onPreviewImage?: (src: string) => void;
  onImageContextMenu?: (e: React.MouseEvent, src: string) => void;
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

  const hasContent = message.content.length > 0;
  const hasAttachments = (message.attachments?.length ?? 0) > 0;

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
        {hasAttachments && (
          <div className="mb-chat-bubble-images">
            {message.attachments!.map((src, i) => (
              <button
                key={i}
                type="button"
                className="mb-chat-bubble-img"
                onClick={() => onPreviewImage?.(src)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onImageContextMenu?.(e, src);
                }}
                title="点击放大 · 右键复制 / 加到参考图 · 拖动可拖到本地或参考图区"
              >
                <img
                  src={src}
                  alt={`附图 ${i + 1}`}
                  loading="lazy"
                  // 有意保留 draggable=true 让 dragstart 触发；OS 拖拽由 preventDefault + IPC 接管
                  draggable
                  onDragStart={(e) => {
                    // 同时塞 mb-ref-uri 到 dataTransfer，方便 ref 面板的同窗口 drop 直接读
                    e.dataTransfer.setData('mb-ref-uri', src);
                    e.dataTransfer.effectAllowed = 'copy';
                    if (src.startsWith('data:')) {
                      // OS 文件级拖拽：preventDefault 取消 HTML5 拖拽，让主进程起 startDrag
                      e.preventDefault();
                      window.electronAPI.drag.startFromDataUri(src, `mengbi-${i + 1}`);
                    } else if (src.startsWith('mengbi-image://')) {
                      // mengbi-image:// → 解码原始文件路径，让主进程拖该文件
                      try {
                        const u = new URL(src);
                        // path = /<base64url>，url 编码的 file path
                        const b64 = decodeURIComponent(u.pathname.slice(1));
                        const filePath = atob(
                          b64.replace(/-/g, '+').replace(/_/g, '/')
                        );
                        e.preventDefault();
                        window.electronAPI.drag.startFromPath(filePath);
                      } catch {
                        // 解析失败就让 HTML5 默认拖拽继续（同窗口 drop 还能用 mb-ref-uri）
                      }
                    }
                  }}
                />
              </button>
            ))}
          </div>
        )}
        {hasContent && (
          <div className="mb-chat-bubble-text">
            {message.content}
            {message.streaming && <span className="mb-chat-cursor" />}
            {message.cancelled && <span className="mb-chat-meta">·已取消</span>}
          </div>
        )}
        {!hasContent && message.streaming && (
          <div className="mb-chat-bubble-text">
            <span className="mb-chat-cursor" />
          </div>
        )}
        {!message.streaming && hasContent && (
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

/** Blob → image/png Blob，用于 navigator.clipboard.write 兼容性 */
async function rasterizeToPng(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return blob;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
      'image/png'
    );
  });
}
