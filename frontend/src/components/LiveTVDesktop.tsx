import React, { useMemo, useState, useEffect, useDeferredValue, useRef, useCallback } from "react";
import { LOW_END } from "@/src/utils/perf";
import { View, Text, StyleSheet, Pressable, ScrollView, TextInput, TouchableOpacity, Platform, FlatList } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useIsFocused } from "@react-navigation/native";

import { useIPTV } from "@/src/store/iptv-store";
import { useProfiles } from "@/src/store/profile-store";
import { useI18n } from "@/src/store/i18n-store";
import { filterChannels } from "@/src/utils/content-filter";
import { sortLiveGroups } from "@/src/utils/sort-groups";
import { cleanChannelName } from "@/src/utils/clean-name";
import { ChannelAvatar } from "@/src/components/ChannelAvatar";
import { useTheme } from "@/src/store/theme-store";
import { colors, spacing, radius, font, screenBackground } from "@/src/theme/tokens";
import type { Channel, EPGProgram } from "@/src/types/iptv";
import type { Reminder } from "@/src/store/reminders-store";
import MiniPlayer from "./MiniPlayer";
import { FocusPressable } from "./FocusPressable";
import { fetchCatchupUrl } from "@/src/services/provider";
import { useReminders, reminderId } from "@/src/store/reminders-store";
import { prettyGroup } from "@/src/components/PhoneCategoryBar";

const ALL = "all";
const FAVS = "favs";

const PIXELS_PER_MINUTE = 6;
// TV boxes draw the guide with a weak CPU: every programme block is a view, so keep the
// window to the hours anyone browses from the couch (1h back, 5h ahead).
const IS_NATIVE = Platform.OS !== "web";
const HOURS_BACK = IS_NATIVE ? 1 : 2;
const HOURS_TO_SHOW = IS_NATIVE ? 6 : 24;
const TOTAL_WIDTH = HOURS_TO_SHOW * 60 * PIXELS_PER_MINUTE;
// On TV the preview stream starts only once the selection settles: decoding video is the
// heaviest thing a cheap box does, so zapping through the list shouldn't open each channel.
// Light mode waits longer so scrolling the channel list never starts a decode.
const PREVIEW_DELAY_MS = IS_NATIVE ? (LOW_END ? 2500 : 1000) : 0;

function buildWebVideoUrl(rawUrl: string) {
  const uri = String(rawUrl || "");
  if (!uri || !uri.includes("/api/play/") || uri.includes("proxy=1")) return uri;
  return `${uri}${uri.includes("?") ? "&" : "?"}proxy=1`;
}

