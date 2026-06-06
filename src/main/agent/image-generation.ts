import { generateImage, type UIMessage } from 'ai';
import type { Db } from '../db';
import { resolveImageModel } from '../providers/resolve';
import { modelCapabilities } from './models/catalog';

const imageUrls = (msg: UIMessage | undefined): string[] =>
  (msg?.parts ?? [])
    .filter((p) => p.type === 'file' && p.mediaType.startsWith('image/'))
    .map((p) => (p as { url: string }).url);

/**
 * The image(s) to edit/iterate on. Images the user just attached are the
 * explicit subject; otherwise the most recent image in the thread, so a
 * follow-up like "make it night" edits the previous result instead of redrawing
 * from scratch. Empty when there's no prior image.
 */
export function referenceImages(messages: UIMessage[]): string[] {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const attached = imageUrls(lastUser);
  if (attached.length > 0) return attached;

  for (let i = messages.length - 1; i >= 0; i--) {
    const imgs = imageUrls(messages[i]);
    if (imgs.length > 0) return [imgs[imgs.length - 1]];
  }
  return [];
}

/** data URL → bytes; unambiguous DataContent for the image edit path. */
const dataUrlToBytes = (url: string): Uint8Array =>
  Uint8Array.from(Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));

export type GeneratedImage = { base64: string; mediaType: string };

export type GenerateThreadImageOptions = {
  db: Db;
  providerId: string;
  modelId: string;
  /** The image description / edit instruction. */
  text: string;
  /** Candidate reference images (data URLs); ignored if the model can't take image input. */
  references?: string[];
  abortSignal?: AbortSignal;
};

/**
 * Resolve the image model and generate one image. Reference images turn the call
 * into an edit, but only when the model accepts image input — pure text-to-image
 * models (imagen) would reject them, so they're dropped for those. Shared by the
 * direct image-model turn and the image_gen tool.
 */
export async function generateThreadImage(
  opts: GenerateThreadImageOptions,
): Promise<GeneratedImage> {
  const refs = modelCapabilities(opts.modelId).vision ? (opts.references ?? []) : [];
  const prompt =
    refs.length > 0 ? { text: opts.text, images: refs.map(dataUrlToBytes) } : opts.text;

  const { image } = await generateImage({
    model: resolveImageModel(opts.db, opts.providerId, opts.modelId),
    prompt,
    abortSignal: opts.abortSignal,
  });
  return { base64: image.base64, mediaType: image.mediaType };
}

/** The UIMessage stream chunk that renders a generated image as a file part. */
export const imageFileChunk = (image: GeneratedImage) => ({
  type: 'file' as const,
  mediaType: image.mediaType,
  url: `data:${image.mediaType};base64,${image.base64}`,
});
