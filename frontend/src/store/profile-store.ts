import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getSecure, setSecure, deleteSecure } from "@/src/utils/secure-storage";
import * as Crypto from "expo-crypto";

export type Profile = {
  id: string;
  name: string;
  avatar: string; // initial letter, emoji, or an http(s) image URL
  color: string;  // hex accent for the avatar ring / selection backdrop
  isKids: boolean;
  hasPin: boolean;     // true → PIN required to enter this profile
  pinLength?: number;  // lets the PIN pad auto-submit; absent for legacy 4–6 digit PINs
  blockedKeywords: string[];   // e.g. ["news", "+18", "adult", "xxx"]
  createdAt: string;
};

const STORAGE_KEY = "iptv.profiles.v1";
const ACTIVE_KEY = "iptv.activeProfile.v1";
const PIN_PREFIX = "iptv.pin.";

const PIN_LOCK_PREFIX = "iptv.pinLock.";

// Nuvio's profile limit and avatar palette (ProfileModels.kt).
export const MAX_PROFILES = 6;
export const PROFILE_COLORS = [
  "#1E88E5", "#E53935", "#43A047", "#FB8C00",
  "#8E24AA", "#00ACC1", "#F4511E", "#3949AB",
  "#C0CA33", "#D81B60", "#00897B", "#5E35B1",
  "#7CB342", "#039BE5", "#FFB300", "#6D4C41",
];

// After this many wrong PINs the profile locks for PIN_LOCK_SECONDS.
const PIN_MAX_ATTEMPTS = 5;
const PIN_LOCK_SECONDS = 30;

export type PinAttemptResult = { ok: boolean; retryAfterSec: number; attemptsLeft: number };

const KID_DEFAULT_BLOCKED = ["adult", "+18", "18+", "xxx", "porn", "erotic", "news"];

async function hashPin(pin: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, pin + ":iptv-salt-v1");
}

type State = {
  profiles: Profile[];
  activeProfileId: string | null;
  initialized: boolean;

  init: () => Promise<void>;
  addProfile: (input: { name: string; avatar: string; color?: string; isKids: boolean; pin?: string }) => Promise<Profile>;
  updateProfile: (id: string, patch: Partial<Pick<Profile, "name" | "avatar" | "color" | "isKids" | "blockedKeywords">>) => Promise<void>;
  removeProfile: (id: string) => Promise<void>;
  setActive: (id: string) => Promise<void>;
  setPin: (id: string, pin: string) => Promise<void>;
  clearPin: (id: string) => Promise<void>;
  verifyPin: (id: string, pin: string) => Promise<boolean>;
  /** verifyPin plus brute-force lockout; use this for anything user-facing. */
  tryPin: (id: string, pin: string) => Promise<PinAttemptResult>;
  active: () => Profile | null;
};

