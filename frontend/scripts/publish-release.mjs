#!/usr/bin/env node
// Publishes a built release to the public update channel (future01software/lumio-releases).
//
//   node scripts/publish-release.mjs --notes "What's new..." [--dry-run]
//
// Expects `npm run build:msi` and `gradlew assembleRelease` to have run. Copies the
// installers to release/ with their public names, writes latest.json (version,
// notes, download URLs, SHA-256 + MD5) and creates the GitHub release with gh.
// Installed apps read latest.json to find and verify updates.
//
// If the release already exists (the Mac DMG is published first from build-mac.sh),
// the installers are added to it and its latest.json is merged, keeping the "mac" entry.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "future01software/lumio-releases";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const notesIdx = args.indexOf("--notes");
const notes = notesIdx >= 0 ? args[notesIdx + 1] : "";

const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
const appJsonVersion = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8")).expo.version;
if (appJsonVersion !== version) throw new Error(`package.json (${version}) and app.json (${appJsonVersion}) versions differ`);
const gradle = fs.readFileSync(path.join(root, "android/app/build.gradle"), "utf8");
if (!gradle.includes(`versionName "${version}"`)) throw new Error(`android versionName is not ${version}`);

// The desktop installer must carry a web bundle built from this version's app.json
// (a stale Metro cache once shipped 1.1.1 with "1.1.0" baked into the bundle).
const webJs = fs.readdirSync(path.join(root, "dist/_expo/static/js/web")).filter((f) => f.startsWith("entry-"));
if (!webJs.some((f) => fs.readFileSync(path.join(root, "dist/_expo/static/js/web", f), "utf8").includes(`\\"version\\":\\"${version}\\"`))) {
  throw new Error(`dist/ web bundle doesn't embed version ${version}; rebuild with npm run build:msi`);
}

const outDir = path.join(root, "release", `v${version}`);
fs.mkdirSync(outDir, { recursive: true });
const baseUrl = `https://github.com/${REPO}/releases/download/v${version}`;

function digest(file, algo) {
  return createHash(algo).update(fs.readFileSync(file)).digest("hex");
}
function stage(src, name) {
  if (!fs.existsSync(src)) throw new Error(`Missing build output: ${src}`);
  const dest = path.join(outDir, name);
  fs.copyFileSync(src, dest);
  return { file: dest, url: `${baseUrl}/${name}`, sha256: digest(dest, "sha256"), md5: digest(dest, "md5"), size: fs.statSync(dest).size };
}

const apkDir = path.join(root, "android/app/build/outputs/apk/release");
const msi = stage(path.join(root, "release", `Lumio IPTV ${version}.msi`), `Lumio-IPTV-${version}.msi`);
const apks = Object.fromEntries(
  ["arm64-v8a", "armeabi-v7a", "universal"].map((abi) => [abi, stage(path.join(apkDir, `app-${abi}-release.apk`), `Lumio-IPTV-${version}-${abi}.apk`)]),
);

const tag = `v${version}`;
let existing = null;
try {
  execFileSync("gh", ["release", "view", tag, "-R", REPO], { stdio: "ignore" });
  const tmp = fs.mkdtempSync(path.join(outDir, "existing-"));
  execFileSync("gh", ["release", "download", tag, "-R", REPO, "-p", "latest.json", "-D", tmp], { stdio: "inherit" });
  existing = JSON.parse(fs.readFileSync(path.join(tmp, "latest.json"), "utf8"));
  fs.rmSync(tmp, { recursive: true, force: true });
  if (existing.version !== version) throw new Error(`${tag} latest.json says ${existing.version}`);
} catch (err) {
  if (err instanceof Error && /latest\.json says/.test(err.message)) throw err;
  existing = null; // no such release yet
}

const strip = ({ file, ...rest }) => rest;
const manifest = {
  ...(existing || {}),
  version,
  date: existing?.date || new Date().toISOString(),
  notes: notes || existing?.notes || "",
  windows: strip(msi),
  android: Object.fromEntries(Object.entries(apks).map(([abi, a]) => [abi, strip(a)])),
};
const manifestPath = path.join(outDir, "latest.json");
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`Staged in ${outDir}`);
console.log(JSON.stringify(manifest, null, 2));

if (dryRun) process.exit(0);
const files = [msi.file, ...Object.values(apks).map((a) => a.file), manifestPath];
if (existing) {
  // Release already published for macOS: add the installers, replace latest.json.
  execFileSync("gh", ["release", "upload", tag, "-R", REPO, "--clobber", ...files], { stdio: "inherit" });
} else {
  execFileSync("gh", ["release", "create", tag, "-R", REPO, "--title", `Lumio IPTV ${version}`, "--notes", notes || `Lumio IPTV ${version}`, ...files], {
    stdio: "inherit",
  });
}
console.log(`Published https://github.com/${REPO}/releases/tag/v${version}`);
