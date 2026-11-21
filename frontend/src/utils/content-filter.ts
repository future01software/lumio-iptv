import type { Channel, Movie, Series, ParsedPlaylist } from "@/src/types/iptv";

/**
 * Returns true if the item matches any blocked keyword.
 * Matches against the item's name and group (case-insensitive).
 */
export function isBlocked(item: { name: string; group?: string | null }, blocked: string[]) {
  if (!blocked?.length) return false;
  const haystack = `${item.name} ${item.group || ""}`.toLowerCase();
  for (const kw of blocked) {
    if (!kw) continue;
    if (haystack.includes(kw.toLowerCase())) return true;
  }
  return false;
}

export function filterChannels(list: Channel[], blocked: string[]) {
  if (!blocked?.length) return list;
  return list.filter((c) => !isBlocked(c, blocked));
}
export function filterMovies(list: Movie[], blocked: string[]) {
  if (!blocked?.length) return list;
  return list.filter((m) => !isBlocked(m, blocked));
}
export function filterSeries(list: Series[], blocked: string[]) {
  if (!blocked?.length) return list;
  return list.filter((s) => !isBlocked(s, blocked));
}

const ADULT_GROUP_RE = /adult|xxx|18\+|yetişkin|yetiskin/i;
// Names alone are only trusted for unambiguous words ("Adult Swim" or "Sex Education"
// must not disappear), so plain "adult"/"sex" in a title doesn't count.
const ADULT_NAME_RE = /xxx|porn|\b18\+|\+18\b|erotik|erotic|playboy|brazzers|hustler|\badults? \d/i;

/** True when an item's category or name marks it as adult content. */
export function looksAdult(name?: string | null, group?: string | null): boolean {
  return (!!group && ADULT_GROUP_RE.test(group)) || (!!name && ADULT_NAME_RE.test(name));
}

/**
 * Strips channels/movies/series/groups whose group name looks adult-flagged
 * ("adult", "xxx", "18+"). Used both at playlist-load time and when the
 * "Hide Adult Content" setting is toggled live on an already-loaded playlist.
 */
export function filterAdultContent(parsed: ParsedPlaylist): ParsedPlaylist {
  const isAdultGroup = (g: string | null | undefined) => !!g && ADULT_GROUP_RE.test(g);
  const filtered: ParsedPlaylist = {
    ...parsed,
    channels: parsed.channels.filter((c) => !looksAdult(c.name, c.group)),
    movies: parsed.movies.filter((m) => !looksAdult(m.name, m.group)),
    series: parsed.series.filter((s) => !looksAdult(s.name, s.group)),
  };
  if (parsed.groups) {
    filtered.groups = {
      live: (parsed.groups.live || []).filter((g) => !isAdultGroup(g)),
      movie: (parsed.groups.movie || []).filter((g) => !isAdultGroup(g)),
      series: (parsed.groups.series || []).filter((g) => !isAdultGroup(g)),
    };
  }
  return filtered;
}
