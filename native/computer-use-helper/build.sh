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
swiftc -O "$HERE/ComputerUseNativeHelper.swift" -o "$MACOS/AtriumComputerUse"

echo "→ Signing with: $IDENTITY"
codesign --force --options runtime \
  --entitlements "$HERE/entitlements.plist" \
  --sign "$IDENTITY" "$APP"

echo "→ Verifying…"
codesign --verify --deep --strict --verbose=2 "$APP"
echo "✓ Built + signed: $APP"
