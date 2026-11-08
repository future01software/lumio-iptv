import React from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useUpdates } from "@/src/store/update-store";
import { useTheme } from "@/src/store/theme-store";
import { currentVersion } from "@/src/services/updater";
import { FocusPressable } from "@/src/components/FocusPressable";
import { colors, spacing, radius, font } from "@/src/theme/tokens";

/** Bottom-right card offering a newer release; also shows download progress. */
export function UpdatePrompt() {
  const { accentColor } = useTheme();
  const status = useUpdates((s) => s.status);
  const manifest = useUpdates((s) => s.manifest);
  const progress = useUpdates((s) => s.progress);
  const error = useUpdates((s) => s.error);
  const dismissed = useUpdates((s) => s.dismissed);
  const download = useUpdates((s) => s.download);
  const install = useUpdates((s) => s.install);
  const dismiss = useUpdates((s) => s.dismiss);

  const visible =
    !dismissed && !!manifest && (status === "available" || status === "downloading" || status === "ready" || (status === "error" && progress > 0));
  if (!visible || !manifest) return null;

  const downloading = status === "downloading";
  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.card}>
        <View style={styles.header}>
          <View style={[styles.iconChip, { backgroundColor: `${accentColor}33` }]}>
            <Ionicons name="arrow-down-circle" size={22} color={accentColor} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Yeni sürüm: {manifest.version}</Text>
            <Text style={styles.meta}>Yüklü sürüm {currentVersion()}</Text>
          </View>
        </View>

        {!!manifest.notes && !downloading && (
          <Text style={styles.notes} numberOfLines={6}>{manifest.notes}</Text>
        )}

        {downloading && (
          <View style={{ gap: 6 }}>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${Math.round(progress * 100)}%`, backgroundColor: accentColor }]} />
            </View>
            <Text style={styles.meta}>İndiriliyor… %{Math.round(progress * 100)}</Text>
          </View>
        )}
        {status === "ready" && <Text style={styles.meta}>Kurulum başlatılıyor…</Text>}
        {status === "error" && !!error && <Text style={styles.error}>{error}</Text>}

        {!downloading && status !== "ready" && (
          <View style={styles.actions}>
            <FocusPressable
              onPress={dismiss}
              style={({ focused }: any) => [styles.btn, styles.btnGhost, focused && styles.btnFocused]}
              testID="update-later"
            >
              <Text style={styles.btnGhostText}>Sonra</Text>
            </FocusPressable>
            <FocusPressable
              hasTVPreferredFocus={Platform.isTV}
              onPress={() => (status === "error" && progress >= 1 ? install() : download())}
              style={({ focused }: any) => [styles.btn, { backgroundColor: accentColor }, focused && styles.btnFocused]}
              testID="update-now"
            >
              <Text style={styles.btnText}>{status === "error" ? "Tekrar dene" : "Şimdi güncelle"}</Text>
            </FocusPressable>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", right: spacing.xl, bottom: spacing.xl, left: spacing.xl, alignItems: "flex-end", zIndex: 9000 },
  card: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    padding: spacing.lg,
    gap: spacing.md,
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 24,
    elevation: 12,
  },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  iconChip: { width: 40, height: 40, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  title: { color: colors.onSurface, fontSize: font.lg, fontWeight: "800" },
  meta: { color: colors.textMuted, fontSize: font.sm },
  notes: { color: colors.onSurfaceSecondary, fontSize: font.base, lineHeight: 20 },
  error: { color: colors.error, fontSize: font.sm },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 3 },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm },
  btn: { paddingVertical: 10, paddingHorizontal: spacing.lg, borderRadius: radius.pill, borderWidth: 2, borderColor: "transparent" },
  btnFocused: { borderColor: "#fff", transform: [{ scale: 1.04 }] },
  btnGhost: { backgroundColor: "rgba(255,255,255,0.08)" },
  btnText: { color: "#fff", fontWeight: "700", fontSize: font.base },
  btnGhostText: { color: colors.onSurface, fontWeight: "600", fontSize: font.base },
});
