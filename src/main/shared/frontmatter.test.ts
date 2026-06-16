import { expect, test } from 'bun:test';
import { parseFrontmatter, renderFrontmatter, stripFrontmatter } from './frontmatter';

test('parseFrontmatter returns the YAML object, or null', () => {
  expect(parseFrontmatter('---\nname: x\ndescription: hi\n---\nbody')).toEqual({
    name: 'x',
    description: 'hi',
  });
  expect(parseFrontmatter('no frontmatter')).toBeNull();
  expect(parseFrontmatter('---\njust a scalar\n---')).toBeNull(); // parses, but not an object
});

test('parseFrontmatter handles a quoted value containing a colon', () => {
  expect(parseFrontmatter('---\ndescription: "Use when: do a thing"\n---')).toEqual({
    description: 'Use when: do a thing',
  });
});

test('stripFrontmatter drops the block and trims the body', () => {
  expect(stripFrontmatter('---\nname: x\n---\n\nhello\n')).toBe('hello');
  expect(stripFrontmatter('no frontmatter\n')).toBe('no frontmatter');
});

test('renderFrontmatter round-trips through parseFrontmatter', () => {
  const md = renderFrontmatter({ name: 'A', type: 'project' }, 'the body');
  expect(md.startsWith('---\n')).toBe(true);
  expect(md.trimEnd().endsWith('the body')).toBe(true);
  expect(parseFrontmatter(md)).toEqual({ name: 'A', type: 'project' });
});
