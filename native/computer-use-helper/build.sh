#!/usr/bin/env bash
# Build + code-sign "Atrium Computer Use.app": the standalone, background
# (LSUIElement) helper that holds its own Accessibility + Screen Recording TCC
# grants. A separate signed identity is what lets ScreenCaptureKit capture at
# all — a bare unsigned binary cannot get Screen Recording. Dev signing here
# skips --timestamp/notarization; packaging (M4) adds those.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:-$HERE/build}"
APP="$OUT/Atrium Computer Use.app"
MACOS="$APP/Contents/MacOS"
IDENTITY="${CU_SIGN_IDENTITY:-Developer ID Application: Lu Liu (43PH2NJ5C4)}"

echo "→ Compiling…"
rm -rf "$APP"
mkdir -p "$MACOS"
cp "$HERE/Info.plist" "$APP/Contents/Info.plist"
# Without an explicit -target, swiftc inherits the build machine's OS as the
# deployment target (CI runners are macOS 15), and the binary then refuses to
# load on older systems. Pin it to the floor Info.plist promises
# (LSMinimumSystemVersion 13.0) so the helper runs everywhere the app does.
swiftc -O -target "$(uname -m)-apple-macos13.0" \
  "$HERE/ComputerUseNativeHelper.swift" -o "$MACOS/AtriumComputerUse"

# Developer ID when it's reachable (a dev machine's login keychain). In CI the
# signing keychain isn't imported yet at compile time, so ad-hoc sign instead —
# the electron-builder afterSign hook re-signs it for real (hardened +
# timestamped) at package time.
if security find-identity -v -p codesigning 2>/dev/null | grep -qF "$IDENTITY"; then
  echo "→ Signing with: $IDENTITY"
  codesign --force --options runtime \
    --entitlements "$HERE/entitlements.plist" \
    --sign "$IDENTITY" "$APP"
else
  echo "→ No Developer ID identity; ad-hoc signing (afterSign re-signs for release)"
  codesign --force --sign - "$APP"
fi

echo "→ Verifying…"
codesign --verify --strict --verbose=2 "$APP"
echo "✓ Built: $APP"
