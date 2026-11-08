import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import * as DocumentPicker from "expo-document-picker";
import * as ExpoCrypto from "expo-crypto";
import CryptoJS from "crypto-js";

import { getSecure, setSecure } from "@/src/utils/secure-storage";
import { currentVersion } from "@/src/services/updater";
import { useIPTV } from "@/src/store/iptv-store";
import { useProfiles } from "@/src/store/profile-store";
import { useI18n } from "@/src/store/i18n-store";
import { useTheme } from "@/src/store/theme-store";
import { usePlayerSettings } from "@/src/store/player-settings-store";
import { useAccount } from "@/src/store/account-store";
import { useReminders } from "@/src/store/reminders-store";

// A backup is one JSON file with every user setting the app keeps in
// AsyncStorage, plus the few secure values needed to make it usable on another
// device: the active playlist source and the profiles' PIN hashes. Caches,
// download records (the files stay on the old device), lockout counters and
// the device id are left out.

const FORMAT = "lumio-backup";
const FORMAT_VERSION = 1;

const CONFIG_KEY = "iptv.activeConfig.v1";
const PROFILES_KEY = "iptv.profiles.v1";
const PIN_PREFIX = "iptv.pin.";

const EXCLUDED_KEYS = new Set([
  "iptv.cachedPlaylist.v1",
  "iptv.playlistCachedAt.v1",
  "iptv.deviceId.v1",
  "iptv.downloads.v1",
  CONFIG_KEY, // secure; exported separately
]);
const EXCLUDED_PREFIXES = ["iptv.pinLock.", "iptv.accountLock.", "iptv.appLock.", PIN_PREFIX, "secure__"];

function isBackedUp(key: string) {
  if (!key.startsWith("iptv.")) return false;
  if (EXCLUDED_KEYS.has(key)) return false;
  return !EXCLUDED_PREFIXES.some((p) => key.startsWith(p));
}

export type BackupFile = {
  format: typeof FORMAT;
  version: number;
  appVersion: string;
  createdAt: string;
  platform: string;
  data: Record<string, string>;
  secure: Record<string, string>;
};

type ElectronBackup = {
  backupSave: (data: string, defaultName: string) => Promise<string | null>;
  backupOpen: () => Promise<string | null>;
};
const electron: ElectronBackup | null =
  Platform.OS === "web" && typeof window !== "undefined" && (window as any).electronAPI?.backupSave
    ? (window as any).electronAPI
    : null;

export async function createBackup(): Promise<BackupFile> {
  const keys = (await AsyncStorage.getAllKeys()).filter(isBackedUp);
  const pairs = await AsyncStorage.multiGet(keys);
  const data: Record<string, string> = {};
  for (const [k, v] of pairs) if (v != null) data[k] = v;

  const secure: Record<string, string> = {};
  const config = await getSecure(CONFIG_KEY).catch(() => null);
  if (config) secure[CONFIG_KEY] = config;
  try {
    const profiles: { id: string; hasPin?: boolean }[] = JSON.parse(data[PROFILES_KEY] || "[]");
    for (const p of profiles) {
      if (!p.hasPin) continue;
      const pin = await getSecure(PIN_PREFIX + p.id).catch(() => null);
      if (pin) secure[PIN_PREFIX + p.id] = pin;
    }
  } catch {}

  return {
    format: FORMAT,
    version: FORMAT_VERSION,
    appVersion: currentVersion(),
    createdAt: new Date().toISOString(),
    platform: Platform.OS,
    data,
    secure,
  };
}

// ---- Optional password protection ------------------------------------------------
// A backup holds the IPTV login, so it can be sealed with a password: PBKDF2-SHA256
// derives 64 bytes (AES-256-CBC key + HMAC-SHA256 key), the payload is encrypted with a
// random IV and authenticated encrypt-then-MAC, so a wrong password or an edited file is
// detected instead of producing garbage. Iterations are kept moderate because crypto-js
// is pure JS and this also runs on slow TV boxes.
const KDF_ITERATIONS = 30000;

export type EncryptedBackupFile = {
  format: typeof FORMAT;
  version: number;
  appVersion: string;
  createdAt: string;
  encrypted: { kdf: "pbkdf2-sha256"; iter: number; salt: string; iv: string; ct: string; mac: string };
};

async function randomWords(bytes: number) {
  const b = await ExpoCrypto.getRandomBytesAsync(bytes);
  return CryptoJS.enc.Hex.parse(Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(""));
}

function deriveKeys(password: string, salt: CryptoJS.lib.WordArray, iter: number) {
  const key = CryptoJS.PBKDF2(password, salt, { keySize: 16, iterations: iter, hasher: CryptoJS.algo.SHA256 });
  const hex = key.toString(CryptoJS.enc.Hex);
  return { enc: CryptoJS.enc.Hex.parse(hex.slice(0, 64)), mac: CryptoJS.enc.Hex.parse(hex.slice(64, 128)) };
}

function macOf(macKey: CryptoJS.lib.WordArray, iv: string, ct: string) {
  return CryptoJS.HmacSHA256(`${iv}.${ct}`, macKey).toString(CryptoJS.enc.Hex);
}

