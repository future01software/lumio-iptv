// On-device playlist provider for native builds (Android / Android TV / iOS).
//
// Port of the backend's M3U / Xtream / XMLTV logic (backend/server.py) so the
// mobile/TV app is self-contained, like NuvioTV: no companion PC or server.
// Native fetch has no CORS restrictions, so the provider can be called
// directly. Stream URLs are the provider's own URLs (what the backend's
// /api/play redirect resolved to).
//
// The desktop/web build keeps using the backend (CORS, HLS proxying).

import type { EPGProgram, Movie, ParsedPlaylist, PlaylistConfig, Series, SeriesEpisode } from "@/src/types/iptv";

const USER_AGENT = "IPTVSmarters/1.0";

export class ProviderError extends Error {}

// ---------------------------------------------------------------- helpers ---

async function fetchText(url: string, timeoutMs = 30000): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: ctrl.signal });
    if (!res.ok) throw new ProviderError(`Sağlayıcı yanıt vermedi (HTTP ${res.status})`);
    return await res.text();
  } catch (e: any) {
    if (e instanceof ProviderError) throw e;
    throw new ProviderError(e?.name === "AbortError" ? "Sağlayıcı zaman aşımına uğradı" : "Sağlayıcıya bağlanılamadı");
  } finally {
    clearTimeout(timer);
  }
}

/** Stable id from a string (FNV-1a) so M3U items keep their id across refreshes. */
function stableId(input: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return "m" + (h >>> 0).toString(36) + input.length.toString(36);
}

