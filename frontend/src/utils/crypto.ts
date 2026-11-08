import 'react-native-get-random-values';
import { getSecure, setSecure } from '@/src/utils/secure-storage';
import CryptoJS from 'crypto-js';
import * as Crypto from 'expo-crypto';

const MASTER_KEY_ALIAS = 'iptv.master_key.v1';

/**
 * Retrieves the master AES encryption key from the device's secure keystore.
 * If it doesn't exist, it generates a new random 256-bit key and stores it.
 */
export async function getMasterKey(): Promise<string> {
  let key = await getSecure(MASTER_KEY_ALIAS);
  if (!key) {
    // Generate a strong random key (32 bytes = 256 bits)
    const randomBytes = await Crypto.getRandomBytesAsync(32);
    // Convert to hex string
    key = Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('');
    
    await setSecure(MASTER_KEY_ALIAS, key);
  }
  return key;
}

/**
 * Encrypts a string (e.g., JSON payload) using AES-256 and the device's master key.
 */
export async function encryptData(data: string): Promise<string> {
  try {
    const key = await getMasterKey();
    return CryptoJS.AES.encrypt(data, key).toString();
  } catch (err) {
    console.error('Encryption failed:', err);
    throw err;
  }
}

export async function decryptData(encryptedData: string): Promise<string | null> {
  if (!encryptedData) return null;
  
  // If the data starts with { or [, it's likely already plain JSON (legacy unencrypted data)
  const trimmed = encryptedData.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return encryptedData;
  }

  try {
    const key = await getMasterKey();
    const bytes = CryptoJS.AES.decrypt(encryptedData, key);
    const decryptedText = bytes.toString(CryptoJS.enc.Utf8);
    if (!decryptedText) {
      return null;
    }
    return decryptedText;
  } catch (err) {
    // Suppress console.error to avoid React Native RedBox for malformed data
    // console.warn('Decryption failed, falling back to raw data if possible.');
    return null;
  }
}
