import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

// The native module only exists in Android dev/production builds (not Expo Go, web, iOS
// in this app), so it's loaded lazily. CAST is a module constant: the hooks below are
// either always or never called for the life of the app.
let CAST: any = null;
if (Platform.OS === "android") {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    CAST = require("react-native-google-cast");
  } catch {
    CAST = null;
  }
}

export const chromecastSupported = !!CAST;

type CastMedia = {
  url: string;
  title: string;
  logo?: string;
  isLive: boolean;
  /** Seconds to start a VOD at (the local player's current position). */
  getPosition: () => number;
};

type Callbacks = {
  /** Media is now playing on the Cast device: pause the local player. */
  onStart: () => void;
  /** The Cast session ended: the local player may resume. */
  onEnd: () => void;
  onError: (message: string) => void;
};

/**
 * The Cast receiver (Google's Default Media Receiver) can play HLS, MP4 and WebM, but not
 * a raw MPEG-TS stream. Xtream servers serve every live channel as HLS too, so `.ts` live
 * URLs are switched to `.m3u8`.
 */
export function castableUrl(url: string, isLive: boolean): string {
  if (isLive) return url.replace(/\.ts(\?|$)/i, ".m3u8$1");
  return url;
}

export function castContentType(url: string, isLive: boolean): string {
  const path = url.split("?")[0].toLowerCase();
  if (path.endsWith(".m3u8") || isLive) return "application/x-mpegURL";
  if (path.endsWith(".mkv")) return "video/x-matroska";
  if (path.endsWith(".webm")) return "video/webm";
  return "video/mp4";
}

/**
 * Plays the player's current media on a connected Chromecast. Once the user picks a
 * device with the Cast button, the media is loaded there (VODs from the local position)
 * and the local player is paused; changing channel/episode re-loads the new media.
 */
export function useChromecast(media: CastMedia, cb: Callbacks) {
  /* eslint-disable react-hooks/rules-of-hooks -- CAST never changes at runtime */
  const client = CAST ? CAST.useRemoteMediaClient() : null;
  const device = CAST ? CAST.useCastDevice() : null;
  /* eslint-enable react-hooks/rules-of-hooks */

  const [casting, setCasting] = useState(false);
  const loadedRef = useRef<{ client: any; url: string } | null>(null);
  const cbRef = useRef(cb);
  cbRef.current = cb;
  const mediaRef = useRef(media);
  mediaRef.current = media;

  useEffect(() => {
    if (!client) {
      if (loadedRef.current) {
        loadedRef.current = null;
        setCasting(false);
        cbRef.current.onEnd();
      }
      return;
    }
    const m = mediaRef.current;
    if (!m.url) return;
    const loaded = loadedRef.current;
    if (loaded && loaded.client === client && loaded.url === m.url) return;
    loadedRef.current = { client, url: m.url };

    const contentUrl = castableUrl(m.url, m.isLive);
    client
      .loadMedia({
        autoplay: true,
        startTime: m.isLive ? undefined : Math.max(0, Math.floor(m.getPosition())),
        mediaInfo: {
          contentUrl,
          contentType: castContentType(contentUrl, m.isLive),
          streamType: m.isLive ? "live" : "buffered",
          metadata: {
            type: m.isLive ? "generic" : "movie",
            title: m.title,
            images: m.logo ? [{ url: m.logo }] : [],
          },
        },
      })
      .then(() => {
        setCasting(true);
        cbRef.current.onStart();
      })
      .catch((e: any) => {
        loadedRef.current = null;
        setCasting(false);
        cbRef.current.onError(
          "Yayın Chromecast'e gönderilemedi" + (e?.message ? `: ${e.message}` : "."),
        );
      });
  }, [client, media.url]);

  const stopCasting = () => {
    try {
      CAST?.default?.getSessionManager?.().endCurrentSession(true);
    } catch {}
  };

  return {
    casting,
    deviceName: (device?.friendlyName as string | undefined) || "Chromecast",
    stopCasting,
  };
}
