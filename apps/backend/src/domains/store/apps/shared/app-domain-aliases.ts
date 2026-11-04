/**
 * Apps F5: an app keeps its Vendix subdomain as its primary domain
 * (`store_apps.domain_settings_id`) and may also be served by one or more of
 * the store's own domains, its aliases. Aliases live in
 * `store_apps.config.custom_domain_aliases`, each with the `app_type` the
 * domain had before, so unpublishing gives it back.
 *
 * Pure helpers shared by the app services and by both domain services (store
 * and organization), which must agree on which `app_type` belongs to which
 * app.
 */

export interface AppDomainAlias {
  domain_id: number;
  /** `app_type` the domain served before; `null` when unknown. */
  previous_app_type: string | null;
}

/** `app_type` values that only exist as an app, with the app that owns each. */
export const APP_KIND_BY_APP_TYPE = {
  STORE_HOME: 'store_home',
  STORE_PRODUCT_PAGE: 'product_page',
  STORE_SERVICE_PAGE: 'service_page',
  STORE_BOOKING: 'booking',
} as const;

/** Names the domain modals show for each app type of an app. */
export const APP_TYPE_LABELS: Record<AppOnlyAppType, string> = {
  STORE_HOME: 'Inicio de tienda',
  STORE_PRODUCT_PAGE: 'Página de producto',
  STORE_SERVICE_PAGE: 'Página de servicios',
  STORE_BOOKING: 'Reservas',
};

export type AppOnlyAppType = keyof typeof APP_KIND_BY_APP_TYPE;

export const APP_ONLY_APP_TYPES = Object.keys(
  APP_KIND_BY_APP_TYPE,
) as AppOnlyAppType[];

/** Domains serving these never move to an app (apps and domain modals). */
export const PROTECTED_APP_TYPES = ['STORE_ECOMMERCE', 'STORE_ADMIN'];

export function isAppOnlyAppType(
  appType: string | null | undefined,
): appType is AppOnlyAppType {
  return !!appType && appType in APP_KIND_BY_APP_TYPE;
}

/** Reads `custom_domain_aliases` defensively, dropping malformed entries and duplicates. */
export function parseAppDomainAliases(raw: unknown): AppDomainAlias[] {
  const obj =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const list = Array.isArray(obj.custom_domain_aliases)
    ? obj.custom_domain_aliases
    : [];
  const seen = new Set<number>();
  const aliases: AppDomainAlias[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const { domain_id, previous_app_type } = item as Record<string, unknown>;
    if (typeof domain_id !== 'number' || !Number.isInteger(domain_id)) continue;
    if (seen.has(domain_id)) continue;
    seen.add(domain_id);
    aliases.push({
      domain_id,
      previous_app_type:
        typeof previous_app_type === 'string' ? previous_app_type : null,
    });
  }
  return aliases;
}

/** Returns `aliases` plus `alias`; an existing entry for the domain is kept as is. */
export function withAlias(
  aliases: AppDomainAlias[],
  alias: AppDomainAlias,
): AppDomainAlias[] {
  return aliases.some((a) => a.domain_id === alias.domain_id)
    ? aliases
    : [...aliases, alias];
}

export function withoutAlias(
  aliases: AppDomainAlias[],
  domainId: number,
): AppDomainAlias[] {
  return aliases.filter((a) => a.domain_id !== domainId);
}
