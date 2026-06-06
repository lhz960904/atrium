import { tool } from 'ai';
import { z } from 'zod';
import type { ImageModelRef } from '../../../providers/image-models';
import { generateThreadImage, imageFileChunk, referenceImages } from '../../image-generation';
import type { RunContext } from '../../middleware';

export type ImageGenDeps = {
  /** Enabled image-output models the agent may pick from (listEnabledImageModels). */
  models: ImageModelRef[];
};

/** Qualified `provider/model` id — disambiguates the same model offered by
 *  several providers (e.g. openai/gpt-image-2 vs a relay's gpt-image-2). */
const qualified = (m: ImageModelRef): string => `${m.providerId}/${m.modelId}`;

/**
 * Generate (or edit) an image and show it inline. The image is written to the
 * assistant message as a file part via the run's stream writer (so it renders
 * and persists like any attachment); the return value is a short receipt the
 * model reads to keep the turn going.
 *
 * Model choice stays inside the user's enabled models — no separate image-model
 * config. The agent passes `model` (as provider/model) to pick one, and sets
 * `edit_previous` when the user wants the most recent image changed.
 */
export const imageGenTool = (deps: ImageGenDeps) => {
  const available = deps.models.map(qualified).join(', ') || '(none enabled)';
  return tool({
    description:
      'Generate an image from a text description and show it to the user. ' +
      `Available image models (as provider/model): ${available}. ` +
      'Pass the model field to choose one — use the full provider/model so the right provider ' +
      'is billed (the same model may be offered by several). Otherwise the first is used. ' +
      'Set edit_previous=true to modify the most recently generated or attached image instead ' +
      'of drawing a new one. Write a vivid, detailed prompt. If none is enabled, the tool ' +
      'returns setup guidance.',
    inputSchema: z.object({
      prompt: z.string().describe('A detailed description of the image to generate.'),
      model: z
        .string()
        .optional()
        .describe('Which image model to use, as provider/model from the available list.'),
      edit_previous: z
        .boolean()
        .optional()
        .describe(
          'Edit the most recent image in the conversation instead of generating a new one.',
        ),
    }),
    execute: async ({ prompt, model, edit_previous }, { experimental_context, abortSignal }) => {
      const ctx = experimental_context as RunContext;
      if (deps.models.length === 0) {
        return 'No image-generation model is enabled. Ask the user to enable one (e.g. gpt-image-2 or imagen-4.0) in Settings → Providers, then try again.';
      }
      // Match the qualified provider/model first; tolerate a bare model id.
      const ref = model
        ? (deps.models.find((m) => qualified(m) === model) ??
          deps.models.find((m) => m.modelId === model))
        : deps.models[0];
      if (!ref) {
        return `Image model "${model}" is not enabled. Available: ${available}.`;
      }

      try {
        const image = await generateThreadImage({
          db: ctx.db,
          providerId: ref.providerId,
          modelId: ref.modelId,
          text: prompt,
          references: edit_previous ? referenceImages(ctx.request.messages) : [],
          abortSignal,
        });
        ctx.emit(imageFileChunk(image));
        return `${edit_previous ? 'Edited' : 'Generated'} an image with ${qualified(ref)} for: "${prompt}".`;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        // Image failures are usually the model/account (quota, billing, region),
        // not the prompt — nudge the agent to retry with a different provider.
        return `Image generation with ${qualified(ref)} failed: ${reason}. This is usually a model or account issue (quota / billing) — call image_gen again with a different model.`;
      }
    },
  });
};
