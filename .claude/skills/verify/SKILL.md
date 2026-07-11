---
name: verify
description: Build, launch, and drive Atrium to verify a change end-to-end. Use when a code change needs runtime observation in the real app (renderer UI, chat rendering, main-process behavior).
---

# Verify Atrium changes

## Launch dev with CDP

```bash
./node_modules/.bin/electron-vite dev --remoteDebuggingPort=9222   # background it
curl -s http://127.0.0.1:9222/json/list                            # wait until page target appears
```

`--remoteDebuggingPort` is an electron-vite built-in (sets `REMOTE_DEBUGGING_PORT` env, appends `--remote-debugging-port` to Electron). Check first whether a dev instance is already running (`ps aux | grep electron-vite`) — kill it before relaunching; only one instance can own the userData dir.

## Drive via CDP

Raw WebSocket from a Bun script is enough — no playwright needed. Connect to `webSocketDebuggerUrl` of the `type:"page"` target, then `Runtime.evaluate` (with `awaitPromise` + `returnByValue`) and `Page.captureScreenshot`.

- Navigate: hash routing — `location.hash = '#/chat/<threadId>'` (routes in `src/renderer/src/routes/`).
- Render an arbitrary component in the real app without touching source: dev page is served by Vite, so `await import('/src/components/...')` works in-page. Get React/react-dom from the already-loaded optimized deps: find their URLs in `performance.getEntriesByType('resource')` (match `.vite/deps/react.js` / `react-dom_client`), and unwrap CJS interop (`createRoot` lives on `.default`). Mount into a fixed-position overlay div, assert on DOM, screenshot, then `root.unmount()` and remove the div.

## Drive UI controls

- Radix popovers (model picker etc.) ignore synthetic `el.click()`; use native CDP mouse events (`Input.dispatchMouseEvent` mousePressed/mouseReleased at the element's rect center) and call `Page.bringToFront` first — an unfocused window drops them.
- Composer: focus `.tiptap`, then `Input.insertText` + Enter keyDown/keyUp. Stop button while streaming: `button[title="停止"]`.
- Model picker is per-thread; switch it on the thread you're testing, not on home before navigating.

## Test main-process modules in a real Electron

For code under `src/main/` that needs a live Electron runtime (BrowserWindow, hidden-window flows): write a harness entry that imports the module by absolute path, `bun build harness.ts --outfile harness.cjs --target node --format cjs --external electron`, then run `node_modules/.bin/electron harness.cjs`. Add `app.on('window-all-closed', () => {})` or the app quits after the first window is destroyed. data: URLs make good page fixtures for forcing specific DOM states.

## Data

- DB: `~/Library/Application Support/atrium/atrium.db` (dev and packaged share it; tables `threads` / `messages`, message text in `messages.parts` JSON).
- Read while the app runs: `sqlite3 "file:$DB?mode=ro"` (immutable=1 misses WAL; only use it when the app is closed).
- Do NOT insert test messages from outside the app: the `chat_fts_msg_ai` trigger calls the app-registered `jieba_cut()` UDF, so external INSERTs fail. Render test content via the Vite import trick above instead.
