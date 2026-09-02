import { expect, test } from 'bun:test';
import { toAiSdkTool } from './ai-sdk-adapter';
import { defineTool, Type, textResult } from './define';

const echo = defineTool({
  name: 'echo',
  label: 'Echo',
  description: 'echo',
  parameters: Type.Object({ text: Type.String() }),
  execute: async (_id, { text }) => textResult(text),
});

const project = (output: unknown, supportsImages: boolean) =>
  // biome-ignore lint/suspicious/noExplicitAny: only `output` is read off the arg
  toAiSdkTool(echo, { supportsImages }).toModelOutput?.({ output } as any);

const shot = { mediaType: 'image/png', dataUrl: 'data:image/png;base64,aGk=' };

test('reports the tool details as the engine output', async () => {
  const t = toAiSdkTool(echo, { supportsImages: false });
  // biome-ignore lint/suspicious/noExplicitAny: the execute options arg is loose here
  expect(await t.execute?.({ text: 'hi' }, { toolCallId: 'c1' } as any)).toBe('hi');
});

test('rejects arguments the schema does not allow', async () => {
  const t = toAiSdkTool(echo, { supportsImages: false });
  // biome-ignore lint/suspicious/noExplicitAny: the execute options arg is loose here
  expect(t.execute?.({ nope: 1 }, { toolCallId: 'c1' } as any)).rejects.toThrow(
    'Validation failed',
  );
});

test('model output: plain string passes through as text', () => {
  expect(project('hello', true)).toEqual({ type: 'text', value: 'hello' });
});

test('model output: images become image-data parts when supported', () => {
  expect(project({ text: 'shot', images: [shot] }, true)).toEqual({
    type: 'content',
    value: [
      { type: 'text', text: 'shot' },
      { type: 'image-data', data: 'aGk=', mediaType: 'image/png' },
    ],
  });
});

test('model output: images degrade to a note when unsupported', () => {
  expect(project({ text: 'shot', images: [shot] }, false)).toEqual({
    type: 'text',
    value: 'shot\n[1 image(s) omitted: the current model cannot view images]',
  });
});

test('model output: image-only result omits the empty text part', () => {
  expect(project({ text: '', images: [shot] }, true)).toEqual({
    type: 'content',
    value: [{ type: 'image-data', data: 'aGk=', mediaType: 'image/png' }],
  });
});
