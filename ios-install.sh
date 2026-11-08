#!/bin/bash
# Lumio IPTV'yi kablo ile bağlı iPhone'a kurar (ücretsiz Apple hesabı / Personal Team).
# Ücretsiz hesapla kurulum 7 gün geçerlidir: süre dolmadan bu betiği yeniden çalıştırmak
# uygulamayı yeniden imzalar ve üzerine kurar; profiller, listeler ve ayarlar silinmez.
# Kullanım: ./ios-install.sh
set -euo pipefail
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8

ROOT="$(cd "$(dirname "$0")" && pwd)"
FE="$ROOT/frontend"
TEAM_ID="${TEAM_ID:?Set TEAM_ID to your Apple Developer team ID}"
APP="$FE/ios/build/Build/Products/Release-iphoneos/LumioIPTV.app"

echo "==> iPhone aranıyor"
UDID="$(xcrun devicectl list devices 2>/dev/null | awk '/physical/ && /available/ {for (i=1;i<=NF;i++) if ($i ~ /^[0-9A-F]{8}-[0-9A-F]{16}$/) {print $i; exit}}')"
if [ -z "$UDID" ]; then
  echo "Bağlı ve kilidi açık bir iPhone bulunamadı. Kabloyla bağla, kilidini aç ve tekrar dene."
  exit 1
fi
echo "    $UDID"

echo "==> Bağımlılıklar"
(cd "$FE" && npm install --no-audit --no-fund)
if [ ! -d "$FE/ios" ]; then
  (cd "$FE" && CI=1 npx expo prebuild --platform ios --no-install)
fi
(cd "$FE/ios" && pod install)

echo "==> Derleme ve imzalama"
(cd "$FE/ios" && xcodebuild -workspace LumioIPTV.xcworkspace -scheme LumioIPTV -configuration Release \
  -sdk iphoneos -destination 'generic/platform=iOS' -derivedDataPath build \
  -allowProvisioningUpdates -allowProvisioningDeviceRegistration \
  DEVELOPMENT_TEAM="$TEAM_ID" CODE_SIGN_STYLE=Automatic -quiet)

echo "==> iPhone'a kuruluyor"
xcrun devicectl device install app --device "$UDID" "$APP"

echo ""
echo "Kuruldu. Bir sonraki yenileme: $(date -v+6d '+%d.%m.%Y') tarihinden önce bu betiği tekrar çalıştır."
