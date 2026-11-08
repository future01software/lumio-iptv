import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Dimensions, Platform, Pressable, InteractionManager } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming, withDelay } from "react-native-reanimated";

import { useIPTV, currentEPG } from "@/src/store/iptv-store";
import { useI18n } from "@/src/store/i18n-store";
import { useTheme } from "@/src/store/theme-store";
import { useProfiles } from "@/src/store/profile-store";
import { useResponsive } from "@/src/hooks/use-responsive";
import { LOW_END } from "@/src/utils/perf";
import { PosterArt, FocusRing, CARD_GUTTER } from "@/src/components/PosterArt";
import { colors, spacing, radius, font, screenBackground } from "@/src/theme/tokens";
import { cleanChannelName, cleanIPTVName } from "@/src/utils/clean-name";
import { filterMovies, filterSeries } from "@/src/utils/content-filter";
import { searchMovie, searchSeries, getImageUrl, type TMDBMovie, type TMDBSeries } from "@/src/utils/tmdb";
import { ChannelAvatar } from "@/src/components/ChannelAvatar";
import { SkeletonRow } from "@/src/components/SkeletonRow";
import { FocusMemoryScope, useRememberedFocus } from "@/src/hooks/use-focus-memory";
import { useSeriesEpisodes } from "@/src/store/series-episodes-store";
import { buildContinueWatching, type ContinueEntry } from "@/src/utils/continue-watching";
import { ProfileAvatar } from "@/src/components/profile/ProfileAvatar";
import type { Channel, Movie, Series } from "@/src/types/iptv";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
/**
 * Light mode (low-end TV boxes) has no focus zoom or entrance animations, so it uses plain
 * views: Reanimated re-applies the props of every mounted animated view on each React
 * commit, which measured ~29 native prop updates per remote keypress on the home screen.
 */
const CardPressable: typeof AnimatedPressable = LOW_END ? (Pressable as any) : AnimatedPressable;
const MaybeAnimatedView: typeof Animated.View = LOW_END ? (View as any) : Animated.View;

// TV: when the remote moves into a row, scroll the page so the whole row (title, cards
// with their focus ring, captions) is on screen. Android's own focus scrolling only
// brings the card's bounds in, which left the ring and captions of lower rows cut off.
type HomeScroll = { contentRef: React.RefObject<View | null>; scrollTo: (y: number) => void };
const HomeScrollContext = createContext<HomeScroll | null>(null);
const RevealRowContext = createContext<(() => void) | null>(null);

/** Drives a smooth spring scale + reports focus state for the focus/press ring styling used across home cards. */
// focusKey: opt this card into focus memory (TV Back returns focus to it).
function useFocusScale(requestedScale = 1.05, focusKey?: string) {
  // Light mode: no zoom; the focus ring alone marks the focused card.
  const focusScale = LOW_END ? 1 : requestedScale;
  const scale = useSharedValue(1);
  const [focused, setFocused] = useState(false);
  const { hasTVPreferredFocus, onFocusRemember } = useRememberedFocus(focusKey ?? "");
  const revealRow = useContext(RevealRowContext);
  const handleFocus = () => {
    setFocused(true);
    revealRow?.();
    if (focusKey) onFocusRemember();
    if (!LOW_END) scale.value = withSpring(focusScale, { damping: 14, stiffness: 200 });
  };
  const handleBlur = () => {
    setFocused(false);
    if (!LOW_END) scale.value = withSpring(1, { damping: 14, stiffness: 200 });
  };
  const handlePressIn = () => {
    if (!LOW_END) scale.value = withSpring(focusScale * 0.95, { damping: 16, stiffness: 260 });
  };
  const handlePressOut = () => {
    if (!LOW_END) scale.value = withSpring(focused ? focusScale : 1, { damping: 14, stiffness: 200 });
  };
  // eslint-disable-next-line react-hooks/rules-of-hooks -- LOW_END never changes at runtime
  const animatedStyle = LOW_END ? undefined : useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return {
    focused,
    animatedStyle,
    handleFocus,
    handleBlur,
    handlePressIn,
    handlePressOut,
    hasTVPreferredFocus: !!focusKey && hasTVPreferredFocus,
  };
}

function HeroButton({ icon, label, onPress, testID, primary, accentColor }: any) {
  const { focused, animatedStyle, handleFocus, handleBlur, handlePressIn, handlePressOut } = useFocusScale(1.06);
  return (
    <CardPressable
      onFocus={handleFocus}
      onBlur={handleBlur}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={onPress}
      testID={testID}
      focusable={true}
      style={[
        primary ? styles.heroPrimary : styles.heroGhost,
        primary && { backgroundColor: accentColor },
        // White ring: an accent ring is invisible on the accent-filled Play button.
        focused && { borderColor: "#fff" },
        animatedStyle,
      ]}
    >
      <Ionicons name={icon} size={primary ? 20 : 18} color={primary ? "#000" : colors.onSurface} />
      <Text style={primary ? styles.heroPrimaryText : styles.heroGhostText}>{label}</Text>
    </CardPressable>
  );
}

