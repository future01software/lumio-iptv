import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Platform } from "react-native";
import { useFocusEffect } from "expo-router";
import { detectNativeTV, isNativeTVSync } from "@/src/utils/form-factor";

// NuvioTV HomeScreenFocusState / FocusRestoreUtils: when you come back to a
// screen (e.g. Back from a movie's details) the remote's focus should land on
// the card you left from, not jump to the first focusable (the nav rail).
//
// Screens wrap their content in <FocusMemoryScope screenKey="...">; cards call
// useRememberedFocus(key) and pass the result to their Pressable. On return the
// remembered card gets hasTVPreferredFocus, which makes Android request focus.
// TV only: on Android that prop also makes the view focusable-in-touch-mode,
// which on a phone would turn the first tap into "focus" instead of "press".

const lastFocusedByScreen = new Map<string, string>();

type Ctx = { restoreKey: string | null; remember: (key: string) => void };
const FocusMemoryContext = createContext<Ctx | null>(null);

function useIsTV() {
  const [tv, setTv] = useState(() => Platform.OS !== "web" && isNativeTVSync());
  useEffect(() => {
    if (Platform.OS === "web") return;
    let active = true;
    detectNativeTV().then((v) => active && setTv(v));
    return () => {
      active = false;
    };
  }, []);
  return tv;
}

export function FocusMemoryScope({ screenKey, children }: { screenKey: string; children: React.ReactNode }) {
  const isTV = useIsTV();
  const [restoreKey, setRestoreKey] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!isTV) return;
      // Screen (re)gained focus: point focus back at the last card, then drop the flag
      // once focus has landed. Left on, Android re-applied hasTVPreferredFocus whenever
      // that card re-rendered and yanked focus back from the nav rail - after returning
      // from a details page the remote could no longer leave the card. Clearing it also
      // lets the false→true prop change fire again on the next return.
      setRestoreKey(lastFocusedByScreen.get(screenKey) ?? null);
      const release = setTimeout(() => setRestoreKey(null), 400);
      return () => {
        clearTimeout(release);
        setRestoreKey(null);
      };
    }, [isTV, screenKey]),
  );

  const remember = useCallback((key: string) => {
    lastFocusedByScreen.set(screenKey, key);
  }, [screenKey]);

  const value = useMemo(() => ({ restoreKey, remember }), [restoreKey, remember]);
  return <FocusMemoryContext.Provider value={value}>{children}</FocusMemoryContext.Provider>;
}

/** Props to spread onto a focusable card: remembers focus, restores it on return. */
export function useRememberedFocus(key: string) {
  const ctx = useContext(FocusMemoryContext);
  const remember = ctx?.remember;
  const onFocusRemember = useCallback(() => remember?.(key), [remember, key]);
  return { hasTVPreferredFocus: !!ctx && ctx.restoreKey === key, onFocusRemember };
}
