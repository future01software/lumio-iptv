import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, FlatList, TextInput, Alert } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { useIPTV } from "@/src/store/iptv-store";
import { useTheme } from "@/src/store/theme-store";
import { colors, spacing, radius, font } from "@/src/theme/tokens";
import type { Collection } from "@/src/types/iptv";

export default function Collections() {
  const router = useRouter();
  const collections = useIPTV((s) => s.collections);
  const createCollection = useIPTV((s) => s.createCollection);
  const removeCollection = useIPTV((s) => s.removeCollection);
  const moveCollection = useIPTV((s) => s.moveCollection);
  const { accentColor } = useTheme();

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  async function confirmCreate() {
    if (!name.trim()) { setCreating(false); return; }
    const c = await createCollection(name.trim());
    setName("");
    setCreating(false);
    router.push({ pathname: "/collection/[id]", params: { id: c.id } });
  }

  return (
    <View style={styles.root}>
      <SafeAreaView edges={["top"]} style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}><Ionicons name="chevron-back" size={26} color="#fff" /></TouchableOpacity>
        <Text style={styles.title}>Koleksiyonlar</Text>
        <TouchableOpacity onPress={() => setCreating(true)} hitSlop={10} testID="collections-add">
          <Ionicons name="add" size={28} color={accentColor} />
        </TouchableOpacity>
      </SafeAreaView>

      {creating && (
        <View style={styles.createRow}>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Koleksiyon adı"
            placeholderTextColor={colors.textMuted}
            style={styles.createInput}
            autoFocus
            onSubmitEditing={confirmCreate}
            testID="collections-name-input"
          />
          <TouchableOpacity style={[styles.createBtn, { backgroundColor: accentColor }]} onPress={confirmCreate} testID="collections-create-confirm">
            <Ionicons name="checkmark" size={20} color="#000" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.createBtnGhost} onPress={() => { setCreating(false); setName(""); }}>
            <Ionicons name="close" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      )}

      <FlatList
        data={collections}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
        renderItem={({ item, index }) => (
          <CollectionRow
            collection={item}
            isFirst={index === 0}
            isLast={index === collections.length - 1}
            onPress={() => router.push({ pathname: "/collection/[id]", params: { id: item.id } })}
            onMoveUp={() => moveCollection(item.id, "up")}
            onMoveDown={() => moveCollection(item.id, "down")}
            onDelete={() =>
              Alert.alert("Koleksiyonu sil?", item.title, [
                { text: "Vazgeç", style: "cancel" },
                { text: "Sil", style: "destructive", onPress: () => removeCollection(item.id) },
              ])
            }
          />
        )}
        ListEmptyComponent={
          <View style={{ alignItems: "center", padding: spacing.xxxl }}>
            <Ionicons name="folder-outline" size={48} color={colors.textMuted} />
            <Text style={{ color: colors.textMuted, marginTop: spacing.md, textAlign: "center" }}>
              Henüz koleksiyonun yok.{"\n"}Film/dizi detayından veya + ile yeni bir tane oluştur.
            </Text>
          </View>
        }
      />
    </View>
  );
}

function CollectionRow({ collection, isFirst, isLast, onPress, onMoveUp, onMoveDown, onDelete }: {
  collection: Collection; isFirst: boolean; isLast: boolean;
  onPress: () => void; onMoveUp: () => void; onMoveDown: () => void; onDelete: () => void;
}) {
  const cover = collection.items.find((i) => i.logo)?.logo;
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} testID={`collection-${collection.id}`}>
      <View style={styles.cover}>
        {cover ? (
          <Image source={{ uri: cover }} style={StyleSheet.absoluteFillObject} contentFit="cover" />
        ) : (
          <Ionicons name="folder" size={28} color={colors.textMuted} />
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>{collection.title}</Text>
        <Text style={styles.rowSub}>{collection.items.length} öğe</Text>
      </View>
      <View style={{ flexDirection: "row", gap: 4 }}>
        <TouchableOpacity onPress={onMoveUp} disabled={isFirst} hitSlop={8} style={{ opacity: isFirst ? 0.3 : 1 }}>
          <Ionicons name="chevron-up" size={20} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity onPress={onMoveDown} disabled={isLast} hitSlop={8} style={{ opacity: isLast ? 0.3 : 1 }}>
          <Ionicons name="chevron-down" size={20} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity onPress={onDelete} hitSlop={8} style={{ marginLeft: 8 }}>
          <Ionicons name="trash-outline" size={20} color={colors.error} />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  title: { color: colors.onSurface, fontSize: font.xl, fontWeight: "800" },
  createRow: { flexDirection: "row", gap: spacing.sm, padding: spacing.lg, alignItems: "center" },
  createInput: {
    flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: 10, color: colors.onSurface, fontSize: font.base,
  },
  createBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  createBtnGhost: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceSecondary },
  row: {
    flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
  },
  cover: { width: 56, height: 56, borderRadius: radius.sm, backgroundColor: "rgba(255,255,255,0.06)", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  rowTitle: { color: colors.onSurface, fontSize: font.base, fontWeight: "700" },
  rowSub: { color: colors.textMuted, fontSize: font.sm, marginTop: 2 },
});
