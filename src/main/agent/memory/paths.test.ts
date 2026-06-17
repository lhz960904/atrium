import { expect, test } from 'bun:test';
import { encodeWorkspace, mapProjects, projectName } from './paths';

test('encodes a posix path to a reverse-readable dir name', () => {
  expect(encodeWorkspace('/Users/x/Documents/projects/atrium')).toBe(
    '-Users-x-Documents-projects-atrium',
  );
});

test('collapses repeated separators', () => {
  expect(encodeWorkspace('/Users//x/proj')).toBe('-Users-x-proj');
});

test('encodes a windows path (drive colon + backslashes)', () => {
  expect(encodeWorkspace('C:\\Users\\x\\proj')).toBe('C-Users-x-proj');
});

test('projectName takes the trailing segment of an encoded key', () => {
  expect(projectName('-Users-lihaoze-Documents-Atrium')).toBe('Atrium');
  expect(projectName('-Users-x-proj')).toBe('proj');
});

test('mapProjects labels each dir, drops dotfiles, sorts by name', () => {
  const projects = mapProjects([
    '-Users-x-Documents-WebShop',
    '.DS_Store',
    '-Users-x-Documents-Atrium',
  ]);
  expect(projects).toEqual([
    { key: '-Users-x-Documents-Atrium', name: 'Atrium' },
    { key: '-Users-x-Documents-WebShop', name: 'WebShop' },
  ]);
});
