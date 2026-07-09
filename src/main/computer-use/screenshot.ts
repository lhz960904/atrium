import type { ToolResultImage } from '@shared/chat-types';
import { desktopCapturer } from 'electron';

// Electron window source ids are "window:<CGWindowID>:<sequence>" on macOS.
function cgWindowId(sourceId: string): number | null {
  const match = /^window:(\d+):/.exec(sourceId);
  return match ? Number(match[1]) : null;
}

/**
 * Capture a single window (by CGWindowID) with Electron's desktopCapturer,
 * which runs in Atrium's main process — the one that holds the Screen Recording
 * grant. A spawned helper can't capture (the grant binds to the originating
 * process), so the helper returns the window id + size and we capture here.
 *
 * `thumbnailSize` is the window's logical-point size straight from the helper,
 * so the image's coordinate space matches the helper's `screenPoint` mapping
 * (screen = window.origin + screenshot point, no scaling). That keeps
 * pixel-fallback clicks landing exactly where the model saw them.
 */
export async function captureWindow(
  windowId: number,
  width: number,
  height: number,
): Promise<ToolResultImage | null> {
  const size = { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
  const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: size });
  const source = sources.find((s) => cgWindowId(s.id) === windowId);
  if (!source || source.thumbnail.isEmpty()) {
    return null;
  }
  const png = source.thumbnail.toPNG();
  return {
    mediaType: 'image/png',
    dataUrl: `data:image/png;base64,${png.toString('base64')}`,
    filename: 'screenshot.png',
  };
}