const { width, height: screenHeight } = Dimensions.get("window");

export default function Home() {
  const router = useRouter();
  const playlist = useIPTV((s) => s.playlist);
  const history = useIPTV((s) => s.history);
  const favorites = useIPTV((s) => s.favorites);
  const epgByChannel = useIPTV((s) => s.epgByChannel);
  const recentChannels = useIPTV((s) => s.recentChannels);
  const vodsLoading = useIPTV((s) => s.vodsLoading);
  const activeProfile = useProfiles((s) => s.active());
  const { t } = useI18n();
  const { accentColor } = useTheme();
  const { isTVStyle } = useResponsive();


  // The rows below "Recent Channels" are below the fold on first paint. Mounting all
  // five horizontal poster rows at once makes every row's FlashList request its visible
  // posters' images in the same frame, which on low-power Android TV boxes pegs the main
  // thread for seconds (dropped frames, input stops registering). Deferring their mount
  // by one interaction tick lets the fast-to-render top of the screen paint first.
  // They then mount one at a time (like Nuvio's batched catalog publishing) so no
  // single frame has to lay out and decode every row's posters together.
  const LOWER_ROW_COUNT = 3;
  const [lowerRowsMounted, setLowerRowsMounted] = useState(0);
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const task = InteractionManager.runAfterInteractions(() => {
      setLowerRowsMounted(1);
      timer = setInterval(() => {
        setLowerRowsMounted((n) => {
          if (n + 1 >= LOWER_ROW_COUNT && timer) clearInterval(timer);
          return Math.min(n + 1, LOWER_ROW_COUNT);
        });
      }, 120);
    });
    return () => {
      task.cancel();
      if (timer) clearInterval(timer);
    };
  }, []);

  // Plays the hero/section entrance transitions the first time this tab is focused.
  // (It used to replay on every refocus, which made coming back to Home feel like
  // the app was re-opening.)
  const [replayToken, setReplayToken] = useState(0);
  useFocusEffect(
    useCallback(() => {
      setReplayToken((v) => (v === 0 ? 1 : v));
    }, [])
  );

  const blocked = useMemo(() => activeProfile?.blockedKeywords || [], [activeProfile?.blockedKeywords]);
  const safeMovies = useMemo(() => filterMovies(playlist?.movies || [], blocked), [playlist, blocked]);
  const safeSeries = useMemo(() => filterSeries(playlist?.series || [], blocked), [playlist, blocked]);

  // Small rotating set of hero slides (Nuvio-style auto-advancing banner) instead of a
  // single static pick. Picked once per playlist load so it doesn't reshuffle on every render.
  const heroSlides = useMemo(() => {
    if (!playlist) return [];
    const pool = safeMovies.filter((m) => m.logo).slice(0, 50);
    const shuffled = [...pool].sort(() => Math.random() - 0.5).slice(0, 5);
    if (shuffled.length > 0) return shuffled;
    return safeSeries.filter((s) => s.logo).slice(0, 5);
  }, [playlist, safeMovies, safeSeries]);

  const trendingMovies = useMemo(() => safeMovies.filter((m) => m.logo).slice(0, 20), [safeMovies]);
  const trendingSeries = useMemo(() => safeSeries.filter((s) => s.logo).slice(0, 20), [safeSeries]);
  const recentChannelObjs = useMemo(() => {
    if (!playlist) return [];
    const map = new Map(playlist.channels.map((c) => [c.id, c]));
    return recentChannels.map((id) => map.get(id)).filter(Boolean) as Channel[];
  }, [recentChannels, playlist]);

  // One card per series: resume the latest episode, or its next episode once
  // finished (see buildContinueWatching). Finished series' episode lists are
  // fetched on demand so the next-up card can appear.
  const episodesBySeries = useSeriesEpisodes((s) => s.bySeries);
  const loadEpisodes = useSeriesEpisodes((s) => s.load);
  const { entries: continueWatching, missingSeries } = useMemo(
    () => buildContinueWatching(history, episodesBySeries, 10),
    [history, episodesBySeries],
  );
  const missingKey = missingSeries.join(",");
  useEffect(() => {
    missingSeries.forEach((sid) => loadEpisodes(sid));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingKey, loadEpisodes]);
  const favoriteList = Object.values(favorites).slice(0, 10);

  const scrollRef = useRef<ScrollView>(null);
  const contentRef = useRef<View>(null);
  const homeScroll = useMemo<HomeScroll>(
    () => ({ contentRef, scrollTo: (y) => scrollRef.current?.scrollTo({ y, animated: true }) }),
    [],
  );

  if (!playlist) {
    return (
      <SafeAreaView style={styles.empty}>
        <Ionicons name="tv-outline" size={48} color={colors.textMuted} />
        <Text style={styles.emptyTitle}>Henüz bir kaynağın yok</Text>
        <Text style={styles.emptyText}>Kanallarına, filmlerine ve dizilerine ulaşmak için bir M3U listesi veya Xtream Codes hesabı bağla.</Text>
        <TouchableOpacity
          style={[styles.emptyBtn, { backgroundColor: accentColor }]}
          onPress={() => router.push({ pathname: "/login", params: { step: "type" } })}
          testID="home-empty-add-source"
        >
          <Ionicons name="add" size={20} color="#000" />
          <Text style={styles.emptyBtnText}>Kaynak Ekle</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const POSTER_W = isTVStyle ? width * 0.14 : Math.min(width * 0.32, 160);

  return (
    <FocusMemoryScope screenKey="home">
    <HomeScrollContext.Provider value={isTVStyle ? homeScroll : null}>
    <View style={styles.root}>
      <ScrollView ref={scrollRef} contentContainerStyle={{ paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
        <View ref={contentRef} collapsable={false}>
        <HeroCarousel slides={heroSlides} replayToken={replayToken} />

        <View style={isTVStyle ? { marginTop: -80, zIndex: 10 } : {}}>
          {continueWatching.length > 0 && (
          <Section title={t("home.continue")} testID="section-continue" delay={0} replayToken={replayToken}>
            <FlashList
              data={continueWatching}
              keyExtractor={(i) => i.item_id}
              horizontal
              // @ts-ignore
              estimatedItemSize={200}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.rowContent}
              renderItem={({ item }) => (
                <ContinueWatchingCard item={item} router={router} accentColor={accentColor} POSTER_W={POSTER_W} />
              )}
            />
          </Section>
        )}

        {recentChannelObjs.length > 0 && (
          <Section title={t("home.recent_channels")} testID="section-recent-channels" delay={70} replayToken={replayToken}>
            <FlashList
              data={recentChannelObjs}
              keyExtractor={(i) => i.id}
              horizontal
              // @ts-ignore
              estimatedItemSize={200}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.rowContent}
              renderItem={({ item }) => (
                <ChannelMini channel={item} epg={epgByChannel[item.epg_channel_id || ""]} router={router} />
              )}
            />
          </Section>
        )}

        {lowerRowsMounted < 1 ? (
          <SkeletonSection itemWidth={POSTER_W} />
        ) : (
        <Section title={t("home.trending_movies")} onMore={() => router.push("/(tabs)/movies")} testID="section-trending-movies" delay={0} replayToken={replayToken}>
          {trendingMovies.length > 0 ? (
            <FlashList
              data={trendingMovies}
              keyExtractor={(i) => i.id}
              horizontal
              // @ts-ignore
              estimatedItemSize={200}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.rowContent}
              renderItem={({ item }) => (
                <HomePosterCard item={item} router={router} POSTER_W={POSTER_W} />
              )}
            />
          ) : vodsLoading ? (
            <SkeletonRow itemWidth={POSTER_W} />
          ) : (
            <View style={{ paddingHorizontal: spacing.xl, paddingVertical: spacing.md }}>
              <Text style={{ color: colors.textMuted }}>Film bulunamadı.</Text>
            </View>
          )}
        </Section>
        )}

        {lowerRowsMounted < 2 ? (
          <SkeletonSection itemWidth={POSTER_W} />
        ) : (
        <Section title={t("home.popular_series")} onMore={() => router.push("/(tabs)/series")} testID="section-popular-series" delay={90} replayToken={replayToken}>
          {trendingSeries.length > 0 ? (
            <FlashList
              data={trendingSeries}
              keyExtractor={(i) => i.id}
              horizontal
              // @ts-ignore
              estimatedItemSize={200}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.rowContent}
              renderItem={({ item }) => (
                <HomePosterCard item={item} router={router} POSTER_W={POSTER_W} isSeries={true} />
              )}
            />
          ) : vodsLoading ? (
            <SkeletonRow itemWidth={POSTER_W} />
          ) : (
            <View style={{ paddingHorizontal: spacing.xl, paddingVertical: spacing.md }}>
              <Text style={{ color: colors.textMuted }}>Dizi bulunamadı.</Text>
            </View>
          )}
        </Section>
        )}

        {lowerRowsMounted >= 3 && favoriteList.length > 0 && (
          <Section title={t("home.favorites")} onMore={() => router.push("/favorites")} testID="section-favorites" delay={180} replayToken={replayToken}>
            <FlashList
              data={favoriteList}
              keyExtractor={(i) => i.item_id}
              horizontal
              // @ts-ignore
              estimatedItemSize={200}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.rowContent}
              renderItem={({ item }) => (
                <HomePosterCard item={item} router={router} POSTER_W={POSTER_W} isFavorite={true} />
              )}
            />
          </Section>
        )}
        </View>
        </View>
      </ScrollView>
    </View>
    </HomeScrollContext.Provider>
    </FocusMemoryScope>
  );
}

