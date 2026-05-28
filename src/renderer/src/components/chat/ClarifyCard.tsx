import type { Clarify, ClarifyOption, ClarifyQuestion } from '@shared/chat-types';
import { ArrowRight, Check } from 'lucide-react';
import { useState } from 'react';

export function ClarifyCard({ clarify }: { clarify: Clarify }): React.JSX.Element {
  const [activeIndex, setActiveIndex] = useState(0);
  const [answered, setAnswered] = useState<Set<string>>(new Set());

  const questions = clarify.questions;
  const current = questions[activeIndex] ?? questions[0];
  if (!current) return <div />;
  const isLast = activeIndex === questions.length - 1;
  const isFirst = activeIndex === 0;
  const isMulti = questions.length > 1;

  const goNext = (): void => {
    setAnswered((prev) => new Set(prev).add(current.id));
    if (!isLast) setActiveIndex(activeIndex + 1);
    // Stub: real submission lands when ask_clarification is wired up.
  };

  const goPrev = (): void => {
    if (!isFirst) setActiveIndex(activeIndex - 1);
  };

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-accent/50 bg-elevated">
      {isMulti && (
        <CardHead
          questions={questions}
          activeIndex={activeIndex}
          answered={answered}
          onTabClick={setActiveIndex}
        />
      )}
      <div className="px-5 py-4">
        <QuestionBlock question={current} />
      </div>
      <CardFoot
        isMulti={isMulti}
        isFirst={isFirst}
        isLast={isLast}
        onPrev={goPrev}
        onNext={goNext}
      />
    </div>
  );
}

