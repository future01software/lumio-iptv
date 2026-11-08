import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, StatusBar, Platform, Pressable, AppState } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useVideoPlayer, VideoView, isPictureInPictureSupported } from "expo-video";
import { Ionicons } from "@expo/vector-icons";
import * as ScreenOrientation from "expo-screen-orientation";
import { GestureDetector, Gesture } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, runOnJS } from "react-native-reanimated";

import { useIPTV } from "@/src/store/iptv-store";
import { useI18n } from "@/src/store/i18n-store";
import { useTheme } from "@/src/store/theme-store";
import { usePlayerSettings } from "@/src/store/player-settings-store";
import { useResponsive } from "@/src/hooks/use-responsive";
import { isCastNativeAvailable } from "@/src/components/CastButton";
import { colors, spacing, radius, font } from "@/src/theme/tokens";
import { cleanChannelName } from "@/src/utils/clean-name";
import { PlayerTopBar } from "@/src/components/player/PlayerTopBar";
import { PlayerControlBar } from "@/src/components/player/PlayerControlBar";
import type { MoreMenuAction } from "@/src/components/player/PlayerMoreMenu";
import { PlayerBufferingOverlay } from "@/src/components/player/PlayerBufferingOverlay";
import { PlayerTracksPanel } from "@/src/components/player/PlayerTracksPanel";
import { PlayerChannelsDrawer, type ChannelsDrawerVariant } from "@/src/components/player/PlayerChannelsDrawer";
import { volumeIcon } from "@/src/components/player/PlayerControlBar";
import { PlayerEpisodesPanel } from "@/src/components/player/PlayerEpisodesPanel";
import { PlayerUpNextCard } from "@/src/components/player/PlayerUpNextCard";
import { useSeriesEpisodes } from "@/src/store/series-episodes-store";
import type { SeriesEpisode } from "@/src/types/iptv";
import { kindLabel } from "@/src/utils/kind-label";
import { useChromecast } from "@/src/hooks/use-chromecast";
import { createRecoveringHls } from "@/src/services/recoveringHls";

type ResizeMode = "contain" | "cover" | "fill" | "zoom";
const RESIZE_ORDER: ResizeMode[] = ["contain", "zoom", "cover", "fill"];
const RESIZE_LABELS: Record<ResizeMode, { short: string; toast: string; icon: any }> = {
  contain: { short: "Sığdır", toast: "Ekrana Sığdır (Orijinal)", icon: "scan-outline" },
  zoom: { short: "Yakınlaştır", toast: "Yakınlaştır (siyah bantlar kırpılır)", icon: "search-outline" },
  cover: { short: "Kapla", toast: "Ekranı Kapla (Kırpılmış)", icon: "expand-outline" },
  fill: { short: "Yay", toast: "Ekrana Yay (Genişletilmiş)", icon: "contract-outline" },
};
/** Each side of the zoomed video extends this far past the screen (≈ 1.33x). */
const ZOOM_OVERFLOW = "-16.5%";

let VLCPlayer: any = null;
try {
  VLCPlayer = require("react-native-vlc-media-player").VLCPlayer;
} catch {
  VLCPlayer = null;
}

function isUnsupportedMp2AudioError(message: string) {
  const m = message.toLowerCase();
  return (
    m.includes("audio/mpeg-l2") ||
    m.includes("mpeg-l2") ||
    (m.includes("mediacodecaudiorenderer") && m.includes("no_unsupported_type")) ||
    (m.includes("decoder init failed") && m.includes("audio"))
  );
}
function fmt(t: number) {
  if (!t || !isFinite(t)) return "0:00";
  const s = Math.floor(t);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

function buildVideoSource(rawUrl: string, mode: "auto" | "hls" = "auto") {
  const uri = String(rawUrl || "");
  if (!uri) return "";

  // Expo-video/ExoPlayer sometimes cannot infer the stream type when the
  // URL is a backend token endpoint like /api/play/... with no .m3u8 suffix.
  // Keep auto mode first so already-working channels are not affected; retry
  // with explicit HLS only when the player reports an extractor/source error.
  if (mode === "hls") {
    return { uri, contentType: "hls" } as any;
  }

  return uri;
}

function buildWebVideoUrl(rawUrl: string, kind?: "live" | "movie" | "series" | string) {
  // Web/Electron'da proxy uzerinden gec - backend dogru Accept headerlari ile
  // IPTV sunucusuna baglanir. Direkt baglantida 511 hatasi aliniyor.
  const uri = String(rawUrl || "");
  if (!uri || !uri.includes("/api/play/") || uri.includes("proxy=1")) return uri;
  
  if (kind === "movie" || kind === "series") return uri;

  return `${uri}${uri.includes("?") ? "&" : "?"}proxy=1`;
}

// Engine failover classification (NuvioTV PlayerRuntimeControllerEngineFailover):
// codec/renderer/container problems are exactly what LibVLC's own decoders fix,
// while network/auth failures would fail identically in VLC, so don't bother.
function isCodecOrRendererError(message: string) {
  const m = message.toLowerCase();
  return (
    m.includes("decoder") ||
    m.includes("mediacodec") ||
    m.includes("renderer") ||
    m.includes("no_unsupported_type") ||
    m.includes("format_unsupported") ||
    m.includes("exceeds_capabilities") ||
    m.includes("error_code_decoding") ||
    m.includes("audiotrack") ||
    m.includes("audio sink")
  );
}
function isNetworkError(message: string) {
  const m = message.toLowerCase();
  return (
    /\b(401|403|404|429|5\d\d)\b/.test(m) ||
    m.includes("response code") ||
    m.includes("timeout") ||
    m.includes("timed out") ||
    m.includes("unable to connect") ||
    m.includes("unknownhost") ||
    m.includes("network")
  );
}

function looksLikeExtractorError(message: string) {
  const m = message.toLowerCase();
  return m.includes("none of the available extractors") || m.includes("source error");
}

function forceAudioOn(player: any) {
  try { player.muted = false; } catch {}
  try { player.volume = 1; } catch {}
  try {
    const tracks = player.availableAudioTracks || [];
    if (!player.audioTrack && tracks.length > 0) {
      player.audioTrack = tracks[0];
    }
  } catch {}
}

type WebVideoHandle = {
  play: () => void;
  pause: () => void;
  seekBy: (delta: number) => number;
  setPlaybackRate: (rate: number) => void;
};

// liveSyncDurationCount = how many segments behind the live edge to sit. IPTV
// streams aren't LL-HLS, so hugging the edge (lowLatencyMode) just leaves no
// cushion and stutters; 3-4 segments back is what keeps playback smooth.
//
// maxBufferLength is deliberately deep for live: some providers publish segments
// in bursts (two at once) and drop old ones from a short window just as fast. With
// only ~18s buffered, the player hadn't fetched a segment yet when it left the
// playlist, leaving a 10s hole: a freeze, then a skip, about once a minute.
//
// Some providers also publish faster than real time (measured: ~1.17x), so a
// player at 1x drifts further behind and content has to go eventually.
// liveMaxLatencyDurationCount makes that one clean jump back to the live sync
// point, well before the drift would outrun the buffer and open holes again
// (holes need latency > maxBufferLength + playlist window).
const HLS_BUFFER_PRESETS = {
  small: { backBufferLength: 12, maxBufferLength: 45, maxMaxBufferLength: 60, liveSyncDurationCount: 3, liveMaxLatencyDurationCount: 7 },
  normal: { backBufferLength: 30, maxBufferLength: 90, maxMaxBufferLength: 120, liveSyncDurationCount: 3, liveMaxLatencyDurationCount: 10 },
  large: { backBufferLength: 60, maxBufferLength: 150, maxMaxBufferLength: 180, maxBufferSize: 120 * 1000 * 1000, liveSyncDurationCount: 4, liveMaxLatencyDurationCount: 15 },
} as const;

// Native (ExoPlayer via expo-video) buffering, modelled on NuvioTV's defaults:
// start playing after ~3s, keep 45s ahead for VOD, and in "large" (Nuvio's
// performance mode) buffer up to 120s / 250MB. Live keeps a small window so
// channel zaps stay quick. maxBufferBytes caps RAM on low-memory TV boxes.
const NO_EPISODES: SeriesEpisode[] = [];
const UP_NEXT_WINDOW_SEC = 30;
const UP_NEXT_COUNTDOWN_SEC = 10;

const MB = 1024 * 1024;
const NATIVE_BUFFER_PRESETS = {
  live: {
    small: { preferredForwardBufferDuration: 10, minBufferForPlayback: 2, maxBufferBytes: 32 * MB },
    normal: { preferredForwardBufferDuration: 15, minBufferForPlayback: 2.5, maxBufferBytes: 64 * MB },
    large: { preferredForwardBufferDuration: 30, minBufferForPlayback: 3, maxBufferBytes: 100 * MB },
  },
  vod: {
    small: { preferredForwardBufferDuration: 25, minBufferForPlayback: 2.5, maxBufferBytes: 64 * MB },
    normal: { preferredForwardBufferDuration: 45, minBufferForPlayback: 3, maxBufferBytes: 150 * MB },
    large: {
      preferredForwardBufferDuration: 120,
      minBufferForPlayback: 3,
      maxBufferBytes: 250 * MB,
      prioritizeTimeOverSizeThreshold: true,
    },
  },
} as const;

const VLC_CACHING_PRESETS = {
  small: { network: 1000, live: 1000, file: 500 },
  normal: { network: 2000, live: 2000, file: 1000 },
  large: { network: 4000, live: 4000, file: 2000 },
} as const;

// Chromium reports every direct-play failure as "no supported source", which
// hides whether the provider refused the file or the codec is unsupported.
// Probe the first bytes to tell the user which one it actually is.
async function diagnoseDirectPlayFailure(src: string): Promise<string> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(src, { headers: { Range: "bytes=0-15" }, signal: ctrl.signal });
    clearTimeout(timer);
    if (res.status >= 400) {
      try { await res.body?.cancel(); } catch {}
      if (res.status === 401 || res.status === 403) {
        return `Sağlayıcı erişimi reddetti (HTTP ${res.status}). Hesabının süresi dolmuş ya da bağlantı sınırı (aynı anda tek cihaz) aşılmış olabilir.`;
      }
      return `Sağlayıcı bu içeriği veremiyor (HTTP ${res.status}). Dosya sunucuda eksik ya da bozuk olabilir; başka bir bölüm veya film dene.`;
    }
    // Read just the first chunk - a server that ignores Range would otherwise send the whole file.
    const reader = res.body?.getReader();
    const first = reader ? (await reader.read()).value : undefined;
    try { await reader?.cancel(); } catch {}
    const b = first || new Uint8Array();
    if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) {
      return "Bu içerik MKV biçiminde ve ses/görüntü kodeği masaüstü oynatıcıda desteklenmiyor (ör. AC3/DTS ses ya da HEVC görüntü).";
    }
    return "Bu içeriğin ses/görüntü biçimi masaüstü oynatıcıda desteklenmiyor.";
  } catch {
    return "İçeriğe ulaşılamadı. İnternet bağlantını ya da sağlayıcının durumunu kontrol et.";
  }
}

