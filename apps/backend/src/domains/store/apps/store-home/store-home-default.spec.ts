import { createInMemoryDb } from '../../../../testing/in-memory-db';
import {
  defaultStoreHomeConfig,
  ensureDefaultStoreHomeApp,
  StoreAppsWriter,
} from './store-home-default';
import { parseStoreHomeConfig } from './store-home.reader';

/**
 * The store home every new store is born with: published on its default
 * `{tienda}-store` domain, created once, reused on retries.
 */
describe('ensureDefaultStoreHomeApp', () => {
  const STORE_ID = 7;
  const DOMAIN_ID = 40;

  it('creates the store home published on the default domain', async () => {
    const db = createInMemoryDb();

    await ensureDefaultStoreHomeApp(
      db.client as StoreAppsWriter,
      STORE_ID,
      DOMAIN_ID,
    );

    expect(db.tables.store_apps).toHaveLength(1);
    const row = db.tables.store_apps[0];
    expect(row).toMatchObject({
      store_id: STORE_ID,
      kind: 'store_home',
      status: 'published',
      domain_settings_id: DOMAIN_ID,
    });
    expect(row.published_at).toBeInstanceOf(Date);
    // Empty but valid: it reads back as the default config, and unpublishing
    // gives the domain back to the landing.
    expect(parseStoreHomeConfig(row.config)).toEqual(defaultStoreHomeConfig());
    expect(row.config).toEqual({
      footer_text: null,
      domain_previous_app_type: 'STORE_LANDING',
      custom_domain_aliases: [],
    });
  });

  it('a second run reuses the row: no duplicate, config kept', async () => {
    const db = createInMemoryDb();
    const client = db.client as StoreAppsWriter;
    await ensureDefaultStoreHomeApp(client, STORE_ID, DOMAIN_ID);
    db.tables.store_apps[0].config = {
      ...db.tables.store_apps[0].config,
      footer_text: 'Hecho a mano',
    };

    await ensureDefaultStoreHomeApp(client, STORE_ID, DOMAIN_ID);

    expect(db.tables.store_apps).toHaveLength(1);
    expect(db.tables.store_apps[0].config.footer_text).toBe('Hecho a mano');
  });

  it('re-points and publishes an existing unpublished row instead of creating another', async () => {
    const db = createInMemoryDb({
      store_apps: [
        {
          id: 3,
          store_id: STORE_ID,
          kind: 'store_home',
          status: 'draft',
          domain_settings_id: null,
          config: { footer_text: 'Borrador' },
        },
      ],
    });

    await ensureDefaultStoreHomeApp(
      db.client as StoreAppsWriter,
      STORE_ID,
      DOMAIN_ID,
    );

    expect(db.tables.store_apps).toHaveLength(1);
    expect(db.tables.store_apps[0]).toMatchObject({
      id: 3,
      status: 'published',
      domain_settings_id: DOMAIN_ID,
    });
    expect(db.tables.store_apps[0].config).toMatchObject({
      footer_text: 'Borrador',
      domain_previous_app_type: 'STORE_LANDING',
    });
  });

  it('never touches another store', async () => {
    const db = createInMemoryDb({
      store_apps: [
        {
          id: 1,
          store_id: 99,
          kind: 'store_home',
          status: 'disabled',
          domain_settings_id: 5,
          config: {},
        },
      ],
    });

    await ensureDefaultStoreHomeApp(
      db.client as StoreAppsWriter,
      STORE_ID,
      DOMAIN_ID,
    );

    expect(db.tables.store_apps).toHaveLength(2);
    expect(db.tables.store_apps[0]).toMatchObject({
      store_id: 99,
      status: 'disabled',
      domain_settings_id: 5,
    });
  });
});
