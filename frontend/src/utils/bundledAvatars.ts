// 3D cartoon profile pictures bundled with the app (same set as SafeSnap's avatars).
// A profile stores "asset3d:<id>"; unlike DiceBear avatars these are fixed images,
// so the picker shows the whole set instead of shuffling seeds.
// Metro needs static require() paths, hence the explicit list.

export const BUNDLED_AVATARS = [
  { id: "boy_01", source: require("../../assets/avatars/3d/boy_01.png") },
  { id: "girl_01", source: require("../../assets/avatars/3d/girl_01.png") },
  { id: "boy_02", source: require("../../assets/avatars/3d/boy_02.png") },
  { id: "girl_02", source: require("../../assets/avatars/3d/girl_02.png") },
  { id: "boy_03", source: require("../../assets/avatars/3d/boy_03.png") },
  { id: "girl_03", source: require("../../assets/avatars/3d/girl_03.png") },
  { id: "boy_04", source: require("../../assets/avatars/3d/boy_04.png") },
  { id: "girl_04", source: require("../../assets/avatars/3d/girl_04.png") },
  { id: "boy_05", source: require("../../assets/avatars/3d/boy_05.png") },
  { id: "girl_05", source: require("../../assets/avatars/3d/girl_05.png") },
  { id: "boy_06", source: require("../../assets/avatars/3d/boy_06.png") },
  { id: "girl_06", source: require("../../assets/avatars/3d/girl_06.png") },
  { id: "boy_07", source: require("../../assets/avatars/3d/boy_07.png") },
  { id: "girl_07", source: require("../../assets/avatars/3d/girl_07.png") },
  { id: "boy_08", source: require("../../assets/avatars/3d/boy_08.png") },
  { id: "girl_08", source: require("../../assets/avatars/3d/girl_08.png") },
  { id: "boy_09", source: require("../../assets/avatars/3d/boy_09.png") },
  { id: "girl_09", source: require("../../assets/avatars/3d/girl_09.png") },
  { id: "boy_10", source: require("../../assets/avatars/3d/boy_10.png") },
  { id: "girl_10", source: require("../../assets/avatars/3d/girl_10.png") },
  { id: "boy_11", source: require("../../assets/avatars/3d/boy_11.png") },
  { id: "girl_11", source: require("../../assets/avatars/3d/girl_11.png") },
  { id: "boy_12", source: require("../../assets/avatars/3d/boy_12.png") },
  { id: "girl_12", source: require("../../assets/avatars/3d/girl_12.png") },
  { id: "boy_13", source: require("../../assets/avatars/3d/boy_13.png") },
  { id: "girl_13", source: require("../../assets/avatars/3d/girl_13.png") },
  { id: "boy_14", source: require("../../assets/avatars/3d/boy_14.png") },
  { id: "girl_14", source: require("../../assets/avatars/3d/girl_14.png") },
  { id: "boy_15", source: require("../../assets/avatars/3d/boy_15.png") },
  { id: "girl_15", source: require("../../assets/avatars/3d/girl_15.png") },
  { id: "boy_16", source: require("../../assets/avatars/3d/boy_16.png") },
  { id: "girl_16", source: require("../../assets/avatars/3d/girl_16.png") },
  { id: "boy_17", source: require("../../assets/avatars/3d/boy_17.png") },
  { id: "girl_17", source: require("../../assets/avatars/3d/girl_17.png") },
  { id: "boy_18", source: require("../../assets/avatars/3d/boy_18.png") },
  { id: "girl_18", source: require("../../assets/avatars/3d/girl_18.png") },
  { id: "boy_19", source: require("../../assets/avatars/3d/boy_19.png") },
  { id: "girl_19", source: require("../../assets/avatars/3d/girl_19.png") },
  { id: "boy_20", source: require("../../assets/avatars/3d/boy_20.png") },
  { id: "girl_20", source: require("../../assets/avatars/3d/girl_20.png") },
] as const;

const PREFIX = "asset3d:";

export function isBundledAvatar(avatar?: string | null) {
  return !!avatar && avatar.startsWith(PREFIX);
}

export function makeBundledAvatarId(id: string) {
  return `${PREFIX}${id}`;
}

/** require()'d image for a bundled avatar, or null if `avatar` isn't one (or is unknown). */
export function bundledAvatarSource(avatar?: string | null): number | null {
  if (!isBundledAvatar(avatar)) return null;
  const id = avatar!.slice(PREFIX.length);
  return BUNDLED_AVATARS.find((a) => a.id === id)?.source ?? null;
}
