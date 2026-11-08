import React, { useCallback, useRef, useState } from "react";
import { Pressable, Animated, StyleSheet, View, Platform } from "react-native";
import { colors, radius } from "@/src/theme/tokens";
import { useTheme } from "@/src/store/theme-store";

type Props = {
  children: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  style?: any;
  focusedStyle?: any;
  scaleOnFocus?: number;
  hasTVPreferredFocus?: boolean;
  testID?: string;
  disabled?: boolean;
};

/**
 * Focusable wrapper used everywhere on TV / D-pad navigable surfaces.
 * - On Android TV / react-native-tvos: real D-pad focus moves between cards.
 * - On phones: behaves like a regular TouchableOpacity with optional long-press.
 * - Web: works with Tab key + Enter (browser focus model).
 */
export function FocusableCard({
  children,
  onPress,
  onLongPress,
  style,
  focusedStyle,
  scaleOnFocus = 1.06,
  hasTVPreferredFocus,
  testID,
  disabled,
}: Props) {
  const { accentColor } = useTheme();
  const [focused, setFocused] = useState(false);
  const scale = useRef(new Animated.Value(1)).current;

  const animate = useCallback(
    (to: number) => {
      Animated.spring(scale, {
        toValue: to,
        useNativeDriver: true,
        bounciness: 0,
        speed: 24,
      }).start();
    },
    [scale]
  );

  return (
    <Animated.View style={[{ transform: [{ scale }] }]}>
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={400}
        onFocus={() => { setFocused(true); animate(scaleOnFocus); }}
        onBlur={() => { setFocused(false); animate(1); }}
        // tvOS / react-native-tvos props (no-ops on plain RN/web)
        hasTVPreferredFocus={hasTVPreferredFocus}
        // @ts-ignore
        tvParallaxProperties={{ enabled: true, magnification: 1.1 }}
        style={({ pressed }) => [
          styles.base,
          style,
          focused && [styles.focused, { borderColor: accentColor, shadowColor: accentColor }, focusedStyle],
          pressed && styles.pressed,
        ]}
        testID={testID}
        disabled={disabled}
      >
        <View pointerEvents="box-none">{children}</View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: "transparent",
  },
  focused: {
    borderColor: colors.brandPrimary,
    // soft glow halo via shadow on iOS / elevation on Android
    shadowColor: colors.brandPrimary,
    shadowOpacity: Platform.OS === "ios" ? 0.6 : 0,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },
  pressed: {
    opacity: 0.85,
  },
});
