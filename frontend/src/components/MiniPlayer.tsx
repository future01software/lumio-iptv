import React, { useEffect, useRef } from "react";
import { View, StyleSheet, Platform } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";

type Props = {
  src: string,
  isPlaying: boolean,
  /** Previews are silent; multi-view unmutes the selected tile. */
  muted?: boolean,
  onReady?: () => void,
  onError?: (err: string) => void,
};

/** Android TV / native: muted expo-video preview, same role as the web <video> below. */
function NativeMiniPlayer({ src, isPlaying, muted = true, onReady, onError }: Props) {
  const player = useVideoPlayer(src || null, (p) => {
    p.muted = muted;
    p.loop = false;
    if (isPlaying) p.play();
  });

  useEffect(() => {
    const sub = player.addListener("statusChange", ({ status, error }) => {
      if (status === "readyToPlay") onReady?.();
      if (status === "error") onError?.(error?.message || "Video oynatılamadı");
    });
    return () => sub.remove();
  }, [player, onReady, onError]);

  // Switch channels in place instead of tearing the player down (one stream connection).
  const firstSrc = useRef(src);
  useEffect(() => {
    if (src === firstSrc.current) return;
    firstSrc.current = src;
    try {
      player.replace(src || null);
      if (isPlaying) player.play();
    } catch {}
  }, [src, player, isPlaying]);

  useEffect(() => {
    try { isPlaying ? player.play() : player.pause(); } catch {}
  }, [isPlaying, player]);

  useEffect(() => {
    try { player.muted = muted; } catch {}
  }, [muted, player]);

  return (
    <View style={styles.container} pointerEvents="none">
      <VideoView player={player} nativeControls={false} contentFit="contain" style={StyleSheet.absoluteFill} />
    </View>
  );
}

export default function MiniPlayer(props: Props) {
  const { src, isPlaying, muted = true, onReady, onError } = props;
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const video = videoRef.current;
    if (!video || !src) return;

    let hls: any = null;
    let cancelled = false;
    let networkRetryCount = 0;

    async function attachSource() {
      try {
        const looksLikeDirectMedia = /\.(mp4|webm|ogg|ogv|mov|m4v|mkv|avi|flv|wmv)(\?|$)/i.test(src);
        const canNativeHls = video!.canPlayType("application/vnd.apple.mpegurl") !== "";
        const isSafariOrIOS = /iPad|iPhone|iPod/i.test(navigator.userAgent) || (/Safari/i.test(navigator.userAgent) && !/Chrome/i.test(navigator.userAgent));

        if (looksLikeDirectMedia || (canNativeHls && isSafariOrIOS)) {
          video!.src = src;
          video!.load();
          if (isPlaying && !cancelled) await video!.play().catch(e => console.warn(e));
          onReady?.();
        } else {
          const mod = await import("hls.js/dist/hls.js");
          // Unmounted while hls.js was loading: the cleanup already ran, so don't start a player nobody destroys.
          if (cancelled) return;
          const Hls = mod.default;
          if (!Hls.isSupported()) throw new Error("HLS not supported");
          
          hls = new Hls({ lowLatencyMode: false, startFragPrefetch: true });
          hls.on(Hls.Events.ERROR, (_event: unknown, data: any) => {
            if (!data?.fatal) return;
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              if (networkRetryCount < 3) {
                networkRetryCount++;
                hls.startLoad();
              } else {
                onError?.("Ağ bağlantısı koptu veya zaman aşımı (HLS).");
              }
            } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              hls.recoverMediaError();
            } else {
              onError?.(data?.details || "Video oynatılamadı");
            }
          });
          
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (isPlaying && !cancelled) {
              video!.play().catch(e => console.warn("HLS Play error", e));
            }
            onReady?.();
          });

          hls.loadSource(src);
          hls.attachMedia(video!);
        }
      } catch (err: any) {
        if (!cancelled) onError?.(err?.message || "Hata");
      }
    }

    attachSource();

    return () => {
      cancelled = true;
      try { hls?.destroy?.(); } catch {}
      try {
        video?.pause();
        video?.removeAttribute("src");
        video?.load();
      } catch {}
    };
  }, [src]); // removed isPlaying to avoid reconnecting source when pausing

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const video = videoRef.current;
    if (!video) return;
    if (isPlaying) {
      video.play().catch(e => console.warn(e));
    } else {
      video.pause();
    }
  }, [isPlaying]);

  useEffect(() => {
    if (Platform.OS !== "web" || !videoRef.current) return;
    videoRef.current.muted = muted;
  }, [muted]);

  if (Platform.OS !== "web") return <NativeMiniPlayer {...props} />;

  return (
    <View style={styles.container} pointerEvents="none">
      {React.createElement("video", {
        ref: videoRef,
        style: { width: "100%", height: "100%", objectFit: "contain", backgroundColor: "#000" },
        playsInline: true,
        controls: false,
        muted, // previews stay silent so they don't annoy the user
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
    overflow: "hidden",
  }
});
