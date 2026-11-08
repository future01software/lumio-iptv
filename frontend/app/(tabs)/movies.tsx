import React, { useMemo, useState, useDeferredValue } from "react";
import { View, Text, StyleSheet, TextInput, Platform, Pressable, ActivityIndicator, FlatList } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { FocusMemoryScope, useRememberedFocus } from "@/src/hooks/use-focus-memory";
import type { Movie } from "@/src/types/iptv";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { useIPTV } from "@/src/store/iptv-store";
import { useProfiles } from "@/src/store/profile-store";
import { useResponsive } from "@/src/hooks/use-responsive";
import { useI18n } from "@/src/store/i18n-store";
import { useTheme } from "@/src/store/theme-store";
import { filterMovies } from "@/src/utils/content-filter";
import { PosterArt, FocusRing, CARD_GUTTER } from "@/src/components/PosterArt";
import { CategoryItem } from "@/src/components/CategoryItem";
import { PhoneCategoryBar, prettyGroup } from "@/src/components/PhoneCategoryBar";
import { focusScale } from "@/src/utils/perf";
import { colors, spacing, radius, font, screenBackground } from "@/src/theme/tokens";
import { cleanIPTVName } from "@/src/utils/clean-name";

const MemoizedMovieCard = React.memo(MovieCard, (prev, next) => {
  return prev.item.id === next.item.id && prev.COL === next.COL && prev.GAP === next.GAP && prev.gutter === next.gutter;
});

const ALL = "all";

// Web/Electron: FlashList v2 keeps every cell it ever created in its recycle
// pool, so one bad measurement (e.g. mid-resize) left all ~1600 posters mounted
// and the whole app sluggish. RN-web's FlatList really unmounts off-screen rows.
const IS_WEB = Platform.OS === "web";
const PosterGrid: any = IS_WEB ? FlatList : FlashList;
const WEB_GRID_PROPS = (cols: number) => ({
  initialNumToRender: cols * 4,
  maxToRenderPerBatch: cols * 2,
  windowSize: 5,
  removeClippedSubviews: true,
});

function MovieCard({ item, router, COL, GAP, gutter = CARD_GUTTER }: any) {
  const [focused, setFocused] = useState(false);
  const { hasTVPreferredFocus, onFocusRemember } = useRememberedFocus(item.id);
  return (
    <View style={{ width: "100%", paddingVertical: GAP / 2, paddingHorizontal: gutter }}>
      <Pressable
        onFocus={() => { setFocused(true); onFocusRemember(); }}
        onBlur={() => setFocused(false)}
        onPress={() => router.push({ pathname: "/movie/[id]", params: { id: item.id } })}
        style={[{ width: "100%", aspectRatio: 2/3 }, focused && { transform: [{ scale: focusScale(1.05) }] }]}
        focusable={true}
        hasTVPreferredFocus={hasTVPreferredFocus}
      >
        <PosterArt uri={item.logo} title={cleanIPTVName(item.name)} recyclingKey={item.id} />
        <FocusRing visible={focused} />
      </Pressable>
      <Text style={[styles.cardName, focused && styles.cardNameFocused]} numberOfLines={2}>{cleanIPTVName(item.name)}</Text>
    </View>
  );
}

