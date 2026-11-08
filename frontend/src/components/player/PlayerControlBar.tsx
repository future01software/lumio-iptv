import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Slider from "@react-native-community/slider";

import { PlayerIconButton } from "./PlayerIconButton";
import { PlayerMoreMenu, MoreMenuAction } from "./PlayerMoreMenu";
import { BOTTOM_GRADIENT, BOTTOM_GRADIENT_TV } from "./styles";
import { spacing, font } from "@/src/theme/tokens";
import { useResponsive } from "@/src/hooks/use-responsive";

type Props = {
  isLive: boolean;
  current: number;
  duration: number;
  formatTime: (t: number) => string;
  onScrubbing: (value: number) => void;
  onScrubComplete: (value: number) => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onSeekBack: () => void;
  onSeekForward: () => void;
  prevIcon: React.ComponentProps<typeof PlayerIconButton>["icon"];
  nextIcon: React.ComponentProps<typeof PlayerIconButton>["icon"];
  accentColor: string;
  onInteract: () => void;
  /** Secondary actions (channels, tracks, speed, lock, sleep, pip, info). Inline on TV/desktop, collapsed behind "more" on phones. */
  actions: MoreMenuAction[];
  collapseActions: boolean;
  moreOpen: boolean;
  onToggleMore: () => void;
  /** Desktop/web: mute button + volume slider. Omitted on native (hardware keys). */
  volume?: { value: number; muted: boolean; onChange: (v: number) => void; onToggleMute: () => void };
};

export function volumeIcon(value: number, muted: boolean) {
  if (muted || value === 0) return "volume-mute" as const;
  if (value < 0.34) return "volume-low" as const;
  if (value < 0.67) return "volume-medium" as const;
  return "volume-high" as const;
}

export function PlayerControlBar({
  isLive,
  current,
  duration,
  formatTime,
  onScrubbing,
  onScrubComplete,
  isPlaying,
  onTogglePlay,
  onSeekBack,
  onSeekForward,
  prevIcon,
  nextIcon,
  accentColor,
  onInteract,
  actions,
  collapseActions,
  moreOpen,
  onToggleMore,
  volume,
}: Props) {
  const { isTV } = useResponsive();
  // Play/Pause takes focus when the controls appear, then lets go. Left on, every re-render
  // (e.g. the resize label changing after a press) yanked focus back to Play/Pause, so the
  // next OK press hit the wrong button.
  const [preferPlay, setPreferPlay] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setPreferPlay(false), 500);
    return () => clearTimeout(t);
  }, []);
  const seekRow = !isLive && (
    <View style={styles.seekRow}>
      <Text style={[styles.time, isTV && styles.timeTV]}>{formatTime(current)}</Text>
      <Slider
        style={styles.slider}
        minimumValue={0}
        maximumValue={duration || 1}
        value={current}
        minimumTrackTintColor={accentColor}
        maximumTrackTintColor="rgba(255,255,255,0.25)"
        thumbTintColor={accentColor}
        onValueChange={onScrubbing}
        onSlidingComplete={onScrubComplete}
      />
      <Text style={[styles.time, isTV && styles.timeTV]}>{formatTime(duration)}</Text>
    </View>
  );
  return (
    <LinearGradient
      colors={(isTV ? BOTTOM_GRADIENT_TV : BOTTOM_GRADIENT) as any}
      style={[styles.root, isTV && styles.rootTV]}
      pointerEvents="box-none"
    >
      {isTV && seekRow}

      <View style={styles.transportRow}>
        <PlayerIconButton icon={prevIcon} size={30} onPress={onSeekBack} testID="player-seek-back" accentColor={accentColor} onInteract={onInteract} />
        <PlayerIconButton
          icon={isPlaying ? "pause" : "play"}
          size={36}
          bg={accentColor}
          onPress={onTogglePlay}
          testID="player-play-toggle"
          accentColor={accentColor}
          hasTVPreferredFocus={Platform.isTV && preferPlay}
          onInteract={onInteract}
        />
        <PlayerIconButton icon={nextIcon} size={30} onPress={onSeekForward} testID="player-seek-fwd" accentColor={accentColor} onInteract={onInteract} />
      </View>

      {/* Phones/desktop: seek bar under the transport, like most mobile players; TV keeps it on top. */}
      {!isTV && seekRow}

      <View style={styles.actionsRow}>
        {volume && (
          <View style={styles.volumeCluster}>
            <PlayerIconButton
              icon={volumeIcon(volume.value, volume.muted)}
              onPress={volume.onToggleMute}
              testID="player-mute"
              accentColor={accentColor}
              onInteract={onInteract}
            />
            <Slider
              style={styles.volumeSlider}
              minimumValue={0}
              maximumValue={1}
              value={volume.muted ? 0 : volume.value}
              minimumTrackTintColor={accentColor}
              maximumTrackTintColor="rgba(255,255,255,0.25)"
              thumbTintColor="#fff"
              onValueChange={(v) => {
                onInteract();
                volume.onChange(v);
              }}
              testID="player-volume"
            />
          </View>
        )}
        {collapseActions ? (
          <PlayerIconButton icon="ellipsis-horizontal" onPress={onToggleMore} testID="player-more" accentColor={accentColor} onInteract={onInteract} />
        ) : (
          actions.map((a) => (
            <PlayerIconButton
              key={a.key}
              icon={a.icon}
              label={a.label}
              active={a.active}
              disabled={a.disabled}
              onPress={a.onPress}
              onInteract={onInteract}
              testID={a.testID}
              accentColor={accentColor}
            />
          ))
        )}
      </View>

      {collapseActions && (
        <PlayerMoreMenu
          visible={moreOpen}
          actions={actions}
          accentColor={accentColor}
          onInteract={onInteract}
        />
      )}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  volumeCluster: { flexDirection: "row", alignItems: "center", marginRight: "auto" },
  volumeSlider: { width: 110, height: 32 },
  root: { paddingHorizontal: spacing.lg, paddingBottom: 32, paddingTop: spacing.xxl, gap: spacing.md },
  seekRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  slider: { flex: 1, height: 40 },
  time: { color: "#fff", fontSize: font.sm, fontVariant: ["tabular-nums"] },
  // TV: keep the controls off the screen edges (overscan, couch distance) and readable.
  rootTV: { paddingHorizontal: 56, paddingBottom: 28, paddingTop: 120, gap: spacing.sm },
  timeTV: { fontSize: font.lg, fontWeight: "600", minWidth: 72, textAlign: "center" },
  transportRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xxl },
  actionsRow: { flexDirection: "row", justifyContent: "space-around" },
});
