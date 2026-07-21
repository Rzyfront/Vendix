import { createHmac } from 'crypto';

/**
 * Centralized token configuration constants for authentication.
 * These values provide defaults when environment variables are not set.
 */
export const TOKEN_DEFAULTS = {
  /** Access token expiration time (JWT format) */
  ACCESS_TOKEN_EXPIRY: '1h',

  /** Refresh token expiration time (JWT format) */
  REFRESH_TOKEN_EXPIRY: '7d',

  /** bcrypt hash rounds for secure token storage (passwords only) */
  BCRYPT_ROUNDS: 12,

  /** Minimum interval between refresh requests in seconds (rate limiting) */
  MIN_REFRESH_INTERVAL_SECONDS: 30,
} as const;

export type TokenDefaults = typeof TOKEN_DEFAULTS;

/**
 * Environment variable name that holds the HMAC secret used to hash refresh
 * tokens before storage. MUST be set in production.
 */
export const REFRESH_TOKEN_HMAC_SECRET_ENV = 'REFRESH_TOKEN_HMAC_SECRET';

/**
 * Documented, non-sensitive DEV-ONLY fallback secret. It is intentionally not
 * a production value: production MUST provide REFRESH_TOKEN_HMAC_SECRET via the
 * environment. This fallback only keeps local/dev running out of the box.
 */
export const REFRESH_TOKEN_HMAC_DEV_FALLBACK =
  'vendix-dev-refresh-token-hmac-secret-do-not-use-in-prod';

/**
 * Resolves the HMAC secret used to hash refresh tokens. Reads it from the
 * environment (REFRESH_TOKEN_HMAC_SECRET) and falls back to a documented
 * dev-only constant when unset.
 */
export function getRefreshTokenHmacSecret(): string {
  return (
    process.env[REFRESH_TOKEN_HMAC_SECRET_ENV] ||
    REFRESH_TOKEN_HMAC_DEV_FALLBACK
  );
}

/**
 * Deterministic keyed hash of a refresh token for storage and lookup.
 *
 * A refresh token is a high-entropy random secret, so it does not need bcrypt's
 * key-stretching (which costs ~300ms per hash). HMAC-SHA256 protects the token
 * at rest while producing a stable 64-char hex digest, enabling a direct
 * lookup by hash instead of an O(n) bcrypt.compare loop over every session.
 *
 * NOTE: This is ONLY for session refresh tokens. User passwords keep using
 * bcrypt and MUST NOT be migrated to this helper.
 */
export function hmacSha256(token: string, secret: string): string {
  return createHmac('sha256', secret).update(token).digest('hex');
}
