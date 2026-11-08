import { Platform } from "react-native";
import { radius } from "@/src/theme/tokens";

// Shared "frosted glass" panel look (Stremio's floating menus): blurred
// background, rounded corners, soft shadow. Reused by MoreMenu, TracksPanel
// and ChannelsDrawer so they read as one family of floating surfaces.
export const glassPanel = {
  blurIntensity: 80,
  blurTint: "dark" as const,
  borderRadius: radius.lg,
  borderWidth: 1,
  borderColor: "rgba(255,255,255,0.12)",
  backgroundColor: "rgba(14,14,18,0.55)",
  ...Platform.select({
    web: { boxShadow: "0 20px 45px rgba(0,0,0,0.45)" } as any,
    default: {
      shadowColor: "#000",
      shadowOpacity: 0.45,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 8 },
      elevation: 12,
    },
  }),
};

// Gradient fade used behind the top/bottom bars instead of a solid overlay,
// so more of the video stays visible when controls are shown.
export const TOP_GRADIENT = ["rgba(0,0,0,0.55)", "rgba(0,0,0,0)"] as const;
export const BOTTOM_GRADIENT = ["rgba(0,0,0,0)", "rgba(0,0,0,0.6)"] as const;
// TV: darker and taller, so seek bar, transport and the action row read as one panel
// even when a widescreen film's letterbox puts half of them on black.
export const BOTTOM_GRADIENT_TV = ["rgba(0,0,0,0)", "rgba(0,0,0,0.75)", "rgba(0,0,0,0.92)"] as const;
