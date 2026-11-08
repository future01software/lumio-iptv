import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Dimensions, ScrollView } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { useIPTV } from "@/src/store/iptv-store";
import { colors, spacing, radius, font } from "@/src/theme/tokens";
import { useTheme } from "@/src/store/theme-store";

const { width } = Dimensions.get("window");
const COL = 3;
const GAP = spacing.md;
const ITEM_W = (width - spacing.lg * 2 - GAP * (COL - 1)) / COL;

export default function Favorites() {
  const { accentColor } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<"favorites" | "history" | "watchlist">(
    params.tab === "history" ? "history" : params.tab === "watchlist" ? "watchlist" : "favorites"
  );
  const favorites = useIPTV((s) => s.favorites);
  const history = useIPTV((s) => s.history);
  const watchlists = useIPTV((s) => s.watchlists);

  const data = useMemo(() => {
    if (tab === "favorites") return Object.values(favorites);
    if (tab === "watchlist") return Object.values(watchlists);
    return history;
  }, [tab, favorites, history, watchlists]);

  return (
    <View style={styles.root}>
      <SafeAreaView edges={["top"]} style={styles.header}>
        <View style={styles.topRow}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={10}><Ionicons name="chevron-back" size={26} color="#fff" /></TouchableOpacity>
          <Text style={styles.title}>{tab === "favorites" ? "Favoriler" : tab === "history" ? "İzleme Geçmişi" : "İzleme Listesi"}</Text>
          <View style={{ width: 26 }} />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
          <TouchableOpacity style={[styles.tabBtn, tab === "favorites" && [styles.tabActive, { backgroundColor: accentColor, borderColor: accentColor }]]} onPress={() => setTab("favorites")} testID="fav-tab-favorites">
            <Text style={[styles.tabText, tab === "favorites" && styles.tabTextActive]}>Favoriler</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tabBtn, tab === "watchlist" && [styles.tabActive, { backgroundColor: accentColor, borderColor: accentColor }]]} onPress={() => setTab("watchlist")} testID="fav-tab-watchlist">
            <Text style={[styles.tabText, tab === "watchlist" && styles.tabTextActive]}>İzleme Listesi</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tabBtn, tab === "history" && [styles.tabActive, { backgroundColor: accentColor, borderColor: accentColor }]]} onPress={() => setTab("history")} testID="fav-tab-history">
            <Text style={[styles.tabText, tab === "history" && styles.tabTextActive]}>Geçmiş</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>

      <FlatList
        data={data}
        numColumns={COL}
        keyExtractor={(i: any) => i.item_id}
        columnWrapperStyle={{ gap: GAP, paddingHorizontal: spacing.lg }}
        contentContainerStyle={{ gap: GAP, paddingTop: spacing.md, paddingBottom: 60 }}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={{ width: ITEM_W }}
            onPress={() => {
              if (item.kind === "movie") router.push({ pathname: "/movie/[id]", params: { id: item.item_id } });
              else if (item.kind === "series") router.push({ pathname: "/series/[id]", params: { id: item.item_id } });
              else if (item.url) router.push({ pathname: "/player", params: { url: item.url, title: item.name, kind: "live", itemId: item.item_id, logo: item.logo || "" } });
            }}
            testID={`fav-item-${item.item_id}`}
          >
            <Image cachePolicy="memory-disk" source={{ uri: item.logo || undefined }} style={styles.poster} contentFit="contain" recyclingKey={item.item_id} />
            <Text style={styles.name} numberOfLines={2}>{item.name}</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={{ alignItems: "center", padding: spacing.xxxl }}>
            <Ionicons name={tab === "favorites" ? "heart-outline" : tab === "watchlist" ? "bookmark-outline" : "time-outline"} size={48} color={colors.textMuted} />
            <Text style={{ color: colors.textMuted, marginTop: spacing.md }}>
              {tab === "favorites" ? "Henüz favori yok" : tab === "watchlist" ? "İzleme listeniz boş" : "İzleme geçmişi boş"}
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { backgroundColor: colors.surface, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: spacing.sm, marginBottom: spacing.md },
  title: { color: colors.onSurface, fontSize: font.xl, fontWeight: "800" },
  tabs: { flexDirection: "row", gap: spacing.sm },
  tabBtn: { paddingHorizontal: spacing.lg, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  tabActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  tabText: { color: colors.onSurfaceSecondary, fontSize: font.sm, fontWeight: "600" },
  tabTextActive: { color: "#fff" },
  poster: { width: ITEM_W, height: ITEM_W * 1.5, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  name: { color: colors.onSurface, fontSize: font.sm, fontWeight: "600", marginTop: 6 },
});
