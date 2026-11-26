import { isIP } from 'net';

/**
 * Security rules shared by every consumer of `ai_engine_configs`: the engine
 * providers, the superadmin DTO and the Vex classifier. One semantics per
 * column, so a row means the same thing wherever it is read.
 */

/**
 * `api_key_ref` IS the literal key (masked by the superadmin panel and never
 * returned in reads). When empty, the engine falls back to the deployment
 * variable `AI_<PROVIDER>_API_KEY`; the variable name is fixed by that
 * template, never taken from the row.
 */
export function resolveConfigApiKey(
  config: { api_key_ref?: string | null; provider?: string | null },
  lookup: (name: string) => string | undefined,
): string {
  if (config.api_key_ref) return config.api_key_ref;
  const provider = (config.provider ?? '').toUpperCase().replace(/\s+/g, '_');
  if (!provider) return '';
  return lookup(`AI_${provider}_API_KEY`) || '';
}

/**
 * Hosts an `ai_engine_configs.base_url` may point to: OpenRouter and the
 * providers the engine already ships adapters/defaults for. The deployment
 * (not the row) may add exact hostnames with `AI_ENGINE_ALLOWED_HOSTS`
 * (comma-separated). Private and internal names are rejected even if listed.
 */
export const AI_ENGINE_DEFAULT_ALLOWED_HOSTS: readonly string[] = [
  'openrouter.ai',
  'api.openai.com',
  'api.anthropic.com',
  'generativelanguage.googleapis.com',
  'api.minimax.io',
  'api.deepseek.com',
];

export function aiEngineAllowedHosts(
  env: Record<string, string | undefined> = process.env,
): string[] {
  const extra = (env.AI_ENGINE_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((host) => normalizeHost(host))
    .filter(Boolean);
  return [...new Set([...AI_ENGINE_DEFAULT_ALLOWED_HOSTS, ...extra])];
}

export type BaseUrlRejection =
  | 'invalid_url'
  | 'not_https'
  | 'credentials_in_url'
  | 'non_default_port'
  | 'ip_literal'
  | 'internal_host'
  | 'host_not_allowed';

export type BaseUrlCheck =
  | { ok: true; url: URL }
  | { ok: false; reason: BaseUrlRejection };

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, '');
}

const INTERNAL_SUFFIXES = ['.localhost', '.internal', '.local', '.localdomain', '.lan', '.home.arpa'];

/**
 * SSRF guard for a provider `base_url`: https only, default port, no
 * credentials, no IP literal (WHATWG `URL` already normalizes decimal/hex
 * forms such as `https://2852039166`), no `localhost`/internal suffix, and the
 * exact hostname must be in `allowed`. No DNS resolution: the allowlist only
 * holds public provider names.
 */
export function checkAiBaseUrl(
  raw: string,
  allowed: readonly string[],
): BaseUrlCheck {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'not_https' };
  if (url.username || url.password)
    return { ok: false, reason: 'credentials_in_url' };
  if (url.port && url.port !== '443')
    return { ok: false, reason: 'non_default_port' };
  const host = normalizeHost(url.hostname.replace(/^\[|\]$/g, ''));
  if (isIP(host)) return { ok: false, reason: 'ip_literal' };
  if (
    host === 'localhost' ||
    !host.includes('.') ||
    INTERNAL_SUFFIXES.some((suffix) => host.endsWith(suffix))
  )
    return { ok: false, reason: 'internal_host' };
  if (!allowed.map(normalizeHost).includes(host))
    return { ok: false, reason: 'host_not_allowed' };
  return { ok: true, url };
}
