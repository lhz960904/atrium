import {
  DEFAULT_KEYBINDINGS,
  KEYBINDING_COMMANDS,
  type KeybindingCommand,
} from '@shared/keybindings';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useRef } from 'react';
import { useCommandPalette } from '../state/command-palette-store';
import { useSidebarStore } from '../state/sidebar-store';
import { eventToBinding } from './keymap';
import { useSetting } from './use-setting';

/**
 * The single global keybinding dispatcher: one window keydown listener that
 * normalizes each combo, looks up the effective binding (registry default,
 * overridden by settings.keyboard.bindings), and runs the command. Mount it once
 * at the app root. New commands are added to KEYBINDING_COMMANDS + the handler
 * map below — no new listener, no scattered useEffect.
 */
export function useKeybindings(): void {
  const navigate = useNavigate();
  const togglePalette = useCommandPalette((s) => s.toggle);
  const toggleSidebar = useSidebarStore((s) => s.toggle);
  const { value: overrides } = useSetting('keyboard.bindings');

  const handlers = useMemo<Record<KeybindingCommand, () => void>>(
    () => ({
      search: togglePalette,
      newChat: () => void navigate({ to: '/' }),
      toggleSidebar,
      openSettings: () =>
        void navigate({ to: '/settings/$section', params: { section: 'general' } }),
    }),
    [navigate, togglePalette, toggleSidebar],
  );

  const bindingToCommand = useMemo(() => {
    const map = new Map<string, KeybindingCommand>();
    for (const cmd of KEYBINDING_COMMANDS) {
      map.set(overrides[cmd] ?? DEFAULT_KEYBINDINGS[cmd], cmd);
    }
    return map;
  }, [overrides]);

  // The listener mounts once; route the latest handlers/bindings through a ref so
  // a rebind or navigation change doesn't churn the window subscription.
  const latest = useRef({ handlers, bindingToCommand });
  latest.current = { handlers, bindingToCommand };

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const binding = eventToBinding(e);
      if (!binding) return;
      const cmd = latest.current.bindingToCommand.get(binding);
      if (!cmd) return;
      e.preventDefault();
      latest.current.handlers[cmd]();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
