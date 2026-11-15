/**
 * Public link domain resolution for the admin sidebar header (QUI-980).
 *
 * Business rule: the slug link under the store name opens the store's
 * STORE_HOME (primary, then non-primary), then its STORE_LANDING (primary,
 * then non-primary); otherwise the caller falls back to the slug. Ecommerce
 * and admin domains are never linked. The organization panel links only to
 * the organization's own ORG_LANDING, never to one of its stores.
 *
 * Pure functions (no Angular/NgRx imports) so they are trivially testable.
 */

/** Subset of `domain_settings` the auth payload carries for public links. */
export interface PublicLinkDomain {
  hostname: string;
  app_type: string;
  is_primary?: boolean | null;
  status?: string | null;
  store_id?: number | null;
}

/** Store app types the sidebar link may open, in priority order. */
const STORE_PUBLIC_LINK_APP_TYPES = ['STORE_HOME', 'STORE_LANDING'] as const;

/**
 * Picks the active domain of the first matching type, primary before
 * non-primary. Type wins over primacy: a non-primary first type beats a
 * primary second type.
 */
function pickPublicDomain(
  domains: readonly PublicLinkDomain[] | null | undefined,
  appTypes: readonly string[],
  accept: (domain: PublicLinkDomain) => boolean = () => true,
): PublicLinkDomain | null {
  const candidates = (domains ?? []).filter(
    (d) =>
      !!d?.hostname && (d.status == null || d.status === 'active') && accept(d),
  );
  for (const appType of appTypes) {
    const ofType = candidates.filter((d) => d.app_type === appType);
    const found = ofType.find((d) => d.is_primary) ?? ofType[0];
    if (found) return found;
  }
  return null;
}

/**
 * Public hostname of a store for the sidebar link: STORE_HOME (primary, then
 * non-primary), then STORE_LANDING (primary, then non-primary). Ecommerce and
 * admin domains are never returned; null means "fall back to the slug".
 */
export function resolveStorePublicHostname(
  domains: readonly PublicLinkDomain[] | null | undefined,
): string | null {
  return (
    pickPublicDomain(domains, STORE_PUBLIC_LINK_APP_TYPES)?.hostname ?? null
  );
}

/**
 * Public hostname of an organization: its own ORG_LANDING domain. Store
 * domains also carry `organization_id`, so rows with a `store_id` are ignored
 * to never link to another store of the organization.
 */
export function resolveOrganizationPublicHostname(
  domains: readonly PublicLinkDomain[] | null | undefined,
): string | null {
  return (
    pickPublicDomain(domains, ['ORG_LANDING'], (d) => d.store_id == null)
      ?.hostname ?? null
  );
}
