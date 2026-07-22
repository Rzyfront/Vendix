import {
  buildSettingsUpdatePayload,
  flattenPanelUi,
  nestPanelUi,
  normalizeSettingsResponse,
} from './settings-payload';
import type { StoreSettings } from '../types/settings.types';

const original: Partial<StoreSettings> = {
  general: { name: 'Tienda', currency: 'COP', timezone: 'America/Bogota' } as StoreSettings['general'],
  panel_ui: { STORE_ADMIN: { dashboard: true, pos: true } },
};

describe('flattenPanelUi / nestPanelUi', () => {
  it('extrae la app objetivo y descarta las otras apps', () => {
    expect(
      flattenPanelUi({ STORE_ADMIN: { dashboard: false }, STORE_ECOMMERCE: { profile: true } }),
    ).toEqual({ dashboard: false });
  });

  it('devuelve un objeto vacío si no hay panel_ui', () => {
    expect(flattenPanelUi(undefined)).toBeUndefined();
  });

  it('nestPanelUi envuelve bajo STORE_ADMIN por defecto', () => {
    expect(nestPanelUi({ dashboard: true })).toEqual({
      STORE_ADMIN: { dashboard: true },
    });
  });
});

describe('buildSettingsUpdatePayload', () => {
  it('devuelve null si no hay cambios en ninguna sección', () => {
    const form: Partial<StoreSettings> = {
      ...original,
      panel_ui: { STORE_ADMIN: { dashboard: true, pos: true } },
    };
    expect(buildSettingsUpdatePayload(form, original)).toBeNull();
  });

  it('incluye solo las secciones modificadas', () => {
    const form: Partial<StoreSettings> = {
      ...original,
      general: { name: 'Tienda Nueva', currency: 'COP', timezone: 'America/Bogota' } as StoreSettings['general'],
    };
    const result = buildSettingsUpdatePayload(form, original);
    expect(result).toEqual({
      general: { name: 'Tienda Nueva', currency: 'COP', timezone: 'America/Bogota' },
    });
  });

  it('anida panel_ui antes de enviar', () => {
    const form: Partial<StoreSettings> = {
      ...original,
      panel_ui: { STORE_ADMIN: { dashboard: true, pos: false } },
    };
    const result = buildSettingsUpdatePayload(form, original);
    expect(result).toEqual({ panel_ui: { STORE_ADMIN: { dashboard: true, pos: false } } });
  });

  it('preserva STORE_ECOMMERCE intacto si el form ya lo trae', () => {
    const form: Partial<StoreSettings> = {
      ...original,
      panel_ui: {
        STORE_ADMIN: { dashboard: false, pos: true },
        STORE_ECOMMERCE: { profile: true },
      },
    };
    const result = buildSettingsUpdatePayload(form, original);
    expect(result?.panel_ui).toEqual({
      STORE_ADMIN: { dashboard: false, pos: true },
    });
    expect(
      (result?.panel_ui as { STORE_ECOMMERCE?: unknown })?.STORE_ECOMMERCE,
    ).toBeUndefined();
  });

  it('omite secciones no presentes en el form', () => {
    const form: Partial<StoreSettings> = {
      panel_ui: { STORE_ADMIN: { dashboard: false, pos: true } },
    };
    const result = buildSettingsUpdatePayload(form, original);
    expect(result).toEqual({ panel_ui: { STORE_ADMIN: { dashboard: false, pos: true } } });
    expect(result?.general).toBeUndefined();
  });

  it('ignora claves no controladas por la app (no se envían aunque cambien)', () => {
    const form = {
      ...original,
      app: { name: 'NOPE', primary_color: '#fff', secondary_color: '#000', accent_color: '#000', theme: 'default', logo_url: null, favicon_url: null } as StoreSettings['app'],
      branding: { name: 'NOPE' } as unknown as Record<string, unknown>,
      fiscal_status: { invoicing: { state: 'ACTIVE' } } as unknown as Record<string, unknown>,
    };
    const result = buildSettingsUpdatePayload(form, original);
    expect(result).toBeNull();
  });
});

describe('normalizeSettingsResponse', () => {
  it('devuelve la respuesta tal cual (la app ya habla del shape del backend)', () => {
    const raw: Partial<StoreSettings> = { panel_ui: { STORE_ADMIN: { dashboard: false } } };
    expect(normalizeSettingsResponse(raw)).toBe(raw);
  });

  it('tolera null/undefined', () => {
    expect(normalizeSettingsResponse(null)).toBeNull();
    expect(normalizeSettingsResponse(undefined)).toBeNull();
  });
});
