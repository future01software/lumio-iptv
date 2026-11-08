import React, { useState } from "react";
import { Pressable, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { radius, spacing, font } from "@/src/theme/tokens";

// White, not the accent: the Play/Pause button is accent-filled, so an accent ring on it
// was invisible and the remote seemed to have no focus.
const FOCUS_RING = "#fff";

type Props = {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  size?: number;
  label?: string;
  active?: boolean;
  disabled?: boolean;
  color?: string;
  bg?: string;
  accentColor: string;
  onPress?: (e?: any) => void;
  onInteract?: () => void;
  hasTVPreferredFocus?: boolean;
  testID?: string;
};

/**
 * Stremio-style rounded-square icon button. Replaces the old circular
 * PlayerIconBtn/ActionBtn helpers with one primitive: icon-only for the
 * top bar and center transport controls, icon+label (stacked) for the
 * secondary-actions row and overflow menu.
 */
export function PlayerIconButton({
  icon,
  size = 24,
  label,
  active,
  disabled,
  color,
  bg,
  accentColor,
  onPress,
  onInteract,
  hasTVPreferredFocus,
  testID,
}: Props) {
  const [focused, setFocused] = useState(false);
  const iconColor = disabled ? "rgba(255,255,255,0.35)" : color || (active ? accentColor : "#fff");

  if (label) {
    return (
      <Pressable
        style={[styles.labeled, focused && { backgroundColor: "rgba(255,255,255,0.14)", borderColor: FOCUS_RING }]}
        onPress={disabled ? undefined : (e) => { onInteract?.(); onPress?.(e); }}
        onFocus={() => { setFocused(true); onInteract?.(); }}
        onBlur={() => setFocused(false)}
        testID={testID}
        focusable={!disabled}
      >
        <Ionicons name={icon} size={22} color={iconColor} />
        <Text style={[styles.labelText, { color: iconColor }]} numberOfLines={1}>{label}</Text>
      </Pressable>
    );
  }

  const boxSize = bg ? size + 36 : size + 20;
  return (
    <Pressable
      onFocus={() => { setFocused(true); onInteract?.(); }}
      onBlur={() => setFocused(false)}
      onPress={disabled ? undefined : (e) => { onInteract?.(); onPress?.(e); }}
      hitSlop={10}
      testID={testID}
      focusable={!disabled}
      hasTVPreferredFocus={hasTVPreferredFocus}
      style={[
        styles.square,
        { width: boxSize, height: boxSize },
        bg && { backgroundColor: bg },
        focused && { borderColor: FOCUS_RING },
        focused && !bg && { backgroundColor: "rgba(255,255,255,0.14)" },
      ]}
    >
      <Ionicons name={icon} size={size} color={iconColor} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  square: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: "transparent",
  },
  labeled: {
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: "transparent",
  },
  labelText: { fontSize: font.sm },
});