const WebHlsVideo = React.forwardRef<WebVideoHandle, {
  src: string;
  kind?: "live" | "movie" | "series";
  resizeMode: "contain" | "cover" | "fill";
  autoPlay: boolean;
  /** Resume position in seconds (VOD only). */
  startAt?: number;
  volume?: number;
  muted?: boolean;
  bufferSize?: keyof typeof HLS_BUFFER_PRESETS;
  onBuffering: (value: boolean) => void;
  onError: (message: string) => void;
  onPlayingChange: (value: boolean) => void;
  onTimeUpdate: (time: number) => void;
  onDurationChange: (duration: number) => void;
  onReady: () => void;
}>(({
  src,
  kind,
  resizeMode,
  autoPlay,
  startAt = 0,
  volume = 1,
  muted = false,
  bufferSize = "normal",
  onBuffering,
  onError,
  onPlayingChange,
  onTimeUpdate,
  onDurationChange,
  onReady,
}, ref) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const directPlayRef = useRef(false);
  // True while hls.js drives the element; its errors are then handled by createRecoveringHls.
  const hlsActiveRef = useRef(false);
  // Re-applied on source change too: the element is keyed by URL.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = Math.min(1, Math.max(0, volume));
    v.muted = muted;
  }, [volume, muted, src]);
  const failureReportedRef = useRef(false);
  const reportDirectFailure = React.useCallback(async () => {
    if (failureReportedRef.current) return;
    failureReportedRef.current = true;
    onBuffering(false);
    onError(await diagnoseDirectPlayFailure(src));
  }, [onBuffering, onError, src]);

  React.useImperativeHandle(ref, () => ({
    play: () => {
      const video = videoRef.current;
      if (!video) return;
      video.play().catch((err) => onError(err?.message || "Video oynatma başlatılamadı."));
    },
    pause: () => videoRef.current?.pause(),
    seekBy: (delta: number) => {
      const video = videoRef.current;
      if (!video) return 0;
      video.currentTime = Math.max(0, video.currentTime + delta);
      return video.currentTime;
    },
    setPlaybackRate: (rate: number) => {
      if (videoRef.current) videoRef.current.playbackRate = rate;
    },
  }), [onError]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;
    const media = video;

    let hls: any = null;
    let cancelled = false;
    failureReportedRef.current = false;
    onBuffering(true);

    async function attachSource() {
      try {
        const looksLikeDirectMedia = /\.(mp4|webm|ogg|ogv|mov|m4v|mkv|avi|flv|wmv)(\?|$)/i.test(src);
        const canNativeHls = media.canPlayType("application/vnd.apple.mpegurl") !== "";
        const isSafariOrIOS = /iPad|iPhone|iPod/i.test(navigator.userAgent) || (/Safari/i.test(navigator.userAgent) && !/Chrome/i.test(navigator.userAgent));
        
        // Film/dizi icin direkt video oynat (MP4). Canli yayin icin Hls.js kullan.
        const isDirectPlay = looksLikeDirectMedia || kind === "movie" || kind === "series";
        directPlayRef.current = isDirectPlay;
        
        if (isDirectPlay || (canNativeHls && isSafariOrIOS)) {
          media.src = src;
          media.load();
          if (autoPlay && !cancelled) {
            await media.play();
          }
        } else {
          const mod = await import("hls.js/dist/hls.js");
          // Unmounted while hls.js was loading: the cleanup already ran, so don't start a player nobody destroys.
          if (cancelled) return;
          const Hls = mod.default;
          if (!Hls.isSupported()) {
            throw new Error("Bu tarayıcı HLS canlı yayınlarını desteklemiyor.");
          }
          hlsActiveRef.current = true;
          hls = createRecoveringHls({
            Hls,
            media,
            src,
            config: {
              lowLatencyMode: false,
              startFragPrefetch: true,
              ...HLS_BUFFER_PRESETS[bufferSize],
            },
            onManifestParsed: () => {
              if (autoPlay && !cancelled) {
                media.play().catch(e => console.warn("HLS Play error", e));
              }
            },
            onFatal: (message) => {
              hlsActiveRef.current = false;
              onBuffering(false);
              onError(message);
            },
          });
        }
      } catch (err: any) {
        if (cancelled) return;
        if (directPlayRef.current) {
          reportDirectFailure();
          return;
        }
        onBuffering(false);
        onError(err?.message || "Canlı yayın web oynatıcıda açılamadı.");
      }
    }

    attachSource();

    return () => {
      cancelled = true;
      hlsActiveRef.current = false;
      try { hls?.destroy?.(); } catch {}
      try {
        media.pause();
        media.removeAttribute("src");
        media.load();
      } catch {}
    };
  }, [autoPlay, bufferSize, onBuffering, onError, src, reportDirectFailure]);

  const objectFit =
    resizeMode === "fill" ? "fill" :
    resizeMode === "cover" ? "cover" :
    "contain";

  return React.createElement("video", {
    ref: videoRef,
    playsInline: true,
    controls: false,
    muted,
    style: {
      position: "absolute",
      inset: 0,
      width: "100%",
      height: "100%",
      backgroundColor: "#000",
      objectFit,
    },
    onCanPlay: () => {
      onBuffering(false);
      onReady();
    },
    onLoadedData: () => {
      onBuffering(false);
      onReady();
    },
    onLoadedMetadata: (event: any) => {
      // Resume (continue watching / episode switch). The component is keyed by
      // URL, so this runs once per source.
      const el = event?.currentTarget as HTMLVideoElement | undefined;
      if (el && kind !== "live" && startAt > 0 && isFinite(el.duration)) {
        try { el.currentTime = Math.min(startAt, Math.max(0, el.duration - 1)); } catch {}
      }
      onBuffering(false);
      onReady();
    },
    onPlaying: () => {
      onBuffering(false);
      onPlayingChange(true);
      onReady();
    },
    onPause: () => onPlayingChange(false),
    onWaiting: () => onBuffering(true),
    onTimeUpdate: (event: any) => {
      onBuffering(false);
      onTimeUpdate(event.currentTarget.currentTime || 0);
    },
    onDurationChange: (event: any) => onDurationChange(event.currentTarget.duration || 0),
    onError: () => {
      if (directPlayRef.current) {
        reportDirectFailure();
        return;
      }
      // hls.js is playing: createRecoveringHls recovers and only reports a real failure.
      if (hlsActiveRef.current) return;
      onBuffering(false);
      onError("Canlı yayın açılamadı. Kaynak, tarayıcının CORS engeline takılıyor olabilir.");
    },
  });
});
WebHlsVideo.displayName = "WebHlsVideo";

