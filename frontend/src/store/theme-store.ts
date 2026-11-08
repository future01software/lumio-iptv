import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { colors } from "@/src/theme/tokens";

type ThemeState = {
  accentColor: string;
  setAccentColor: (color: string) => Promise<void>;
  init: () => Promise<void>;
};

export const useTheme = create<ThemeState>((set) => ({
  accentColor: colors.brandPrimary,
  setAccentColor: async (color: string) => {
    await AsyncStorage.setItem("iptv.accent.v1", color);
    set({ accentColor: color });
  },
  init: async () => {
    const saved = await AsyncStorage.getItem("iptv.accent.v1");
    if (saved) {
      set({ accentColor: saved });
    }
  },
}));
