import type { ImageToolOutput } from '@shared/chat-types';
import type { HelperResponse } from '../../../../computer-use';
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
  artifacts?: { screenshotMimeType?: string; screenshotBase64?: string };
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
  const base64 = result.artifacts?.screenshotBase64;
  if (!base64) {
    return text;
  }

  const mediaType = result.artifacts?.screenshotMimeType ?? 'image/png';
  const output: ImageToolOutput = {
    text,
    images: [
      { mediaType, dataUrl: `data:${mediaType};base64,${base64}`, filename: 'screenshot.png' },
    ],
  };
  return spillOversizedImages(output, workspaceRoot);
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
  const res = await ctx.computerUse.call(method, params);
  return toToolOutput(res, ctx.workspaceRoot);
}
