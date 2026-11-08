import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, FlatList, ScrollView, Platform } from "react-native";
import { BlurView } from "expo-blur";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";

import { glassPanel } from "./styles";
import { spacing, font, radius } from "@/src/theme/tokens";
import type { SeriesEpisode } from "@/src/types/iptv";

type Progress = { position: number; duration: number };

type Props = {
  open: boolean;
  onClose: () => void;
  episodes: SeriesEpisode[];
  currentId?: string;
  progress: Record<string, Progress>;
  fallbackLogo?: string;
  onSelect: (ep: SeriesEpisode) => void;
  accentColor: string;
};

const ROW_H = 84;

// Nuvio's PlayerEpisodesPanel / NuvioTV EpisodesSidePanel: pick another episode
// without leaving the player. Opens on the current season, scrolled to the
// current episode, with watch progress on each thumbnail.
export function PlayerEpisodesPanel({ open, onClose, episodes, currentId, progress, fallbackLogo, onSelect, accentColor }: Props) {
  const seasons = useMemo(() => Array.from(new Set(episodes.map((e) => e.season))).sort((a, b) => a - b), [episodes]);
  const currentSeason = episodes.find((e) => e.id === currentId)?.season ?? seasons[0] ?? 1;
  const [season, setSeason] = useState(currentSeason);
  useEffect(() => {
    if (open) setSeason(currentSeason);
  }, [open, currentSeason]);

  const list = useMemo(() => episodes.filter((e) => e.season === season), [episodes, season]);
  const currentIndex = list.findIndex((e) => e.id === currentId);
  const listRef = useRef<FlatList<SeriesEpisode>>(null);

  if (!open) return null;

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <Pressable style={styles.backdrop} onPress={onClose} />
      <SafeAreaView edges={["top", "bottom"]} style={styles.panel}>
        <BlurView intensity={glassPanel.blurIntensity} tint={glassPanel.blurTint} style={StyleSheet.absoluteFillObject} />
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Bölümler</Text>
          <Pressable onPress={onClose} hitSlop={10} focusable testID="episodes-close">
            <Ionicons name="close" size={22} color="#fff" />
          </Pressable>
        </View>

        {seasons.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.seasons}>
            {seasons.map((s) => (
              <Pressable
                key={s}
                onPress={() => setSeason(s)}
                focusable
                style={({ focused, hovered }: any) => [
                  styles.seasonChip,
                  s === season && { backgroundColor: accentColor },
                  (focused || hovered) && s !== season && { borderColor: "#fff" },
                ]}
              >
                <Text style={[styles.seasonText, s === season && { color: "#fff" }]}>Sezon {s}</Text>
              </Pressable>
            ))}
          </ScrollView>
        )}

        <FlatList
          ref={listRef}
          data={list}
          keyExtractor={(e) => String(e.id)}
          initialScrollIndex={currentIndex > 2 ? currentIndex - 1 : undefined}
          getItemLayout={(_, index) => ({ length: ROW_H, offset: ROW_H * index, index })}
          initialNumToRender={12}
          windowSize={7}
          removeClippedSubviews={Platform.OS === "android"}
          renderItem={({ item }) => {
            const isCurrent = item.id === currentId;
            const p = progress[item.id];
            const pct = p && p.duration > 0 ? Math.min(1, p.position / p.duration) : 0;
            const watched = pct > 0.92;
            return (
              <Pressable
                focusable
                // @ts-ignore - TV only
                hasTVPreferredFocus={Platform.isTV && isCurrent}
                onPress={() => onSelect(item)}
                style={({ focused, hovered }: any) => [
                  styles.row,
                  isCurrent && { backgroundColor: "rgba(255,255,255,0.1)" },
                  (focused || hovered) && { borderColor: accentColor, backgroundColor: "rgba(255,255,255,0.14)" },
                ]}
                testID={`episode-${item.id}`}
              >
                <View style={styles.thumb}>
                  {item.logo || fallbackLogo ? (
                    <Image source={{ uri: item.logo || fallbackLogo }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
                  ) : (
                    <Ionicons name="film-outline" size={22} color="rgba(255,255,255,0.4)" />
                  )}
                  {isCurrent && (
                    <View style={styles.nowPlaying}>
                      <Ionicons name="play" size={18} color="#fff" />
                    </View>
                  )}
                  {pct > 0 && !watched && (
                    <View style={styles.progressTrack}>
                      <View style={[styles.progressFill, { width: `${pct * 100}%`, backgroundColor: accentColor }]} />
                    </View>
                  )}
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[styles.epNum, isCurrent && { color: accentColor }]}>
                    {isCurrent ? "OYNATILIYOR · " : ""}B{item.episode}
                  </Text>
                  <Text style={styles.epTitle} numberOfLines={2}>
                    {item.title}
                  </Text>
                </View>
                {watched && <Ionicons name="checkmark-circle" size={18} color={accentColor} />}
              </Pressable>
            );
          }}
        />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, flexDirection: "row", justifyContent: "flex-end", zIndex: 30 },
  backdrop: { flex: 1 },
  panel: { width: 400, maxWidth: "90%", height: "100%", overflow: "hidden", borderLeftWidth: 1, borderLeftColor: "rgba(255,255,255,0.12)" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.1)",
  },
  headerTitle: { color: "#fff", fontSize: font.lg, fontWeight: "bold" },
  seasons: { gap: 8, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  seasonChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "transparent",
  },
  seasonText: { color: "rgba(255,255,255,0.75)", fontWeight: "600", fontSize: font.sm },
  row: {
    height: ROW_H,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: spacing.md,
    borderWidth: 2,
    borderColor: "transparent",
    borderRadius: 12,
  },
  thumb: {
    width: 112,
    height: 63,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  nowPlaying: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center" },
  progressTrack: { position: "absolute", left: 0, right: 0, bottom: 0, height: 3, backgroundColor: "rgba(255,255,255,0.25)" },
  progressFill: { height: 3 },
  epNum: { color: "rgba(255,255,255,0.55)", fontSize: 11, fontWeight: "800", letterSpacing: 0.6 },
  epTitle: { color: "#fff", fontSize: font.base, fontWeight: "500" },
});
