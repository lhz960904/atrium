import type { ParseKeys } from 'i18next';
import { create } from 'zustand';

export type ToastKind = 'info' | 'success' | 'warning' | 'error';
/** Toast text: a literal string, or an i18n key resolved live in the Toaster — so
 *  a toast created before the UI language settles still renders in the right one. */
export type ToastMessage = string | { key: ParseKeys; params?: Record<string, unknown> };
/** Optional action button on a toast (e.g. "Review" → navigate). */
export type ToastAction = { label: ToastMessage; run: () => void };
export type Toast = { id: string; message: ToastMessage; kind: ToastKind; action?: ToastAction };

type ToastStore = {
  toasts: Toast[];
  show: (message: ToastMessage, kind: ToastKind, action?: ToastAction) => void;
  remove: (id: string) => void;
};

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  show: (message, kind, action) =>
    set((s) => ({ toasts: [...s.toasts, { id: crypto.randomUUID(), message, kind, action }] })),
  remove: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

const fire =
  (kind: ToastKind) =>
  (message: ToastMessage, action?: ToastAction): void =>
    useToastStore.getState().show(message, kind, action);

/** Fire a lightweight, auto-dismissing toast from anywhere. Defaults to info;
 *  use `toast.error(...)` / `toast.warning(...)` / `toast.success(...)`. */
export const toast = Object.assign(fire('info'), {
  info: fire('info'),
  success: fire('success'),
  warning: fire('warning'),
  error: fire('error'),
});
