import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, TextInput, FlatList, Platform, BackHandler } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { useIPTV } from "@/src/store/iptv-store";
import { useProfiles } from "@/src/store/profile-store";
import { useTheme } from "@/src/store/theme-store";
import { filterChannels } from "@/src/utils/content-filter";
import { cleanChannelName } from "@/src/utils/clean-name";
import { ChannelAvatar } from "@/src/components/ChannelAvatar";
import { FocusPressable } from "@/src/components/FocusPressable";
import MiniPlayer from "@/src/components/MiniPlayer";
import { colors, spacing, radius, font } from "@/src/theme/tokens";
import type { Channel } from "@/src/types/iptv";

// Multi-view: two or four live channels at once (match days). Only the selected
// tile plays sound. Each tile is its own stream connection, so a provider that
// allows a single connection will only play the first tile.

const STORAGE_KEY = "iptv.multiview.v1";
type Layout = 2 | 4;

function buildWebVideoUrl(rawUrl: string) {
  const uri = String(rawUrl || "");
  if (Platform.OS !== "web" || !uri.includes("/api/play/") || uri.includes("proxy=1")) return uri;
  return `${uri}${uri.includes("?") ? "&" : "?"}proxy=1`;
}

export default function MultiView() {
  const router = useRouter();
  const { accentColor } = useTheme();
  const playlist = useIPTV((s) => s.playlist);
  const favorites = useIPTV((s) => s.favorites);
  const recentChannels = useIPTV((s) => s.recentChannels);
  const pushRecent = useIPTV((s) => s.pushRecent);
  const activeProfile = useProfiles((s) => s.active());
  const blocked = useMemo(() => activeProfile?.blockedKeywords || [], [activeProfile?.blockedKeywords]);

  const channels = useMemo(() => (playlist ? filterChannels(playlist.channels, blocked) : []), [playlist, blocked]);
  const byId = useMemo(() => new Map(channels.map((c) => [c.id, c])), [channels]);

  const [layout, setLayout] = useState<Layout>(4);
  const [slots, setSlots] = useState<(string | null)[]>([null, null, null, null]);
  const [active, setActive] = useState(0);
  const [picker, setPicker] = useState<number | null>(null);
  const [restored, setRestored] = useState(false);

  // Streams must stop when this screen is covered (full-screen player) so the
  // provider's connection limit isn't used up in the background.
  const isFocused = useIsFocused();
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (isFocused) setLeaving(false);
  }, [isFocused]);
  const streaming = isFocused && !leaving;

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!raw) return;
        const saved = JSON.parse(raw);
        if (saved.layout === 2 || saved.layout === 4) setLayout(saved.layout);
        if (Array.isArray(saved.slots)) setSlots([0, 1, 2, 3].map((i) => saved.slots[i] ?? null));
      })
      .catch(() => {})
      .finally(() => setRestored(true));
  }, []);
  useEffect(() => {
    if (restored) AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ layout, slots })).catch(() => {});
  }, [layout, slots, restored]);

  // Hardware back / Escape closes the channel picker first.
  useEffect(() => {
    if (picker === null) return;
    if (Platform.OS === "web") {
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") setPicker(null);
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setPicker(null);
      return true;
    });
    return () => sub.remove();
  }, [picker]);

  const visibleSlots = slots.slice(0, layout);
  useEffect(() => {
    if (active >= layout) setActive(0);
  }, [active, layout]);

  const assign = (slot: number, ch: Channel) => {
    setSlots((prev) => prev.map((id, i) => (i === slot ? ch.id : id)));
    setActive(slot);
    setPicker(null);
    pushRecent(ch.id);
  };
  const clearSlot = (slot: number) => setSlots((prev) => prev.map((id, i) => (i === slot ? null : id)));

  const onTilePress = (i: number) => {
    if (!slots[i] || i === active) setPicker(i);
    else setActive(i);
  };

  const openFullscreen = (ch: Channel) => {
    const go = () =>
      router.push({ pathname: "/player", params: { url: ch.url, title: ch.name, kind: "live", itemId: ch.id, logo: ch.logo || "" } });
    setLeaving(true); // release every tile's connection before the player connects
    setTimeout(go, Platform.OS === "web" ? 50 : 300);
  };

  const activeChannel = slots[active] ? byId.get(slots[active]!) : undefined;

  const rows = layout === 2 ? [[0, 1]] : [[0, 1], [2, 3]];

  return (
    <View style={styles.root}>
      <SafeAreaView edges={["top"]} style={styles.header}>
        <FocusPressable
          onPress={() => router.back()}
          style={({ focused }: any) => [styles.iconBtn, focused && { borderColor: accentColor }]}
          testID="multiview-back"
        >
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </FocusPressable>
        <Text style={styles.title}>Çoklu Ekran</Text>
        <View style={styles.segment}>
          {([2, 4] as Layout[]).map((n) => (
            <FocusPressable
              key={n}
              onPress={() => setLayout(n)}
              style={({ focused }: any) => [
                styles.segmentItem,
                layout === n && { backgroundColor: accentColor },
                focused && { borderColor: "#fff" },
              ]}
              testID={`multiview-layout-${n}`}
            >
              <Ionicons name={n === 2 ? "tablet-landscape-outline" : "grid-outline"} size={16} color="#fff" />
              <Text style={styles.segmentText}>{n}</Text>
            </FocusPressable>
          ))}
        </View>
        <View style={{ flex: 1 }} />
        {activeChannel && (
          <View style={styles.toolbar}>
            <ToolButton icon="swap-horizontal" label="Değiştir" onPress={() => setPicker(active)} accent={accentColor} />
            <ToolButton icon="expand" label="Tam ekran" onPress={() => openFullscreen(activeChannel)} accent={accentColor} />
            <ToolButton icon="close" label="Kaldır" onPress={() => clearSlot(active)} accent={accentColor} />
          </View>
        )}
      </SafeAreaView>

      <View style={styles.grid}>
        {rows.map((row, r) => (
          <View key={r} style={styles.row}>
            {row.map((i) => {
              const ch = visibleSlots[i] ? byId.get(visibleSlots[i]!) : undefined;
              const isActive = i === active;
              return (
                <FocusPressable
                  key={i}
                  onPress={() => onTilePress(i)}
                  style={({ focused }: any) => [
                    styles.tile,
                    isActive && ch && { borderColor: accentColor },
                    focused && { borderColor: "#fff" },
                  ]}
                  testID={`multiview-tile-${i}`}
                >
                  {ch ? (
                    <>
                      {streaming && <MiniPlayer src={buildWebVideoUrl(ch.url)} isPlaying muted={!isActive} />}
                      <View style={styles.tileLabel} pointerEvents="none">
                        <Ionicons name={isActive ? "volume-high" : "volume-mute"} size={14} color={isActive ? accentColor : colors.textMuted} />
                        <Text style={styles.tileLabelText} numberOfLines={1}>{cleanChannelName(ch.name)}</Text>
                      </View>
                    </>
                  ) : (
                    <View style={styles.empty} pointerEvents="none">
                      <Ionicons name="add-circle-outline" size={36} color={colors.textMuted} />
                      <Text style={styles.emptyText}>Kanal ekle</Text>
                    </View>
                  )}
                </FocusPressable>
              );
            })}
          </View>
        ))}
      </View>

      <Text style={styles.hint}>
        Sesi duymak için bir ekranı seç; seçili ekrana tekrar basınca kanal değişir. Her ekran ayrı bağlantı kullanır — sağlayıcın tek bağlantıya izin veriyorsa yalnızca bir ekran oynar.
      </Text>

      {picker !== null && (
        <ChannelPicker
          channels={channels}
          favorites={favorites}
          recent={recentChannels}
          accentColor={accentColor}
          onPick={(ch) => assign(picker, ch)}
          onClose={() => setPicker(null)}
        />
      )}
    </View>
  );
}

