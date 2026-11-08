import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Dimensions, ActivityIndicator, Pressable, FlatList, Platform } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { useIPTV } from "@/src/store/iptv-store";
import { useSeriesEpisodes } from "@/src/store/series-episodes-store";
import { useDownloads } from "@/src/store/downloads-store";
import { useTheme } from "@/src/store/theme-store";
import { useResponsive } from "@/src/hooks/use-responsive";
import { colors, spacing, radius, font } from "@/src/theme/tokens";
import type { SeriesEpisode } from "@/src/types/iptv";
import { cleanIPTVName, extractYear } from "@/src/utils/clean-name";
import { getRecommendedSeries } from "@/src/utils/recommendations";
import { searchSeries, getSeriesTrailer, TMDBSeries, getImageUrl } from "@/src/utils/tmdb";
import { TrailerModal } from "@/src/components/TrailerModal";
import { AddToCollectionModal } from "@/src/components/AddToCollectionModal";
import { PosterArt } from "@/src/components/PosterArt";

const { width, height } = Dimensions.get("window");

export default function SeriesDetail() {
  // The top bar overlays the backdrop; keep its buttons below the status bar.
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const playlist = useIPTV((s) => s.playlist);
  const config = useIPTV((s) => s.config);
  const favorites = useIPTV((s) => s.favorites);
  const toggleFavorite = useIPTV((s) => s.toggleFavorite);
  const watchlists = useIPTV((s) => s.watchlists);
  const toggleWatchlist = useIPTV((s) => s.toggleWatchlist);
  const history = useIPTV((s) => s.history);
  const tmdbApiKey = useIPTV((s) => s.tmdbApiKey);

  const { isTVStyle } = useResponsive();
  const { accentColor } = useTheme();

  const seriesObj = useMemo(() => playlist?.series.find((s) => s.id === id), [playlist, id]);
  const similar = useMemo(() => {
    if (!playlist || !seriesObj) return [];
    return getRecommendedSeries(seriesObj, playlist.series, 12);
  }, [playlist, seriesObj]);
  const [episodes, setEpisodes] = useState<SeriesEpisode[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeSeason, setActiveSeason] = useState(1);
  const [backFocused, setBackFocused] = useState(false);
  const [favFocused, setFavFocused] = useState(false);
  const [watchFocused, setWatchFocused] = useState(false);
  const [collFocused, setCollFocused] = useState(false);
  const [trailerFocused, setTrailerFocused] = useState(false);

  // Shared cache with the player (episodes panel / up-next), see series-episodes-store.
  const loadEpisodes = useSeriesEpisodes((s) => s.load);
  useEffect(() => {
    if (!seriesObj) return;
    let active = true;
    setLoading(true);
    loadEpisodes(seriesObj.id)
      .then((eps) => {
        if (!active) return;
        setEpisodes(eps);
        setActiveSeason(eps[0]?.season || 1);
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [seriesObj, config, loadEpisodes]);
  const [plot, setPlot] = React.useState<string | null>(null);
  const [plotLoading, setPlotLoading] = React.useState(false);
  const [tmdbData, setTmdbData] = React.useState<TMDBSeries | null>(null);
  const [trailerKey, setTrailerKey] = React.useState<string | null>(null);
  const [showTrailer, setShowTrailer] = React.useState(false);
  const [showAddToCollection, setShowAddToCollection] = React.useState(false);

  React.useEffect(() => {
    if (!seriesObj?.name) return;
    if (loading) return; // Wait until Xtream info is loaded so we can extract year from episodes
    let cancelled = false;
    setPlotLoading(true);
    const cleanName = cleanIPTVName(seriesObj.name);
    let seriesYear = extractYear(seriesObj.name);

    // If series name doesn't have a year, try extracting from the first episode's title
    if (!seriesYear && episodes && episodes.length > 0) {
      seriesYear = extractYear(episodes[0].title);
    }

    const fallbackToItunes = () => {
      fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(cleanName)}&media=tvShow&country=tr&limit=1`)
        .then(r => r.json())
        .then(d => {
          if (cancelled) return;
          if (d.results && d.results.length > 0) {
            setPlot(d.results[0].longDescription || d.results[0].shortDescription || null);
          } else setPlot(null);
        })
        .catch(() => { if (!cancelled) setPlot(null); })
        .finally(() => { if (!cancelled) setPlotLoading(false); });
    };

    if (tmdbApiKey) {
      searchSeries(cleanName, seriesYear, tmdbApiKey)
        .then(res => {
          if (cancelled) return;
          if (res) {
            setTmdbData(res);
            setPlot(res.overview || null);
            setPlotLoading(false);
            getSeriesTrailer(res.id, tmdbApiKey).then((key) => { if (!cancelled) setTrailerKey(key); });
          } else {
            fallbackToItunes();
          }
        })
        .catch(() => { if (!cancelled) fallbackToItunes(); });
    } else {
      fallbackToItunes();
    }
    return () => { cancelled = true; };
  }, [seriesObj?.name, tmdbApiKey, episodes, loading]);

  const seasons = useMemo(() => Array.from(new Set(episodes.map((e) => e.season))).sort((a, b) => a - b), [episodes]);
  const seasonEps = useMemo(() => episodes.filter((e) => e.season === activeSeason), [episodes, activeSeason]);

  if (!seriesObj) {
    return (
      <SafeAreaView style={styles.empty}>
        <Text style={styles.emptyText}>Dizi bulunamadı</Text>
      </SafeAreaView>
    );
  }
  const isFav = !!favorites[seriesObj.id];
  const posterUri = getImageUrl(tmdbData?.poster_path || null) || seriesObj.logo || undefined;

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        <View style={[styles.backdrop, isTVStyle && { height: height * 0.45 }]}>
          {/* No blur on TV: blurring the backdrop is costly on low-end boxes. */}
          <Image source={{ uri: getImageUrl(tmdbData?.backdrop_path || null, "w780") || getImageUrl(tmdbData?.poster_path || null) || seriesObj.logo || undefined }} style={[StyleSheet.absoluteFillObject, isTVStyle && { opacity: 0.5 }]} contentFit="cover" blurRadius={isTVStyle ? 0 : tmdbData?.backdrop_path ? 10 : 40} />
          <LinearGradient colors={["rgba(0,0,0,0.3)", "rgba(0,0,0,0.7)", "#000"]} style={StyleSheet.absoluteFillObject} />
          <View style={[styles.topBar, { paddingLeft: 0, paddingTop: insets.top }]}>
            <TouchableOpacity 
              onFocus={() => setBackFocused(true)}
              onBlur={() => setBackFocused(false)}
              onPress={() => router.back()} 
              testID="series-back"
              style={[
                { width: 80, height: 80, alignItems: "center", justifyContent: "center" },
                backFocused && { backgroundColor: "rgba(255,255,255,0.1)", borderRadius: 40 }
              ]}
            >
              <Ionicons name="chevron-back" size={36} color="#fff" style={{ marginLeft: 8 }} />
            </TouchableOpacity>
            <View style={{ flexDirection: "row", gap: spacing.sm, paddingRight: spacing.lg, paddingTop: spacing.lg }}>
              <TouchableOpacity
                onFocus={() => setWatchFocused(true)}
                onBlur={() => setWatchFocused(false)}
                onPress={() => toggleWatchlist({ item_id: seriesObj.id, kind: "series", name: seriesObj.name, logo: seriesObj.logo })}
                testID="series-watchlist"
                style={[
                  { width: 50, height: 50, borderRadius: 25, alignItems: "center", justifyContent: "center" },
                  watchFocused && { backgroundColor: "rgba(255,255,255,0.2)" }
                ]}
              >
                <Ionicons name={watchlists[seriesObj.id] ? "bookmark" : "bookmark-outline"} size={28} color={watchlists[seriesObj.id] ? accentColor : "#fff"} />
              </TouchableOpacity>
              <TouchableOpacity
                onFocus={() => setFavFocused(true)}
                onBlur={() => setFavFocused(false)}
                onPress={() => toggleFavorite({ item_id: seriesObj.id, name: seriesObj.name, logo: seriesObj.logo, kind: "series" })}
                testID="series-favorite"
                style={[
                  { width: 50, height: 50, borderRadius: 25, alignItems: "center", justifyContent: "center" },
                  favFocused && { backgroundColor: "rgba(255,255,255,0.2)" }
                ]}
              >
                <Ionicons name={isFav ? "heart" : "heart-outline"} size={28} color={isFav ? accentColor : "#fff"} />
              </TouchableOpacity>
              <TouchableOpacity
                onFocus={() => setCollFocused(true)}
                onBlur={() => setCollFocused(false)}
                onPress={() => setShowAddToCollection(true)}
                testID="series-add-to-collection"
                style={[
                  { width: 50, height: 50, borderRadius: 25, alignItems: "center", justifyContent: "center" },
                  collFocused && { backgroundColor: "rgba(255,255,255,0.2)" }
                ]}
              >
                <Ionicons name="folder-outline" size={26} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>
          {!isTVStyle && (
            <View pointerEvents="none" style={{ alignItems: "center", justifyContent: "center", flex: 1, marginTop: 20 }}>
              <Image
                source={{ uri: posterUri }}
                style={{ width: width * 0.4, height: width * 0.6, maxWidth: 200, maxHeight: 300, borderRadius: radius.md, borderWidth: 1, borderColor: "rgba(255,255,255,0.3)", backgroundColor: colors.surfaceSecondary }}
                contentFit="contain"
              />
            </View>
          )}
        </View>

        {/* TV: poster on the left with the details beside it (like the home hero). */}
        <View style={[styles.content, isTVStyle && styles.headTV]}>
          {isTVStyle && (
            <PosterArt uri={posterUri} title={cleanIPTVName(seriesObj.name)} contentFit="contain" style={styles.posterTV} />
          )}
          <View style={isTVStyle ? styles.infoTV : undefined}>
          <Text style={styles.title}>{tmdbData?.name || cleanIPTVName(seriesObj.name)}</Text>
          <View style={styles.metaRow}>
            {tmdbData?.first_air_date ? <Pill text={tmdbData.first_air_date.substring(0, 4)} /> : null}
            {tmdbData?.vote_average ? <Pill text={`★ ${tmdbData.vote_average.toFixed(1)}`} /> : null}
            {seriesObj.group ? <Pill text={seriesObj.group} /> : null}
            <Pill text={`${seasons.length || 1} Sezon`} />
            <Pill text={`${episodes.length} Bölüm`} />
          </View>

          {!!trailerKey && (
            <Pressable
              style={[styles.trailerBtn, trailerFocused && { borderColor: "#fff", backgroundColor: "rgba(255,255,255,0.18)" }]}
              onFocus={() => setTrailerFocused(true)}
              onBlur={() => setTrailerFocused(false)}
              onPress={() => setShowTrailer(true)}
              testID="series-trailer"
              focusable={true}
            >
              <Ionicons name="film-outline" size={20} color="#fff" />
              <Text style={styles.trailerBtnText}>Fragman</Text>
            </Pressable>
          )}

          <Text style={[styles.sectionTitle, { marginTop: spacing.xl }]}>Özet</Text>
          {plotLoading ? (
            <ActivityIndicator size="small" color={accentColor} style={{ alignSelf: "flex-start", marginTop: 8 }} />
          ) : (
            <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: font.base, lineHeight: 22, marginTop: spacing.sm, marginBottom: spacing.md }}>
              {plot || `${cleanIPTVName(seriesObj.name)} isimli dizi IPTV kütüphanenizde ${seriesObj.group || "Genel"} kategorisinde yer almaktadır.`}
            </Text>
          )}
          </View>
        </View>

        <View style={[styles.body, isTVStyle && styles.bodyTV]}>

          {loading && (
            <View style={{ marginTop: spacing.xl, alignItems: "center" }}>
              <ActivityIndicator color={accentColor} />
            </View>
          )}

          {seasons.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingVertical: spacing.lg }}>
              {seasons.map((s) => (
                <SeasonChip key={s} s={s} activeSeason={activeSeason} setActiveSeason={setActiveSeason} accentColor={accentColor} />
              ))}
            </ScrollView>
          )}

          {seasonEps.map((ep) => (
            <EpisodeRow
              key={ep.id}
              ep={ep}
              seriesLogo={seriesObj.logo || null}
              accentColor={accentColor}
              resumeAt={history.find((h) => h.item_id === ep.id)?.position || 0}
              onPlay={(url, resumeAt) => router.push({ pathname: "/player", params: { url, title: ep.title, kind: "series", itemId: ep.id, seriesId: seriesObj.id, logo: ep.logo || seriesObj.logo || "", position: String(resumeAt || 0) } })}
            />
          ))}

          {!loading && seasonEps.length === 0 && (
            <Text style={{ color: colors.textMuted, textAlign: "center", marginTop: spacing.xl }}>Bu sezonda bölüm yok.</Text>
          )}

          {similar.length > 0 && (
            <View style={{ marginTop: spacing.xl }}>
              <Text style={styles.sectionTitle}>Benzer Diziler</Text>
              <FlatList
                data={similar}
                keyExtractor={(i) => i.id}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: spacing.md, paddingVertical: spacing.md }}
                renderItem={({ item }) => (
                  <SimilarSeriesCard item={item} router={router} POSTER_W={isTVStyle ? 150 : width * 0.3} />
                )}
              />
            </View>
          )}
        </View>
      </ScrollView>
      <TrailerModal visible={showTrailer} youtubeKey={trailerKey} onClose={() => setShowTrailer(false)} />
      <AddToCollectionModal
        visible={showAddToCollection}
        item={{ item_id: seriesObj.id, kind: "series", name: seriesObj.name, logo: seriesObj.logo }}
        onClose={() => setShowAddToCollection(false)}
      />
    </View>
  );
}

function SimilarSeriesCard({ item, router, POSTER_W }: any) {
  const { accentColor } = useTheme();
  const [focused, setFocused] = React.useState(false);
  return (
    <View style={{ width: POSTER_W }}>
      <Pressable
        style={[
          { borderRadius: radius.md, borderWidth: 3, borderColor: "transparent", padding: 2 },
          focused && { borderColor: accentColor, backgroundColor: "rgba(255,255,255,0.1)" }
        ]}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onPress={() => router.replace({ pathname: "/series/[id]", params: { id: item.id } })}
        testID={`similar-${item.id}`}
        focusable={true}
      >
        <PosterArt uri={item.logo} title={cleanIPTVName(item.name)} contentFit="contain" recyclingKey={item.id} style={{ height: POSTER_W * 1.5 }} />
      </Pressable>
      <Text style={{ color: "#fff", fontSize: font.sm, fontWeight: "600", marginTop: 4, paddingHorizontal: 4 }} numberOfLines={2}>{cleanIPTVName(item.name)}</Text>
    </View>
  );
}

function Pill({ text }: { text: string }) {
  return <View style={styles.pill}><Text style={styles.pillText}>{text}</Text></View>;
}

function SeasonChip({ s, activeSeason, setActiveSeason, accentColor }: any) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      style={[
        styles.seasonChip, 
        activeSeason === s && [styles.seasonChipActive, { backgroundColor: accentColor, borderColor: accentColor }],
        focused && { borderColor: accentColor, borderWidth: 2 }
      ]}
      onPress={() => setActiveSeason(s)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      testID={`season-chip-${s}`}
      focusable={true}
    >
      <Text style={[styles.seasonText, activeSeason === s && styles.seasonTextActive, focused && { color: "#fff" }]}>{s}. Sezon</Text>
    </Pressable>
  );
}

function EpisodeRow({ ep, seriesLogo, accentColor, resumeAt, onPlay }: { ep: SeriesEpisode; seriesLogo: string | null; accentColor: string; resumeAt: number; onPlay: (url: string, resumeAt: number) => void }) {
  const dl = useDownloads((s) => s.items[ep.id]);
  const enqueue = useDownloads((s) => s.enqueue);
  const pause = useDownloads((s) => s.pause);
  const resume = useDownloads((s) => s.resume);
  const cancel = useDownloads((s) => s.cancel);
  const [focused, setFocused] = useState(false);
  const [dlFocused, setDlFocused] = useState(false);
  
  const percent = Math.round((dl?.progress || 0) * 100);
  const playUrl = dl?.status === "completed" && dl.fileUri ? dl.fileUri : ep.url;
  return (
    <View style={styles.epRow}>
      <Pressable
        style={[
          styles.epImg,
          focused && { borderColor: accentColor, borderWidth: 3 }
        ]}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onPress={() => onPlay(playUrl, resumeAt)}
        testID={`episode-${ep.id}`}
        focusable={true}
      >
        <Image source={{ uri: ep.logo || seriesLogo || undefined }} style={StyleSheet.absoluteFillObject} contentFit="cover" recyclingKey={ep.id} />
        <View style={styles.epPlay}><Ionicons name="play" size={18} color="#fff" /></View>
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={[styles.epTitle, focused && { color: accentColor }]} numberOfLines={2}>{ep.episode}. {ep.title}</Text>
        <Text style={styles.epSub}>S{ep.season} · E{ep.episode}{resumeAt > 0 ? ` · Resume ${Math.floor(resumeAt / 60)}m` : ""}{dl?.status === "completed" ? " · Downloaded" : dl ? ` · ${percent}%` : ""}</Text>
      </View>
      {!dl && Platform.OS === "web" && (
        <Ionicons name="cloud-offline-outline" size={22} color={colors.border} testID={`ep-download-unsupported-${ep.id}`} />
      )}
      {!dl && Platform.OS !== "web" && (
        <Pressable
          onPress={() => enqueue({ id: ep.id, url: ep.url, name: ep.title, kind: "series", logo: ep.logo || seriesLogo })}
          hitSlop={8}
          testID={`ep-download-${ep.id}`}
          onFocus={() => setDlFocused(true)}
          onBlur={() => setDlFocused(false)}
          focusable={true}
          style={[dlFocused && { backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 20, padding: 4 }]}
        >
          <Ionicons name="cloud-download-outline" size={22} color={dlFocused ? "#fff" : colors.textMuted} />
        </Pressable>
      )}
      {dl?.status === "downloading" && (
        <TouchableOpacity onPress={() => pause(ep.id)} hitSlop={8}><Ionicons name="pause-circle" size={24} color="#fff" /></TouchableOpacity>
      )}
      {(dl?.status === "paused" || dl?.status === "failed") && (
        <TouchableOpacity onPress={() => resume(ep.id)} hitSlop={8}><Ionicons name="play-circle" size={24} color="#fff" /></TouchableOpacity>
      )}
      {dl?.status === "completed" && (
        <TouchableOpacity onPress={() => cancel(ep.id)} hitSlop={8}><Ionicons name="checkmark-circle" size={22} color={colors.success} /></TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  emptyText: { color: colors.textMuted },
  backdrop: { width: "100%", height: width * 0.9 },
  // Static zIndex (never toggled): the centred poster is drawn after the bar and covered its buttons.
  topBar: { position: "absolute", left: 0, right: 0, top: 0, zIndex: 2, flexDirection: "row", justifyContent: "space-between", padding: spacing.lg },
  content: { padding: spacing.lg, marginTop: -60 },
  // TV: same side gutter as the home rows, poster beside the details.
  headTV: { flexDirection: "row", alignItems: "flex-start", gap: spacing.xxl, paddingHorizontal: 56, marginTop: -160 },
  posterTV: { width: 200, height: 300 },
  infoTV: { flex: 1, paddingTop: 72 },
  body: { paddingHorizontal: spacing.lg },
  bodyTV: { paddingHorizontal: 56 },
  title: { color: colors.onSurface, fontSize: font.xxxl, fontWeight: "800" },
  sectionTitle: { color: colors.onSurface, fontSize: font.xl, fontWeight: "700" },
  metaRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md, flexWrap: "wrap" },
  pill: { backgroundColor: "rgba(255,255,255,0.1)", borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 4 },
  pillText: { color: colors.onSurface, fontSize: font.sm, fontWeight: "600" },
  trailerBtn: {
    flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", alignSelf: "flex-start",
    backgroundColor: "rgba(255,255,255,0.12)", borderWidth: 3, borderColor: "transparent",
    paddingHorizontal: spacing.xl, paddingVertical: 10, borderRadius: radius.pill, marginTop: spacing.lg,
  },
  trailerBtnText: { color: "#fff", fontSize: font.base, fontWeight: "700" },
  seasonChip: { paddingHorizontal: spacing.lg, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, flexShrink: 0 },
  seasonChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  seasonText: { color: colors.onSurfaceSecondary, fontWeight: "600" },
  seasonTextActive: { color: "#fff" },
  epRow: { flexDirection: "row", gap: spacing.md, marginVertical: spacing.sm, alignItems: "center" },
  epImg: { width: 130, height: 75, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, overflow: "hidden", justifyContent: "center", alignItems: "center" },
  epPlay: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center" },
  epTitle: { color: colors.onSurface, fontSize: font.base, fontWeight: "600" },
  epSub: { color: colors.textMuted, fontSize: font.sm, marginTop: 4 },
});
