import * as Toast from '@radix-ui/react-toast';
import { CheckCircle2, CircleX, Info, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ToastKind, ToastMessage } from '../state/toast-store';
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
  const { t } = useTranslation();
  // Resolve here, in render, so a toast carrying an i18n key follows the live
  // UI language (a string passes through unchanged).
  const text = (m: ToastMessage): string => (typeof m === 'string' ? m : t(m.key, m.params));
  return (
    <Toast.Provider duration={2000} swipeDirection="up">
      {toasts.map((item) => {
        const v = VARIANT[item.kind];
        return (
          <Toast.Root
            key={item.id}
            // Actionable toasts live longer so there's time to click; plain ones
            // keep the provider's short auto-dismiss.
            duration={item.action ? 10000 : undefined}
            onOpenChange={(open) => {
              if (!open) remove(item.id);
            }}
            className={`toast-enter relative flex max-w-[440px] items-start gap-2 overflow-hidden rounded-lg border bg-elevated px-3.5 py-2.5 shadow-lg data-[swipe=cancel]:translate-y-0 data-[swipe=move]:translate-y-[var(--radix-toast-swipe-move-y)] data-[swipe=move]:transition-none ${v.border}`}
          >
            {/* opaque elevated base + a kind tint over it, so content behind
                never shows through and overlaps the text */}
            <span aria-hidden className={`pointer-events-none absolute inset-0 ${v.tint}`} />
            <v.Icon className={`relative mt-px size-4 shrink-0 ${v.icon}`} />
            <Toast.Description className="relative text-fg-primary text-sm">
              {text(item.message)}
            </Toast.Description>
            {item.action && (
              <Toast.Action asChild altText={text(item.action.label)}>
                <button
                  type="button"
                  onClick={() => {
                    item.action?.run();
                    remove(item.id);
                  }}
                  className="relative ml-auto shrink-0 self-center rounded-md border border-border-default px-2 py-0.5 font-medium text-fg-secondary text-xs hover:bg-surface-strong"
                >
                  {text(item.action.label)}
                </button>
              </Toast.Action>
            )}
          </Toast.Root>
        );
      })}
      <Toast.Viewport className="fixed inset-x-0 top-12 z-[var(--z-toast)] m-0 flex list-none flex-col items-center gap-2 px-4 outline-none" />
    </Toast.Provider>
  );
}
