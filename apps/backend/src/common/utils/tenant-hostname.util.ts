/**
 * Tenant hostname resolution — SINGLE SOURCE OF TRUTH.
 *
 * Every public, hostname-addressed asset (`/sitemap.xml`, `/robots.txt`,
 * `/manifest.webmanifest`, `/pwa/:asset`) must be built for the tenant the
 * VIEWER asked for. The only trustworthy signal for that is the `Host` header.
 *
 * Why `x-forwarded-host` must NOT win (QUI-564): the production CloudFront
 * distribution `E1I27OYFJX7VYJ` declares a custom header on the
 * `vendix-backend-api` origin with a FIXED value:
 *
 *     Origin `vendix-backend-api` -> api.vendix.online
 *       CustomHeaders: [{ X-Forwarded-Host: vendix.online }]
 *
 * That value is a constant, not the viewer's host. CloudFront DOES forward the
 * real `Host` (`ForwardedValues.Headers: ["Host"]` on both the `sitemap.xml`
 * and `robots.txt` behaviors), so reading `x-forwarded-host` first handed the
 * PLATFORM's sitemap/robots to every tenant domain — unconditionally, for 100%
 * of traffic. Verified in production against three tenants.
 *
 * Correct precedence: the viewer `Host` wins. `x-forwarded-host` is consulted
 * ONLY when `Host` is the API's own hostname, which is the signature of a proxy
 * that terminated the connection without forwarding the real Host.
 *
 * DO NOT read `req.headers['x-forwarded-host']` or `req.headers['host']`
 * anywhere else in the backend — `scripts/tenant-host-audit.sh` fails CI on it.
 * Route every hostname-addressed handler through `resolveTenantHostname`.
 *
 * No NestJS DI: this is a pure utility, callable from `bootstrap()` before the
 * DI container is usable and unit-testable with plain object literals.
 */
import type { IncomingHttpHeaders } from 'http';
import { DomainConfigService } from '../config/domain.config';

/**
 * Hostnames that belong to the API itself, NOT to any tenant.
 *
 * Deliberately NOT derived from `BASE_DOMAIN`: the platform runs TWO live
 * apexes at once — `api.vendix.online` (the mobile client's hardcoded default)
 * and `api.vendix.com` — while `BASE_DOMAIN` holds exactly one, and its two
 * defaults are already out of sync (the EC2 deploy defaults it to `vendix.com`,
 * `DomainConfigService` to `vendix.online`). Building `api.${BASE_DOMAIN}`
 * would silently drop one apex and reintroduce QUI-564 for that half of the
 * traffic, with the platform-landing fallback masking the failure.
 *
 * Override with `API_HOSTNAMES` (comma-separated) for staging/preview origins.
 * The default set is asserted in the spec, so changing it is a deliberate act
 * visible in a test diff rather than a silent edit.
 */
export const API_HOSTS: ReadonlySet<string> = new Set(
  (process.env.API_HOSTNAMES ?? 'api.vendix.com,api.vendix.online')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean),
);

/**
 * Bare, lowercase, port-less hostname with no unexpected characters.
 *
 * The value is client-controlled and ends up in Redis cache keys (`seo:*`,
 * `pwa:*`) and in emitted URLs (`base_url`, `start_url`, `scope`), so it is
 * normalized before being used as either. Without this, `nike.…`, `Nike.…` and
 * `NIKE.…` all resolve to the same tenant (the DB lookup is case-insensitive)
 * while creating three distinct cache entries, each carrying a full sitemap
 * build — unbounded, client-controlled key cardinality against a Redis running
 * `allkeys-lru`, which responds by evicting hot keys.
 *
 * Stripping the port also fixes local development, where `Host: vendix.com:4200`
 * never matched a `domain_settings` row because `resolveDomain` lowercases and
 * trims but does not split the port.
 *
 * Returns '' when nothing usable remains; the caller decides the fallback.
 */
export function normalizeHostname(value: unknown): string {
  return (value ?? '')
    .toString()
    .trim()
    .toLowerCase()
    .split(',')[0] // `x-forwarded-host: a, b` -> first hop
    .trim()
    .split(':')[0] // strip the port
    .replace(/[^a-z0-9.-]/g, '');
}

/**
 * The tenant hostname this request is addressed to, normalized.
 *
 * Typed structurally on `{ headers }` so it accepts both an Express `Request`
 * and the raw `req` handed to `httpAdapter.get(...)` in `main.ts`, and so it is
 * unit-testable without constructing a real request.
 */
export function resolveTenantHostname(req: {
  headers: IncomingHttpHeaders;
}): string {
  const headers = req?.headers ?? {};
  const host = normalizeHostname(headers['host']);
  const forwarded = normalizeHostname(headers['x-forwarded-host']);

  // The viewer Host wins unless it is the API's own hostname, in which case the
  // proxy did not forward it and `x-forwarded-host` is the best signal left.
  const resolved = host && !API_HOSTS.has(host) ? host : forwarded || host;

  return resolved || DomainConfigService.getBaseDomain();
}
