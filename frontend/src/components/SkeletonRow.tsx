import React, { useEffect } from "react";
import { View, StyleSheet } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming, Easing } from "react-native-reanimated";
import { spacing, radius } from "@/src/theme/tokens";

// Placeholder poster row shown while a row's data is loading (NuvioTV's
// ModernHomePlaceholderShimmer). A single shared opacity pulse instead of a
// per-card gradient sweep keeps it cheap on low-power TV boxes.
export function SkeletonRow({ itemWidth, count = 8, aspectRatio = 2 / 3 }: { itemWidth: number; count?: number; aspectRatio?: number }) {
  const pulse = useSharedValue(0.45);
  useEffect(() => {
    pulse.value = withRepeat(withTiming(1, { duration: 850, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [pulse]);
  const animatedStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View style={[styles.row, animatedStyle]} accessibilityRole="progressbar">
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={[styles.card, { width: itemWidth, aspectRatio }]} />
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", paddingHorizontal: spacing.lg, gap: spacing.md, overflow: "hidden" },
  card: { borderRadius: radius.md, backgroundColor: "rgba(255,255,255,0.08)" },
});
