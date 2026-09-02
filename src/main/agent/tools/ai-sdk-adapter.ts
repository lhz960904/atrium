import { validateToolArguments } from '@earendil-works/pi-ai';
import type { ImageToolOutput } from '@shared/chat-types';
import { isMcpToolName } from '@shared/mcp';
import { dynamicTool, jsonSchema, type Tool, tool } from 'ai';
import type { JSONSchema7 } from 'json-schema';
import { makeNeedsApproval } from '../permissions';
import type { ToolCtx } from './context';
import type { AtriumTool } from './define';

/**
 * Runs the pi-shaped toolset on the AI SDK loop, and retires with it.
 *
 * The tools already speak pi: TypeBox parameters, `execute(toolCallId, params,
 * signal)`, a result whose `content` is the model-facing projection and whose
 * `details` is what the UI renders. This maps that onto the AI SDK's tool
 * contract, keeping the wire shape the renderer already knows — `details` is
 * what the engine reports as the tool output, and `toModelOutput` re-derives
 * the model-facing projection from it (history replay goes through the same
 * path, so it has to be a pure function of the output, not of this run).
 *
 * Arguments are validated with pi's own validator rather than the AI SDK's:
 * `jsonSchema()` carries no validation of its own, and this is the check the
 * engine itself will run once it's in charge.
 */

type ToolResultOutput = Awaited<ReturnType<NonNullable<Tool['toModelOutput']>>>;

/**
 * Map a tool's details onto the model-facing wire format. Plain strings
 * (text-only results and pre-image history rows) go out as text. Structured
 * outputs inline their images as image-data parts — unless the provider+model
 * can't consume image tool results, in which case the images are dropped with
 * an explicit note so the model knows what it isn't seeing.
 */
function toModelOutput(output: unknown, supportsImageToolResults: boolean): ToolResultOutput {
  if (typeof output === 'string') return { type: 'text', value: output };
  const { text, images } = output as ImageToolOutput;
  if (!supportsImageToolResults) {
    const note = `[${images.length} image(s) omitted: the current model cannot view images]`;
    return { type: 'text', value: text ? `${text}\n${note}` : note };
  }
  return {
    type: 'content',
    value: [
      ...(text ? [{ type: 'text' as const, text }] : []),
      ...images.map((img) => ({
        type: 'image-data' as const,
        data: img.dataUrl.slice(img.dataUrl.indexOf(',') + 1),
        mediaType: img.mediaType,
      })),
    ],
  };
}

type AdaptOptions = {
  supportsImages: boolean;
  needsApproval?: Tool['needsApproval'];
};

export function toAiSdkTool(t: AtriumTool, opts: AdaptOptions): Tool {
  const base = {
    description: t.description,
    inputSchema: jsonSchema<Record<string, unknown>>(t.parameters as JSONSchema7),
    toModelOutput: ({ output }: { output: unknown }) => toModelOutput(output, opts.supportsImages),
    needsApproval: opts.needsApproval,
  };
  const execute = async (
    input: unknown,
    options: { toolCallId: string; abortSignal?: AbortSignal },
  ) => {
    const args = validateToolArguments(t, {
      type: 'toolCall',
      id: options.toolCallId,
      name: t.name,
      arguments: (input ?? {}) as Record<string, unknown>,
    });
    const { details } = await t.execute(options.toolCallId, args, options.abortSignal);
    return details;
  };
  // MCP tools stay dynamic — their schema is only known at runtime, and the
  // renderer reads them as dynamic tool parts; built-ins keep their typed
  // `tool-<name>` parts.
  if (isMcpToolName(t.name)) return dynamicTool({ ...base, execute });
  // A client-side tool gets no execute at all: the model's call ends the turn
  // and the user's answer is written in as the result.
  return t.clientSide ? tool(base) : tool({ ...base, execute });
}

export function toAiSdkTools(tools: AtriumTool[], ctx: ToolCtx): Record<string, Tool> {
  const supportsImages = ctx.supportsImageToolResults ?? false;
  const out: Record<string, Tool> = {};
  for (const t of tools) {
    out[t.name] = toAiSdkTool(t, { supportsImages, needsApproval: makeNeedsApproval(t.name, ctx) });
  }
  return out;
}
