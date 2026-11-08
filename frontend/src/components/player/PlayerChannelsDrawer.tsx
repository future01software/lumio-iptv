import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  FlatList,
  ScrollView,
  TextInput,
  Platform,
  Animated,
  PanResponder,
  BackHandler,
} from "react-native";
import { BlurView } from "expo-blur";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";

import { ChannelAvatar } from "@/src/components/ChannelAvatar";
import { prettyGroup } from "@/src/components/PhoneCategoryBar";
import { useIPTV, currentEPG, getEpgNow } from "@/src/store/iptv-store";
import { useProfiles } from "@/src/store/profile-store";
import { useI18n } from "@/src/store/i18n-store";
import { filterChannels } from "@/src/utils/content-filter";
import { sortLiveGroups } from "@/src/utils/sort-groups";
import { cleanChannelName } from "@/src/utils/clean-name";
import { glassPanel } from "./styles";
import { spacing, font, radius } from "@/src/theme/tokens";
import type { Channel, EPGProgram } from "@/src/types/iptv";

/**
 * - side:  desktop / tablet / landscape phone - frosted panel on the left, video stays visible.
 * - strip: TV - horizontal card row at the bottom; D-pad left/right zaps, up reaches the categories.
 * - sheet: portrait phone - bottom sheet within thumb reach, drag down to close.
 */
export type ChannelsDrawerVariant = "side" | "strip" | "sheet";

type Props = {
  visible: boolean;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  channels: Channel[];
  selectedId?: string;
  onSelect: (channel: Channel) => void;
  accentColor: string;
  variant: ChannelsDrawerVariant;
};

const ALL = "all";
const FAVS = "favs";

/** Groups, filter and search shared by all three layouts. */
function useChannelBrowser(channels: Channel[], selectedId: string | undefined, open: boolean) {
  const playlist = useIPTV((s) => s.playlist);
  const favorites = useIPTV((s) => s.favorites);
  const activeProfile = useProfiles((s) => s.active());
  const blocked = useMemo(() => activeProfile?.blockedKeywords || [], [activeProfile?.blockedKeywords]);

  const groups = useMemo(() => {
    const live = sortLiveGroups(playlist?.groups.live || [], playlist?.channels || []);
    return [ALL, FAVS, ...live];
  }, [playlist]);

  const [group, setGroup] = useState(ALL);
  const [search, setSearch] = useState("");
  const query = useDeferredValue(search);

  // Each time the list opens, start in the current channel's category.
  useEffect(() => {
    if (!open) return;
    const current = channels.find((c) => String(c.id) === String(selectedId));
    setGroup(current?.group && groups.includes(current.group) ? current.group : ALL);
    setSearch("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const list = useMemo(() => {
    let out = filterChannels(channels, blocked);
    const q = query.trim().toLowerCase();
    // A search looks through every channel, not only the open category.
    if (q) return out.filter((c) => c.name.toLowerCase().includes(q) || (c.number || "") === q);
    if (group === FAVS) out = out.filter((c) => favorites[c.id]);
    else if (group !== ALL) out = out.filter((c) => c.group === group);
    return out;
  }, [channels, blocked, group, favorites, query]);

  const selectedIndex = list.findIndex((c) => String(c.id) === String(selectedId));
  return { groups, group, setGroup, search, setSearch, list, selectedIndex, favorites };
}

function useNowPlaying(channel: Channel) {
  const programs = useIPTV((s) => s.epgByChannel[channel.epg_channel_id || ""]);
  return currentEPG(programs).current;
}

function progressOf(p?: EPGProgram) {
  if (!p) return 0;
  const start = new Date(p.start).getTime();
  const stop = new Date(p.stop).getTime();
  const now = new Date(getEpgNow()).getTime();
  return stop > start ? Math.min(1, Math.max(0, (now - start) / (stop - start))) : 0;
}

function groupLabel(g: string, t: (k: string) => string) {
  return g === ALL ? t("live.all") : g === FAVS ? t("live.favorites") : prettyGroup(g);
}

function useCloseOnBack(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open || Platform.OS === "web") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [open, onClose]);
}

export function PlayerChannelsDrawer(props: Props) {
  if (!props.visible) return null;
  if (props.variant === "strip") return <ChannelStrip {...props} />;
  if (props.variant === "sheet") return <ChannelSheet {...props} />;
  return <ChannelSidePanel {...props} />;
}

// ---------------------------------------------------------------------------
// Shared pieces

