import { Platform } from "react-native";
import * as Device from "expo-device";

/** Desktop: Electron EXE, native Windows/macOS, or non-mobile web browser. */
export function isDesktopEnvironment(): boolean {
  if (Platform.OS === "windows" || Platform.OS === "macos") return true;
  if (Platform.OS !== "web" || typeof window === "undefined") return false;

  const ua = window.navigator.userAgent.toLowerCase();
  if (/electron/i.test(ua)) return true;
  const isMobileWeb = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(ua);
  return !isMobileWeb;
}

function looksLikeTvHardware(name: string): boolean {
  const n = name.toLowerCase();
  return (
    n.includes("tv") ||
    n.includes("box") ||
    n.includes("stick") ||
    n.includes("aft") || // Amazon Fire TV
    n.includes("bravia") ||
    n.includes("shield") ||
    n.includes("chromecast")
  );
}

/** Apple TV, Android TV, Fire TV, etc. — not phones/tablets. */
export function isNativeTVSync(): boolean {
  if ((Platform as any).isTV === true) return true;
  if (Platform.OS === "android") {
    const model = Device.modelName || "";
    const product = Device.productName || "";
    if (looksLikeTvHardware(model) || looksLikeTvHardware(product)) return true;
  }
  return false;
}

export async function detectNativeTV(): Promise<boolean> {
  if (isNativeTVSync()) return true;
  if (Platform.OS === "web") return false;

  try {
    const deviceType = await Device.getDeviceTypeAsync();
    if (deviceType === Device.DeviceType.TV) return true;

    const model = Device.modelName || "";
    const product = Device.productName || "";
    if (looksLikeTvHardware(model) || looksLikeTvHardware(product)) return true;

    // Android TV boxes often report UNKNOWN + landscape-only; avoid flagging phones.
    if (Platform.OS === "android" && deviceType === Device.DeviceType.UNKNOWN) {
      if (looksLikeTvHardware(model) || looksLikeTvHardware(product)) return true;
    }
  } catch {
    // ignore
  }
  return false;
}

/**
 * Netflix-style top navigation: TV, Apple TV, desktop.
 * Bottom tab bar: phones and tablets only.
 */
export function isTVStyleLayout(nativeTV: boolean): boolean {
  return nativeTV || isDesktopEnvironment();
}
