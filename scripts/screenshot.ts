/*
 * Captures a README-ready screenshot of the running app over the Chrome
 * DevTools Protocol, then post-processes it with rounded corners and a drop
 * shadow (scripts/beautify-screenshot.swift) so it matches the existing
 * images/ set. CDP is used instead of macOS screencapture because window
 * capture requires a Screen Recording grant per terminal, while the debug
 * port needs nothing.
 *
 * The app must be listening on the debug port first:
 *   packaged: /Applications/Atrium.app/Contents/MacOS/Atrium --remote-debugging-port=9333
 *   dev:      REMOTE_DEBUGGING_PORT=9333 bun run dev
 *
 * Usage:
 *   bun scripts/screenshot.ts --out images/providers.png --hash "#/settings/providers"
 *   bun scripts/screenshot.ts --out shot.png --eval "document.querySelector('aside').scrollTop = 0"
 *
 * Flags: --out <file> (required), --hash <route>, --eval <js> (staging step,
 * runs after navigation), --delay <ms> (settle time, default 1500),
 * --port <n> (default 9333), --raw (skip beautify).
 * After replacing screenshots, refresh the README carousel with
 * scripts/make-showcase.ts.
 */
const args = Bun.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const out = flag('out');
if (!out) {
  console.error(
    'usage: bun scripts/screenshot.ts --out <file> [--hash <route>] [--eval <js>] [--delay <ms>] [--port <n>] [--raw]',
  );
  process.exit(1);
}
const port = flag('port') ?? '9333';
const delay = Number(flag('delay') ?? 1500);
const hash = flag('hash');
const evalExpr = flag('eval');
const raw = args.includes('--raw');

const targets = (await (
  await fetch(`http://127.0.0.1:${port}/json`).catch(() => {
    console.error(
      `no CDP endpoint on port ${port} — launch the app with --remote-debugging-port=${port}`,
    );
    process.exit(1);
  })
).json()) as Array<{ type: string; webSocketDebuggerUrl: string }>;
const page = targets.find((t) => t.type === 'page');
if (!page) {
  console.error('no page target found');
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve) => {
  ws.onopen = resolve;
});
let seq = 0;
const pending = new Map<number, (v: { result?: { data?: string }; error?: unknown }) => void>();
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data as string);
  pending.get(msg.id)?.(msg);
  pending.delete(msg.id);
};
const send = (method: string, params: object = {}) => {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise<{ result?: { data?: string }; error?: unknown }>((resolve) =>
    pending.set(id, resolve),
  );
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

if (hash) {
  await send('Runtime.evaluate', { expression: `location.hash = ${JSON.stringify(hash)}` });
  await sleep(delay);
}
if (evalExpr) {
  const result = await send('Runtime.evaluate', {
    expression: `(async () => { ${evalExpr} })()`,
    awaitPromise: true,
  });
  if (result.error) {
    console.error('eval failed:', result.error);
    process.exit(1);
  }
  await sleep(500);
}

const shot = await send('Page.captureScreenshot', { format: 'png' });
if (!shot.result?.data) {
  console.error('capture failed:', shot.error);
  process.exit(1);
}
await Bun.write(out, Buffer.from(shot.result.data, 'base64'));
ws.close();

if (!raw) {
  const beautify = Bun.spawnSync([
    'swift',
    new URL('beautify-screenshot.swift', import.meta.url).pathname,
    out,
    out,
  ]);
  if (beautify.exitCode !== 0) {
    console.error(`beautify failed: ${beautify.stderr.toString()}`);
    process.exit(1);
  }
}
console.log(out);
process.exit(0);
