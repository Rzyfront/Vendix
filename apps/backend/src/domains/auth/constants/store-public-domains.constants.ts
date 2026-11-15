import type { Prisma, app_type_enum } from '@prisma/client';

/**
 * App types the admin sidebar's store link may open, in priority order
 * (QUI-980). Ecommerce and admin domains are never linked there.
 */
export const STORE_PUBLIC_LINK_APP_TYPES = [
  'STORE_HOME',
  'STORE_LANDING',
] as const satisfies readonly app_type_enum[];

/**
 * `stores.domain_settings` include used by login and context switches.
 *
 * Keeps every active primary domain (POS invoice links, CRM preview and
 * settings still read the primary) and adds the active non-primary
 * STORE_HOME / STORE_LANDING domains, so the sidebar can apply the QUI-980
 * priority (see `resolveStorePublicHostname` in the frontend auth selectors).
 * Primaries come first so `domain_settings[0]` stays a primary domain.
 */
export const STORE_AUTH_DOMAINS_INCLUDE = {
  where: {
    status: 'active',
    OR: [
      { is_primary: true },
      { app_type: { in: [...STORE_PUBLIC_LINK_APP_TYPES] } },
    ],
  },
  orderBy: [{ is_primary: 'desc' }, { id: 'asc' }],
} satisfies Prisma.domain_settingsFindManyArgs;