function ToolButton({ icon, label, onPress, accent }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; accent: string }) {
  return (
    <FocusPressable
      onPress={onPress}
      style={({ focused }: any) => [styles.toolBtn, focused && { borderColor: accent, backgroundColor: "rgba(255,255,255,0.12)" }]}
      testID={`multiview-tool-${icon}`}
    >
      <Ionicons name={icon} size={16} color="#fff" />
      <Text style={styles.toolText}>{label}</Text>
    </FocusPressable>
  );
}

function ChannelPicker({
  channels,
  favorites,
  recent,
  accentColor,
  onPick,
  onClose,
}: {
  channels: Channel[];
  favorites: Record<string, unknown>;
  recent: string[];
  accentColor: string;
  onPick: (ch: Channel) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (query) return channels.filter((c) => c.name.toLowerCase().includes(query));
    // Favourites and recently watched first, then everything else.
    const rank = new Map<string, number>();
    recent.forEach((id, i) => rank.set(id, i));
    const top = channels
      .filter((c) => favorites[c.id] || rank.has(c.id))
      .sort((a, b) => (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999));
    const topIds = new Set(top.map((c) => c.id));
    return [...top, ...channels.filter((c) => !topIds.has(c.id))];
  }, [channels, favorites, recent, q]);

  return (
    <View style={styles.pickerBackdrop}>
      <View style={styles.picker}>
        <View style={styles.pickerHeader}>
          <Text style={styles.pickerTitle}>Kanal seç</Text>
          <FocusPressable
            onPress={onClose}
            style={({ focused }: any) => [styles.iconBtn, focused && { borderColor: accentColor }]}
            testID="multiview-picker-close"
          >
            <Ionicons name="close" size={20} color="#fff" />
          </FocusPressable>
        </View>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={16} color={colors.textMuted} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Kanal ara…"
            placeholderTextColor={colors.textMuted}
            style={styles.searchInput}
            autoFocus={Platform.OS === "web"}
          />
        </View>
        <FlatList
          data={list}
          keyExtractor={(c) => c.id}
          initialNumToRender={20}
          windowSize={7}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item, index }) => (
            <FocusPressable
              hasTVPreferredFocus={Platform.isTV && (index === 0)}
              onPress={() => onPick(item)}
              style={({ focused, hovered }: any) => [
                styles.pickRow,
                (focused || hovered) && { backgroundColor: "rgba(255,255,255,0.08)" },
                focused && { borderLeftColor: accentColor },
              ]}
            >
              <View style={styles.pickLogo}>
                <ChannelAvatar name={item.name} logo={item.logo} textStyle={{ fontSize: 11 }} />
              </View>
              <Text style={styles.pickName} numberOfLines={1}>{cleanChannelName(item.name)}</Text>
              {!!favorites[item.id] && <Ionicons name="heart" size={14} color={accentColor} />}
            </FocusPressable>
          )}
          ListEmptyComponent={<Text style={styles.pickEmpty}>Kanal bulunamadı.</Text>}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  header: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  iconBtn: { padding: 6, borderRadius: radius.md, borderWidth: 2, borderColor: "transparent" },
  title: { color: "#fff", fontSize: font.xl, fontWeight: "800" },
  segment: { flexDirection: "row", gap: 4, backgroundColor: colors.surfaceSecondary, borderRadius: radius.pill, padding: 3 },
  segmentItem: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 5, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 2, borderColor: "transparent" },
  segmentText: { color: "#fff", fontWeight: "700", fontSize: font.sm },
  toolbar: { flexDirection: "row", gap: spacing.sm },
  toolBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderWidth: 2, borderColor: "transparent" },
  toolText: { color: "#fff", fontSize: font.sm, fontWeight: "600" },
  grid: { flex: 1, gap: 4, padding: 4 },
  row: { flex: 1, flexDirection: "row", gap: 4 },
  tile: { flex: 1, backgroundColor: "#0A0A0A", borderRadius: radius.sm, overflow: "hidden", borderWidth: 2, borderColor: "transparent" },
  tileLabel: { position: "absolute", left: 8, bottom: 8, maxWidth: "80%", flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(0,0,0,0.65)", paddingVertical: 4, paddingHorizontal: 8, borderRadius: radius.sm },
  tileLabelText: { color: "#fff", fontSize: font.sm, fontWeight: "700", flexShrink: 1 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 6 },
  emptyText: { color: colors.textMuted, fontSize: font.base, fontWeight: "600" },
  hint: { color: colors.textMuted, fontSize: 11, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  pickerBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.7)", alignItems: "center", justifyContent: "center", padding: spacing.lg },
  picker: { width: "100%", maxWidth: 520, height: "90%", backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.borderStrong, overflow: "hidden" },
  pickerHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  pickerTitle: { color: "#fff", fontSize: font.lg, fontWeight: "800" },
  searchBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.border, margin: spacing.md, paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.md },
  // @ts-ignore web-only outline reset
  searchInput: { flex: 1, color: colors.onSurface, fontSize: font.base, padding: 0, outlineStyle: "none" as any },
  pickRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: 8, paddingHorizontal: spacing.lg, borderLeftWidth: 3, borderLeftColor: "transparent" },
  pickLogo: { width: 32, height: 32, borderRadius: 4, overflow: "hidden" },
  pickName: { flex: 1, color: colors.onSurface, fontSize: font.base, fontWeight: "600" },
  pickEmpty: { color: colors.textMuted, textAlign: "center", padding: spacing.xl },
});
