import * as Checkbox from '@radix-ui/react-checkbox';
import * as RadioGroup from '@radix-ui/react-radio-group';
import type { Clarify, ClarifyOption, ClarifyQuestion, ClarifyResult } from '@shared/chat-types';
import { ArrowRight, Check } from 'lucide-react';
import { useState } from 'react';

type ClarifyCardProps = {
  clarify: Clarify;
  /** Awaiting an answer — render the interactive form; else the resolved view. */
  pending: boolean;
  /** The submitted answers, present once resolved. */
  result?: ClarifyResult;
  onSubmit: (result: ClarifyResult) => void;
};

/**
 * A draft answer per question. The shape mirrors the input type; `custom` holds
 * the always-available free-text entry (the user can answer outside the listed
 * options), and is what's submitted when non-empty.
 */
type QAnswer =
  | { type: 'single'; choice: string | null; custom: string }
  | { type: 'multi'; choices: string[]; custom: string }
  | { type: 'text'; text: string };

const TEXT_LIMIT = 4000;

function initAnswer(q: ClarifyQuestion): QAnswer {
  if (q.inputType === 'multi') {
    return { type: 'multi', choices: q.options?.[0] ? [q.options[0].label] : [], custom: '' };
  }
  if (q.inputType === 'text') return { type: 'text', text: '' };
  return { type: 'single', choice: q.options?.[0]?.label ?? null, custom: '' };
}

function deriveAnswer(a: QAnswer): string {
  if (a.type === 'text') return a.text.trim();
  if (a.type === 'single') return a.custom.trim() || a.choice || '';
  const picks = [...a.choices];
  if (a.custom.trim()) picks.push(a.custom.trim());
  return picks.join(', ');
}

export function ClarifyCard({
  clarify,
  pending,
  result,
  onSubmit,
}: ClarifyCardProps): React.JSX.Element {
  if (!pending) return <ResolvedCard clarify={clarify} result={result} />;
  return <PendingCard clarify={clarify} onSubmit={onSubmit} />;
}

function PendingCard({
  clarify,
  onSubmit,
}: {
  clarify: Clarify;
  onSubmit: (result: ClarifyResult) => void;
}): React.JSX.Element {
  const questions = clarify.questions;
  const [activeIndex, setActiveIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, QAnswer>>(() =>
    Object.fromEntries(questions.map((q) => [q.id, initAnswer(q)])),
  );
  const [submitted, setSubmitted] = useState(false);

  const current = questions[activeIndex] ?? questions[0];
  if (!current) return <div />;
  const isLast = activeIndex === questions.length - 1;
  const isFirst = activeIndex === 0;
  const isMulti = questions.length > 1;

  const setAnswer = (id: string, a: QAnswer): void => setAnswers((prev) => ({ ...prev, [id]: a }));
  const answeredIds = new Set(
    questions
      .filter((q) => deriveAnswer(answers[q.id] ?? initAnswer(q)).length > 0)
      .map((q) => q.id),
  );
  const allAnswered = questions.every((q) => answeredIds.has(q.id));

  const submit = (): void => {
    if (!allAnswered || submitted) return;
    setSubmitted(true);
    onSubmit({
      answers: questions.map((q) => ({
        question: q.question,
        answer: deriveAnswer(answers[q.id] ?? initAnswer(q)),
      })),
    });
  };
  const goNext = (): void => (isLast ? submit() : setActiveIndex(activeIndex + 1));
  const goPrev = (): void => {
    if (!isFirst) setActiveIndex(activeIndex - 1);
  };

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-accent/50 bg-elevated">
      {isMulti && (
        <CardHead
          questions={questions}
          activeIndex={activeIndex}
          answeredIds={answeredIds}
          onTabClick={setActiveIndex}
        />
      )}
      <div className="px-5 py-4">
        <QuestionBlock
          question={current}
          answer={answers[current.id] ?? initAnswer(current)}
          onChange={(a) => setAnswer(current.id, a)}
        />
      </div>
      <CardFoot
        isMulti={isMulti}
        isFirst={isFirst}
        isLast={isLast}
        canSubmit={allAnswered && !submitted}
        onPrev={goPrev}
        onNext={goNext}
      />
    </div>
  );
}