export default function Player() {
  const router = useRouter();
  const { url, title, kind, itemId, position, logo, seriesId } = useLocalSearchParams<{
    url: string; title: string; kind: "live" | "movie" | "series"; itemId: string; position?: string; logo?: string; seriesId?: string;
  }>();
  const upsertHistory = useIPTV((s) => s.upsertHistory);
  const playlist = useIPTV((s) => s.playlist);
  const pushRecent = useIPTV((s) => s.pushRecent);
  const { t } = useI18n();
  const { accentColor } = useTheme();
  const autoplaySetting = usePlayerSettings((s) => s.autoplay);
  const resumeSetting = usePlayerSettings((s) => s.resume);
  const hwAccelSetting = usePlayerSettings((s) => s.hwAccel);
  const bufferSizeSetting = usePlayerSettings((s) => s.bufferSize);

  const liveChannels = playlist?.channels || [];
  const currentIdx = kind === "live" ? liveChannels.findIndex((c) => c.id === itemId) : -1;

  function zapChannel(delta: number) {
    if (kind !== "live" || currentIdx < 0) return;
    const next = liveChannels[(currentIdx + delta + liveChannels.length) % liveChannels.length];
    if (!next) return;
    pushRecent(next.id);
    router.setParams({ url: next.url, title: next.name, kind: "live", itemId: next.id, logo: next.logo || "" });
  }

  const isLive = kind === "live";

  // Series context for the episodes panel and up-next. seriesId comes from the
  // series page / continue-watching; older links without it fall back to looking
  // the episode up in whatever episode lists are already known.
  const history = useIPTV((s) => s.history);
  const loadEpisodes = useSeriesEpisodes((s) => s.load);
  const findSeriesOf = useSeriesEpisodes((s) => s.findSeriesOf);
  const resolvedSeriesId = kind === "series" ? String(seriesId || findSeriesOf(String(itemId)) || "") : "";
  const episodes = useSeriesEpisodes((s) => (resolvedSeriesId ? s.bySeries[resolvedSeriesId] : undefined)) || NO_EPISODES;
  useEffect(() => {
    if (resolvedSeriesId) loadEpisodes(resolvedSeriesId);
  }, [resolvedSeriesId, loadEpisodes]);
  const episodeIndex = episodes.findIndex((e) => e.id === itemId);
  const nextEpisode = episodeIndex >= 0 && episodeIndex < episodes.length - 1 ? episodes[episodeIndex + 1] : null;
  const episodeProgress = useMemo(() => {
    const map: Record<string, { position: number; duration: number }> = {};
    for (const h of history) if (h.kind === "series") map[h.item_id] = { position: h.position, duration: h.duration };
    return map;
  }, [history]);
  const [showEpisodes, setShowEpisodes] = useState(false);

  // Swap the source in place (like channel zapping) so Back still leaves the player.
  function playEpisode(ep: SeriesEpisode, resume = true) {
    const p = episodeProgress[ep.id];
    const resumeAt = resume && p && p.duration > 0 && p.position / p.duration < 0.92 ? p.position : 0;
    saveProgress(); // record where the current episode was left before swapping
    setShowEpisodes(false);
    setUpNextDismissed(false);
    setCurrent(resumeAt);
    setDuration(0);
    userPausedRef.current = false;
    router.setParams({
      url: ep.url || "",
      title: ep.title,
      kind: "series",
      itemId: ep.id,
      seriesId: resolvedSeriesId,
      logo: ep.logo || String(logo || ""),
      position: String(resumeAt),
    });
  }

  function playNextEpisode() {
    if (nextEpisode) playEpisode(nextEpisode, false);
  }
  const startAt = resumeSetting ? Math.max(0, parseFloat(position || "0") || 0) : 0;
  const isWebPlayer = Platform.OS === "web";
  const webVideoRef = useRef<WebVideoHandle | null>(null);
  const videoViewRef = useRef<VideoView | null>(null);
  const player = useVideoPlayer(isWebPlayer ? "" : buildVideoSource(url || ""), (p) => {
    p.loop = false;
    p.timeUpdateEventInterval = 1;
    // phones keep playing for background audio / PiP; a TV has neither, so HOME must stop it
    p.staysActiveInBackground = !Platform.isTV;
    forceAudioOn(p as any);
    try { p.bufferOptions = NATIVE_BUFFER_PRESETS[isLive ? "live" : "vod"][bufferSizeSetting]; } catch {}
    if (!isLive && startAt > 0) {
      try { p.currentTime = startAt; } catch {}
    }
    if (autoplaySetting) p.play();
  });

  const [showControls, setShowControls] = useState(true);
  const [isPlaying, setIsPlaying] = useState(autoplaySetting);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(startAt);
  // Up-next (Nuvio NextEpisodeAutoPlay): card appears in the last 30s; with
  // autoplay on it counts down 10s (paused while the video is paused) and advances.
  const [upNextDismissed, setUpNextDismissed] = useState(false);
  const remaining = duration > 0 ? duration - current : Infinity;
  const shouldShowUpNext = !!nextEpisode && !upNextDismissed && current > 0 && remaining <= UP_NEXT_WINDOW_SEC;
  const [upNextCountdown, setUpNextCountdown] = useState<number | null>(null);
  const [buffering, setBuffering] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [showTracks, setShowTracks] = useState(false);
  const [showZapping, setShowZapping] = useState(false);
  const hlsRetryRef = useRef(false);
  // First-frame watchdog (NuvioTV PlayerFirstFrameWatchdogPolicy): some TV boxes
  // report readyToPlay but never actually start. If we meant to autoplay and the
  // user hasn't paused, nudge play() once the stream is ready.
  const userPausedRef = useRef(false);
  const watchdogTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!shouldShowUpNext || !autoplaySetting) {
      setUpNextCountdown(null);
      return;
    }
    setUpNextCountdown((c) => c ?? Math.max(1, Math.min(UP_NEXT_COUNTDOWN_SEC, Math.floor(remaining))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldShowUpNext, autoplaySetting]);
  useEffect(() => {
    if (upNextCountdown == null || !isPlaying) return;
    if (upNextCountdown <= 0) {
      playNextEpisode();
      return;
    }
    const t = setTimeout(() => setUpNextCountdown((c) => (c == null ? c : c - 1)), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upNextCountdown, isPlaying]);
  const resumeAppliedRef = useRef(false);
  const seekingRef = useRef(false);
  const seekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [useNativeCodecPlayer, setUseNativeCodecPlayer] = useState(false);
  const [vlcPaused, setVlcPaused] = useState(!autoplaySetting);
  // TV: pressing HOME only backgrounds the app, and both players kept going (picture
  // gone, sound and network still running behind the launcher). Pause on background.
  useEffect(() => {
    if (!Platform.isTV) return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "background") return;
      try { player.pause(); } catch {}
      setVlcPaused(true);
    });
    return () => sub.remove();
  }, [player]);
  const [vlcSeek, setVlcSeek] = useState(0);
  const canUseNativeCodecPlayer = Platform.OS === "android" && !!VLCPlayer;
  const shouldUseNativeCodecPlayer = canUseNativeCodecPlayer && useNativeCodecPlayer;
  const vlcSource = React.useMemo(() => {
    const caching = VLC_CACHING_PRESETS[bufferSizeSetting];
    return {
      uri: String(url || ""),
      initType: 2,
      // Hardware decode is enabled (not forced) so the TV box's video chip does the
      // decoding instead of the CPU. Software-only decode (previous setting) was the
      // main cause of stutter on low-power Android TV boxes when this fallback kicks in.
      // The Settings "Hardware Acceleration" toggle can force it off for boxes where
      // hw decode itself is the problem.
      hwDecoderEnabled: hwAccelSetting ? 1 : 0,
      hwDecoderForced: 0,
      initOptions: [
        "--no-mediacodec-dr",
        "--no-omxil-dr",
        `--network-caching=${caching.network}`,
        `--live-caching=${caching.live}`,
        `--file-caching=${caching.file}`,
        "--clock-jitter=0",
        "--drop-late-frames",
        "--skip-frames",
        "--no-video-title-show",
      ],
      mediaOptions: [
        `:network-caching=${caching.network}`,
        `:live-caching=${caching.live}`,
        `:file-caching=${caching.file}`,
        ":clock-jitter=0",
        ":drop-late-frames",
        ":skip-frames",
        ":no-video-title-show",
      ],
    };
  }, [url, hwAccelSetting, bufferSizeSetting]);

  const loadSourceAndPlay = React.useCallback(async (nextUrl: string, mode: "auto" | "hls" = "auto") => {
    if (!nextUrl) return;
    if (mode === "auto") hlsRetryRef.current = false;
    setError(null);
    setBuffering(true);
    resumeAppliedRef.current = false;
    seekingRef.current = false;
    setUseNativeCodecPlayer(false);
    setVlcPaused(false);
    setVlcSeek(0);
    if (isWebPlayer) {
      setRetryCount(c => c + 1);
      return;
    }
    try {
      const p: any = player as any;

      // expo-video can freeze on iOS when replace() loads synchronously.
      // Use replaceAsync when available; fall back to replace for Android/older runtimes.
      if (typeof p.replaceAsync === "function") {
        await p.replaceAsync(buildVideoSource(nextUrl, mode));
      } else if (typeof p.replace === "function") {
        p.replace(buildVideoSource(nextUrl, mode));
      }

      forceAudioOn(player as any);
      if (!isLive && startAt > 0) {
        try { player.currentTime = startAt; } catch {}
      }
      player.play();
    } catch (e: any) {
      console.warn("Player loadSourceAndPlay error:", e?.message || e);
      setBuffering(false);
      setError(e?.message || t("player.error_playback"));
    }
  }, [player, isLive, startAt, t, isWebPlayer]);

  // Persistent surface: when the `url` param changes (e.g. fast channel zap),
  // reload the source without unmounting the VideoView.
  const lastUrlRef = useRef<string>(String(url || ""));
  useEffect(() => {
    const next = String(url || "");
    if (!next || next === lastUrlRef.current) return;
    lastUrlRef.current = next;
    resumeAppliedRef.current = false;
    seekingRef.current = false;
    setCurrent(0);
    setDuration(0);
    setVlcSeek(0);
    setIsPlaying(autoplaySetting);
    loadSourceAndPlay(next);
  }, [url, loadSourceAndPlay]);

  const hideTimerRef = useRef<any>(null);
  const seekIndicator = useSharedValue(0);
  const [seekDisplay] = useState("");
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Desktop/web volume (Nuvio DesktopPlayerVolume): remembered level + mute,
  // keyboard (Up/Down, M), mouse wheel, and a transient on-screen indicator.
  const volume = usePlayerSettings((s) => s.volume);
  const muted = usePlayerSettings((s) => s.muted);
  const [volumeOsd, setVolumeOsd] = useState(false);
  const volumeOsdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashVolume = React.useCallback(() => {
    setVolumeOsd(true);
    if (volumeOsdTimer.current) clearTimeout(volumeOsdTimer.current);
    volumeOsdTimer.current = setTimeout(() => setVolumeOsd(false), 1200);
  }, []);
  const changeVolume = React.useCallback((delta: number) => {
    const st = usePlayerSettings.getState();
    // Like YouTube: while muted, raising resumes from the previous level
    // (setVolume unmutes), lowering adjusts that level but stays muted.
    st.setVolume(st.volume + delta);
    if (st.muted && delta < 0) st.setMuted(true);
    flashVolume();
  }, [flashVolume]);
  const toggleMute = React.useCallback(() => {
    const st = usePlayerSettings.getState();
    if (st.muted || st.volume === 0) {
      if (st.volume === 0) st.setVolume(0.5);
      st.setMuted(false);
    } else {
      st.setMuted(true);
    }
    flashVolume();
  }, [flashVolume]);
  const volumeActionsRef = useRef({ changeVolume, toggleMute });
  volumeActionsRef.current = { changeVolume, toggleMute };
  const [isLocked, setIsLocked] = useState(false);
  const [sleepMinutes, setSleepMinutes] = useState(0);
  const sleepTimerRef = useRef<any>(null);

  function showToast(msg: string) {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 4000);
  }

  // Chromecast: once a device is picked with the Cast button, the current media plays
  // there and the phone's player pauses.
  const currentRef = useRef(current);
  currentRef.current = current;
  const cast = useChromecast(
    {
      url: String(url || ""),
      title: String((isLive ? cleanChannelName(String(title || "")) : title) || ""),
      logo: (logo as string) || undefined,
      isLive,
      getPosition: () => currentRef.current,
    },
    {
      onStart: () => {
        if (shouldUseNativeCodecPlayer) setVlcPaused(true);
        else {
          try { player.pause(); } catch {}
        }
        setIsPlaying(false);
      },
      onEnd: () => showToast("Chromecast bağlantısı kapandı"),
      onError: (msg) => showToast(msg),
    },
  );

  const [resizeMode, setResizeMode] = useState<ResizeMode>("contain");
  function toggleResizeMode() {
    scheduleHide();
    setResizeMode(prev => {
      const next = RESIZE_ORDER[(RESIZE_ORDER.indexOf(prev) + 1) % RESIZE_ORDER.length];
      showToast(RESIZE_LABELS[next].toast);
      return next;
    });
  }
  // "zoom" is "cover" plus a scale-up: many IPTV films are sent as 16:9 frames with the
  // black bars burned into the picture, which no fit mode can remove - zooming crops them.
  const videoFit: "contain" | "cover" | "fill" = resizeMode === "zoom" ? "cover" : resizeMode;

  const { isTVStyle, isPhone, isTV, isLandscape } = useResponsive();
  // Channel list layout: TV = bottom card strip, portrait phone = bottom sheet, else left panel.
  const channelsVariant: ChannelsDrawerVariant = isTV ? "strip" : isPhone && !isLandscape ? "sheet" : "side";
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  useEffect(() => {
    try {
      if (Platform.OS !== "web") {
        ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
      }
      StatusBar.setHidden(true);
    } catch (e) { console.warn("Player Orientation Error:", e); }
    return () => {
      try {
        if (Platform.OS !== "web") {
          ScreenOrientation.unlockAsync().catch(() => {});
        }
      } catch {}
      try { StatusBar.setHidden(false); } catch {}
    };
  }, []);

  useEffect(() => {
    if (isWebPlayer) return;
    let subs: any[] = [];
    try {
      if (typeof player.addListener === "function") {
        subs = [
          player.addListener("playingChange", (ev: any) => setIsPlaying(ev.isPlaying)),
          player.addListener("statusChange", (ev: any) => {
            const status = ev?.status;
            setBuffering(status === "loading");

            if (status === "readyToPlay" || status === "idle") {
              forceAudioOn(player as any);
              setError(null);
            }

            if (status === "readyToPlay" && autoplaySetting && !userPausedRef.current) {
              if (watchdogTimerRef.current) clearTimeout(watchdogTimerRef.current);
              watchdogTimerRef.current = setTimeout(() => {
                try {
                  if (!userPausedRef.current && !player.playing && player.status === "readyToPlay") {
                    console.warn("First-frame watchdog: forcing play()");
                    player.play();
                  }
                } catch {}
              }, 1500);
            }

            if (status === "error") {
              const message = String(ev?.error?.message || ev?.error || t("player.error_playback"));
              console.warn("Player status error:", message, ev);

              // Some IPTV streams use MP2 audio (audio/mpeg-L2). Expo-video/MediaCodec
              // can reject those streams. On Android native builds, fall back to LibVLC if installed.
              if (canUseNativeCodecPlayer && isUnsupportedMp2AudioError(message)) {
                console.warn("Switching to native codec player fallback for MP2 audio stream");
                setError(null);
                setBuffering(true);
                setUseNativeCodecPlayer(true);
                return;
              }

              // Android/Expo player may fail to detect HLS when backend URL has no extension.
              // Retry once with explicit HLS content type; do not change the URL.
              if (isLive && !hlsRetryRef.current && looksLikeExtractorError(message)) {
                hlsRetryRef.current = true;
                loadSourceAndPlay(String(url || ""), "hls");
                return;
              }

              // Anything the built-in player can't decode (or can't make sense of even
              // after the HLS retry) gets one more chance on LibVLC before we give up.
              if (
                canUseNativeCodecPlayer &&
                !isNetworkError(message) &&
                (isCodecOrRendererError(message) || looksLikeExtractorError(message))
              ) {
                console.warn("Engine failover: switching to LibVLC for", message);
                setError(null);
                setBuffering(true);
                setUseNativeCodecPlayer(true);
                return;
              }

              setError(message);
            }
          }),
          player.addListener("timeUpdate", (ev: any) => {
            if (seekingRef.current) return;
            const nextTime = ev.currentTime || 0;
            setCurrent(nextTime);
            if (nextTime > 0 || isLive) {
              setBuffering(false);
              setError(null);
            }
          }),
          player.addListener("sourceLoad", (ev: any) => {
            forceAudioOn(player as any);
            setDuration(ev.duration || 0);
            if (!isLive && startAt > 0 && !resumeAppliedRef.current) {
              resumeAppliedRef.current = true;
              try {
                player.currentTime = Math.min(startAt, Math.max(0, (ev.duration || startAt + 1) - 1));
                setCurrent(player.currentTime || startAt);
              } catch {}
            }
            setBuffering(false);
            setError(null);
          }),
        ];
      }
    } catch (e) { console.warn("Player Listener Error:", e); }
    return () => {
      try {
        subs.forEach((s) => s?.remove?.());
        if (sleepTimerRef.current) clearTimeout(sleepTimerRef.current);
        if (watchdogTimerRef.current) clearTimeout(watchdogTimerRef.current);
      } catch {}
    };
  }, [player, t, isLive, url, loadSourceAndPlay, isWebPlayer, autoplaySetting]);

  // Resume / save history. The interval used to depend on `current`, so every
  // time update (several per second) reset it and it never fired during
  // playback - positions were saved as 0. Read the latest values from a ref
  // instead, and also save when leaving the player or switching episodes.
  const progressRef = useRef({ itemId, kind, seriesId: resolvedSeriesId, title, logo, url, current, duration });
  progressRef.current = { itemId, kind, seriesId: resolvedSeriesId, title, logo, url, current, duration };
  const saveProgress = React.useCallback(() => {
    const p = progressRef.current;
    if (p.kind === "live" || !p.itemId || p.current < 1) return; // never really played
    upsertHistory({
      item_id: String(p.itemId),
      kind: p.kind as any,
      series_id: p.seriesId || undefined,
      name: String(p.title || ""),
      logo: (p.logo as string) || null,
      url: String(p.url || ""),
      position: p.current,
      duration: p.duration,
    });
  }, [upsertHistory]);
  useEffect(() => {
    if (isLive || !itemId) return;
    const i = setInterval(saveProgress, 5000);
    return () => clearInterval(i);
  }, [isLive, itemId, saveProgress]);
  const saveProgressRef = useRef(saveProgress);
  saveProgressRef.current = saveProgress;
  useEffect(() => () => saveProgressRef.current(), []); // on leaving the player

  function scheduleHide() {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      if (!showTracks && !showZapping && !showMoreMenu) setShowControls(false);
    }, 3500);
  }
  useEffect(() => {
    if (showControls) scheduleHide();
    return () => hideTimerRef.current && clearTimeout(hideTimerRef.current);
  }, [showControls, showTracks, showZapping, showMoreMenu]);

  function toggleChannels() {
    setShowZapping((prev) => {
      const next = !prev;
      if (next && hideTimerRef.current) clearTimeout(hideTimerRef.current);
      return next;
    });
  }
  function openTracks() {
    setShowTracks(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
  }
  const toggleAppFullscreen = React.useCallback(() => {
    if (typeof window === "undefined") return;
    if ((window as any).electronAPI) {
      (window as any).electronAPI.toggleFullscreen();
    } else if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen();
    }
  }, []);

  /** D-pad left/right: first press reveals controls; next presses seek or zap. */
  function handleDpadHorizontal(direction: "left" | "right") {
    if (isLocked || showTracks || showZapping || showMoreMenu) return;
    if (!showControls) {
      if (direction === "right") {
        if (!isLive) seekBy(10);
        else zapChannel(1);
      } else {
        if (!isLive) seekBy(-10);
        else zapChannel(-1);
      }
      setShowControls(true);
      scheduleHide();
      return;
    }
    scheduleHide();
  }

  function handleDpadCenter() {
    if (isLocked || showTracks || showZapping || showMoreMenu) return;
    if (!showControls) {
      setShowControls(true);
      scheduleHide();
    }
  }

  function togglePlay() {
    if (isWebPlayer) {
      if (isPlaying) webVideoRef.current?.pause();
      else webVideoRef.current?.play();
      setShowControls(true);
      return;
    }
    if (shouldUseNativeCodecPlayer) {
      setVlcPaused((prev) => {
        setIsPlaying(prev);
        return !prev;
      });
      setShowControls(true);
      return;
    }
    if (player.playing) {
      userPausedRef.current = true;
      player.pause();
    } else {
      userPausedRef.current = false;
      player.play();
    }
    setShowControls(true);
  }
  function seekBy(delta: number) {
    if (isLive) return;
    const now = typeof player.currentTime === "number" ? player.currentTime : current;
    seekTo(now + delta);
  }
  function seekTo(value: number) {
    if (isLive) return;
    const upper = duration > 0 ? duration : 1e9;
    const next = Math.max(0, Math.min(upper, Number(value) || 0));
    seekingRef.current = true;
    setCurrent(next);
    setBuffering(true);
    if (isWebPlayer) {
      const webNext = webVideoRef.current?.seekBy(next - current) ?? next;
      setCurrent(webNext);
      setBuffering(false);
      setTimeout(() => { seekingRef.current = false; }, 700);
      setShowControls(true);
      return;
    }
    if (shouldUseNativeCodecPlayer) {
      if (duration > 0) setVlcSeek(Math.max(0, Math.min(1, next / duration)));
      setVlcPaused(false);
      setIsPlaying(true);
      setBuffering(false);
      setTimeout(() => { seekingRef.current = false; }, 1200);
      setShowControls(true);
      return;
    }
    try {
      player.currentTime = next;
      player.play();
    } catch (e) {
      console.warn("Seek error:", e);
    }
    setTimeout(() => {
      seekingRef.current = false;
      setBuffering(false);
    }, 900);
    setShowControls(true);
  }
  function changeSpeed() {
    if (isLive) return;
    const opts = [0.5, 1, 1.25, 1.5, 2];
    const idx = opts.indexOf(speed);
    const next = opts[(idx + 1) % opts.length];
    setSpeed(next);
    if (isWebPlayer) {
      webVideoRef.current?.setPlaybackRate(next);
      setShowControls(true);
      return;
    }
    player.playbackRate = next;
    setShowControls(true);
  }

  function toggleSleepTimer() {
    const opts = [0, 30, 60, 90, 120];
    const idx = opts.indexOf(sleepMinutes);
    const next = opts[(idx + 1) % opts.length];

    if (sleepTimerRef.current) clearTimeout(sleepTimerRef.current);
    setSleepMinutes(next);

    if (next === 0) {
      showToast(t("player.sleep_cancelled"));
    } else {
      sleepTimerRef.current = setTimeout(() => {
        try { player.pause(); } catch {}
        try { setVlcPaused(true); } catch {}
        router.back();
      }, next * 60 * 1000);
      showToast(t("player.sleep_active", { time: next >= 60 ? (next / 60) + ' saat' : next + ' dakika' }));
    }
  }

  // Gestures
  const tap = Gesture.Tap()
    .maxDuration(250)
    .onEnd(() => {
      if (!isLocked) runOnJS(setShowControls)(true);
    });

  const doubleTapLeft = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => runOnJS(seekBy)(-10));
  const doubleTapRight = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => runOnJS(seekBy)(10));

  const indicatorStyle = useAnimatedStyle(() => ({ opacity: seekIndicator.value }));

  const tvRefs = useRef({
    showControls,
    isLive,
    isLocked,
    showTracks,
    showZapping,
    showMoreMenu,
    seekBy,
    zapChannel,
    scheduleHide,
    handleDpadHorizontal,
    handleDpadCenter,
    togglePlay,
  });
  useEffect(() => {
    tvRefs.current = {
      showControls,
      isLive,
      isLocked,
      showTracks,
      showZapping,
      showMoreMenu,
      seekBy,
      zapChannel,
      scheduleHide,
      handleDpadHorizontal,
      handleDpadCenter,
      togglePlay,
    };
  });

  useEffect(() => {
    if (Platform.OS === "web") return;
    let tvEventHandler: any = null;
    try {
      const TVEventHandler = (require("react-native") as { TVEventHandler?: new () => { enable: Function; disable: Function } }).TVEventHandler;
      if (TVEventHandler) {
        tvEventHandler = new TVEventHandler();
        tvEventHandler.enable(undefined, (_cmp: any, evt: any) => {
          if (!evt) return;
          const refs = tvRefs.current;
          if (refs.isLocked || refs.showTracks || refs.showZapping || refs.showMoreMenu) return;

          if (evt.eventType === "right") {
            refs.handleDpadHorizontal("right");
          } else if (evt.eventType === "left") {
            refs.handleDpadHorizontal("left");
          } else if (evt.eventType === "up" || evt.eventType === "down" || evt.eventType === "select") {
            if (!refs.showControls) refs.handleDpadCenter();
            else refs.scheduleHide();
          }
        });
      }
    } catch (e) { console.warn("TVEventHandler error:", e); }
    return () => {
      try { if (tvEventHandler) tvEventHandler.disable(); } catch {}
    };
  }, []);

  // Web / Electron: mouse wheel over the player changes the volume (not while a
  // scrollable panel - episodes, channels, tracks, menu - is open).
  useEffect(() => {
    if (!isWebPlayer || typeof window === "undefined") return;
    if (showEpisodes || showZapping || showTracks || showMoreMenu) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) < 1) return;
      volumeActionsRef.current.changeVolume(e.deltaY < 0 ? 0.05 : -0.05);
    };
    window.addEventListener("wheel", onWheel, { passive: true });
    return () => window.removeEventListener("wheel", onWheel);
  }, [isWebPlayer, showEpisodes, showZapping, showTracks, showMoreMenu]);

  // Web / Electron: global arrow keys — reveal controls first, then seek/zap.
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const onKeyDown = (e: KeyboardEvent) => {
      const refs = tvRefs.current;
      if (refs.isLocked || refs.showTracks || refs.showZapping || refs.showMoreMenu) return;

      if (e.key === "ArrowRight" || e.key === "MediaFastForward") {
        e.preventDefault();
        refs.handleDpadHorizontal("right");
      } else if (e.key === "ArrowLeft" || e.key === "MediaRewind") {
        e.preventDefault();
        refs.handleDpadHorizontal("left");
      } else if (e.key === "Enter" || e.key === "MediaPlayPause") {
        e.preventDefault();
        refs.handleDpadCenter();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        volumeActionsRef.current.changeVolume(0.05);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        volumeActionsRef.current.changeVolume(-0.05);
      } else if (e.key.toLowerCase() === "m") {
        e.preventDefault();
        volumeActionsRef.current.toggleMute();
      } else if (e.key === " ") {
        e.preventDefault();
        refs.togglePlay();
      } else if (e.key.toLowerCase() === "f") {
        e.preventDefault();
        toggleAppFullscreen();
      } else if (e.key === "Escape") {
        if ((window as any).electronAPI) {
          // If in fullscreen, exit. We don't have a direct exit API in preload but toggleFullscreen works.
          // Or we could let Electron handle Escape natively.
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function handleNativeKeyDown(e: { nativeEvent?: { key?: string } }) {
    const key = e.nativeEvent?.key;
    if (!key) return;
    if (key === "ArrowRight" || key === "MediaFastForward") {
      handleDpadHorizontal("right");
    } else if (key === "ArrowLeft" || key === "MediaRewind") {
      handleDpadHorizontal("left");
    } else if (key === "Enter" || key === "MediaPlayPause" || key === " ") {
      handleDpadCenter();
    }
  }

  const tvKeyCaptureProps =
    Platform.OS === "web" || Platform.OS === "android"
      ? { onKeyDown: handleNativeKeyDown }
      : {};

  const canShowTracks = !isWebPlayer && !shouldUseNativeCodecPlayer && !isLive &&
    ((player.availableSubtitleTracks?.length ?? 0) > 0 || (player.availableAudioTracks?.length ?? 0) > 0);
  // VLC (native codec fallback) and the web <video> path don't go through expo-video's
  // VideoView, so its imperative startPictureInPicture() isn't available there.
  const canUsePip = !isWebPlayer && !shouldUseNativeCodecPlayer && isPictureInPictureSupported();

  const secondaryActions = React.useMemo<MoreMenuAction[]>(() => {
    const items: MoreMenuAction[] = [];
    if (isLive) {
      items.push({ key: "channels", icon: "list", label: "Kanallar", onPress: toggleChannels, testID: "player-zapping" });
    }
    if (kind === "series" && episodes.length > 1) {
      items.push({
        key: "episodes",
        icon: "albums-outline",
        label: "Bölümler",
        onPress: () => {
          if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
          setShowEpisodes(true);
        },
        testID: "player-episodes",
      });
    }
    if (canShowTracks) {
      items.push({ key: "tracks", icon: "language", label: "Dil/Altyazı", onPress: openTracks, testID: "player-tracks" });
    }
    if (!isLive) {
      items.push({ key: "speed", icon: "speedometer-outline", label: `${speed}x`, onPress: changeSpeed, testID: "player-speed" });
    }
    if (isTV) {
      items.push({
        key: "resize",
        icon: RESIZE_LABELS[resizeMode].icon,
        label: RESIZE_LABELS[resizeMode].short,
        onPress: toggleResizeMode,
        testID: "player-resize-tv",
      });
    }
    items.push({
      key: "lock",
      icon: "lock-closed-outline",
      label: t("player.lock"),
      onPress: () => { setIsLocked(true); setShowControls(false); },
      testID: "player-lock",
    });
    items.push({
      key: "sleep",
      icon: sleepMinutes > 0 ? "moon" : "moon-outline",
      label: sleepMinutes > 0 ? (sleepMinutes >= 60 ? `${sleepMinutes / 60}h` : `${sleepMinutes}m`) : t("player.sleep"),
      active: sleepMinutes > 0,
      onPress: toggleSleepTimer,
      testID: "player-sleep",
    });
    if (canUsePip) {
      items.push({
        key: "pip",
        icon: "scan-outline",
        label: "PiP",
        onPress: () => {
          videoViewRef.current?.startPictureInPicture().catch(() => showToast(t("player.pip_hint")));
        },
        testID: "player-pip",
      });
    }
    items.push({
      key: "info",
      icon: "information-circle-outline",
      label: t("player.info"),
      onPress: () => showToast(t("player.info_toast", { title: String(title), type: String(isLive ? t("player.live") : kindLabel(kind)) })),
      testID: "player-info",
    });
    return items;
  }, [isLive, canShowTracks, canUsePip, speed, sleepMinutes, title, kind, t, episodes.length, isTV, resizeMode]);

  return (
    <View style={styles.root}>
      <GestureDetector gesture={tap}>
        <View style={StyleSheet.absoluteFillObject}>
          {/* Zoom = lay the video out larger than the screen (the overflow is off-screen).
              A scale transform doesn't work here: the default SurfaceView ignores view
              transforms, and swapping to a TextureView remounted the player. */}
          <View style={resizeMode === "zoom" ? styles.zoomBox : StyleSheet.absoluteFillObject}>
          {isWebPlayer ? (
            <WebHlsVideo
              key={String(url || "") + retryCount}
              ref={webVideoRef}
              src={buildWebVideoUrl(String(url || ""), kind)}
              kind={kind}
              resizeMode={videoFit}
              autoPlay={autoplaySetting}
              startAt={startAt}
              volume={volume}
              muted={muted}
              bufferSize={bufferSizeSetting}
              onBuffering={setBuffering}
              onError={setError}
              onPlayingChange={setIsPlaying}
              onTimeUpdate={setCurrent}
              onDurationChange={setDuration}
              onReady={() => setError(null)}
            />
          ) : shouldUseNativeCodecPlayer ? (
            <VLCPlayer
              key={String(url || "")}
              style={StyleSheet.absoluteFillObject}
              source={vlcSource}
              autoplay={!vlcPaused}
              paused={vlcPaused}
              seek={vlcSeek}
              resizeMode={videoFit === "cover" ? "cover" : "contain"}
              autoAspectRatio={true}
              onPlaying={() => {
                setBuffering(false);
                setError(null);
                setIsPlaying(true);
              }}
              onProgress={(ev: any) => {
                const nextTime = Number(ev?.currentTime || 0) / 1000;
                const nextDuration = Number(ev?.duration || 0) / 1000;
                if (nextDuration > 0) setDuration(nextDuration);
                if (!seekingRef.current && nextTime > 0) setCurrent(nextTime);
                setBuffering(false);
                setError(null);
                setIsPlaying(true);
              }}
              onPaused={() => setIsPlaying(false)}
              onBuffering={() => setBuffering(true)}
              onError={(ev: any) => {
                console.warn("Native codec player error:", ev);
                setBuffering(false);
                setError("Gelişmiş oynatıcı yayını açamadı.");
              }}
            />
          ) : (
            <VideoView
              ref={videoViewRef}
              player={player}
              style={StyleSheet.absoluteFillObject}
              contentFit={videoFit}
              nativeControls={false}
              allowsPictureInPicture
            />
          )}
          </View>
          {/* Double tap zones */}
          <View style={styles.gestureZones} pointerEvents="box-none">
            <GestureDetector gesture={doubleTapLeft}>
              <View style={styles.zoneLeft} />
            </GestureDetector>
            <GestureDetector gesture={doubleTapRight}>
              <View style={styles.zoneRight} />
            </GestureDetector>
          </View>
        </View>
      </GestureDetector>

      {!showControls && (
        <Pressable
          style={StyleSheet.absoluteFillObject}
          onPress={() => {
            setShowControls(true);
            scheduleHide();
          }}
          focusable={true}
          hasTVPreferredFocus={Platform.isTV}
          {...tvKeyCaptureProps}
        />
      )}

      {cast.casting && (
        <View style={styles.castLayer} pointerEvents="box-none">
          <Ionicons name="tv" size={56} color="#fff" />
          <Text style={styles.castTitle} numberOfLines={2}>{cast.deviceName} cihazında oynatılıyor</Text>
          <TouchableOpacity style={[styles.retryBtn, { backgroundColor: accentColor }]} onPress={cast.stopCasting} testID="player-cast-stop">
            <Text style={styles.retryText}>Yayını durdur</Text>
          </TouchableOpacity>
        </View>
      )}

      {buffering && !error && !cast.casting && (
        <PlayerBufferingOverlay logo={(logo as string) || null} title={String(title || "")} />
      )}

      {error && (
        <View style={styles.center}>
          <Ionicons name="warning" size={40} color={colors.error} />
          <Text style={styles.errText}>{error}</Text>
          <TouchableOpacity style={[styles.retryBtn, { backgroundColor: accentColor }]} onPress={() => loadSourceAndPlay(String(url || ""))} testID="player-retry">
            <Text style={styles.retryText}>{t("player.retry")}</Text>
          </TouchableOpacity>
          {canUseNativeCodecPlayer && (
            <TouchableOpacity style={[styles.retryBtn, { backgroundColor: accentColor }]} onPress={() => { setError(null); setBuffering(true); setUseNativeCodecPlayer(true); }} testID="player-native-codec-retry">
              <Text style={styles.retryText}>Gelişmiş oynatıcı ile dene</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      <Animated.View style={[styles.seekIndicator, indicatorStyle]} pointerEvents="none">
        <Text style={styles.seekText}>{seekDisplay}</Text>
      </Animated.View>

      {isLocked && (
        <View style={styles.lockedLayer} pointerEvents="box-none">
          <TouchableOpacity style={styles.unlockBtn} onPress={() => setIsLocked(false)}>
            <Ionicons name="lock-closed" size={32} color="#fff" />
            <Text style={styles.unlockText}>{t("player.unlock")}</Text>
          </TouchableOpacity>
        </View>
      )}

      {isWebPlayer && volumeOsd && (
        <View style={styles.volumeOsd} pointerEvents="none" testID="player-volume-osd">
          <Ionicons name={volumeIcon(volume, muted)} size={22} color="#fff" />
          <View style={styles.volumeOsdTrack}>
            <View style={[styles.volumeOsdFill, { width: `${muted ? 0 : Math.round(volume * 100)}%`, backgroundColor: accentColor }]} />
          </View>
          <Text style={styles.volumeOsdText}>{muted ? "Sessiz" : `${Math.round(volume * 100)}%`}</Text>
        </View>
      )}

      {shouldShowUpNext && nextEpisode && !isLocked && !showEpisodes && (
        <PlayerUpNextCard
          episode={nextEpisode}
          fallbackLogo={String(logo || "")}
          countdown={upNextCountdown}
          countdownTotal={UP_NEXT_COUNTDOWN_SEC}
          lifted={showControls}
          onPlay={playNextEpisode}
          onDismiss={() => setUpNextDismissed(true)}
          accentColor={accentColor}
        />
      )}

      {showControls && !isLocked && (
        <Pressable
          style={styles.controlsLayer}
          pointerEvents="box-none"
          focusable={Platform.OS === "android"}
          {...tvKeyCaptureProps}
        >
          {toastMsg && (
            <TouchableOpacity onPress={() => setToastMsg(null)} activeOpacity={0.9} style={styles.toast} testID="player-toast">
              <Ionicons name="information-circle" size={18} color="#fff" />
              <Text style={styles.toastText}>{toastMsg}</Text>
            </TouchableOpacity>
          )}
          <PlayerTopBar
            title={String((isLive ? cleanChannelName(String(title || "")) : title) || "")}
            liveLabel={t("player.live")}
            isLive={isLive}
            kind={kind}
            resizeMode={resizeMode}
            onBack={() => router.back()}
            onToggleResize={toggleResizeMode}
            onToggleFullscreen={Platform.OS === "web" ? toggleAppFullscreen : undefined}
            onAirPlayUnavailable={() => showToast("AirPlay: open iOS Control Center → Screen Mirroring, then pick your Apple TV.")}
            onCastUnavailable={() => showToast(isCastNativeAvailable ? "Yakında yayın yapılabilecek cihaz bulunamadı." : "Chromecast bu sürümde kullanılamıyor.")}
            isCastNativeAvailable={isCastNativeAvailable}
            accentColor={accentColor}
            onInteract={scheduleHide}
          />

          <PlayerControlBar
            isLive={isLive}
            current={current}
            duration={duration}
            formatTime={fmt}
            onScrubbing={(val) => {
              seekingRef.current = true;
              setCurrent(val);
              setShowControls(true);
              if (seekTimerRef.current) clearTimeout(seekTimerRef.current);
              seekTimerRef.current = setTimeout(() => {
                seekTo(val);
              }, 600);
            }}
            onScrubComplete={(val) => {
              if (seekTimerRef.current) clearTimeout(seekTimerRef.current);
              seekTo(val);
            }}
            isPlaying={isPlaying}
            onTogglePlay={togglePlay}
            onSeekBack={() => (isLive ? zapChannel(-1) : seekBy(-10))}
            onSeekForward={() => (isLive ? zapChannel(1) : seekBy(10))}
            prevIcon={isLive ? "chevron-back-circle" : "play-back"}
            nextIcon={isLive ? "chevron-forward-circle" : "play-forward"}
            accentColor={accentColor}
            onInteract={scheduleHide}
            actions={secondaryActions}
            collapseActions={isPhone}
            moreOpen={showMoreMenu}
            onToggleMore={() => setShowMoreMenu((v) => !v)}
            volume={
              isWebPlayer
                ? {
                    value: volume,
                    muted,
                    onChange: (v) => usePlayerSettings.getState().setVolume(v),
                    onToggleMute: toggleMute,
                  }
                : undefined
            }
          />
        </Pressable>
      )}

      <PlayerTracksPanel
        visible={showTracks}
        onClose={() => setShowTracks(false)}
        audioTracks={player.availableAudioTracks || []}
        subtitleTracks={player.availableSubtitleTracks || []}
        selectedAudioId={player.audioTrack?.id ?? null}
        selectedSubtitleId={player.subtitleTrack?.id ?? null}
        onSelectAudio={(tr) => { player.audioTrack = tr as any; setShowTracks(false); }}
        onSelectSubtitle={(tr) => { player.subtitleTrack = tr as any; setShowTracks(false); }}
        accentColor={accentColor}
      />

      <PlayerEpisodesPanel
        open={showEpisodes}
        onClose={() => setShowEpisodes(false)}
        episodes={episodes}
        currentId={String(itemId || "")}
        progress={episodeProgress}
        fallbackLogo={String(logo || "")}
        onSelect={(ep) => (ep.id === itemId ? setShowEpisodes(false) : playEpisode(ep))}
        accentColor={accentColor}
      />

      <PlayerChannelsDrawer
        visible={isLive}
        open={showZapping}
        onToggle={toggleChannels}
        onClose={() => setShowZapping(false)}
        channels={liveChannels}
        variant={channelsVariant}
        selectedId={String(itemId || "")}
        onSelect={(item) => {
          setShowZapping(false);
          pushRecent(item.id);
          router.setParams({ url: item.url, title: item.name, kind: "live", itemId: item.id, logo: item.logo || "" });
        }}
        accentColor={accentColor}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  castLayer: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.85)", alignItems: "center", justifyContent: "center", gap: 16, padding: 24 },
  castTitle: { color: "#fff", fontSize: 18, fontWeight: "700", textAlign: "center" },
  zoomBox: { position: "absolute", top: ZOOM_OVERFLOW, bottom: ZOOM_OVERFLOW, left: ZOOM_OVERFLOW, right: ZOOM_OVERFLOW },
  volumeOsd: {
    position: "absolute",
    top: 72,
    alignSelf: "center",
    zIndex: 120,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "rgba(12,12,16,0.82)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  volumeOsdTrack: { width: 140, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.2)", overflow: "hidden" },
  volumeOsdFill: { height: 4, borderRadius: 2 },
  volumeOsdText: { color: "#fff", fontSize: 13, fontWeight: "700", minWidth: 44, textAlign: "right" },
  root: { flex: 1, backgroundColor: "#000" },
  center: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", gap: spacing.md },
  errText: { color: "#fff", fontSize: font.lg, textAlign: "center", paddingHorizontal: spacing.xl },
  retryBtn: { backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.xl, paddingVertical: 10, borderRadius: radius.pill, marginTop: spacing.md },
  retryText: { color: "#fff", fontWeight: "700" },
  controlsLayer: { ...StyleSheet.absoluteFillObject, justifyContent: "space-between" },
  gestureZones: { ...StyleSheet.absoluteFillObject, flexDirection: "row" },
  zoneLeft: { flex: 1 },
  zoneRight: { flex: 1 },
  seekIndicator: { position: "absolute", top: "45%", alignSelf: "center", backgroundColor: "rgba(0,0,0,0.7)", paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill },
  seekText: { color: "#fff", fontSize: font.lg, fontWeight: "600" },
  toast: { position: "absolute", top: Platform.OS === "ios" ? 110 : 80, left: 16, right: 16, flexDirection: "row", gap: 8, alignItems: "center", padding: spacing.md, backgroundColor: "rgba(0,0,0,0.85)", borderRadius: radius.md, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)" },
  toastText: { color: "#fff", flex: 1, fontSize: font.sm },
  lockedLayer: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  unlockBtn: { backgroundColor: "rgba(0,0,0,0.6)", padding: 20, borderRadius: 100, alignItems: "center" },
  unlockText: { color: "#fff", fontSize: 12, marginTop: 4, fontWeight: "bold" },
});
