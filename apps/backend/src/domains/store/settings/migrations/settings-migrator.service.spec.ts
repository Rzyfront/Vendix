import {
  SettingsMigratorService,
  CURRENT_SCHEMA_VERSION,
} from './settings-migrator.service';

describe('SettingsMigratorService', () => {
  let migrator: SettingsMigratorService;

  beforeEach(() => {
    migrator = new SettingsMigratorService();
  });

  describe('promotions home-section backfill (v2 -> v3)', () => {
    it('backfills a disabled (opt-in) promotions section for stores with home_sections', () => {
      const raw = {
        _schema_version: 2,
        ecommerce: {
          home_sections: {
            featured_products: { enabled: true, sort_order: 50 },
          },
        },
      };

      const { migrated, changed, toVersion } = migrator.migrate(raw);

      expect(changed).toBe(true);
      expect(toVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(migrated.ecommerce.home_sections.promotions).toEqual({
        enabled: false,
        title: 'Promociones activas',
        sort_order: 60,
      });
      // The opt-in default must be OFF so existing storefronts are unchanged.
      expect(migrated.ecommerce.home_sections.promotions.enabled).toBe(false);
      // Sibling sections are preserved untouched.
      expect(migrated.ecommerce.home_sections.featured_products).toEqual({
        enabled: true,
        sort_order: 50,
      });
    });

    it('is idempotent: preserves an existing promotions section', () => {
      const existing = {
        enabled: true,
        title: 'Mis promos',
        sort_order: 15,
      };
      const raw = {
        _schema_version: 3,
        ecommerce: {
          home_sections: {
            featured_products: { enabled: true, sort_order: 50 },
            promotions: { ...existing },
          },
        },
      };

      const { migrated, changed } = migrator.migrate(raw);

      expect(changed).toBe(false);
      expect(migrated.ecommerce.home_sections.promotions).toEqual(existing);
    });

    it('does not inject an ecommerce/home_sections block when the store never had one', () => {
      const raw = { _schema_version: 2, pos: { schedule_mode: 'continuous' } };

      const { migrated } = migrator.migrate(raw);

      expect(migrated.ecommerce).toBeUndefined();
    });

    it('chains from legacy versions and still backfills promotions', () => {
      const raw = {
        // No _schema_version => treated as v0; runs 0->1, 1->2, 2->3.
        ecommerce: {
          home_sections: {
            featured_products: { enabled: true, sort_order: 50 },
          },
        },
      };

      const { migrated, changed, toVersion } = migrator.migrate(raw);

      expect(changed).toBe(true);
      expect(toVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(migrated._schema_version).toBe(CURRENT_SCHEMA_VERSION);
      expect(migrated.ecommerce.home_sections.promotions.enabled).toBe(false);
    });
  });
});
