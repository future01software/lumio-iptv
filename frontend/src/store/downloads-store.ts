import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import { downloadHLS, deleteHLS } from "@/src/utils/hls-downloader";

export type DownloadStatus = "queued" | "downloading" | "paused" | "completed" | "failed";

export type DownloadItem = {
  id: string;
  url: string;
  name: string;
  kind: "movie" | "series" | "live";
  logo?: string | null;
  fileUri?: string;
  status: DownloadStatus;
  progress: number; // 0..1
  totalBytes: number;
  downloadedBytes: number;
  error?: string;
  createdAt: string;
  resumeData?: string | null;
  isHls?: boolean;
};

const STORAGE_KEY = "iptv.downloads.v1";
import { Platform } from "react-native";
const IS_WEB = Platform.OS === "web";
const BASE_DIR = IS_WEB ? "" : `${FileSystem.documentDirectory}downloads/`;

type State = {
  items: Record<string, DownloadItem>;
  active: Record<string, FileSystem.DownloadResumable>;
  initialized: boolean;
  init: () => Promise<void>;
  enqueue: (input: { id: string; url: string; name: string; kind: DownloadItem["kind"]; logo?: string | null }) => Promise<DownloadItem | null>;
  pause: (id: string) => Promise<void>;
  resume: (id: string) => Promise<void>;
  cancel: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  storageStats: () => Promise<{ used: number; count: number; free?: number }>;
};

