import { expect, test } from 'bun:test';
import { imageResult, StringEnum, Type, textResult } from './define';

const shot = { mediaType: 'image/png', dataUrl: 'data:image/png;base64,aGk=' };

test('a text result is the same string on both sides', () => {
  expect(textResult('hello')).toEqual({
    content: [{ type: 'text', text: 'hello' }],
    details: 'hello',
  });
});

test('a plain string output stays text even on the image path', () => {
  expect(imageResult('hello', true).content).toEqual([{ type: 'text', text: 'hello' }]);
});

test('images become image content when the model can see them', () => {
  const result = imageResult({ text: 'shot', images: [shot] }, true);
  expect(result.content).toEqual([
    { type: 'text', text: 'shot' },
    { type: 'image', data: 'aGk=', mimeType: 'image/png' },
  ]);
  // the card still gets the full payload, whatever the model was sent
  expect(result.details).toEqual({ text: 'shot', images: [shot] });
});

test('images degrade to a note when the model cannot see them', () => {
  expect(imageResult({ text: 'shot', images: [shot] }, false).content).toEqual([
    { type: 'text', text: 'shot\n[1 image(s) omitted: the current model cannot view images]' },
  ]);
});

test('an image-only result omits the empty text part', () => {
  expect(imageResult({ text: '', images: [shot] }, true).content).toEqual([
    { type: 'image', data: 'aGk=', mimeType: 'image/png' },
  ]);
});

test('a string enum renders as a JSON Schema enum, not a union of consts', () => {
  expect(
    JSON.parse(JSON.stringify(Type.Object({ a: StringEnum(['x', 'y'], { default: 'x' }) }))),
  ).toEqual({
    type: 'object',
    properties: { a: { type: 'string', enum: ['x', 'y'], default: 'x' } },
    required: ['a'],
  });
});
