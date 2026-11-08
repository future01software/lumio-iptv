import { create } from "zustand";
import { useIPTV } from "@/src/store/iptv-store";
import { fetchSeriesEpisodes } from "@/src/services/provider";
import type { SeriesEpisode } from "@/src/types/iptv";

// Episode lists per series, shared by the series detail page and the player
// (episodes panel, up-next). M3U series carry their episodes in the playlist;
// Xtream series need a /xtream/series-info round trip, cached here so the
// player doesn't refetch what the detail page already loaded.

type State = {
  bySeries: Record<string, SeriesEpisode[]>;
  loading: Record<string, boolean>;
  load: (seriesId: string) => Promise<SeriesEpisode[]>;
  /** Find which cached/playlist series an episode id belongs to. */
  findSeriesOf: (episodeId: string) => string | null;
};

const inflight = new Map<string, Promise<SeriesEpisode[]>>();

export function sortEpisodes(eps: SeriesEpisode[]) {
  return [...eps].sort((a, b) => a.season - b.season || a.episode - b.episode);
}

export const useSeriesEpisodes = create<State>((set, get) => ({
  bySeries: {},
  loading: {},

  load: async (seriesId) => {
    const cached = get().bySeries[seriesId];
    if (cached) return cached;
    const pending = inflight.get(seriesId);
    if (pending) return pending;

    const task = (async () => {
      const { playlist, config } = useIPTV.getState();
      const series = playlist?.series.find((s) => s.id === seriesId);
      let episodes: SeriesEpisode[] = series?.episodes || [];

      if (!episodes.length && config?.type === "xtream" && config.server && config.username && config.password) {
        set((s) => ({ loading: { ...s.loading, [seriesId]: true } }));
        try {
          episodes = await fetchSeriesEpisodes(config, seriesId);
        } catch {}
      }

      const sorted = sortEpisodes(episodes);
      set((s) => ({
        // Don't cache an empty result: a failed fetch should be retried next time.
        bySeries: sorted.length ? { ...s.bySeries, [seriesId]: sorted } : s.bySeries,
        loading: { ...s.loading, [seriesId]: false },
      }));
      return sorted;
    })();

    inflight.set(seriesId, task);
    try {
      return await task;
    } finally {
      inflight.delete(seriesId);
    }
  },

  findSeriesOf: (episodeId) => {
    for (const [sid, eps] of Object.entries(get().bySeries)) {
      if (eps.some((e) => e.id === episodeId)) return sid;
    }
    const playlist = useIPTV.getState().playlist;
    const hit = playlist?.series.find((s) => s.episodes?.some((e) => e.id === episodeId));
    return hit?.id ?? null;
  },
}));
