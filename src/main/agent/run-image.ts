import { createUIMessageStream, generateId, type UIMessage, type UIMessageChunk } from 'ai';
import type { Db } from '../db';
import { generateThreadImage, imageFileChunk, referenceImages } from './image-generation';
import { readableError } from './run';

export type RunImageOptions = {
  db: Db;
  providerId: string;
  modelId: string;
  messages: UIMessage[];
  abortSignal?: AbortSignal;
  /** Persist the finished assistant message (image as a file part). */
  onFinish: (message: UIMessage) => void;
};

/** The text of the most recent user message — the image prompt. */
function latestUserText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== 'user') continue;
    return (messages[i].parts ?? [])
      .map((p) => (p.type === 'text' ? p.text : ''))
      .join('')
      .trim();
  }
  return '';
}

/**
 * A turn whose selected model is an image model: skip the agent loop entirely
 * (these models can't do chat/tool-calling — sending them to /chat/completions
 * 400s) and run text-to-image directly, streaming the result back as a file
 * part so it renders like any generated image. Mirrors runAgent's stream
 * contract so the server and client treat both turns identically.
 *
 * With no agent to decide, the previous/attached image is always carried as a
 * reference (when the model takes image input), so a follow-up edits it.
 */
export function runImageTurn(opts: RunImageOptions): ReadableStream<UIMessageChunk> {
  return createUIMessageStream({
    originalMessages: opts.messages,
    generateId,
    onError: readableError,
    onFinish: ({ responseMessage }) => opts.onFinish(responseMessage),
    execute: async ({ writer }) => {
      // The image is the only chunk and arrives only when generation finishes
      // (which can take minutes), so announce progress up front to drive a
      // loading indicator — the message is otherwise empty until then.
      writer.write({ type: 'data-imageGeneration', data: { phase: 'start' }, transient: true });
      try {
        const image = await generateThreadImage({
          db: opts.db,
          providerId: opts.providerId,
          modelId: opts.modelId,
          text: latestUserText(opts.messages),
          references: referenceImages(opts.messages),
          abortSignal: opts.abortSignal,
        });
        writer.write(imageFileChunk(image));
      } finally {
        writer.write({ type: 'data-imageGeneration', data: { phase: 'done' }, transient: true });
      }
    },
  });
}
