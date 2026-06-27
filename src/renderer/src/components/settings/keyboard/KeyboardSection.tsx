import {
  DEFAULT_KEYBINDINGS,
  KEYBINDING_COMMANDS,
  type KeybindingCommand,
} from '@shared/keybindings';
import type { ParseKeys } from 'i18next';
import { RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Kbd } from '../../../components/Kbd';
import { eventToBinding } from '../../../lib/keymap';
import { useSetting } from '../../../lib/use-setting';

const LABEL_KEYS: Record<KeybindingCommand, ParseKeys> = {
  search: 'settings.keyboard.cmdSearch',
  newChat: 'settings.keyboard.cmdNewChat',
  toggleSidebar: 'settings.keyboard.cmdToggleSidebar',
  openSettings: 'settings.keyboard.cmdOpenSettings',
};

const DESC_KEYS: Record<KeybindingCommand, ParseKeys> = {
  search: 'settings.keyboard.descSearch',
  newChat: 'settings.keyboard.descNewChat',
  toggleSidebar: 'settings.keyboard.descToggleSidebar',
  openSettings: 'settings.keyboard.descOpenSettings',
};

// Shown read-only/greyed: the native menu owns these (close/quit), so they're
// not configurable here yet — listing them keeps the shortcut map complete.
const SYSTEM_KEYS: { labelKey: ParseKeys; descKey: ParseKeys; binding: string }[] = [
  {
    labelKey: 'settings.keyboard.cmdCloseWindow',
    descKey: 'settings.keyboard.descCloseWindow',
    binding: 'mod+w',
  },
  {
    labelKey: 'settings.keyboard.cmdQuit',
    descKey: 'settings.keyboard.descQuit',
    binding: 'mod+q',
  },
];

const LONE_MODIFIERS = new Set(['Control', 'Meta', 'Shift', 'Alt']);
// Command | Keybinding | action — shared by the header and every row so columns line up.
const ROW = 'grid grid-cols-[1fr_1fr_auto] items-center gap-4 px-4';

export function KeyboardSection(): React.JSX.Element {
  const { t } = useTranslation();
  const { value: overrides, set: setOverrides } = useSetting('keyboard.bindings');
  const [recording, setRecording] = useState<KeybindingCommand | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stop = (): void => {
    setRecording(null);
    setError(null);
  };

  // While recording, capture the next combo before it reaches the global
  // dispatcher: a capture-phase listener that stops propagation, so pressing e.g.
  // ⌘B to rebind doesn't also toggle the sidebar.
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent): void => {
      if (LONE_MODIFIERS.has(e.key)) return; // wait for a real key
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setRecording(null);
        setError(null);
        return;
      }
      const binding = eventToBinding(e);
      if (!binding) {
        setError(t('settings.keyboard.needModifier'));
        return;
      }
      const clash = KEYBINDING_COMMANDS.find(
        (c) => c !== recording && (overrides[c] ?? DEFAULT_KEYBINDINGS[c]) === binding,
      );
      if (clash) {
        setError(t('settings.keyboard.usedBy', { cmd: t(LABEL_KEYS[clash]) }));
        return;
      }
      setOverrides({ ...overrides, [recording]: binding });
      setRecording(null);
      setError(null);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [recording, overrides, setOverrides, t]);

  const reset = (cmd: KeybindingCommand): void => {
    const next = { ...overrides };
    delete next[cmd];
    setOverrides(next);
  };

  return (
    <div className="overflow-hidden rounded-xl border border-border-default bg-surface">
      <div className={`${ROW} border-border-default border-b py-2.5 text-fg-tertiary text-xs`}>
        <span>{t('settings.keyboard.colCommand')}</span>
        <span>{t('settings.keyboard.colKeybinding')}</span>
        <span className="size-7" />
      </div>

      <div className="divide-y divide-border-default">
        {KEYBINDING_COMMANDS.map((cmd) => {
          const isRec = recording === cmd;
          const binding = overrides[cmd] ?? DEFAULT_KEYBINDINGS[cmd];
          const customized = overrides[cmd] != null && overrides[cmd] !== DEFAULT_KEYBINDINGS[cmd];
          return (
            <div key={cmd}>
              <div className={`${ROW} py-3`}>
                <div className="min-w-0">
                  <div className="font-medium text-fg-primary text-sm">{t(LABEL_KEYS[cmd])}</div>
                  <div className="mt-0.5 truncate text-fg-tertiary text-xs">
                    {t(DESC_KEYS[cmd])}
                  </div>
                </div>

                {isRec ? (
                  <div className="flex items-center gap-3">
                    <span className="inline-flex h-7 items-center rounded-md border border-accent bg-surface px-3 text-fg-secondary text-sm">
                      {t('settings.keyboard.pressShortcut')}
                    </span>
                    <button
                      type="button"
                      onClick={stop}
                      className="text-fg-tertiary text-sm hover:text-fg-secondary"
                    >
                      {t('settings.keyboard.cancel')}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setRecording(cmd);
                    }}
                    className="inline-flex h-7 w-fit items-center rounded-md bg-surface-strong px-2.5 text-fg-secondary hover:bg-elevated"
                  >
                    <Kbd binding={binding} />
                  </button>
                )}

                {!isRec && customized ? (
                  <button
                    type="button"
                    title={t('settings.keyboard.reset')}
                    onClick={() => reset(cmd)}
                    className="inline-flex size-7 items-center justify-center rounded-md text-fg-tertiary hover:bg-elevated hover:text-fg-secondary"
                  >
                    <RotateCcw className="size-[13px]" />
                  </button>
                ) : (
                  <span className="size-7" />
                )}
              </div>

              {isRec && error && (
                <div className={`${ROW} pb-3`}>
                  <span />
                  <span className="text-warning text-xs">{error}</span>
                  <span className="size-7" />
                </div>
              )}
            </div>
          );
        })}

        {SYSTEM_KEYS.map((sys) => (
          <div
            key={sys.binding}
            className={`${ROW} py-3`}
            title={t('settings.keyboard.systemManaged')}
          >
            <div className="min-w-0">
              <div className="font-medium text-fg-tertiary text-sm">{t(sys.labelKey)}</div>
              <div className="mt-0.5 truncate text-fg-disabled text-xs">{t(sys.descKey)}</div>
            </div>
            <span className="inline-flex h-7 w-fit items-center rounded-md bg-surface-strong px-2.5 text-fg-disabled">
              <Kbd binding={sys.binding} />
            </span>
            <span className="size-7" />
          </div>
        ))}
      </div>
    </div>
  );
}