function persist(items: Record<string, DownloadItem>) {
  // Don't persist active downloadable refs
  return AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

function guessExt(url: string) {
  const m = url.toLowerCase().match(/\.(mp4|mkv|mov|avi|webm)(\?|$)/);
  return m ? m[1] : "mp4";
}

async function ensureDir() {
  if (IS_WEB) return;
  const info = await FileSystem.getInfoAsync(BASE_DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(BASE_DIR, { intermediates: true });
}

export const useDownloads = create<State>((set, get) => ({
  items: {},
  active: {},
  initialized: false,

  init: async () => {
    if (get().initialized) return;
    try {
      await ensureDir();
    } catch {}
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    let items: Record<string, DownloadItem> = raw ? JSON.parse(raw) : {};
    // Mark interrupted downloads as paused so they can be resumed.
    for (const id of Object.keys(items)) {
      if (items[id].status === "downloading") items[id].status = "paused";
    }
    set({ items, initialized: true });
    await persist(items);
  },

  enqueue: async (input) => {
    if (IS_WEB) return null;
    const { id, url, name, kind, logo } = input;
    const existing = get().items[id];
    if (existing && existing.status === "completed") return existing;

    const isHls = /\.m3u8(\?|$)/i.test(url);

    // ---------- HLS branch ----------
    if (isHls) {
      const item: DownloadItem = existing ?? {
        id, url, name, kind, logo,
        status: "queued", progress: 0, totalBytes: 0, downloadedBytes: 0,
        createdAt: new Date().toISOString(), resumeData: null, isHls: true,
      };
      const items = { ...get().items, [id]: { ...item, status: "downloading" as DownloadStatus, isHls: true } };
      set({ items });
      await persist(items);

      const cancelRef = { v: false };
      // store a marker we can flip from pause()
      const activeMarker: any = {
        savable: () => ({ url, fileUri: "", options: {}, resumeData: null }),
        pauseAsync: async () => { if (IS_WEB) return; cancelRef.v = true; },
        resumeAsync: async () => { if (IS_WEB) return; /* handled in resume() below */ },
        __isHls: true, __cancelRef: cancelRef,
      };
      set({ active: { ...get().active, [id]: activeMarker } });

      try {
        const res = await downloadHLS({
          id, manifestUrl: url, baseDir: BASE_DIR,
          shouldCancel: () => cancelRef.v,
          onProgress: (p) => {
            const cur = get().items[id];
            if (!cur) return;
            const progress = p.total > 0 ? p.done / p.total : 0;
            set({ items: { ...get().items, [id]: {
              ...cur, progress,
              totalBytes: 0, downloadedBytes: p.bytes,
              status: p.status === "downloading" || p.status === "preparing" ? "downloading" : cur.status,
            } } });
          },
        });
        if (!res) {
          if (cancelRef.v) {
            const cur = get().items[id];
            const next = { ...get().items, [id]: { ...cur, status: "paused" as DownloadStatus } };
            set({ items: next });
            await persist(next);
            return null;
          }
          throw new Error("HLS download failed");
        }
        const finished: DownloadItem = {
          ...get().items[id], status: "completed", progress: 1,
          fileUri: res.localManifestUri,
        };
        const next = { ...get().items, [id]: finished };
        const { [id]: _, ...restActive } = get().active;
        set({ items: next, active: restActive });
        await persist(next);
        return finished;
      } catch (e: any) {
        const cur = get().items[id];
        const failed = { ...cur, status: "failed" as DownloadStatus, error: String(e?.message || e) };
        const next = { ...get().items, [id]: failed };
        set({ items: next });
        await persist(next);
        return null;
      }
    }

    // ---------- Direct-file branch (mp4/mkv/...) ----------
    const ext = guessExt(url);
    const safeName = name.replace(/[^a-z0-9._-]/gi, "_").slice(0, 80);
    const fileUri = `${BASE_DIR}${id}_${safeName}.${ext}`;

    const item: DownloadItem = existing ?? {
      id,
      url,
      name,
      kind,
      logo,
      fileUri,
      status: "queued",
      progress: 0,
      totalBytes: 0,
      downloadedBytes: 0,
      createdAt: new Date().toISOString(),
      resumeData: null,
    };
    const items = { ...get().items, [id]: { ...item, status: "downloading" as DownloadStatus } };
    set({ items });
    await persist(items);

    const onProgress = (p: FileSystem.DownloadProgressData) => {
      const cur = get().items[id];
      if (!cur) return;
      const progress = p.totalBytesExpectedToWrite > 0 ? p.totalBytesWritten / p.totalBytesExpectedToWrite : 0;
      const next = {
        ...cur,
        progress,
        totalBytes: p.totalBytesExpectedToWrite,
        downloadedBytes: p.totalBytesWritten,
      };
      set({ items: { ...get().items, [id]: next } });
    };

    const downloadable = FileSystem.createDownloadResumable(url, fileUri, {}, onProgress);
    set({ active: { ...get().active, [id]: downloadable } });

    try {
      const res = await downloadable.downloadAsync();
      if (!res) throw new Error("İndirme başarısız oldu");
      const finished: DownloadItem = {
        ...get().items[id],
        status: "completed" as DownloadStatus,
        progress: 1,
        fileUri: res.uri,
      };
      const next = { ...get().items, [id]: finished };
      const { [id]: _, ...restActive } = get().active;
      set({ items: next, active: restActive });
      await persist(next);
      return finished;
    } catch (e: any) {
      const cur = get().items[id];
      // If paused, the resume data has already been saved
      if (cur?.status === "paused") return null;
      const failed = { ...cur, status: "failed" as DownloadStatus, error: String(e?.message || e) };
      const next = { ...get().items, [id]: failed };
      set({ items: next });
      await persist(next);
      return null;
    }
  },

  pause: async (id) => {
    const dl = get().active[id];
    if (!dl) return;
    try {
      await dl.pauseAsync();
    } catch {}
    const resumeData = JSON.stringify(dl.savable());
    const cur = get().items[id];
    if (!cur) return;
    const next = { ...get().items, [id]: { ...cur, status: "paused" as DownloadStatus, resumeData } };
    set({ items: next });
    await persist(next);
  },

  resume: async (id) => {
    const cur = get().items[id];
    if (!cur) return;
    if (cur.isHls) {
      // For HLS, just re-run enqueue — it'll skip already-downloaded segments.
      await get().enqueue({ id, url: cur.url, name: cur.name, kind: cur.kind, logo: cur.logo });
      return;
    }
    const existing = get().active[id];
    let dl = existing;
    if (!dl && cur.resumeData) {
      try {
        const saved = JSON.parse(cur.resumeData);
        dl = new FileSystem.DownloadResumable(saved.url, saved.fileUri, saved.options, (p) => {
          const c = get().items[id];
          if (!c) return;
          const progress = p.totalBytesExpectedToWrite > 0 ? p.totalBytesWritten / p.totalBytesExpectedToWrite : 0;
          set({ items: { ...get().items, [id]: { ...c, progress, totalBytes: p.totalBytesExpectedToWrite, downloadedBytes: p.totalBytesWritten } } });
        }, saved.resumeData);
      } catch {}
    }
    if (!dl) {
      // Restart from scratch
      await get().enqueue({ id, url: cur.url, name: cur.name, kind: cur.kind, logo: cur.logo });
      return;
    }
    set({ active: { ...get().active, [id]: dl }, items: { ...get().items, [id]: { ...cur, status: "downloading" } } });
    try {
      const res = await dl.resumeAsync();
      if (!res) throw new Error("İndirme devam ettirilemedi");
      const finished: DownloadItem = { ...get().items[id], status: "completed", progress: 1, fileUri: res.uri };
      const next = { ...get().items, [id]: finished };
      const { [id]: _, ...restActive } = get().active;
      set({ items: next, active: restActive });
      await persist(next);
    } catch (e: any) {
      const c = get().items[id];
      if (c?.status === "paused") return;
      const failed = { ...c, status: "failed" as DownloadStatus, error: String(e?.message || e) };
      const next = { ...get().items, [id]: failed };
      set({ items: next });
      await persist(next);
    }
  },

  cancel: async (id) => {
    if (IS_WEB) return;
    const dl = get().active[id];
    if (dl) {
      try { await dl.pauseAsync(); } catch {}
    }
    await get().remove(id);
  },

  remove: async (id) => {
    const cur = get().items[id];
    if (cur?.isHls) {
      await deleteHLS({ id, baseDir: BASE_DIR });
    } else if (cur?.fileUri) {
      try {
        const info = await FileSystem.getInfoAsync(cur.fileUri);
        if (info.exists) await FileSystem.deleteAsync(cur.fileUri, { idempotent: true });
      } catch {}
    }
    const { [id]: _, ...rest } = get().items;
    const { [id]: __, ...restActive } = get().active;
    set({ items: rest, active: restActive });
    await persist(rest);
  },

  storageStats: async () => {
    const items = Object.values(get().items);
    const used = items.reduce((a, b) => a + (b.downloadedBytes || 0), 0);
    let free: number | undefined;
    try {
      free = await FileSystem.getFreeDiskStorageAsync();
    } catch {}
    return { used, count: items.length, free };
  },
}));

export function fmtBytes(b: number) {
  if (!b) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (b >= 1024 && i < units.length - 1) { b /= 1024; i++; }
  return `${b.toFixed(b >= 10 ? 0 : 1)} ${units[i]}`;
}
