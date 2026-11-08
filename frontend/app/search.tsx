import React, { useMemo, useRef, useState, useDeferredValue } from "react";
import { View, Text, StyleSheet, TextInput, TouchableOpacity } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { useIPTV } from "@/src/store/iptv-store";
import { useI18n } from "@/src/store/i18n-store";
import { startVoiceSearch, isVoiceSearchSupported, type VoiceSession } from "@/src/utils/voice-search";
import { colors, spacing, radius, font } from "@/src/theme/tokens";
import { useTheme } from "@/src/store/theme-store";

type ResultKind = "live" | "movie" | "series";
type Result = { id: string; name: string; logo?: string | null; kind: ResultKind; url?: string };

export default function Search() {
  const { accentColor } = useTheme();
  const router = useRouter();
  const playlist = useIPTV((s) => s.playlist);
  const { t, locale } = useI18n();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"all" | ResultKind>("all");
  const [listening, setListening] = useState(false);
  const [voiceMsg, setVoiceMsg] = useState<string | null>(null);
  const voiceRef = useRef<VoiceSession | null>(null);

  function toggleVoice() {
    if (listening) {
      voiceRef.current?.stop();
      setListening(false);
      return;
    }
    if (!isVoiceSearchSupported()) {
      setVoiceMsg(t("search.voice_unavailable"));
      setTimeout(() => setVoiceMsg(null), 3000);
      return;
    }
    setVoiceMsg(null);
    setListening(true);
    voiceRef.current = startVoiceSearch({
      locale: locale === "tr" ? "tr-TR" : "en-US",
      onResult: (text, isFinal) => { setQuery(text); if (isFinal) setListening(false); },
      onError: (m) => { setVoiceMsg(m); setListening(false); },
      onEnd: () => setListening(false),
    });
    if (!voiceRef.current) setListening(false);
  }

  const deferredQuery = useDeferredValue(query);

  const results = useMemo<Result[]>(() => {
    const q = deferredQuery.trim().toLowerCase();
    if (!playlist || !q) return [];
    const chs: Result[] = playlist.channels.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 50)
      .map((c) => ({ id: c.id, name: c.name, logo: c.logo, kind: "live", url: c.url }));
    const mvs: Result[] = playlist.movies.filter((m) => m.name.toLowerCase().includes(q)).slice(0, 50)
      .map((m) => ({ id: m.id, name: m.name, logo: m.logo, kind: "movie", url: m.url }));
    const sr: Result[] = playlist.series.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 50)
      .map((s) => ({ id: s.id, name: s.name, logo: s.logo, kind: "series" }));
    const all = [...chs, ...mvs, ...sr];
    return tab === "all" ? all : all.filter((r) => r.kind === tab);
  }, [playlist, deferredQuery, tab]);

  return (
    <View style={styles.root}>
      <SafeAreaView edges={["top"]} style={styles.header}>
        <View style={styles.searchRow}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
            <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
          </TouchableOpacity>
          <View style={styles.searchBox}>
            <Ionicons name="search" size={18} color={colors.textMuted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              autoFocus
              placeholder={t("search.placeholder")}
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              testID="search-input"
            />
            {query.length > 0 && (
              <TouchableOpacity onPress={() => setQuery("")} hitSlop={10}>
                <Ionicons name="close-circle" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={toggleVoice} hitSlop={10} testID="search-voice-button">
              <Ionicons
                name={listening ? "mic" : "mic-outline"}
                size={20}
                color={listening ? accentColor : colors.textMuted}
              />
            </TouchableOpacity>
          </View>
        </View>
        {listening && (
          <Text style={{ color: accentColor, fontSize: font.sm, marginTop: 4 }} testID="search-listening">
            {t("search.listening")}
          </Text>
        )}
        {voiceMsg && (
          <Text style={{ color: colors.warning, fontSize: font.sm, marginTop: 4 }}>{voiceMsg}</Text>
        )}
        <View style={styles.tabs}>
          {(["all", "live", "movie", "series"] as const).map((t) => (
            <TouchableOpacity
              key={t}
              style={[styles.tabBtn, tab === t && [styles.tabActive, { backgroundColor: accentColor, borderColor: accentColor }]]}
              onPress={() => setTab(t)}
              testID={`search-tab-${t}`}
            >
              <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>{t === "all" ? "Tümü" : t === "live" ? "Kanallar" : t === "movie" ? "Filmler" : "Diziler"}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </SafeAreaView>

      <FlashList
        data={results}
        keyExtractor={(i) => `${i.kind}-${i.id}`}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.resultRow}
            onPress={() => {
              if (item.kind === "movie") router.push({ pathname: "/movie/[id]", params: { id: item.id } });
              else if (item.kind === "series") router.push({ pathname: "/series/[id]", params: { id: item.id } });
              else if (item.url) router.push({ pathname: "/player", params: { url: item.url, title: item.name, kind: "live", itemId: item.id, logo: item.logo || "" } });
            }}
            testID={`search-result-${item.id}`}
          >
            <Image cachePolicy="memory-disk" source={{ uri: item.logo || undefined }} style={styles.resultImg} contentFit="cover" />
            <View style={{ flex: 1 }}>
              <Text style={styles.resultName} numberOfLines={2}>{item.name}</Text>
              <Text style={[styles.resultKind, { color: accentColor }]}>{item.kind.toUpperCase()}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={{ alignItems: "center", marginTop: spacing.xxxl }}>
            <Ionicons name="search" size={48} color={colors.textMuted} />
            <Text style={{ color: colors.textMuted, marginTop: spacing.md, fontSize: font.base }}>
              {query ? "Sonuç bulunamadı" : "Aramak için yazın"}
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { backgroundColor: colors.surface, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider },
  searchRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingTop: spacing.sm },
  searchBox: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 10 },
  input: { flex: 1, color: colors.onSurface, fontSize: font.lg, padding: 0 },
  tabs: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  tabBtn: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  tabActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  tabText: { color: colors.onSurfaceSecondary, fontSize: font.sm, fontWeight: "600" },
  tabTextActive: { color: "#fff" },
  resultRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  resultImg: { width: 60, height: 60, borderRadius: radius.sm, backgroundColor: colors.surfaceTertiary },
  resultName: { color: colors.onSurface, fontSize: font.base, fontWeight: "600" },
  resultKind: { color: colors.brandPrimary, fontSize: 11, fontWeight: "700", letterSpacing: 1, marginTop: 4 },
});
