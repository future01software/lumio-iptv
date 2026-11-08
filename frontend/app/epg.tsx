import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { useIPTV, getEpgNow } from "@/src/store/iptv-store";
import { colors, spacing, radius, font } from "@/src/theme/tokens";
import { useTheme } from "@/src/store/theme-store";
import { withAlpha } from "@/src/utils/color";
import { useReminders, reminderId } from "@/src/store/reminders-store";
import { FocusPressable } from "@/src/components/FocusPressable";

function fmtTime(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  } catch {
    return "";
  }
}

export default function EPG() {
  const { accentColor } = useTheme();
  const router = useRouter();
  const playlist = useIPTV((s) => s.playlist);
  const epgByChannel = useIPTV((s) => s.epgByChannel);
  const loadEPG = useIPTV((s) => s.loadEPG);
  const epgLoading = useIPTV((s) => s.epgLoading);
  const config = useIPTV((s) => s.config);
  const pushRecent = useIPTV((s) => s.pushRecent);

  const channelsWithEpg = useMemo(() => {
    if (!playlist) return [];
    return playlist.channels.filter((c) => c.epg_channel_id && epgByChannel[c.epg_channel_id]?.length);
  }, [playlist, epgByChannel]);

  const [selectedDate] = useState(new Date());

  return (
    <View style={styles.root}>
      <SafeAreaView edges={["top"]} style={styles.header}>
        <View style={styles.topRow}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={10}><Ionicons name="chevron-back" size={26} color="#fff" /></TouchableOpacity>
          <Text style={styles.title}>TV Guide</Text>
          <TouchableOpacity onPress={() => loadEPG()} testID="epg-refresh">
            <Ionicons name="refresh" size={22} color="#fff" />
          </TouchableOpacity>
        </View>
        <Text style={styles.subtitle}>
          {selectedDate.toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long" })} · yayın akışı olan {channelsWithEpg.length} kanal
        </Text>
      </SafeAreaView>

      {!config?.epg_url ? (
        <View style={styles.empty}>
          <Ionicons name="calendar-outline" size={48} color={colors.textMuted} />
          <Text style={styles.emptyText}>Yayın akışı (EPG) adresi girilmemiş.</Text>
          <Text style={styles.emptyTextSm}>Yayın akışını görmek için liste ayarlarına bir XMLTV adresi ekle.</Text>
        </View>
      ) : epgLoading && channelsWithEpg.length === 0 ? (
        <View style={styles.empty}>
          <ActivityIndicator color={accentColor} size="large" />
          <Text style={styles.emptyText}>Loading EPG…</Text>
        </View>
      ) : channelsWithEpg.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="information-circle-outline" size={48} color={colors.textMuted} />
          <Text style={styles.emptyText}>No EPG programs matched your channels.</Text>
          <TouchableOpacity style={[styles.btn, { backgroundColor: accentColor }]} onPress={() => loadEPG()}><Text style={styles.btnText}>Tekrar Dene</Text></TouchableOpacity>
        </View>
      ) : (
        <FlashList
          data={channelsWithEpg}
          keyExtractor={(c) => c.id}
          // @ts-ignore
          estimatedItemSize={140}
          contentContainerStyle={{ paddingBottom: 60 }}
          renderItem={({ item }) => <MemoizedEPGRow item={item} epgByChannel={epgByChannel} router={router} pushRecent={pushRecent} />}
        />
      )}
    </View>
  );
}

const MemoizedEPGRow = React.memo(EPGRow);

