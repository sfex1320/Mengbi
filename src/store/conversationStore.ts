import { create } from 'zustand';

export interface SearchSource {
  title: string;
  url: string;
  snippet: string;
  hostname: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  /** 思考过程（reasoning_content）。仅当方案启用思考模式且模型返回时填充。
   *  从历史读回时通过 chat.history IPC 一并返回；流式中通过 appendReasoning 追加。 */
  reasoning_content?: string;
  /** 多模态附图（dataUri 数组）—— 不进入 content 文本，避免巨型 base64 串污染渲染 */
  attachments?: string[];
  /** 是否仍在流式中 */
  streaming?: boolean;
  /** 是否被取消 */
  cancelled?: boolean;
  /** 代搜（DDG/Tavily/SearXNG）路径返回的参考来源；UI 上挂"📎 参考来源"卡片 */
  sources?: SearchSource[];
  timestamp: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  updated_at: string;
}

interface ConversationState {
  list: ConversationSummary[];
  activeId: string | null;
  /** 仅当前会话的消息全量（其他会话需要点开时再 fetch） */
  messages: Message[];

  loadList: () => Promise<void>;
  setActive: (id: string | null) => Promise<void>;
  createConversation: (title: string, planId: number, modelId: string) => Promise<string | null>;
  deleteConversation: (id: string) => Promise<void>;

  /** 在本地立刻插入用户消息 + 占位 assistant 流式消息 */
  appendUser: (content: string, attachments?: string[]) => string;
  appendAssistantPlaceholder: () => string;
  /** 流式追加 */
  appendDelta: (id: string, delta: string) => void;
  /** 思考过程流式追加（独立于 content，不会污染最终答案） */
  appendReasoning: (id: string, delta: string) => void;
  /** 标记完成 */
  markDone: (id: string, opts?: { cancelled?: boolean }) => void;
  /** 把代搜命中结果挂到指定 assistant 消息上 */
  setSources: (id: string, sources: SearchSource[]) => void;
}

export const useConversationStore = create<ConversationState>((set, get) => ({
  list: [],
  activeId: null,
  messages: [],

  loadList: async () => {
    const r = await window.electronAPI.chat.list();
    if (r.ok) set({ list: r.data });
  },

  setActive: async (id) => {
    set({ activeId: id, messages: [] });
    if (!id) return;
    const r = await window.electronAPI.chat.history(id);
    if (r.ok) {
      const messages: Message[] = r.data.map((m, i) => ({
        id: `hist-${i}`,
        role: m.role as Message['role'],
        content: m.content,
        reasoning_content: m.reasoning_content ?? undefined,
        timestamp: m.timestamp
      }));
      set({ messages });
    }
  },

  createConversation: async (title, planId, modelId) => {
    const r = await window.electronAPI.chat.create({ title, planId, modelId });
    if (!r.ok) return null;
    await get().loadList();
    set({ activeId: r.data.id, messages: [] });
    return r.data.id;
  },

  deleteConversation: async (id) => {
    const r = await window.electronAPI.chat.delete(id);
    if (!r.ok) return;
    const { activeId } = get();
    await get().loadList();
    if (activeId === id) set({ activeId: null, messages: [] });
  },

  appendUser: (content, attachments) => {
    const id = `u-${Date.now()}`;
    set((s) => ({
      messages: [
        ...s.messages,
        {
          id,
          role: 'user',
          content,
          attachments: attachments && attachments.length > 0 ? attachments : undefined,
          timestamp: new Date().toISOString()
        }
      ]
    }));
    return id;
  },

  appendAssistantPlaceholder: () => {
    const id = `a-${Date.now()}`;
    set((s) => ({
      messages: [
        ...s.messages,
        {
          id,
          role: 'assistant',
          content: '',
          streaming: true,
          timestamp: new Date().toISOString()
        }
      ]
    }));
    return id;
  },

  appendDelta: (id, delta) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, content: m.content + delta } : m
      )
    })),

  appendReasoning: (id, delta) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id
          ? { ...m, reasoning_content: (m.reasoning_content ?? '') + delta }
          : m
      )
    })),

  markDone: (id, opts) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, streaming: false, cancelled: opts?.cancelled } : m
      )
    })),

  setSources: (id, sources) =>
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id ? { ...m, sources } : m))
    }))
}));