/** Same cleanup the backend applied to user-entered Xtream server URLs. */
export function cleanServer(server: string) {
  let s = Array.from(server)
    .filter((c) => c.charCodeAt(0) > 32 && c.charCodeAt(0) < 127)
    .join("")
    .replace(/\/+$/, "");
  if (s.endsWith("/player_api.php")) s = s.slice(0, -"/player_api.php".length);
  if (s.endsWith("/get.php")) s = s.slice(0, -"/get.php".length);
  if (!/^https?:\/\//i.test(s)) s = "http://" + s;
  return s;
}

type Creds = { server: string; username: string; password: string };

function credsOf(cfg: PlaylistConfig): Creds {
  if (!cfg.server || !cfg.username || !cfg.password) throw new ProviderError("Sunucu, kullanıcı adı ve şifre gerekli");
  return { server: cleanServer(cfg.server), username: cfg.username.trim(), password: cfg.password.trim() };
}

async function xtreamGet(c: Creds, action?: string, extra?: Record<string, string>): Promise<any> {
  const params = new URLSearchParams({ username: c.username, password: c.password, ...(action ? { action } : {}), ...extra });
  const text = await fetchText(`${c.server}/player_api.php?${params}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new ProviderError("Sağlayıcıdan geçersiz yanıt geldi");
  }
}

const enc = encodeURIComponent;
const liveUrl = (c: Creds, id: string | number) => `${c.server}/live/${enc(c.username)}/${enc(c.password)}/${id}.m3u8`;
const movieUrl = (c: Creds, id: string | number, ext: string) =>
  `${c.server}/movie/${enc(c.username)}/${enc(c.password)}/${id}.${ext || "mp4"}`;
const seriesUrl = (c: Creds, id: string | number, ext: string) =>
  `${c.server}/series/${enc(c.username)}/${enc(c.password)}/${id}.${ext || "mp4"}`;

// ------------------------------------------------------------ group order ---
// Port of sort_content_groups: Turkish groups first, then the rest
// alphabetically, then low-priority (backup/HEVC/...) and finally adult groups.

const TR_GROUP_KEYWORDS = ["turkiye", "turk", "turkey", "türk", "türkiye", "ulusal", "yerli", "kanallari", "kanalları", "national tr"];
const ADULT_KEYWORDS = ["adult", "xxx", "+18", "18+", "erotic", "erotik", "porn", "sex", "yetiskin", "for adult", "mature"];
const LOW_PRIORITY_KEYWORDS = ["free", "h65", "h265", "h266", "hevc", "backup", "yedek", "alt yayin", "2nd", "duplicate", "test"];

function normGroup(name: string) {
  let n = name.toLowerCase();
  for (const [src, dst] of [["ı", "i"], ["ş", "s"], ["ğ", "g"], ["ü", "u"], ["ö", "o"], ["ç", "c"]]) n = n.split(src).join(dst);
  return n;
}
const stripDecorations = (name: string) => name.replace(/[★☆✦➾▶►●◆◇•|]/g, " ").trim();
const isAdultGroup = (g: string) => ADULT_KEYWORDS.some((kw) => normGroup(stripDecorations(g)).includes(kw));
const isLowPriorityGroup = (g: string) => LOW_PRIORITY_KEYWORDS.some((kw) => normGroup(stripDecorations(g)).includes(kw));

function turkishGroupScore(name: string) {
  if (isLowPriorityGroup(name)) return 0;
  const n = normGroup(stripDecorations(name));
  let score = 0;
  for (const kw of TR_GROUP_KEYWORDS) if (n.includes(normGroup(kw))) score += 15;
  if (/^tr[\s.:|\-/]/.test(n) || n.startsWith("tr ")) score += 40;
  if (/\btr\b/.test(n)) score += 25;
  if (n === "tr" || n.endsWith(" tr")) score += 30;
  return score;
}

export function sortContentGroups(groups: Iterable<string | null | undefined>): string[] {
  const items = Array.from(new Set(Array.from(groups).filter((g): g is string => !!g)));
  // Shared collator + scores computed once: per-comparison localeCompare/scoring is very
  // slow on Hermes/Android (each localeCompare builds an ICU collator).
  const collator = new Intl.Collator();
  const byName = (a: string, b: string) => collator.compare(a.toLowerCase(), b.toLowerCase());
  const adult = items.filter(isAdultGroup).sort(byName);
  const low = items.filter((g) => !isAdultGroup(g) && isLowPriorityGroup(g)).sort(byName);
  const regularItems = items.filter((g) => !isAdultGroup(g) && !isLowPriorityGroup(g));
  const scores = new Map(regularItems.map((g) => [g, turkishGroupScore(g)]));
  const regular = regularItems.sort((a, b) => scores.get(b)! - scores.get(a)! || byName(a, b));
  return [...regular, ...low, ...adult];
}

// ---------------------------------------------------------------- M3U -------

/**
 * Splits "#EXTINF:-1 attr="..." attr="...",Title" at the first comma *outside* quotes:
 * attribute values (e.g. http-user-agent="Mozilla/5.0 (KHTML, like Gecko) ...") contain
 * commas, and splitting at the first one turned channel names into "like Gecko) Chrome/...".
 */
function splitExtinf(line: string): { attrs: string; title: string } | null {
  let inQuote = false;
  for (let i = 8; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuote = !inQuote;
    else if (ch === "," && !inQuote) return { attrs: line.slice(8, i), title: line.slice(i + 1) };
  }
  return null;
}
const ATTR_RE = /(\S+?)="(.*?)"/g;
const SERIES_EP_RE = /S(\d+)\s*E(\d+)/i;

export function parseM3U(content: string): ParsedPlaylist {
  const channels: ParsedPlaylist["channels"] = [];
  const movies: Movie[] = [];
  const seriesMap = new Map<string, Series>();
  let attrs: Record<string, string> = {};
  let title = "";

  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("#EXTINF")) {
      const m = splitExtinf(line);
      if (m) {
        title = m.title.trim();
        attrs = {};
        for (const a of m.attrs.matchAll(ATTR_RE)) attrs[a[1].toLowerCase()] = a[2];
      }
      continue;
    }
    if (!line || line.startsWith("#")) continue;

    const url = line;
    const group = attrs["group-title"] || "Kategorisiz";
    const logo = attrs["tvg-logo"] || null;
    const tvgId = attrs["tvg-id"] || null;
    const name = title || "Adsız";
    const lowerGroup = group.toLowerCase();
    const lowerUrl = url.toLowerCase();
    const epMatch = SERIES_EP_RE.exec(name);
    const isSeries = !!epMatch || lowerGroup.includes("series");
    const isMovie =
      !isSeries &&
      (lowerGroup.includes("movie") || lowerGroup.includes("vod") || lowerGroup.includes("film") || /\.(mp4|mkv|avi)$/.test(lowerUrl));

    if (isSeries) {
      const season = epMatch ? parseInt(epMatch[1], 10) : 1;
      const episode = epMatch ? parseInt(epMatch[2], 10) : 1;
      const baseName = name.replace(/\s*S\d+\s*E\d+.*$/i, "").trim() || name;
      const sid = baseName.toLowerCase();
      let s = seriesMap.get(sid);
      if (!s) {
        s = { id: stableId("s:" + sid), name: baseName, logo, group, episodes: [] };
        seriesMap.set(sid, s);
      }
      s.episodes.push({ id: stableId("e:" + url), title: name, season, episode, url, logo });
    } else if (isMovie) {
      movies.push({ id: stableId("v:" + url), name, logo, group, url } as Movie);
    } else {
      const catchupAttr = attrs["catchup"];
      const days = parseInt(attrs["catchup-days"] || attrs["catchup-source-days"] || "0", 10);
      channels.push({
        id: stableId("c:" + url),
        name,
        logo,
        group,
        url,
        tvg_id: tvgId,
        epg_channel_id: tvgId,
        kind: "live",
        number: attrs["tvg-chno"] || null,
        catchup: !!catchupAttr && catchupAttr.toLowerCase() !== "0",
        catchup_days: isNaN(days) ? 0 : days,
      } as any);
    }
    attrs = {};
    title = "";
  }

  const series = Array.from(seriesMap.values());
  for (const s of series) s.episodes.sort((a, b) => a.season - b.season || a.episode - b.episode);
  return {
    name: "M3U Playlist",
    channels,
    movies,
    series,
    groups: {
      live: sortContentGroups(channels.map((c) => c.group)),
      movie: sortContentGroups(movies.map((m) => m.group)),
      series: sortContentGroups(series.map((s) => s.group)),
    },
  };
}

// -------------------------------------------------------------- Xtream -----

async function xtreamAuth(c: Creds) {
  const info = await xtreamGet(c);
  const auth = info?.user_info?.auth;
  if (!info?.user_info || auth === 0 || auth === "0") throw new ProviderError("Xtream kullanıcı adı veya şifre hatalı");
  return info;
}

function catMap(cats: any[]): Record<string, string> {
  const m: Record<string, string> = {};
  for (const c of cats || []) m[String(c.category_id)] = c.category_name;
  return m;
}

function xtreamVods(c: Creds, vodCats: any[], vodStreams: any[]): Movie[] {
  const cats = catMap(vodCats);
  return (vodStreams || []).map(
    (s) =>
      ({
        id: String(s.stream_id),
        name: s.name || "Adsız",
        logo: s.stream_icon || null,
        group: cats[String(s.category_id ?? "")] || "Kategorisiz",
        url: movieUrl(c, s.stream_id, s.container_extension),
        year: s.year ? String(s.year) : null,
        rating: s.rating ? String(s.rating) : null,
      }) as Movie,
  );
}

function xtreamSeries(serCats: any[], serStreams: any[]): Series[] {
  const cats = catMap(serCats);
  return (serStreams || []).map((s) => ({
    id: String(s.series_id),
    name: s.name || "Adsız",
    logo: s.cover || null,
    group: cats[String(s.category_id ?? "")] || "Kategorisiz",
    episodes: [],
  }));
}

/** Live channels only (VODs load separately in the background, like the backend). */
async function parseXtreamLive(cfg: PlaylistConfig): Promise<ParsedPlaylist> {
  const c = credsOf(cfg);
  await xtreamAuth(c);
  const [liveCats, liveStreams] = await Promise.all([xtreamGet(c, "get_live_categories"), xtreamGet(c, "get_live_streams")]);
  const cats = catMap(liveCats);
  const channels = (liveStreams || []).map((s: any) => ({
    id: String(s.stream_id),
    name: s.name || "Adsız",
    logo: s.stream_icon || null,
    group: cats[String(s.category_id ?? "")] || "Kategorisiz",
    url: liveUrl(c, s.stream_id),
    tvg_id: s.epg_channel_id || null,
    epg_channel_id: s.epg_channel_id || null,
    kind: "live",
    number: s.num != null ? String(s.num) : null,
    catchup: !!parseInt(String(s.tv_archive ?? 0), 10),
    catchup_days: parseInt(String(s.tv_archive_duration ?? 0), 10) || 0,
  }));
  return {
    name: "",
    channels,
    movies: [],
    series: [],
    groups: { live: sortContentGroups(channels.map((ch: any) => ch.group)), movie: [], series: [] },
  };
}

// -------------------------------------------------------------- public -----

export async function parsePlaylist(cfg: PlaylistConfig): Promise<ParsedPlaylist> {
  let parsed: ParsedPlaylist;
  if (cfg.type === "m3u") {
    let content = cfg.m3u_content;
    if (cfg.m3u_url && cfg.m3u_url !== "local_file") content = await fetchText(cfg.m3u_url.trim(), 60000);
    if (!content) throw new ProviderError("M3U adresi ya da dosyası gerekli");
    parsed = parseM3U(content);
  } else {
    parsed = await parseXtreamLive(cfg);
  }
  parsed.name = (cfg.name || "").trim();
  return parsed;
}

export async function loadVods(cfg: PlaylistConfig): Promise<ParsedPlaylist> {
  if (cfg.type !== "xtream") return { name: cfg.name || "", channels: [], movies: [], series: [], groups: {} as any };
  const c = credsOf(cfg);
  await xtreamAuth(c);
  const [vodCats, serCats, vodStreams, serStreams] = await Promise.all([
    xtreamGet(c, "get_vod_categories"),
    xtreamGet(c, "get_series_categories"),
    xtreamGet(c, "get_vod_streams"),
    xtreamGet(c, "get_series"),
  ]);
  const movies = xtreamVods(c, vodCats, vodStreams);
  const series = xtreamSeries(serCats, serStreams);
  return {
    name: cfg.name || "",
    channels: [],
    movies,
    series,
    groups: { movie: sortContentGroups(movies.map((m) => m.group)), series: sortContentGroups(series.map((s) => s.group)) } as any,
  };
}

export async function seriesEpisodes(cfg: PlaylistConfig, seriesId: string): Promise<SeriesEpisode[]> {
  const c = credsOf(cfg);
  const data = await xtreamGet(c, "get_series_info", { series_id: seriesId });
  const bySeason: Record<string, any[]> = data?.episodes || {};
  const eps: SeriesEpisode[] = [];
  for (const [seasonNum, list] of Object.entries(bySeason)) {
    for (const e of list || []) {
      eps.push({
        id: String(e.id),
        title: e.title || "Episode",
        season: parseInt(String(e.season ?? seasonNum), 10) || 1,
        episode: parseInt(String(e.episode_num ?? 1), 10) || 1,
        url: seriesUrl(c, e.id, e.container_extension),
        logo: e.info && typeof e.info === "object" ? e.info.movie_image || null : null,
      });
    }
  }
  return eps.sort((a, b) => a.season - b.season || a.episode - b.episode);
}

/** Xtream timeshift URL; `startIso` is UTC (same caveat as the backend). */
export function catchupUrl(cfg: PlaylistConfig, streamId: string, startIso: string, durationMin: number) {
  const c = credsOf(cfg);
  const d = new Date(startIso);
  const p = (n: number) => String(n).padStart(2, "0");
  const start = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}:${p(d.getUTCHours())}-${p(d.getUTCMinutes())}`;
  return `${c.server}/timeshift/${enc(c.username)}/${enc(c.password)}/${durationMin}/${start}/${streamId}.m3u8`;
}

// --------------------------------------------------------------- XMLTV -----

function xmltvTime(s: string) {
  // "20240101120000 +0000" -> ISO. Like the backend, the offset is ignored
  // (treated as UTC); the EPG shift setting compensates per provider.
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(s.trim());
  if (!m) return s;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+00:00`;
}

function decodeXml(s: string) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&amp;/g, "&");
}

const XML_ATTR_RE = /(\w+)="([^"]*)"/g;
const TITLE_RE = /<title\b[^>]*>([\s\S]*?)<\/title>/;
const DESC_RE = /<desc\b[^>]*>([\s\S]*?)<\/desc>/;

/** Hand the JS thread back to React every this many ms while parsing. */
const EPG_SLICE_MS = 12;
const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * XMLTV parse tuned for TV boxes: only programmes for known channels and from
 * a few hours ago up to ~2 days ahead are kept, capped like the backend
 * (50k), so a large provider guide doesn't balloon memory.
 *
 * Guides can be huge (the demo's PlutoTV guide is 63 MB / 71k programmes), so this
 * scans with indexOf instead of one big regex, skips the body of programmes for
 * channels we don't have, and yields to the UI every few ms - a single synchronous
 * pass froze the app (no taps, no navigation) for minutes on phones and TV boxes.
 */
export async function fetchEpg(epgUrl: string, channelIds?: Set<string>, limit = 50000): Promise<EPGProgram[]> {
  const xml = await fetchText(epgUrl, 90000);
  const from = Date.now() - 6 * 3600 * 1000;
  const to = Date.now() + 48 * 3600 * 1000;
  const out: EPGProgram[] = [];
  let pos = 0;
  let sliceStart = Date.now();
  for (;;) {
    const open = xml.indexOf("<programme", pos);
    if (open < 0) break;
    const tagEnd = xml.indexOf(">", open);
    if (tagEnd < 0) break;
    const close = xml.indexOf("</programme>", tagEnd);
    if (close < 0) break;
    pos = close + 12;

    if (Date.now() - sliceStart > EPG_SLICE_MS) {
      await yieldToUi();
      sliceStart = Date.now();
    }

    const tag = xml.slice(open + 10, tagEnd);
    const a: Record<string, string> = {};
    for (const at of tag.matchAll(XML_ATTR_RE)) a[at[1]] = at[2];
    const channel = a.channel || "";
    if (channelIds && !channelIds.has(channel)) continue;
    const start = xmltvTime(a.start || "");
    const stop = xmltvTime(a.stop || "");
    const stopMs = Date.parse(stop);
    const startMs = Date.parse(start);
    if (!isNaN(stopMs) && stopMs < from) continue;
    if (!isNaN(startMs) && startMs > to) continue;
    const body = xml.slice(tagEnd + 1, close);
    const t = TITLE_RE.exec(body);
    const d = DESC_RE.exec(body);
    out.push({ channel, title: t ? decodeXml(t[1]).trim() : "", desc: d ? decodeXml(d[1]).trim() : undefined, start, stop } as EPGProgram);
    if (out.length >= limit) break;
  }
  return out;
}
