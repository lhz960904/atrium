import type { ToolCtx } from '../../context';
import { defineTool, imageResult, StringEnum, Type } from '../../define';
import { runComputerAction } from './output';

/**
 * Built-in tools that drive native macOS apps through the Computer Use helper
 * (Accessibility for structure, CGEvent for input, ScreenCaptureKit for the
 * screenshot). Every action returns the app's fresh state + screenshot, so the
 * model sees the result of what it just did. Elements are addressed by the
 * `element_index` from the latest get_app_state; indices are re-numbered each
 * snapshot, so re-read on `invalid_element`.
 *
 * Driving a screen is inherently one-at-a-time — a batch of clicks fired in
 * parallel would race over the same window — so every tool here runs
 * sequentially even when the model calls several at once.
 */

const act =
  (ctx: ToolCtx, method: string) => async (_id: string, input: object, signal?: AbortSignal) =>
    imageResult(
      await runComputerAction(ctx, method, input as Record<string, unknown>, signal),
      ctx.supportsImageToolResults ?? false,
    );

const app = Type.String({
  description: 'Target app: bundle id (e.g. "com.apple.Music") or its name.',
});
const elementIndex = Type.String({
  description: 'Element index from the most recent get_app_state snapshot.',
});

export const computerListAppsTool = (ctx: ToolCtx) =>
  defineTool({
    name: 'computer_list_apps',
    label: 'List apps',
    executionMode: 'sequential',
    description:
      'List the apps currently running (and recently used) on the Mac, so you can pick one to drive.',
    parameters: Type.Object({}),
    execute: act(ctx, 'list_apps'),
  });

export const computerGetAppStateTool = (ctx: ToolCtx) =>
  defineTool({
    name: 'computer_get_app_state',
    label: 'Read app state',
    executionMode: 'sequential',
    description:
      'Open an app in the background and read its current state: an accessibility tree of ' +
      'interactive elements (each with an index) plus a window screenshot. Call this before ' +
      'acting, and again after an action to see the result.',
    parameters: Type.Object({ app }),
    execute: act(ctx, 'get_app_state'),
  });

export const computerClickTool = (ctx: ToolCtx) =>
  defineTool({
    name: 'computer_click',
    label: 'Click',
    executionMode: 'sequential',
    description:
      'Click an element (by index) or a pixel coordinate. Prefer element_index; fall back to ' +
      'x/y (screenshot pixels) when the app exposes no usable tree.',
    parameters: Type.Object({
      app,
      element_index: Type.Optional(elementIndex),
      x: Type.Optional(Type.Number({ description: 'Screenshot x, if clicking by coordinate.' })),
      y: Type.Optional(Type.Number({ description: 'Screenshot y, if clicking by coordinate.' })),
      mouse_button: Type.Optional(StringEnum(['left', 'right', 'middle'])),
      click_count: Type.Optional(
        Type.Integer({ minimum: 1, description: 'e.g. 2 for a double-click.' }),
      ),
    }),
    execute: act(ctx, 'click'),
  });

export const computerTypeTextTool = (ctx: ToolCtx) =>
  defineTool({
    name: 'computer_type_text',
    label: 'Type text',
    executionMode: 'sequential',
    description: 'Type literal text into the focused field of an app.',
    parameters: Type.Object({ app, text: Type.String() }),
    execute: act(ctx, 'type_text'),
  });

export const computerPressKeyTool = (ctx: ToolCtx) =>
  defineTool({
    name: 'computer_press_key',
    label: 'Press key',
    executionMode: 'sequential',
    description:
      'Press a key or key combination (xdotool syntax): e.g. "cmd+s", "Return", "space", "ctrl+shift+t".',
    parameters: Type.Object({ app, key: Type.String() }),
    execute: act(ctx, 'press_key'),
  });

export const computerScrollTool = (ctx: ToolCtx) =>
  defineTool({
    name: 'computer_scroll',
    label: 'Scroll',
    executionMode: 'sequential',
    description: 'Scroll a scrollable element up/down/left/right by a number of pages.',
    parameters: Type.Object({
      app,
      element_index: elementIndex,
      direction: StringEnum(['up', 'down', 'left', 'right']),
      pages: Type.Optional(Type.Integer({ minimum: 1 })),
    }),
    execute: act(ctx, 'scroll'),
  });

export const computerDragTool = (ctx: ToolCtx) =>
  defineTool({
    name: 'computer_drag',
    label: 'Drag',
    executionMode: 'sequential',
    description: 'Drag from one screenshot coordinate to another (e.g. move a window or a file).',
    parameters: Type.Object({
      app,
      from_x: Type.Number(),
      from_y: Type.Number(),
      to_x: Type.Number(),
      to_y: Type.Number(),
    }),
    execute: act(ctx, 'drag'),
  });

export const computerSetValueTool = (ctx: ToolCtx) =>
  defineTool({
    name: 'computer_set_value',
    label: 'Set value',
    executionMode: 'sequential',
    description:
      "Set an element's value directly (a slider, stepper, or text field) — faster than typing character by character.",
    parameters: Type.Object({ app, element_index: elementIndex, value: Type.String() }),
    execute: act(ctx, 'set_value'),
  });

export const computerPerformActionTool = (ctx: ToolCtx) =>
  defineTool({
    name: 'computer_perform_action',
    label: 'Perform action',
    executionMode: 'sequential',
    description:
      'Invoke a secondary accessibility action on an element: "raise" (bring window forward), ' +
      '"press", "showmenu" (context menu), "confirm", "cancel", "pick".',
    parameters: Type.Object({ app, element_index: elementIndex, action: Type.String() }),
    execute: act(ctx, 'perform_secondary_action'),
  });
