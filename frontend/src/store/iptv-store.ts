import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";
import { getSecure, setSecure, deleteSecure, SECURE_SHARES_ASYNC_STORAGE } from "@/src/utils/secure-storage";
import { decryptData } from "@/src/utils/crypto";
import { filterAdultContent } from "@/src/utils/content-filter";
import { usePlayerSettings } from "@/src/store/player-settings-store";
import { waitForBackend } from "@/src/services/backend";
import { fetchEpgPrograms, fetchPlaylist, fetchVods } from "@/src/services/provider";
import type {
  ParsedPlaylist,
  PlaylistConfig,
  FavoriteItem,
  HistoryItem,
  EPGProgram,
  Collection,
} from "@/src/types/iptv";

// Backend URL/readiness now live in services/backend (shared with provider.ts);
// re-exported here for existing imports.
export { API, waitForBackend } from "@/src/services/backend";

const STORAGE_KEYS = {
  config: "iptv.activeConfig.v1",
  playlist: "iptv.cachedPlaylist.v1",
  deviceId: "iptv.deviceId.v1",
  recentChannels: "iptv.recentChannels.v1",
  favorites: "iptv.favorites.v1",
  history: "iptv.history.v1",
  savedAccounts: "iptv.savedAccounts.v1",
  tmdbApiKey: "iptv.tmdbApiKey.v1",
  watchlists: "iptv.watchlists.v1",
  ratings: "iptv.ratings.v1",
  collections: "iptv.collections.v1",
  playlistCachedAt: "iptv.playlistCachedAt.v1",
};

// A cached playlist older than this is shown immediately on launch and then
// refreshed silently in the background (stale-while-revalidate, like Nuvio).
const PLAYLIST_MAX_AGE_MS = 6 * 60 * 60 * 1000;

const IS_WEB = Platform.OS === "web";
const PLAYLIST_FILE = IS_WEB ? "iptv_playlist.json" : `${FileSystem.documentDirectory}iptv_playlist.json`;
const EPG_FILE = IS_WEB ? "iptv_epg.json" : `${FileSystem.documentDirectory}iptv_epg.json`;

// In the Electron desktop app, large data goes to encrypted files through the
// main process instead of localStorage (which is capped at ~5MB).
type ElectronCache = {
  cacheRead: (key: string) => Promise<string | null>;
  cacheWrite: (key: string, data: string) => Promise<boolean>;
  cacheDelete: (key: string) => Promise<boolean>;
};
const electronCache: ElectronCache | null =
  IS_WEB && typeof window !== "undefined" && (window as any).electronAPI?.cacheRead
    ? (window as any).electronAPI
    : null;

async function readCachedFile(fileKey: string): Promise<string | null> {
  try {
    if (electronCache) return await electronCache.cacheRead(fileKey);
    if (IS_WEB) return null; // plain browser: too big for localStorage, never cached
    const raw = await FileSystem.readAsStringAsync(fileKey);
    const decrypted = await decryptData(raw || "");
    // One-time migration off the old encrypted format (see writeCachedFile): rewrite
    // it as plain JSON so the next launch skips the multi-second decrypt.
    if (decrypted && decrypted !== raw) {
      FileSystem.writeAsStringAsync(fileKey, decrypted).catch(() => {});
    }
    return decrypted || raw;
  } catch {
    return null;
  }
}

async function writeCachedFile(fileKey: string, data: string): Promise<void> {
  try {
    if (electronCache) {
      await electronCache.cacheWrite(fileKey, data);
    } else if (!IS_WEB) {
      // Stored as plain JSON in the app's private files dir (sandboxed, allowBackup=false).
      // It used to go through CryptoJS AES, which is pure JS: on a 32-bit TV box a
      // cached playlist took ~45s to decrypt at launch (and froze the UI again on every
      // save). Credentials themselves stay in SecureStore via STORAGE_KEYS.config.
      await FileSystem.writeAsStringAsync(fileKey, data);
    }
  } catch (e) {
    console.warn("Cache write failed", fileKey, e);
  }
}

