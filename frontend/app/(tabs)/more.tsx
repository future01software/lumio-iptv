import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { useIPTV } from "@/src/store/iptv-store";
import { useAccount } from "@/src/store/account-store";
import { useDownloads } from "@/src/store/downloads-store";
import { useResponsive } from "@/src/hooks/use-responsive";
import { SettingsView } from "@/app/settings";
import { useI18n } from "@/src/store/i18n-store";
import { useTheme } from "@/src/store/theme-store";
import { colors, spacing, radius, font } from "@/src/theme/tokens";
import { withAlpha } from "@/src/utils/color";

export default function More() {
  const { isDesktop } = useResponsive();
  // Desktop: "Daha" is Nuvio's settings root - categories on the left, content
  // on the right, with the app rail still visible.
  if (isDesktop) return <SettingsView embedded />;
  return <MoreMobile />;
}

function MoreMobile() {
  const router = useRouter();
  const { isTVStyle } = useResponsive();
  const config = useIPTV((s) => s.config);
  const playlist = useIPTV((s) => s.playlist);
  const clearPlaylist = useIPTV((s) => s.clearPlaylist);
  const loadEPG = useIPTV((s) => s.loadEPG);
  const epgLoading = useIPTV((s) => s.epgLoading);
  const favCount = Object.keys(useIPTV((s) => s.favorites)).length;
  const histCount = useIPTV((s) => s.history.length);
  const collectionsCount = useIPTV((s) => s.collections.length);
  const downloadsCount = Object.keys(useDownloads((s) => s.items)).length;
  const { t } = useI18n();
  const { accentColor } = useTheme();

  const accountLogout = useAccount((s) => s.logout);

  async function logout() {
    await clearPlaylist();
    await accountLogout();
    router.replace("/login");
  }

  return (
    <View style={styles.root}>
      {!isTVStyle && (
        <SafeAreaView edges={["top"]}>
          <Text style={styles.title}>{t("more.title")}</Text>
        </SafeAreaView>
      )}
      <ScrollView /* FORCE INVALIDATE */ contentContainerStyle={{ padding: spacing.lg, paddingTop: isTVStyle ? 130 : spacing.lg, paddingBottom: 140, gap: spacing.lg }}>
        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            <Ionicons name="person" size={32} color={colors.onSurface} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.profileName}>{config?.name || t("more.guest") || "Guest"}</Text>
            <Text style={styles.profileMeta} numberOfLines={1}>
              {config?.type === "xtream" ? config?.server : config?.m3u_url || t("home.no_playlist")}
            </Text>
            <Text style={styles.profileStats}>
              {playlist?.channels.length || 0} {t("settings.playlist.channels")} · {playlist?.movies.length || 0} {t("settings.playlist.movies")} · {playlist?.series.length || 0} {t("settings.playlist.series")}
            </Text>
          </View>
        </View>

        <Group title={t("more.library")}>
          <Row icon="search" label={t("more.search")} onPress={() => router.push("/search")} testID="more-search" accentColor={accentColor} />
          <Row icon="heart" label={`${t("more.favorites")} (${favCount})`} onPress={() => router.push("/favorites")} testID="more-favorites" accentColor={accentColor} />
          <Row icon="bookmark" label="İzleme Listesi" onPress={() => router.push("/favorites?tab=watchlist")} testID="more-watchlist" accentColor={accentColor} />
          <Row icon="folder" label={`Koleksiyonlar (${collectionsCount})`} onPress={() => router.push("/collections")} testID="more-collections" accentColor={accentColor} />
          <Row icon="time" label={`${t("more.history")} (${histCount})`} onPress={() => router.push("/favorites?tab=history")} testID="more-history" accentColor={accentColor} />
          <Row icon="cloud-download" label={`${t("more.downloads")} (${downloadsCount})`} onPress={() => router.push("/downloads")} testID="more-downloads" accentColor={accentColor} />
          <Row icon="people" label={t("more.profiles")} onPress={() => router.push("/profiles")} testID="more-profiles" accentColor={accentColor} />
          <Row icon="calendar" label={t("more.epg")} onPress={() => router.push("/epg")} testID="more-epg" accentColor={accentColor} />
          <Row icon="grid" label="Çoklu Ekran" onPress={() => router.push("/multiview")} testID="more-multiview" accentColor={accentColor} />
        </Group>

        <Group title={t("more.playlist")}>
          <Row icon="refresh" label={t("more.refresh")} onPress={async () => {
            if (config) {
              await useIPTV.getState().loadPlaylist(config);
            }
          }} testID="more-refresh" accentColor={accentColor} />
          <Row icon="cloud-download" label={epgLoading ? "…" : t("more.refresh_epg")} onPress={() => loadEPG()} testID="more-refresh-epg" accentColor={accentColor} />
          <Row icon="swap-horizontal" label={t("more.switch")} onPress={logout} testID="more-switch" accentColor={accentColor} />
        </Group>

        <Group title={t("more.settings")}>
          <Row icon="settings" label={t("more.app_settings")} onPress={() => router.push("/settings")} testID="more-settings" accentColor={accentColor} />
          <Row icon="information-circle" label={t("more.about")} onPress={() => router.push("/settings")} testID="more-about" accentColor={accentColor} />
        </Group>

        <LogoutButton logout={logout} t={t} />
      </ScrollView>
    </View>
  );
}

