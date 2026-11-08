import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, type ImageStyle, type StyleProp } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";

import { colors, font } from "@/src/theme/tokens";
import { posterUri, imageTransition } from "@/src/utils/perf";

export const POSTER_RADIUS = 10;
const RING_GAP = 3;
const RING_WIDTH = 3;
/**
 * Horizontal space on each side of a card in a row. List cells are separate views (a
 * later cell draws over an earlier one), so a focused card's scale + ring must fit in
 * this gutter or the neighbour covers it: ~2.5% of a ~200dp card (5dp) + ring (6dp).
 */
export const CARD_GUTTER = 12;

/**
 * Focus ring for poster/thumbnail cards: a thin white outline sitting a few pixels
 * outside the artwork, rounded to match it (the TV-platform convention). Render it as
 * the last child of the focusable card, which must not clip (no overflow: hidden).
 */
export function FocusRing({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return <View pointerEvents="none" style={styles.ring} />;
}

/**
 * Poster image that falls back to an icon + title when there is no artwork or it fails
 * to load (instead of an empty dark tile).
 */
export const PosterArt = React.memo(function PosterArt({
  uri,
  title,
  contentFit = "cover",
  recyclingKey,
  style,
}: {
  uri?: string | null;
  title?: string;
  contentFit?: "cover" | "contain";
  recyclingKey?: string;
  style?: StyleProp<ImageStyle>;
}) {
  const [failed, setFailed] = useState(false);
  const [lastUri, setLastUri] = useState(uri);
  if (uri !== lastUri) {
    // Recycled list cell got a new item: give its artwork a fresh chance.
    setLastUri(uri);
    setFailed(false);
  }
  const showImage = !!uri && !failed;
  const source = useMemo(() => ({ uri: posterUri(uri) as string }), [uri]);
  return (
    <View style={[styles.art, style]}>
      {showImage ? (
        <Image
          cachePolicy="memory-disk"
          source={source}
          style={StyleSheet.absoluteFillObject}
          contentFit={contentFit}
          transition={imageTransition(200)}
          recyclingKey={recyclingKey}
          onError={() => setFailed(true)}
        />
      ) : (
        <View style={styles.fallback}>
          <Ionicons name="film-outline" size={30} color={colors.textMuted} />
          {!!title && (
            <Text style={styles.fallbackTitle} numberOfLines={3}>
              {title}
            </Text>
          )}
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  art: {
    width: "100%",
    height: "100%",
    borderRadius: POSTER_RADIUS,
    overflow: "hidden",
    backgroundColor: colors.surfaceSecondary,
  },
  fallback: { flex: 1, alignItems: "center", justifyContent: "center", padding: 10, gap: 8 },
  fallbackTitle: { color: colors.onSurfaceSecondary, fontSize: font.sm, fontWeight: "600", textAlign: "center" },
  ring: {
    position: "absolute",
    top: -(RING_GAP + RING_WIDTH),
    left: -(RING_GAP + RING_WIDTH),
    right: -(RING_GAP + RING_WIDTH),
    bottom: -(RING_GAP + RING_WIDTH),
    borderRadius: POSTER_RADIUS + RING_GAP + RING_WIDTH,
    borderWidth: RING_WIDTH,
    borderColor: "#fff",
  },
});