// The auto-rotating banner is its own component so that a slide change (every 8s,
// plus its TMDB lookup) only re-renders the banner. It used to live in Home, where
// each rotation re-rendered every poster row - ~180 card renders every 8 seconds,
// which showed up as a periodic freeze on low-end TV boxes.
function HeroCarousel({ slides: heroSlides, replayToken }: { slides: (Movie | Series)[]; replayToken: number }) {
  const router = useRouter();
  const tmdbApiKey = useIPTV((s) => s.tmdbApiKey);
  const activeProfile = useProfiles((s) => s.active());
  const { t } = useI18n();
  const { accentColor } = useTheme();
  const { isTVStyle, isDesktop, isTV } = useResponsive();

  const toggleAppFullscreen = useCallback(() => {
    if (typeof window === "undefined") return;
    if ((window as any).electronAPI) {
      (window as any).electronAPI.toggleFullscreen();
    } else if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen();
    }
  }, []);

  const heroOpacity = useSharedValue(0);
  const heroBottomOpacity = useSharedValue(0);
  const heroBottomY = useSharedValue(16);
  const heroAnimatedStyle = useAnimatedStyle(() => ({ opacity: heroOpacity.value }));
  const heroBottomAnimatedStyle = useAnimatedStyle(() => ({
    opacity: heroBottomOpacity.value,
    transform: [{ translateY: heroBottomY.value }],
  }));

  const [activeSlide, setActiveSlide] = useState(0);
  useEffect(() => { setActiveSlide(0); }, [heroSlides]);
  const hero = heroSlides[activeSlide] || null;

  useEffect(() => {
    if (isTV) {
      // TV boxes: no entrance animation, it competed with the first remote presses.
      heroOpacity.value = 1;
      heroBottomOpacity.value = 1;
      heroBottomY.value = 0;
      return;
    }
    heroOpacity.value = 0;
    heroBottomOpacity.value = 0;
    heroBottomY.value = 16;
    heroOpacity.value = withTiming(1, { duration: 500 });
    heroBottomOpacity.value = withDelay(150, withTiming(1, { duration: 450 }));
    heroBottomY.value = withDelay(150, withSpring(0, { damping: 16, stiffness: 140 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayToken, activeSlide, isTV]);

  const slideTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (slideTimerRef.current) clearInterval(slideTimerRef.current);
    // TV: the banner stays on one title. Each automatic slide change swapped a
    // full-screen backdrop and re-rendered the banner; measured on a 2 GB box, 87% of
    // the frames it produced were janky, often while the user was pressing keys.
    if (heroSlides.length <= 1 || isTV) return;
    slideTimerRef.current = setInterval(() => {
      setActiveSlide((i) => (i + 1) % heroSlides.length);
    }, 8000);
    return () => { if (slideTimerRef.current) clearInterval(slideTimerRef.current); };
  }, [heroSlides.length, isTV]);

  function goToSlide(index: number) {
    setActiveSlide(index);
    if (slideTimerRef.current) clearInterval(slideTimerRef.current);
    if (heroSlides.length > 1) {
      slideTimerRef.current = setInterval(() => {
        setActiveSlide((i) => (i + 1) % heroSlides.length);
      }, 7000);
    }
  }

  // The playlist only gives us a portrait poster for `hero`, never a wide backdrop.
  // TMDB has real backdrops for most well-known titles - fetch one for a proper
  // hero banner; falls back to the blurred poster (see heroBackdropUri) when TMDB
  // has no match or no API key is configured.
  const [heroTmdb, setHeroTmdb] = useState<TMDBMovie | TMDBSeries | null>(null);
  useEffect(() => {
    setHeroTmdb(null);
    if (!hero || !tmdbApiKey) return;
    let cancelled = false;
    const isMovie = "url" in (hero as any);
    const cleanName = cleanIPTVName(hero.name);
    const lookup = isMovie
      ? searchMovie(cleanName, (hero as Movie).year || null, tmdbApiKey)
      : searchSeries(cleanName, null, tmdbApiKey);
    lookup.then((result) => { if (!cancelled) setHeroTmdb(result); });
    return () => { cancelled = true; };
  }, [hero, tmdbApiKey]);
  const heroBackdropUri = getImageUrl(heroTmdb?.backdrop_path || null, "w780") || hero?.logo || undefined;
  const heroPosterUri = getImageUrl(heroTmdb?.poster_path || null) || hero?.logo || undefined;

  return (
    <MaybeAnimatedView style={[styles.hero, { height: hero ? (isTVStyle ? 600 : width * 1.1) : (isTVStyle ? 120 : 120) }, !LOW_END && heroAnimatedStyle]}>
      {hero ? (
        <>
          {/* Prefer a real TMDB backdrop (wide, made for this) - only light-dim it.
              Playlists themselves only give us a portrait poster, so falling back to
              that gets a heavy blur instead: cropping it to the banner's shape reads
              as an abstract background rather than a poster with its top/bottom cut off. */}
          {/* expo-image blurs on the CPU. That used to stall TV boxes because the slide
              changed every 8s; on TV the banner now stays on one title (see the slide
              timer above), so the blur runs once per load and TV can match the phone. */}
          <Image cachePolicy="memory-disk"
            source={{ uri: heroBackdropUri }}
            style={StyleSheet.absoluteFillObject}
            contentFit="cover"
            blurRadius={heroTmdb?.backdrop_path ? 8 : 40}
            transition={isTV ? 0 : 400}
          />
          <LinearGradient
            colors={["rgba(0,0,0,0.35)", "rgba(0,0,0,0.65)", "#000"]}
            style={StyleSheet.absoluteFillObject}
          />
        </>
      ) : (
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: colors.surface }]} />
      )}
      <SafeAreaView style={[
        styles.heroContent, 
        { 
          paddingTop: isTVStyle ? 120 : spacing.xl, 
          paddingBottom: isTVStyle ? (hero ? 80 : spacing.sm) : (hero ? spacing.xl : spacing.sm), 
          justifyContent: hero ? (isTVStyle ? "flex-end" : "space-between") : "flex-start"
        }
      ]} edges={["top"]}>
        {!isTVStyle && (
          <View style={styles.heroTop}>
            <Text style={styles.heroBrand}>
              <Text style={{ color: accentColor }}>lumi</Text>
              <Text style={{ color: "#FFF" }}>o</Text>
            </Text>
            <View style={{ flexDirection: "row", gap: spacing.lg, alignItems: "center" }}>
              <TouchableOpacity onPress={() => router.push("/epg")}>
                <Ionicons name="tv-outline" size={24} color={colors.onSurface} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => router.push("/search")} testID="home-search-button">
                <Ionicons name="search" size={24} color={colors.onSurface} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => router.push("/profiles")}>
                <ProfileAvatar avatar={activeProfile?.avatar} color={activeProfile?.color} size={30} />
              </TouchableOpacity>
            </View>
          </View>
        )}
        {isDesktop && hero && (
          <TouchableOpacity style={styles.heroExpandBtn} onPress={toggleAppFullscreen} testID="home-hero-fullscreen">
            <Ionicons name="expand-outline" size={20} color="#fff" />
          </TouchableOpacity>
        )}
        {hero && (
          <MaybeAnimatedView style={[styles.heroBottom, styles.heroBottomRow, !LOW_END && heroBottomAnimatedStyle]}>
            {heroPosterUri && (
              <Image cachePolicy="memory-disk"
                source={{ uri: heroPosterUri }}
                style={styles.heroPoster}
                contentFit="contain"
                transition={400}
              />
            )}
            <View style={{ flex: 1, gap: spacing.sm }}>
              <Text style={styles.heroLabel}>{t("home.featured")}</Text>
              <Text style={styles.heroTitle} numberOfLines={2}>
                {cleanIPTVName(hero.name)}
              </Text>
              {!!heroTmdb?.overview && (
                <Text style={styles.heroOverview} numberOfLines={2}>{heroTmdb.overview}</Text>
              )}
              <View style={styles.heroBtns}>
                <HeroButton
                  primary={true}
                  accentColor={accentColor}
                  icon="play"
                  label={t("home.play")}
                  testID="home-hero-play"
                  onPress={() => {
                    const isMovie = "url" in (hero as any);
                    if (isMovie) {
                      router.push({ pathname: "/player", params: { url: (hero as Movie).url, title: hero.name, kind: "movie", itemId: (hero as Movie).id, logo: hero.logo || "" } });
                    } else {
                      router.push({ pathname: "/series/[id]", params: { id: (hero as Series).id } });
                    }
                  }}
                />
                {/* Desktop and TV browse via the rail instead. */}
                {!isDesktop && !isTV && (
                  <HeroButton
                    primary={false}
                    icon="grid"
                    label={t("home.browse")}
                    testID="home-hero-browse"
                    onPress={() => router.push("/(tabs)/movies")}
                  />
                )}
              </View>
            </View>
          </MaybeAnimatedView>
        )}
        {heroSlides.length > 1 && !isTV && (
          // Phones: centred under the buttons (bottom-right sat on top of "Gözat").
          <View style={[styles.heroDots, !isTVStyle && !isDesktop && styles.heroDotsPhone]} pointerEvents="box-none">
            {heroSlides.map((_, i) => (
              <Pressable
                key={i}
                onPress={() => goToSlide(i)}
                hitSlop={8}
                testID={`home-hero-dot-${i}`}
                style={[styles.heroDot, i === activeSlide && { backgroundColor: accentColor, width: 20 }]}
              />
            ))}
          </View>
        )}
      </SafeAreaView>
    </MaybeAnimatedView>

  );
}

