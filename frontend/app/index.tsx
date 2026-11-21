import { useEffect, useRef } from "react";
import { View, ActivityIndicator, StyleSheet, Text } from "react-native";
import { useNavigationContainerRef, useRouter } from "expo-router";
import { useIPTV, waitForBackend } from "@/src/store/iptv-store";
import { colors } from "@/src/theme/tokens";
import { useTheme } from "@/src/store/theme-store";
import AsyncStorage from "@react-native-async-storage/async-storage";

export default function Index() {
  const { accentColor } = useTheme();
  const router = useRouter();
  const navigationRef = useNavigationContainerRef();
  const config = useIPTV((s) => s.config);
  const playlist = useIPTV((s) => s.playlist);
  const deviceId = useIPTV((s) => s.deviceId);
  const loadPlaylist = useIPTV((s) => s.loadPlaylist);
  const reloading = useRef(false);

  useEffect(() => {
    if (!deviceId) return;
    // A saved source but no cached list (plain browser, cleared cache, or a new
    // per-install backend key): reload it from the source instead of sending
    // the user back through login.
    if (config && !playlist) {
      if (reloading.current) return;
      reloading.current = true;
      waitForBackend()
        .then(() => loadPlaylist(config))
        .then((ok) => (ok ? openStartScreen() : replaceWhenReady("/login")));
      return;
    }
    if (config && playlist) {
      openStartScreen();
      return;
    }
    return replaceWhenReady("/login");
  }, [config, playlist, deviceId, router, loadPlaylist]);

  // Android: leaving with BACK destroys the activity but keeps the process and the
  // store. On the next launch config/playlist are already there on the first render,
  // so replace() ran before the new root navigator was ready and threw — the app
  // crashed and only opened on the second press. Retry until the navigator is ready.
  // Settings > Live TV > Opening screen. Read straight from storage: the settings store
  // may still be loading on this first render.
  async function openStartScreen() {
    let start = "home";
    try { start = JSON.parse((await AsyncStorage.getItem("iptv.settings")) || "{}").startScreen || "home"; } catch {}
    if (start === "live") return replaceWhenReady("/(tabs)/live");
    replaceWhenReady("/(tabs)");
    if (start === "last") {
      const st = useIPTV.getState();
      const id = st.recentChannels[0];
      const ch = id ? st.playlist?.channels.find((c) => c.id === id) : undefined;
      if (ch) {
        const open = () => {
          if (navigationRef.isReady()) router.push({ pathname: "/player", params: { url: ch.url, title: ch.name, kind: "live", itemId: ch.id, logo: ch.logo || "" } });
          else setTimeout(open, 50);
        };
        setTimeout(open, 300);
      }
    }
  }

  function replaceWhenReady(href: "/(tabs)" | "/(tabs)/live" | "/login") {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const attempt = () => {
      if (navigationRef.isReady()) router.replace(href);
      else timer = setTimeout(attempt, 16);
    };
    attempt();
    return () => { if (timer) clearTimeout(timer); };
  }

  return (
    <View style={styles.container}>
      <ActivityIndicator color={accentColor} size="large" />
      {config && !playlist && <Text style={styles.text}>Liste yükleniyor…</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", gap: 16 },
  text: { color: colors.textMuted, fontSize: 14 },
});
