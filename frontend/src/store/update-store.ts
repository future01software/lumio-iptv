import { create } from "zustand";

import {
  UPDATES_SUPPORTED,
  currentVersion,
  downloadUpdate,
  fetchManifest,
  hasAssetFor,
  installUpdate,
  isNewer,
  type UpdateManifest,
} from "@/src/services/updater";
import { errorText } from "@/src/utils/error-text";

type Status = "idle" | "checking" | "uptodate" | "available" | "downloading" | "ready" | "error";

type State = {
  status: Status;
  manifest: UpdateManifest | null;
  progress: number;
  error: string | null;
  /** The prompt was closed with "Later"; Settings can still start the update. */
  dismissed: boolean;
  check: (manual?: boolean) => Promise<void>;
  download: () => Promise<void>;
  install: () => Promise<void>;
  dismiss: () => void;
};

export const useUpdates = create<State>((set, get) => ({
  status: "idle",
  manifest: null,
  progress: 0,
  error: null,
  dismissed: false,

  check: async (manual = false) => {
    if (!UPDATES_SUPPORTED) return;
    const busy = get().status;
    if (busy === "checking" || busy === "downloading" || busy === "ready") return;
    set({ status: "checking", error: null });
    try {
      const m = await fetchManifest();
      if (m && isNewer(m.version, currentVersion()) && hasAssetFor(m)) {
        // A manual check re-opens the prompt even if it was dismissed earlier.
        set({ status: "available", manifest: m, dismissed: manual ? false : get().dismissed });
        // Desktop: also a system notification, in case the window is in the background.
        if (!manual && typeof window !== "undefined") {
          (window as any).electronAPI?.notify?.("Lumio IPTV", `Yeni sürüm hazır: ${m.version}`, "lumio-update");
        }
      } else {
        set({ status: "uptodate", manifest: m });
      }
    } catch (e: any) {
      // Silent on the automatic launch check (offline TV boxes etc.).
      set({ status: manual ? "error" : "idle", error: manual ? `Güncelleme sunucusuna ulaşılamadı (${errorText(e)}).` : null });
    }
  },

  download: async () => {
    const m = get().manifest;
    if (!m || get().status === "downloading") return;
    set({ status: "downloading", progress: 0, error: null, dismissed: false });
    try {
      const ok = await downloadUpdate(m, (progress) => set({ progress }));
      if (!ok) {
        set({ status: "error", error: "İndirilen dosya doğrulanamadı. Tekrar dene." });
        return;
      }
      set({ status: "ready", progress: 1 });
      await get().install();
    } catch (e: any) {
      set({ status: "error", error: `İndirme başarısız: ${errorText(e)}` });
    }
  },

  install: async () => {
    try {
      await installUpdate();
    } catch (e: any) {
      set({ status: "error", error: `Kurulum başlatılamadı: ${errorText(e)}` });
    }
  },

  dismiss: () => set({ dismissed: true }),
}));
