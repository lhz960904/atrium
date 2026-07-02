import * as Popover from '@radix-ui/react-popover';
import { CalendarClock, ChevronLeft, ChevronRight } from 'lucide-react';
import { DayPicker } from 'react-day-picker';
import { enUS, zhCN } from 'react-day-picker/locale';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '../../lib/time';

const pad = (n: number): string => String(n).padStart(2, '0');

const navBtn =
  'inline-flex size-7 items-center justify-center rounded-md text-fg-tertiary outline-0 hover:bg-surface-strong hover:text-fg-primary';

// Fully themed via classNames (no default stylesheet) so the calendar matches
// Atrium — selected/today derive from the day cell's data-* attributes.
const dayPickerClassNames = {
  months: 'relative',
  month: 'flex flex-col gap-2',
  month_caption: 'flex h-7 items-center px-1',
  caption_label: 'font-medium text-fg-primary text-sm',
  nav: 'absolute top-0 right-0 flex items-center gap-1',
  button_previous: navBtn,
  button_next: navBtn,
  weekdays: 'flex',
  weekday: 'w-8 pb-1 font-normal text-fg-tertiary text-xs',
  week: 'mt-0.5 flex',
  day: 'group/day size-8 p-0 text-center',
  day_button:
    'inline-flex size-8 items-center justify-center rounded-md text-fg-primary text-sm outline-0 hover:bg-surface-strong group-data-[today=true]/day:font-semibold group-data-[today=true]/day:underline group-data-[today=true]/day:underline-offset-2 group-data-[selected=true]/day:bg-accent group-data-[selected=true]/day:text-fg-on-accent group-data-[selected=true]/day:hover:bg-accent',
  outside: 'text-fg-disabled',
  disabled: 'text-fg-disabled opacity-40',
  hidden: 'invisible',
};

function Chevron({ orientation }: { orientation?: 'left' | 'right' | 'up' | 'down' }) {
  return orientation === 'left' ? (
    <ChevronLeft className="size-4" />
  ) : (
    <ChevronRight className="size-4" />
  );
}

/**
 * A themed date + time picker (Radix Popover + react-day-picker calendar styled
 * to Atrium via classNames, plus a compact HH:MM field) for a one-time task's
 * absolute run time. `value`/`onChange` carry a full Date (date + time).
 */
export function DateTimePicker({
  value,
  onChange,
  lang,
}: {
  value: Date | null;
  onChange: (d: Date) => void;
  lang: 'en' | 'zh';
}): React.JSX.Element {
  const { t } = useTranslation();
  const hour = value?.getHours() ?? 9;
  const minute = value?.getMinutes() ?? 0;

  const setDay = (day: Date | undefined): void => {
    if (!day) return;
    const d = new Date(day);
    d.setHours(hour, minute, 0, 0);
    onChange(d);
  };
  const setTime = (h: number, m: number): void => {
    const d = value ? new Date(value) : new Date();
    d.setHours(h, m, 0, 0);
    onChange(d);
  };

  return (
    <Popover.Root>
      <Popover.Trigger className="flex w-full items-center justify-between gap-2 rounded-md border border-border-default bg-surface px-2.5 py-1.5 text-sm outline-0 hover:border-border-strong focus:border-accent data-[state=open]:border-accent">
        <span className={value ? 'text-fg-primary' : 'text-fg-disabled'}>
          {value ? formatDateTime(value, lang) : t('scheduled.pickDateTime')}
        </span>
        <CalendarClock className="size-4 shrink-0 text-fg-tertiary" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-50 rounded-lg border border-border-default bg-elevated p-3 text-fg-primary text-sm shadow-lg"
        >
          <DayPicker
            mode="single"
            selected={value ?? undefined}
            onSelect={setDay}
            locale={lang === 'zh' ? zhCN : enUS}
            weekStartsOn={1}
            showOutsideDays
            classNames={dayPickerClassNames}
            components={{ Chevron }}
          />
          <div className="mt-2 flex items-center justify-center gap-2 border-border-default border-t pt-2.5">
            <span className="text-fg-tertiary text-xs">{t('scheduled.atTime')}</span>
            <input
              type="text"
              key={`${pad(hour)}:${pad(minute)}`}
              defaultValue={`${pad(hour)}:${pad(minute)}`}
              placeholder="HH:MM"
              onBlur={(e) => {
                const [h, m] = e.target.value.split(':').map(Number);
                if (
                  Number.isInteger(h) &&
                  h >= 0 &&
                  h < 24 &&
                  Number.isInteger(m) &&
                  m >= 0 &&
                  m < 60
                ) {
                  setTime(h, m);
                }
              }}
              className="w-[68px] rounded-md border border-border-default bg-surface px-2 py-1 text-center font-mono text-fg-primary text-sm outline-0 focus:border-accent"
            />
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