function CardHead({
  questions,
  activeIndex,
  answered,
  onTabClick,
}: {
  questions: ClarifyQuestion[];
  activeIndex: number;
  answered: Set<string>;
  onTabClick: (i: number) => void;
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 items-center gap-1 overflow-x-auto border-border-default border-b bg-surface px-4 py-2">
      {questions.map((q, i) => {
        const isActive = i === activeIndex;
        const isAnswered = answered.has(q.id);
        return (
          <button
            type="button"
            key={q.id}
            onClick={() => onTabClick(i)}
            title={q.question}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 font-medium text-xs transition-colors ${
              isActive
                ? 'bg-accent text-fg-on-accent'
                : isAnswered
                  ? 'text-accent hover:bg-accent-soft'
                  : 'text-fg-tertiary hover:bg-surface-strong hover:text-fg-secondary'
            }`}
          >
            {isAnswered ? (
              <Check className="size-3 shrink-0" />
            ) : (
              <span className={`font-mono text-[10px] ${isActive ? 'opacity-80' : 'opacity-60'}`}>
                {i + 1}
              </span>
            )}
            <span className="truncate">{q.header}</span>
          </button>
        );
      })}
    </div>
  );
}

function CardFoot({
  isMulti,
  isFirst,
  isLast,
  onPrev,
  onNext,
}: {
  isMulti: boolean;
  isFirst: boolean;
  isLast: boolean;
  onPrev: () => void;
  onNext: () => void;
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-3 border-border-default border-t bg-surface px-5 py-2.5">
      <span className="flex-1 text-fg-tertiary text-xs">
        {isMulti ? '所有问题答完后 Atrium 才会继续' : '回答后 Atrium 会继续'}
      </span>
      {isMulti && (
        <button
          type="button"
          onClick={onPrev}
          disabled={isFirst}
          className="rounded-md border border-border-default bg-surface px-3.5 py-1 text-fg-primary text-sm hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-40"
        >
          上一个
        </button>
      )}
      {!isMulti && (
        <button
          type="button"
          className="rounded-md border border-border-default bg-surface px-3.5 py-1 text-fg-primary text-sm hover:border-border-strong"
        >
          取消
        </button>
      )}
      <button
        type="button"
        onClick={onNext}
        className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3.5 py-1 text-fg-on-accent text-sm hover:bg-accent-hover"
      >
        {!isMulti ? '提交' : isLast ? '提交全部' : '下一个'}
        {isMulti && !isLast && <ArrowRight className="size-3.5" />}
      </button>
    </div>
  );
}

function QuestionBlock({ question }: { question: ClarifyQuestion }): React.JSX.Element {
  return (
    <div>
      <div className="mb-1 font-medium text-fg-primary text-md leading-snug">
        {question.question}
      </div>
      {question.context && (
        <div className="mb-3 text-fg-tertiary text-sm leading-snug">{question.context}</div>
      )}
      <InputArea question={question} />
    </div>
  );
}

function InputArea({ question }: { question: ClarifyQuestion }): React.JSX.Element {
  if (question.inputType === 'text') return <TextInput key={question.id} />;
  if (question.inputType === 'multi')
    return <MultiSelect key={question.id} options={question.options ?? []} />;
  return (
    <SingleSelect
      key={question.id}
      options={question.options ?? []}
      allowOther={question.allowOther}
    />
  );
}

function SingleSelect({
  options,
  allowOther,
}: {
  options: ClarifyOption[];
  allowOther?: boolean;
}): React.JSX.Element {
  const hasPreview = options.some((o) => o.preview);
  const [selected, setSelected] = useState<number>(0);

  if (hasPreview) {
    return (
      <div className="grid grid-cols-[260px_1fr] gap-3">
        <div className="flex flex-col gap-1.5">
          {options.map((opt, i) => (
            <OptionRow
              key={opt.label}
              label={opt.label}
              selected={selected === i}
              onSelect={() => setSelected(i)}
            />
          ))}
        </div>
        <div>
          <div className="mb-1.5 font-medium text-[10px] text-fg-tertiary uppercase tracking-wider">
            Preview · 伪代码
          </div>
          <pre className="max-h-[280px] min-h-[120px] overflow-auto rounded-md border border-border-default bg-canvas px-4 py-3 font-mono text-fg-secondary text-xs leading-snug">
            {options[selected]?.preview ?? ''}
          </pre>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {options.map((opt, i) => (
        <OptionRow
          key={opt.label}
          label={opt.label}
          selected={selected === i}
          onSelect={() => setSelected(i)}
        />
      ))}
      {allowOther && (
        <input
          type="text"
          placeholder="或者填别的…"
          className="mt-1 w-full rounded-md border border-border-default bg-surface px-3.5 py-2 text-fg-primary text-sm placeholder:text-fg-disabled focus:border-accent focus:outline-none"
        />
      )}
    </div>
  );
}

function MultiSelect({ options }: { options: ClarifyOption[] }): React.JSX.Element {
  const [selected, setSelected] = useState<Set<number>>(new Set([0]));
  const toggle = (i: number): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-1.5">
      {options.map((opt, i) => (
        <OptionRow
          key={opt.label}
          label={opt.label}
          selected={selected.has(i)}
          onSelect={() => toggle(i)}
          multi
        />
      ))}
    </div>
  );
}

function OptionRow({
  label,
  selected,
  onSelect,
  multi = false,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
  multi?: boolean;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex items-center gap-3 rounded-md border px-3.5 py-2.5 text-left text-sm transition-colors ${
        selected
          ? 'border-accent bg-accent-soft text-fg-primary'
          : 'border-border-default bg-surface text-fg-primary hover:border-border-strong'
      }`}
    >
      <Indicator selected={selected} multi={multi} />
      <span className="flex-1">{label}</span>
    </button>
  );
}

function Indicator({ selected, multi }: { selected: boolean; multi: boolean }): React.JSX.Element {
  if (multi) {
    return (
      <span
        className={`flex size-4 shrink-0 items-center justify-center rounded-[3px] border ${
          selected ? 'border-accent bg-accent' : 'border-border-strong'
        }`}
      >
        {selected && (
          <svg
            viewBox="0 0 16 16"
            className="size-2.5 fill-none stroke-fg-on-accent stroke-2"
            aria-hidden="true"
          >
            <title>Selected</title>
            <path d="M3 8.5 6.5 12 13 4.5" />
          </svg>
        )}
      </span>
    );
  }
  return (
    <span
      className={`relative flex size-4 shrink-0 items-center justify-center rounded-full border-[1.5px] ${
        selected ? 'border-accent bg-accent' : 'border-border-strong'
      }`}
    >
      {selected && <span className="size-1.5 rounded-full bg-fg-on-accent" />}
    </span>
  );
}

function TextInput(): React.JSX.Element {
  return (
    <textarea
      rows={4}
      placeholder="自由文本输入…"
      className="block w-full resize-y rounded-md border border-border-default bg-surface px-3.5 py-2.5 text-fg-primary text-sm placeholder:text-fg-disabled focus:border-accent focus:outline-none"
    />
  );
}
