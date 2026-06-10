import type { Todo, TodoStatus } from '@shared/chat-types';
import { CheckCircle2, ChevronDown, Circle, ListChecks, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export function PlanPanel({ todos }: { todos: Todo[] }): React.JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const done = todos.filter((t) => t.status === 'completed').length;
  const active = todos.find((t) => t.status === 'in_progress');
  const pct = todos.length > 0 ? (done / todos.length) * 100 : 0;

  return (
    <div className="plan-enter grid">
      <div className="overflow-hidden">
        <div className="overflow-hidden rounded-t-xl border border-border-default border-b-0 bg-surface">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex w-full items-center gap-3 px-4 py-3 hover:bg-surface-strong"
          >
            <ListChecks className="size-[15px] shrink-0 text-accent" />
            <span className="shrink-0 font-medium text-fg-secondary text-sm">
              {t('trace.plan')}
            </span>
            {!open && active ? (
              <span className="min-w-0 flex-1 truncate text-left text-fg-primary text-sm">
                {active.content}
              </span>
            ) : (
              <span className="flex-1" />
            )}
            <span className="shrink-0 text-fg-tertiary text-sm tabular-nums">
              {done} / {todos.length}
            </span>
            <ChevronDown
              className={`size-3.5 shrink-0 text-fg-tertiary transition-transform ${open ? '' : '-rotate-90'}`}
            />
          </button>

          <div className="px-4 pb-3">
            <div className="h-[3px] overflow-hidden rounded-full bg-border-default">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>

          {/* grid-rows 0fr↔1fr animates the height open/closed without measuring content */}
          <div
            className="grid transition-[grid-template-rows] duration-200 ease-out"
            style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
          >
            <div className="overflow-hidden">
              <div className="max-h-[220px] overflow-y-auto px-2 pb-2">
                {todos.map((t, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: plan is positional, replaced as a whole
                  <PlanRow key={i} todo={t} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PlanRow({ todo }: { todo: Todo }): React.JSX.Element {
  return (
    <div
      className={`flex items-start gap-3 rounded-sm px-3 py-2 text-base leading-snug ${
        todo.status === 'in_progress' ? 'bg-accent-soft' : ''
      }`}
    >
      <span className="mt-px grid size-4 shrink-0 place-items-center">
        <StatusIcon status={todo.status} />
      </span>
      <span className={`min-w-0 flex-1 ${LABEL_CLS[todo.status]}`}>{todo.content}</span>
    </div>
  );
}

const LABEL_CLS: Record<TodoStatus, string> = {
  pending: 'text-fg-secondary',
  in_progress: 'font-medium text-fg-primary',
  completed: 'text-fg-tertiary line-through decoration-fg-disabled',
};

function StatusIcon({ status }: { status: TodoStatus }): React.JSX.Element {
  if (status === 'completed') return <CheckCircle2 className="size-4 text-success" />;
  if (status === 'in_progress') return <Loader2 className="size-4 animate-spin text-accent" />;
  return <Circle className="size-4 text-fg-disabled" />;
}
