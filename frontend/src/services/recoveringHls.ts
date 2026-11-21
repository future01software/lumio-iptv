// hls.js player for live channels that recovers from freezes on its own.
//
// IPTV live streams freeze in ways hls.js doesn't always count as an error: a
// segment hangs, the playlist stops advancing for a moment, or the playhead lands
// in a buffer gap. The video then sits on one frame until the user zaps away and
// back, which simply rebuilds the player. This does the same automatically:
//   - watch currentTime; when it stops moving while the video should be playing,
//     first jump over a buffer gap / to the live edge, then rebuild the player;
//   - retry fatal network errors with backoff and reset the count once segments
//     load again (it used to be a lifetime budget of 3, so a long session ended
//     in an error after the 3rd hiccup);
//   - on a repeated media error, swap the audio codec before recovering;
//   - errors raised by the <video> element itself (a segment the decoder chokes
//     on) are recovered here too, instead of surfacing as a fatal error at once.

type Options = {
  Hls: any;
  media: HTMLVideoElement;
  src: string;
  config?: Record<string, unknown>;
  /** Called after each (re)built player parses the manifest. */
  onManifestParsed?: () => void;
  /** Recovery gave up; the stream really is down. */
  onFatal: (message: string) => void;
};

type StreamStatsRaw = { kbps?: number; videoCodec?: string };

export type StreamStats = {
  width: number;
  height: number;
  /** e.g. "H.264", "HEVC" */
  codec?: string;
  fps?: number;
  kbps?: number;
  /** Seconds of video buffered ahead of the playhead. */
  bufferSec: number;
};

function codecName(c?: string): string | undefined {
  if (!c) return undefined;
  const v = c.toLowerCase();
  if (v.startsWith("avc")) return "H.264";
  if (v.startsWith("hvc") || v.startsWith("hev")) return "HEVC";
  if (v.startsWith("av01")) return "AV1";
  if (v.startsWith("vp09") || v.startsWith("vp9")) return "VP9";
  return c.split(".")[0].toUpperCase();
}

const fpsState = new WeakMap<HTMLVideoElement, { frames: number; at: number; fps?: number }>();

/** Current stream facts for a <video> driven by createRecoveringHls (null before the first frame). */
export function readStreamStats(media: HTMLVideoElement | null | undefined): StreamStats | null {
  if (!media || !media.videoWidth) return null;
  const raw: StreamStatsRaw = (media as any).__lumioStats || {};
  let bufferSec = 0;
  const t = media.currentTime;
  for (let i = 0; i < media.buffered.length; i++) {
    if (media.buffered.start(i) <= t + 0.5 && media.buffered.end(i) > t) bufferSec = media.buffered.end(i) - t;
  }
  // fps from decoded frames between two reads (manifests rarely carry FRAME-RATE).
  let fps: number | undefined;
  const q = (media as any).getVideoPlaybackQuality?.();
  if (q) {
    const now = performance.now();
    const prev = fpsState.get(media);
    if (prev && now - prev.at > 900 && !media.paused) {
      const f = ((q.totalVideoFrames - prev.frames) * 1000) / (now - prev.at);
      if (f > 0 && f < 200) fps = Math.round(f);
      fpsState.set(media, { frames: q.totalVideoFrames, at: now, fps: fps ?? prev.fps });
    } else if (!prev) {
      fpsState.set(media, { frames: q.totalVideoFrames, at: now });
    }
    fps = fps ?? fpsState.get(media)?.fps;
  }
  // Counted frames drop when the window is hidden or busy, so only report a value close
  // to a real broadcast rate, snapped to it (23.976→24, 29.97→30, 59.94→60).
  if (fps) {
    const std = [24, 25, 30, 50, 60].find((r) => Math.abs(fps! - r) <= r * 0.08);
    fps = std;
  }
  return {
    width: media.videoWidth,
    height: media.videoHeight,
    codec: codecName(raw.videoCodec),
    fps,
    kbps: raw.kbps ? Math.round(raw.kbps) : undefined,
    bufferSec: Math.max(0, bufferSec),
  };
}

const NUDGE_AFTER_MS = 4000;
const REBUILD_AFTER_MS = 10000;
const MAX_REBUILDS = 4; // without 30s of clean playback in between
const HEALTHY_MS = 30000;

