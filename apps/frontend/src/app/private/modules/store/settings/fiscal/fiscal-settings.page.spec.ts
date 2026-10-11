import { FISCAL_SETTINGS_TEMPLATE } from './fiscal-settings.template';

describe('FISCAL_SETTINGS_TEMPLATE', () => {
  it('omits tenant AIU settings but keeps POS/ecommerce invoicing and the profile link', () => {
    expect(FISCAL_SETTINGS_TEMPLATE).not.toContain(
      '<app-aiu-settings-section',
    );
    expect(FISCAL_SETTINGS_TEMPLATE).toContain(
      '<app-pos-invoicing-settings-section',
    );
    expect(FISCAL_SETTINGS_TEMPLATE).toContain(
      'routerLink="/admin/invoicing/profiles"',
    );
    expect(FISCAL_SETTINGS_TEMPLATE).toContain('Perfiles de facturación');
  });
});
