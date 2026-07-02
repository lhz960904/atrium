import * as Popover from '@radix-ui/react-popover';
import { CalendarClock } from 'lucide-react';
import type { CSSProperties } from 'react';
import { DayPicker } from 'react-day-picker';
import { enUS, zhCN } from 'react-day-picker/locale';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '../../lib/time';
import 'react-day-picker/style.css';

const pad = (n: number): string => String(n).padStart(2, '0');

// react-day-picker themes through CSS variables; map them onto Atrium's tokens.
const rdpTheme = {
  '--rdp-accent-color': 'var(--accent-default)',
  '--rdp-accent-background-color': 'var(--accent-soft)',
  '--rdp-today-color': 'var(--accent-default)',
  '--rdp-day-width': '2rem',
  '--rdp-day-height': '2rem',
  '--rdp-day_button-width': '2rem',
  '--rdp-day_button-height': '2rem',
} as CSSProperties;

/**
 * A themed date + time picker (Radix Popover + react-day-picker calendar + a
 * compact HH:MM field), for a one-time task's absolute run time — replaces the
 * OS-native datetime input. `value`/`onChange` carry a full Date (date + time).
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
          style={rdpTheme}
          className="z-50 rounded-lg border border-border-default bg-elevated p-3 text-fg-primary text-sm shadow-lg"
        >
          <DayPicker
            mode="single"
            selected={value ?? undefined}
            onSelect={setDay}
            locale={lang === 'zh' ? zhCN : enUS}
            weekStartsOn={1}
            showOutsideDays
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
