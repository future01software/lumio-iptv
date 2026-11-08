import React from "react";
import { Platform, TouchableOpacity, View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import Constants, { ExecutionEnvironment } from "expo-constants";

// Lazily try to load react-native-google-cast so Expo Go doesn't crash on import.
// The native module is only present in a custom dev/production build.
let CastButtonNative: any = null;
let castSessionHookAvailable = false;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cast = require("react-native-google-cast");
  CastButtonNative = cast?.CastButton;
  castSessionHookAvailable = !!cast?.useCastSession;
} catch {
  CastButtonNative = null;
}

type Props = {
  size?: number;
  color?: string;
  testID?: string;
  onUnavailable?: () => void;
};

/**
 * CastButton renders the native Google Cast button on Android (when the native
 * module is available i.e. in a custom dev/production build). On iOS or in Expo Go
 * we render a fallback Ionicon and call `onUnavailable` when tapped.
 */
export function CastButton({ size = 24, color = "#fff", testID = "cast-button", onUnavailable }: Props) {
  const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
  
  if (!isExpoGo && CastButtonNative && Platform.OS === "android") {
    return (
      <View testID={testID} style={{ width: size + 4, height: size + 4 }}>
        <CastButtonNative style={{ width: size + 4, height: size + 4, tintColor: color }} />
      </View>
    );
  }
  return (
    <TouchableOpacity onPress={onUnavailable} hitSlop={10} testID={testID}>
      <Ionicons name="tv-outline" size={size} color={color} />
    </TouchableOpacity>
  );
}

/** AirPlay button — iOS only. Shows a system-styled icon; tap shows info modal. */
export function AirPlayButton({ size = 24, color = "#fff", testID = "airplay-button", onPress }: { size?: number; color?: string; testID?: string; onPress?: () => void }) {
  if (Platform.OS !== "ios") return null;
  return (
    <TouchableOpacity onPress={onPress} hitSlop={10} testID={testID}>
      <Ionicons name="tv-outline" size={size} color={color} />
    </TouchableOpacity>
  );
}

export const isCastNativeAvailable = !!CastButtonNative;
export const isCastHookAvailable = castSessionHookAvailable;
