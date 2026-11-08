import React, { useMemo } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, FlatList, Dimensions, Pressable, ActivityIndicator, Platform } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { useIPTV } from "@/src/store/iptv-store";
import { useDownloads } from "@/src/store/downloads-store";
import { useTheme } from "@/src/store/theme-store";
import { useResponsive } from "@/src/hooks/use-responsive";
import { colors, spacing, radius, font } from "@/src/theme/tokens";
import { cleanIPTVName } from "@/src/utils/clean-name";
import { searchMovie, getMovieTrailer, TMDBMovie, getImageUrl } from "@/src/utils/tmdb";
import { TrailerModal } from "@/src/components/TrailerModal";
import { AddToCollectionModal } from "@/src/components/AddToCollectionModal";
import { PosterArt } from "@/src/components/PosterArt";

const { width, height } = Dimensions.get("window");

export default function MovieDetail() {
  // The top bar overlays the backdrop; keep its buttons below the status bar.
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const playlist = useIPTV((s) => s.playlist);
  const favorites = useIPTV((s) => s.favorites);
  const toggleFavorite = useIPTV((s) => s.toggleFavorite);
  const watchlists = useIPTV((s) => s.watchlists);
  const toggleWatchlist = useIPTV((s) => s.toggleWatchlist);
  const history = useIPTV((s) => s.history);
  const tmdbApiKey = useIPTV((s) => s.tmdbApiKey);

  const movie = useMemo(() => playlist?.movies.find((m) => m.id === id), [playlist, id]);
  const similar = useMemo(() => {
    if (!playlist || !movie) return [];
    return playlist.movies.filter((m) => m.id !== movie.id && m.group === movie.group).slice(0, 12);
  }, [playlist, movie]);
  const resumeAt = useMemo(() => history.find((h) => h.item_id === id)?.position || 0, [history, id]);

  const downloadItem = useDownloads((s) => (movie ? s.items[movie.id] : undefined));
  const enqueue = useDownloads((s) => s.enqueue);
  const pause = useDownloads((s) => s.pause);
  const resume = useDownloads((s) => s.resume);
  const cancelDl = useDownloads((s) => s.cancel);

  const { isTVStyle } = useResponsive();
  const { accentColor } = useTheme();
  const POSTER_W = isTVStyle ? 150 : width * 0.3;
  
  const [backFocused, setBackFocused] = React.useState(false);
  const [favFocused, setFavFocused] = React.useState(false);
  const [watchFocused, setWatchFocused] = React.useState(false);
  const [playFocused, setPlayFocused] = React.useState(false);
  const [trailerFocused, setTrailerFocused] = React.useState(false);
  const [collFocused, setCollFocused] = React.useState(false);

  const [plot, setPlot] = React.useState<string | null>(null);
  const [plotLoading, setPlotLoading] = React.useState(false);
  const [tmdbData, setTmdbData] = React.useState<TMDBMovie | null>(null);
  const [trailerKey, setTrailerKey] = React.useState<string | null>(null);
  const [showTrailer, setShowTrailer] = React.useState(false);
  const [showAddToCollection, setShowAddToCollection] = React.useState(false);

  React.useEffect(() => {
    if (!movie?.name) return;
    let cancelled = false;
    setPlotLoading(true);
    const cleanName = cleanIPTVName(movie.name);

    const fallbackToItunes = () => {
      fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(cleanName)}&media=movie&country=tr&limit=1`)
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
      searchMovie(cleanName, movie.year || null, tmdbApiKey)
        .then(res => {
          if (cancelled) return;
          if (res) {
            setTmdbData(res);
            setPlot(res.overview || null);
            setPlotLoading(false);
            getMovieTrailer(res.id, tmdbApiKey).then((key) => { if (!cancelled) setTrailerKey(key); });
          } else {
            fallbackToItunes();
          }
        })
        .catch(() => { if (!cancelled) fallbackToItunes(); });
    } else {
      fallbackToItunes();
    }
    // Leaving the page (back button) while this is still in flight shouldn't keep
    // fetching/re-rendering into an unmounted screen - that's what made "back" feel slow.
    return () => { cancelled = true; };
  }, [movie?.name, tmdbApiKey, movie?.year]);

  if (!movie) {
    return (
      <SafeAreaView style={styles.empty}>
        <Text style={styles.emptyText}>Film bulunamadı</Text>
        <TouchableOpacity onPress={() => router.back()}><Text style={{ color: accentColor }}>Geri dön</Text></TouchableOpacity>
      </SafeAreaView>
    );
  }
  const isFav = !!favorites[movie.id];
  const posterUri = getImageUrl(tmdbData?.poster_path || null) || movie.logo || undefined;

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        <View style={[styles.backdrop, isTVStyle && { height: height * 0.45 }]}>
          {/* No blur on TV: blurring the backdrop is costly on low-end boxes. */}
          <Image source={{ uri: getImageUrl(tmdbData?.backdrop_path || null, "w780") || getImageUrl(tmdbData?.poster_path || null) || movie.logo || undefined }} style={[StyleSheet.absoluteFillObject, isTVStyle && { opacity: 0.5 }]} contentFit="cover" blurRadius={isTVStyle ? 0 : tmdbData?.backdrop_path ? 10 : 40} />
          <LinearGradient colors={["rgba(0,0,0,0.3)", "rgba(0,0,0,0.7)", "#000"]} style={StyleSheet.absoluteFillObject} />
          <View style={[styles.topBar, { paddingLeft: 0, paddingTop: insets.top }]}>
            <TouchableOpacity 
              onFocus={() => setBackFocused(true)}
              onBlur={() => setBackFocused(false)}
              onPress={() => router.back()} 
              testID="movie-back"
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
                onPress={() => toggleWatchlist({ item_id: movie.id, kind: "movie", name: movie.name, logo: movie.logo, url: movie.url })}
                testID="movie-watchlist"
                style={[
                  { width: 50, height: 50, borderRadius: 25, alignItems: "center", justifyContent: "center" },
                  watchFocused && { backgroundColor: "rgba(255,255,255,0.2)" }
                ]}
              >
                <Ionicons name={watchlists[movie.id] ? "bookmark" : "bookmark-outline"} size={28} color={watchlists[movie.id] ? accentColor : "#fff"} />
              </TouchableOpacity>
              <TouchableOpacity
                onFocus={() => setFavFocused(true)}
                onBlur={() => setFavFocused(false)}
                onPress={() => toggleFavorite({ item_id: movie.id, name: movie.name, logo: movie.logo, url: movie.url, kind: "movie" })}
                testID="movie-favorite"
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
                testID="movie-add-to-collection"
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
        <View style={[styles.content, isTVStyle && styles.contentTV]}>
          {isTVStyle && (
            <PosterArt uri={posterUri} title={cleanIPTVName(movie.name)} contentFit="contain" style={styles.posterTV} />
          )}
          <View style={isTVStyle ? styles.infoTV : undefined}>
          <Text style={styles.title}>{tmdbData?.title || cleanIPTVName(movie.name)}</Text>
          <View style={styles.metaRow}>
            {(tmdbData?.release_date?.substring(0,4) || movie.year) ? <MetaPill text={tmdbData?.release_date?.substring(0,4) || movie.year || ""} /> : null}
            {(tmdbData?.vote_average || movie.rating) ? (
              <MetaPill text={`★ ${tmdbData ? tmdbData.vote_average.toFixed(1) : movie.rating}`} />
            ) : null}
            {movie.group ? <MetaPill text={movie.group} /> : null}
          </View>

          <View style={styles.actionRow}>
            <Pressable
              style={[
                styles.playBtn,
                { backgroundColor: accentColor },
                isTVStyle && { paddingHorizontal: 40 },
                playFocused && { borderColor: "#fff" }
              ]}
              onFocus={() => setPlayFocused(true)}
              onBlur={() => setPlayFocused(false)}
              onPress={() => router.push({ pathname: "/player", params: { url: downloadItem?.status === "completed" && downloadItem.fileUri ? downloadItem.fileUri : movie.url, title: movie.name, kind: "movie", itemId: movie.id, logo: movie.logo || "", position: String(resumeAt) } })}
              testID="movie-play"
              focusable={true}
              hasTVPreferredFocus={isTVStyle}
            >
              <Ionicons name="play" size={22} color="#000" />
              <Text style={styles.playBtnText}>{resumeAt >= 60 ? `${Math.floor(resumeAt / 60)}. dakikadan devam et` : "Filmi Oynat"}</Text>
            </Pressable>

            {!!trailerKey && (
              <Pressable
                style={[styles.trailerBtn, trailerFocused && styles.btnFocused]}
                onFocus={() => setTrailerFocused(true)}
                onBlur={() => setTrailerFocused(false)}
                onPress={() => setShowTrailer(true)}
                testID="movie-trailer"
                focusable={true}
              >
                <Ionicons name="film-outline" size={20} color="#fff" />
                <Text style={styles.trailerBtnText}>Fragman</Text>
              </Pressable>
            )}

            <DownloadActionRow
              item={downloadItem}
              accentColor={accentColor}
              isTVStyle={isTVStyle}
              onDownload={() => enqueue({ id: movie.id, url: movie.url, name: movie.name, kind: "movie", logo: movie.logo })}
              onPause={() => pause(movie.id)}
              onResume={() => resume(movie.id)}
              onCancel={() => cancelDl(movie.id)}
            />
          </View>

          <Text style={styles.sectionTitle}>Özet</Text>
          {plotLoading ? (
            <ActivityIndicator size="small" color={accentColor} style={{ alignSelf: "flex-start", marginTop: 8 }} />
          ) : (
            <Text style={styles.about}>
              {plot || `${cleanIPTVName(movie.name)} isimli içerik IPTV kütüphanenizde ${movie.group || "Genel"} kategorisinde yer almaktadır.`}
            </Text>
          )}
          </View>
        </View>

        <View style={[styles.similar, isTVStyle && styles.similarTV]}>
          {similar.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>Benzer Filmler</Text>
              <FlatList
                data={similar}
                keyExtractor={(i) => i.id}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: spacing.md, paddingVertical: spacing.md }}
                renderItem={({ item }) => (
                  <SimilarMovieCard item={item} router={router} POSTER_W={POSTER_W} />
                )}
              />
            </>
          )}
        </View>
      </ScrollView>
      <TrailerModal visible={showTrailer} youtubeKey={trailerKey} onClose={() => setShowTrailer(false)} />
      <AddToCollectionModal
        visible={showAddToCollection}
        item={{ item_id: movie.id, kind: "movie", name: movie.name, logo: movie.logo, url: movie.url }}
        onClose={() => setShowAddToCollection(false)}
      />
    </View>
  );
}

function SimilarMovieCard({ item, router, POSTER_W }: any) {
  const { accentColor } = useTheme();
  const [focused, setFocused] = React.useState(false);
  return (
    <View style={{ width: POSTER_W }}>
      <Pressable
        style={[
          { borderRadius: radius.md, borderWidth: 3, borderColor: "transparent", padding: 2 },
          focused && { borderColor: "#fff" }
        ]}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onPress={() => router.push({ pathname: "/movie/[id]", params: { id: item.id } })}
        testID={`similar-${item.id}`}
        focusable={true}
      >
        <PosterArt uri={item.logo} title={cleanIPTVName(item.name)} contentFit="contain" recyclingKey={item.id} style={{ height: POSTER_W * 1.5 }} />
      </Pressable>
      <Text style={[styles.posterName, { paddingHorizontal: 4 }]} numberOfLines={2}>{cleanIPTVName(item.name)}</Text>
    </View>
  );
}

function MetaPill({ text }: { text: string }) {
  return <View style={styles.pill}><Text style={styles.pillText}>{text}</Text></View>;
}

function DownloadActionRow({ item, accentColor, isTVStyle, onDownload, onPause, onResume, onCancel }: any) {
  const [dlFocused, setDlFocused] = React.useState(false);

  if (!item && Platform.OS === "web") {
    return (
      <View style={[styles.dlBtn, { borderColor: colors.border, opacity: 0.6 }]}>
        <Ionicons name="cloud-offline-outline" size={18} color={colors.textMuted} />
        <Text style={[styles.dlBtnText, { color: colors.textMuted }]}>Çevrimdışı indirme masaüstünde henüz desteklenmiyor</Text>
      </View>
    );
  }

  if (!item) {
    return (
      <Pressable 
        style={[
          styles.dlBtn, 
          isTVStyle && { paddingHorizontal: 32 },
          dlFocused && styles.btnFocused
        ]} 
        onPress={onDownload} 
        onFocus={() => setDlFocused(true)}
        onBlur={() => setDlFocused(false)}
        testID="movie-download"
        focusable={true}
      >
        <Ionicons name="cloud-download" size={18} color="#fff" />
        <Text style={styles.dlBtnText}>İndir</Text>
      </Pressable>
    );
  }
  if (item.status === "completed") {
    return (
      <View style={[styles.dlBtn, { borderColor: colors.success }]}>
        <Ionicons name="checkmark-circle" size={18} color={colors.success} />
        <Text style={[styles.dlBtnText, { color: colors.success }]}>İndirildi · çevrimdışı izlenebilir</Text>
      </View>
    );
  }
  const percent = Math.round((item.progress || 0) * 100);
  return (
    <View style={styles.dlInline}>
      <View style={{ flex: 1 }}>
        <Text style={styles.dlInlineLabel}>{item.status === "paused" ? "Duraklatıldı" : "İndiriliyor"} · {percent}%</Text>
        <View style={styles.dlTrack}><View style={[styles.dlFill, { width: `${percent}%`, backgroundColor: accentColor }]} /></View>
      </View>
      {item.status === "downloading" ? (
        <TouchableOpacity onPress={onPause} hitSlop={8} testID="movie-download-pause"><Ionicons name="pause-circle" size={28} color="#fff" /></TouchableOpacity>
      ) : (
        <TouchableOpacity onPress={onResume} hitSlop={8} testID="movie-download-resume"><Ionicons name="play-circle" size={28} color="#fff" /></TouchableOpacity>
      )}
      <TouchableOpacity onPress={onCancel} hitSlop={8} testID="movie-download-cancel"><Ionicons name="close-circle" size={24} color={colors.textMuted} /></TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, gap: spacing.md },
  emptyText: { color: colors.textMuted },
  backdrop: { width: "100%", height: width * 1.0 },
  // Static zIndex (never toggled): the centred poster is drawn after the bar and covered its buttons.
  topBar: { position: "absolute", left: 0, right: 0, top: 0, zIndex: 2, flexDirection: "row", justifyContent: "space-between", padding: spacing.lg },
  content: { padding: spacing.lg, marginTop: -60 },
  // TV: same side gutter as the home rows, poster beside the details.
  contentTV: { flexDirection: "row", alignItems: "flex-start", gap: spacing.xxl, paddingHorizontal: 56, marginTop: -160 },
  posterTV: { width: 200, height: 300 },
  infoTV: { flex: 1, paddingTop: 72 },
  similar: { paddingHorizontal: spacing.lg },
  similarTV: { paddingHorizontal: 56 },
  actionRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.md, marginTop: spacing.xl },
  // Focus = white outline. The buttons always carry a 3px border (transparent when idle),
  // so focusing never changes their size or nudges their neighbours.
  btnFocused: { borderColor: "#fff", backgroundColor: "rgba(255,255,255,0.18)" },
  title: { color: colors.onSurface, fontSize: font.xxxl, fontWeight: "800", letterSpacing: -0.5 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md },
  pill: { backgroundColor: "rgba(255,255,255,0.1)", borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 4 },
  pillText: { color: colors.onSurface, fontSize: font.sm, fontWeight: "600" },
  playBtn: { flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", backgroundColor: "#fff", height: 52, paddingHorizontal: spacing.xl, borderRadius: radius.pill, borderWidth: 3, borderColor: "transparent" },
  playBtnText: { color: "#000", fontSize: font.lg, fontWeight: "700" },
  trailerBtn: {
    flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)", borderWidth: 3, borderColor: "transparent",
    paddingHorizontal: spacing.xl, height: 52, borderRadius: radius.pill,
  },
  trailerBtnText: { color: "#fff", fontSize: font.lg, fontWeight: "700" },
  sectionTitle: { color: colors.onSurface, fontSize: font.xl, fontWeight: "700", marginTop: spacing.xl, marginBottom: spacing.sm },
  about: { color: colors.onSurfaceSecondary, fontSize: font.base, lineHeight: 20 },
  posterSm: { width: width * 0.3, height: width * 0.45, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  posterName: { color: colors.onSurface, fontSize: font.sm, fontWeight: "600", marginTop: 6 },
  dlBtn: { flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", height: 52, paddingHorizontal: spacing.xl, borderRadius: radius.pill, borderWidth: 3, borderColor: "rgba(255,255,255,0.15)" },
  dlBtnText: { color: "#fff", fontSize: font.base, fontWeight: "700" },
  dlInline: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary, minWidth: 260 },
  dlInlineLabel: { color: colors.onSurface, fontSize: font.sm, fontWeight: "600", marginBottom: 6 },
  dlTrack: { height: 4, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 2, overflow: "hidden" },
  dlFill: { height: "100%", backgroundColor: colors.brandPrimary },
});
