import type { Channel } from "@/src/types/iptv";

// One shared collator. On Hermes/Android every localeCompare(b, "tr", ...) call builds a
// new ICU collator through JNI; sorting a few hundred groups that way took ~1s on a TV box.
const TR_COLLATOR = new Intl.Collator("tr", { sensitivity: "base" });

const TR_FOLD: Record<string, string> = { ı: "i", İ: "i", ş: "s", ğ: "g", ü: "u", ö: "o", ç: "c" };

/** Lowercase + fold Turkish chars for matching (single pass: this runs per channel). */
export function normText(name: string): string {
  return name.toLowerCase().replace(/[ıİşğüöç]/g, (ch) => TR_FOLD[ch]);
}

/** Strip IPTV provider decoration (stars, arrows, flags). */
function stripDecorations(name: string): string {
  return name
    .replace(/[\u{1F1E6}-\u{1F1FF}★☆✦➾▶►●◆◇•|]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const ADULT_KEYWORDS = [
  "adult",
  "xxx",
  "+18",
  "18+",
  "erotic",
  "erotik",
  "porn",
  "sex",
  "yetiskin",
  "for adult",
  "mature",
];

const TR_GROUP_KEYWORDS = [
  "turkiye",
  "turk",
  "turkey",
  "türk",
  "türkiye",
  "ulusal",
  "yerli",
  "kanallari",
  "kanalları",
  "national tr",
];

const TR_MAIN_KEYWORDS = [
  "ulusal",
  "ulke",
  "genel",
  "haber",
  "spor",
  "sinema",
  "cocuk",
  "belgesel",
  "muzik",
];

/** Backup / codec duplicate lines (Türkiye Free, H65…) — not for top. */
const TR_LOW_PRIORITY_KEYWORDS = [
  "free",
  "h65",
  "h265",
  "h266",
  "hevc",
  "backup",
  "yedek",
  "alt yayin",
  "2nd",
  "duplicate",
  "test",
];

const TR_CHANNEL_HINTS = [
  "trt",
  "atv",
  "show tv",
  "star tv",
  "kanal d",
  "fox tr",
  "tv8",
  "teve2",
  "beyaz tv",
  "haberturk",
  "ntv",
  "cnn turk",
  "a haber",
  "kanal 7",
  "now tv tr",
  "euro d",
  "360 tv",
  "ulke tv",
];

export function isAdultGroup(name: string): boolean {
  const n = normText(stripDecorations(name));
  return ADULT_KEYWORDS.some((kw) => n.includes(normText(kw)));
}

export function isLowPriorityTrGroup(name: string): boolean {
  const n = normText(stripDecorations(name));
  return TR_LOW_PRIORITY_KEYWORDS.some((kw) => n.includes(normText(kw)));
}

// Every per-channel check folded into one precompiled regex - this runs once per
// channel (thousands) when ranking live groups, on slow 32-bit TV CPUs.
const TR_CHANNEL_RE = new RegExp(
  [
    "^tr$",
    "\\btr[\\s.:|\\-/]", // also covers ^tr<sep>
    " turk",
    "^turk",
    "turkiye",
    "turkey",
    ...TR_CHANNEL_HINTS.map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  ].join("|"),
);

export function channelLooksTurkish(channelName: string): boolean {
  return TR_CHANNEL_RE.test(normText(stripDecorations(channelName)));
}

/** Score from category title alone. */
export function turkishGroupScore(name: string): number {
  if (isLowPriorityTrGroup(name)) return 0;

  const n = normText(stripDecorations(name));
  let score = 0;

  for (const kw of TR_GROUP_KEYWORDS) {
    if (n.includes(normText(kw))) score += 15;
  }
  for (const kw of TR_MAIN_KEYWORDS) {
    if (n.includes(normText(kw))) score += 25;
  }
  if (/^tr[\s.:|\-/]/.test(n) || n.startsWith("tr ")) score += 40;
  if (/\btr\b/.test(n)) score += 25;
  if (n === "tr" || n.endsWith(" tr")) score += 30;

  return score;
}

type GroupRank = { tier: number; score: number; name: string };

type GroupCounts = Map<string, { total: number; tr: number }>;

/** One pass over the channels: per-group channel count and Turkish-looking count. */
function countByGroup(channels: Channel[]): GroupCounts {
  const counts: GroupCounts = new Map();
  for (const c of channels) {
    const g = c.group || "";
    let e = counts.get(g);
    if (!e) counts.set(g, (e = { total: 0, tr: 0 }));
    e.total += 1;
    if (channelLooksTurkish(c.name)) e.tr += 1;
  }
  return counts;
}

function rankLiveGroup(name: string, counts: GroupCounts): GroupRank {
  if (isAdultGroup(name)) {
    return { tier: 2, score: 0, name };
  }

  if (isLowPriorityTrGroup(name)) {
    return { tier: 1, score: 50, name };
  }

  const titleScore = turkishGroupScore(name);
  const e = counts.get(name);
  const trRatio = e && e.total ? e.tr / e.total : 0;
  const channelScore = Math.round(trRatio * 120);
  const total = titleScore + channelScore;

  if (total >= 30 || trRatio >= 0.35) {
    return { tier: 0, score: -total, name };
  }

  return { tier: 1, score: -Math.round(trRatio * 100), name };
}

function compareRanks(a: GroupRank, b: GroupRank): number {
  if (a.tier !== b.tier) return a.tier - b.tier;
  if (a.score !== b.score) return a.score - b.score;
  return TR_COLLATOR.compare(a.name, b.name);
}

/** Live TV: main TR → others → Free/H65 → adult last.
 *
 * Ranks are computed once per group from a single pass over the channels. This used to
 * rank inside the sort comparator - re-scanning every channel with the regex-heavy
 * channelLooksTurkish on each comparison - which took ~7s on a 32-bit TV box with a
 * 4k-channel list and made opening Live TV hang. */
const liveSortCache = new WeakMap<Channel[], { groups: string[]; sorted: string[] }>();

export function sortLiveGroups(groups: string[], channels: Channel[]): string[] {
  // Same playlist object -> same answer: reopening Live TV (or the desktop view) is free.
  const hit = liveSortCache.get(channels);
  if (hit && hit.groups === groups) return hit.sorted;
  const counts = countByGroup(channels);
  const ranks = new Map(groups.map((g) => [g, rankLiveGroup(g, counts)]));
  const sorted = [...groups].sort((a, b) => compareRanks(ranks.get(a)!, ranks.get(b)!));
  liveSortCache.set(channels, { groups, sorted });
  return sorted;
}

export function firstTurkishLiveGroup(groups: string[], channels: Channel[]): string | undefined {
  const counts = countByGroup(channels);
  const sorted = sortLiveGroups(groups, channels);
  const picked = sorted.find((g) => {
    if (isAdultGroup(g) || isLowPriorityTrGroup(g)) return false;
    return rankLiveGroup(g, counts).tier === 0;
  });
  if (picked) return picked;

  let best: { name: string; count: number } | null = null;
  for (const g of groups) {
    if (isAdultGroup(g) || isLowPriorityTrGroup(g)) continue;
    const trCount = counts.get(g)?.tr ?? 0;
    if (trCount > 0 && (!best || trCount > best.count)) {
      best = { name: g, count: trCount };
    }
  }
  return best?.name;
}

/** Movies / series — title-based TR sort, adult last. */
export function sortContentGroups(groups: string[]): string[] {
  // Precompute each group's keys once instead of re-deriving them in every comparison.
  const keys = new Map(
    groups.map((g) => [g, { adult: isAdultGroup(g), low: isLowPriorityTrGroup(g), score: turkishGroupScore(g) }]),
  );
  return [...groups].sort((a, b) => {
    const ka = keys.get(a)!;
    const kb = keys.get(b)!;
    if (ka.adult !== kb.adult) return ka.adult ? 1 : -1;
    if (ka.low !== kb.low) return ka.low ? 1 : -1;
    const diff = kb.score - ka.score;
    if (diff !== 0) return diff;
    return TR_COLLATOR.compare(a, b);
  });
}
