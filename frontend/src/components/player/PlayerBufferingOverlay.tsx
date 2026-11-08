import React from "react";
import { View, StyleSheet, ActivityIndicator } from "react-native";
import { Image } from "expo-image";

import { ChannelAvatar } from "@/src/components/ChannelAvatar";
import { colors } from "@/src/theme/tokens";
import { useTheme } from "@/src/store/theme-store";

type Props = {
  logo?: string | null;
  title: string;
};

/**
 * Buffering state shown with the channel/poster art dimmed behind the
 * spinner (Stremio shows the meta item's backdrop here) instead of a flat
 * black screen.
 */
export function PlayerBufferingOverlay({ logo, title }: Props) {
  const { accentColor } = useTheme();
  return (
    <View style={styles.root} pointerEvents="none">
      {logo ? (
        <Image source={{ uri: logo }} style={styles.background} contentFit="cover" blurRadius={30} />
      ) : null}
      <View style={styles.scrim} />
      <View style={styles.badge}>
        <ChannelAvatar name={title} logo={logo} imageStyle={styles.badgeImage} textStyle={styles.badgeText} style={styles.badgeFallback} />
      </View>
      <ActivityIndicator color={accentColor} size="large" style={styles.spinner} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  background: { ...StyleSheet.absoluteFillObject, opacity: 0.35 },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.45)" },
  badge: { width: 88, height: 88, borderRadius: 22, overflow: "hidden", marginBottom: 20 },
  badgeFallback: { borderRadius: 22 },
  badgeImage: { width: "100%", height: "100%" },
  badgeText: { fontSize: 28 },
  spinner: { marginTop: 4 },
});
