import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, Modal, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from "react-native-reanimated";
import { ProfileAvatar, withAlpha } from "@/src/components/profile/ProfileAvatar";
import { colors, font, radius, spacing } from "@/src/theme/tokens";

export type PinSubmitResult = null | { error: string; lockSec?: number };

type Props = {
  title: string;
  subtitle?: string;
  avatar?: string;
  color?: string;
  /** Fixed length → auto-submits on the last digit. Omit for legacy 4–6 digit PINs (needs OK). */
  length?: number;
  /** Resolve null on success, or an error to shake + clear the dots. */
  onSubmit: (pin: string) => Promise<PinSubmitResult>;
  onCancel: () => void;
};

const MIN_LEN = 4;
const MAX_LEN = 6;
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "back", "0", "ok"] as const;

// Nuvio's PinEntryDialog: dots + an on-screen keypad, so it works with a TV
// remote (D-pad focus), a mouse, touch, or the physical number keys.
export function PinPad({ title, subtitle, avatar, color, length, onSubmit, onCancel }: Props) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lockLeft, setLockLeft] = useState(0);
  const accent = color || colors.brandPrimary;
  const dots = length || Math.max(MIN_LEN, pin.length);
  const maxLen = length || MAX_LEN;

  const shakeX = useSharedValue(0);
  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shakeX.value }] }));

  useEffect(() => {
    if (lockLeft <= 0) return;
    const t = setTimeout(() => setLockLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [lockLeft]);

  const submit = useCallback(
    async (value: string) => {
      if (busy || value.length < MIN_LEN) return;
      setBusy(true);
      const result = await onSubmit(value);
      setBusy(false);
      if (!result) return;
      setError(result.error);
      if (result.lockSec) setLockLeft(result.lockSec);
      setPin("");
      shakeX.value = withSequence(
        withTiming(-12, { duration: 50 }),
        withTiming(12, { duration: 70 }),
        withTiming(-8, { duration: 60 }),
        withTiming(8, { duration: 60 }),
        withTiming(0, { duration: 50 }),
      );
    },
    [busy, onSubmit, shakeX],
  );

  const press = useCallback(
    (key: (typeof KEYS)[number]) => {
      if (lockLeft > 0 || busy) return;
      if (key === "back") {
        setPin((p) => p.slice(0, -1));
        return;
      }
      if (key === "ok") {
        submit(pin);
        return;
      }
      if (pin.length >= maxLen) return;
      const next = pin + key;
      setPin(next);
      setError(null);
      if (length && next.length === length) submit(next);
    },
    [busy, length, lockLeft, maxLen, pin, submit],
  );

  // Physical keyboard on desktop/web.
  const pressRef = useRef(press);
  pressRef.current = press;
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) pressRef.current(e.key as any);
      else if (e.key === "Backspace") pressRef.current("back");
      else if (e.key === "Enter") pressRef.current("ok");
      else if (e.key === "Escape") onCancel();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const locked = lockLeft > 0;

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          {(avatar || color) && <ProfileAvatar avatar={avatar} color={color} size={64} />}
          <Text style={styles.title}>{title}</Text>
          {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}

          <Animated.View style={[styles.dots, shakeStyle]}>
            {Array.from({ length: dots }, (_, i) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  { borderColor: withAlpha(accent, 0.6) },
                  i < pin.length && { backgroundColor: accent, borderColor: accent },
                ]}
              />
            ))}
          </Animated.View>

          <Text style={[styles.error, !(error || locked) && { opacity: 0 }]}>
            {locked ? `Çok fazla deneme. ${lockLeft} sn sonra tekrar dene.` : error || " "}
          </Text>

          <View style={styles.pad}>
            {KEYS.map((key) => (
              <PadKey
                key={key}
                k={key}
                accent={accent}
                disabled={locked || busy || (key === "ok" && (pin.length < MIN_LEN || !!length))}
                onPress={() => press(key)}
                preferredFocus={key === "1"}
              />
            ))}
          </View>

          <Pressable onPress={onCancel} style={styles.cancel} focusable>
            {({ focused, hovered }: any) => (
              <Text style={[styles.cancelText, (focused || hovered) && { color: "#fff" }]}>İptal</Text>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function PadKey({
  k,
  accent,
  disabled,
  onPress,
  preferredFocus,
}: {
  k: (typeof KEYS)[number];
  accent: string;
  disabled: boolean;
  onPress: () => void;
  preferredFocus: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      focusable
      // @ts-ignore - TV only
      hasTVPreferredFocus={Platform.isTV && preferredFocus}
      style={({ focused, hovered, pressed }: any) => [
        styles.key,
        (focused || hovered) && { backgroundColor: withAlpha(accent, 0.25), borderColor: accent },
        pressed && { transform: [{ scale: 0.94 }] },
        disabled && { opacity: 0.35 },
      ]}
    >
      {k === "back" ? (
        <Ionicons name="backspace-outline" size={24} color="#fff" />
      ) : k === "ok" ? (
        <Ionicons name="checkmark" size={26} color="#fff" />
      ) : (
        <Text style={styles.keyText}>{k}</Text>
      )}
    </Pressable>
  );
}

const KEY = 68;
const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.82)", alignItems: "center", justifyContent: "center", padding: spacing.lg },
  card: {
    width: "100%",
    maxWidth: 360,
    alignItems: "center",
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    borderRadius: 24,
    backgroundColor: "rgba(20,20,22,0.96)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    gap: spacing.sm,
  },
  title: { color: "#fff", fontSize: font.xl, fontWeight: "800", marginTop: spacing.sm, textAlign: "center" },
  subtitle: { color: colors.textMuted, fontSize: font.base, textAlign: "center" },
  dots: { flexDirection: "row", gap: 14, marginTop: spacing.md },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2 },
  error: { color: colors.error, fontSize: font.sm, minHeight: 18, textAlign: "center" },
  pad: { flexDirection: "row", flexWrap: "wrap", width: KEY * 3 + 16 * 2, gap: 16, justifyContent: "center", marginTop: spacing.xs },
  key: {
    width: KEY,
    height: KEY,
    borderRadius: KEY / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 2,
    borderColor: "transparent",
  },
  keyText: { color: "#fff", fontSize: 26, fontWeight: "600" },
  cancel: { marginTop: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill },
  cancelText: { color: colors.textMuted, fontSize: font.lg, fontWeight: "600" },
});
