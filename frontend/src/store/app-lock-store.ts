import { create } from "zustand";
import * as Crypto from "expo-crypto";
import * as LocalAuth from "expo-local-authentication";
import { getSecure, setSecure, deleteSecure } from "@/src/utils/secure-storage";

const APP_LOCK_PIN_KEY = "iptv.appLock.pin.v1";
const APP_LOCK_ENABLED_KEY = "iptv.appLock.enabled.v1";
const APP_LOCK_BIOMETRIC_KEY = "iptv.appLock.biometric.v1";

async function hash(pin: string) {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, pin + ":app-lock-v1");
}

type State = {
  enabled: boolean;
  biometricEnabled: boolean;
  hasPin: boolean;
  locked: boolean;
  initialized: boolean;
  init: () => Promise<void>;
  setEnabled: (v: boolean) => Promise<void>;
  setBiometricEnabled: (v: boolean) => Promise<void>;
  setPin: (pin: string) => Promise<void>;
  clearPin: () => Promise<void>;
  verifyPin: (pin: string) => Promise<boolean>;
  lock: () => void;
  unlock: () => void;
  tryBiometric: () => Promise<boolean>;
};

export const useAppLock = create<State>((set, get) => ({
  enabled: false,
  biometricEnabled: false,
  hasPin: false,
  locked: false,
  initialized: false,

  init: async () => {
    if (get().initialized) return;
    const [enabled, bio, pin] = await Promise.all([
      getSecure(APP_LOCK_ENABLED_KEY),
      getSecure(APP_LOCK_BIOMETRIC_KEY),
      getSecure(APP_LOCK_PIN_KEY),
    ]);
    const isEnabled = enabled === "1";
    set({
      enabled: isEnabled,
      biometricEnabled: bio === "1",
      hasPin: !!pin,
      locked: isEnabled && !!pin,
      initialized: true,
    });
  },

  setEnabled: async (v) => {
    await setSecure(APP_LOCK_ENABLED_KEY, v ? "1" : "0");
    set({ enabled: v, locked: v && get().hasPin ? get().locked : false });
  },

  setBiometricEnabled: async (v) => {
    await setSecure(APP_LOCK_BIOMETRIC_KEY, v ? "1" : "0");
    set({ biometricEnabled: v });
  },

  setPin: async (pin) => {
    await setSecure(APP_LOCK_PIN_KEY, await hash(pin));
    set({ hasPin: true });
  },

  clearPin: async () => {
    try { await deleteSecure(APP_LOCK_PIN_KEY); } catch {}
    set({ hasPin: false });
  },

  verifyPin: async (pin) => {
    const stored = await getSecure(APP_LOCK_PIN_KEY);
    if (!stored) return false;
    return stored === (await hash(pin));
  },

  lock: () => set({ locked: get().enabled && get().hasPin }),
  unlock: () => set({ locked: false }),

  tryBiometric: async () => {
    try {
      const hasHw = await LocalAuth.hasHardwareAsync();
      const enrolled = await LocalAuth.isEnrolledAsync();
      if (!hasHw || !enrolled) return false;
      const res = await LocalAuth.authenticateAsync({
        promptMessage: "Lumio kilidini aç",
        fallbackLabel: "Use PIN",
        disableDeviceFallback: false,
      });
      if (res.success) {
        get().unlock();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },
}));