function EdgeTab({ onPress }: { onPress: () => void }) {
  return (
    <Pressable style={styles.edgeTab} onPress={onPress} hitSlop={10} testID="player-channels-tab">
      <Ionicons name="list" size={20} color="#fff" />
    </Pressable>
  );
}

function CategoryChips({ groups, group, setGroup, accentColor, large, selectOnFocus }: {
  groups: string[];
  group: string;
  setGroup: (g: string) => void;
  accentColor: string;
  large?: boolean;
  selectOnFocus?: boolean;
}) {
  const { t } = useI18n();
  // Keep the active category in view (it may be far to the right when the list opens).
  const scrollRef = useRef<ScrollView>(null);
  const offsets = useRef<Record<string, number>>({});
  const scrollToActive = (g: string) => {
    const x = offsets.current[g];
    if (x != null) scrollRef.current?.scrollTo({ x: Math.max(0, x - 24), animated: true });
  };
  useEffect(() => {
    scrollToActive(group);
  }, [group]);

  return (
    <ScrollView ref={scrollRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      {groups.map((g) => {
        const active = g === group;
        return (
          <Pressable
            key={g}
            onLayout={(e) => {
              offsets.current[g] = e.nativeEvent.layout.x;
              if (g === group) scrollToActive(g);
            }}
            focusable
            onFocus={selectOnFocus ? () => setGroup(g) : undefined}
            onPress={() => setGroup(g)}
            style={({ focused }: any) => [
              styles.chip,
              large && styles.chipLarge,
              active && { backgroundColor: accentColor, borderColor: accentColor },
              focused && { borderColor: "#fff" },
            ]}
          >
            <Text style={[styles.chipText, large && styles.chipTextLarge, active && styles.chipTextActive]} numberOfLines={1}>
              {groupLabel(g, t)}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function SearchField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  return (
    <View style={styles.search}>
      <Ionicons name="search" size={16} color="rgba(255,255,255,0.6)" />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={t("live.search")}
        placeholderTextColor="rgba(255,255,255,0.45)"
        style={styles.searchInput}
        autoCorrect={false}
        autoCapitalize="none"
        testID="player-channels-search"
      />
      {!!value && (
        <Pressable onPress={() => onChange("")} hitSlop={8}>
          <Ionicons name="close-circle" size={16} color="rgba(255,255,255,0.6)" />
        </Pressable>
      )}
    </View>
  );
}

const ROW_HEIGHT = 64;

const ChannelRow = React.memo(function ChannelRow({ item, index, selected, highlighted, isFav, accentColor, onSelect }: {
  item: Channel;
  index: number;
  selected: boolean;
  highlighted: boolean;
  isFav: boolean;
  accentColor: string;
  onSelect: (c: Channel) => void;
}) {
  const now = useNowPlaying(item);
  return (
    <Pressable
      focusable
      onPress={() => onSelect(item)}
      style={({ focused, hovered }: any) => [
        styles.row,
        (hovered || highlighted) && styles.rowHover,
        selected && styles.rowSelected,
        (focused || highlighted) && { borderColor: accentColor },
      ]}
    >
      {selected && <View style={[styles.rowMarker, { backgroundColor: accentColor }]} />}
      <Text style={styles.rowNum}>{item.number || index + 1}</Text>
      <View style={styles.rowLogo}>
        <ChannelAvatar name={item.name} logo={item.logo} imageStyle={styles.logoImg} textStyle={{ fontSize: 12 }} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.rowName, selected && { color: accentColor }]} numberOfLines={1}>
          {cleanChannelName(item.name)}
        </Text>
        {now ? (
          <>
            <Text style={styles.rowProg} numberOfLines={1}>{now.title}</Text>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${Math.round(progressOf(now) * 100)}%`, backgroundColor: accentColor }]} />
            </View>
          </>
        ) : (
          !!item.group && <Text style={styles.rowProg} numberOfLines={1}>{prettyGroup(item.group)}</Text>
        )}
      </View>
      {isFav && <Ionicons name="heart" size={14} color={accentColor} style={{ marginLeft: 6 }} />}
    </Pressable>
  );
});

function ChannelList({ browser, selectedId, accentColor, onSelect, highlighted = -1 }: {
  browser: ReturnType<typeof useChannelBrowser>;
  selectedId?: string;
  accentColor: string;
  onSelect: (c: Channel) => void;
  highlighted?: number;
}) {
  const { t } = useI18n();
  const ref = useRef<FlatList<Channel>>(null);
  const { list, selectedIndex, favorites } = browser;

  useEffect(() => {
    if (highlighted < 0 || highlighted >= list.length) return;
    ref.current?.scrollToIndex({ index: highlighted, viewPosition: 0.5, animated: true });
  }, [highlighted, list.length]);

  if (!list.length) {
    return <Text style={styles.empty}>{t("live.no_results")}</Text>;
  }
  return (
    <FlatList
      ref={ref}
      data={list}
      // A new category or search starts a fresh list (and its initial scroll position).
      key={`${browser.group}|${browser.search}`}
      keyExtractor={(c) => String(c.id)}
      initialNumToRender={16}
      maxToRenderPerBatch={16}
      windowSize={7}
      removeClippedSubviews={Platform.OS === "android"}
      getItemLayout={(_, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index })}
      initialScrollIndex={selectedIndex > 3 ? selectedIndex - 3 : 0}
      keyboardShouldPersistTaps="handled"
      renderItem={({ item, index }) => (
        <ChannelRow
          item={item}
          index={index}
          selected={String(item.id) === String(selectedId)}
          highlighted={index === highlighted}
          isFav={!!favorites[item.id]}
          accentColor={accentColor}
          onSelect={onSelect}
        />
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// Desktop / tablet: left side panel

function ChannelSidePanel({ open, onToggle, onClose, channels, selectedId, onSelect, accentColor }: Props) {
  const browser = useChannelBrowser(channels, selectedId, open);
  const [highlighted, setHighlighted] = useState(-1);
  useCloseOnBack(open, onClose);

  useEffect(() => {
    setHighlighted(-1);
  }, [open, browser.group, browser.search]);

  // Keyboard (Mac / PC): C toggles, Esc closes, arrows + Enter pick a channel.
  const keyState = useRef({ open, highlighted, list: browser.list, selectedIndex: browser.selectedIndex, onToggle, onClose, onSelect });
  keyState.current = { open, highlighted, list: browser.list, selectedIndex: browser.selectedIndex, onToggle, onClose, onSelect };
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const onKeyDown = (e: KeyboardEvent) => {
      const s = keyState.current;
      const typing = (e.target as HTMLElement | null)?.tagName === "INPUT";
      const isC = e.key.toLowerCase() === "c" && !e.metaKey && !e.ctrlKey && !e.altKey;
      if (!s.open) {
        if (!typing && isC) {
          e.preventDefault();
          s.onToggle();
        }
        return;
      }
      if (e.key === "Escape" || (!typing && isC)) {
        e.preventDefault();
        s.onClose();
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (!s.list.length) return;
        const from = s.highlighted >= 0 ? s.highlighted : Math.max(0, s.selectedIndex);
        const step = s.highlighted >= 0 || s.selectedIndex < 0 ? (e.key === "ArrowDown" ? 1 : -1) : 0;
        setHighlighted(Math.min(s.list.length - 1, Math.max(0, from + step)));
      } else if (e.key === "Enter" && s.highlighted >= 0 && s.list[s.highlighted]) {
        e.preventDefault();
        s.onSelect(s.list[s.highlighted]);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (!open) return <EdgeTab onPress={onToggle} />;
  return (
    <View style={styles.sideOverlay} pointerEvents="box-none">
      <SafeAreaView edges={["top", "bottom", "left"]} style={styles.sidePanel} testID="player-channels-panel">
        <BlurView intensity={glassPanel.blurIntensity} tint={glassPanel.blurTint} style={StyleSheet.absoluteFillObject} />
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Kanallar</Text>
          {Platform.OS === "web" && <Text style={styles.headerHint}>C · Esc · ↑↓</Text>}
          <Pressable onPress={onClose} hitSlop={10} testID="player-channels-close">
            <Ionicons name="close" size={22} color="#fff" />
          </Pressable>
        </View>
        <View style={styles.sideTools}>
          <SearchField value={browser.search} onChange={browser.setSearch} />
          <CategoryChips groups={browser.groups} group={browser.group} setGroup={browser.setGroup} accentColor={accentColor} />
        </View>
        <ChannelList browser={browser} selectedId={selectedId} accentColor={accentColor} onSelect={onSelect} highlighted={highlighted} />
      </SafeAreaView>
      <Pressable style={styles.backdrop} onPress={onClose} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// TV: bottom strip of channel cards

const CARD_WIDTH = 240;
const CARD_GAP = 14;

const StripCard = React.memo(function StripCard({ item, selected, accentColor, onSelect, preferFocus }: {
  item: Channel;
  selected: boolean;
  accentColor: string;
  onSelect: (c: Channel) => void;
  preferFocus: boolean;
}) {
  const now = useNowPlaying(item);
  return (
    <Pressable
      focusable
      hasTVPreferredFocus={preferFocus}
      onPress={() => onSelect(item)}
      style={({ focused }: any) => [
        styles.card,
        selected && styles.cardSelected,
        focused && { borderColor: accentColor, backgroundColor: "rgba(255,255,255,0.2)", transform: [{ scale: 1.06 }] },
      ]}
    >
      <View style={styles.cardTop}>
        <View style={styles.cardLogo}>
          <ChannelAvatar name={item.name} logo={item.logo} imageStyle={styles.logoImg} textStyle={{ fontSize: 14 }} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          {!!item.number && <Text style={styles.cardNum}>{item.number}</Text>}
          <Text style={[styles.cardName, selected && { color: accentColor }]} numberOfLines={1}>{cleanChannelName(item.name)}</Text>
        </View>
      </View>
      <Text style={styles.cardProg} numberOfLines={1}>{now?.title || " "}</Text>
      <View style={styles.track}>
        {!!now && <View style={[styles.fill, { width: `${Math.round(progressOf(now) * 100)}%`, backgroundColor: accentColor }]} />}
      </View>
    </Pressable>
  );
});

function ChannelStrip({ open, onToggle, onClose, channels, selectedId, onSelect, accentColor }: Props) {
  const browser = useChannelBrowser(channels, selectedId, open);
  useCloseOnBack(open, onClose);
  const { list, selectedIndex } = browser;
  const startIndex = Math.max(0, selectedIndex);

  if (!open) return <EdgeTab onPress={onToggle} />;
  return (
    <View style={styles.stripOverlay} pointerEvents="box-none">
      <Pressable style={styles.backdrop} onPress={onClose} focusable={false} />
      <View style={styles.strip} testID="player-channels-strip">
        <View style={styles.stripChips}>
          <CategoryChips
            groups={browser.groups}
            group={browser.group}
            setGroup={browser.setGroup}
            accentColor={accentColor}
            large
            selectOnFocus
          />
        </View>
        {list.length ? (
          <FlatList
            horizontal
            data={list}
            key={browser.group}
            keyExtractor={(c) => String(c.id)}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.stripList}
            getItemLayout={(_, index) => ({ length: CARD_WIDTH + CARD_GAP, offset: (CARD_WIDTH + CARD_GAP) * index, index })}
            initialScrollIndex={startIndex}
            initialNumToRender={8}
            windowSize={5}
            renderItem={({ item, index }) => (
              <StripCard
                item={item}
                selected={String(item.id) === String(selectedId)}
                accentColor={accentColor}
                onSelect={onSelect}
                preferFocus={index === startIndex}
              />
            )}
          />
        ) : (
          <Text style={[styles.empty, { paddingVertical: spacing.xl }]}>Bu kategoride kanal yok.</Text>
        )}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Phone (portrait): bottom sheet

function ChannelSheet({ open, onToggle, onClose, channels, selectedId, onSelect, accentColor }: Props) {
  const browser = useChannelBrowser(channels, selectedId, open);
  useCloseOnBack(open, onClose);
  const drag = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (open) drag.setValue(0);
  }, [open, drag]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderMove: (_, g) => drag.setValue(Math.max(0, g.dy)),
        onPanResponderRelease: (_, g) => {
          if (g.dy > 120 || g.vy > 1) onClose();
          else Animated.spring(drag, { toValue: 0, useNativeDriver: Platform.OS !== "web" }).start();
        },
      }),
    [drag, onClose]
  );

  if (!open) return <EdgeTab onPress={onToggle} />;
  return (
    <View style={styles.sheetOverlay} pointerEvents="box-none">
      <Pressable style={styles.backdrop} onPress={onClose} />
      <Animated.View style={[styles.sheet, { transform: [{ translateY: drag }] }]} testID="player-channels-sheet">
        <BlurView intensity={glassPanel.blurIntensity} tint={glassPanel.blurTint} style={StyleSheet.absoluteFillObject} />
        <View {...pan.panHandlers} style={styles.sheetGrab}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.headerTitle}>Kanallar</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={22} color="#fff" />
            </Pressable>
          </View>
        </View>
        <View style={styles.sideTools}>
          <SearchField value={browser.search} onChange={browser.setSearch} />
          <CategoryChips groups={browser.groups} group={browser.group} setGroup={browser.setGroup} accentColor={accentColor} />
        </View>
        <SafeAreaView edges={["bottom"]} style={{ flex: 1 }}>
          <ChannelList browser={browser} selectedId={selectedId} accentColor={accentColor} onSelect={onSelect} />
        </SafeAreaView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  edgeTab: {
    position: "absolute",
    left: 0,
    top: "50%",
    marginTop: -24,
    width: 28,
    height: 48,
    borderTopRightRadius: 14,
    borderBottomRightRadius: 14,
    backgroundColor: "rgba(20,20,24,0.7)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 20,
  },
  backdrop: { flex: 1 },

  // side
  sideOverlay: { ...StyleSheet.absoluteFillObject, flexDirection: "row", zIndex: 30 },
  sidePanel: {
    width: 380,
    maxWidth: "85%",
    height: "100%",
    overflow: "hidden",
    backgroundColor: glassPanel.backgroundColor,
    borderRightWidth: 1,
    borderRightColor: "rgba(255,255,255,0.12)",
  },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, paddingBottom: spacing.sm },
  headerTitle: { color: "#fff", fontSize: font.lg, fontWeight: "bold", flex: 1 },
  headerHint: { color: "rgba(255,255,255,0.45)", fontSize: 12 },
  sideTools: { paddingHorizontal: spacing.md, gap: spacing.sm, paddingBottom: spacing.sm },

  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 36,
    paddingHorizontal: 10,
    borderRadius: radius.md,
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  searchInput: {
    flex: 1,
    color: "#fff",
    fontSize: font.base,
    height: "100%",
    ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : null),
  },

  chips: { gap: 6, paddingRight: spacing.md },
  chip: {
    paddingHorizontal: 12,
    height: 28,
    justifyContent: "center",
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  chipLarge: { height: 40, paddingHorizontal: 18, borderWidth: 2 },
  chipText: { color: "rgba(255,255,255,0.75)", fontSize: 13, maxWidth: 180 },
  chipTextLarge: { fontSize: 16, maxWidth: 260 },
  chipTextActive: { color: "#fff", fontWeight: "700" },

  row: {
    height: ROW_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    borderWidth: 2,
    borderColor: "transparent",
  },
  rowHover: { backgroundColor: "rgba(255,255,255,0.08)" },
  rowSelected: { backgroundColor: "rgba(255,255,255,0.12)" },
  rowMarker: { position: "absolute", left: 0, top: 10, bottom: 10, width: 3, borderRadius: 2 },
  rowNum: { width: 34, color: "rgba(255,255,255,0.45)", fontSize: 12, fontVariant: ["tabular-nums"] },
  rowLogo: { width: 36, height: 36, borderRadius: radius.sm, marginRight: 10, backgroundColor: "rgba(255,255,255,0.1)", overflow: "hidden" },
  logoImg: { width: "100%", height: "100%" },
  rowName: { color: "#fff", fontSize: font.base, fontWeight: "600" },
  rowProg: { color: "rgba(255,255,255,0.55)", fontSize: 12, marginTop: 1 },
  track: { height: 3, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.15)", marginTop: 5, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 2 },
  empty: { color: "rgba(255,255,255,0.6)", textAlign: "center", padding: spacing.lg },

  // strip (TV)
  stripOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 30 },
  strip: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    backgroundColor: "rgba(8,8,10,0.88)",
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.1)",
  },
  stripChips: { paddingLeft: spacing.xl },
  stripList: { paddingHorizontal: spacing.xl, paddingVertical: spacing.md, gap: CARD_GAP },
  card: {
    width: CARD_WIDTH,
    padding: 12,
    borderRadius: radius.md,
    borderWidth: 3,
    borderColor: "transparent",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  cardSelected: { backgroundColor: "rgba(255,255,255,0.14)" },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  cardLogo: { width: 48, height: 48, borderRadius: radius.sm, backgroundColor: "rgba(255,255,255,0.1)", overflow: "hidden" },
  cardNum: { color: "rgba(255,255,255,0.5)", fontSize: 13 },
  cardName: { color: "#fff", fontSize: 18, fontWeight: "700" },
  cardProg: { color: "rgba(255,255,255,0.7)", fontSize: 15, marginTop: 10 },

  // sheet (phone)
  sheetOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 30 },
  sheet: {
    height: "68%",
    overflow: "hidden",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    backgroundColor: glassPanel.backgroundColor,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.12)",
  },
  sheetGrab: { paddingTop: 8 },
  sheetHandle: { alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.35)" },
  sheetHeader: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
});