function LogoutButton({ logout, t }: any) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[
        styles.logoutBtn,
        focused && { backgroundColor: withAlpha(colors.error, 0.3), transform: [{ scale: 1.02 }], borderWidth: 2, borderColor: colors.error, borderRadius: radius.md }
      ]}
      onPress={logout}
      testID="more-logout"
      focusable={true}
    >
      <Ionicons name="log-out-outline" size={20} color={focused ? "#FFF" : colors.error} />
      <Text style={[styles.logoutText, focused && { color: "#FFF" }]}>{t("more.disconnect")}</Text>
    </Pressable>
  );
}

function Group({ title, children }: any) {
  return (
    <View>
      <Text style={styles.groupTitle}>{title}</Text>
      <View style={styles.group}>{children}</View>
    </View>
  );
}
function Row({ icon, label, onPress, testID, accentColor }: any) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable 
      style={[
        styles.row, 
        focused && { backgroundColor: accentColor }
      ]} 
      onPress={onPress} 
      testID={testID}
      focusable={true}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      <View style={[styles.rowIcon, focused && { backgroundColor: "rgba(255,255,255,0.2)" }]}>
        <Ionicons name={icon} size={20} color={focused ? "#FFF" : colors.onSurface} />
      </View>
      <Text style={[styles.rowLabel, focused && { color: "#FFF", fontWeight: "700" }]}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color={focused ? "#FFF" : colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  title: { color: colors.onSurface, fontSize: font.xxl, fontWeight: "800", paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  profileCard: { flexDirection: "row", gap: spacing.md, padding: spacing.lg, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, alignItems: "center" },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  profileName: { color: colors.onSurface, fontSize: font.xl, fontWeight: "700" },
  profileMeta: { color: colors.textMuted, fontSize: font.sm, marginTop: 2 },
  profileStats: { color: colors.textMuted, fontSize: font.sm, marginTop: 6 },
  groupTitle: { color: colors.textMuted, fontSize: font.sm, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase", marginBottom: spacing.sm, marginLeft: spacing.xs },
  group: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 14, paddingHorizontal: spacing.lg, gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  rowIcon: { width: 32, height: 32, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.06)", alignItems: "center", justifyContent: "center" },
  rowLabel: { flex: 1, color: colors.onSurface, fontSize: font.lg, fontWeight: "500" },
  logoutBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: "rgba(255,69,58,0.4)" },
  logoutText: { color: colors.error, fontSize: font.lg, fontWeight: "700" },
});
