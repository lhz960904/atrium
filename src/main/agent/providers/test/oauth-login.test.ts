import { expect, test } from 'bun:test';
import type { AuthInteraction } from '@earendil-works/pi-ai';
import { answerLogin, cancelLogin, readLogin, startLogin } from '../oauth-login';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

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

test('a choice Atrium can only answer one way is answered without asking', async () => {
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
  // A device code is for a machine with no browser; there is one here, so the
  // question never reaches the panel.
  expect(picked).toBe('browser');
  expect(readLogin('p5')?.options).toBeUndefined();
});

test('a choice with more than one usable answer is still asked', async () => {
  let picked: string | undefined;
  startLogin(
    'p6',
    () => {},
    () => {},
    async (_id: string, i: AuthInteraction) => {
      picked = await i.prompt({
        type: 'select',
        message: 'pick an account',
        options: [
          { id: 'personal', label: 'Personal' },
          { id: 'work', label: 'Work' },
        ],
      });
    },
  );
  await tick();
  expect(readLogin('p6')).toMatchObject({
    status: 'awaiting-input',
    inputPrompt: 'pick an account',
    options: [
      { id: 'personal', label: 'Personal' },
      { id: 'work', label: 'Work' },
    ],
  });

  answerLogin('p6', 'work');
  await tick();
  expect(picked).toBe('work');
});

test('a login offering nothing usable fails instead of hanging', async () => {
  startLogin(
    'p7',
    () => {},
    () => {},
    async (_id: string, i: AuthInteraction) => {
      await i.prompt({
        type: 'select',
        message: 'pick a way in',
        options: [{ id: 'device_code', label: 'Device code' }],
      });
    },
  );
  await tick();
  expect(readLogin('p7')?.status).toBe('error');
});