function CardHead({
  questions,
  activeIndex,
  answeredIds,
  onTabClick,
}: {
  questions: ClarifyQuestion[];
  activeIndex: number;
  answeredIds: Set<string>;
  onTabClick: (i: number) => void;
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 items-center gap-1 overflow-x-auto border-border-default border-b bg-surface px-4 py-2">
      {questions.map((q, i) => {
        const isActive = i === activeIndex;
        const isAnswered = answeredIds.has(q.id);
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
  canSubmit,
  onPrev,
  onNext,
}: {
  isMulti: boolean;
  isFirst: boolean;
  isLast: boolean;
  canSubmit: boolean;
  onPrev: () => void;
  onNext: () => void;
}): React.JSX.Element {
  const isSubmitStep = !isMulti || isLast;
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
      <button
        type="button"
        onClick={onNext}
        disabled={isSubmitStep && !canSubmit}
        className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3.5 py-1 text-fg-on-accent text-sm hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
      >
        {!isMulti ? '提交' : isLast ? '提交全部' : '下一个'}
        {isMulti && !isLast && <ArrowRight className="size-3.5" />}
      </button>
    </div>
  );
}

function QuestionBlock({
  question,
  answer,
  onChange,
}: {
  question: ClarifyQuestion;
  answer: QAnswer;
  onChange: (a: QAnswer) => void;
}): React.JSX.Element {
  return (
    <div>
      <div className="mb-1 font-medium text-fg-primary text-md leading-snug">
        {question.question}
      </div>
      {question.context && (
        <div className="mb-3 text-fg-tertiary text-sm leading-snug">{question.context}</div>
      )}
      <InputArea question={question} answer={answer} onChange={onChange} />
    </div>
  );
}

function InputArea({
  question,
  answer,
  onChange,
}: {
  question: ClarifyQuestion;
  answer: QAnswer;
  onChange: (a: QAnswer) => void;
}): React.JSX.Element {
  if (answer.type === 'text') {
    return <TextInput value={answer.text} onChange={(text) => onChange({ type: 'text', text })} />;
  }
  if (answer.type === 'multi') {
    return <MultiSelect options={question.options ?? []} answer={answer} onChange={onChange} />;
  }
  return <SingleSelect options={question.options ?? []} answer={answer} onChange={onChange} />;
}

const customInputCls =
  'w-full rounded-md border border-border-default bg-surface px-3.5 py-2 text-fg-primary text-sm placeholder:text-fg-disabled focus:border-accent focus:outline-none';

function SingleSelect({
  options,
  answer,
  onChange,
}: {
  options: ClarifyOption[];
  answer: Extract<QAnswer, { type: 'single' }>;
  onChange: (a: QAnswer) => void;
}): React.JSX.Element {
  const hasPreview = options.some((o) => o.preview);
  const hasCustom = answer.custom.trim().length > 0;

  const list = (
    <RadioGroup.Root
      value={hasCustom ? '' : (answer.choice ?? '')}
      onValueChange={(v) => onChange({ ...answer, choice: v, custom: '' })}
      className="flex flex-col gap-1.5"
    >
      {options.map((opt) => {
        const on = !hasCustom && answer.choice === opt.label;
        return (
          <RadioGroup.Item
            key={opt.label}
            value={opt.label}
            className={`flex items-center gap-3 rounded-md border px-3.5 py-2.5 text-left text-sm transition-colors ${
              on
                ? 'border-accent bg-accent-soft text-fg-primary'
                : 'border-border-default bg-surface text-fg-primary hover:border-border-strong'
            }`}
          >
            <span
              className={`relative flex size-4 shrink-0 items-center justify-center rounded-full border-[1.5px] ${
                on ? 'border-accent bg-accent' : 'border-border-strong'
              }`}
            >
              <RadioGroup.Indicator className="size-1.5 rounded-full bg-fg-on-accent" />
            </span>
            <span className="flex-1">{opt.label}</span>
          </RadioGroup.Item>
        );
      })}
    </RadioGroup.Root>
  );

  const customRow = (
    <input
      type="text"
      value={answer.custom}
      onChange={(e) => onChange({ ...answer, custom: e.target.value })}
      placeholder="或者填别的…"
      className={customInputCls}
    />
  );

  if (hasPreview) {
    const preview = options.find((o) => o.label === answer.choice)?.preview ?? '';
    return (
      <div className="grid grid-cols-[260px_1fr] gap-3">
        <div className="flex flex-col gap-1.5">
          {list}
          {customRow}
        </div>
        <div>
          <div className="mb-1.5 font-medium text-[10px] text-fg-tertiary uppercase tracking-wider">
            Preview · 伪代码
          </div>
          <pre className="max-h-[280px] min-h-[120px] overflow-auto rounded-md border border-border-default bg-canvas px-4 py-3 font-mono text-fg-secondary text-xs leading-snug">
            {preview}
          </pre>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {list}
      {customRow}
    </div>
  );
}

function MultiSelect({
  options,
  answer,
  onChange,
}: {
  options: ClarifyOption[];
  answer: Extract<QAnswer, { type: 'multi' }>;
  onChange: (a: QAnswer) => void;
}): React.JSX.Element {
  const toggle = (label: string): void => {
    const has = answer.choices.includes(label);
    onChange({
      ...answer,
      choices: has ? answer.choices.filter((l) => l !== label) : [...answer.choices, label],
    });
  };
  return (
    <div className="flex flex-col gap-1.5">
      {options.map((opt) => {
        const on = answer.choices.includes(opt.label);
        return (
          // biome-ignore lint/a11y/noLabelWithoutControl: wraps the Radix Checkbox control
          <label
            key={opt.label}
            className={`flex cursor-pointer items-center gap-3 rounded-md border px-3.5 py-2.5 text-sm transition-colors ${
              on
                ? 'border-accent bg-accent-soft text-fg-primary'
                : 'border-border-default bg-surface text-fg-primary hover:border-border-strong'
            }`}
          >
            <Checkbox.Root
              checked={on}
              onCheckedChange={() => toggle(opt.label)}
              className={`flex size-4 shrink-0 items-center justify-center rounded-[3px] border ${
                on ? 'border-accent bg-accent' : 'border-border-strong'
              }`}
            >
              <Checkbox.Indicator>
                <svg
                  viewBox="0 0 16 16"
                  className="size-2.5 fill-none stroke-fg-on-accent stroke-2"
                  aria-hidden="true"
                >
                  <title>Selected</title>
                  <path d="M3 8.5 6.5 12 13 4.5" />
                </svg>
              </Checkbox.Indicator>
            </Checkbox.Root>
            <span className="flex-1">{opt.label}</span>
          </label>
        );
      })}
      <input
        type="text"
        value={answer.custom}
        onChange={(e) => onChange({ ...answer, custom: e.target.value })}
        placeholder="或者补充别的…"
        className={customInputCls}
      />
    </div>
  );
}

function TextInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (text: string) => void;
}): React.JSX.Element {
  return (
    <textarea
      rows={4}
      maxLength={TEXT_LIMIT}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="自由文本输入…"
      className="block w-full resize-y rounded-md border border-border-default bg-surface px-3.5 py-2.5 text-fg-primary text-sm placeholder:text-fg-disabled focus:border-accent focus:outline-none"
    />
  );
}

function ResolvedCard({
  clarify,
  result,
}: {
  clarify: Clarify;
  result?: ClarifyResult;
}): React.JSX.Element {
  const answers = result?.answers ?? [];
  return (
    <div className="my-3 overflow-hidden rounded-lg border border-border-default bg-elevated">
      <div className="border-border-default border-b bg-surface px-4 py-2 font-medium text-[10.5px] text-fg-tertiary uppercase tracking-wider">
        已回答
      </div>
      <div className="flex flex-col gap-3 px-5 py-4">
        {clarify.questions.map((q, i) => (
          <div key={q.id}>
            <div className="text-fg-tertiary text-sm leading-snug">{q.question}</div>
            <div className="mt-0.5 text-fg-primary text-sm">{answers[i]?.answer || '—'}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
