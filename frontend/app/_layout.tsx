import { Stack, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useCallback, useEffect, useState } from "react";
import { LogBox, StatusBar, Platform, Dimensions, View } from "react-native";
import { Image } from "expo-image";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as Device from 'expo-device';
import * as ScreenOrientation from "expo-screen-orientation";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { useIPTV } from "@/src/store/iptv-store";
import { useDownloads } from "@/src/store/downloads-store";
import { useProfiles } from "@/src/store/profile-store";
import { useAccount } from "@/src/store/account-store";
import { useAppLock } from "@/src/store/app-lock-store";
import { useI18n } from "@/src/store/i18n-store";
import { useTheme } from "@/src/store/theme-store";
import { usePlayerSettings } from "@/src/store/player-settings-store";
import { AppLockScreen } from "@/src/components/AppLockScreen";
import { AnimatedIntro } from "@/src/components/AnimatedIntro";
import { TitleBar } from "@/src/components/TitleBar";
import { UpdatePrompt } from "@/src/components/UpdatePrompt";
import { ReminderBanner } from "@/src/components/ReminderBanner";
import { useReminders } from "@/src/store/reminders-store";
import { useUpdates } from "@/src/store/update-store";
import { screenBackground } from "@/src/theme/tokens";

LogBox.ignoreAllLogs(true);
SplashScreen.preventAutoHideAsync();


const INTRO_SHOWN_KEY = "lumio.introShown";
export default function RootLayout() {
  const [loaded, error] = useIconFonts();
  const init = useIPTV((s) => s.init);
  const setIptvProfile = useIPTV((s) => s.setProfile);
  const initDownloads = useDownloads((s) => s.init);
  const initProfiles = useProfiles((s) => s.init);
  const initAccount = useAccount((s) => s.init);
  const activeProfileId = useProfiles((s) => s.activeProfileId);
  const initLock = useAppLock((s) => s.init);
  const locked = useAppLock((s) => s.locked);
  const initI18n = useI18n((s) => s.init);
  const initTheme = useTheme((s) => s.init);
  const initPlayerSettings = usePlayerSettings((s) => s.init);
  const initReminders = useReminders((s) => s.init);

  const [appReady, setAppReady] = useState(false);
  // The root index route is only a redirect (spinner). Keep the intro up until a real
  // screen (tabs, login, profiles...) is mounted, instead of revealing the spinner and
  // then Home popping in behind it.
  const segments = useSegments();
  const firstScreenMounted = (segments as string[]).length > 0;
  // The intro plays once per app launch: sessionStorage survives in-window
  // reloads (so a reload doesn't replay it) but is cleared when the app closes.
  const [introFinished, setIntroFinished] = useState(() => {
    try {
      return Platform.OS === "web" && sessionStorage.getItem(INTRO_SHOWN_KEY) === "1";
    } catch {
      return false;
    }
  });
  const finishIntro = useCallback(() => {
    setIntroFinished(true);
    try {
      if (Platform.OS === "web") sessionStorage.setItem(INTRO_SHOWN_KEY, "1");
    } catch {}
  }, []);

  useEffect(() => {
    async function load() {
      try {
        await Promise.all([
          init(),
          initDownloads(),
          initProfiles(),
          initAccount(),
          initLock(),
          initI18n(),
          initTheme(),
          initPlayerSettings(),
          initReminders(),
          (async () => {
            if (Platform.OS !== "web") {
              const isTV = (Platform as any).isTV === true;
              const deviceType = await Device.getDeviceTypeAsync();
              const { width, height } = Dimensions.get("screen");

              const model = (Device.modelName || "").toLowerCase();
              const isCheapBox = model.includes("box") || model.includes("tv") || model.includes("stick");

              if (isTV || deviceType === Device.DeviceType.TV || deviceType === Device.DeviceType.DESKTOP || width > height || isCheapBox) {
                await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
              } else {
                await ScreenOrientation.unlockAsync();
              }
            }
          })(),
        ]);
      } catch (e) {
        console.warn("Startup init failed:", e);
      } finally {
        setAppReady(true);
      }
    }
    load();
  }, [init, initDownloads, initProfiles, initLock, initI18n, initTheme]);
  // Look for a new release shortly after launch (silent if offline).
  useEffect(() => {
    if (!appReady) return;
    const timer = setTimeout(() => useUpdates.getState().check(), 5000);
    return () => clearTimeout(timer);
  }, [appReady]);

  // Sync IPTV store's active profile id whenever it changes (re-loads favs/history scoped to profile).
  useEffect(() => {
    if (activeProfileId) setIptvProfile(activeProfileId);
  }, [activeProfileId, setIptvProfile]);

  useEffect(() => {
    // Hide native splash screen immediately so our custom intro can play
    SplashScreen.hideAsync();
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    // Dark-theme scrollbars everywhere (category lists, poster rows, etc.)
    // instead of the OS-default light/white ones. `app/+html.tsx` doesn't run
    // in this project's web.output:"single" mode, so this has to be injected here.
    const style = document.createElement("style");
    style.id = "themed-scrollbars";
    style.textContent = `
      * { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.18) transparent; }
      ::-webkit-scrollbar { width: 8px; height: 8px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.18); border-radius: 8px; }
      ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.32); }
      ::-webkit-scrollbar-corner { background: transparent; }
      /* Chromium draws its own (orange/yellow on Windows) focus ring around text
         inputs; our fields already show a themed focus border, so drop it. */
      input:focus, textarea:focus { outline: none; }
      /* Keep autofilled fields (saved e-mail etc.) on our dark background instead
         of Chrome's tinted autofill fill. */
      input:-webkit-autofill, input:-webkit-autofill:hover, input:-webkit-autofill:focus {
        -webkit-text-fill-color: #fff;
        caret-color: #fff;
        transition: background-color 99999s ease-in-out 0s;
      }
    `;
    document.head.appendChild(style);
    return () => { style.remove(); };
  }, []);

  // Safety net for the custom frameless Electron window: our own title bar
  // (which has the only close/restore buttons) hides itself while fullscreen,
  // and the in-player fullscreen toggle only exists on the Player screen. Without
  // this, leaving fullscreen while on any other screen had no way back to windowed.
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const electronAPI = (window as any).electronAPI;
    if (!electronAPI) return;

    let isFullscreen = false;
    electronAPI.onFullscreenChange((fullscreen: boolean) => { isFullscreen = fullscreen; });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isFullscreen) {
        electronAPI.toggleFullscreen();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: screenBackground }}>
      <SafeAreaProvider>
        <TitleBar />
        <StatusBar barStyle="light-content" backgroundColor="#000" />
        
        {/* The navigator must be mounted from the first render: expo-router re-keys the
            root route when the root layout's navigator first appears, so gating it on
            appReady unmounted and remounted this whole layout ~1s into launch (the intro
            played twice and every store init ran twice). The intro covers it until ready,
            and the index route waits for the stores before redirecting. */}
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: "#000" },
            animation: "fade",
          }}
            >
          <Stack.Screen name="index" />
          <Stack.Screen name="login" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="player"
            options={{ presentation: "fullScreenModal", animation: "fade" }}
          />
        </Stack>
        {appReady && !locked && introFinished && <ReminderBanner />}
        {appReady && !locked && introFinished && <UpdatePrompt />}
        {appReady && locked && <AppLockScreen />}

        {/* Cinematic Animated Intro layered on top - renders immediately */}
        {!introFinished && (
          <AnimatedIntro isAppReady={appReady && firstScreenMounted} onFinish={finishIntro} />
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
