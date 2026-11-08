import React from "react";
import { View, Text, StyleSheet, Pressable, Platform } from "react-native";
import { BlurView } from "expo-blur";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInRight, FadeOutRight } from "react-native-reanimated";

import { glassPanel } from "./styles";
import { font, radius, spacing } from "@/src/theme/tokens";
import type { SeriesEpisode } from "@/src/types/iptv";

type Props = {
  episode: SeriesEpisode;
  fallbackLogo?: string;
  /** Seconds left before auto-advancing; null when autoplay is off. */
  countdown: number | null;
  countdownTotal: number;
  /** Controls visible → sit above the control bar. */
  lifted: boolean;
  onPlay: () => void;
  onDismiss: () => void;
  accentColor: string;
};

// Nuvio's NextEpisodeEndPromptOverlay: shows the next episode near the end with
// a countdown that fills the Play button, plus a way to stay on the credits.
export function PlayerUpNextCard({ episode, fallbackLogo, countdown, countdownTotal, lifted, onPlay, onDismiss, accentColor }: Props) {
  const thumb = episode.logo || fallbackLogo;
  const fill = countdown == null ? 0 : 1 - countdown / countdownTotal;

  return (
    <Animated.View
      entering={FadeInRight.duration(300)}
      exiting={FadeOutRight.duration(200)}
      style={[styles.wrap, { bottom: lifted ? 150 : 48 }]}
      testID="player-up-next"
    >
      <BlurView intensity={glassPanel.blurIntensity} tint={glassPanel.blurTint} style={StyleSheet.absoluteFillObject} />
      <View style={styles.top}>
        <View style={styles.thumb}>
          {thumb ? (
            <Image source={{ uri: thumb }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
          ) : (
            <Ionicons name="film-outline" size={24} color="rgba(255,255,255,0.4)" />
          )}
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.kicker}>SIRADAKİ BÖLÜM</Text>
          <Text style={styles.epNum}>
            Sezon {episode.season} · Bölüm {episode.episode}
          </Text>
          <Text style={styles.title} numberOfLines={2}>
            {episode.title}
          </Text>
        </View>
      </View>

      <View style={styles.actions}>
        <Pressable
          onPress={onPlay}
          focusable
          // @ts-ignore - TV only
          hasTVPreferredFocus={Platform.isTV}
          style={({ focused, hovered }: any) => [styles.playBtn, (focused || hovered) && styles.playBtnFocus]}
          testID="player-up-next-play"
        >
          {/* Countdown fills the button left→right. */}
          <View style={[styles.playFill, { width: `${fill * 100}%`, backgroundColor: accentColor }]} />
          <Ionicons name="play" size={18} color="#000" />
          <Text style={styles.playText}>{countdown != null ? `Oynat (${countdown})` : "Şimdi Oynat"}</Text>
        </Pressable>
        <Pressable
          onPress={onDismiss}
          focusable
          style={({ focused, hovered }: any) => [styles.dismissBtn, (focused || hovered) && { borderColor: "#fff" }]}
          testID="player-up-next-dismiss"
        >
          <Text style={styles.dismissText}>Jeneriği İzle</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    right: 32,
    width: 380,
    maxWidth: "90%",
    padding: spacing.md,
    gap: spacing.md,
    overflow: "hidden",
    zIndex: 100,
    borderRadius: glassPanel.borderRadius,
    borderWidth: glassPanel.borderWidth,
    borderColor: glassPanel.borderColor,
    backgroundColor: glassPanel.backgroundColor,
  },
  top: { flexDirection: "row", gap: 12, alignItems: "center" },
  thumb: {
    width: 128,
    height: 72,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  kicker: { color: "rgba(255,255,255,0.55)", fontSize: 10, fontWeight: "800", letterSpacing: 1.2 },
  epNum: { color: "#fff", fontSize: font.sm, fontWeight: "700" },
  title: { color: "rgba(255,255,255,0.85)", fontSize: font.sm },
  actions: { flexDirection: "row", gap: spacing.sm },
  playBtn: {
    flex: 1,
    height: 42,
    borderRadius: radius.pill,
    backgroundColor: "#fff",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "transparent",
  },
  playBtnFocus: { borderColor: "rgba(255,255,255,0.6)", transform: [{ scale: 1.03 }] },
  playFill: { position: "absolute", left: 0, top: 0, bottom: 0, opacity: 0.35 },
  playText: { color: "#000", fontWeight: "700", fontSize: font.base },
  dismissBtn: {
    height: 42,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
    alignItems: "center",
    justifyContent: "center",
  },
  dismissText: { color: "#fff", fontWeight: "600", fontSize: font.base },
});
