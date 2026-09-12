import { expect, test } from 'bun:test';
import type { AuthInteraction } from '@earendil-works/pi-ai';
import { toCredential } from './credential-store';
import { answerLogin, cancelLogin, readLogin, startLogin } from './oauth-login';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

test('an untagged blob reads back as an api key', () => {
  expect(toCredential({ key: 'sk-1' })).toEqual({ type: 'api_key', key: 'sk-1' });
});

test('a tagged credential passes through', () => {
  const oauth = { type: 'oauth', refresh: 'r', access: 'a', expires: 1 };
  expect(toCredential(oauth)).toBe(oauth as never);
});

test('an unreadable or empty blob is no credential', () => {
  expect(toCredential(null)).toBeUndefined();
  expect(toCredential({})).toBeUndefined();
  expect(toCredential({ key: '' })).toBeUndefined();
});

test('an authorization url opens the browser and parks the flow', async () => {
  const opened: string[] = [];
  startLogin(
    'p1',
    (url) => opened.push(url),
    () => {},
    async (_id: string, i: AuthInteraction) => {
      i.notify({
        type: 'auth_url',
        url: 'https://auth.example/go',
        instructions: 'finish in browser',
      });
      await new Promise(() => {});
    },
  );
  await tick();

  expect(opened).toEqual(['https://auth.example/go']);
  expect(readLogin('p1')).toMatchObject({
    status: 'awaiting-browser',
    url: 'https://auth.example/go',
    message: 'finish in browser',
  });
  cancelLogin('p1');
});

test('a pasted code answers the question the flow is waiting on', async () => {
  let answered: string | undefined;
  startLogin(
    'p2',
    () => {},
    () => {},
    async (_id: string, i: AuthInteraction) => {
      answered = await i.prompt({ type: 'manual_code', message: 'paste it' });
    },
  );
  await tick();
  expect(readLogin('p2')).toMatchObject({ status: 'awaiting-input', inputPrompt: 'paste it' });

  expect(answerLogin('p2', 'the-code')).toBe(true);
  await tick();
  expect(answered).toBe('the-code');
  expect(readLogin('p2')?.status).toBe('done');
});

test('an answer with nothing waiting is refused', () => {
  expect(answerLogin('nobody', 'x')).toBe(false);
});

test('a failed flow reports why, and starting again replaces it', async () => {
  startLogin(
    'p3',
    () => {},
    () => {},
    async () => {
      throw new Error('vendor said no');
    },
  );
  await tick();
  expect(readLogin('p3')).toMatchObject({ status: 'error', error: 'vendor said no' });

  startLogin(
    'p3',
    () => {},
    () => {},
    async () => new Promise(() => {}),
  );
  await tick();
  expect(readLogin('p3')?.status).toBe('starting');
  cancelLogin('p3');
});

test('cancelling drops the flow and rejects what it was waiting on', async () => {
  let rejected: string | undefined;
  startLogin(
    'p4',
    () => {},
    () => {},
    async (_id: string, i: AuthInteraction) => {
      try {
        await i.prompt({ type: 'manual_code', message: 'paste' });
      } catch (err) {
        rejected = (err as Error).message;
      }
    },
  );
  await tick();
  cancelLogin('p4');
  await tick();
  expect(rejected).toBe('login cancelled');
  expect(readLogin('p4')).toBeNull();
});

test('a choice is surfaced as options and answered by id', async () => {
  let picked: string | undefined;
  startLogin(
    'p5',
    () => {},
    () => {},
    async (_id: string, i: AuthInteraction) => {
      picked = await i.prompt({
        type: 'select',
        message: 'pick a way in',
        options: [
          { id: 'browser', label: 'Browser login' },
          { id: 'device_code', label: 'Device code' },
        ],
      });
    },
  );
  await tick();
  expect(readLogin('p5')).toMatchObject({
    status: 'awaiting-input',
    inputPrompt: 'pick a way in',
    options: [
      { id: 'browser', label: 'Browser login' },
      { id: 'device_code', label: 'Device code' },
    ],
  });

  answerLogin('p5', 'browser');
  await tick();
  expect(picked).toBe('browser');
  expect(readLogin('p5')?.options).toBeUndefined();
});
