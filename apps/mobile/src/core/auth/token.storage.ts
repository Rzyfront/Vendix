import { getItem, setItem, deleteItem, whenUnlockedThisDeviceOnly } from '@/core/storage/secure-storage';

const TOKEN_KEY = 'vendix_auth_token';
const REFRESH_TOKEN_KEY = 'vendix_refresh_token';

export async function getToken(): Promise<string | null> {
  return getItem(TOKEN_KEY);
}

export async function setToken(token: string): Promise<void> {
  await setItem(TOKEN_KEY, token, {
    keychainAccessible: whenUnlockedThisDeviceOnly(),
  });
}

export async function getRefreshToken(): Promise<string | null> {
  return getItem(REFRESH_TOKEN_KEY);
}

export async function setRefreshToken(token: string): Promise<void> {
  await setItem(REFRESH_TOKEN_KEY, token, {
    keychainAccessible: whenUnlockedThisDeviceOnly(),
  });
}

export async function clearToken(): Promise<void> {
  await deleteItem(TOKEN_KEY);
  await deleteItem(REFRESH_TOKEN_KEY);
}