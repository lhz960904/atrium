import * as Toast from '@radix-ui/react-toast';
import { CheckCircle2, CircleX, Info, TriangleAlert } from 'lucide-react';
import type { ToastKind } from '../state/toast-store';
import { useToastStore } from '../state/toast-store';

const VARIANT: Record<
  ToastKind,
  { Icon: typeof Info; border: string; tint: string; icon: string }
> = {
  info: { Icon: Info, border: 'border-info/30', tint: 'bg-info/10', icon: 'text-info' },
  success: {
    Icon: CheckCircle2,
    border: 'border-success/30',
    tint: 'bg-success/10',
    icon: 'text-success',
  },
  warning: {
    Icon: TriangleAlert,
    border: 'border-warning/30',
    tint: 'bg-warning/10',
    icon: 'text-warning',
  },
  error: { Icon: CircleX, border: 'border-danger/30', tint: 'bg-danger/10', icon: 'text-danger' },
};

/**
 * The live toast queue on Radix Toast — a11y (aria-live), auto-dismiss timer,
 * hover-to-pause and swipe-to-dismiss come for free. Mounted once at the app
 * root; fire from anywhere with `toast(...)` / `toast.error(...)` etc.
 */
export function Toaster(): React.JSX.Element {
  const toasts = useToastStore((s) => s.toasts);
  const remove = useToastStore((s) => s.remove);
  return (
    <Toast.Provider duration={2000} swipeDirection="up">
      {toasts.map((t) => {
        const v = VARIANT[t.kind];
        return (
          <Toast.Root
            key={t.id}
            onOpenChange={(open) => {
              if (!open) remove(t.id);
            }}
            className={`toast-enter relative flex max-w-[440px] items-start gap-2 overflow-hidden rounded-lg border bg-elevated px-3.5 py-2.5 shadow-lg data-[swipe=cancel]:translate-y-0 data-[swipe=move]:translate-y-[var(--radix-toast-swipe-move-y)] data-[swipe=move]:transition-none ${v.border}`}
          >
            {/* opaque elevated base + a kind tint over it, so content behind
                never shows through and overlaps the text */}
            <span aria-hidden className={`pointer-events-none absolute inset-0 ${v.tint}`} />
            <v.Icon className={`relative mt-px size-4 shrink-0 ${v.icon}`} />
            <Toast.Description className="relative text-fg-primary text-sm">
              {t.message}
            </Toast.Description>
          </Toast.Root>
        );
      })}
      <Toast.Viewport className="fixed inset-x-0 top-12 z-[var(--z-toast)] m-0 flex list-none flex-col items-center gap-2 px-4 outline-none" />
    </Toast.Provider>
  );
}
