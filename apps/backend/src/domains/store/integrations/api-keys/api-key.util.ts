import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import {
  API_KEY_MAX_LENGTH,
  API_KEY_PREFIX,
  API_KEY_SCOPE_PERMISSIONS,
  API_KEY_SCOPES,
  ApiKeyScope,
} from './api-key.constants';

export interface GeneratedApiKey {
  /** Full secret. Shown to the caller once and never stored. */
  secret: string;
  /** Visible, non-secret identifier (`vdx_live_ab12cd`). */
  prefix: string;
  /** sha256 hex of the full secret: the only thing persisted. */
  key_hash: string;
}

export function hashApiKey(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

/** `vdx_live_<6 hex>_<32 random bytes base64url>`, from a CSPRNG. */
export function generateApiKey(): GeneratedApiKey {
  const prefix = `${API_KEY_PREFIX}${randomBytes(3).toString('hex')}`;
  const secret = `${prefix}_${randomBytes(32).toString('base64url')}`;
  return { secret, prefix, key_hash: hashApiKey(secret) };
}

/** Constant-time comparison of two sha256 hex digests. */
export function hashesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  if (left.length !== 32 || right.length !== 32) return false;
  return timingSafeEqual(left, right);
}

/**
 * Pulls the presented key out of the request headers. Accepts
 * `Authorization: Bearer vdx_live_…` or `X-Api-Key`. A bearer that is not a
 * Vendix key (a JWT, for instance) is ignored, so a JWT alone never
 * authenticates here. Returns null when nothing usable was presented.
 */
export function extractApiKey(
  headers: Record<string, unknown> | undefined,
): string | null {
  const candidates: unknown[] = [];
  const auth = headers?.authorization;
  if (typeof auth === 'string') {
    const m = /^Bearer\s+(\S+)\s*$/i.exec(auth);
    if (m) candidates.push(m[1]);
  }
  const header = headers?.['x-api-key'];
  if (typeof header === 'string') candidates.push(header.trim());
  for (const c of candidates) {
    if (
      typeof c === 'string' &&
      c.startsWith(API_KEY_PREFIX) &&
      c.length > API_KEY_PREFIX.length &&
      c.length <= API_KEY_MAX_LENGTH
    ) {
      return c;
    }
  }
  return null;
}

export function isApiKeyScope(value: unknown): value is ApiKeyScope {
  return (
    typeof value === 'string' &&
    (API_KEY_SCOPES as readonly string[]).includes(value)
  );
}

/** Permissions the scopes allow (unknown scopes allow nothing). */
export function scopePermissions(scopes: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const s of scopes) {
    if (isApiKeyScope(s))
      API_KEY_SCOPE_PERMISSIONS[s].forEach((p) => out.add(p));
  }
  return out;
}

/** (acting user's permissions) ∩ (scope-allowed permissions). */
export function effectivePermissions(
  userPermissions: readonly string[],
  scopes: readonly string[],
): string[] {
  const allowed = scopePermissions(scopes);
  return [...new Set(userPermissions)].filter((p) => allowed.has(p));
}
