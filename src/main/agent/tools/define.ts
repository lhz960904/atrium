import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import type { ImageContent, TextContent } from '@earendil-works/pi-ai';
import type { ImageToolOutput } from '@shared/chat-types';
import { type TSchema, Type } from 'typebox';

/**
 * The pi tool vocabulary as Atrium uses it. `content` is what the model reads;
 * `details` is the structured payload the UI renders — the renderer reads a
 * tool result's details verbatim, so each tool's details must stay the exact
 * shape its card already knows.
 *
 * `clientSide` marks a tool the engine must never execute: the model's call
 * ends the turn and the user's answer becomes the result. pi has no such
 * concept — every call needs a result — so it is carried as our own flag until
 * the HITL step gives those tools a real pi-side execute.
 */
export type AtriumTool<P extends TSchema = TSchema, D = unknown> = AgentTool<P, D> & {
  clientSide?: true;
};

/**
 * Binds `execute`'s params to `parameters` while authoring, then widens to the
 * collection type. The widening is a cast because pi declares `execute` as a
 * property rather than a method: a tool whose params are a concrete object is
 * not assignable to one whose params are `unknown`, so a mixed toolset can only
 * be typed at the open end.
 */
export function defineTool<P extends TSchema, D>(t: AtriumTool<P, D>): AtriumTool {
  return t as unknown as AtriumTool;
}

export { Type };

/**
 * A JSON Schema string enum. TypeBox renders a union of literals as
 * `anyOf: [{const}]`, which pi ships to the provider verbatim; a plain `enum`
 * is what the models were trained on and what these schemas have always sent.
 */
export function StringEnum<const T extends readonly string[]>(
  values: T,
  options: { description?: string; default?: T[number] } = {},
): ReturnType<typeof Type.Unsafe<T[number]>> {
  return Type.Unsafe<T[number]>({ type: 'string', enum: [...values], ...options });
}

/** A text-only result: the model reads it and the card shows the same string. */
export function textResult(text: string): AgentToolResult<string> {
  return { content: [{ type: 'text', text }], details: text };
}

/**
 * A result carrying images. The card always gets both text and images; the
 * model only gets the images when the active provider+model can consume them
 * — otherwise they degrade to an explicit note, so the model knows what it
 * isn't seeing rather than silently reasoning over a dropped screenshot.
 */
export function imageResult(
  output: string | ImageToolOutput,
  supportsImages: boolean,
): AgentToolResult<string | ImageToolOutput> {
  if (typeof output === 'string') return textResult(output);
  const { text, images } = output;
  if (!supportsImages) {
    const note = `[${images.length} image(s) omitted: the current model cannot view images]`;
    return { content: [{ type: 'text', text: text ? `${text}\n${note}` : note }], details: output };
  }
  const content: (TextContent | ImageContent)[] = text ? [{ type: 'text', text }] : [];
  for (const img of images) {
    content.push({
      type: 'image',
      data: img.dataUrl.slice(img.dataUrl.indexOf(',') + 1),
      mimeType: img.mediaType,
    });
  }
  return { content, details: output };
}
