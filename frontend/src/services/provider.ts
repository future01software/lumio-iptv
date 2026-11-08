// Single entry point for playlist/provider data. Native builds (Android, TV,
// iOS) do everything on-device via local-provider.ts; the desktop/web build
// goes through the backend (browser CORS, HLS proxying, logo enrichment).

import { API, USE_LOCAL_PROVIDER } from "@/src/services/backend";
import * as local from "@/src/services/local-provider";
import type { EPGProgram, ParsedPlaylist, PlaylistConfig, SeriesEpisode } from "@/src/types/iptv";

async function postJson(path: string, body: unknown, fallbackError: string) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: fallbackError }));
    throw new Error(err.detail || fallbackError);
  }
  return res.json();
}

/** Channels (and, for M3U, movies/series too). Xtream VODs come from fetchVods. */
export async function fetchPlaylist(cfg: PlaylistConfig): Promise<ParsedPlaylist> {
  if (USE_LOCAL_PROVIDER) return local.parsePlaylist(cfg);
  return postJson("/playlist/parse", cfg, "Çalma listesi yüklenemedi");
}

export async function fetchVods(cfg: PlaylistConfig): Promise<ParsedPlaylist> {
  if (USE_LOCAL_PROVIDER) return local.loadVods(cfg);
  return postJson("/playlist/vods", cfg, "Film ve diziler yüklenemedi");
}

export async function fetchSeriesEpisodes(cfg: PlaylistConfig, seriesId: string): Promise<SeriesEpisode[]> {
  if (!cfg.server || !cfg.username || !cfg.password) return [];
  if (USE_LOCAL_PROVIDER) return local.seriesEpisodes(cfg, seriesId);
  // Credentials in the POST body, not the URL (URLs end up in logs).
  const data = await postJson(
    "/xtream/series-info",
    { server: cfg.server, username: cfg.username, password: cfg.password, series_id: seriesId },
    "Bölümler yüklenemedi",
  );
  return data.episodes || [];
}

export async function fetchEpgPrograms(epgUrl: string, channelIds?: Set<string>): Promise<EPGProgram[]> {
  if (USE_LOCAL_PROVIDER) return local.fetchEpg(epgUrl, channelIds);
  // The Xtream EPG URL embeds the password: body, not query.
  const data = await postJson("/epg/fetch", { epg_url: epgUrl }, "Yayın akışı alınamadı");
  return data.programs || [];
}

export async function fetchCatchupUrl(cfg: PlaylistConfig, streamId: string, startIso: string, durationMin: number) {
  if (USE_LOCAL_PROVIDER) return local.catchupUrl(cfg, streamId, startIso, durationMin);
  const data = await postJson(
    "/catchup/url",
    { server: cfg.server, username: cfg.username, password: cfg.password, stream_id: streamId, start: startIso, duration: durationMin },
    "Geriye dönük izleme kullanılamıyor",
  );
  return data.url as string;
}
