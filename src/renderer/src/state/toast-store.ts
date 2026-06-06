import { create } from 'zustand';

export type ToastKind = 'info' | 'success' | 'warning' | 'error';
export type Toast = { id: string; message: string; kind: ToastKind };

type ToastStore = {
  toasts: Toast[];
  show: (message: string, kind: ToastKind) => void;
  remove: (id: string) => void;
};

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  show: (message, kind) =>
    set((s) => ({ toasts: [...s.toasts, { id: crypto.randomUUID(), message, kind }] })),
  remove: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

const fire =
  (kind: ToastKind) =>
  (message: string): void =>
    useToastStore.getState().show(message, kind);

/** Fire a lightweight, auto-dismissing toast from anywhere. Defaults to info;
 *  use `toast.error(...)` / `toast.warning(...)` / `toast.success(...)`. */
export const toast = Object.assign(fire('info'), {
  info: fire('info'),
  success: fire('success'),
  warning: fire('warning'),
  error: fire('error'),
});
