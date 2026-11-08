import React from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Pressable } from "react-native";
import { BlurView } from "expo-blur";
import { Ionicons } from "@expo/vector-icons";

import { glassPanel } from "./styles";
import { spacing, font } from "@/src/theme/tokens";

type Track = { id?: string | number; language?: string; label?: string };

type Props = {
  visible: boolean;
  onClose: () => void;
  audioTracks: Track[];
  subtitleTracks: Track[];
  selectedAudioId?: string | number | null;
  selectedSubtitleId?: string | number | null;
  onSelectAudio: (track: Track) => void;
  onSelectSubtitle: (track: Track | null) => void;
  accentColor: string;
};

/**
 * Audio/subtitle picker, restyled as a floating frosted panel anchored
 * bottom-right (Stremio's SubtitlesMenu/AudioMenu) instead of a full-screen
 * centered Modal — leaves most of the video visible while it's open.
 */
export function PlayerTracksPanel({
  visible,
  onClose,
  audioTracks,
  subtitleTracks,
  selectedAudioId,
  selectedSubtitleId,
  onSelectAudio,
  onSelectSubtitle,
  accentColor,
}: Props) {
  if (!visible) return null;
  return (
    <>
      <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
      <BlurView intensity={glassPanel.blurIntensity} tint={glassPanel.blurTint} style={styles.panel}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Dil & Altyazı</Text>
          <TouchableOpacity onPress={onClose} hitSlop={10}>
            <Ionicons name="close-circle" size={24} color="rgba(255,255,255,0.7)" />
          </TouchableOpacity>
        </View>
        <View style={styles.columns}>
          <View style={styles.column}>
            <Text style={styles.sectionTitle}>Ses (Dublaj)</Text>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
              {audioTracks.length > 0 ? audioTracks.map((tr, index) => (
                <TouchableOpacity key={tr.id ?? tr.language ?? tr.label ?? `audio-${index}`} style={styles.row} onPress={() => onSelectAudio(tr)}>
                  <Text style={[styles.rowText, selectedAudioId === tr.id && { color: accentColor }]}>{tr.label || tr.language || "Bilinmiyor"}</Text>
                  {selectedAudioId === tr.id && <Ionicons name="checkmark" size={18} color={accentColor} />}
                </TouchableOpacity>
              )) : <Text style={styles.empty}>Seçenek yok</Text>}
            </ScrollView>
          </View>
          <View style={styles.divider} />
          <View style={styles.column}>
            <Text style={styles.sectionTitle}>Altyazı</Text>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
              <TouchableOpacity style={styles.row} onPress={() => onSelectSubtitle(null)}>
                <Text style={[styles.rowText, !selectedSubtitleId && { color: accentColor }]}>Kapalı</Text>
                {!selectedSubtitleId && <Ionicons name="checkmark" size={18} color={accentColor} />}
              </TouchableOpacity>
              {subtitleTracks.map((tr, index) => (
                <TouchableOpacity key={tr.id ?? tr.language ?? tr.label ?? `subtitle-${index}`} style={styles.row} onPress={() => onSelectSubtitle(tr)}>
                  <Text style={[styles.rowText, selectedSubtitleId === tr.id && { color: accentColor }]}>{tr.label || tr.language || "Bilinmiyor"}</Text>
                  {selectedSubtitleId === tr.id && <Ionicons name="checkmark" size={18} color={accentColor} />}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </BlurView>
    </>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: "absolute",
    right: 32,
    bottom: 120,
    width: 440,
    maxWidth: "85%",
    height: 300,
    overflow: "hidden",
    ...(glassPanel as any),
  },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.1)" },
  headerTitle: { color: "#fff", fontSize: font.lg, fontWeight: "700" },
  columns: { flexDirection: "row", flex: 1 },
  column: { flex: 1, padding: spacing.lg },
  divider: { width: 1, backgroundColor: "rgba(255,255,255,0.1)" },
  sectionTitle: { color: "rgba(255,255,255,0.6)", fontSize: font.sm, fontWeight: "700", marginBottom: spacing.md, textTransform: "uppercase", letterSpacing: 1 },
  list: { paddingBottom: 20 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.05)" },
  rowText: { color: "#fff", fontSize: font.base, fontWeight: "500" },
  empty: { color: "rgba(255,255,255,0.4)", fontStyle: "italic", marginTop: spacing.md },
});