// Stand-in for a row that hasn't mounted yet: same height as the real thing, so
// the page doesn't jump when the row swaps in.
function SkeletonSection({ itemWidth }: { itemWidth: number }) {
  return (
    <View style={styles.skeletonSection}>
      <View style={styles.skeletonTitle} />
      <SkeletonRow itemWidth={itemWidth} />
    </View>
  );
}

function Section({ title, children, onMore, testID, delay = 0, replayToken }: { title: string; children: React.ReactNode; onMore?: () => void; testID?: string; delay?: number; replayToken?: number }) {
  const { t } = useI18n();
  const { accentColor } = useTheme();
  const { isTV } = useResponsive();
  const opacity = useSharedValue(isTV ? 1 : 0);
  const translateY = useSharedValue(isTV ? 0 : 16);
  useEffect(() => {
    if (isTV) return; // TV boxes: rows appear without the fade/slide-in
    opacity.value = 0;
    translateY.value = 16;
    opacity.value = withDelay(delay, withTiming(1, { duration: 400 }));
    translateY.value = withDelay(delay, withSpring(0, { damping: 16, stiffness: 140 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayToken]);
  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ translateY: translateY.value }] }));
  const homeScroll = useContext(HomeScrollContext);
  const sectionRef = useRef<View>(null);
  const reveal = useCallback(() => {
    const content = homeScroll?.contentRef.current;
    if (!homeScroll || !content || !sectionRef.current) return;
    sectionRef.current.measureLayout(content as any, (_x, y) => homeScroll.scrollTo(Math.max(0, y - 24)), () => {});
  }, [homeScroll]);
  return (
    <RevealRowContext.Provider value={homeScroll ? reveal : null}>
    <MaybeAnimatedView ref={sectionRef as any} style={[styles.section, !LOW_END && animatedStyle]} testID={testID}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {onMore && (
          <TouchableOpacity onPress={onMore}>
            <Text style={[styles.sectionMore, { color: accentColor }]}>{t("home.see_all")}</Text>
          </TouchableOpacity>
        )}
      </View>
      {children}
    </MaybeAnimatedView>
    </RevealRowContext.Provider>
  );
}

