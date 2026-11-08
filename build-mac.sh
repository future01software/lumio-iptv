#!/bin/bash
# Lumio IPTV'yi macOS için derler ve release/Lumio-IPTV-<sürüm>.dmg üretir.
# Kullanım: ./build-mac.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
FE="$ROOT/frontend"
BE="$ROOT/backend"
OUT="$ROOT/release"
VERSION="$(node -p "require('$FE/package.json').version")"
APP_NAME="Lumio IPTV"
STAGE="$OUT/stage"
APP="$STAGE/$APP_NAME.app"
DMG="$OUT/Lumio-IPTV-$VERSION.dmg"

echo "==> Bağımlılıklar"
(cd "$FE" && npm install --no-audit --no-fund)
# npm, Electron'un ikili indirme betiğini engelleyebiliyor
[ -d "$FE/node_modules/electron/dist/Electron.app" ] || node "$FE/node_modules/electron/install.js"

echo "==> Web paketi"
(cd "$FE" && rm -rf dist && npx expo export -p web --clear)

echo "==> Backend (PyInstaller)"
if [ ! -x "$BE/venv/bin/python" ]; then
  python3 -m venv "$BE/venv"
  "$BE/venv/bin/pip" install -q fastapi==0.110.1 uvicorn==0.25.0 "cryptography>=42.0.8" "python-dotenv>=1.0.1" \
    pymongo==4.6.3 motor==3.3.1 "pydantic>=2.6.4" "requests>=2.31.0" pyinstaller
fi
(cd "$BE" && venv/bin/python -m PyInstaller --noconfirm --clean --onedir --name lumio-backend \
  --distpath pyinstaller-dist --workpath pyinstaller-build --specpath pyinstaller-build \
  --collect-submodules uvicorn --hidden-import logo_db run_backend.py)

echo "==> .app paketi"
rm -rf "$OUT"; mkdir -p "$STAGE"
cp -R "$FE/node_modules/electron/dist/Electron.app" "$APP"
RES="$APP/Contents/Resources"
rm -f "$RES/default_app.asar"
mkdir -p "$RES/app" "$RES/backend"
cp -R "$FE/electron" "$RES/app/electron"
cp -R "$FE/dist" "$RES/app/dist"
printf '{ "name": "lumio-iptv", "productName": "%s", "version": "%s", "main": "electron/main.js" }\n' "$APP_NAME" "$VERSION" > "$RES/app/package.json"
cp -R "$BE/pyinstaller-dist/lumio-backend" "$RES/backend/lumio-backend"

ICONSET="$OUT/icon.iconset"; mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -s format png -z $s $s "$FE/electron/icon.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2))
  if [ $d -le 512 ]; then sips -s format png -z $d $d "$FE/electron/icon.png" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null; fi
done
iconutil -c icns "$ICONSET" -o "$RES/electron.icns"
rm -rf "$ICONSET"

PLIST="$APP/Contents/Info.plist"
plutil -replace CFBundleName -string "$APP_NAME" "$PLIST"
plutil -replace CFBundleDisplayName -string "$APP_NAME" "$PLIST"
plutil -replace CFBundleIdentifier -string "com.iptvplayer.desktop" "$PLIST"
plutil -replace CFBundleShortVersionString -string "$VERSION" "$PLIST"
plutil -replace CFBundleVersion -string "$VERSION" "$PLIST"
plutil -replace LSApplicationCategoryType -string "public.app-category.entertainment" "$PLIST"

# Ad-hoc imza (Apple Developer hesabı olmadan)
codesign --force --deep -s - "$APP"
codesign --verify --deep "$APP"

echo "==> DMG"
ln -s /Applications "$STAGE/Applications"
hdiutil create -volname "$APP_NAME" -srcfolder "$STAGE" -ov -format UDZO "$DMG" >/dev/null
rm -rf "$STAGE"

# latest.json'a eklenecek "mac" girdisi (lumio-releases v$VERSION sürümüne DMG ile birlikte yüklenir)
SHA="$(shasum -a 256 "$DMG" | cut -d' ' -f1)"
SIZE="$(stat -f%z "$DMG")"
cat > "$OUT/mac-asset.json" <<EOF
{
  "url": "https://github.com/future01software/lumio-releases/releases/download/v$VERSION/Lumio-IPTV-$VERSION.dmg",
  "sha256": "$SHA",
  "size": $SIZE
}
EOF

echo ""
echo "Hazır: $DMG"
echo "latest.json \"mac\" girdisi: $OUT/mac-asset.json"
