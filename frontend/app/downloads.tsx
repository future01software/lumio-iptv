import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, FlatList, ActivityIndicator, Platform } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { useDownloads, fmtBytes, type DownloadItem } from "@/src/store/downloads-store";
import { useI18n } from "@/src/store/i18n-store";
import { colors, spacing, radius, font } from "@/src/theme/tokens";
import { useTheme } from "@/src/store/theme-store";

export default function Downloads() {
  const { accentColor } = useTheme();
  const router = useRouter();
  const items = useDownloads((s) => s.items);
  const init = useDownloads((s) => s.init);
  const initialized = useDownloads((s) => s.initialized);
  const pause = useDownloads((s) => s.pause);
  const resume = useDownloads((s) => s.resume);
  const cancel = useDownloads((s) => s.cancel);
  const remove = useDownloads((s) => s.remove);
  const storageStats = useDownloads((s) => s.storageStats);
  const { t } = useI18n();

  const [stats, setStats] = useState<{ used: number; count: number; free?: number }>({ used: 0, count: 0 });

  useEffect(() => { init(); }, [init]);
  useEffect(() => {
    storageStats().then(setStats);
  }, [items, storageStats]);

  const list = Object.values(items).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  if (!initialized) {
    return (
      <View style={styles.center}><ActivityIndicator color={accentColor} /></View>
    );
  }

  return (
    <View style={styles.root}>
      <SafeAreaView edges={["top"]} style={styles.header}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
            <Ionicons name="chevron-back" size={26} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.title}>{t("downloads.title")}</Text>
          <View style={{ width: 26 }} />
        </View>
        <View style={styles.storageBox}>
          <View style={{ flex: 1 }}>
            <Text style={styles.storageLabel}>{t("downloads.storage_used")}</Text>
            <Text style={styles.storageValue}>{fmtBytes(stats.used)} · {stats.count}</Text>
            {typeof stats.free === "number" && (
              <Text style={styles.storageFree}>{t("downloads.free", { free: fmtBytes(stats.free) })}</Text>
            )}
          </View>
          <Ionicons name="server-outline" size={32} color={accentColor} />
        </View>
      </SafeAreaView>

      <FlatList
        data={list}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: 60 }}
        renderItem={({ item }) => (
          <DownloadRow
            item={item}
            onPlay={() => router.push({ pathname: "/player", params: { url: item.fileUri || item.url, title: item.name, kind: item.kind, itemId: item.id, logo: item.logo || "" } })}
            onPause={() => pause(item.id)}
            onResume={() => resume(item.id)}
            onCancel={() => cancel(item.id)}
            onDelete={() => remove(item.id)}
          />
        )}
        ListEmptyComponent={
          <View style={{ alignItems: "center", padding: spacing.xxxl }}>
            <Ionicons name={Platform.OS === "web" ? "cloud-offline-outline" : "cloud-download-outline"} size={48} color={colors.textMuted} />
            <Text style={{ color: colors.textMuted, marginTop: spacing.md, fontSize: font.lg, fontWeight: "600" }}>
              {Platform.OS === "web" ? "Çevrimdışı indirme henüz masaüstünde yok" : t("downloads.empty")}
            </Text>
            <Text style={{ color: colors.textMuted, marginTop: 4, fontSize: font.sm, textAlign: "center", paddingHorizontal: spacing.xl }}>
              {Platform.OS === "web" ? "Bu özellik Android/iOS sürümlerinde kullanılabilir." : t("downloads.empty_hint")}
            </Text>
          </View>
        }
      />
    </View>
  );
}

function DownloadRow({ item, onPlay, onPause, onResume, onCancel, onDelete }: {
  item: DownloadItem;
  onPlay: () => void; onPause: () => void; onResume: () => void; onCancel: () => void; onDelete: () => void;
}) {
  const { accentColor } = useTheme();
  const percent = Math.round((item.progress || 0) * 100);
  const subtitle =
    item.status === "downloading" ? `${percent}% · ${fmtBytes(item.downloadedBytes)} / ${fmtBytes(item.totalBytes)}` :
    item.status === "paused" ? `Paused · ${percent}%` :
    item.status === "completed" ? `Completed · ${fmtBytes(item.downloadedBytes)}` :
    item.status === "failed" ? `Failed${item.error ? ` · ${item.error}` : ""}` :
    "Queued";

  return (
    <View style={styles.row} testID={`download-row-${item.id}`}>
      <View style={styles.thumb}>
        {item.logo ? (
          <Image source={{ uri: item.logo }} style={StyleSheet.absoluteFillObject} contentFit="cover" />
        ) : (
          <Ionicons name={item.kind === "series" ? "albums" : "film"} size={26} color={colors.textMuted} />
        )}
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={styles.name} numberOfLines={2}>{item.name}</Text>
        <Text style={[styles.sub, item.status === "failed" && { color: colors.error }]} numberOfLines={1}>{subtitle}</Text>
        {item.status !== "completed" && item.status !== "failed" && (
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${percent}%`, backgroundColor: accentColor }]} />
          </View>
        )}
      </View>
      <View style={styles.actions}>
        {item.status === "completed" && (
          <TouchableOpacity onPress={onPlay} hitSlop={6} testID={`download-play-${item.id}`}>
            <Ionicons name="play-circle" size={30} color={accentColor} />
          </TouchableOpacity>
        )}
        {item.status === "downloading" && (
          <TouchableOpacity onPress={onPause} hitSlop={6} testID={`download-pause-${item.id}`}>
            <Ionicons name="pause-circle" size={28} color="#fff" />
          </TouchableOpacity>
        )}
        {(item.status === "paused" || item.status === "failed") && (
          <TouchableOpacity onPress={onResume} hitSlop={6} testID={`download-resume-${item.id}`}>
            <Ionicons name="play-circle" size={28} color="#fff" />
          </TouchableOpacity>
        )}
        <TouchableOpacity
          onPress={item.status === "completed" ? onDelete : onCancel}
          hitSlop={6}
          testID={`download-delete-${item.id}`}
        >
          <Ionicons name={item.status === "completed" ? "trash" : "close-circle"} size={24} color={colors.textMuted} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: spacing.sm, marginBottom: spacing.md },
  title: { color: colors.onSurface, fontSize: font.xl, fontWeight: "800" },
  storageBox: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md },
  storageLabel: { color: colors.textMuted, fontSize: font.sm, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
  storageValue: { color: colors.onSurface, fontSize: font.xl, fontWeight: "800", marginTop: 4 },
  storageFree: { color: colors.textMuted, fontSize: font.sm, marginTop: 2 },
  row: { flexDirection: "row", gap: spacing.md, padding: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: "center" },
  thumb: { width: 70, height: 70, borderRadius: radius.sm, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  name: { color: colors.onSurface, fontSize: font.base, fontWeight: "600" },
  sub: { color: colors.textMuted, fontSize: font.sm },
  progressTrack: { height: 4, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 2, overflow: "hidden", marginTop: 4 },
  progressFill: { height: "100%", backgroundColor: colors.brandPrimary },
  actions: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
});