function formatRemaining(position: number, duration: number): string | null {
  if (!duration || duration <= 0) return null;
  const remaining = Math.max(0, Math.round(duration - position));
  if (remaining <= 0) return null;
  const h = Math.floor(remaining / 3600);
  const m = Math.round((remaining % 3600) / 60);
  if (h > 0) return `${h}s ${m}dk kaldı`;
  return `${Math.max(1, m)}dk kaldı`;
}

// Cards are memoized: Home re-renders (store updates, lazy row mounting) must not
// re-render every visible poster on a low-end TV box.
const ContinueWatchingCard = React.memo(function ContinueWatchingCard({ item, router, accentColor, POSTER_W }: { item: ContinueEntry } & Record<string, any>) {
  const { focused, animatedStyle, handleFocus, handleBlur, handlePressIn, handlePressOut, hasTVPreferredFocus } =
    useFocusScale(1.04, `continue:${item.item_id}`);
  const remainingLabel = formatRemaining(item.position || 0, item.duration || 0);
  const hasProgress = item.duration > 0 && item.position > 0;
  return (
    <View style={[styles.posterCard, { width: POSTER_W, paddingHorizontal: CARD_GUTTER }]}>
      <CardPressable
        hasTVPreferredFocus={hasTVPreferredFocus}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={() =>
          router.push({
            pathname: "/player",
            params: {
              url: item.url || "",
              title: item.name,
              kind: item.kind,
              itemId: item.item_id,
              seriesId: item.series_id || "",
              position: String(item.position || 0),
              logo: item.logo || "",
            },
          })
        }
        testID={`continue-card-${item.item_id}`}
        focusable={true}
        style={[{ width: "100%", aspectRatio: 16/9 }, animatedStyle]}
      >
        <PosterArt uri={item.logo} title={cleanIPTVName(item.name)} contentFit="cover" recyclingKey={item.item_id} />
        {item.nextUp && (
          <View style={[styles.nextUpBadge, { backgroundColor: accentColor }]}>
            <Ionicons name="play-skip-forward" size={11} color="#fff" />
            <Text style={styles.nextUpBadgeText}>SIRADAKİ</Text>
          </View>
        )}
        {!!remainingLabel && (
          <View style={styles.remainingBadge}>
            <Text style={styles.remainingBadgeText}>{remainingLabel}</Text>
          </View>
        )}
        {hasProgress && (
          <View style={styles.progressBar}>
            <View
              style={[
                styles.progressFill,
                { width: `${Math.min(100, (item.position / item.duration) * 100)}%`, backgroundColor: accentColor },
              ]}
            />
          </View>
        )}
        <FocusRing visible={focused} />
      </CardPressable>
      <Text style={[styles.posterTitle, styles.cardTitle, focused && styles.cardTitleFocused]} numberOfLines={1}>{cleanIPTVName(item.name)}</Text>
      {!!item.episodeLabel && <Text style={styles.episodeLabel}>{item.episodeLabel}</Text>}
    </View>
  );
});