async function persistProfiles(items: Profile[]) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export const useProfiles = create<State>((set, get) => ({
  profiles: [],
  activeProfileId: null,
  initialized: false,

  init: async () => {
    if (get().initialized) return;
    const [pRaw, aRaw] = await Promise.all([
      AsyncStorage.getItem(STORAGE_KEY),
      AsyncStorage.getItem(ACTIVE_KEY),
    ]);
    let profiles: Profile[] = pRaw ? JSON.parse(pRaw) : [];
    // Profiles saved before colors existed get one from the palette by position.
    if (profiles.some((p) => !p.color)) {
      profiles = profiles.map((p, i) => (p.color ? p : { ...p, color: PROFILE_COLORS[i % PROFILE_COLORS.length] }));
      await persistProfiles(profiles);
    }
    if (profiles.length === 0) {
      const def: Profile = {
        id: "main",
        name: "Main",
        avatar: "M",
        color: PROFILE_COLORS[0],
        isKids: false,
        hasPin: false,
        blockedKeywords: [],
        createdAt: new Date().toISOString(),
      };
      profiles = [def];
      await persistProfiles(profiles);
    }
    const activeProfileId = aRaw && profiles.find((p) => p.id === aRaw) ? aRaw : profiles[0].id;
    if (!aRaw) await AsyncStorage.setItem(ACTIVE_KEY, activeProfileId);
    set({ profiles, activeProfileId, initialized: true });
  },

  addProfile: async ({ name, avatar, color, isKids, pin }) => {
    if (get().profiles.length >= MAX_PROFILES) throw new Error("Profil sınırına ulaşıldı");
    const id = `prof_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const used = new Set(get().profiles.map((p) => p.color));
    const profile: Profile = {
      id, name, avatar, isKids, hasPin: !!pin,
      pinLength: pin ? pin.length : undefined,
      color: color || PROFILE_COLORS.find((c) => !used.has(c)) || PROFILE_COLORS[0],
      blockedKeywords: isKids ? [...KID_DEFAULT_BLOCKED] : [],
      createdAt: new Date().toISOString(),
    };
    const profiles = [...get().profiles, profile];
    await persistProfiles(profiles);
    if (pin) await setSecure(PIN_PREFIX + id, await hashPin(pin));
    set({ profiles });
    return profile;
  },

  updateProfile: async (id, patch) => {
    const profiles = get().profiles.map((p) => (p.id === id ? { ...p, ...patch } : p));
    await persistProfiles(profiles);
    set({ profiles });
  },

  removeProfile: async (id) => {
    if (get().profiles.length <= 1) return; // keep at least one
    const profiles = get().profiles.filter((p) => p.id !== id);
    await persistProfiles(profiles);
    try { await deleteSecure(PIN_PREFIX + id); } catch {}
    try { await AsyncStorage.removeItem(PIN_LOCK_PREFIX + id); } catch {}
    let activeProfileId = get().activeProfileId;
    if (activeProfileId === id) {
      activeProfileId = profiles[0].id;
      await AsyncStorage.setItem(ACTIVE_KEY, activeProfileId);
    }
    set({ profiles, activeProfileId });
  },

  setActive: async (id) => {
    if (!get().profiles.find((p) => p.id === id)) return;
    await AsyncStorage.setItem(ACTIVE_KEY, id);
    set({ activeProfileId: id });
  },

  setPin: async (id, pin) => {
    await setSecure(PIN_PREFIX + id, await hashPin(pin));
    const profiles = get().profiles.map((p) => (p.id === id ? { ...p, hasPin: true, pinLength: pin.length } : p));
    await persistProfiles(profiles);
    set({ profiles });
  },

  clearPin: async (id) => {
    try { await deleteSecure(PIN_PREFIX + id); } catch {}
    try { await AsyncStorage.removeItem(PIN_LOCK_PREFIX + id); } catch {}
    const profiles = get().profiles.map((p) => (p.id === id ? { ...p, hasPin: false, pinLength: undefined } : p));
    await persistProfiles(profiles);
    set({ profiles });
  },

  verifyPin: async (id, pin) => {
    const stored = await getSecure(PIN_PREFIX + id);
    if (!stored) return false;
    const hash = await hashPin(pin);
    return stored === hash;
  },

  tryPin: async (id, pin) => {
    const key = PIN_LOCK_PREFIX + id;
    let lock = { fails: 0, until: 0 };
    try {
      const raw = await AsyncStorage.getItem(key);
      if (raw) lock = JSON.parse(raw);
    } catch {}
    const now = Date.now();
    if (lock.until > now) {
      return { ok: false, retryAfterSec: Math.ceil((lock.until - now) / 1000), attemptsLeft: 0 };
    }
    if (await get().verifyPin(id, pin)) {
      try { await AsyncStorage.removeItem(key); } catch {}
      return { ok: true, retryAfterSec: 0, attemptsLeft: PIN_MAX_ATTEMPTS };
    }
    // A lock that has expired starts a fresh round of attempts.
    const fails = (lock.until && lock.until <= now ? 0 : lock.fails) + 1;
    const locked = fails >= PIN_MAX_ATTEMPTS;
    const next = { fails: locked ? 0 : fails, until: locked ? now + PIN_LOCK_SECONDS * 1000 : 0 };
    try { await AsyncStorage.setItem(key, JSON.stringify(next)); } catch {}
    return {
      ok: false,
      retryAfterSec: locked ? PIN_LOCK_SECONDS : 0,
      attemptsLeft: locked ? 0 : PIN_MAX_ATTEMPTS - fails,
    };
  },

  active: () => {
    const id = get().activeProfileId;
    return id ? get().profiles.find((p) => p.id === id) || null : null;
  },
}));

export { KID_DEFAULT_BLOCKED };
