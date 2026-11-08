import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as FileSystem from "expo-file-system/legacy";

// Releases are published to a public, binaries-only repo (the source repo is
// private, so installed apps couldn't read its releases). Every release carries
// a latest.json manifest; GitHub's "latest/download" redirect always serves the
// newest one without hitting the rate-limited REST API.
export const RELEASES_REPO = "future01software/lumio-releases";
const MANIFEST_URL = `https://github.com/${RELEASES_REPO}/releases/latest/download/latest.json`;

export type UpdateAsset = { url: string; sha256?: string; md5?: string; size?: number };
export type UpdateManifest = {
  version: string;
  date?: string;
  notes?: string;
  windows?: UpdateAsset;
  mac?: UpdateAsset;
  android?: Partial<Record<"arm64-v8a" | "armeabi-v7a" | "universal", UpdateAsset>>;
};

type ElectronUpdater = {
  appVersion: () => Promise<string>;
  updateCheck: () => Promise<UpdateManifest | null>;
  updateDownload: () => Promise<boolean>;
  updateInstall: () => Promise<void>;
  onUpdateProgress: (cb: (fraction: number) => void) => () => void;
};

const electron: ElectronUpdater | null =
  Platform.OS === "web" && typeof window !== "undefined" && (window as any).electronAPI?.updateCheck
    ? (window as any).electronAPI
    : null;

/** Desktop (Electron) and Android can update themselves; a plain browser and iOS can't. */
export const UPDATES_SUPPORTED = !!electron || Platform.OS === "android";

/**
 * The version actually installed. Read from the binary (the Electron exe, or the
 * APK's versionName), not from app.json: the JS bundle's embedded copy of the
 * config can be stale (Metro cache), which made 1.1.1 report itself as 1.1.0
 * and offer 1.1.1 again forever.
 */
export function currentVersion(): string {
  const desktop = Platform.OS === "web" && typeof window !== "undefined" ? (window as any).electronAPI?.installedVersion : null;
  return desktop || Constants.nativeAppVersion || Constants.expoConfig?.version || "0.0.0";
}

/** True when `a` is a newer x.y.z version than `b`. */
export function isNewer(a: string, b: string): boolean {
  const pa = a.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

export async function fetchManifest(): Promise<UpdateManifest | null> {
  if (electron) return electron.updateCheck();
  const res = await fetch(`${MANIFEST_URL}?t=${Date.now()}`, { headers: { "Cache-Control": "no-cache" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as UpdateManifest;
}

/** The APK built for this device's CPU (smaller), falling back to the universal one. */
function androidAsset(m: UpdateManifest): UpdateAsset | undefined {
  const abis = Device.supportedCpuArchitectures || [];
  const a = m.android || {};
  if (abis.includes("arm64-v8a") && a["arm64-v8a"]) return a["arm64-v8a"];
  if (abis.includes("armeabi-v7a") && a["armeabi-v7a"]) return a["armeabi-v7a"];
  return a.universal;
}

/** Whether this platform has a download in the manifest at all. */
export function hasAssetFor(m: UpdateManifest): boolean {
  if (electron) return !!((window as any).electronAPI?.platform === "darwin" ? m.mac : m.windows)?.url;
  if (Platform.OS === "android") return !!androidAsset(m)?.url;
  return false;
}

const APK_PATH = `${FileSystem.cacheDirectory}lumio-update.apk`;

/** Downloads the update and verifies its checksum. Resolves false on a bad download. */
export async function downloadUpdate(m: UpdateManifest, onProgress: (fraction: number) => void): Promise<boolean> {
  if (electron) {
    const off = electron.onUpdateProgress(onProgress);
    try {
      return await electron.updateDownload();
    } finally {
      off();
    }
  }
  const asset = androidAsset(m);
  if (!asset?.url) return false;
  try { await FileSystem.deleteAsync(APK_PATH, { idempotent: true }); } catch {}
  const task = FileSystem.createDownloadResumable(asset.url, APK_PATH, {}, (p) => {
    if (p.totalBytesExpectedToWrite > 0) onProgress(p.totalBytesWritten / p.totalBytesExpectedToWrite);
  });
  const result = await task.downloadAsync();
  if (!result || result.status !== 200) return false;
  if (asset.md5) {
    const info = await FileSystem.getInfoAsync(APK_PATH, { md5: true });
    if (!info.exists || info.md5?.toLowerCase() !== asset.md5.toLowerCase()) {
      try { await FileSystem.deleteAsync(APK_PATH, { idempotent: true }); } catch {}
      return false;
    }
  }
  return true;
}

/** Hands the downloaded update to the OS installer. Desktop quits and relaunches. */
export async function installUpdate(): Promise<void> {
  if (electron) return electron.updateInstall();
  const IntentLauncher = await import("expo-intent-launcher");
  const contentUri = await FileSystem.getContentUriAsync(APK_PATH);
  await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
    data: contentUri,
    type: "application/vnd.android.package-archive",
    flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
  });
}
