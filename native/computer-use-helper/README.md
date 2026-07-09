# Computer Use Native Helper

Native macOS desktop-automation helper for Atrium's Computer Use feature. The
main process spawns it and talks to it over stdio: one `{id, method, params}`
JSON object per line on stdin, one `{id, ok, result}` per line on stdout.

It drives macOS apps through the **Accessibility API** (read UI structure,
semantic actions) with a **CGEvent** fallback (pixel-coordinate input), and
captures the target window via **ScreenCaptureKit**.

## Files

- `ComputerUseNativeHelper.swift` — main loop + the action verbs (list_apps,
  get_app_state, click, drag, type_text, press_key, set_value, scroll,
  perform_secondary_action).
- `WindowCaptureHelper.swift` — single-window screenshot (ScreenCaptureKit),
  spawned per capture by the main helper.

## Build (dev)

```
swiftc ComputerUseNativeHelper.swift -o ComputerUseNativeHelper
swiftc WindowCaptureHelper.swift -o WindowCaptureHelper
echo '{"id":"1","method":"list_apps","params":{}}' | ./ComputerUseNativeHelper
```

Screenshots and input need the host to hold Accessibility + Screen Recording
permissions; `list_apps` works without them.

## Attribution

Forked from **mac-computer-use** by Ugo Balducci (MIT) —
https://github.com/TheGuyWithoutH/mac-computer-use. See `LICENSE`.
