import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

// Native: Keychain/Keystore via expo-secure-store.
// Electron desktop: OS-encrypted files (DPAPI) through the main process.
// Plain browser: localStorage - there's nothing better available there.

type ElectronSecure = {
  cacheRead: (key: string) => Promise<string | null>;
  cacheWrite: (key: string, data: string) => Promise<boolean>;
  cacheDelete: (key: string) => Promise<boolean>;
};

const electron: ElectronSecure | null =
  Platform.OS === "web" && typeof window !== "undefined" && (window as any).electronAPI?.cacheRead
    ? (window as any).electronAPI
    : null;

// Separate namespace from the playlist/EPG cache files.
const fileKey = (key: string) => `secure__${key}`;

/**
 * True when secure storage is the very same localStorage slot AsyncStorage uses
 * (plain browser). Callers migrating data out of AsyncStorage must not then
 * "clean up" the AsyncStorage copy, or they delete what they just saved.
 */
export const SECURE_SHARES_ASYNC_STORAGE = Platform.OS === "web" && !electron;

export const setSecure = async (key: string, value: string) => {
  if (electron) {
    await electron.cacheWrite(fileKey(key), value);
    try { localStorage.removeItem(key); } catch {}
    return;
  }
  if (Platform.OS === "web") {
    localStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
};

export const getSecure = async (key: string) => {
  if (electron) {
    const value = await electron.cacheRead(fileKey(key));
    if (value != null) return value;
    // One-time migration: desktop builds used to keep these in plain localStorage.
    let legacy: string | null = null;
    try { legacy = localStorage.getItem(key); } catch {}
    if (legacy != null) {
      await electron.cacheWrite(fileKey(key), legacy);
      try { localStorage.removeItem(key); } catch {}
    }
    return legacy;
  }
  if (Platform.OS === "web") {
    return localStorage.getItem(key);
  }
  return await SecureStore.getItemAsync(key);
};

export const deleteSecure = async (key: string) => {
  if (electron) {
    await electron.cacheDelete(fileKey(key));
    try { localStorage.removeItem(key); } catch {}
    return;
  }
  if (Platform.OS === "web") {
    localStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
};
