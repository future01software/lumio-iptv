import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useIPTV } from "@/src/store/iptv-store";

export type BufferSize = "small" | "normal" | "large";

const STORAGE_KEY = "iptv.settings";

type State = {
  autoplay: boolean;
  resume: boolean;
  hwAccel: boolean;
  bufferSize: BufferSize;
  hideAdult: boolean;
  epgShift: number;
  /** Desktop/web player volume 0..1 and mute, remembered across sessions. */
  volume: number;
  muted: boolean;

  setAutoplay: (v: boolean) => void;
  setResume: (v: boolean) => void;
  setHwAccel: (v: boolean) => void;
  setBufferSize: (v: BufferSize) => void;
  setHideAdult: (v: boolean) => void;
  setEpgShift: (v: number) => void;
  setVolume: (v: number) => void;
  setMuted: (v: boolean) => void;
  init: () => Promise<void>;
};

function persist(state: State) {
  const { autoplay, resume, hwAccel, bufferSize, hideAdult, epgShift, volume, muted } = state;
  AsyncStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ autoplay, resume, hwAccel, bufferSize, hideAdult, epgShift, volume, muted }),
  ).catch(() => {});
}

export const usePlayerSettings = create<State>((set, get) => ({
  autoplay: true,
  resume: true,
  hwAccel: true,
  bufferSize: "normal",
  hideAdult: false,
  epgShift: 0,
  volume: 1,
  muted: false,

  setAutoplay: (v) => { set({ autoplay: v }); persist(get()); },
  setResume: (v) => { set({ resume: v }); persist(get()); },
  setHwAccel: (v) => { set({ hwAccel: v }); persist(get()); },
  setBufferSize: (v) => { set({ bufferSize: v }); persist(get()); },
  setHideAdult: (v) => {
    set({ hideAdult: v });
    persist(get());
    useIPTV.getState().applyAdultFilter(v);
  },
  setEpgShift: (v) => { set({ epgShift: v }); persist(get()); },
  // Raising the volume also unmutes, like every desktop player.
  setVolume: (v) => {
    const volume = Math.round(Math.min(1, Math.max(0, v)) * 100) / 100;
    set({ volume, muted: volume > 0 ? false : get().muted });
    persist(get());
  },
  setMuted: (v) => { set({ muted: v }); persist(get()); },

  init: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      set({
        autoplay: s.autoplay ?? true,
        resume: s.resume ?? true,
        hwAccel: s.hwAccel ?? true,
        bufferSize: s.bufferSize ?? "normal",
        hideAdult: s.hideAdult ?? false,
        epgShift: s.epgShift ?? 0,
        volume: typeof s.volume === "number" ? s.volume : 1,
        muted: s.muted ?? false,
      });
    } catch {}
  },
}));
