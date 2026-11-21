# Lumio IPTV

**Download:** ready-to-install builds are on this repository's
[Releases page](https://github.com/future01software/lumio-iptv/releases/latest)
(macOS `.dmg`, Windows `.msi`; Android `.apk` when available).

**İndir:** Kurulum dosyaları bu deponun [Releases](https://github.com/future01software/lumio-iptv/releases/latest)
sayfasında (Mac için `.dmg`, Windows için `.msi`). Mac'te ilk açılışta Finder'da sağ tıklayıp **Aç**'ı seç.

> Lumio 1.1.11 veya daha eskisini kullanıyorsan 1.1.13'yi buradan bir kez elle indirip kur;
> sonraki güncellemeler uygulamanın içinden gelir.

Lumio is only a player: it ships with no channels, movies or series. Use it with your own
legal IPTV subscription (Xtream Codes or M3U).

A premium, cross-platform IPTV application built with React Native (Expo) and an optional Python Backend. Designed for high performance, cinematic user experience, and enterprise-level security.

## Supported Platforms
This application is fully responsive and officially supports:
- **Android Mobile** (Smartphones & Tablets)
- **Android TV** (D-Pad navigation optimized)
- **iOS** (iPhone & iPad)
- **macOS** (Electron, built with `build-mac.sh`)
- **Windows** (Native Desktop app via Electron)
- **Web Browsers** (Chrome, Safari, Edge)

## Features
- **M3U & Xtream Codes Support:** Add playlists via URL or Xtream credentials.
- **Cinematic UI:** Beautiful, dark-themed interface with Netflix-style animated intros.
- **Live TV, Movies, and Series:** Organized categories with EPG (Electronic Program Guide) support.
- **Favorites & Watch History:** Keep track of what you love.
- **Multi-Profile Support:** Create custom profiles for different family members.
- **Picture-in-Picture (PiP):** Watch TV while browsing other apps.
- **Chromecast:** Cast your favorite content directly to your TV.
- **Multi-View:** Watch 2 or 4 live channels at once; audio follows the selected tile.
- **EPG Reminders:** Set a reminder on an upcoming programme and get a "starting now" prompt (and a Windows notification on desktop).
- **Backup & Restore:** Export profiles, favourites, history, collections, settings and the playlist source to one JSON file and import it on another device.
- **Auto-Update:** Windows and Android builds check the public release channel and install new versions themselves.

## Advanced Security
- **AppLock (PIN Protection):** Secure the app against unauthorized access.
- **Tokenized Stream URLs:** Using the optional Python Backend, stream URLs are encrypted with Fernet/JWT to prevent unauthorized scraping or playlist theft.

## Getting Started

### Web / Desktop (Electron)
```bash
cd frontend
npm install
npm run desktop
```

### Mobile (Android/iOS)
```bash
cd frontend
npx expo start
```

### Python Proxy Backend (Optional for Security)
```bash
cd backend
pip install -r requirements.txt
python server.py
```

## Releasing a New Version
Installed apps (1.1.13 and later) update from this repository's Releases: each release
carries the installers and a `latest.json` (version, download URLs, SHA-256) the apps read.

1. Bump the version in `frontend/package.json`, `frontend/app.json` and
   `frontend/android/app/build.gradle` (`versionName`, and increase `versionCode`).
2. Build:
   ```bash
   cd frontend
   npm run build:msi
   cd android && ./gradlew assembleRelease
   ```
   On a Mac, `./build-mac.sh` builds `release/Lumio-IPTV-<version>.dmg` and the `mac` entry for `latest.json`.
   Release APKs are signed with the key in `C:\Users\<you>\lumio-signing`, configured through
   the `LUMIO_RELEASE_*` entries in `~/.gradle/gradle.properties`. **Back that key up**:
   without it no later APK can update an installed app.
3. Publish (copies the installers, writes `latest.json` with checksums, creates the GitHub release):
   ```bash
   node scripts/publish-release.mjs --notes "What's new"
   ```

## License

[MIT](LICENSE)
