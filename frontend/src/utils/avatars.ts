import { createAvatar } from "@dicebear/core";
import * as avataaars from "@dicebear/avataaars";
import * as bottts from "@dicebear/bottts";
import * as lorelei from "@dicebear/lorelei";
import * as notionists from "@dicebear/notionists";
import * as openPeeps from "@dicebear/open-peeps";
import * as pixelArt from "@dicebear/pixel-art";
import * as thumbs from "@dicebear/thumbs";

// Cartoon profile avatars generated on-device with DiceBear (no network, no
// stored images): a profile stores "dicebear:<style>:<seed>" and the SVG is
// rebuilt from that. Only styles that need no attribution are included:
// Avataaars & Bottts (Pablo Stanley, free for personal and commercial use);
// Lorelei, Notionists, Open Peeps, Pixel Art, Thumbs (CC0 1.0).

export const AVATAR_STYLES = [
  { id: "avataaars", label: "Çizgi Film", style: avataaars },
  { id: "bottts", label: "Robot", style: bottts },
  { id: "lorelei", label: "Portre", style: lorelei },
  { id: "openPeeps", label: "El Çizimi", style: openPeeps },
  { id: "notionists", label: "Eskiz", style: notionists },
  { id: "pixelArt", label: "Piksel", style: pixelArt },
  { id: "thumbs", label: "Sevimli", style: thumbs },
] as const;

export type AvatarStyleId = (typeof AVATAR_STYLES)[number]["id"];

/** Fixed seeds so every style shows a stable, varied first page. */
export const AVATAR_SEEDS = [
  "Aslan", "Bulut", "Ceren", "Deniz", "Ekin", "Fırat", "Gece", "Hazal", "Irmak",
  "Kaan", "Lale", "Mert", "Nehir", "Onur", "Poyraz", "Rüya", "Selin", "Tuna",
];

const PREFIX = "dicebear:";

export function isGeneratedAvatar(avatar?: string | null) {
  return !!avatar && avatar.startsWith(PREFIX);
}

export function makeAvatarId(styleId: AvatarStyleId, seed: string) {
  return `${PREFIX}${styleId}:${seed}`;
}

export function parseAvatarId(avatar?: string | null): { styleId: AvatarStyleId; seed: string } | null {
  if (!isGeneratedAvatar(avatar)) return null;
  const rest = avatar!.slice(PREFIX.length);
  const i = rest.indexOf(":");
  if (i < 0) return null;
  const styleId = rest.slice(0, i) as AvatarStyleId;
  if (!AVATAR_STYLES.some((s) => s.id === styleId)) return null;
  return { styleId, seed: rest.slice(i + 1) };
}

export function randomSeed() {
  return Math.random().toString(36).slice(2, 10);
}

export function randomAvatarId(styleId: AvatarStyleId = "avataaars") {
  return makeAvatarId(styleId, randomSeed());
}

const uriCache = new Map<string, string>();

function toBase64(svg: string) {
  // btoa only takes Latin-1; encode UTF-8 first so any non-ASCII survives.
  const bytes = encodeURIComponent(svg).replace(/%([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  return btoa(bytes);
}

/** data: URI for a generated avatar, or null if `avatar` isn't one. Memoized. */
export function generatedAvatarUri(avatar?: string | null): string | null {
  const parsed = parseAvatarId(avatar);
  if (!parsed) return null;
  const hit = uriCache.get(avatar!);
  if (hit) return hit;
  const style = AVATAR_STYLES.find((s) => s.id === parsed.styleId)!.style;
  const svg = createAvatar(style as any, { seed: parsed.seed }).toString();
  let uri: string;
  try {
    // base64 is the most portable form for native image decoders.
    uri = `data:image/svg+xml;base64,${toBase64(svg)}`;
  } catch {
    uri = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }
  uriCache.set(avatar!, uri);
  return uri;
}