const HomePosterCard = React.memo(function HomePosterCard({ item, router, POSTER_W, isSeries, isFavorite }: any) {
  const row = isFavorite ? "fav" : isSeries ? "series" : "movies";
  const { focused, animatedStyle, handleFocus, handleBlur, handlePressIn, handlePressOut, hasTVPreferredFocus } =
    useFocusScale(1.05, `${row}:${item.item_id || item.id}`);
  return (
    <View style={{ width: POSTER_W, paddingHorizontal: CARD_GUTTER }}>
      <CardPressable
        hasTVPreferredFocus={hasTVPreferredFocus}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={() => {
          if (isFavorite) {
            if (item.kind === "movie") router.push({ pathname: "/movie/[id]", params: { id: item.item_id } });
            else if (item.kind === "series") router.push({ pathname: "/series/[id]", params: { id: item.item_id } });
            else if (item.url) router.push({ pathname: "/player", params: { url: item.url, title: item.name, kind: "live", itemId: item.item_id, logo: item.logo || "" } });
          } else if (isSeries) {
            router.push({ pathname: "/series/[id]", params: { id: item.id } });
          } else {
            router.push({ pathname: "/movie/[id]", params: { id: item.id } });
          }
        }}
        style={[{ width: "100%", aspectRatio: 2/3 }, animatedStyle]}
        focusable={true}
      >
        <PosterArt
          uri={item.logo}
          title={item.kind === "live" ? cleanChannelName(item.name) : cleanIPTVName(item.name)}
          recyclingKey={item.id || item.item_id}
        />
        <FocusRing visible={focused} />
      </CardPressable>
      <Text style={[styles.posterTitle, styles.cardTitle, focused && styles.cardTitleFocused]} numberOfLines={1}>{item.kind === "live" ? cleanChannelName(item.name) : cleanIPTVName(item.name)}</Text>
    </View>
  );
});


