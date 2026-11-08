import * as FileSystem from "expo-file-system/legacy";

/**
 * HLS (.m3u8) offline downloader.
 *
 * Strategy:
 *  1. Fetch the master/variant playlist.
 *  2. If master, pick the highest-bandwidth variant.
 *  3. Download every TS segment sequentially with resume support
 *     (skip any segment already on disk).
 *  4. Rewrite the manifest, replacing each segment URI with a
 *     local file URI under the same folder.
 *  5. Save the rewritten manifest as `index.m3u8` so expo-video / AVPlayer
 *     can play the local copy offline.
 *
 * Limitations:
 *  - VOD only (live streams have rotating segments and infinite manifests).
 *  - No encryption-key handling (most public IPTV HLS streams are clear).
 *  - No multi-renditions audio tracks — single video variant only.
 */

export type HLSProgress = {
  total: number;
  done: number;
  bytes: number;
  status: "preparing" | "downloading" | "paused" | "completed" | "failed";
};

export async function downloadHLS(opts: {
  id: string;
  manifestUrl: string;
  baseDir: string;             // absolute path ending in `/`
  onProgress?: (p: HLSProgress) => void;
  shouldCancel?: () => boolean;  // polled before each segment for pause/cancel
}): Promise<{ localManifestUri: string; segmentCount: number } | null> {
  const { id, manifestUrl, baseDir, onProgress, shouldCancel } = opts;
  const folder = `${baseDir}hls_${id}/`;
  await ensureDir(folder);

  onProgress?.({ total: 0, done: 0, bytes: 0, status: "preparing" });

  // 1. Fetch top-level playlist
  let manifestText = await (await fetch(manifestUrl)).text();
  let variantUrl = manifestUrl;

  // 2. If master, pick highest bandwidth variant
  if (manifestText.includes("#EXT-X-STREAM-INF")) {
    const variants = parseVariants(manifestText, manifestUrl);
    if (!variants.length) return null;
    variants.sort((a, b) => b.bandwidth - a.bandwidth);
    variantUrl = variants[0].url;
    manifestText = await (await fetch(variantUrl)).text();
  }

  // 3. Resolve absolute segment URLs
  const segments = parseSegments(manifestText, variantUrl);
  if (!segments.length) return null;

  let bytes = 0;
  for (let i = 0; i < segments.length; i++) {
    if (shouldCancel?.()) {
      onProgress?.({ total: segments.length, done: i, bytes, status: "paused" });
      return null;
    }
    const seg = segments[i];
    const localPath = `${folder}seg_${String(i).padStart(5, "0")}.ts`;
    const exists = await FileSystem.getInfoAsync(localPath);
    if (!exists.exists) {
      try {
        const res = await FileSystem.downloadAsync(seg.url, localPath);
        const info = await FileSystem.getInfoAsync(res.uri);
        bytes += (info as any).size || 0;
      } catch {
        onProgress?.({ total: segments.length, done: i, bytes, status: "failed" });
        return null;
      }
    } else {
      bytes += (exists as any).size || 0;
    }
    seg.localUri = localPath;
    onProgress?.({ total: segments.length, done: i + 1, bytes, status: "downloading" });
  }

  // 4. Rewrite manifest with local file:// URIs
  const lines = manifestText.split(/\r?\n/);
  let segIdx = 0;
  const rewritten = lines.map((line) => {
    if (!line || line.startsWith("#")) return line;
    const local = segments[segIdx]?.localUri;
    segIdx += 1;
    return local ?? line;
  }).join("\n");

  // 5. Save local manifest
  const localManifestUri = `${folder}index.m3u8`;
  await FileSystem.writeAsStringAsync(localManifestUri, rewritten);

  onProgress?.({ total: segments.length, done: segments.length, bytes, status: "completed" });
  return { localManifestUri, segmentCount: segments.length };
}

export async function deleteHLS(opts: { id: string; baseDir: string }) {
  const folder = `${opts.baseDir}hls_${opts.id}/`;
  try {
    const info = await FileSystem.getInfoAsync(folder);
    if (info.exists) await FileSystem.deleteAsync(folder, { idempotent: true });
  } catch {}
}

async function ensureDir(path: string) {
  const info = await FileSystem.getInfoAsync(path);
  if (!info.exists) await FileSystem.makeDirectoryAsync(path, { intermediates: true });
}

function absolute(base: string, ref: string): string {
  if (/^https?:\/\//i.test(ref)) return ref;
  try {
    return new URL(ref, base).toString();
  } catch {
    return ref;
  }
}

function parseVariants(text: string, base: string) {
  const out: { bandwidth: number; url: string }[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("#EXT-X-STREAM-INF")) {
      const bw = /BANDWIDTH=(\d+)/.exec(lines[i])?.[1];
      const nextUrl = lines[i + 1]?.trim();
      if (nextUrl && !nextUrl.startsWith("#")) {
        out.push({ bandwidth: parseInt(bw || "0", 10), url: absolute(base, nextUrl) });
      }
    }
  }
  return out;
}

function parseSegments(text: string, base: string) {
  const segs: { url: string; localUri?: string }[] = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    segs.push({ url: absolute(base, trimmed) });
  }
  return segs;
}