export function createRecoveringHls({ Hls, media, src, config, onManifestParsed, onFatal }: Options) {
  let hls: any = null;
  let destroyed = false;
  let networkRetries = 0;
  let lastMediaRecovery = 0;
  let rebuilds = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  // Stall watchdog state. Armed only after playback has really started, so a slow
  // first load isn't mistaken for a freeze.
  let started = false;
  let lastTime = -1;
  let lastProgressAt = Date.now();
  let healthySince = Date.now();
  let nudged = false;

  const fail = (message: string) => {
    if (destroyed) return;
    destroy();
    onFatal(message);
  };

  const rebuild = (reason: string) => {
    if (destroyed) return;
    if (rebuilds >= MAX_REBUILDS) {
      fail(reason);
      return;
    }
    rebuilds++;
    console.warn(`[hls] rebuilding player (${rebuilds}/${MAX_REBUILDS}): ${reason}`);
    const shouldPlay = !media.paused;
    teardownHls();
    build();
    if (shouldPlay) media.play().catch(() => {});
    lastProgressAt = Date.now();
    nudged = false;
  };

  // Stream facts read by the info badges (see readStreamStats).
  const stats = (): StreamStatsRaw => {
    const m = media as any;
    if (!m.__lumioStats) m.__lumioStats = {};
    return m.__lumioStats;
  };

  const build = () => {
    networkRetries = 0;
    hls = new Hls(config);
    const instance = hls;
    // Lets a debugger attached to the app inspect the live player (buffer, bandwidth, level).
    (media as any).__hls = instance;
    instance.on(Hls.Events.ERROR, (_event: unknown, data: any) => {
      if (destroyed || instance !== hls || !data?.fatal) return;
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        if (networkRetries < 4) {
          networkRetries++;
          if (retryTimer) clearTimeout(retryTimer);
          retryTimer = setTimeout(() => {
            if (!destroyed && instance === hls) instance.startLoad();
          }, 1000 * networkRetries);
        } else {
          rebuild("Bağlantı zaman aşımına uğradı veya ağ hatası (HLS).");
        }
      } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        const now = Date.now();
        if (now - lastMediaRecovery < 3000) {
          try { instance.swapAudioCodec(); } catch {}
        }
        lastMediaRecovery = now;
        instance.recoverMediaError();
      } else {
        rebuild(data?.details || "Canlı yayın web oynatıcıda açılamadı.");
      }
    });
    instance.on(Hls.Events.FRAG_LOADED, (_event: unknown, data: any) => {
      if (instance !== hls) return;
      networkRetries = 0;
      // Real stream bitrate for the info badges: bytes of the segment over its duration
      // (bandwidthEstimate is download speed, not what the stream carries).
      const bytes = data?.frag?.stats?.loaded || data?.payload?.byteLength || 0;
      const dur = data?.frag?.duration || 0;
      if (bytes > 0 && dur > 0) {
        const kbps = (bytes * 8) / dur / 1000;
        const prev = stats().kbps;
        stats().kbps = prev ? prev * 0.7 + kbps * 0.3 : kbps;
      }
    });
    instance.on(Hls.Events.BUFFER_CODECS, (_event: unknown, data: any) => {
      if (instance !== hls) return;
      const v = data?.video || data?.audiovideo;
      const codec = v?.codec || v?.levelCodec;
      if (codec) stats().videoCodec = String(codec);
    });
    instance.on(Hls.Events.MANIFEST_PARSED, () => {
      if (!destroyed && instance === hls) onManifestParsed?.();
    });
    instance.loadSource(src);
    instance.attachMedia(media);
  };

  // Stuck inside a gap in the buffer, or fallen behind the live window: move the
  // playhead to where there's data instead of waiting for it to arrive.
  const nudge = () => {
    const t = media.currentTime;
    const b = media.buffered;
    for (let i = 0; i < b.length; i++) {
      if (b.start(i) > t + 0.05) {
        media.currentTime = b.start(i) + 0.1;
        return;
      }
    }
    const live = hls?.liveSyncPosition;
    if (typeof live === "number" && isFinite(live) && live > t + 1) {
      media.currentTime = live;
    }
  };

  // The <video> element reports decode errors on its own, sometimes before hls.js
  // notices. Recover the same way as an hls.js media error; a second one within
  // 3s rebuilds the player (bounded by MAX_REBUILDS).
  const onElementError = () => {
    if (destroyed || !hls) return;
    const code = media.error?.code;
    // 1 = aborted: our own detach/teardown, not a playback failure.
    if (!code || code === 1) return;
    console.warn(`[hls] video element error ${code}: ${media.error?.message || ""}`);
    const now = Date.now();
    if (now - lastMediaRecovery < 3000) {
      lastMediaRecovery = now;
      rebuild("Yayın görüntüsü çözülemedi.");
      return;
    }
    lastMediaRecovery = now;
    try { hls.recoverMediaError(); } catch { rebuild("Yayın görüntüsü çözülemedi."); }
  };
  media.addEventListener("error", onElementError);

  const watchdog = setInterval(() => {
    if (destroyed) return;
    const now = Date.now();
    if (media.paused || media.ended) {
      lastProgressAt = now;
      return;
    }
    if (media.currentTime !== lastTime) {
      lastTime = media.currentTime;
      lastProgressAt = now;
      nudged = false;
      if (!started) {
        started = true;
        healthySince = now;
      }
      if (rebuilds > 0 && now - healthySince > HEALTHY_MS) rebuilds = 0;
      return;
    }
    if (!started) return;
    healthySince = now;
    const stuckFor = now - lastProgressAt;
    if (stuckFor > NUDGE_AFTER_MS && !nudged) {
      nudged = true;
      try { nudge(); } catch {}
    } else if (stuckFor > REBUILD_AFTER_MS) {
      rebuild("Yayın donup duruyor; kaynak şu an yanıt vermiyor.");
    }
  }, 1000);

  const teardownHls = () => {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    try { hls?.destroy?.(); } catch {}
    hls = null;
  };

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    clearInterval(watchdog);
    media.removeEventListener("error", onElementError);
    teardownHls();
  };

  build();
  return { destroy };
}
