import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const isWeb = Platform.OS === 'web';

/**
 * Options accepted by `setItem` on native. On web they are ignored.
 */
export type SetItemOptions = Parameters<typeof SecureStore.setItemAsync>[2];

/**
 * Cross-platform secure storage.
 *
 * - Native (iOS / Android): delegates to `expo-secure-store`, which uses
 *   Keychain on iOS and EncryptedSharedPreferences / Keystore on Android.
 * - Web: falls back to `localStorage`. **Not encrypted** — readable by any
 *   script on the page. Acceptable for dev / staging; production web should
 *   use httpOnly cookies.
 */
export async function getItem(key: string): Promise<string | null> {
  if (isWeb) {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }
  return SecureStore.getItemAsync(key);
}

export async function setItem(
  key: string,
  value: string,
  options?: SetItemOptions,
): Promise<void> {
  if (isWeb) {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      // quota exceeded or storage disabled (e.g. private mode) — silent no-op
    }
    return;
  }
  await SecureStore.setItemAsync(key, value, options);
}

export async function deleteItem(key: string): Promise<void> {
  if (isWeb) {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      // ignore
    }
    return;
  }
  await SecureStore.deleteItemAsync(key);
}
