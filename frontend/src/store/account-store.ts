import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";

// Local (on-device) accounts. Lumio has no cloud auth backend, so an account
// lives only on the device it was created on - but the password is really
// checked: we store a salted, iterated SHA-256 hash, never the password.

const ACCOUNTS_KEY = "iptv.accounts.v1";
const CURRENT_KEY = "iptv.currentAccount.v1";
const LOCK_PREFIX = "iptv.accountLock.";

const HASH_ROUNDS = 1000;
const MIN_PASSWORD = 6;
const MAX_ATTEMPTS = 5;
const LOCK_SECONDS = 30;

type StoredAccount = { salt: string; hash: string; rounds: number; createdAt: string };
export type AuthResult = { ok: true } | { ok: false; error: string; field?: "email" | "password" };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

async function hashPassword(password: string, salt: string, rounds: number) {
  let h = `${salt}:${password}`;
  for (let i = 0; i < rounds; i++) {
    h = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${h}`);
  }
  return h;
}

async function loadAccounts(): Promise<Record<string, StoredAccount>> {
  try {
    const raw = await AsyncStorage.getItem(ACCOUNTS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

type State = {
  currentEmail: string | null;
  init: () => Promise<void>;
  signup: (email: string, password: string) => Promise<AuthResult>;
  login: (email: string, password: string) => Promise<AuthResult>;
  logout: () => Promise<void>;
};

export const useAccount = create<State>((set) => ({
  currentEmail: null,

  init: async () => {
    try {
      set({ currentEmail: await AsyncStorage.getItem(CURRENT_KEY) });
    } catch {}
  },

  signup: async (rawEmail, password) => {
    const email = normalizeEmail(rawEmail);
    if (!EMAIL_RE.test(email)) return { ok: false, error: "Geçerli bir e-posta adresi gir", field: "email" };
    if (password.length < MIN_PASSWORD) {
      return { ok: false, error: `Şifre en az ${MIN_PASSWORD} karakter olmalı`, field: "password" };
    }
    const accounts = await loadAccounts();
    if (accounts[email]) return { ok: false, error: "Bu e-posta ile zaten bir hesap var. Giriş yapmayı dene.", field: "email" };

    const salt = Crypto.randomUUID();
    accounts[email] = {
      salt,
      hash: await hashPassword(password, salt, HASH_ROUNDS),
      rounds: HASH_ROUNDS,
      createdAt: new Date().toISOString(),
    };
    await AsyncStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
    await AsyncStorage.setItem(CURRENT_KEY, email);
    set({ currentEmail: email });
    return { ok: true };
  },

  login: async (rawEmail, password) => {
    const email = normalizeEmail(rawEmail);
    if (!EMAIL_RE.test(email)) return { ok: false, error: "Geçerli bir e-posta adresi gir", field: "email" };
    if (!password) return { ok: false, error: "Şifreni gir", field: "password" };

    const lockKey = LOCK_PREFIX + email;
    let lock = { fails: 0, until: 0 };
    try {
      const raw = await AsyncStorage.getItem(lockKey);
      if (raw) lock = JSON.parse(raw);
    } catch {}
    const now = Date.now();
    if (lock.until > now) {
      const sec = Math.ceil((lock.until - now) / 1000);
      return { ok: false, error: `Çok fazla hatalı deneme. ${sec} sn sonra tekrar dene.` };
    }

    const account = (await loadAccounts())[email];
    if (!account) {
      return { ok: false, error: "Bu e-posta ile kayıtlı hesap bulunamadı. Önce kayıt ol.", field: "email" };
    }
    const hash = await hashPassword(password, account.salt, account.rounds);
    if (hash !== account.hash) {
      const fails = (lock.until && lock.until <= now ? 0 : lock.fails) + 1;
      const locked = fails >= MAX_ATTEMPTS;
      try {
        await AsyncStorage.setItem(
          lockKey,
          JSON.stringify({ fails: locked ? 0 : fails, until: locked ? now + LOCK_SECONDS * 1000 : 0 }),
        );
      } catch {}
      return {
        ok: false,
        error: locked
          ? `Çok fazla hatalı deneme. ${LOCK_SECONDS} sn sonra tekrar dene.`
          : `Şifre hatalı · ${MAX_ATTEMPTS - fails} deneme hakkın kaldı`,
        field: "password",
      };
    }

    try { await AsyncStorage.removeItem(lockKey); } catch {}
    await AsyncStorage.setItem(CURRENT_KEY, email);
    set({ currentEmail: email });
    return { ok: true };
  },

  logout: async () => {
    try { await AsyncStorage.removeItem(CURRENT_KEY); } catch {}
    set({ currentEmail: null });
  },
}));
