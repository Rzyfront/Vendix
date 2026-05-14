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
});
