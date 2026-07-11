# Computer Use Native Helper

Native macOS desktop-automation helper for Atrium's Computer Use feature. The
main process spawns it and talks to it over stdio: one `{id, method, params}`
JSON object per line on stdin, one `{id, ok, result}` per line on stdout.

It drives macOS apps through the **Accessibility API** (read UI structure,
semantic actions) with a **CGEvent** fallback (pixel-coordinate input). It does
**not** take screenshots: screen capture is bound to the originating process's
own Screen Recording grant, which a spawned helper can't inherit, so the helper
returns the target window's id + bounds (in `get_app_state`'s `data`) and
Atrium's main process captures it with `desktopCapturer`.

## Files

- `ComputerUseNativeHelper.swift` — the whole helper: main loop, the action
  verbs (list_apps, get_app_state, click, drag, type_text, press_key, set_value,
  scroll, perform_secondary_action), and the `permissions` self-report.

## Build (dev)

```
./build.sh          # compiles + signs "Atrium Computer Use.app" into ./build
echo '{"id":"1","method":"list_apps","params":{}}' \
  | "build/Atrium Computer Use.app/Contents/MacOS/AtriumComputerUse"
```

Input needs the host to hold the Accessibility grant (the helper borrows the
responsible process's); `list_apps` and `permissions` work without it.

## Attribution

Forked from **mac-computer-use** by Ugo Balducci (MIT) —
https://github.com/TheGuyWithoutH/mac-computer-use. See `LICENSE`.
