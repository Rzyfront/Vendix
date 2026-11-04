import { carryPage } from '../shared/app-page.contract';
import {
  AppDomainAlias,
  parseAppDomainAliases,
} from '../shared/app-domain-aliases';

/** Longest footer line the owner can write (a short, discreet sentence). */
export const MAX_STORE_HOME_FOOTER = 160;

/**
 * Footer line shown when the owner wrote none: Vendix's own tagline, the one
 * the Vendix site footer already uses. No new commercial copy.
 */
export const DEFAULT_STORE_HOME_FOOTER =
  'El Sistema Operativo Comercial Todo-en-Uno para Latinoamérica.';

/** Shape of `store_apps.config` for `kind = 'store_home'`. */
export interface StoreHomeConfig {
  /** Footer line about Vendix; `null` = `DEFAULT_STORE_HOME_FOOTER`. */
  footer_text: string | null;
  /**
   * The `app_type` the primary `{tienda}-store` domain had before the store
   * home took it, so unpublishing gives it back (normally `STORE_LANDING`).
   */
  domain_previous_app_type: string | null;
  /** Apps F2: the app's own page (`app-page.contract.ts`), kept as stored. */
  page?: unknown;
  /**
   * Apps F5: the store's own domains that also serve this app, besides its
   * primary Vendix subdomain (`shared/app-domain-aliases.ts`).
   */
  custom_domain_aliases?: AppDomainAlias[];
}

/** Parses the stored JSON defensively. */
export function parseStoreHomeConfig(raw: unknown): StoreHomeConfig {
  const obj =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const footer =
    typeof obj.footer_text === 'string' && obj.footer_text.trim()
      ? obj.footer_text.trim().slice(0, MAX_STORE_HOME_FOOTER)
      : null;
  const previous = obj.domain_previous_app_type;
  return {
    ...carryPage(raw),
    footer_text: footer,
    domain_previous_app_type: typeof previous === 'string' ? previous : null,
    custom_domain_aliases: parseAppDomainAliases(raw),
  };
}

/** Brand fields the store home paints with. */
export interface StoreHomeBranding {
  name: string | null;
  logo_url: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  accent_color: string | null;
}

type BrandingSource = Record<string, unknown> | null | undefined;

const BRAND_FIELDS: (keyof StoreHomeBranding)[] = [
  'name',
  'logo_url',
  'primary_color',
  'secondary_color',
  'accent_color',
];

/**
 * Same order the rest of the system uses: the store's branding first, then
 * its organization's. A field missing in both stays `null` and the frontend
 * falls back to Vendix's default brand (`vlogomono.png`, theme colors).
 */
export function resolveStoreHomeBranding(
  store: BrandingSource,
  organization: BrandingSource,
): StoreHomeBranding {
  const pick = (field: keyof StoreHomeBranding): string | null => {
    for (const source of [store, organization]) {
      const value = source?.[field];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return null;
  };
  return Object.fromEntries(
    BRAND_FIELDS.map((field) => [field, pick(field)]),
  ) as unknown as StoreHomeBranding;
}
