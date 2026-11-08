import React, { useDeferredValue, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Platform, Pressable } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { useIPTV, currentEPG } from "@/src/store/iptv-store";
import { useProfiles } from "@/src/store/profile-store";
import { useI18n } from "@/src/store/i18n-store";
import { filterChannels } from "@/src/utils/content-filter";
import { sortLiveGroups } from "@/src/utils/sort-groups";
import { cleanChannelName } from "@/src/utils/clean-name";
import { useTheme } from "@/src/store/theme-store";
import { useResponsive } from "@/src/hooks/use-responsive";
import { colors, spacing, radius, font, screenBackground } from "@/src/theme/tokens";
import type { Channel } from "@/src/types/iptv";
import LiveTVDesktop from "@/src/components/LiveTVDesktop";
import { ChannelAvatar } from "@/src/components/ChannelAvatar";
import { prettyGroup } from "@/src/components/PhoneCategoryBar";
function CategoryChip({ g, activeGroup, setGroup, t, accentColor, ALL, FAVS }: any) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[
        styles.chip,
        activeGroup === g && { backgroundColor: accentColor, borderColor: accentColor },
        focused && { borderColor: accentColor, borderWidth: 2, transform: [{ scale: 1.05 }] }
      ]}
      onPress={() => setGroup(g)}
      testID={`group-chip-${g}`}
      focusable={true}
    >
      <Text style={[styles.chipText, activeGroup === g && styles.chipTextActive, focused && { color: "white" }]}>
        {g === ALL ? t("live.all") : g === FAVS ? t("live.favorites") : prettyGroup(g)}
      </Text>
    </Pressable>
  );
}

function ChannelRowItem({ item, index, epgByChannel, favorites, pushRecent, router, toggleFavorite, t, accentColor }: any) {
  const { current, next } = currentEPG(epgByChannel[item.epg_channel_id || ""]);
  const isFav = !!favorites[item.id];
  const [focused, setFocused] = useState(false);
  const [favFocused, setFavFocused] = useState(false);

  return (
    <Pressable
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[
        styles.channelRow,
        focused && { backgroundColor: "rgba(255,255,255,0.1)", borderRadius: radius.md, borderWidth: 2, borderColor: accentColor }
      ]}
      onPress={() => {
        pushRecent(item.id);
        router.push({ pathname: "/player", params: { url: item.url, title: item.name, kind: "live", itemId: item.id, logo: item.logo || "" } });
      }}
      testID={`channel-row-${item.id}`}
      focusable={true}
    >
      <Text style={styles.channelNum}>{item.number ? String(item.number).padStart(3, "0") : String(index + 1).padStart(3, "0")}</Text>
      <View style={styles.logoBox}>
        <ChannelAvatar
          name={item.name}
          logo={Platform.OS !== "web" ? item.logo : null}
          style={{ borderRadius: radius.sm }}
          imageStyle={styles.logoImg}
          textStyle={{ fontSize: 14 }}
        />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.chName} numberOfLines={1}>{cleanChannelName(item.name)}</Text>
        {current ? (
          <Text style={styles.chEpg} numberOfLines={1}>● {current.title}</Text>
        ) : (
          <Text style={styles.chEpgMuted} numberOfLines={1}>{item.group ? prettyGroup(item.group) : t("player.live")}</Text>
        )}
        {next && (
          <Text style={styles.chEpgNext} numberOfLines={1}>{t("common.next")}: {next.title}</Text>
        )}
      </View>
      <Pressable
        onFocus={() => setFavFocused(true)}
        onBlur={() => setFavFocused(false)}
        onPress={(e) => {
          e.stopPropagation();
          toggleFavorite({ item_id: item.id, kind: "live", name: item.name, logo: item.logo, url: item.url });
        }}
        hitSlop={10}
        testID={`channel-fav-${item.id}`}
        focusable={true}
        style={[favFocused && { backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 12, padding: 4 }]}
      >
        <Ionicons name={isFav ? "heart" : "heart-outline"} size={22} color={isFav ? accentColor : colors.textMuted} />
      </Pressable>
    </Pressable>
  );
}

const MemoizedChannelRowItem = React.memo(ChannelRowItem, (prev, next) => {
  const epgKey = prev.item.epg_channel_id || "";
  return prev.item.id === next.item.id &&
         prev.favorites[prev.item.id] === next.favorites[next.item.id] &&
         prev.epgByChannel[epgKey] === next.epgByChannel[epgKey] &&
         prev.accentColor === next.accentColor;
});

const ALL = "all";
const FAVS = "favs";

// Desktop and TV share the desktop Live TV layout (groups rail, preview + info, channel
// list with EPG grid); phones and tablets keep the compact list below.
export default function LiveTV() {
  const { isTV } = useResponsive();
  if (Platform.OS === "web" || isTV) return <LiveTVDesktop />;
  return <LiveTVMobile />;
}

