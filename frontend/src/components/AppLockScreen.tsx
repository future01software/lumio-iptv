import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";

import { useAppLock } from "@/src/store/app-lock-store";
import { useI18n } from "@/src/store/i18n-store";
import { colors, spacing, radius, font } from "@/src/theme/tokens";
import { useTheme } from "@/src/store/theme-store";
import { withAlpha } from "@/src/utils/color";

export function AppLockScreen() {
  const { accentColor } = useTheme();
  const verifyPin = useAppLock((s) => s.verifyPin);
  const unlock = useAppLock((s) => s.unlock);
  const tryBiometric = useAppLock((s) => s.tryBiometric);
  const biometricEnabled = useAppLock((s) => s.biometricEnabled);
  const { t } = useI18n();

  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (biometricEnabled) {
      tryBiometric().catch(() => {});
    }
  }, [biometricEnabled, tryBiometric]);

  async function submit() {
    const ok = await verifyPin(pin);
    if (ok) unlock();
    else { setError(t("profiles.bad_pin")); setPin(""); }
  }

  return (
    <View style={StyleSheet.absoluteFillObject}>
      <BlurView intensity={80} tint="dark" style={StyleSheet.absoluteFillObject} />
      <View style={styles.center}>
        <View style={styles.card}>
          <View style={[styles.lockIcon, { backgroundColor: withAlpha(accentColor, 0.15), borderColor: withAlpha(accentColor, 0.4) }]}>
            <Ionicons name="lock-closed" size={36} color={accentColor} />
          </View>
          <Text style={styles.title}>{t("lock.title")}</Text>
          <Text style={styles.subtitle}>{t("lock.subtitle")}</Text>
          <TextInput
            value={pin}
            onChangeText={(t) => { setPin(t); setError(null); }}
            placeholder="••••"
            placeholderTextColor={colors.textMuted}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={8}
            style={styles.input}
            autoFocus
            testID="app-lock-pin"
          />
          {error && <Text style={styles.error}>{error}</Text>}
          <TouchableOpacity style={[styles.btn, { backgroundColor: accentColor }]} onPress={submit} testID="app-lock-submit">
            <Text style={styles.btnText}>Kilidi Aç</Text>
          </TouchableOpacity>
          {biometricEnabled && (
            <TouchableOpacity style={styles.bioBtn} onPress={() => tryBiometric()} testID="app-lock-biometric">
              <Ionicons name="finger-print" size={20} color={colors.onSurface} />
              <Text style={styles.bioBtnText}>Parmak İzi / Yüz ile Aç</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg },
  card: { width: "100%", maxWidth: 360, padding: spacing.xl, borderRadius: radius.lg, backgroundColor: "rgba(20,20,20,0.85)", borderWidth: 1, borderColor: colors.border, alignItems: "center", gap: spacing.md },
  lockIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: "rgba(229,9,20,0.15)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(229,9,20,0.4)" },
  title: { color: colors.onSurface, fontSize: font.xxl, fontWeight: "800" },
  subtitle: { color: colors.textMuted, fontSize: font.sm },
  input: { width: "100%", backgroundColor: "rgba(255,255,255,0.06)", borderRadius: radius.md, padding: spacing.md, color: colors.onSurface, fontSize: font.xl, textAlign: "center", borderWidth: 1, borderColor: colors.border, letterSpacing: 12, paddingVertical: Platform.OS === "ios" ? 16 : 12 },
  btn: { width: "100%", backgroundColor: colors.brandPrimary, padding: spacing.md, borderRadius: radius.pill, alignItems: "center" },
  btnText: { color: "#fff", fontWeight: "700", fontSize: font.lg },
  bioBtn: { flexDirection: "row", gap: 8, alignItems: "center", paddingVertical: 10 },
  bioBtnText: { color: colors.onSurface, fontWeight: "600" },
  error: { color: colors.error, fontSize: font.sm },
});
