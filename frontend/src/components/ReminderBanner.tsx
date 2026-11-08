import React, { useEffect } from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { useReminders, type Reminder } from "@/src/store/reminders-store";
import { useIPTV, getEpgNow } from "@/src/store/iptv-store";
import { useTheme } from "@/src/store/theme-store";
import { FocusPressable } from "@/src/components/FocusPressable";
import { ChannelAvatar } from "@/src/components/ChannelAvatar";
import { cleanChannelName } from "@/src/utils/clean-name";
import { colors, spacing, radius, font } from "@/src/theme/tokens";

const CHECK_EVERY_MS = 15_000;

const electronNotify: ((title: string, body: string, tag: string) => void) | null =
  Platform.OS === "web" && typeof window !== "undefined" && (window as any).electronAPI?.notify
    ? (window as any).electronAPI.notify
    : null;

/**
 * Watches EPG reminders while the app is open and shows a "starting now" card
 * with a Watch button. On desktop a Windows notification is shown as well, so
 * a minimised window still gets the user's attention.
 */
export function ReminderBanner() {
  const router = useRouter();
  const { accentColor } = useTheme();
  const due = useReminders((s) => s.due);
  const dismissDue = useReminders((s) => s.dismissDue);

  useEffect(() => {
    const check = () => {
      const fired = useReminders.getState().tick(getEpgNow());
      for (const r of fired) electronNotify?.(`Başlıyor: ${r.title}`, cleanChannelName(r.channelName), r.id);
    };
    check();
    const timer = setInterval(check, CHECK_EVERY_MS);
    return () => clearInterval(timer);
  }, []);

  const watch = (r: Reminder) => {
    dismissDue(r.id);
    const ch = useIPTV.getState().playlist?.channels.find((c) => c.id === r.channelId);
    if (!ch) return;
    useIPTV.getState().pushRecent(ch.id);
    router.push({ pathname: "/player", params: { url: ch.url, title: ch.name, kind: "live", itemId: ch.id, logo: ch.logo || "" } });
  };

  // Clicking the Windows notification opens the programme.
  const watchRef = React.useRef(watch);
  watchRef.current = watch;
  useEffect(() => {
    const api = Platform.OS === "web" && typeof window !== "undefined" ? (window as any).electronAPI : null;
    api?.onNotificationClick?.((tag: string) => {
      const r = useReminders.getState().due.find((d) => d.id === tag);
      if (r) watchRef.current(r);
    });
  }, []);

  const r = due[0];
  if (!r) return null;
  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={[styles.card, { borderColor: accentColor }]}>
        <View style={styles.logo}>
          <ChannelAvatar name={r.channelName} logo={r.logo} textStyle={{ fontSize: 14 }} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.kicker}>
            <Ionicons name="notifications" size={13} color={accentColor} />
            <Text style={[styles.kickerText, { color: accentColor }]}>ŞİMDİ BAŞLIYOR</Text>
          </View>
          <Text style={styles.title} numberOfLines={2}>{r.title}</Text>
          <Text style={styles.meta} numberOfLines={1}>{cleanChannelName(r.channelName)}</Text>
        </View>
        <View style={styles.actions}>
          <FocusPressable
            hasTVPreferredFocus={Platform.isTV}
            onPress={() => watch(r)}
            style={({ focused }: any) => [styles.btn, { backgroundColor: accentColor }, focused && styles.btnFocused]}
            testID="reminder-watch"
          >
            <Text style={styles.btnText}>İzle</Text>
          </FocusPressable>
          <FocusPressable
            onPress={() => dismissDue(r.id)}
            style={({ focused }: any) => [styles.btn, styles.btnGhost, focused && styles.btnFocused]}
            testID="reminder-dismiss"
          >
            <Text style={styles.btnGhostText}>Kapat</Text>
          </FocusPressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", top: spacing.xxl + 16, right: spacing.xl, left: spacing.xl, alignItems: "flex-end", zIndex: 9001 },
  card: {
    width: "100%",
    maxWidth: 460,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.md,
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 24,
    elevation: 12,
  },
  logo: { width: 48, height: 48, borderRadius: radius.sm, overflow: "hidden" },
  kicker: { flexDirection: "row", alignItems: "center", gap: 4 },
  kickerText: { fontSize: 11, fontWeight: "800", letterSpacing: 0.8 },
  title: { color: colors.onSurface, fontSize: font.base, fontWeight: "700", marginTop: 2 },
  meta: { color: colors.textMuted, fontSize: font.sm, marginTop: 1 },
  actions: { gap: 6 },
  btn: { paddingVertical: 7, paddingHorizontal: spacing.md, borderRadius: radius.pill, alignItems: "center", borderWidth: 2, borderColor: "transparent" },
  btnFocused: { borderColor: "#fff" },
  btnGhost: { backgroundColor: "rgba(255,255,255,0.08)" },
  btnText: { color: "#fff", fontWeight: "700", fontSize: font.sm },
  btnGhostText: { color: colors.onSurface, fontWeight: "600", fontSize: font.sm },
});
