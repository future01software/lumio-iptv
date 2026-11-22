# Lumio iOS (native)

Native iPhone version of Lumio IPTV, written in Swift/SwiftUI. Lumio is only a
player: it ships with no content, and users add their own Xtream Codes or M3U account.

Reference implementation (logic and design): `../frontend` in the lumio-iptv repo (Expo/React Native).

## Layout

```
LumioIPTV.xcodeproj         Xcode project (iOS 17+, no third-party dependencies)
Packages/LumioCore/         Platform-neutral core: models, Xtream client, M3U and XMLTV parsers,
                            Keychain account store, SwiftData models. Builds for iOS, tvOS and macOS,
                            so an Apple TV target can reuse it as is.
LumioIPTV/                  iPhone app (SwiftUI), a file-system-synchronized group
  AppModel.swift            Accounts, catalogs, EPG, favorites and progress helpers
  Playback/                 AVPlayerViewController wrapper (PiP, AirPlay, resume, HLS fallback)
  Views/                    Live TV, movies, series, "Listem", settings, add account
Config/Info.plist           Background audio (PiP), ATS (providers commonly use plain HTTP)
Tools/mock-xtream/          Fake local Xtream panel plus synthetic test media for Simulator testing
```

## Build and run

```sh
open LumioIPTV.xcodeproj         # pick an iPhone simulator, Run
```

or from the command line:

```sh
xcodebuild -project LumioIPTV.xcodeproj -scheme LumioIPTV \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build/DD build
```

Core tests: `cd Packages/LumioCore && swift test`

For your own iPhone with a free Apple account: in Xcode, open Signing & Capabilities for the
LumioIPTV target, select your Personal Team, change the bundle id if needed, then Run on the device.

## Testing without a real provider

```sh
sh Tools/mock-xtream/make-media.sh      # once, needs ffmpeg
python3 Tools/mock-xtream/server.py     # http://127.0.0.1:8899, user demo, password demo
```

In DEBUG builds, launching with the `-mockXtream` argument pre-fills the add-account form
with these mock values (the Simulator does not accept pasted text).

## Notes

- Credentials and M3U URLs are stored only in the Keychain (`AccountStore`); stream URLs are
  never persisted. Favorites and progress store item ids and rebuild URLs at play time.
- Xtream VOD in containers AVPlayer can't open (MKV/AVI) is tried as HLS (`.m3u8`) first,
  which most panels support; the original URL is the fallback.
- EPG: Xtream accounts use `get_short_epg` per visible channel; M3U accounts use the playlist's
  `url-tvg` or the EPG URL entered for the account (streamed XMLTV parse, filtered to known channels).
- The accent color is the Lumio brand red (`#E50914`) from the reference tokens; change
  `AccentColor` in the asset catalog to restyle.
