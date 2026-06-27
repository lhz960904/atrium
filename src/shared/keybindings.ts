/**
 * Keyboard-command registry data, shared between the renderer dispatcher and the
 * settings schema. The handlers live in the renderer (they need navigate/stores);
 * here we keep only the stable metadata — the command ids and their default
 * bindings — so settings can validate overrides and the dispatcher can resolve
 * effective bindings without a second source of truth.
 *
 * Window/app-level keys that overlap the native menu (⌘W close, ⌘Q quit) are
 * deliberately absent: the OS menu role already drives them, and a renderer
 * dispatcher can't reclaim the native accelerator anyway. They join the registry
 * once we ship a custom application menu (V2).
 */

export const KEYBINDING_COMMANDS = ['search', 'newChat', 'toggleSidebar', 'openSettings'] as const;
export type KeybindingCommand = (typeof KEYBINDING_COMMANDS)[number];

/** Default combo per command, as a normalized binding string: modifiers in the
 *  fixed order mod→alt→shift, then the key. 'mod' folds ⌘ (macOS) and Ctrl
 *  (Windows/Linux) so one binding works on every platform. Users override these
 *  in settings.keyboard.bindings; an absent command falls back here. */
export const DEFAULT_KEYBINDINGS: Record<KeybindingCommand, string> = {
  search: 'mod+k',
  newChat: 'mod+n',
  toggleSidebar: 'mod+b',
  openSettings: 'mod+,',
};
