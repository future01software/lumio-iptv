import React from "react";
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { colors, spacing, radius, font } from "@/src/theme/tokens";

/** Provider group names like "ANIMATION;FAMILY;MOVIES" read better as "Animation · Family · Movies". */
export function prettyGroup(g: string): string {
  return g.includes(";") ? g.split(";").filter(Boolean).join(" · ") : g;
}

/**
 * Phone header for the Movies/Series tabs: title, search and the categories as a
 * horizontally scrolling chip row. On TV/tablet/desktop those screens keep the left
 * category sidebar, which on a phone took half the width.
 */
export function PhoneCategoryBar({
  title,
  search,
  onSearch,
  placeholder,
  groups,
  group,
  onGroup,
  allLabel,
  allKey,
  accentColor,
}: {
  title: string;
  search: string;
  onSearch: (v: string) => void;
  placeholder: string;
  groups: string[];
  group: string;
  onGroup: (g: string) => void;
  allLabel: string;
  allKey: string;
  accentColor: string;
}) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.searchBox}>
        <Ionicons name="search" size={18} color={colors.textMuted} />
        <TextInput
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          value={search}
          onChangeText={onSearch}
          style={styles.searchInput}
          returnKeyType="search"
        />
        {!!search && (
          <Pressable onPress={() => onSearch("")} hitSlop={10} accessibilityLabel="Aramayı temizle">
            <Ionicons name="close-circle" size={18} color={colors.textMuted} />
          </Pressable>
        )}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
        keyboardShouldPersistTaps="handled"
      >
        {groups.map((g) => {
          const active = g === group;
          return (
            <Pressable
              key={g}
              onPress={() => onGroup(g)}
              style={[styles.chip, active && { backgroundColor: accentColor, borderColor: accentColor }]}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
                {g === allKey ? allLabel : prettyGroup(g)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingTop: spacing.sm, gap: spacing.md },
  title: { color: colors.onSurface, fontSize: font.xxl, fontWeight: "800", paddingHorizontal: spacing.lg },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    paddingHorizontal: spacing.md,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
  },
  searchInput: { flex: 1, color: colors.onSurface, fontSize: font.base, padding: 0 },
  chips: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  chip: {
    height: 36,
    maxWidth: 240,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
    justifyContent: "center",
  },
  chipText: { color: colors.onSurfaceSecondary, fontSize: font.sm, fontWeight: "600" },
  chipTextActive: { color: "#fff", fontWeight: "800" },
});
