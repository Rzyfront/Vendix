import { PwaIconVariant, PWA_ICON_VARIANTS } from './image-presets';

/**
 * Cache keys for the per-tenant Web App Manifest and its icon binaries.
 *
 * They live here, and not next to `PublicPwaService`, because TWO sides need
 * to agree on them and they sit in different domains: the PWA service WRITES
 * them, and `PwaCacheService` (invoked from store/organization settings)
 * DELETES them when the tenant changes its logo or its brand color. A key
 * built by hand on the delete side is a silent no-op — the tenant keeps its
 * old icon and nothing in the logs says why.
 */

/** Manifest body for a hostname. */
export function pwaManifestCacheKey(hostname: string): string {
  return `pwa:manifest:${hostname}`;
}

/** One icon binary (or the "serve the Vendix brand" decision) for a hostname. */
export function pwaIconCacheKey(
  hostname: string,
  variant: PwaIconVariant,
): string {
  return `pwa:icon:${hostname}:${variant}`;
}

/** Every cache key a single hostname can occupy: the manifest and all icons. */
export function pwaCacheKeysForHost(hostname: string): string[] {
  return [
    pwaManifestCacheKey(hostname),
    ...PWA_ICON_VARIANTS.map((variant) => pwaIconCacheKey(hostname, variant)),
  ];
}
