import { Platform } from "react-native";

export const colors = {
  surface: "#000000",
  onSurface: "#FFFFFF",
  surfaceSecondary: "#1A1A1A",
  onSurfaceSecondary: "#EBEBEB",
  surfaceTertiary: "#262626",
  onSurfaceTertiary: "#D4D4D4",
  brand: "#E50914",
  brandPrimary: "#E50914",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#B20710",
  brandTertiary: "#400305",
  success: "#32D74B",
  warning: "#FFD60A",
  error: "#FF453A",
  info: "#0A84FF",
  border: "#262626",
  borderStrong: "#333333",
  divider: "#1A1A1A",
  textMuted: "#9CA3AF",
};

/**
 * Background for full-screen containers. On Android the stack card (app/_layout.tsx) is
 * the one opaque black layer; every nested full-screen view that also painted black made
 * the GPU fill the whole screen again (measured 4-6x overdraw on a TV box, ~half of each
 * frame's GPU time). Web keeps explicit backgrounds.
 */
export const screenBackground = Platform.OS === "web" ? colors.surface : "transparent";

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
};

export const radius = {
  sm: 6,
  md: 12,
  lg: 20,
  pill: 999,
};

export const font = {
  sm: 12,
  base: 14,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
};

export const DEMO_PLAYLIST = {
  name: "Free Demo IPTV",
  type: "m3u" as const,
  m3u_url: "https://iptv-org.github.io/iptv/index.m3u",
  // PlutoTV EPG works as a public XMLTV demo (iptv-org's tr.xml was removed)
  epg_url: "https://i.mjh.nz/PlutoTV/all.xml",
};
