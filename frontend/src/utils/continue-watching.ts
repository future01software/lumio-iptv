import type { HistoryItem, SeriesEpisode } from "@/src/types/iptv";

/** Watched this far → treat as finished (credits); matches the player's episode panel. */
export const WATCHED_RATIO = 0.92;

export type ContinueEntry = HistoryItem & {
  /** Next episode of a series whose latest watched episode is finished. */
  nextUp?: boolean;
  /** "S2 · B5" when the episode could be located in its series. */
  episodeLabel?: string;
};

function progressOf(h: HistoryItem) {
  return h.duration > 0 ? h.position / h.duration : 0;
}

function label(ep: SeriesEpisode) {
  return `S${ep.season} · B${ep.episode}`;
}

/**
 * Nuvio-style "Continue watching" (CachedNextUpRelease / next-up reconciliation):
 * - one card per series, driven by its most recently watched episode;
 * - unfinished → resume that episode; finished → the next episode, if any;
 * - finished movies drop out.
 * `history` is newest-first. Returns the series ids whose episode lists are
 * needed but not loaded yet, so the caller can fetch them.
 */
export function buildContinueWatching(
  history: HistoryItem[],
  episodesBySeries: Record<string, SeriesEpisode[] | undefined>,
  limit = 10,
): { entries: ContinueEntry[]; missingSeries: string[] } {
  const entries: ContinueEntry[] = [];
  const missingSeries: string[] = [];
  const seenSeries = new Set<string>();

  for (const h of history) {
    if (entries.length >= limit) break;
    if (h.kind === "live") continue;
    // Entries at 0s never actually played (dead links, or saved by the old
    // history bug) - nothing to continue.
    if (h.position < 1) continue;
    const finished = progressOf(h) >= WATCHED_RATIO;

    if (h.kind === "series" && h.series_id) {
      if (seenSeries.has(h.series_id)) continue; // an older episode of a series already shown
      seenSeries.add(h.series_id);
      const eps = episodesBySeries[h.series_id];
      const idx = eps ? eps.findIndex((e) => e.id === h.item_id) : -1;

      if (!finished) {
        entries.push({ ...h, episodeLabel: idx >= 0 ? label(eps![idx]) : undefined });
        continue;
      }
      if (!eps) {
        missingSeries.push(h.series_id);
        continue;
      }
      const next = idx >= 0 ? eps[idx + 1] : undefined;
      if (!next) continue; // caught up with the series
      // Next episode partly watched before (e.g. rewatched the previous one)? Resume it.
      const earlier = history.find((x) => x.item_id === next.id);
      const resumable = earlier && progressOf(earlier) < WATCHED_RATIO;
      entries.push({
        item_id: next.id,
        kind: "series",
        name: next.title,
        logo: next.logo || h.logo,
        url: next.url,
        position: resumable ? earlier!.position : 0,
        duration: resumable ? earlier!.duration : 0,
        series_id: h.series_id,
        updated_at: h.updated_at,
        nextUp: true,
        episodeLabel: label(next),
      });
      continue;
    }

    if (!finished) entries.push(h);
  }

  return { entries, missingSeries };
}
