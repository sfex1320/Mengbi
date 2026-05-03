import { create } from 'zustand';

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  /** 是否仍在流式中 */
  streaming?: boolean;
  /** 是否被取消 */
  cancelled?: boolean;
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
  appendUser: (content: string) => string;
  appendAssistantPlaceholder: () => string;
  /** 流式追加 */
  appendDelta: (id: string, delta: string) => void;
  /** 标记完成 */
  markDone: (id: string, opts?: { cancelled?: boolean }) => void;
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

  appendUser: (content) => {
    const id = `u-${Date.now()}`;
    set((s) => ({
      messages: [
        ...s.messages,
        { id, role: 'user', content, timestamp: new Date().toISOString() }
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

  markDone: (id, opts) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, streaming: false, cancelled: opts?.cancelled } : m
      )
    }))
}));
