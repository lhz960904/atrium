import type { ImageToolOutput } from '@shared/chat-types';
import type { HelperResponse } from '../../../../computer-use';
import { computerPermissions, promptPermissionGrant } from '../../../../computer-use/permissions';
import { captureWindow } from '../../../../computer-use/screenshot';
import { getSettings } from '../../../../settings/conf';
import { spillOversizedImages } from '../../../mcp/spill';
import type { ToolCtx } from '../../context';

interface SnapshotElement {
  /** Raw kAXRole (locale-independent), e.g. "AXButton" — not the rendered name. */
  role?: string | null;
  /** Raw AX action names, e.g. "AXPress", "AXRaise". */
  actions?: string[] | null;
}

/**
 * The helper's per-action result payload (mirrors the Swift `ResultPayload`).
 * We read a few fields; the rest are carried loosely.
 */
interface HelperResult {
  ok: boolean;
  toolName: string;
  snapshot?: { windowTitle?: string; treeText: string; elements?: SnapshotElement[] };
  /** The window to screenshot (the helper can't capture — the main process does). */
  data?: { windowId?: number; windowWidth?: number; windowHeight?: number };
  meta?: { rawText?: string };
  error?: { code: string; message: string };
}

/**
 * Turn a helper response into a tool output. Every action returns the app's
 * fresh state text (the AX tree, wrapped) plus a window screenshot, so the
 * model always sees the result of what it just did. Oversized screenshots spill
 * to disk (reusing the MCP spill path) rather than bloating the stream.
 */
async function toToolOutput(
  res: HelperResponse,
  workspaceRoot: string,
): Promise<string | ImageToolOutput> {
  if (!res.ok) {
    return `Error: ${res.error ?? 'Computer Use helper failed.'}`;
  }
  const result = res.result as HelperResult | undefined;
  if (!result) {
    return 'Error: Computer Use helper returned no result.';
  }
  if (result.error) {
    return `Error: ${result.error.message}`;
  }

  const text = result.meta?.rawText ?? result.snapshot?.treeText ?? `${result.toolName} completed.`;

  // The helper doesn't capture; it returns the window to shoot. Capture it in
  // the main process (which holds the grant); a failed capture degrades to text.
  const window = result.data;
  if (!window || typeof window.windowId !== 'number') {
    return text;
  }
  const image = await captureWindow(
    window.windowId,
    window.windowWidth ?? 0,
    window.windowHeight ?? 0,
  );
  if (!image) {
    return text;
  }
  return spillOversizedImages({ text, images: [image] }, workspaceRoot);
}

// Raw AX roles the model can actually click or type into. Matched against an
// element's kAXRole, which is locale-independent (unlike the rendered name).
const ACTIONABLE_AX_ROLES = new Set([
  'AXButton',
  'AXMenuButton',
  'AXPopUpButton',
  'AXMenuItem',
  'AXTextField',
  'AXTextArea',
  'AXSearchField',
  'AXComboBox',
  'AXCheckBox',
  'AXRadioButton',
  'AXLink',
  'AXSlider',
  'AXStepper',
  'AXIncrementor',
  'AXDisclosureTriangle',
]);

function isActionableElement(el: SnapshotElement): boolean {
  if (el.role && ACTIONABLE_AX_ROLES.has(el.role)) return true;
  // Any action other than raising a window means the element is interactable.
  return (el.actions ?? []).some((action) => action !== 'AXRaise');
}

/**
 * True when an app's accessibility snapshot has nothing the model can act on —
 * zero elements, or just inert shells (a bare window whose only action is
 * Raise). Custom-rendered apps (many media/chat apps) look exactly like this:
 * the OS reports a window but exposes none of its contents to accessibility.
 */
function isUnreadableSnapshot(res: HelperResponse): boolean {
  const elements = (res.result as HelperResult | undefined)?.snapshot?.elements;
  if (!elements) return false;
  return !elements.some(isActionableElement);
}

/*
 * A vision model would just read the screenshot when the tree is empty; a
 * non-vision model has no such fallback, so without this note it hammers
 * get_app_state forever on an app it can never see. Make the dead end explicit
 * and push it to escalate to the user instead.
 */
const UNREADABLE_APP_NOTE =
  "[computer-use] This app exposes no actionable accessibility elements, and the current model can't see the screenshot — you are effectively blind to this window, and calling get_app_state again will return the same empty tree. Stop retrying. Tell the user this app is likely custom-rendered (common for media/chat apps) and can't be driven without vision: ask them to bring its main window to the front, or to switch to a vision-capable model.";

function appendNote(output: string | ImageToolOutput, note: string): string | ImageToolOutput {
  if (typeof output === 'string') return output ? `${output}\n\n${note}` : note;
  return { ...output, text: output.text ? `${output.text}\n\n${note}` : note };
}

/**
 * Shared execute body: call the helper if available, else degrade to a note.
 * The platform/availability guard lives here so every tool stays a thin schema.
 */
export async function runComputerAction(
  ctx: ToolCtx,
  method: string,
  params: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<string | ImageToolOutput> {
  if (!ctx.computerUse) {
    return 'Error: Computer use is only available on macOS.';
  }
  // Both grants are needed to act (Accessibility) and to see (Screen Recording).
  // If either is missing, prompt the user via the renderer instead of failing
  // opaquely, and tell the model to retry once they've granted it.
  const perms = computerPermissions();
  if (!perms.accessibility || !perms.screenRecording) {
    promptPermissionGrant(perms);
    return "Computer use needs Accessibility and Screen Recording permission — they aren't both granted right now. I've opened the grant prompt for the user; ask them to complete it, then try the action again.";
  }
  // The cursor preference rides on every request (read live, so a mid-turn
  // toggle applies) — a one-shot set would be lost when a timed-out helper is
  // killed and respawned.
  const res = await ctx.computerUse.call(
    method,
    { ...params, show_cursor: getSettings('computerUse').showVirtualCursor },
    { signal },
  );
  const output = await toToolOutput(res, ctx.workspaceRoot);
  if (
    method === 'get_app_state' &&
    !(ctx.supportsImageToolResults ?? false) &&
    isUnreadableSnapshot(res)
  ) {
    return appendNote(output, UNREADABLE_APP_NOTE);
  }
  return output;
}
