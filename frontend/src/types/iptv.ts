export type Channel = {
  id: string;
  name: string;
  logo?: string | null;
  group?: string | null;
  url: string;
  tvg_id?: string | null;
  epg_channel_id?: string | null;
  kind: "live";
  number?: string | null;
  catchup?: boolean;
  catchup_days?: number;
};

export type Movie = {
  id: string;
  name: string;
  logo?: string | null;
  group?: string | null;
  url: string;
  year?: string | null;
  rating?: string | null;
};

export type SeriesEpisode = {
  id: string;
  title: string;
  season: number;
  episode: number;
  url: string;
  logo?: string | null;
};

export type Series = {
  id: string;
  name: string;
  logo?: string | null;
  group?: string | null;
  episodes: SeriesEpisode[];
};

export type ParsedPlaylist = {
  name: string;
  channels: Channel[];
  movies: Movie[];
  series: Series[];
  groups: { live: string[]; movie: string[]; series: string[] };
};

export type PlaylistConfig = {
  name: string;
  type: "m3u" | "xtream";
  m3u_url?: string;
  m3u_content?: string;
  server?: string;
  username?: string;
  password?: string;
  epg_url?: string;
};

export type EPGProgram = {
  channel: string;
  title: string;
  desc?: string;
  start: string;
  stop: string;
};

export type FavoriteItem = {
  item_id: string;
  kind: "live" | "movie" | "series";
  name: string;
  logo?: string | null;
  url?: string | null;
};

export type HistoryItem = {
  item_id: string;
  kind: "live" | "movie" | "series";
  name: string;
  logo?: string | null;
  url?: string | null;
  position: number;
  duration: number;
  updated_at?: string;
  /** For kind "series": the show this episode belongs to (episodes panel / up-next). */
  series_id?: string;
};

/** User-curated folder of playlist items (movies/series/channels), manually assembled -
 * unlike favorites/watchlist (implicit single lists), a profile can have any number of these. */
export type Collection = {
  id: string;
  title: string;
  items: FavoriteItem[];
  createdAt: string;
};
