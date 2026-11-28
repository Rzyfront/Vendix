import {
  getPersistableDefaultStoreSettings,
  mergeStoreSettingsWithDefaults,
} from './default-store-settings';

describe('store settings defaults', () => {
  it('does not persist the legacy app projection by default', () => {
    const defaults = getPersistableDefaultStoreSettings();

    expect((defaults as any).app).toBeUndefined();
    expect(defaults.branding).toBeDefined();
  });

  it('fills missing settings sections and nested POS flags from defaults', () => {
    const merged = mergeStoreSettingsWithDefaults({
      general: {
        name: 'Tienda Test',
      },
      pos: {
        cash_register: {
          enabled: true,
        },
      },
      app: {
        name: 'Legacy App',
      },
    });

    expect(merged.general.name).toBe('Tienda Test');
    expect(merged.general.currency).toBe('COP');
    expect(merged.inventory.track_inventory).toBe(true);
    expect(merged.pos.allow_anonymous_sales).toBe(true);
    expect(merged.pos.cash_register?.enabled).toBe(true);
    expect(merged.pos.cash_register?.require_session_for_sales).toBe(false);
    expect((merged as any).app).toBeUndefined();
  });

  it('falls back to default section objects when persisted sections are invalid', () => {
    const merged = mergeStoreSettingsWithDefaults({
      pos: null,
      inventory: false,
    });

    expect(merged.pos.business_hours.monday.open).toBe('09:00');
    expect(merged.pos.cash_register?.auto_create_default_register).toBe(true);
    expect(merged.inventory.track_inventory).toBe(true);
  });

  // QUI-1005: the online store keeps selling add-ons until the owner says no.
  it('allows add-ons in the online store by default, also for stores that saved the section before the flag', () => {
    expect(getPersistableDefaultStoreSettings().product_options?.allow_online).toBe(true);
    expect(
      mergeStoreSettingsWithDefaults({ product_options: { enabled: true } }).product_options?.allow_online,
    ).toBe(true);
    expect(
      mergeStoreSettingsWithDefaults({ product_options: { enabled: true, allow_online: false } })
        .product_options?.allow_online,
    ).toBe(false);
  });

  // Vexi público F2: off for new stores and for existing stores that never
  // saved the block; independent from the admin `vexi.enabled` switch.
  it('keeps vexi_public off by default, also for stores with the admin Vexi on', () => {
    expect(getPersistableDefaultStoreSettings().vexi_public?.enabled).toBe(false);
    const existing = mergeStoreSettingsWithDefaults({ vexi: { enabled: true } } as any);
    expect(existing.vexi_public?.enabled).toBe(false);
    expect(
      mergeStoreSettingsWithDefaults({ vexi_public: { enabled: true } } as any).vexi_public?.enabled,
    ).toBe(true);
  });

  // agentes-admin S3: the floating Vex avatar ships off and keeps a stored Vex on.
  it('keeps vex.floating_avatar off by default without touching vex.enabled', () => {
    expect(getPersistableDefaultStoreSettings().vex?.floating_avatar).toBe(false);
    const existing = mergeStoreSettingsWithDefaults({ vex: { enabled: true } } as any);
    expect(existing.vex?.enabled).toBe(true);
    expect(existing.vex?.floating_avatar ?? false).toBe(false);
    expect(
      mergeStoreSettingsWithDefaults({ vex: { enabled: true, floating_avatar: true } } as any)
        .vex?.floating_avatar,
    ).toBe(true);
  });
});
