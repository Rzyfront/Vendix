/**
 * Centralized token configuration constants for authentication.
 * These values provide defaults when environment variables are not set.
 */
export const TOKEN_DEFAULTS = {
  /** Access token expiration time (JWT format) */
  ACCESS_TOKEN_EXPIRY: '1h',

  /** Refresh token expiration time (JWT format) */
  REFRESH_TOKEN_EXPIRY: '7d',

  /** bcrypt hash rounds for secure token storage */
  BCRYPT_ROUNDS: 12,

  /** Minimum interval between refresh requests in seconds (rate limiting) */
  MIN_REFRESH_INTERVAL_SECONDS: 30,
} as const;

export type TokenDefaults = typeof TOKEN_DEFAULTS;
