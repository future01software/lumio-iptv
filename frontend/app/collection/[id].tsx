import React, { useMemo } from "react";
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Dimensions } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { useIPTV } from "@/src/store/iptv-store";
import { colors, spacing, radius, font } from "@/src/theme/tokens";

const { width } = Dimensions.get("window");
const COL = 3;
const GAP = spacing.md;
const ITEM_W = (width - spacing.lg * 2 - GAP * (COL - 1)) / COL;

export default function CollectionDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const collections = useIPTV((s) => s.collections);
  const removeFromCollection = useIPTV((s) => s.removeFromCollection);

  const collection = useMemo(() => collections.find((c) => c.id === id), [collections, id]);

  if (!collection) {
    return (
      <SafeAreaView style={styles.empty}>
        <Text style={styles.emptyText}>Koleksiyon bulunamadı</Text>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.root}>
      <SafeAreaView edges={["top"]} style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}><Ionicons name="chevron-back" size={26} color="#fff" /></TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{collection.title}</Text>
        <View style={{ width: 26 }} />
      </SafeAreaView>

      <FlatList
        data={collection.items}
        numColumns={COL}
        keyExtractor={(i) => i.item_id}
        columnWrapperStyle={{ gap: GAP, paddingHorizontal: spacing.lg }}
        contentContainerStyle={{ gap: GAP, paddingTop: spacing.md, paddingBottom: 60 }}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={{ width: ITEM_W }}
            onLongPress={() => removeFromCollection(collection.id, item.item_id)}
            onPress={() => {
              if (item.kind === "movie") router.push({ pathname: "/movie/[id]", params: { id: item.item_id } });
              else if (item.kind === "series") router.push({ pathname: "/series/[id]", params: { id: item.item_id } });
              else if (item.url) router.push({ pathname: "/player", params: { url: item.url, title: item.name, kind: "live", itemId: item.item_id, logo: item.logo || "" } });
            }}
            testID={`collection-item-${item.item_id}`}
          >
            <Image source={{ uri: item.logo || undefined }} style={styles.poster} contentFit="contain" recyclingKey={item.item_id} />
            <Text style={styles.name} numberOfLines={2}>{item.name}</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={{ alignItems: "center", padding: spacing.xxxl }}>
            <Ionicons name="folder-open-outline" size={48} color={colors.textMuted} />
            <Text style={{ color: colors.textMuted, marginTop: spacing.md, textAlign: "center" }}>
              Bu koleksiyon boş.{"\n"}Film/dizi detayından "Koleksiyona Ekle" ile öğe ekle.
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  emptyText: { color: colors.textMuted },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  title: { flex: 1, color: colors.onSurface, fontSize: font.xl, fontWeight: "800", textAlign: "center" },
  poster: { width: ITEM_W, height: ITEM_W * 1.5, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  name: { color: colors.onSurface, fontSize: font.sm, fontWeight: "600", marginTop: 6 },
});
