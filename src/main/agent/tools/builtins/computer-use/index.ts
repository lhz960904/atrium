import { tool } from 'ai';
import { z } from 'zod';
import type { ToolCtx } from '../../context';
import { imageOutputToModelOutput } from '../../output';
import { runComputerAction } from './output';

/**
 * Built-in tools that drive native macOS apps through the Computer Use helper
 * (Accessibility for structure, CGEvent for input, ScreenCaptureKit for the
 * screenshot). Every action returns the app's fresh state + screenshot, so the
 * model sees the result of what it just did. Elements are addressed by the
 * `element_index` from the latest get_app_state; indices are re-numbered each
 * snapshot, so re-read on `invalid_element`.
 */

const modelOutput =
  (ctx: ToolCtx) =>
  ({ output }: { output: unknown }) =>
    imageOutputToModelOutput(output, ctx.supportsImageToolResults ?? false);

const appField = z.string().describe('Target app: bundle id (e.g. "com.apple.Music") or its name.');
const elementIndex = z
  .string()
  .describe('Element index from the most recent get_app_state snapshot.');

export const computerListAppsTool = (ctx: ToolCtx) =>
  tool({
    description:
      'List the apps currently running (and recently used) on the Mac, so you can pick one to drive.',
    inputSchema: z.object({}),
    execute: (_input, { abortSignal }) => runComputerAction(ctx, 'list_apps', {}, abortSignal),
    toModelOutput: modelOutput(ctx),
  });

export const computerGetAppStateTool = (ctx: ToolCtx) =>
  tool({
    description:
      'Open an app in the background and read its current state: an accessibility tree of ' +
      'interactive elements (each with an index) plus a window screenshot. Call this before ' +
      'acting, and again after an action to see the result.',
    inputSchema: z.object({ app: appField }),
    execute: ({ app }, { abortSignal }) =>
      runComputerAction(ctx, 'get_app_state', { app }, abortSignal),
    toModelOutput: modelOutput(ctx),
  });

export const computerClickTool = (ctx: ToolCtx) =>
  tool({
    description:
      'Click an element (by index) or a pixel coordinate. Prefer element_index; fall back to ' +
      'x/y (screenshot pixels) when the app exposes no usable tree.',
    inputSchema: z.object({
      app: appField,
      element_index: elementIndex.optional(),
      x: z.number().optional().describe('Screenshot x, if clicking by coordinate.'),
      y: z.number().optional().describe('Screenshot y, if clicking by coordinate.'),
      mouse_button: z.enum(['left', 'right', 'middle']).optional(),
      click_count: z.number().int().min(1).optional().describe('e.g. 2 for a double-click.'),
    }),
    execute: (input, { abortSignal }) => runComputerAction(ctx, 'click', input, abortSignal),
    toModelOutput: modelOutput(ctx),
  });

export const computerTypeTextTool = (ctx: ToolCtx) =>
  tool({
    description: 'Type literal text into the focused field of an app.',
    inputSchema: z.object({ app: appField, text: z.string() }),
    execute: (input, { abortSignal }) => runComputerAction(ctx, 'type_text', input, abortSignal),
    toModelOutput: modelOutput(ctx),
  });

export const computerPressKeyTool = (ctx: ToolCtx) =>
  tool({
    description:
      'Press a key or key combination (xdotool syntax): e.g. "cmd+s", "Return", "space", "ctrl+shift+t".',
    inputSchema: z.object({ app: appField, key: z.string() }),
    execute: (input, { abortSignal }) => runComputerAction(ctx, 'press_key', input, abortSignal),
    toModelOutput: modelOutput(ctx),
  });

export const computerScrollTool = (ctx: ToolCtx) =>
  tool({
    description: 'Scroll a scrollable element up/down/left/right by a number of pages.',
    inputSchema: z.object({
      app: appField,
      element_index: elementIndex,
      direction: z.enum(['up', 'down', 'left', 'right']),
      pages: z.number().int().min(1).optional(),
    }),
    execute: (input, { abortSignal }) => runComputerAction(ctx, 'scroll', input, abortSignal),
    toModelOutput: modelOutput(ctx),
  });

export const computerDragTool = (ctx: ToolCtx) =>
  tool({
    description: 'Drag from one screenshot coordinate to another (e.g. move a window or a file).',
    inputSchema: z.object({
      app: appField,
      from_x: z.number(),
      from_y: z.number(),
      to_x: z.number(),
      to_y: z.number(),
    }),
    execute: (input, { abortSignal }) => runComputerAction(ctx, 'drag', input, abortSignal),
    toModelOutput: modelOutput(ctx),
  });

export const computerSetValueTool = (ctx: ToolCtx) =>
  tool({
    description:
      "Set an element's value directly (a slider, stepper, or text field) — faster than typing character by character.",
    inputSchema: z.object({ app: appField, element_index: elementIndex, value: z.string() }),
    execute: (input, { abortSignal }) => runComputerAction(ctx, 'set_value', input, abortSignal),
    toModelOutput: modelOutput(ctx),
  });

export const computerPerformActionTool = (ctx: ToolCtx) =>
  tool({
    description:
      'Invoke a secondary accessibility action on an element: "raise" (bring window forward), ' +
      '"press", "showmenu" (context menu), "confirm", "cancel", "pick".',
    inputSchema: z.object({
      app: appField,
      element_index: elementIndex,
      action: z.string(),
    }),
    execute: (input, { abortSignal }) =>
      runComputerAction(ctx, 'perform_secondary_action', input, abortSignal),
    toModelOutput: modelOutput(ctx),
  });
