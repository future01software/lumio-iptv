import React, { useState } from "react";
import { Pressable, Text, StyleSheet } from "react-native";

import { colors, spacing, font } from "@/src/theme/tokens";

/**
 * One row in the Movies/Series category sidebar. The remote's focus must be visible
 * (white outline + lighter background) and distinct from the selected category (accent
 * fill), since both can be on screen at once. The border is always there (transparent
 * when idle) so focusing doesn't change the row's size.
 */
export function CategoryItem({
  label,
  active,
  accentColor,
  onPress,
}: {
  label: string;
  active: boolean;
  accentColor: string;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      focusable
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[
        styles.item,
        active && { backgroundColor: accentColor },
        focused && styles.focused,
        focused && active && { backgroundColor: accentColor },
      ]}
    >
      <Text style={[styles.text, (active || focused) && styles.textActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  item: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    borderWidth: 2,
    borderColor: "transparent",
  },
  focused: { borderColor: "#fff", borderBottomColor: "#fff", backgroundColor: "rgba(255,255,255,0.14)" },
  text: { color: colors.textMuted, fontSize: font.sm, fontWeight: "600", textTransform: "uppercase" },
  textActive: { color: colors.onSurface, fontWeight: "800" },
});