function LiveTVMobile() {
  const router = useRouter();
  const playlist = useIPTV((s) => s.playlist);
  const epgByChannel = useIPTV((s) => s.epgByChannel);
  const favorites = useIPTV((s) => s.favorites);
  const toggleFavorite = useIPTV((s) => s.toggleFavorite);
  const pushRecent = useIPTV((s) => s.pushRecent);

  const [activeGroup, setActiveGroup] = useState<string>(ALL);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const activeProfile = useProfiles((s) => s.active());
  const blocked = useMemo(() => activeProfile?.blockedKeywords || [], [activeProfile?.blockedKeywords]);
  const { t } = useI18n();
  const { accentColor } = useTheme();
  const { isTVStyle } = useResponsive();

  const sortedLiveGroups = useMemo(
    () => sortLiveGroups(playlist?.groups.live || [], playlist?.channels || []),
    [playlist]
  );
  const groups = useMemo(() => [ALL, FAVS, ...sortedLiveGroups], [sortedLiveGroups]);

  useEffect(() => {
    if (!playlist) return;
    setActiveGroup(ALL);
  }, [playlist?.name]);

  const channels: Channel[] = useMemo(() => {
    if (!playlist) return [];
    let list = filterChannels(playlist.channels, blocked);
    if (activeGroup === FAVS) {
      list = list.filter((c) => favorites[c.id]);
    } else if (activeGroup !== ALL) {
      list = list.filter((c) => c.group === activeGroup);
    }
    if (deferredSearch.trim()) {
      const q = deferredSearch.toLowerCase();
      list = list.filter((c) => c.name.toLowerCase().includes(q));
    }
    return list;
  }, [playlist, activeGroup, favorites, deferredSearch, blocked]);

  if (!playlist) {
    return (
      <SafeAreaView style={styles.empty}>
        <Text style={styles.emptyText}>{t("home.no_playlist") || "Çalma listesi yüklenmedi"}</Text>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.root}>
      <SafeAreaView edges={["top"]} style={[styles.headerWrap, isTVStyle && { paddingTop: 100 }]}>
        {!isTVStyle && (
          <View style={styles.headerRow}>
          <Text style={styles.title}>{t("live.title")}</Text>
          <TouchableOpacity onPress={() => router.push("/epg")} testID="live-epg-button">
            <Ionicons name="calendar-outline" size={22} color={colors.onSurface} />
          </TouchableOpacity>
        </View>
        )}
        <View style={styles.searchBox}>
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <TextInput
            placeholder={t("live.search")}
            placeholderTextColor={colors.textMuted}
            value={search}
            onChangeText={setSearch}
            style={styles.searchInput}
            testID="live-search-input"
          />
        </View>
        <FlashList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={groups}
          keyExtractor={(g) => g}
          // @ts-ignore
          estimatedItemSize={120}
          style={styles.chipsScroll}
          contentContainerStyle={styles.chipsRow}
          renderItem={({ item: g }) => (
            <CategoryChip key={g} g={g} activeGroup={activeGroup} setGroup={setActiveGroup} t={t} accentColor={accentColor} ALL={ALL} FAVS={FAVS} />
          )}
        />
      </SafeAreaView>

      <FlashList
        data={channels}
        keyExtractor={(i) => i.id}
        // @ts-ignore
        estimatedItemSize={52}
        contentContainerStyle={{ paddingBottom: 140, paddingTop: spacing.sm }}
        ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: colors.divider, marginLeft: 68 }} />}
        renderItem={({ item, index }) => (
          <MemoizedChannelRowItem
            item={item}
            index={index}
            epgByChannel={epgByChannel}
            favorites={favorites}
            pushRecent={pushRecent}
            router={router}
            toggleFavorite={toggleFavorite}
            t={t}
            accentColor={accentColor}
          />
        )}
        ListEmptyComponent={
          <View style={styles.emptyList}>
            <Text style={styles.emptyText}>{t("live.no_results")}</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: screenBackground },
  empty: { flex: 1, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  emptyList: { padding: spacing.xxl, alignItems: "center" },
  emptyText: { color: colors.textMuted },
  headerWrap: { backgroundColor: colors.surface, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: spacing.sm, marginBottom: spacing.md },
  title: { color: colors.onSurface, fontSize: font.xxl, fontWeight: "800" },
  searchBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: 10, marginBottom: spacing.md,
  },
  searchInput: { flex: 1, color: colors.onSurface, fontSize: font.base, padding: 0 },
  chipsScroll: { height: 56 },
  chipsRow: { gap: spacing.sm, paddingRight: spacing.lg },
  chip: {
    paddingHorizontal: spacing.lg, height: 36, justifyContent: "center",
    borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary,
    borderWidth: 2, borderColor: colors.border, flexShrink: 0,
  },
  chipText: { color: colors.onSurfaceSecondary, fontSize: font.sm, fontWeight: "600" },
  chipTextActive: { color: colors.onBrandPrimary },
  channelRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: 6, borderWidth: 2, borderColor: "transparent" },
  channelNum: { color: colors.textMuted, fontSize: font.sm, width: 32, fontVariant: ["tabular-nums"] },
  logoBox: { width: 36, height: 36, borderRadius: radius.sm, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  logoImg: { width: "75%", height: "75%" },
  chName: { color: colors.onSurface, fontSize: font.base, fontWeight: "600" },
  chEpg: { color: colors.success, fontSize: 12, marginTop: 1 },
  chEpgMuted: { color: colors.textMuted, fontSize: 12, marginTop: 1 },
  chEpgNext: { color: colors.textMuted, fontSize: 11, marginTop: 1 },
});
