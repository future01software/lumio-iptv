import { Platform } from "react-native";

// Backend used by the desktop/web build (the native build parses playlists
// on-device, see provider.ts).
export const BACKEND =
  process.env.EXPO_PUBLIC_BACKEND_URL || (Platform.OS === "android" ? "http://10.0.2.2:8000" : "http://localhost:8000");

export const API = `${BACKEND}/api`;

/** Native builds talk to the IPTV provider directly - no backend involved. */
export const USE_LOCAL_PROVIDER = Platform.OS !== "web";

/**
 * Resolves true once the local backend answers (or false after `timeoutMs`).
 * The desktop app starts its bundled backend alongside the window, so the very
 * first requests at launch can otherwise hit a server that isn't listening yet.
 */
export async function waitForBackend(timeoutMs = 20000): Promise<boolean> {
  if (USE_LOCAL_PROVIDER) return true;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BACKEND}/openapi.json`, { method: "HEAD" });
      if (res.status < 500) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}
