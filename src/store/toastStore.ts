import { create } from 'zustand';

export type ToastKind = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  description?: string;
  /** 毫秒；0 表示不自动消失 */
  duration: number;
}

interface ToastState {
  toasts: Toast[];
  push: (input: Omit<Toast, 'id' | 'duration'> & { duration?: number }) => number;
  dismiss: (id: number) => void;
  clear: () => void;
}

let counter = 1;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (input) => {
    const id = counter++;
    const duration = input.duration ?? 3200;
    set((s) => ({ toasts: [...s.toasts, { id, duration, ...input }] }));
    if (duration > 0) {
      setTimeout(() => get().dismiss(id), duration);
    }
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] })
}));

/** 便捷 helper：在任意非 React 上下文也能调用 */
export const toast = {
  success: (title: string, description?: string) =>
    useToastStore.getState().push({ kind: 'success', title, description }),
  error: (title: string, description?: string) =>
    useToastStore.getState().push({ kind: 'error', title, description, duration: 5000 }),
  info: (title: string, description?: string) =>
    useToastStore.getState().push({ kind: 'info', title, description })
};