const ChannelMini = React.memo(function ChannelMini({ channel, epg, router }: { channel: Channel; epg?: any[]; router: any }) {
  const { accentColor } = useTheme();
  const pushRecent = useIPTV((s) => s.pushRecent);
  const { current } = currentEPG(epg);
  const { focused, animatedStyle, handleFocus, handleBlur, handlePressIn, handlePressOut, hasTVPreferredFocus } =
    useFocusScale(1.06, `recent:${channel.id}`);
  return (
    <CardPressable
      hasTVPreferredFocus={hasTVPreferredFocus}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[
        styles.channelCard,
        { borderRadius: radius.md, borderWidth: 4, borderColor: "transparent", padding: 2 },
        focused && { borderColor: "#fff", backgroundColor: "rgba(255,255,255,0.1)" },
        animatedStyle,
      ]}
      onPress={() => {
        pushRecent(channel.id);
        router.push({ pathname: "/player", params: { url: channel.url, title: channel.name, kind: "live", itemId: channel.id, logo: channel.logo || "" } });
      }}
      testID={`channel-mini-${channel.id}`}
      focusable={true}
    >
      <View style={[styles.channelLogoBox, { borderWidth: 0, width: "100%", overflow: "hidden" }]}>
        <ChannelAvatar
          name={channel.name}
          logo={channel.logo}
          style={{ borderRadius: radius.md }}
          imageStyle={styles.channelLogo}
          textStyle={{ fontSize: 20 }}
        />
      </View>
      <Text style={styles.channelName} numberOfLines={1}>{cleanChannelName(channel.name)}</Text>
      <Text style={styles.channelEpg} numberOfLines={1}>{current?.title || "Yayın akışı yok"}</Text>
    </CardPressable>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: screenBackground },
  empty: { flex: 1, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xxl, gap: spacing.sm },
  emptyTitle: { color: colors.onSurface, fontSize: font.xl, fontWeight: "800", marginTop: spacing.md },
  emptyText: { color: colors.textMuted, textAlign: "center", maxWidth: 320 },
  emptyBtn: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: spacing.xl, paddingVertical: 12, borderRadius: radius.pill, marginTop: spacing.md },
  emptyBtnText: { color: "#000", fontWeight: "700", fontSize: font.base },
  hero: { width: "100%" },
  heroContent: { flex: 1, padding: spacing.xl },
  heroTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  heroBrand: { fontSize: font.xl, fontWeight: "800", letterSpacing: -0.5, textShadowColor: "rgba(0,0,0,0.8)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  heroExpandBtn: {
    position: "absolute", top: spacing.xl, right: spacing.xl, zIndex: 5,
    width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.4)", borderWidth: 1, borderColor: "rgba(255,255,255,0.15)",
  },
  heroDots: {
    position: "absolute", bottom: spacing.xl, right: spacing.xl, zIndex: 5,
    flexDirection: "row", gap: 6,
  },
  heroDotsPhone: { left: 0, right: 0, bottom: 6, justifyContent: "center" },
  heroDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.35)" },
  heroOverview: { color: "rgba(255,255,255,0.75)", fontSize: font.base, lineHeight: 20, maxWidth: 480 },
  heroBottom: { gap: spacing.sm },
  heroBottomRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing.lg },
  heroPoster: { width: 96, height: 144, borderRadius: radius.md, backgroundColor: "rgba(255,255,255,0.08)" },
  heroLabel: { color: colors.textMuted, fontSize: font.sm, fontWeight: "700", letterSpacing: 1.5 },
  heroTitle: { color: colors.onSurface, fontSize: font.xxxl, fontWeight: "800", letterSpacing: -0.5 },
  heroBtns: { flexDirection: "row", gap: spacing.md, marginTop: spacing.md },
  heroPrimary: {
    flexDirection: "row", gap: 8, alignItems: "center",
    backgroundColor: "#fff", paddingHorizontal: spacing.xl, paddingVertical: 8, borderRadius: radius.pill,
    borderWidth: 2, borderColor: "transparent",
  },
  heroPrimaryText: { color: "#000", fontWeight: "700", fontSize: font.lg },
  heroGhost: {
    flexDirection: "row", gap: 8, alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.15)", paddingHorizontal: spacing.lg, paddingVertical: 8, borderRadius: radius.pill,
    borderWidth: 2, borderColor: "transparent",
  },
  heroGhostText: { color: colors.onSurface, fontWeight: "600", fontSize: font.base },

  section: { marginTop: spacing.xl },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  sectionTitle: { color: colors.onSurface, fontSize: font.xl, fontWeight: "700" },
  sectionMore: { fontSize: font.sm, fontWeight: "600" },
  // Vertical room for the focused card's 1.06x scale + ring; without it the row's own
  // bounds clipped the top and bottom of the focus frame.
  // Vertical room for a focused card: ~2.5% scale of a ~300dp poster + 6dp ring, which the
  // horizontal list would otherwise clip at its top and bottom edges.
  rowContent: { paddingHorizontal: spacing.lg, paddingVertical: 20, gap: spacing.md },
  nextUpBadge: {
    position: "absolute",
    top: 8,
    left: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  nextUpBadgeText: { color: "#fff", fontSize: 10, fontWeight: "800", letterSpacing: 0.8 },
  episodeLabel: { color: colors.textMuted, fontSize: 11, fontWeight: "600", marginTop: 1 },
  skeletonSection: { marginTop: spacing.xl, gap: spacing.sm },
  skeletonTitle: { width: 180, height: 22, marginHorizontal: spacing.lg, borderRadius: radius.sm, backgroundColor: "rgba(255,255,255,0.08)" },
  posterCard: { gap: 6 },
  posterImg: {
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
  },
  posterTitle: { color: colors.onSurface, fontSize: font.sm, fontWeight: "600" },
  // Room for the focused card's scale + ring so the title never sits under it.
  // Focus = opacity, not colour: a colour change re-lays out the text on the UI thread.
  cardTitle: { marginTop: 12, paddingHorizontal: 2, color: "#fff", opacity: 0.6 },
  cardTitleFocused: { opacity: 1 },
  remainingBadge: {
    position: "absolute", top: 6, right: 6,
    backgroundColor: "rgba(0,0,0,0.65)", paddingHorizontal: 6, paddingVertical: 3, borderRadius: radius.sm,
  },
  remainingBadgeText: { color: "#fff", fontSize: 10, fontWeight: "700" },
  progressBar: { height: 3, backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 2, overflow: "hidden" },
  progressFill: { height: "100%" },
  // Same left edge as the poster cards (they sit inside a CARD_GUTTER): a card that
  // starts further left "wins" D-pad Left from the row above over the nav rail.
  channelCard: { width: 130, alignItems: "center", gap: 6, marginHorizontal: CARD_GUTTER },
  channelLogoBox: {
    width: 130, height: 80, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary,
    alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border,
  },
  channelLogo: { width: "70%", height: "70%" },
  channelName: { color: colors.onSurface, fontSize: font.sm, fontWeight: "600" },
  channelEpg: { color: colors.textMuted, fontSize: 11 },
});
