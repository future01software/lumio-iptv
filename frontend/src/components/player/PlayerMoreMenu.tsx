import React from "react";
import { View, StyleSheet } from "react-native";
import { BlurView } from "expo-blur";
import { Ionicons } from "@expo/vector-icons";

import { PlayerIconButton } from "./PlayerIconButton";
import { glassPanel } from "./styles";
import { spacing } from "@/src/theme/tokens";

export type MoreMenuAction = {
  key: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  onPress: () => void;
  active?: boolean;
  disabled?: boolean;
  testID?: string;
};

type Props = {
  visible: boolean;
  actions: MoreMenuAction[];
  accentColor: string;
  onInteract: () => void;
};

/**
 * Floating frosted panel for secondary player actions on narrow layouts —
 * Stremio collapses the same row behind a "⋮" button below its breakpoint.
 */
export function PlayerMoreMenu({ visible, actions, accentColor, onInteract }: Props) {
  if (!visible) return null;
  return (
    <BlurView intensity={glassPanel.blurIntensity} tint={glassPanel.blurTint} style={styles.panel}>
      <View style={styles.row}>
        {actions.map((a) => (
          <PlayerIconButton
            key={a.key}
            icon={a.icon}
            label={a.label}
            active={a.active}
            disabled={a.disabled}
            onPress={a.onPress}
            onInteract={onInteract}
            testID={a.testID}
            accentColor={accentColor}
          />
        ))}
      </View>
    </BlurView>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: "absolute",
    right: 20,
    bottom: 96,
    maxWidth: "92%",
    overflow: "hidden",
    padding: spacing.sm,
    ...(glassPanel as any),
  },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 4, justifyContent: "flex-end" },
});
