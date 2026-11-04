import { Prisma } from '@prisma/client';
import { StoreHomeConfig, parseStoreHomeConfig } from './store-home.reader';

/**
 * What a store's primary `{tienda}-store` domain serves when unpublishing
 * the store home gives it back: the store landing, which stays supported.
 */
const STORE_HOME_FALLBACK_APP_TYPE = 'STORE_LANDING';

/** Any Prisma client (or transaction client) that can write `store_apps`. */
export type StoreAppsWriter = Pick<Prisma.TransactionClient, 'store_apps'>;

/**
 * Initial `store_apps.config` of the store home a new store is born with:
 * the default footer, no aliases, and the landing as what unpublishing
 * gives back (the domain never had another app before the store home).
 */
export function defaultStoreHomeConfig(): StoreHomeConfig {
  return {
    footer_text: null,
    domain_previous_app_type: STORE_HOME_FALLBACK_APP_TYPE,
    custom_domain_aliases: [],
  };
}

/**
 * Leaves the store home published on the store's default `{tienda}-store`
 * domain, the entry page that leads to the admin panel after login.
 *
 * Called by every flow that creates a store or its default domain, right
 * after that domain is written with `app_type = STORE_HOME`, and inside the
 * same transaction so the store never ends half-created.
 *
 * Idempotent: `store_apps` is unique by `(store_id, kind)`, so a retry
 * reuses the existing row (its config is kept) and only re-points it to
 * the domain and marks it published. Never creates a second row.
 */
export async function ensureDefaultStoreHomeApp(
  client: StoreAppsWriter,
  storeId: number,
  domainSettingsId: number,
): Promise<void> {
  const existing = await client.store_apps.findUnique({
    where: { store_id_kind: { store_id: storeId, kind: 'store_home' } },
    select: {
      id: true,
      status: true,
      domain_settings_id: true,
      config: true,
    },
  });

  if (!existing) {
    await client.store_apps.create({
      data: {
        store_id: storeId,
        kind: 'store_home',
        status: 'published',
        published_at: new Date(),
        domain_settings_id: domainSettingsId,
        config: toJson(defaultStoreHomeConfig()),
      },
    });
    return;
  }

  if (
    existing.status === 'published' &&
    existing.domain_settings_id === domainSettingsId
  ) {
    return;
  }

  const config = parseStoreHomeConfig(existing.config);
  config.domain_previous_app_type ??= STORE_HOME_FALLBACK_APP_TYPE;
  await client.store_apps.update({
    where: { id: existing.id },
    data: {
      status: 'published',
      published_at: new Date(),
      domain_settings_id: domainSettingsId,
      config: toJson(config),
      updated_at: new Date(),
    },
  });
}

function toJson(config: StoreHomeConfig): Prisma.InputJsonValue {
  return config as unknown as Prisma.InputJsonValue;
}