async function deleteCachedFile(fileKey: string): Promise<void> {
  try {
    if (electronCache) await electronCache.cacheDelete(fileKey);
    else if (IS_WEB) await AsyncStorage.removeItem(fileKey);
    else await FileSystem.deleteAsync(fileKey);
  } catch {}
}

// Profile-scoped helpers: favorites/history/recents are namespaced by profileId.
function profileKey(base: string, profileId?: string | null) {
  return profileId ? `${base}::${profileId}` : base;
}

async function getDeviceId(): Promise<string> {
  let id = await AsyncStorage.getItem(STORAGE_KEYS.deviceId);
  if (!id) {
    id = `dev_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    await AsyncStorage.setItem(STORAGE_KEYS.deviceId, id);
  }
  return id;
}

type State = {
  config: PlaylistConfig | null;
  playlist: ParsedPlaylist | null;
  loading: boolean;
  error: string | null;
  deviceId: string;
  recentChannels: string[];
  favorites: Record<string, FavoriteItem>;
  history: HistoryItem[];
  epgByChannel: Record<string, EPGProgram[]>;
  epgLoading: boolean;
  vodsLoading: boolean;
  activeProfileId: string | null;
  savedAccounts: PlaylistConfig[];
  tmdbApiKey: string;
  watchlists: Record<string, FavoriteItem>;
  ratings: Record<string, number>;
  collections: Collection[];

  init: () => Promise<void>;
  setProfile: (id: string | null) => Promise<void>;
  loadPlaylist: (cfg: PlaylistConfig) => Promise<boolean>;
  setActive: (cfg: PlaylistConfig, parsed: ParsedPlaylist) => Promise<void>;
  applyAdultFilter: (hide: boolean) => Promise<void>;
  clearPlaylist: () => Promise<void>;
  pushRecent: (channelId: string) => Promise<void>;
  toggleFavorite: (item: FavoriteItem) => Promise<void>;
  upsertHistory: (item: HistoryItem) => Promise<void>;
  loadEPG: () => Promise<void>;
  loadVodsAndSeries: () => Promise<void>;
  refreshPlaylistInBackground: () => Promise<void>;
  addSavedAccount: (cfg: PlaylistConfig) => Promise<void>;
  removeSavedAccount: (index: number) => Promise<void>;
  setTmdbApiKey: (key: string) => Promise<void>;
  toggleWatchlist: (item: FavoriteItem) => Promise<void>;
  setRating: (itemId: string, rating: number) => Promise<void>;
  createCollection: (title: string) => Promise<Collection>;
  renameCollection: (id: string, title: string) => Promise<void>;
  removeCollection: (id: string) => Promise<void>;
  addToCollection: (collectionId: string, item: FavoriteItem) => Promise<void>;
  removeFromCollection: (collectionId: string, itemId: string) => Promise<void>;
  moveCollection: (id: string, direction: "up" | "down") => Promise<void>;
};

export const useIPTV = create<State>((set, get) => ({
  config: null,
  playlist: null,
  loading: false,
  error: null,
  deviceId: "",
  recentChannels: [],
  favorites: {},
  history: [],
  epgByChannel: {},
  epgLoading: false,
  vodsLoading: false,
  activeProfileId: null as string | null,
  savedAccounts: [] as PlaylistConfig[],
  tmdbApiKey: "15d2ea6d0dc1d476efbca3eba2b9bbfb", // Default community key
  watchlists: {},
  ratings: {},
  collections: [],

  init: async () => {
    const deviceId = await getDeviceId();
    let cfgRaw = null;
    try {
      cfgRaw = await getSecure(STORAGE_KEYS.config);
    } catch {}

    if (!cfgRaw) {
      cfgRaw = await AsyncStorage.getItem(STORAGE_KEYS.config);
      if (cfgRaw) {
        try {
          await setSecure(STORAGE_KEYS.config, cfgRaw);
          if (!SECURE_SHARES_ASYNC_STORAGE) await AsyncStorage.removeItem(STORAGE_KEYS.config);
        } catch {}
      }
    }

    // Load saved accounts
    let savedAccounts: PlaylistConfig[] = [];
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.savedAccounts);
      savedAccounts = raw ? JSON.parse(raw) : [];
    } catch {}

    const plRaw = await readCachedFile(PLAYLIST_FILE);

    const safeParse = <T,>(raw: string | null, fallback: T): T => {
      if (!raw) return fallback;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return fallback;
      }
    };

    let tmdbKey = "15d2ea6d0dc1d476efbca3eba2b9bbfb";
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEYS.tmdbApiKey);
      if (stored) tmdbKey = stored;
    } catch {}

    let config = safeParse<PlaylistConfig | null>(cfgRaw, null);
    const playlist = safeParse<ParsedPlaylist | null>(plRaw, null);

    // Recovery for desktop builds hit by the old bug above: the playlist was cached
    // but its config got wiped. Match it back up with a saved account by name (or
    // the only saved account) so series episodes, EPG and refresh work again.
    if (!config && playlist && savedAccounts.length) {
      const match =
        savedAccounts.find((a) => a.name && a.name === (playlist as any).name) ||
        (savedAccounts.length === 1 ? savedAccounts[0] : null);
      if (match) {
        config = match;
        try { await setSecure(STORAGE_KEYS.config, JSON.stringify(match)); } catch {}
      }
    }
    set({
      deviceId,
      config,
      playlist,
      savedAccounts,
      tmdbApiKey: tmdbKey,
      // epgByChannel is initially empty, will be loaded in background
    });

    // Show the cached playlist right away; refresh it behind the scenes if it's
    // stale, or finish a VOD load that was interrupted last session.
    if (config && playlist) {
      let cachedAt = 0;
      try {
        cachedAt = Number(await AsyncStorage.getItem(STORAGE_KEYS.playlistCachedAt)) || 0;
      } catch {}
      const stale = Date.now() - cachedAt > PLAYLIST_MAX_AGE_MS;
      setTimeout(() => {
        if (stale) get().refreshPlaylistInBackground();
        else if (config.type === "xtream" && !playlist.movies?.length && !playlist.series?.length) {
          get().loadVodsAndSeries();
        }
      }, 1500);
    }

    // Arka planda EPG'yi oku ve çöz (İlk açılışı hızlandırmak için)
    setTimeout(async () => {
      const epgRaw = await readCachedFile(EPG_FILE);
      if (epgRaw) {
        set({ epgByChannel: safeParse<Record<string, EPGProgram[]>>(epgRaw, {}) });
      }
    }, 500);
  },

  setProfile: async (id) => {
    set({ activeProfileId: id });
    const [recRaw, favRaw, histRaw, watchRaw, ratingRaw, collRaw] = await Promise.all([
      AsyncStorage.getItem(profileKey(STORAGE_KEYS.recentChannels, id)),
      AsyncStorage.getItem(profileKey(STORAGE_KEYS.favorites, id)),
      AsyncStorage.getItem(profileKey(STORAGE_KEYS.history, id)),
      AsyncStorage.getItem(profileKey(STORAGE_KEYS.watchlists, id)),
      AsyncStorage.getItem(profileKey(STORAGE_KEYS.ratings, id)),
      AsyncStorage.getItem(profileKey(STORAGE_KEYS.collections, id)),
    ]);
    set({
      recentChannels: recRaw ? JSON.parse(recRaw) : [],
      favorites: favRaw ? JSON.parse(favRaw) : {},
      history: histRaw ? JSON.parse(histRaw) : [],
      watchlists: watchRaw ? JSON.parse(watchRaw) : {},
      ratings: ratingRaw ? JSON.parse(ratingRaw) : {},
      collections: collRaw ? JSON.parse(collRaw) : [],
    });
  },

  loadPlaylist: async (cfg) => {
    set({ loading: true, error: null });
    try {
      const parsed = await fetchPlaylist(cfg);
      await get().setActive(cfg, parsed);
      set({ loading: false });
      // Kick off EPG and VOD load in background (loadEPG derives the Xtream
      // guide URL itself, so it isn't limited to configs with an explicit epg_url).
      get().loadEPG();
      if (cfg.type === "xtream") get().loadVodsAndSeries();
      return true;
    } catch (e: any) {
      set({ loading: false, error: e.message || "Bilinmeyen hata" });
      return false;
    }
  },

  loadVodsAndSeries: async () => {
    const cfg = get().config;
    if (!cfg || cfg.type !== "xtream") return;
    const currentPlaylist = get().playlist;
    if (!currentPlaylist) return;

    set({ vodsLoading: true });
    try {
      const parsed = await fetchVods(cfg);

      const newPlaylist = {
        ...currentPlaylist,
        movies: parsed.movies || [],
        series: parsed.series || [],
        groups: {
          ...currentPlaylist.groups,
          movie: parsed.groups?.movie || [],
          series: parsed.groups?.series || [],
        }
      };
      await get().setActive(cfg, newPlaylist);
    } catch (e) {
      console.warn("VOD background load error", e);
    } finally {
      set({ vodsLoading: false });
    }
  },

  // Silent refresh: unlike loadPlaylist it never flips `loading` (no spinners,
  // no redirects) and keeps the current movies/series until fresh VODs arrive.
  refreshPlaylistInBackground: async () => {
    const cfg = get().config;
    if (!cfg || cfg.m3u_url === "local_file") return;
    if (!(await waitForBackend())) return;
    try {
      const fresh = await fetchPlaylist(cfg);
      if (get().config !== cfg) return; // user switched playlists meanwhile
      const current = get().playlist;
      const merged: ParsedPlaylist =
        cfg.type === "xtream" && current
          ? {
              ...fresh,
              movies: current.movies,
              series: current.series,
              groups: { ...fresh.groups, movie: current.groups?.movie || [], series: current.groups?.series || [] },
            }
          : fresh;
      await get().setActive(cfg, merged);
      get().loadEPG();
      if (cfg.type === "xtream") get().loadVodsAndSeries();
    } catch (e) {
      console.warn("Background playlist refresh failed", e);
    }
  },

setActive: async (cfg, parsed) => {
  try {
    await setSecure(STORAGE_KEYS.config, JSON.stringify(cfg));
  } catch {}

  // Drop the legacy plain copy - unless secure storage *is* that same slot
  // (plain browser), where this used to delete the config it had just saved.
  if (!SECURE_SHARES_ASYNC_STORAGE) {
    try {
      await AsyncStorage.removeItem(STORAGE_KEYS.config);
    } catch {}
  }

  let filteredParsed = parsed;
  try {
    const rawSettings = await AsyncStorage.getItem("iptv.settings");
    if (rawSettings) {
      const s = JSON.parse(rawSettings);
      if (s.hideAdult) {
        filteredParsed = filterAdultContent(parsed);
      }
    }
  } catch {}

  // Android/iOS: şifreli dosya. Masaüstü (Electron): OS şifrelemeli dosya.
  // Düz tarayıcıda localStorage kotası yetmediği için kaydedilmiyor.
  set({ config: cfg, playlist: filteredParsed });
  await writeCachedFile(PLAYLIST_FILE, JSON.stringify(filteredParsed));
  try { await AsyncStorage.setItem(STORAGE_KEYS.playlistCachedAt, String(Date.now())); } catch {}
},

  // Toggling "Hide Adult Content" in Settings should take effect immediately, not
  // just on the next login. Hiding is a simple in-memory filter; un-hiding needs a
  // fresh parse since already-filtered items aren't kept around anywhere.
  applyAdultFilter: async (hide) => {
    if (hide) {
      const playlist = get().playlist;
      if (!playlist) return;
      set({ playlist: filterAdultContent(playlist) });
    } else {
      const cfg = get().config;
      if (cfg) await get().loadPlaylist(cfg);
    }
  },

  clearPlaylist: async () => {
    try { await deleteSecure(STORAGE_KEYS.config); } catch {}
    try { await AsyncStorage.removeItem(STORAGE_KEYS.config); } catch {}
    await deleteCachedFile(PLAYLIST_FILE);
    await deleteCachedFile(EPG_FILE);
    try { await AsyncStorage.removeItem(STORAGE_KEYS.playlistCachedAt); } catch {}
    set({ config: null, playlist: null, epgByChannel: {} });
  },

  pushRecent: async (channelId) => {
    const next = [channelId, ...get().recentChannels.filter((c) => c !== channelId)].slice(0, 20);
    await AsyncStorage.setItem(profileKey(STORAGE_KEYS.recentChannels, get().activeProfileId), JSON.stringify(next));
    set({ recentChannels: next });
  },

  toggleFavorite: async (item) => {
    const favs = { ...get().favorites };
    if (favs[item.item_id]) delete favs[item.item_id];
    else favs[item.item_id] = item;
    await AsyncStorage.setItem(profileKey(STORAGE_KEYS.favorites, get().activeProfileId), JSON.stringify(favs));
    set({ favorites: favs });
  },

  upsertHistory: async (item) => {
    const filtered = get().history.filter((h) => h.item_id !== item.item_id);
    const next = [{ ...item, updated_at: new Date().toISOString() }, ...filtered].slice(0, 50);
    await AsyncStorage.setItem(profileKey(STORAGE_KEYS.history, get().activeProfileId), JSON.stringify(next));
    set({ history: next });
  },

  loadEPG: async () => {
    const { config } = get();
    if (!config) return;
    
    let epgUrl = config.epg_url;
    if (!epgUrl && config.type === "xtream" && config.server && config.username && config.password) {
      epgUrl = `${config.server.replace(/\/$/, "")}/xmltv.php?username=${config.username}&password=${config.password}`;
    }
    
    if (!epgUrl) return;
    set({ epgLoading: true });
    try {
      // On-device parsing only keeps programmes for channels we actually have.
      const ids = new Set(
        (get().playlist?.channels || []).map((c) => c.epg_channel_id).filter((x): x is string => !!x),
      );
      const programs = await fetchEpgPrograms(epgUrl, ids.size ? ids : undefined);
      const grouped: Record<string, EPGProgram[]> = {};
      for (const p of programs) {
        if (!grouped[p.channel]) grouped[p.channel] = [];
        grouped[p.channel].push(p);
      }
      for (const k of Object.keys(grouped)) {
        // Fixed-format timestamps: plain code-point order is correct and avoids an ICU
        // collator call per comparison (thousands of programmes on a slow TV box).
        grouped[k].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
      }
      set({ epgByChannel: grouped, epgLoading: false });
      await writeCachedFile(EPG_FILE, JSON.stringify(grouped));
    } catch {
      set({ epgLoading: false });
    }
  },

  addSavedAccount: async (cfg) => {
    const existing = get().savedAccounts;
    // Aynı hesap zaten varsa güncelle, yoksa ekle
    const key = cfg.type === "xtream" 
      ? `${cfg.server}::${cfg.username}` 
      : cfg.m3u_url || "";
    const filtered = existing.filter(a => {
      const aKey = a.type === "xtream" 
        ? `${a.server}::${a.username}` 
        : a.m3u_url || "";
      return aKey !== key;
    });
    const updated = [cfg, ...filtered].slice(0, 10); // max 10 hesap
    await AsyncStorage.setItem(STORAGE_KEYS.savedAccounts, JSON.stringify(updated));
    set({ savedAccounts: updated });
  },

  removeSavedAccount: async (index) => {
    const updated = get().savedAccounts.filter((_, i) => i !== index);
    await AsyncStorage.setItem(STORAGE_KEYS.savedAccounts, JSON.stringify(updated));
    set({ savedAccounts: updated });
  },

  setTmdbApiKey: async (key: string) => {
    await AsyncStorage.setItem(STORAGE_KEYS.tmdbApiKey, key);
    set({ tmdbApiKey: key });
  },

  toggleWatchlist: async (item) => {
    const lists = { ...get().watchlists };
    if (lists[item.item_id]) delete lists[item.item_id];
    else lists[item.item_id] = item;
    await AsyncStorage.setItem(profileKey(STORAGE_KEYS.watchlists, get().activeProfileId), JSON.stringify(lists));
    set({ watchlists: lists });
  },

  setRating: async (itemId, rating) => {
    const ratings = { ...get().ratings };
    ratings[itemId] = rating;
    await AsyncStorage.setItem(profileKey(STORAGE_KEYS.ratings, get().activeProfileId), JSON.stringify(ratings));
    set({ ratings });
  },

  createCollection: async (title) => {
    const collection: Collection = {
      id: `coll_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      title,
      items: [],
      createdAt: new Date().toISOString(),
    };
    const collections = [...get().collections, collection];
    await AsyncStorage.setItem(profileKey(STORAGE_KEYS.collections, get().activeProfileId), JSON.stringify(collections));
    set({ collections });
    return collection;
  },

  renameCollection: async (id, title) => {
    const collections = get().collections.map((c) => (c.id === id ? { ...c, title } : c));
    await AsyncStorage.setItem(profileKey(STORAGE_KEYS.collections, get().activeProfileId), JSON.stringify(collections));
    set({ collections });
  },

  removeCollection: async (id) => {
    const collections = get().collections.filter((c) => c.id !== id);
    await AsyncStorage.setItem(profileKey(STORAGE_KEYS.collections, get().activeProfileId), JSON.stringify(collections));
    set({ collections });
  },

  addToCollection: async (collectionId, item) => {
    const collections = get().collections.map((c) => {
      if (c.id !== collectionId) return c;
      if (c.items.some((i) => i.item_id === item.item_id)) return c;
      return { ...c, items: [...c.items, item] };
    });
    await AsyncStorage.setItem(profileKey(STORAGE_KEYS.collections, get().activeProfileId), JSON.stringify(collections));
    set({ collections });
  },

  removeFromCollection: async (collectionId, itemId) => {
    const collections = get().collections.map((c) =>
      c.id === collectionId ? { ...c, items: c.items.filter((i) => i.item_id !== itemId) } : c
    );
    await AsyncStorage.setItem(profileKey(STORAGE_KEYS.collections, get().activeProfileId), JSON.stringify(collections));
    set({ collections });
  },

  moveCollection: async (id, direction) => {
    const collections = [...get().collections];
    const idx = collections.findIndex((c) => c.id === id);
    const swapWith = direction === "up" ? idx - 1 : idx + 1;
    if (idx < 0 || swapWith < 0 || swapWith >= collections.length) return;
    [collections[idx], collections[swapWith]] = [collections[swapWith], collections[idx]];
    await AsyncStorage.setItem(profileKey(STORAGE_KEYS.collections, get().activeProfileId), JSON.stringify(collections));
    set({ collections });
  },
}));

/** "Now" shifted by the user's EPG Shift setting, so guides sourced from a
 * differently-timezoned provider can be realigned without re-tagging the data. */
export function getEpgNow(): string {
  const shiftHours = usePlayerSettings.getState().epgShift;
  return new Date(Date.now() + shiftHours * 3600_000).toISOString();
}

export function currentEPG(programs: EPGProgram[] | undefined): {
  current?: EPGProgram;
  next?: EPGProgram;
} {
  if (!programs?.length) return {};
  const now = getEpgNow();
  let current: EPGProgram | undefined;
  let next: EPGProgram | undefined;
  for (let i = 0; i < programs.length; i++) {
    const p = programs[i];
    if (p.start <= now && p.stop > now) {
      current = p;
      next = programs[i + 1];
      break;
    }
    if (p.start > now) {
      next = p;
      break;
    }
  }
  return { current, next };
}