export default function LiveTVDesktop() {
  const router = useRouter();
  const playlist = useIPTV((s) => s.playlist);
  const epgByChannel = useIPTV((s) => s.epgByChannel);
  const favorites = useIPTV((s) => s.favorites);
  const toggleFavorite = useIPTV((s) => s.toggleFavorite);
  const pushRecent = useIPTV((s) => s.pushRecent);
  const config = useIPTV((s) => s.config);
  const reminders = useReminders((s) => s.reminders);
  const toggleReminder = useReminders((s) => s.toggle);

  const [activeGroup, setActiveGroup] = useState<string>(ALL);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const activeProfile = useProfiles((s) => s.active());
  const blocked = useMemo(() => activeProfile?.blockedKeywords || [], [activeProfile?.blockedKeywords]);
  const { t } = useI18n();
  const { accentColor } = useTheme();

  const sortedLiveGroups = useMemo(
    () => sortLiveGroups(playlist?.groups.live || [], playlist?.channels || []),
    [playlist]
  );
  const groups = useMemo(() => [ALL, FAVS, ...sortedLiveGroups], [sortedLiveGroups]);

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

  const [previewChannel, setPreviewChannel] = useState<Channel | null>(null);
  // The channel actually streaming in the preview (lags previewChannel on TV, see PREVIEW_DELAY_MS).
  const [streamChannel, setStreamChannel] = useState<Channel | null>(null);
  useEffect(() => {
    if (!PREVIEW_DELAY_MS) {
      setStreamChannel(previewChannel);
      return;
    }
    const t = setTimeout(() => setStreamChannel(previewChannel), PREVIEW_DELAY_MS);
    return () => clearTimeout(t);
  }, [previewChannel]);

  // The Xtream account allows a single stream connection: the preview must be gone
  // before the full-screen player connects, and must not keep streaming while this tab
  // sits in the background.
  const isFocused = useIsFocused();
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (isFocused) setLeaving(false);
  }, [isFocused]);
  const previewActive = isFocused && !leaving;

  const openFullscreen = (ch: Channel) => {
    pushRecent(ch.id);
    const go = () =>
      router.push({ pathname: "/player", params: { url: ch.url, title: ch.name, kind: "live", itemId: ch.id, logo: ch.logo || "" } });
    if (Platform.OS === "web") return go();
    setLeaving(true); // unmount the preview (releases its connection) first
    setTimeout(go, 300);
  };

  // TV remote: first press previews a channel, pressing it again goes full screen
  // (the desktop equivalent of click-to-preview + clicking the preview).
  const onChannelPress = (item: Channel) => {
    if (Platform.OS !== "web" && previewChannel?.id === item.id) openFullscreen(item);
    else setPreviewChannel(item);
  };

  useEffect(() => {
    if (channels.length > 0 && (!previewChannel || !channels.find(c => c.id === previewChannel.id))) {
      setPreviewChannel(channels[0]);
    }
  }, [channels, previewChannel]);

  // --- Numeric zapping: type a channel number to jump straight to it ---
  const [zapBuffer, setZapBuffer] = useState("");
  const zapTimer = useRef<any>(null);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (!/^[0-9]$/.test(e.key)) return;

      setZapBuffer((prev) => {
        const next = (prev + e.key).slice(-4);
        if (zapTimer.current) clearTimeout(zapTimer.current);
        zapTimer.current = setTimeout(() => {
          setZapBuffer((current) => {
            const match = channels.find((c, idx) => (c.number || String(idx + 1)) === current);
            if (match) setPreviewChannel(match);
            return "";
          });
        }, 1200);
        return next;
      });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (zapTimer.current) clearTimeout(zapTimer.current);
    };
  }, [channels]);

  // --- Connection prewarm: open the socket to the stream before the user clicks it ---
  const prewarmed = useRef<Set<string>>(new Set());
  const prewarmChannel = (item: Channel) => {
    if (Platform.OS !== "web" || prewarmed.current.has(item.id)) return;
    prewarmed.current.add(item.id);
    // Only the connection is wanted: drop the body as soon as headers arrive. A live .ts
    // URL never ends, so an unread response kept downloading in the background for good.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    fetch(buildWebVideoUrl(item.url), { signal: ctrl.signal })
      .then(() => ctrl.abort())
      .catch(() => {})
      .finally(() => clearTimeout(timer));
  };

  // --- Catch-up: build a timeshift URL for a past program and play it ---
  const playCatchup = async (item: Channel, prog: any) => {
    if (!config || config.type !== "xtream" || !config.server || !config.username || !config.password) return;
    try {
      const durationMin = Math.round(getDurationMin(prog.start, prog.stop));
      const url = await fetchCatchupUrl(config, item.id, new Date(prog.start).toISOString(), durationMin);
      const data = { url };
      if (data.url) {
        pushRecent(item.id);
        router.push({ pathname: "/player", params: { url: data.url, title: `${item.name} · ${prog.title}`, kind: "live", itemId: item.id, logo: item.logo || "" } });
      }
    } catch {
      // provider unreachable or catchup not actually supported - silently ignore
    }
  };

  // Stable handler for the memoized guide rows (playCatchup/toggleReminder change every render).
  const programActions = useRef({ playCatchup, toggleReminder });
  programActions.current = { playCatchup, toggleReminder };
  const onProgramPress = useCallback((ch: Channel, prog: EPGProgram, action: "catchup" | "remind") => {
    if (action === "catchup") programActions.current.playCatchup(ch, prog);
    else programActions.current.toggleReminder(ch, prog);
  }, []);

  // EPG Grid Calculations
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const int = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(int);
  }, []);

  const [gridStart] = useState(() => {
    const d = new Date();
    d.setHours(d.getHours() - HOURS_BACK, 0, 0, 0);
    return d.getTime();
  });

  const currentTimeOffset = ((now - gridStart) / 60000) * PIXELS_PER_MINUTE;

  const leftListRef = useRef<any>(null);
  const rightListRef = useRef<any>(null);
  // The two lists mirror each other's vertical offset. Only the list the user is
  // scrolling drives the other; the mirrored scroll's own onScroll is ignored, otherwise
  // each programmatic scroll bounced back and forth on every frame.
  const scrollDriver = useRef<"left" | "right" | null>(null);
  const driverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncScroll = (from: "left" | "right", y: number) => {
    if (scrollDriver.current && scrollDriver.current !== from) return;
    scrollDriver.current = from;
    if (driverTimer.current) clearTimeout(driverTimer.current);
    driverTimer.current = setTimeout(() => { scrollDriver.current = null; }, 150);
    (from === "left" ? rightListRef : leftListRef).current?.scrollToOffset({ offset: y, animated: false });
  };

  const previewEpg = previewChannel ? (epgByChannel[previewChannel.epg_channel_id || ""] || []) : [];
  const previewCurrentProg = previewEpg.find((p: any) => new Date(p.start).getTime() <= now && new Date(p.stop).getTime() > now);
  const previewNextProg = previewEpg.find((p: any) => new Date(p.start).getTime() > now);

  const fmtTime = (ts: number | string) => {
    try {
      return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch { return ""; }
  };

  const getDurationMin = (start: string, stop: string) => {
    return Math.max(1, (new Date(stop).getTime() - new Date(start).getTime()) / 60000);
  };

  return (
    <View style={styles.container}>
      {/* EXTREME LEFT SIDEBAR: GROUPS */}
      <View style={styles.sidebar}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={16} color={colors.textMuted} />
          <TextInput
            placeholder={t("live.search")}
            placeholderTextColor={colors.textMuted}
            value={search}
            onChangeText={setSearch}
            style={styles.searchInput}
          />
        </View>
        <FocusPressable
          onPress={() => router.push("/multiview")}
          style={({ focused }: any) => [styles.multiViewBtn, focused && { borderColor: accentColor, backgroundColor: "rgba(255,255,255,0.1)" }]}
          testID="live-multiview"
        >
          <Ionicons name="grid-outline" size={16} color="#fff" />
          <Text style={styles.multiViewText}>Çoklu Ekran</Text>
        </FocusPressable>
        <FlatList
          data={groups}
          keyExtractor={(g) => g}
          renderItem={({ item: g }) => {
            const isActive = activeGroup === g;
            return (
              <FocusPressable
                onPress={() => setActiveGroup(g)}
                style={({ focused }: any) => [
                  styles.groupItem,
                  isActive && { backgroundColor: accentColor },
                  focused && !isActive && { backgroundColor: "rgba(255,255,255,0.1)" },
                  focused && { borderLeftWidth: 3, borderLeftColor: isActive ? "#fff" : accentColor },
                ]}
              >
                <Text style={[styles.groupText, isActive && styles.groupTextActive]}>
                  {g === ALL ? t("live.all") : g === FAVS ? t("live.favorites") : prettyGroup(g)}
                </Text>
              </FocusPressable>
            );
          }}
        />
      </View>

      <View style={styles.content}>
        {/* TOP: MINI PLAYER & INFO */}
        <View style={styles.topArea}>
          <View style={styles.playerWrapper}>
            {streamChannel && previewActive ? (
              <MiniPlayer src={buildWebVideoUrl(streamChannel.url)} isPlaying={true} />
            ) : (
              <View style={styles.noPlayer}><Ionicons name="tv" size={48} color={colors.textMuted} /></View>
            )}
            {zapBuffer.length > 0 && (
              <View style={styles.zapOverlay} pointerEvents="none">
                <Text style={styles.zapText}>{zapBuffer}</Text>
              </View>
            )}
            {previewChannel && (
              <FocusPressable
                style={({ focused }: any) => [
                  StyleSheet.absoluteFill,
                  focused && { borderWidth: 3, borderColor: accentColor },
                ]}
                onPress={() => openFullscreen(previewChannel)}
              >
                <View style={styles.fullscreenIcon}>
                  <Ionicons name="expand" size={24} color="#fff" />
                </View>
              </FocusPressable>
            )}
          </View>
          <View style={styles.infoWrapper}>
            {previewChannel ? (
              <>
                <View style={styles.infoChHeader}>
                  <View style={{ width: 64, height: 64, borderRadius: 8, overflow: "hidden" }}>
                    <ChannelAvatar
                      name={previewChannel.name}
                      logo={previewChannel.logo}
                      imageStyle={styles.infoChLogo}
                      textStyle={{ fontSize: 22 }}
                    />
                  </View>
                  <View>
                    <Text style={styles.infoChName}>{cleanChannelName(previewChannel.name)}</Text>
                    <Text style={styles.infoChGroup}>{prettyGroup(previewChannel.group || "")}</Text>
                  </View>
                </View>

                {previewCurrentProg ? (
                  <View style={styles.infoProgBox}>
                    <Text style={styles.infoNowPlaying}>Şimdi yayında</Text>
                    <Text style={styles.infoProgTitle} numberOfLines={2}>{previewCurrentProg.title}</Text>
                    
                    <View style={styles.progMeta}>
                      <Text style={styles.progTime}>{fmtTime(previewCurrentProg.start)} - {fmtTime(previewCurrentProg.stop)}</Text>
                      <Text style={styles.progDuration}>{Math.round(getDurationMin(previewCurrentProg.start, previewCurrentProg.stop))} min</Text>
                    </View>
                    
                    {/* Progress Bar */}
                    <View style={styles.progressTrack}>
                      <View style={[styles.progressFill, { width: `${Math.min(100, Math.max(0, ((now - new Date(previewCurrentProg.start).getTime()) / (new Date(previewCurrentProg.stop).getTime() - new Date(previewCurrentProg.start).getTime())) * 100))}%`, backgroundColor: accentColor }]} />
                    </View>
                    
                    <Text style={styles.infoProgDesc} numberOfLines={3}>{previewCurrentProg.desc || "Açıklama yok."}</Text>

                    {previewNextProg && (
                      <View style={styles.upNextBox}>
                        <Text style={styles.infoNowPlaying}>Sıradaki</Text>
                        <Text style={styles.upNextTitle}>{previewNextProg.title}</Text>
                        <Text style={styles.progTime}>{fmtTime(previewNextProg.start)} - {fmtTime(previewNextProg.stop)}</Text>
                        {(() => {
                          const on = !!reminders[reminderId(previewChannel.id, previewNextProg.start)];
                          return (
                            <FocusPressable
                              onPress={() => toggleReminder(previewChannel, previewNextProg)}
                              style={({ focused }: any) => [
                                styles.remindBtn,
                                on && { backgroundColor: accentColor, borderColor: accentColor },
                                focused && { borderColor: "#fff" },
                              ]}
                              testID="live-remind-next"
                            >
                              <Ionicons name={on ? "notifications" : "notifications-outline"} size={14} color="#fff" />
                              <Text style={styles.remindText}>{on ? "Hatırlatıcı kuruldu" : "Hatırlat"}</Text>
                            </FocusPressable>
                          );
                        })()}
                      </View>
                    )}
                  </View>
                ) : (
                  <View style={styles.infoProgBox}>
                    <Text style={styles.infoProgDesc}>Bu kanal için yayın akışı bilgisi yok.</Text>
                  </View>
                )}
              </>
            ) : null}
          </View>
        </View>

        {/* BOTTOM: 2D EPG GRID */}
        <View style={styles.gridContainer}>
          {/* LEFT COLUMN: Channels */}
          <View style={styles.gridLeftCol}>
            <View style={styles.gridHeaderLeft}>
              <Ionicons name="search" size={16} color={colors.textMuted} />
              <Text style={styles.gridHeaderText}>Kanallar</Text>
            </View>
            <FlashList
              ref={leftListRef}
              data={channels}
              keyExtractor={(c) => c.id}
              showsVerticalScrollIndicator={false}
              scrollEventThrottle={16}
              onScroll={(e) => syncScroll("left", e.nativeEvent.contentOffset.y)}
              renderItem={({ item, index }) => {
                const isSelected = previewChannel?.id === item.id;
                return (
                  <FocusPressable
                    style={({ focused }: any) => [
                      styles.channelCell,
                      isSelected && { backgroundColor: "rgba(255,255,255,0.05)" },
                      focused && { backgroundColor: "rgba(255,255,255,0.1)", borderLeftWidth: 3, borderLeftColor: accentColor },
                    ]}
                    onPress={() => onChannelPress(item)}
                    // @ts-ignore - web-only hover event, used to prewarm the stream connection
                    onHoverIn={() => prewarmChannel(item)}
                  >
                    <Text style={styles.chNum}>{item.number || index + 1}</Text>
                    <View style={{ width: 32, height: 32, marginRight: 10, borderRadius: 4, overflow: "hidden" }}>
                      <ChannelAvatar name={item.name} logo={item.logo} imageStyle={styles.chLogo} textStyle={{ fontSize: 12 }} />
                    </View>
                    <Text style={[styles.chNameText, isSelected && { color: accentColor }]} numberOfLines={1}>{cleanChannelName(item.name)}</Text>
                    {item.catchup && <Ionicons name="time-outline" size={14} color={colors.textMuted} style={{ marginRight: 4 }} />}
                    <Pressable onPress={() => toggleFavorite({ item_id: item.id, kind: "live", name: item.name, logo: item.logo, url: item.url })}>
                      <Ionicons name={favorites[item.id] ? "heart" : "heart-outline"} size={16} color={favorites[item.id] ? colors.error : colors.textMuted} />
                    </Pressable>
                  </FocusPressable>
                );
              }}
            />
          </View>

          {/* RIGHT COLUMN: Scrolling Grid */}
          <ScrollView horizontal showsHorizontalScrollIndicator={true} style={styles.gridScrollArea} contentContainerStyle={{width: TOTAL_WIDTH}}>
            {/* Timeline Header */}
            <View style={styles.timelineHeader}>
              {Array.from({ length: HOURS_TO_SHOW }).map((_, i) => {
                const d = new Date(gridStart + i * 3600000);
                return (
                  <View key={i} style={[styles.timeSlot, { width: 60 * PIXELS_PER_MINUTE }]}>
                    <Text style={styles.timeSlotText}>{d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
                  </View>
                );
              })}
            </View>

            {/* Current Time Blue Line */}
            {currentTimeOffset > 0 && currentTimeOffset < TOTAL_WIDTH && (
              <View style={[styles.currentTimeLine, { left: currentTimeOffset, backgroundColor: accentColor }]} />
            )}

            {/* Programs List */}
            <FlashList
              ref={rightListRef}
              data={channels}
              keyExtractor={(c) => c.id}
              showsVerticalScrollIndicator={true}
              scrollEventThrottle={16}
              onScroll={(e) => syncScroll("right", e.nativeEvent.contentOffset.y)}
              renderItem={({ item }) => (
                <GuideRow
                  channel={item}
                  progs={epgByChannel[item.epg_channel_id || ""]}
                  gridStart={gridStart}
                  now={now}
                  isSelected={previewChannel?.id === item.id}
                  accentColor={accentColor}
                  reminders={reminders}
                  onProgramPress={onProgramPress}
                />
              )}
            />
          </ScrollView>
        </View>
      </View>
    </View>
  );
}

function fmtClock(ts: number | string) {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

/**
 * One channel's row of the guide. Memoized: on a TV box re-rendering every row's
 * programme blocks on each selection change was a large part of the lag.
 */
const GuideRow = React.memo(function GuideRow({
  channel,
  progs,
  gridStart,
  now,
  isSelected,
  accentColor,
  reminders,
  onProgramPress,
}: {
  channel: Channel;
  progs: EPGProgram[] | undefined;
  gridStart: number;
  now: number;
  isSelected: boolean;
  accentColor: string;
  reminders: Record<string, Reminder>;
  onProgramPress: (ch: Channel, prog: EPGProgram, action: "catchup" | "remind") => void;
}) {
  const gridEnd = gridStart + HOURS_TO_SHOW * 3600000;
  const blocks = useMemo(() => {
    const out: { p: EPGProgram; s: number; e: number }[] = [];
    for (const p of progs || []) {
      const s = new Date(p.start).getTime();
      const e = new Date(p.stop).getTime();
      if (s < gridEnd && e > gridStart) out.push({ p, s, e });
    }
    return out;
  }, [progs, gridStart, gridEnd]);

  return (
    <View style={[styles.programsRow, isSelected && { backgroundColor: "rgba(255,255,255,0.02)" }]}>
      {blocks.length > 0 ? blocks.map(({ p, s, e }, idx) => {
        const blockStart = Math.max(gridStart, s);
        const blockEnd = Math.min(gridEnd, e);
        const width = ((blockEnd - blockStart) / 60000) * PIXELS_PER_MINUTE;
        const left = ((blockStart - gridStart) / 60000) * PIXELS_PER_MINUTE;
        const isLive = s <= now && e > now;
        const canCatchup = e <= now && !!channel.catchup;
        const isFuture = s > now;
        const hasReminder = isFuture && !!reminders[reminderId(channel.id, p.start)];
        const BlockTag: any = canCatchup || isFuture ? Pressable : View;
        const action = canCatchup ? "catchup" : isFuture ? "remind" : null;
        return (
          <BlockTag
            key={`${p.start}-${idx}`}
            style={[styles.progBlock, { left, width }, isLive && { backgroundColor: "rgba(255,255,255,0.1)", borderColor: accentColor }, canCatchup && { borderColor: accentColor, borderStyle: "dashed" }, hasReminder && { backgroundColor: "rgba(255,255,255,0.06)" }]}
            {...(action ? { onPress: () => onProgramPress(channel, p, action) } : {})}
          >
            <Text style={[styles.progBlockTitle, isLive && { color: accentColor }]} numberOfLines={1}>
              {hasReminder ? "🔔 " : ""}{p.title}
            </Text>
            <Text style={styles.progBlockTime}>{fmtClock(p.start)} - {fmtClock(p.stop)}{canCatchup ? "  ↻" : ""}</Text>
          </BlockTag>
        );
      }) : (
        <View style={styles.noDataRow}><Text style={styles.noDataText}>Veri yok</Text></View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: "row", backgroundColor: screenBackground },
  sidebar: { width: 220, backgroundColor: colors.surfaceSecondary, borderRightWidth: 1, borderColor: colors.border },
  searchBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.border, margin: spacing.md, paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.md },
  // @ts-ignore
  searchInput: { flex: 1, color: colors.onSurface, fontSize: font.base, padding: 0, outlineStyle: "none" as any },
  multiViewBtn: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: spacing.md, marginBottom: spacing.md, paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.md, backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 2, borderColor: "transparent" },
  multiViewText: { color: colors.onSurface, fontSize: font.sm, fontWeight: "700" },
  groupItem: { paddingHorizontal: spacing.lg, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  groupText: { color: colors.textMuted, fontSize: font.sm, fontWeight: "600", textTransform: "uppercase" },
  groupTextActive: { color: colors.onSurface, fontWeight: "800" },
  
  content: { flex: 1, flexDirection: "column" },
  topArea: { height: 320, flexDirection: "row", borderBottomWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  playerWrapper: { aspectRatio: 16 / 9, height: 320, backgroundColor: "#000", position: "relative" },
  noPlayer: { flex: 1, alignItems: "center", justifyContent: "center" },
  fullscreenIcon: { position: "absolute", bottom: 16, right: 16, backgroundColor: "rgba(0,0,0,0.5)", padding: 8, borderRadius: 20 },
  zapOverlay: { position: "absolute", top: 12, right: 12, backgroundColor: "rgba(0,0,0,0.75)", paddingHorizontal: 14, paddingVertical: 6, borderRadius: radius.md, zIndex: 30 },
  zapText: { color: "#fff", fontSize: 22, fontWeight: "800", letterSpacing: 2, fontVariant: ["tabular-nums"] },
  
  infoWrapper: { flex: 1, padding: spacing.xl, backgroundColor: colors.surfaceSecondary, borderLeftWidth: 1, borderColor: colors.border },
  infoChHeader: { flexDirection: "row", alignItems: "center", gap: 16, marginBottom: 24, borderBottomWidth: 1, borderColor: colors.border, paddingBottom: 16 },
  infoChLogo: { width: 64, height: 64, borderRadius: 8, backgroundColor: colors.surface },
  infoChName: { color: colors.onSurface, fontSize: 20, fontWeight: "800", textTransform: "uppercase" },
  infoChGroup: { color: colors.textMuted, fontSize: 13, marginTop: 2, textTransform: "uppercase" },
  
  infoProgBox: { flex: 1 },
  infoNowPlaying: { color: colors.textMuted, fontSize: 12, textTransform: "uppercase", fontWeight: "700", marginBottom: 6 },
  infoProgTitle: { color: colors.onSurface, fontSize: 24, fontWeight: "700", marginBottom: 12 },
  progMeta: { flexDirection: "row", alignItems: "center", gap: 16, marginBottom: 12 },
  progTime: { color: colors.textMuted, fontSize: 14, fontWeight: "600" },
  progDuration: { color: colors.textMuted, fontSize: 14 },
  progressTrack: { height: 4, backgroundColor: colors.border, borderRadius: 2, marginBottom: 16, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 2 },
  infoProgDesc: { color: colors.textMuted, fontSize: 14, lineHeight: 22 },
  upNextBox: { marginTop: 24, paddingTop: 16, borderTopWidth: 1, borderColor: colors.border },
  remindBtn: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", marginTop: 10, paddingVertical: 6, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 2, borderColor: colors.borderStrong },
  remindText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  upNextTitle: { color: colors.onSurface, fontSize: 16, fontWeight: "600", marginBottom: 4 },
  
  gridContainer: { flex: 1, flexDirection: "row", backgroundColor: colors.surface },
  gridLeftCol: { width: 260, borderRightWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary, zIndex: 10 },
  gridHeaderLeft: { height: 40, flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, gap: 8, borderBottomWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary },
  gridHeaderText: { color: colors.textMuted, fontSize: 12, fontWeight: "700" },
  channelCell: { flexDirection: "row", alignItems: "center", height: 60, paddingHorizontal: spacing.md, borderBottomWidth: 1, borderColor: colors.border },
  chNum: { color: colors.textMuted, fontSize: 12, width: 28 },
  chLogo: { width: 32, height: 32, borderRadius: 4, backgroundColor: colors.border },
  chNameText: { color: colors.onSurface, fontSize: 13, fontWeight: "600", flex: 1, textTransform: "uppercase" },
  
  gridScrollArea: { flex: 1, backgroundColor: colors.surface, position: "relative" },
  timelineHeader: { height: 40, flexDirection: "row", borderBottomWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary },
  timeSlot: { justifyContent: "center", paddingLeft: 8, borderLeftWidth: 1, borderColor: colors.border },
  timeSlotText: { color: colors.textMuted, fontSize: 12, fontWeight: "600" },
  
  currentTimeLine: { position: "absolute", top: 40, bottom: 0, width: 2, zIndex: 20 },
  
  programsRow: { height: 60, borderBottomWidth: 1, borderColor: colors.border, position: "relative" },
  progBlock: { position: "absolute", height: "100%", justifyContent: "center", paddingHorizontal: 12, borderLeftWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  progBlockTitle: { color: colors.onSurface, fontSize: 13, fontWeight: "500", marginBottom: 2 },
  progBlockTime: { color: colors.textMuted, fontSize: 11 },
  
  noDataRow: { flex: 1, justifyContent: "center", paddingLeft: 16 },
  noDataText: { color: colors.border, fontSize: 12 }
});