export async function encryptBackup(backup: BackupFile, password: string): Promise<EncryptedBackupFile> {
  const salt = await randomWords(16);
  const iv = await randomWords(16);
  const keys = deriveKeys(password, salt, KDF_ITERATIONS);
  const ct = CryptoJS.AES.encrypt(JSON.stringify({ data: backup.data, secure: backup.secure, platform: backup.platform }), keys.enc, {
    iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  }).ciphertext.toString(CryptoJS.enc.Base64);
  const ivHex = iv.toString(CryptoJS.enc.Hex);
  return {
    format: FORMAT,
    version: FORMAT_VERSION,
    appVersion: backup.appVersion,
    createdAt: backup.createdAt,
    encrypted: { kdf: "pbkdf2-sha256", iter: KDF_ITERATIONS, salt: salt.toString(CryptoJS.enc.Hex), iv: ivHex, ct, mac: macOf(keys.mac, ivHex, ct) },
  };
}

export function decryptBackup(file: EncryptedBackupFile, password: string): BackupFile {
  const e = file.encrypted;
  const keys = deriveKeys(password, CryptoJS.enc.Hex.parse(e.salt), e.iter);
  if (macOf(keys.mac, e.iv, e.ct) !== e.mac) throw new Error("Parola yanlış ya da dosya bozulmuş.");
  const plain = CryptoJS.AES.decrypt(
    CryptoJS.lib.CipherParams.create({ ciphertext: CryptoJS.enc.Base64.parse(e.ct) }),
    keys.enc,
    { iv: CryptoJS.enc.Hex.parse(e.iv), mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 },
  ).toString(CryptoJS.enc.Utf8);
  const inner = JSON.parse(plain);
  return {
    format: FORMAT,
    version: file.version,
    appVersion: file.appVersion,
    createdAt: file.createdAt,
    platform: inner.platform,
    data: inner.data,
    secure: inner.secure || {},
  };
}

export type ParsedBackup = { kind: "plain"; backup: BackupFile } | { kind: "encrypted"; file: EncryptedBackupFile };

export function parseBackup(text: string): ParsedBackup {
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Dosya okunamadı: geçerli bir JSON değil.");
  }
  if (!parsed || parsed.format !== FORMAT || (typeof parsed.data !== "object" && typeof parsed.encrypted !== "object")) {
    throw new Error("Bu bir Lumio yedek dosyası değil.");
  }
  if (parsed.version > FORMAT_VERSION) {
    throw new Error("Bu yedek daha yeni bir sürümle alınmış. Önce uygulamayı güncelle.");
  }
  return parsed.encrypted ? { kind: "encrypted", file: parsed as EncryptedBackupFile } : { kind: "plain", backup: parsed as BackupFile };
}

/**
 * Writes the backup over the current settings and reloads the app state from
 * it. Keys absent from the backup are left alone (nothing is wiped). If the
 * playlist source differs, the cached playlist is dropped first so the app
 * fetches the restored source instead of showing the old list.
 */
export async function restoreBackup(backup: BackupFile): Promise<void> {
  const newConfig = backup.secure?.[CONFIG_KEY];
  if (typeof newConfig === "string") {
    const current = await getSecure(CONFIG_KEY).catch(() => null);
    if (current !== newConfig) await useIPTV.getState().clearPlaylist();
  }

  const entries = Object.entries(backup.data).filter(([k, v]) => isBackedUp(k) && typeof v === "string");
  if (entries.length) await AsyncStorage.multiSet(entries);
  for (const [k, v] of Object.entries(backup.secure || {})) {
    if (typeof v !== "string") continue;
    if (k === CONFIG_KEY || k.startsWith(PIN_PREFIX)) await setSecure(k, v);
  }

  if (Platform.OS === "web") {
    window.location.reload();
    return;
  }
  // Native has no JS reload in release builds: re-run every store's init.
  useProfiles.setState({ initialized: false });
  useI18n.setState({ initialized: false });
  await Promise.all([
    useProfiles.getState().init(),
    useI18n.getState().init(),
    useTheme.getState().init(),
    usePlayerSettings.getState().init(),
    useAccount.getState().init(),
    useReminders.getState().init(),
  ]);
  await useIPTV.getState().init();
  await useIPTV.getState().setProfile(useProfiles.getState().activeProfileId);
}

function backupFileName() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `lumio-yedek-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
}

/**
 * Saves the backup where the user picks. Returns a short description of where
 * it went, or null if the user cancelled.
 */
export async function saveBackupFile(backup: BackupFile | EncryptedBackupFile): Promise<string | null> {
  const text = JSON.stringify(backup, null, 2);
  const name = backupFileName();

  if (electron) return electron.backupSave(text, name);

  if (Platform.OS === "web") {
    const blob = new Blob([text], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    return `İndirilenler/${name}`;
  }

  // Android: the system folder picker (Storage Access Framework).
  const SAF = FileSystem.StorageAccessFramework;
  const perm = await SAF.requestDirectoryPermissionsAsync();
  if (!perm.granted) return null;
  const uri = await SAF.createFileAsync(perm.directoryUri, name.replace(/\.json$/, ""), "application/json");
  await FileSystem.writeAsStringAsync(uri, text);
  return decodeURIComponent(uri.split("%3A").pop() || name);
}

/** Lets the user pick a backup file and returns its text, or null if cancelled. */
export async function pickBackupFile(): Promise<string | null> {
  if (electron) return electron.backupOpen();
  const res = await DocumentPicker.getDocumentAsync({
    type: Platform.OS === "web" ? ".json,application/json" : "*/*",
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (res.canceled || !res.assets?.length) return null;
  const asset = res.assets[0];
  if (Platform.OS === "web") {
    if (asset.file) return asset.file.text();
    return (await fetch(asset.uri)).text();
  }
  return FileSystem.readAsStringAsync(asset.uri);
}
