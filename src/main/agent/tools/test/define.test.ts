import { expect, mock, test } from 'bun:test';
import { defineTool, Type } from '../define';

const effectTool = (execute: () => Promise<{ content: []; details: string }>) =>
  defineTool({
    name: 'effect',
    label: 'Effect',
    description: 'Has a side effect.',
    parameters: Type.Object({}),
    execute,
  });

test('a tool cancelled before it starts never runs', async () => {
  const execute = mock(async () => ({ content: [] as [], details: 'ran' }));
  const abort = new AbortController();
  abort.abort();
  await expect(effectTool(execute).execute('c1', {}, abort.signal)).rejects.toThrow();
  expect(execute).not.toHaveBeenCalled();
});

test('a tool that is still wanted runs with its own call', async () => {
  const execute = mock(async () => ({ content: [] as [], details: 'ran' }));
  const signal = new AbortController().signal;
  expect(await effectTool(execute).execute('c1', {}, signal)).toEqual({
    content: [],
    details: 'ran',
  });
  expect(execute).toHaveBeenCalledWith('c1', {}, signal);
});
