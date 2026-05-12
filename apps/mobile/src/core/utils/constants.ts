export const APP_NAME = 'Vendix';
export const APP_VERSION = '1.0.0';

export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
} as const;

export const STORAGE_KEYS = {
  AUTH: 'auth-storage',
  TENANT: 'tenant-storage',
  CONFIG: 'config-storage',
} as const;

export const DATE_FORMAT = {
  SHORT: 'MMM d, yyyy',
  LONG: 'MMMM d, yyyy',
  TIME: 'HH:mm',
  DATETIME: 'MMM d, yyyy HH:mm',
} as const;

export const CURRENCY_FORMAT = {
  DECIMAL_SCALE: 2,
  LOCALE: 'es-CO',
} as const;
