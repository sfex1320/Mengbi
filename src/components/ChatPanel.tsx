import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useConversationStore } from '@/store/conversationStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useImageParamsStore, REF_TYPE_LABEL, type RefType } from '@/store/imageParamsStore';
import { importImageToCanvas } from '@/pages/Canvas/importToCanvas';
import { useUIStore } from '@/store/uiStore';
import { useSmartInboxStore } from '@/store/smartInboxStore';
import { toast } from '@/store/toastStore';
import { SendIcon, PlusIcon, XIcon, SparkleIcon, CheckIcon, TrashIcon } from './Icon';
import { openContextMenu } from './ContextMenu';
import { Lightbox } from './Lightbox';
import { confirmDialog } from './ConfirmDialog';
import { CustomSelect, type SelectOption } from './CustomSelect';
import { listMappedModels } from '@/lib/modelMapping';
import './ChatPanel.css';

type Mode = 'chat' | 'image';

/** 把模型能力标签名映射成 CSS modifier(供主题着色) */
function tagKind(t: string): string {
  if (t === '联网') return 'web';
  if (t === '视觉') return 'vision';
  if (t === '思考') return 'thinking';
  return 'default';
}

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
    appendReasoning,
    markDone,
    setSources
  } = useConversationStore();
  const { plans, configs, activePlanId } = useSettingsStore();
  const params = useImageParamsStore();
  const ui = useUIStore();
  const navigate = useNavigate();

  // 共享 draft，让右侧"AI 优化"按钮也能改写它
  const draft = params.chatDraft;
  const setDraft = params.setChatDraft;
  const mode = ui.chatMode as Mode;
  const setMode = (m: Mode): void => ui.setChatMode(m);
  const [pendingMessageId, setPendingMessageId] = useState<string | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const [previewImageSrc, setPreviewImageSrc] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  /**
   * 🌐 联网搜索 toggle —— 用户勾上后,本会话内每条消息都会带 forceWebSearch=true,
   * 让 chat.ts 触发代搜(忽略方案配置里的 supports_web_search 字段)。
   * 这样用户不用去深处的方案配置里找开关,聊天界面一键切换。
   */
  const [webSearchOn, setWebSearchOn] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!moreOpen) return;
    function onDown(e: MouseEvent): void {
      if (
        moreMenuRef.current &&
        !moreMenuRef.current.contains(e.target as Node)
      ) {
        setMoreOpen(false);
      }
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setMoreOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [moreOpen]);

  // 附图与生图参考图已合一：统一从 imageParamsStore.refs 读 / 写。
  // 对话模式发送时拼成 attachedImages 喂视觉模型；生图模式作为参考图传给绘画模型。
  // attachedImages 字段名沿用是为了下游 IPC 兼容，view 层直接渲染 params.refs。
  const attachedImages = params.refs.map((r) => ({ dataUri: r.dataUri, path: r.path }));
  const [composerDragOver, setComposerDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 当前 plan 下「对话/多模态」模型（含不可用项；不可用=实际ID为空，下拉里标灰禁选）
  const textMapped = listMappedModels(configs, activePlanId, 'text');
  // 可用名单：用于默认选择 / 判断是否有可用对话模型
  const textModels = textMapped.filter((m) => m.usable).map((m) => m.name);

  /** 下拉选项：不可用项 disabled + 标注「（实际ID未填）」；能力徽标只给可用项 */
  const textModelOptions: SelectOption<string>[] = textMapped.map((m) => {
    const cfg = configs.find(
      (c) =>
        c.plan_id === activePlanId &&
        c.type === 'text' &&
        (c.model_mapping ?? {})[m.name] !== undefined
    );
    return {
      value: m.name,
      label: m.usable ? m.name : `${m.name}（实际ID未填）`,
      disabled: !m.usable,
      meta:
        cfg && m.usable
          ? [
              cfg.supports_web_search ? '联网' : null,
              cfg.supports_vision ? '视觉' : null,
              cfg.supports_thinking ? '思考' : null
            ]
              .filter(Boolean)
              .join(' · ')
          : undefined
    };
  });

  // 当前 plan 下绘画模型显示名（ComfyUI 在「本地大模型」页独立管理，此处剔除；并跳过实际ID为空的）
  const imageModels = configs
    .filter(
      (c) =>
        c.plan_id === activePlanId && c.type === 'image' && c.image_kind !== 'comfyui'
    )
    .flatMap((c) =>
      Object.entries(c.model_mapping ?? {})
        .filter(([, v]) => v && v.trim())
        .map(([k]) => k)
    );

  const modelId = ui.chatModelId;
  const setModelId = (id: string): void => ui.setChatModelId(id);
  // 当前对话模型对应的配置——用于读取 supports_web_search / supports_vision 展示能力徽标
  const currentTextConfig = configs.find(
    (c) =>
      c.plan_id === activePlanId &&
      c.type === 'text' &&
      (c.model_mapping ?? {})[modelId] !== undefined
  );
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
  // 思考流单独缓冲——和正文走同一套 rAF 节流策略，但两通道不混
  const reasoningBufferRef = useRef('');
  const reasoningFlushRafRef = useRef(0);
  // 路由用「在途回复」标识改走 ref（不进监听依赖）：监听只注册一次，靠 ref 拿最新值。
  // 解决长时间空闲后首条对话「await chat.send 返回前 chunk 已到 → 被 pendingMessageId=null 丢弃」的竞态。
  const pendingAidRef = useRef<string | null>(null);
  const pendingMidRef = useRef<string | null>(null);

  // 监听 chat:chunk / chat:reasoning-chunk / chat:done / chat:sources（只注册一次，靠 ref 路由）
  useEffect(() => {
    if (!window.electronAPI?.on) return;
    // 认领本轮回复的 messageId：有在途回复(aid)但还没拿到 id 时，首个事件的 id 即本轮 id。
    // 返回该事件是否属于本轮（应处理）。chat:done 不走认领（用严格匹配），避免上一轮残留的 done 误重置。
    const adopt = (id: string): boolean => {
      if (!pendingAidRef.current) return false;
      if (!pendingMidRef.current) {
        pendingMidRef.current = id;
        setPendingMessageId(id); // 同步给 UI（取消按钮 / 输入禁用态用 state）
      }
      return id === pendingMidRef.current;
    };
    const offChunk = window.electronAPI.on('chat:chunk', (payload) => {
      const p = payload as { id: string; delta: string };
      if (!adopt(p.id)) return;
      chunkBufferRef.current += p.delta;
      if (chunkFlushRafRef.current === 0) {
        chunkFlushRafRef.current = requestAnimationFrame(() => {
          chunkFlushRafRef.current = 0;
          const buf = chunkBufferRef.current;
          chunkBufferRef.current = '';
          const aid = pendingAidRef.current;
          if (buf && aid) {
            appendDelta(aid, buf);
            scrollToBottom();
          }
        });
      }
    });
    const offReasoning = window.electronAPI.on('chat:reasoning-chunk', (payload) => {
      const p = payload as { id: string; delta: string };
      if (!adopt(p.id)) return;
      reasoningBufferRef.current += p.delta;
      if (reasoningFlushRafRef.current === 0) {
        reasoningFlushRafRef.current = requestAnimationFrame(() => {
          reasoningFlushRafRef.current = 0;
          const buf = reasoningBufferRef.current;
          reasoningBufferRef.current = '';
          const aid = pendingAidRef.current;
          if (buf && aid) appendReasoning(aid, buf);
        });
      }
    });
    const offDone = window.electronAPI.on('chat:done', (payload) => {
      const p = payload as { id: string; cancelled?: boolean; error?: string };
      // done 严格匹配（不认领）：此时 chat.send 早已返回、pendingMidRef 必已就位
      const aid = pendingAidRef.current;
      if (!pendingMidRef.current || p.id !== pendingMidRef.current || !aid) return;
      markDone(aid, { cancelled: p.cancelled });
      if (p.error) toast.error('对话失败', p.error);
      else if (p.cancelled) toast.info('已取消');
      pendingAidRef.current = null;
      pendingMidRef.current = null;
      setPendingMessageId(null);
    });
    const offSources = window.electronAPI.on('chat:sources', (payload) => {
      const p = payload as {
        id: string;
        backend: string;
        hits: Array<{ title: string; url: string; snippet: string; hostname: string }>;
        /** 代搜失败 / 后端配置错时填,直接弹 toast 不写入消息 */
        error?: string;
      };
      if (!adopt(p.id)) return;
      if (p.error) toast.error('🌐 联网搜索失败', p.error);
      else if (pendingAidRef.current) setSources(pendingAidRef.current, p.hits);
    });
    return () => {
      offChunk();
      offReasoning();
      offDone();
      offSources();
      // 切流（取消 → 立刻新建）时若还有挂着的 rAF，会把旧流尾巴写进新消息——清掉
      if (chunkFlushRafRef.current !== 0) {
        cancelAnimationFrame(chunkFlushRafRef.current);
        chunkFlushRafRef.current = 0;
      }
      if (reasoningFlushRafRef.current !== 0) {
        cancelAnimationFrame(reasoningFlushRafRef.current);
        reasoningFlushRafRef.current = 0;
      }
      chunkBufferRef.current = '';
      reasoningBufferRef.current = '';
    };
  }, [appendDelta, appendReasoning, markDone, setSources]);

  function scrollToBottom(): void {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }

  // 按对话记住滚动位置（conversationId → top）：每次滚动节流写回当前对话；切对话/首次填充时恢复。
  // 用全局单值会在快速切换 A→B→A 时被 B 的位置覆盖，回到 A 恢复错位 —— 故按对话分别记。
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !activeId) return;
    let raf = 0;
    function onScroll(): void {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => useUIStore.getState().setChatScrollTop(activeId!, el!.scrollTop));
    }
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('scroll', onScroll);
    };
  }, [activeId]);

  // 切对话 + messages 首次填充时，把滚动条恢复到该对话上次的位置
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !activeId) return;
    requestAnimationFrame(() => {
      const target = useUIStore.getState().chatScrollTops[activeId] ?? 0;
      // 若上次接近底部（差距 < 200），就跟随到底；否则严格还原
      if (target > 0 && Math.abs(el.scrollHeight - target - el.clientHeight) < 200) {
        el.scrollTop = el.scrollHeight;
      } else {
        el.scrollTop = target;
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, messages.length === 0]);

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
    // 并发发送守卫：上一条回复仍在流式中(pendingAidRef 占着)时不允许再发——否则它的
    // 在途 chunk 会被路由到新气泡造成串台（pendingAidRef 被换到新轮、旧轮 chunk 仍被认领）。
    // UI 此时本就把"发送"换成"停止"，这里兜底防 Enter 在首个 chunk 到达前抢跑那一小段窗口。
    if (pendingAidRef.current) {
      toast.info('上一条还在回复中', '请等它完成，或按 Esc 中断后再发');
      return;
    }
    const content = draft.trim();
    if (!content && attachedImages.length === 0) return;
    if (!modelId) {
      toast.error('请先选择对话模型');
      return;
    }
    // 附图必须命中 vision 模型——直接拒，不让请求白白往上游发（避免 image_url 被 Rust serde 400 拒）。
    if (attachedImages.length > 0 && currentTextConfig && !currentTextConfig.supports_vision) {
      toast.error(
        '该模型未启用视觉支持',
        `「${modelId}」方案没勾「支持 vision」。请到「设置 → 方案」勾上，或换 GPT-4o / Claude / Gemini / Qwen-VL 等多模态模型；也可移除附图后仅发文本。`
      );
      return;
    }
    const images = attachedImages.map((a) => a.dataUri);
    setDraft('');
    // 发送后保留附图（不再无条件 clearRefs）：支持「同一组图多轮追问（做 A / 做 B / 做 C）」，
    // 也避免切到生图 tab 再回来时参考图「跟丢」。不需要时用户可手动移除某张。
    // 重要：不把 dataUri 拼进 content 文本——一张 1MB 图变成 megabytes 的字符串，
    // React 每次重渲都要 diff 这个字符串 → UI 卡死。改为单独 attachments 字段。
    appendUser(content, images);
    // 第一句话出去时把对话名改成 "时间：内容摘要"，更容易在列表里区分
    void autoRenameConversation(content || (images.length > 0 ? '[发送了图片]' : ''));
    const aid = appendAssistantPlaceholder();
    pendingAidRef.current = aid; // 在 await 之前就位：早到的 chunk/sources 能被认领，不再被丢弃
    pendingMidRef.current = null;
    requestAnimationFrame(() => scrollToBottom());
    const r = await window.electronAPI.chat.send({
      conversationId: activeId,
      content,
      attachedImages: images.length > 0 ? images : undefined,
      forceWebSearch: webSearchOn || undefined
    });
    if (!r.ok) {
      toast.error('发送失败', r.error.message);
      markDone(aid);
      pendingAidRef.current = null;
      pendingMidRef.current = null; // 失败也清掉在途 messageId，避免下一轮认领/取消错乱
      return;
    }
    // 首个事件若已认领同一 messageId，这里值相同；否则在此就位
    if (!pendingMidRef.current) {
      pendingMidRef.current = r.data.messageId;
      setPendingMessageId(r.data.messageId);
    }
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
    const remaining = 16 - params.refs.length;
    if (remaining <= 0) {
      toast.error('附图已达上限', '最多 16 张');
      return;
    }
    const accepted = arr.slice(0, remaining);
    // 并行读取 + 量尺寸：串行 await 在多张大图时会阻塞 UI 线程（输入/滚动卡顿）
    const results = await Promise.all(
      accepted.map(async (f) => {
        const dataUri = await new Promise<string>((res) => {
          const r = new FileReader();
          r.onload = () => res(typeof r.result === 'string' ? r.result : '');
          r.onerror = () => {
            console.warn('[chat] FileReader 读取失败', f.name);
            res('');
          };
          r.readAsDataURL(f);
        });
        if (!dataUri) return null;
        const dim = await probe(dataUri);
        return { path: (f as File & { path?: string }).path ?? '', dataUri, width: dim.w, height: dim.h };
      })
    );
    const enriched = results.filter(Boolean) as Array<{ path: string; dataUri: string; width: number; height: number }>;
    const failed = accepted.length - enriched.length;
    if (enriched.length === 0) {
      toast.error('图片读取失败', failed > 1 ? `${failed} 张均无法读取（可能文件损坏或无权限）` : undefined);
      return;
    }
    params.addRefs(enriched);
    if (failed > 0) toast.info('部分图片读取失败', `已跳过 ${failed} 张`);
    if (arr.length > remaining) {
      toast.info('已截断到 16 张上限', `丢弃 ${arr.length - remaining} 张`);
    }
  }

  /** 用原生文件选择器添加附图（替代旧的右侧面板「拖入 / 点击」入口） */
  async function pickAndAttach(): Promise<void> {
    if (window.electronAPI?.storage?.pickImages) {
      const r = await window.electronAPI.storage.pickImages();
      if (!r.ok) {
        toast.error('选择失败', r.error.message);
        return;
      }
      if (r.data.files.length === 0) return;
      const remaining = 16 - params.refs.length;
      if (remaining <= 0) {
        toast.error('附图已达上限', '最多 16 张');
        return;
      }
      const enriched = await Promise.all(
        r.data.files.slice(0, remaining).map(async (f) => {
          const { w, h } = await probe(f.dataUri);
          return { ...f, width: w, height: h };
        })
      );
      params.addRefs(enriched);
      if (r.data.files.length > remaining) {
        toast.info('已截断到 16 张上限', `丢弃 ${r.data.files.length - remaining} 张`);
      }
      return;
    }
    fileInputRef.current?.click();
  }

  function handleComposerDrop(e: React.DragEvent): void {
    e.preventDefault();
    setComposerDragOver(false);
    if (e.dataTransfer.files?.length) {
      void attachFiles(e.dataTransfer.files);
    }
  }

  function removeAttach(idx: number): void {
    params.removeRefAt(idx);
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
        },
        { separator: true },
        {
          label: '转入工具箱…',
          icon: <PlusIcon size={12} />,
          children: [
            {
              label: '保真放大（Real-ESRGAN）',
              onClick: () => void sendBubbleImgToTool(src, 'upscale')
            },
            {
              label: 'AI 修复放大 · HYPIR',
              onClick: () => void sendBubbleImgToTool(src, 'hypir')
            }
          ]
        },
        { separator: true },
        {
          label: '发送到智能画布',
          icon: <PlusIcon size={12} />,
          onClick: () => {
            useSmartInboxStore.getState().push([{ src, name: '对话图片' }]);
            navigate('/smart-canvas');
            toast.success('已发送到智能画布');
          }
        }
      ]
    });
  }

  /** 把对话气泡里的图片送到工具箱（指定 tab） */
  async function sendBubbleImgToTool(
    src: string,
    target: 'upscale' | 'hypir'
  ): Promise<void> {
    try {
      const r = await fetch(src);
      const blob = await r.blob();
      const dataUri = await new Promise<string>((res, rej) => {
        const rd = new FileReader();
        rd.onload = () => res(typeof rd.result === 'string' ? rd.result : '');
        rd.onerror = () => rej(rd.error);
        rd.readAsDataURL(blob);
      });
      const { useToolsStore } = await import('@/store/toolsStore');
      useToolsStore.setState({ pendingImport: dataUri, activeTab: target });
      navigate('/tools');
    } catch (e) {
      toast.error('发送失败', String(e));
    }
  }

  function showAttachMenu(e: React.MouseEvent, idx: number): void {
    e.preventDefault();
    const a = attachedImages[idx];
    if (!a) return;
    const ref = params.refs[idx];
    const enabled = ref?.enabled !== false;
    openContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: '设为首图（决定 auto 比例）',
          disabled: idx === 0,
          onClick: () => params.moveRefToFront(idx)
        },
        {
          label: `参考类型：${ref?.refType ? REF_TYPE_LABEL[ref.refType] : '未设'}`,
          children: (Object.keys(REF_TYPE_LABEL) as RefType[]).map((t) => ({
            label: REF_TYPE_LABEL[t],
            onClick: () => params.updateRefAt(idx, { refType: t })
          }))
        },
        {
          label: `权重：${(ref?.weight ?? 1).toFixed(2)}`,
          children: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2].map((w) => ({
            label: w.toFixed(2),
            onClick: () => params.updateRefAt(idx, { weight: w })
          }))
        },
        {
          label: enabled ? '停用（本次不参与）' : '启用',
          onClick: () => params.updateRefAt(idx, { enabled: !enabled })
        },
        { separator: true },
        {
          label: '在画板中编辑',
          icon: <SparkleIcon size={12} />,
          onClick: () => {
            const img = new Image();
            img.onload = () => {
              importImageToCanvas(
                { sourcePath: ref?.path || null, dataUri: a.dataUri, width: img.naturalWidth, height: img.naturalHeight, name: ref?.name ?? '参考图' },
                'current'
              );
              navigate('/canvas');
            };
            img.onerror = () => toast.error('加载失败');
            img.src = a.dataUri;
          }
        },
        {
          label: '复制图片',
          onClick: async () => {
            try {
              const r = await fetch(a.dataUri);
              const blob = await r.blob();
              await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
              toast.success('已复制图片');
            } catch {
              toast.error('复制失败');
            }
          }
        },
        {
          label: '放大预览',
          onClick: () => setPreviewImageSrc(a.dataUri)
        },
        {
          label: '另存为…',
          onClick: async () => {
            const r = await window.electronAPI.storage.saveAs({
              dataUri: a.dataUri,
              defaultName: `${ref?.name ?? 'reference'}.png`,
              filters: [{ name: '图片', extensions: ['png', 'jpg', 'webp'] }]
            });
            if (r.ok && r.data) toast.success('已保存');
          }
        },
        { separator: true },
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

    // 不清空 draft：用户失败后想微调重发，或想拿这次提示词当下次基础。
    // 对话模式 sendChat 仍清空——一问一答场景下 stale draft 容易被误连发。
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

  function applyAsPrompt(text: string): void {
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
          onClick: () => applyAsPrompt(targetForPrompt)
        },
        {
          label: sel ? '发送选中到智能画布（提示词）' : '发送到智能画布（提示词）',
          icon: <PlusIcon size={12} />,
          disabled: targetForPrompt.trim().length === 0,
          onClick: () => {
            useSmartInboxStore.getState().push([{ kind: 'prompt', text: targetForPrompt }]);
            navigate('/smart-canvas');
            toast.success('已发送提示词到智能画布');
          }
        }
      ]
    });
  }

  async function cancel(): Promise<void> {
    // 用 ref 而非 state：IPC 返回后 pendingMidRef 立即就位，而 setPendingMessageId 是异步 state。
    // 否则「IPC 已返回但首个 chunk 未到」那段窗口里按 Esc，会因 state 仍是 null 而取消失败，
    // 流不中断、pendingAidRef 一直占着 → 被并发守卫锁住。
    const id = pendingMidRef.current ?? pendingMessageId;
    if (!id) return;
    await window.electronAPI.chat.cancel(id);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (mode === 'image') generateImage();
      else sendChat();
    }
    if (e.key === 'Escape' && (pendingMidRef.current || pendingMessageId)) {
      e.preventDefault();
      cancel();
    }
  }

  return (
    <div className="mb-chat">
      <div className="mb-chat-header">
        <CustomSelect
          className="mb-chat-conv-select"
          value={activeId ?? ''}
          onChange={(v) => setActive(v || null)}
          options={list.map((c) => ({ value: c.id, label: c.title }))}
          placeholder="选择对话…"
        />
        <CustomSelect
          className="mb-chat-model-select"
          value={modelId}
          onChange={setModelId}
          options={textModelOptions}
          placeholder={textModels.length === 0 ? '未配置对话模型' : '选择模型…'}
          renderOption={(opt) => {
            const tags = (opt.meta ?? '').split(' · ').filter(Boolean);
            return (
              <span className="mb-chat-model-row">
                <span className="mb-chat-model-name">{opt.label}</span>
                <span className="mb-chat-model-tags">
                  {tags.map((t) => (
                    <span key={t} className={`mb-chat-model-tag is-${tagKind(t)}`}>{t}</span>
                  ))}
                </span>
              </span>
            );
          }}
          renderHead={(opt) => {
            if (!opt) {
              return <span className="mb-cs-placeholder">{textModels.length === 0 ? '未配置对话模型' : '选择模型…'}</span>;
            }
            const tags = (opt.meta ?? '').split(' · ').filter(Boolean);
            return (
              <span className="mb-chat-model-row">
                <span className="mb-chat-model-name">{opt.label}</span>
                <span className="mb-chat-model-tags">
                  {tags.map((t) => (
                    <span key={t} className={`mb-chat-model-tag is-${tagKind(t)}`}>{t}</span>
                  ))}
                </span>
              </span>
            );
          }}
        />
        <button
          type="button"
          className="mb-chat-icon-btn"
          onClick={newChat}
          title="新建对话"
          aria-label="新建对话"
        >
          <PlusIcon size={14} />
        </button>
        <div className="mb-chat-more" ref={moreMenuRef}>
          <button
            type="button"
            className="mb-chat-icon-btn"
            onClick={() => setMoreOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            title="更多操作"
          >
            <span className="mb-chat-more-dots" aria-hidden="true">⋯</span>
          </button>
          {moreOpen && (
            <div className="mb-chat-more-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                className="mb-chat-more-item"
                disabled={!activeId}
                onClick={() => {
                  setMoreOpen(false);
                  deleteCurrentChat();
                }}
              >
                <TrashIcon size={13} /> 删除当前对话
              </button>
              <button
                type="button"
                role="menuitem"
                className="mb-chat-more-item is-danger"
                onClick={() => {
                  setMoreOpen(false);
                  clearAllChats();
                }}
              >
                <TrashIcon size={13} /> 清空所有对话
              </button>
            </div>
          )}
        </div>
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
              onUseAsPrompt={(t) => applyAsPrompt(t)}
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
        <div className="mb-chat-attach-row">
          {attachedImages.map((a, i) => {
            const ref = params.refs[i];
            const disabled = ref?.enabled === false;
            return (
            <div
              key={i}
              className="mb-chat-attach-thumb"
              style={disabled ? { opacity: 0.4 } : undefined}
              onContextMenu={(e) => showAttachMenu(e, i)}
              onClick={() => setPreviewImageSrc(a.dataUri)}
              title="点击放大 · 右键：类型 / 权重 / 启用 / 画板编辑 / 另存 / 移除"
            >
              <img src={a.dataUri} alt={`图片 ${i + 1}`} draggable={false} />
              <button
                type="button"
                className="mb-chat-attach-x"
                onClick={(e) => {
                  e.stopPropagation();
                  removeAttach(i);
                }}
                title="移除"
              >
                ×
              </button>
            </div>
            );
          })}
          {attachedImages.length < 16 && (
            <button
              type="button"
              className="mb-chat-attach-add"
              onClick={() => void pickAndAttach()}
              title="点击挑选 / 直接拖入 / 粘贴都行"
            >
              <PlusIcon size={14} />
              <span>{composerDragOver ? '松手添加' : '添加图片'}</span>
            </button>
          )}
          {attachedImages.length > 0 && (
            <div className="mb-chat-attach-hint">
              {attachedImages.length}/16 ·{' '}
              {mode === 'chat' ? '对话发给视觉模型' : '生图时作参考图'}
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files) void attachFiles(e.target.files);
              e.target.value = '';
            }}
          />
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
            mode === 'chat' && (
              <button
                type="button"
                className={`mb-btn mb-btn-sm ${webSearchOn ? 'mb-btn-primary' : 'mb-btn-ghost'}`}
                onClick={() => setWebSearchOn((v) => !v)}
                title={
                  webSearchOn
                    ? '本会话联网搜索已开 · 每条都会调代搜(后端在 设置 → 联网搜索 配置 ddg/tavily/searxng)'
                    : '点开 = 本会话强制走代搜(忽略方案的 supports_web_search 设置)'
                }
              >
                🌐 {webSearchOn ? '联网已开' : '联网'}
              </button>
            )
          )}
          <span style={{ flex: 1 }} />
          {!pendingMessageId && (
            <div className="mb-chat-quick-clear">
              {attachedImages.length > 0 && (
                <button
                  type="button"
                  className="mb-chat-quick-clear-btn"
                  onClick={() => params.clearRefs()}
                >
                  清空附图
                </button>
              )}
              {draft.trim().length > 0 && (
                <button
                  type="button"
                  className="mb-chat-quick-clear-btn"
                  onClick={() => setDraft('')}
                >
                  清空草稿
                </button>
              )}
              {mode === 'chat' && activeId && (
                <button
                  type="button"
                  className="mb-chat-quick-clear-btn"
                  onClick={() => void deleteCurrentChat()}
                >
                  清空对话
                </button>
              )}
            </div>
          )}
          <div className="mb-chat-mode-pills">
            <button
              type="button"
              className={`mb-chat-mode-pill ${mode === 'chat' ? 'is-active' : ''}`}
              onClick={() => setMode('chat')}
              title="对话模式"
            >
              <SendIcon size={12} /> 对话
            </button>
            <button
              type="button"
              className={`mb-chat-mode-pill ${mode === 'image' ? 'is-active' : ''}`}
              onClick={() => setMode('image')}
              title="生图模式"
            >
              <SparkleIcon size={12} /> 生图
            </button>
          </div>
          {mode === 'chat' ? (
            <button
              className="mb-btn mb-btn-primary mb-btn-sm mb-chat-send-btn"
              onClick={sendChat}
              disabled={
                !!pendingMessageId ||
                !draft.trim() ||
                (attachedImages.length > 0 && !!currentTextConfig && !currentTextConfig.supports_vision)
              }
              title={
                attachedImages.length > 0 && currentTextConfig && !currentTextConfig.supports_vision
                  ? `「${modelId}」未启用视觉支持，移除附图或换模型后再发送`
                  : 'Enter 发送 · Shift+Enter 换行'
              }
            >
              <SendIcon size={14} /> 发送
            </button>
          ) : (
            <button
              className="mb-btn mb-btn-primary mb-btn-sm mb-chat-send-btn"
              onClick={generateImage}
              disabled={imageBusy || !draft.trim()}
              title="Enter 提交 · 使用右侧面板的尺寸 / 参考图设置"
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
  /** 思考过程文本——仅在方案启用思考模式且模型返回时填充。UI 上展示为可折叠区。 */
  reasoning_content?: string;
  attachments?: string[];
  streaming?: boolean;
  cancelled?: boolean;
  sources?: Array<{ title: string; url: string; snippet: string; hostname: string }>;
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
  const hasReasoning = (message.reasoning_content?.length ?? 0) > 0;
  // 思考区默认收起；流式中默认展开，方便用户看推理过程
  const [reasoningOpen, setReasoningOpen] = useState(false);

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
        {hasReasoning && (
          <div className="mb-chat-reasoning">
            <button
              type="button"
              className="mb-chat-reasoning-toggle"
              onClick={() => setReasoningOpen((v) => !v)}
              title={reasoningOpen ? '收起思考过程' : '展开思考过程'}
            >
              💭 思考过程
              {message.streaming && (
                <span className="mb-chat-reasoning-live"> · 正在思考…</span>
              )}
              <span className="mb-chat-reasoning-caret">{reasoningOpen ? '▾' : '▸'}</span>
            </button>
            {(reasoningOpen || (message.streaming && !hasContent)) && (
              <div className="mb-chat-reasoning-body">
                {message.reasoning_content}
              </div>
            )}
          </div>
        )}
        {hasContent && (
          <div className="mb-chat-bubble-text">
            {message.content}
            {message.streaming && <span className="mb-chat-cursor" />}
            {message.cancelled && <span className="mb-chat-meta">·已取消</span>}
          </div>
        )}
        {!hasContent && message.streaming && !hasReasoning && (
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
        {message.sources && message.sources.length > 0 && <SourcesCard sources={message.sources} />}
      </div>
    </motion.div>
  );
}

/** 代搜（DDG/Tavily/SearXNG）参考来源卡片，可折叠；点 url 在系统浏览器里打开 */
function SourcesCard({
  sources
}: {
  sources: Array<{ title: string; url: string; snippet: string; hostname: string }>;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-chat-sources">
      <button
        type="button"
        className="mb-chat-sources-toggle"
        onClick={() => setOpen((v) => !v)}
      >
        📎 参考来源 · {sources.length} 条 {open ? '▴' : '▾'}
      </button>
      {open && (
        <ol className="mb-chat-sources-list">
          {sources.map((s, i) => (
            <li key={i} className="mb-chat-sources-item">
              <a
                href="#"
                className="mb-chat-sources-title"
                onClick={(e) => {
                  e.preventDefault();
                  void window.electronAPI.storage.openUrl(s.url);
                }}
                title={s.url}
              >
                {s.title || s.url}
              </a>
              <div className="mb-chat-sources-host">{s.hostname}</div>
              {s.snippet && <div className="mb-chat-sources-snippet">{s.snippet}</div>}
            </li>
          ))}
        </ol>
      )}
    </div>
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
