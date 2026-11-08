import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { PROFILE_COLORS } from "@/src/store/profile-store";
import { generatedAvatarUri, isGeneratedAvatar } from "@/src/utils/avatars";
import { bundledAvatarSource } from "@/src/utils/bundledAvatars";

export function isImageAvatar(avatar?: string | null) {
  return !!avatar && /^https?:\/\//i.test(avatar);
}

// Hex "#RRGGBB" + alpha (0–1) → "rgba(...)"; falls back to the first palette color.
export function withAlpha(hex: string | undefined, alpha: number) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "") || /^#?([0-9a-f]{6})$/i.exec(PROFILE_COLORS[0])!;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// Nuvio's ProfileAvatarCard look: a soft outer halo in the profile color,
// an inner disc tinted with it, a thin ring, and the initial drawn in the color.
export function ProfileAvatar({
  avatar,
  color,
  size = 100,
  locked = false,
  badge,
}: {
  avatar?: string;
  color?: string;
  size?: number;
  locked?: boolean;
  badge?: React.ComponentProps<typeof Ionicons>["name"];
}) {
  const c = color || PROFILE_COLORS[0];
  const halo = Math.round(size * 1.1);
  // A pasted image URL, a bundled 3D picture, or a generated cartoon (transparent SVG over the tint).
  const generated = isGeneratedAvatar(avatar);
  const bundled = bundledAvatarSource(avatar);
  const imageUri = isImageAvatar(avatar) ? avatar! : generatedAvatarUri(avatar);
  const isImage = !!imageUri || bundled !== null;
  const text = (avatar || "?").trim();
  // Single letters get the tinted look; emoji already carry their own color.
  // (case test instead of \p{L}: Unicode property escapes aren't safe on every Hermes build)
  const isLetter = text.length === 1 && (text.toUpperCase() !== text.toLowerCase() || /[0-9]/.test(text));
  const badgeSize = Math.max(22, Math.round(size * 0.3));

  return (
    <View style={{ width: halo, height: halo, alignItems: "center", justifyContent: "center" }}>
      <View style={[StyleSheet.absoluteFill, { borderRadius: halo / 2, backgroundColor: withAlpha(c, 0.2) }]} />
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          overflow: "hidden",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: withAlpha(c, isLetter ? 0.15 : 0.28),
          borderWidth: isImage && !generated ? 0 : 2,
          borderColor: withAlpha(c, 0.4),
        }}
      >
        {isImage ? (
          <Image
            source={bundled ?? { uri: imageUri! }}
            style={{ width: size, height: size }}
            contentFit="cover"
            cachePolicy={generated || bundled !== null ? "memory" : "memory-disk"}
          />
        ) : (
          <Text
            style={{
              color: isLetter ? c : "#fff",
              fontSize: Math.round(size * (isLetter ? 0.38 : 0.46)),
              fontWeight: "800",
              textAlign: "center",
            }}
          >
            {isLetter ? text.toUpperCase() : text}
          </Text>
        )}
      </View>
      {(locked || badge) && (
        <View
          style={[
            styles.badge,
            { width: badgeSize, height: badgeSize, borderRadius: badgeSize / 2, backgroundColor: badge ? "#fff" : c },
          ]}
        >
          <Ionicons name={badge || "lock-closed"} size={Math.round(badgeSize * 0.48)} color={badge ? "#000" : "#fff"} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: "absolute",
    right: 2,
    bottom: 2,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#000",
  },
});
