import { Platform } from "react-native";
import * as Device from "expo-device";
import * as SecureStore from "expo-secure-store";

/**
 * "Light mode" for low-end Android devices (typically 1-2 GB TV boxes with Cortex-A35/A53
 * cores). Measured on a 2 GB Amlogic box: ~37% janky frames with the UI thread, not the
 * GPU, as the bottleneck and only ~230 MB RAM left free. On these devices we skip the
 * purely decorative work: focus zoom animations, image fade-ins, full-size posters, and
 * we start live previews later so zapping through the list doesn't decode every channel.
 */
const LOW_RAM_BYTES = 3 * 1024 * 1024 * 1024;

/** What the device would get without a user choice. */
export const AUTO_LOW_END: boolean =
  Platform.OS === "android" && !!Device.totalMemory && Device.totalMemory < LOW_RAM_BYTES;

/**
 * Settings > Advanced > Performance mode. Read synchronously at startup because LOW_END
 * is used at module load (e.g. which Pressable a card uses), so a change applies after a
 * restart. Web/Electron: localStorage; native: SecureStore's sync getItem.
 */
export type PerfMode = "auto" | "light" | "full";
const PERF_KEY = "lumio_perf_mode";

function readPerfMode(): PerfMode {
  try {
    const v = Platform.OS === "web" ? globalThis.localStorage?.getItem(PERF_KEY) : SecureStore.getItem(PERF_KEY);
    return v === "light" || v === "full" ? v : "auto";
  } catch {
    return "auto";
  }
}

export const PERF_MODE: PerfMode = readPerfMode();

export async function savePerfMode(mode: PerfMode): Promise<void> {
  try {
    if (Platform.OS === "web") globalThis.localStorage?.setItem(PERF_KEY, mode);
    else await SecureStore.setItemAsync(PERF_KEY, mode);
  } catch {}
}

export const LOW_END: boolean = PERF_MODE === "light" ? true : PERF_MODE === "full" ? false : AUTO_LOW_END;

/** Focus zoom for cards/buttons: off in light mode (the focus ring still shows focus). */
export function focusScale(scale: number): number {
  return LOW_END ? 1 : scale;
}

/** Image fade-in duration: none in light mode. */
export function imageTransition(ms: number): number {
  return LOW_END ? 0 : ms;
}

/**
 * Smaller TMDB poster in light mode: providers often hand out 600x900 originals, which
 * cost ~2 MB of bitmap memory each and slow uploads on weak GPUs. w342 is plenty for a
 * ~200dp card on a 1080p TV.
 */
export function posterUri(uri?: string | null): string | null | undefined {
  if (!LOW_END || !uri) return uri;
  return uri.replace(/(image\.tmdb\.org\/t\/p\/)[^/]+\//, "$1w342/");
}
