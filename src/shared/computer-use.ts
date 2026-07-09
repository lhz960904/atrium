// Shared between the drag-to-grant UI (renderer) and the native drag / privacy
// handlers (main). Kept here so the channel name and pane keys can't drift apart.

export const COMPUTER_USE_DRAG_CHANNEL = 'computer:start-drag';

export const PRIVACY_PANES = ['accessibility', 'screenRecording'] as const;
export type PrivacyPane = (typeof PRIVACY_PANES)[number];
