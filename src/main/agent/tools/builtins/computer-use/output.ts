import type { ImageToolOutput } from '@shared/chat-types';
import type { HelperResponse } from '../../../../computer-use';
import { computerPermissions, promptPermissionGrant } from '../../../../computer-use/permissions';
import { captureWindow } from '../../../../computer-use/screenshot';
import { spillOversizedImages } from '../../../mcp/spill';
import type { ToolCtx } from '../../context';

/**
 * The helper's per-action result payload (mirrors the Swift `ResultPayload`).
 * We read a few fields; the rest are carried loosely.
 */
interface HelperResult {
  ok: boolean;
  toolName: string;
  snapshot?: { windowTitle?: string; treeText: string };
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

/**
 * Shared execute body: call the helper if available, else degrade to a note.
 * The platform/availability guard lives here so every tool stays a thin schema.
 */
export async function runComputerAction(
  ctx: ToolCtx,
  method: string,
  params: Record<string, unknown>,
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
  const res = await ctx.computerUse.call(method, params);
  return toToolOutput(res, ctx.workspaceRoot);
}
