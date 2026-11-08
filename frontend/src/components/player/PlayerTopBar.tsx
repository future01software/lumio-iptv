import React from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

import { CastButton, AirPlayButton } from "@/src/components/CastButton";
import { PlayerIconButton } from "./PlayerIconButton";
import { TOP_GRADIENT } from "./styles";
import { spacing, font } from "@/src/theme/tokens";
import { kindLabel } from "@/src/utils/kind-label";
import { useResponsive } from "@/src/hooks/use-responsive";

type Props = {
  title: string;
  liveLabel: string;
  isLive: boolean;
  kind?: string;
  resizeMode: "contain" | "cover" | "fill" | "zoom";
  onBack: () => void;
  onToggleResize: () => void;
  onToggleFullscreen?: () => void;
  onAirPlayUnavailable: () => void;
  onCastUnavailable: () => void;
  isCastNativeAvailable: boolean;
  accentColor: string;
  onInteract: () => void;
};

const RESIZE_ICONS = { contain: "scan", cover: "expand", fill: "contract", zoom: "search" } as const;

export function PlayerTopBar({
  title,
  liveLabel,
  isLive,
  kind,
  resizeMode,
  onBack,
  onToggleResize,
  onToggleFullscreen,
  onAirPlayUnavailable,
  onCastUnavailable,
  isCastNativeAvailable,
  accentColor,
  onInteract,
}: Props) {
  const { isTV } = useResponsive();
  return (
    <LinearGradient colors={TOP_GRADIENT as any} style={[styles.root, isTV && styles.rootTV]} pointerEvents="box-none">
      <PlayerIconButton icon="chevron-down" size={26} onPress={onBack} testID="player-back" accentColor={accentColor} onInteract={onInteract} />
      <View style={styles.titleBlock}>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        <Text style={styles.subtitle}>{isLive ? liveLabel : kindLabel(kind)}</Text>
      </View>
      {/* On TV the remote can't reach the top bar from the transport row; resize lives in the
          bottom action row there instead. */}
      {!isTV && (
        <PlayerIconButton
          icon={RESIZE_ICONS[resizeMode]}
          size={22}
          onPress={onToggleResize}
          testID="player-resize"
          accentColor={accentColor}
          onInteract={onInteract}
        />
      )}
      {Platform.OS === "web" && onToggleFullscreen && (
        <PlayerIconButton icon="resize-outline" size={22} onPress={onToggleFullscreen} testID="player-fullscreen" accentColor={accentColor} onInteract={onInteract} />
      )}
      <AirPlayButton onPress={onAirPlayUnavailable} testID="player-airplay" />
      {/* A TV box is the cast target itself; casting from it makes no sense. */}
      {Platform.OS !== "ios" && !isTV && (
        <CastButton onUnavailable={onCastUnavailable} testID="player-cast" />
      )}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: Platform.OS === "ios" ? 50 : 30,
    paddingBottom: spacing.xl,
  },
  rootTV: { paddingHorizontal: 56 - spacing.sm, paddingTop: 28 },
  titleBlock: { flex: 1 },
  title: { color: "#fff", fontSize: font.lg, fontWeight: "700" },
  subtitle: { color: "rgba(255,255,255,0.6)", fontSize: font.sm, fontWeight: "700", letterSpacing: 1 },
});
