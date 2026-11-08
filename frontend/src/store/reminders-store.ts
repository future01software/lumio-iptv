import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";

import type { Channel, EPGProgram } from "@/src/types/iptv";

// EPG reminders: "tell me when this programme starts". Times are kept exactly
// as the guide has them (EPG time, see getEpgNow) so the EPG shift setting
// applies the same way it does everywhere else.

const STORAGE_KEY = "iptv.reminders.v1";

export type Reminder = {
  id: string;
  channelId: string;
  channelName: string;
  logo?: string | null;
  title: string;
  start: string;
  stop: string;
};

export function reminderId(channelId: string, start: string) {
  return `${channelId}|${start}`;
}

type State = {
  reminders: Record<string, Reminder>;
  /** Reminders whose programme has started and that the user hasn't acted on yet. */
  due: Reminder[];
  init: () => Promise<void>;
  toggle: (channel: Channel, program: EPGProgram) => Promise<boolean>;
  remove: (id: string) => Promise<void>;
  /** Moves started reminders to `due` and drops ones whose programme has ended. */
  tick: (epgNow: string) => Reminder[];
  dismissDue: (id: string) => void;
};

function persist(reminders: Record<string, Reminder>) {
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(reminders)).catch(() => {});
}

export const useReminders = create<State>((set, get) => ({
  reminders: {},
  due: [],

  init: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      set({ reminders: raw ? JSON.parse(raw) : {} });
    } catch {}
  },

  toggle: async (channel, program) => {
    const id = reminderId(channel.id, program.start);
    const reminders = { ...get().reminders };
    const added = !reminders[id];
    if (added) {
      reminders[id] = {
        id,
        channelId: channel.id,
        channelName: channel.name,
        logo: channel.logo,
        title: program.title,
        start: program.start,
        stop: program.stop,
      };
    } else {
      delete reminders[id];
    }
    set({ reminders });
    persist(reminders);
    return added;
  },

  remove: async (id) => {
    const reminders = { ...get().reminders };
    delete reminders[id];
    set({ reminders, due: get().due.filter((r) => r.id !== id) });
    persist(reminders);
  },

  tick: (epgNow) => {
    const all = get().reminders;
    const fired: Reminder[] = [];
    const keep: Record<string, Reminder> = {};
    for (const r of Object.values(all)) {
      if (r.stop <= epgNow) continue; // over: drop silently (app was closed)
      if (r.start <= epgNow) fired.push(r);
      else keep[r.id] = r;
    }
    if (fired.length || Object.keys(keep).length !== Object.keys(all).length) {
      set({ reminders: keep, due: [...get().due, ...fired] });
      persist(keep);
    }
    return fired;
  },

  dismissDue: (id) => set({ due: get().due.filter((r) => r.id !== id) }),
}));
