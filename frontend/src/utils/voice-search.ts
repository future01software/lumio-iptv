import { Platform } from "react-native";

/**
 * Cross-platform voice recognition wrapper.
 * - Web: uses the browser's Web Speech API (works in our preview).
 * - Native: returns `{ supported: false }` so callers can show a graceful
 *   "voice search not available" message until a custom dev build is wired
 *   to a STT package (e.g. expo-speech-recognition / @react-native-voice/voice).
 */

export type VoiceSession = {
  stop: () => void;
};

export function isVoiceSearchSupported(): boolean {
  if (Platform.OS === "web") {
    if (typeof window === "undefined") return false;
    const w: any = window;
    return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
  }
  return false;
}

export function startVoiceSearch(opts: {
  locale?: string;
  onResult: (text: string, isFinal: boolean) => void;
  onError?: (msg: string) => void;
  onEnd?: () => void;
}): VoiceSession | null {
  if (Platform.OS !== "web") {
    opts.onError?.("Voice search needs a custom dev build on iOS/Android.");
    return null;
  }
  if (typeof window === "undefined") return null;
  const w: any = window;
  const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
  if (!SR) {
    opts.onError?.("Browser does not support Web Speech API");
    return null;
  }
  const rec = new SR();
  rec.lang = opts.locale || "en-US";
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;

  rec.onresult = (e: any) => {
    let text = "";
    let isFinal = false;
    for (let i = e.resultIndex; i < e.results.length; i++) {
      text += e.results[i][0].transcript;
      if (e.results[i].isFinal) isFinal = true;
    }
    opts.onResult(text.trim(), isFinal);
  };
  rec.onerror = (e: any) => opts.onError?.(String(e?.error || "voice error"));
  rec.onend = () => opts.onEnd?.();
  try { rec.start(); } catch (e: any) { opts.onError?.(String(e?.message || e)); return null; }
  return {
    stop: () => { try { rec.stop(); } catch {} },
  };
}
