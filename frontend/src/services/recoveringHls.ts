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
    instance.on(Hls.Events.FRAG_LOADED, () => {
      if (instance === hls) networkRetries = 0;
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
