/** Prefix every Vendix store API key starts with (secret and visible prefix). */
export const API_KEY_PREFIX = 'vdx_live_';

/** Hard cap on the length of a presented key (anything longer is garbage). */
export const API_KEY_MAX_LENGTH = 128;

export const MAX_ACTIVE_API_KEYS = 20;

/** Requests per key per window (the global per-IP throttler still applies). */
export const API_KEY_THROTTLE = { limit: 120, ttl: 60_000 } as const;

/** `last_used_at` / `last_used_ip` are written at most once per this interval. */
export const API_KEY_LAST_USED_INTERVAL_MS = 60_000;

export const API_KEY_SCOPES = ['workflows:read', 'workflows:write'] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

/**
 * Store permissions each scope allows. The effective permission set of a
 * request is (acting user's permissions) ∩ (union of the key's scope sets):
 * a scope can never grant what the acting user does not hold.
 *
 * `workflows:write` grants exactly start + task (it does not imply `read`;
 * list/detail routes accept start or task, so a write key can follow its own
 * requests). Design, manage and publish are not reachable over API keys.
 */
export const API_KEY_SCOPE_PERMISSIONS: Record<ApiKeyScope, readonly string[]> =
  {
    'workflows:read': ['store:workflows:read'],
    'workflows:write': ['store:workflows:start', 'store:workflows:task'],
  };

/** Permission that gates the management API (`store/integrations/api-keys`). */
export const API_KEYS_MANAGE_PERMISSION = 'store:integrations:api_keys';
