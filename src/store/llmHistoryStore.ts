import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ChatMsg, LlmOp } from '@shared/smartCanvas';

/**
 * 智能画布 LLM 历史记录（与生图主功能的对话**完全隔离**，不走 conversations 表）。
 * 持久化到 localStorage，关软件后仍可调用之前的对话 / 优化结果。
 * 两类条目：
 *  - chat：一次流式对话的完整消息序列（点回放 → 还原到 LLM 节点的聊天模式）
 *  - op：一次单次操作（优化/翻译/扩写/反推/转 JSON…）的 输入 + 输出（点回放 → 还原到节点模式）
 */
export interface LlmHistoryEntry {
  id: string;
  ts: number;
  kind: 'chat' | 'op';
  modelId: string;
  /** 列表里显示的标题（取首条 user 消息 / 输入前若干字） */
  title: string;
  /** 来源 LLM 节点 id（用于「同一对话延续」判定，回放不依赖它） */
  sourceNode?: string;
  // chat
  messages?: ChatMsg[];
  // op
  op?: LlmOp;
  input?: string;
  output?: string;
}

const MAX_ENTRIES = 120;

interface LlmHistoryState {
  entries: LlmHistoryEntry[];
  /** 记录一条对话（同一节点连续对话会更新同一条而非堆叠：以 sessionKey 去重，传 nodeId 作 key） */
  recordChat: (nodeId: string, modelId: string, messages: ChatMsg[]) => void;
  /** 记录一次单次操作结果 */
  recordOp: (op: LlmOp, modelId: string, input: string, output: string) => void;
  remove: (id: string) => void;
  clear: () => void;
}

function preview(s: string, n = 40): string {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t || '（空）';
}

let seq = 0;
function uid(): string {
  // 渲染端可用 Date.now（非 workflow 脚本环境）；叠加自增序列避免同毫秒撞键
  seq = (seq + 1) % 100000;
  return `lh_${Date.now().toString(36)}_${seq.toString(36)}`;
}

export const useLlmHistoryStore = create<LlmHistoryState>()(
  persist(
    (set) => ({
      entries: [],
      recordChat: (nodeId, modelId, messages) => {
        const msgs = messages.filter((m) => m.content.trim());
        if (msgs.length < 2) return; // 至少一问一答才值得记
        const firstUser = msgs.find((m) => m.role === 'user')?.content ?? '';
        set((s) => {
          const entries = s.entries.slice();
          // 该节点最近一条 chat 条目：若旧消息是新消息的前缀 = 同一对话在增长 → 更新；
          // 否则（用户清空后开了新对话）= 新条目，旧对话保留可回放。
          const idx = entries.findIndex((e) => e.kind === 'chat' && e.sourceNode === nodeId);
          const isContinuation = (prev?: ChatMsg[]): boolean => {
            if (!prev || prev.length > msgs.length) return false;
            return prev.every((m, i) => msgs[i] && msgs[i].role === m.role && msgs[i].content === m.content);
          };
          if (idx >= 0 && isContinuation(entries[idx].messages)) {
            entries[idx] = { ...entries[idx], ts: Date.now(), modelId, messages: msgs, title: preview(firstUser) };
          } else {
            entries.unshift({ id: uid(), ts: Date.now(), kind: 'chat', sourceNode: nodeId, modelId, title: preview(firstUser), messages: msgs });
          }
          entries.sort((a, b) => b.ts - a.ts);
          return { entries: entries.slice(0, MAX_ENTRIES) };
        });
      },
      recordOp: (op, modelId, input, output) => {
        if (!output.trim()) return;
        const entry: LlmHistoryEntry = {
          id: uid(),
          ts: Date.now(),
          kind: 'op',
          modelId,
          op,
          input,
          output,
          title: preview(input || output)
        };
        set((s) => ({ entries: [entry, ...s.entries].slice(0, MAX_ENTRIES) }));
      },
      remove: (id) => set((s) => ({ entries: s.entries.filter((e) => e.id !== id) })),
      clear: () => set({ entries: [] })
    }),
    { name: 'mengbi.sc.llmHistory.v1' }
  )
);