export default function Movies() {
  const router = useRouter();
  const playlist = useIPTV((s) => s.playlist);
  const vodsLoading = useIPTV((s) => s.vodsLoading);
  const { width, posterCols, isTVStyle, isPhone } = useResponsive();
  const GUTTER = isPhone ? 6 : CARD_GUTTER;
  const { t } = useI18n();
  const { accentColor } = useTheme();
  const COL = posterCols;
  const GAP = spacing.md;
  const [group, setGroup] = useState(ALL);
  const [search, setSearch] = useState("");
  const activeProfile = useProfiles((s) => s.active());
  const blocked = useMemo(() => activeProfile?.blockedKeywords || [], [activeProfile?.blockedKeywords]);

  const groups = useMemo(() => [ALL, ...(playlist?.groups.movie || [])], [playlist]);

  const deferredSearch = useDeferredValue(search);

  const movies = useMemo(() => {
    if (!playlist) return [];
    let list = filterMovies(playlist.movies, blocked);
    if (group !== ALL) list = list.filter((m) => m.group === group);
    if (deferredSearch.trim()) {
      const q = deferredSearch.toLowerCase();
      list = list.filter((m) => m.name.toLowerCase().includes(q));
    }
    return list;
  }, [playlist, group, deferredSearch, blocked]);

  if (!playlist) {
    return (
      <SafeAreaView style={styles.empty}><Text style={styles.emptyText}>{t("home.no_playlist") || "Çalma listesi yok"}</Text></SafeAreaView>
    );
  }

  return (
    <FocusMemoryScope screenKey="movies">
    <View style={[styles.container, isPhone && { flexDirection: "column" }]}>
      {/* SIDEBAR (TV/tablet/desktop; phones get PhoneCategoryBar) */}
      {!isPhone && (
      <View style={styles.sidebar}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={16} color={colors.textMuted} />
          <TextInput
            placeholder={t("movies.search")}
            placeholderTextColor={colors.textMuted}
            value={search}
            onChangeText={setSearch}
            style={styles.searchInput}
          />
        </View>
        <FlatList
          data={groups}
          keyExtractor={(g) => g}
          renderItem={({ item: g }) => {
            const isActive = group === g;
            return (
              <CategoryItem
                label={g === ALL ? t("live.all") : prettyGroup(g)}
                active={isActive}
                accentColor={accentColor}
                onPress={() => setGroup(g)}
              />
            );
          }}
        />
      </View>
      )}

      {/* CONTENT */}
      <View style={styles.content}>
        <SafeAreaView edges={["top"]} style={isTVStyle && { paddingTop: spacing.md }}>
          {isPhone ? (
            <PhoneCategoryBar
              title={t("movies.title")}
              search={search}
              onSearch={setSearch}
              placeholder={t("movies.search")}
              groups={groups}
              group={group}
              onGroup={setGroup}
              allLabel={t("live.all")}
              allKey={ALL}
              accentColor={accentColor}
            />
          ) : !isTVStyle && <Text style={styles.title}>{t("movies.title")}</Text>}
        </SafeAreaView>

        {vodsLoading && movies.length === 0 ? (
          <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
            <ActivityIndicator size="large" color={accentColor} />
          </View>
        ) : (
          <PosterGrid
            data={movies}
            numColumns={COL}
            key={`grid-${COL}`}
            keyExtractor={(i: Movie) => i.id}
            contentContainerStyle={{ paddingLeft: isPhone ? spacing.md - GUTTER : spacing.lg - CARD_GUTTER, // TV: keep the last column clear of the screen edge (overscan).
              paddingRight: isPhone ? spacing.md - GUTTER : isTVStyle ? 40 : spacing.lg - CARD_GUTTER, paddingTop: isPhone ? spacing.md : 20, paddingBottom: 140 }}
            keyboardDismissMode="on-drag"
            renderItem={({ item }: { item: Movie }) =>
              IS_WEB ? (
                // FlatList rows don't size cells; FlashList does (1/COL each).
                <View style={{ width: `${100 / COL}%` }}>
                  <MemoizedMovieCard item={item} router={router} COL={COL} GAP={GAP} gutter={GUTTER} />
                </View>
              ) : (
                <MemoizedMovieCard item={item} router={router} COL={COL} GAP={GAP} gutter={GUTTER} />
              )
            }
            {...(IS_WEB ? WEB_GRID_PROPS(COL) : null)}
            ListEmptyComponent={<Text style={[styles.emptyText, { textAlign: "center", marginTop: 40 }]}>{t("movies.no_results")}</Text>}
          />
        )}
      </View>
    </View>
    </FocusMemoryScope>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: "row", backgroundColor: screenBackground },
  sidebar: { width: 220, backgroundColor: colors.surfaceSecondary, borderRightWidth: 1, borderColor: colors.border },
  searchBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.border, margin: spacing.md, paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.md },
  // @ts-ignore
  searchInput: { flex: 1, color: colors.onSurface, fontSize: font.base, padding: 0, outlineStyle: "none" as any },
  groupItem: { paddingHorizontal: spacing.lg, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  groupText: { color: colors.textMuted, fontSize: font.sm, fontWeight: "600", textTransform: "uppercase" },
  groupTextActive: { color: colors.onSurface, fontWeight: "800" },
  content: { flex: 1, flexDirection: "column" },
  title: { color: colors.onSurface, fontSize: font.xxl, fontWeight: "800", paddingTop: spacing.xl, paddingHorizontal: spacing.lg, marginBottom: spacing.md },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  emptyText: { color: colors.textMuted },
  poster: { borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  name: { color: colors.onSurface, fontSize: font.sm, fontWeight: "600", marginTop: 6 },
  // Focus = opacity, not colour: a colour change re-lays out the text on the UI thread.
  cardName: { color: colors.onSurface, fontSize: font.sm, fontWeight: "600", paddingHorizontal: 4, marginTop: 10, opacity: 0.75 },
  cardNameFocused: { opacity: 1 },
});
