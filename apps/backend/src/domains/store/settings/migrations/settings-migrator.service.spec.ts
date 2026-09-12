import {
  SettingsMigratorService,
  CURRENT_SCHEMA_VERSION,
  MIGRATIONS,
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
        // Already at the current version — nothing left to migrate. Pinned to
        // CURRENT_SCHEMA_VERSION (not a literal `3`) so this idempotency check
        // keeps meaning "already fully migrated" as new migrations land.
        _schema_version: CURRENT_SCHEMA_VERSION,
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

  describe('dead auto_issue_invoice toggle retirement (v3 -> v4)', () => {
    it('translates an explicit false into invoicing.pos/ecommerce.auto_emit and drops the dead key', () => {
      const raw = {
        _schema_version: 3,
        receipts: { auto_issue_invoice: false },
      };

      const { migrated, changed, toVersion } = migrator.migrate(raw);

      expect(changed).toBe(true);
      expect(toVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(migrated.invoicing.pos.auto_emit).toBe(false);
      expect(migrated.invoicing.ecommerce.auto_emit).toBe(false);
      expect(migrated.receipts.auto_issue_invoice).toBeUndefined();
    });

    it('respects an explicit auto_emit already set by the merchant in Caja', () => {
      const raw = {
        _schema_version: 3,
        receipts: { auto_issue_invoice: false },
        invoicing: { pos: { auto_emit: true } },
      };

      const { migrated } = migrator.migrate(raw);

      // The explicit value the store already configured wins over the migration.
      expect(migrated.invoicing.pos.auto_emit).toBe(true);
      expect(migrated.invoicing.ecommerce.auto_emit).toBe(false);
    });

    it('does not create the invoicing block when auto_issue_invoice was not false', () => {
      const raw = {
        _schema_version: 3,
        receipts: { auto_issue_invoice: true },
      };

      const { migrated } = migrator.migrate(raw);

      expect(migrated.invoicing).toBeUndefined();
      expect(migrated.receipts.auto_issue_invoice).toBeUndefined();
    });

    it('drops send_invoice_email and deliver_printed but preserves invoice_copies', () => {
      const raw = {
        _schema_version: 3,
        receipts: {
          send_invoice_email: true,
          deliver_printed: false,
          invoice_copies: 2,
        },
      };

      const { migrated } = migrator.migrate(raw);

      expect(migrated.receipts.send_invoice_email).toBeUndefined();
      expect(migrated.receipts.deliver_printed).toBeUndefined();
      expect(migrated.receipts.invoice_copies).toBe(2);
    });

    it('is idempotent: applying the migration twice yields the same result', () => {
      const raw = {
        _schema_version: 3,
        receipts: {
          auto_issue_invoice: false,
          send_invoice_email: true,
          deliver_printed: false,
          invoice_copies: 1,
        },
      };

      const migration = MIGRATIONS.find((m) => m.from === 3 && m.to === 4)!;
      const once = migration.apply({ ...raw, receipts: { ...raw.receipts } });
      const twice = migration.apply({ ...once });

      expect(twice).toEqual(once);
    });
  });
});