function EPGRow({ item, epgByChannel, router, pushRecent }: any) {
  const { accentColor } = useTheme();
  const progs = epgByChannel[item.epg_channel_id || ""] || [];
  const now = getEpgNow();
  const upcoming = progs.filter((p: any) => p.stop > now).slice(0, 8);
  const reminders = useReminders((s) => s.reminders);
  const toggleReminder = useReminders((s) => s.toggle);

  return (
    <View style={styles.channelBlock}>
      <TouchableOpacity
        style={styles.channelHeader}
        onPress={() => {
          pushRecent(item.id);
          router.push({ pathname: "/player", params: { url: item.url, title: item.name, kind: "live", itemId: item.id, logo: item.logo || "" } });
        }}
        testID={`epg-channel-${item.id}`}
      >
        <View style={styles.logoBox}>
          {item.logo ? <Image cachePolicy="memory-disk" source={{ uri: item.logo }} style={styles.logo} contentFit="contain" /> : <Ionicons name="tv" size={20} color={colors.textMuted} />}
        </View>
        <Text style={styles.chName} numberOfLines={1}>{item.name}</Text>
        <Ionicons name="play-circle" size={24} color={accentColor} />
      </TouchableOpacity>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md }}>
        {upcoming.map((p: any, idx: number) => {
          const isLive = p.start <= now && p.stop > now;
          const hasReminder = !!reminders[reminderId(item.id, p.start)];
          // Upcoming programmes toggle a "starts now" reminder.
          const cardStyle = [
            styles.programCard,
            isLive && [styles.programLive, { borderColor: accentColor, backgroundColor: withAlpha(accentColor, 0.15) }],
            hasReminder && { borderColor: accentColor },
          ];
          const Card: any = isLive ? View : FocusPressable;
          return (
            <Card
              key={`${p.start}-${idx}`}
              {...(isLive
                ? { style: cardStyle }
                : {
                    onPress: () => toggleReminder(item, p),
                    testID: `epg-remind-${item.id}-${idx}`,
                    style: ({ focused }: any) => [cardStyle, focused && { borderColor: "#fff", borderWidth: 2 }],
                  })}
            >
              <View style={styles.timeRow}>
                <Text style={[styles.programTime, isLive && { color: accentColor }]}>{fmtTime(p.start)} - {fmtTime(p.stop)}</Text>
                {!isLive && (
                  <Ionicons name={hasReminder ? "notifications" : "notifications-outline"} size={14} color={hasReminder ? accentColor : colors.textMuted} />
                )}
                {isLive && (
                  <View style={[styles.liveBadgeWrap, { backgroundColor: withAlpha(accentColor, 0.2) }]}>
                    <View style={[styles.liveDot, { backgroundColor: accentColor }]} />
                    <Text style={[styles.liveBadge, { color: accentColor }]}>CANLI</Text>
                  </View>
                )}
              </View>
              <Text style={[styles.programTitle, isLive && { color: "#fff" }]} numberOfLines={2}>{p.title}</Text>
            </Card>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { backgroundColor: colors.surface, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: spacing.sm },
  title: { color: colors.onSurface, fontSize: font.xl, fontWeight: "800" },
  subtitle: { color: colors.textMuted, fontSize: font.sm, marginTop: 6 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  emptyText: { color: colors.onSurface, fontSize: font.lg, fontWeight: "600" },
  emptyTextSm: { color: colors.textMuted, fontSize: font.sm, textAlign: "center" },
  btn: { backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.xl, paddingVertical: 10, borderRadius: radius.pill, marginTop: spacing.md },
  btnText: { color: "#fff", fontWeight: "700" },
  channelBlock: { marginTop: spacing.md },
  channelHeader: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  logoBox: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  logo: { width: "80%", height: "80%" },
  chName: { flex: 1, color: colors.onSurface, fontSize: font.lg, fontWeight: "700" },
  programCard: { width: 220, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, gap: 6 },
  programLive: { borderColor: colors.brandPrimary, backgroundColor: "rgba(229,9,20,0.15)" },
  timeRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  programTime: { color: colors.textMuted, fontSize: 12, fontWeight: "700", fontVariant: ["tabular-nums"] },
  programTitle: { color: colors.onSurface, fontSize: font.base, fontWeight: "600", marginTop: 2 },
  liveBadgeWrap: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(229,9,20,0.2)", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.brandPrimary },
  liveBadge: { color: colors.brandPrimary, fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
});
