import { Platform } from 'react-native';

/**
 * Detección de web robusta.
 *
 * - `Platform.OS === 'web'` funciona en runtime con `react-native-web`.
 * - En SSR / Metro `web`, Metro a veces resuelve `Platform` desde `react-native`
 *   puro (no `react-native-web`) por las condiciones del bundler, y devuelve
 *   `'ios'`. Por eso añadimos el fallback `typeof window !== 'undefined' &&
 *   typeof document !== 'undefined'` que es 100% confiable en el navegador.
 */
const isWeb =
  Platform.OS === 'web' ||
  (typeof window !== 'undefined' && typeof document !== 'undefined');

/**
 * Opciones aceptadas por `setItem` en nativo. En web se ignoran.
 *
 * Tipamos por estructura (no por `Parameters<typeof SecureStore.setItemAsync>`)
 * para NO forzar la importación eager de `expo-secure-store` en el grafo de
 * tipos. En native el runtime igual valida con la firma real.
 */
export type SetItemOptions =
  | {
      keychainAccessible?: number;
      requireAuthentication?: boolean;
      authenticationPrompt?: string;
    }
  | undefined;

/**
 * Lazy require del módulo nativo.
 *
 * Hacemos `require()` (no `import`) para que Metro **NO** incluya
 * `expo-secure-store` en el bundle de web cuando solo usamos este archivo.
 * En web, `isWeb === true` y nunca se llega a invocar `getSecureStore()`,
 * así que el módulo nativo jamás se evalúa y su polyfill vacío
 * (`ExpoSecureStore.web.js` → `export default {}`) no causa problemas.
 */
// Cached lazy import. Tipado como el módulo completo y "narrowed" en runtime
// a través del guard `if (!_SecureStore)` — el cast es necesario porque TS
// no puede inferir que `require()` devuelve `T` cuando la variable acepta `T | null`.
let _SecureStore: typeof import('expo-secure-store') | null = null;

function getSecureStore(): typeof import('expo-secure-store') {
  if (_SecureStore === null) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _SecureStore = require('expo-secure-store') as typeof import('expo-secure-store');
  }
  return _SecureStore;
}

/**
 * Cross-platform secure storage.
 *
 * - **Native (iOS / Android)**: delega a `expo-secure-store`, que usa Keychain
 *   en iOS y EncryptedSharedPreferences / Keystore en Android.
 * - **Web**: cae a `localStorage`. **No está cifrado** — cualquier script de la
 *   página puede leerlo. Aceptable para dev / staging; en producción web se
 *   debe usar cookies httpOnly.
 *
 * Esta es la única puerta de entrada al SecureStore en mobile. Cualquier
 * archivo que necesite persistencia segura (tokens, credenciales recordadas,
 * secretos de integración) debe usar este wrapper, nunca importar
 * `expo-secure-store` directamente.
 */
export async function getItem(key: string): Promise<string | null> {
  if (isWeb) {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }
  return getSecureStore().getItemAsync(key);
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
  await getSecureStore().setItemAsync(key, value, options);
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
  await getSecureStore().deleteItemAsync(key);
}

/**
 * Constantes de `keychainAccessible` de `expo-secure-store`.
 *
 * Hardcodeamos los valores numéricos para no importar `expo-secure-store`
 * en el bundle web. Los valores coinciden con la API de iOS Keychain y
 * expo-secure-store 15.x (kSecAttrAccessibleAfterFirstUnlock=0,
 * …ThisDeviceOnly=1, …WhenUnlocked=2, …WhenUnlockedThisDeviceOnly=3).
 *
 * Devuelve `undefined` en web — los callers deben pasar el resultado a
 * `setItem`, que lo ignora en esa plataforma.
 */
export const KeychainAccessibility = {
  AFTER_FIRST_UNLOCK: 0,
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  WHEN_UNLOCKED: 2,
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 3,
} as const;

/**
 * Helper de conveniencia: devuelve `WHEN_UNLOCKED_THIS_DEVICE_ONLY` en native
 * y `undefined` en web, sin importar `expo-secure-store` en el bundle web.
 */
export function whenUnlockedThisDeviceOnly(): number | undefined {
  return isWeb ? undefined : KeychainAccessibility.WHEN_UNLOCKED_THIS_DEVICE_ONLY;
}