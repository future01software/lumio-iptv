import React from "react";
import { View, Text, StyleSheet, StyleProp, ViewStyle, TextStyle, ImageStyle } from "react-native";
import { Image } from "expo-image";
import { cleanChannelName } from "@/src/utils/clean-name";
import { buildLogoProxyUrl } from "@/src/utils/logo-proxy";

// Deterministic, Netflix/Spotify-style color per channel name so channels
// without a tvg-logo in the playlist still get a distinct, non-generic tile
// instead of a plain grey "tv" icon.
const PALETTE = ["#E53935", "#8E24AA", "#3949AB", "#00897B", "#43A047", "#FB8C00", "#6D4C41", "#546E7A", "#D81B60", "#1E88E5"];

function colorForName(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

function initialsForName(name: string) {
  const clean = cleanChannelName(name || "").trim();
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function ChannelAvatar({
  name,
  logo,
  style,
  imageStyle,
  textStyle,
}: {
  name: string;
  logo?: string | null;
  style?: StyleProp<ViewStyle>;
  imageStyle?: StyleProp<ImageStyle>;
  textStyle?: StyleProp<TextStyle>;
}) {
  if (logo) {
    const uri = buildLogoProxyUrl(logo) || logo;
    return (
      <Image cachePolicy="memory-disk"
        source={{ uri }}
        style={imageStyle}
        contentFit="contain"
        transition={250}
        // FlashList/FlatList recycle rows for perf - without a key tied to this
        // exact image, a failed/slow load on a recycled row can leave the
        // *previous* row's logo visible, looking like the wrong channel's logo.
        recyclingKey={uri}
      />
    );
  }
  return (
    <View style={[styles.badge, { backgroundColor: colorForName(name || "?") }, style]}>
      <Text style={[styles.badgeText, textStyle]} numberOfLines={1}>
        {initialsForName(name)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignItems: "center", justifyContent: "center", width: "100%", height: "100%" },
  badgeText: { color: "#fff", fontWeight: "800" },
});
