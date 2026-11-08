import React, { useState } from "react";
import { Modal, View, Text, StyleSheet, Pressable, TouchableOpacity, TextInput, FlatList } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useIPTV } from "@/src/store/iptv-store";
import { useTheme } from "@/src/store/theme-store";
import { colors, spacing, radius, font } from "@/src/theme/tokens";
import type { FavoriteItem } from "@/src/types/iptv";

type Props = {
  visible: boolean;
  item: FavoriteItem | null;
  onClose: () => void;
};

/** Bottom-sheet picker for adding/removing the current item from any of the profile's
 * collections, with a quick "create new collection" row - reused from movie/series detail. */
export function AddToCollectionModal({ visible, item, onClose }: Props) {
  const collections = useIPTV((s) => s.collections);
  const createCollection = useIPTV((s) => s.createCollection);
  const addToCollection = useIPTV((s) => s.addToCollection);
  const removeFromCollection = useIPTV((s) => s.removeFromCollection);
  const { accentColor } = useTheme();
  const [newName, setNewName] = useState("");

  if (!visible || !item) return null;

  async function handleCreate() {
    if (!newName.trim() || !item) return;
    const c = await createCollection(newName.trim());
    await addToCollection(c.id, item);
    setNewName("");
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>Koleksiyona Ekle</Text>
          <TouchableOpacity onPress={onClose} hitSlop={10}><Ionicons name="close" size={24} color="#fff" /></TouchableOpacity>
        </View>

        <FlatList
          data={collections}
          keyExtractor={(c) => c.id}
          style={{ maxHeight: 280 }}
          ListEmptyComponent={<Text style={styles.emptyText}>Henüz koleksiyonun yok, aşağıdan bir tane oluştur.</Text>}
          renderItem={({ item: c }) => {
            const inCollection = c.items.some((i) => i.item_id === item.item_id);
            return (
              <TouchableOpacity
                style={styles.row}
                onPress={() => (inCollection ? removeFromCollection(c.id, item.item_id) : addToCollection(c.id, item))}
                testID={`add-to-collection-${c.id}`}
              >
                <Ionicons name="folder" size={20} color={colors.textMuted} />
                <Text style={styles.rowText} numberOfLines={1}>{c.title}</Text>
                <Ionicons
                  name={inCollection ? "checkmark-circle" : "ellipse-outline"}
                  size={22}
                  color={inCollection ? accentColor : colors.textMuted}
                />
              </TouchableOpacity>
            );
          }}
        />

        <View style={styles.createRow}>
          <TextInput
            value={newName}
            onChangeText={setNewName}
            placeholder="Yeni koleksiyon adı"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            onSubmitEditing={handleCreate}
            testID="add-to-collection-new-name"
          />
          <TouchableOpacity style={[styles.createBtn, { backgroundColor: accentColor }]} onPress={handleCreate} testID="add-to-collection-create">
            <Ionicons name="add" size={22} color="#000" />
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    backgroundColor: "#141414", borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    padding: spacing.lg, paddingBottom: spacing.xl,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.1)",
  },
  sheetHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.md },
  sheetTitle: { color: "#fff", fontSize: font.lg, fontWeight: "800" },
  emptyText: { color: colors.textMuted, textAlign: "center", paddingVertical: spacing.lg },
  row: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.06)",
  },
  rowText: { flex: 1, color: "#fff", fontSize: font.base, fontWeight: "600" },
  createRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md, alignItems: "center" },
  input: {
    flex: 1, backgroundColor: "rgba(255,255,255,0.06)", borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: 10, color: "#fff", fontSize: font.base,
  },
  createBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
});
