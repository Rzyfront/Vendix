import { RequestContextService } from '@common/context/request-context.service';
import { DomainConfigService } from '@common/config/domain.config';
import { DomainGeneratorHelper } from '@common/helpers/domain-generator.helper';
import { BrandingGeneratorHelper } from '@common/helpers/branding-generator.helper';
import { createInMemoryDb, InMemoryDb } from '../../../testing/in-memory-db';
import { StoresService } from './stores.service';

/**
 * S18 — la industria vive en dos lugares: la columna `stores.industries` (que
 * aplica el backend: `module-industries.ts`, `storeIsRestaurant`) y el espejo
 * `store_settings.settings.general.industries` (que lee el frontend:
 * `auth.facade.ts`). En prod las dos fuentes coinciden en las 111 tiendas
 * (L8), así que no se cambia lo que lee el frontend: este spec fija que toda
 * escritura de la industria actualiza las dos juntas, para que no vuelvan a
 * divergir y el panel no muestre módulos que el servidor rechaza.
 */
describe('StoresService · la industria se escribe en sus dos fuentes (S18)', () => {
  const ORG_ID = 3;
  let db: InMemoryDb;
  let service: StoresService;

  beforeEach(() => {
    jest.spyOn(DomainConfigService, 'getBaseDomain').mockReturnValue('vendix.com');
    jest.spyOn(RequestContextService, 'getOrganizationId').mockReturnValue(ORG_ID);
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ user_id: 1, organization_id: ORG_ID } as any);

    db = createInMemoryDb();
    const bootstrap = {
      createStoreWithDefaultLocation: jest.fn(async (input: any, tx: any) => {
        const store = await tx.stores.create({
          data: { ...input.store_data, organization_id: input.organization_id },
        });
        return { store };
      }),
    };
    service = new StoresService(
      db.client as any,
      new DomainGeneratorHelper(),
      new BrandingGeneratorHelper(),
      bootstrap as any,
      { createTrialForStore: jest.fn().mockResolvedValue(null) } as any,
      {} as any,
      { invalidateStore: jest.fn() } as any,
      {} as any,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('create: la columna y el espejo de settings guardan la misma lista', async () => {
    await service.create({
      name: 'Café Luna',
      store_type: 'physical',
      industries: ['restaurant', 'retail'],
    } as any);

    const store = db.tables.stores[0];
    const settings = db.tables.store_settings.find((s) => s.store_id === store.id);
    expect(store.industries).toEqual(['restaurant', 'retail']);
    expect(settings?.settings.general.industries).toEqual(store.industries);
  });

  it('create: una tienda nueva abre en el panel sugerido por su industria (QUI-967)', async () => {
    await service.create({
      name: 'Hotel Sol',
      store_type: 'physical',
      industries: ['retail', 'hospitality'],
    } as any);
    await service.create({
      name: 'Repostería Miel',
      store_type: 'physical',
      industries: ['restaurant'],
      settings: {
        home_panel: { default_panel: 'summary', enabled_panels: ['summary'] },
      },
    } as any);

    await service.create({
      name: 'Salón Brisa',
      store_type: 'physical',
      industries: ['service'],
      settings: { home_panel: { default_panel: 'widgets', enabled_panels: [] } },
    } as any);

    await service.create({
      name: 'Tienda Sin Industria',
      store_type: 'physical',
      settings: {
        pos: { tips: { enabled: true } },
        home_panel: { default_panel: 'nope', enabled_panels: ['nope'] },
      },
    } as any);

    const [hotel, bakery, salon, plain] = db.tables.store_settings.map(
      (s) => s.settings,
    );
    // Without industries an invalid panel is dropped (the store keeps the Resumen).
    expect(plain.home_panel).toBeUndefined();
    expect(plain.pos).toEqual({ tips: { enabled: true } });
    // An invalid panel in the free-form payload falls back to the suggestion.
    expect(salon.home_panel).toEqual({
      default_panel: 'reservations_agenda',
      enabled_panels: ['reservations_agenda', 'summary'],
    });
    expect(hotel.home_panel).toEqual({
      default_panel: 'occupancy',
      enabled_panels: ['occupancy', 'summary'],
    });
    // A payload that already chose a panel keeps it.
    expect(bakery.home_panel).toEqual({
      default_panel: 'summary',
      enabled_panels: ['summary'],
    });
  });

  it('create: el espejo conserva el resto de los settings que traía el DTO', async () => {
    await service.create({
      name: 'Café Luna',
      store_type: 'physical',
      industries: ['restaurant'],
      settings: { general: { timezone: 'America/Bogota' }, pos: { tips: { enabled: true } } },
    } as any);

    const settings = db.tables.store_settings[0].settings;
    expect(settings.general).toEqual({
      timezone: 'America/Bogota',
      industries: ['restaurant'],
    });
    expect(settings.pos).toEqual({ tips: { enabled: true } });
  });

  it('update: la columna y el espejo de settings cambian juntos', async () => {
    await service.create({
      name: 'Café Luna',
      store_type: 'physical',
      industries: ['retail'],
    } as any);
    const id = db.tables.stores[0].id;

    await service.update(id, { industries: ['restaurant'] } as any);

    const store = db.tables.stores.find((s) => s.id === id)!;
    const settings = db.tables.store_settings.find((s) => s.store_id === id)!;
    expect(store.industries).toEqual(['restaurant']);
    expect(settings.settings.general.industries).toEqual(['restaurant']);
  });

  it('update sin industries no toca ninguna de las dos fuentes', async () => {
    await service.create({
      name: 'Café Luna',
      store_type: 'physical',
      industries: ['restaurant'],
    } as any);
    const id = db.tables.stores[0].id;

    await service.update(id, { name: 'Café Luna 2' } as any);

    expect(db.tables.stores.find((s) => s.id === id)!.industries).toEqual(['restaurant']);
    expect(db.tables.store_settings.find((s) => s.store_id === id)!.settings.general.industries).toEqual([
      'restaurant',
    ]);
  });
  /**
   * QUI-983 — editar industrias (o settings parciales) desde la organización
   * reemplazaba el JSON completo de `store_settings.settings` por lo que traía
   * el DTO: se perdían fiscal_data, invoicing, pos… y general.timezone/currency.
   */
  describe('update conserva la configuración guardada (QUI-983)', () => {
    const stored = () => ({
      general: {
        timezone: 'America/Bogota',
        currency: 'COP',
        name: 'Café Luna',
        store_type: 'physical',
        industries: ['retail'],
      },
      fiscal_data: { nit: '900123456', dv: '7', tax_regime: 'common' },
      invoicing: { prefix: 'FE', next_number: 120 },
      branding: { primary_color: '#112233' },
      pos: { tips: { enabled: true }, allow_negative_stock: false },
      vexi: { enabled: true },
      hospitality: { default_overbooking_allowance: 2 },
    });

    const seedStore = async () => {
      await service.create({
        name: 'Café Luna',
        store_type: 'physical',
        industries: ['retail'],
      } as any);
      const id = db.tables.stores[0].id;
      db.tables.store_settings.find((s) => s.store_id === id)!.settings = stored();
      return id;
    };

    const settingsOf = (id: number) =>
      db.tables.store_settings.find((s) => s.store_id === id)!.settings;

    it('cambiar industrias solo cambia general.industries', async () => {
      const id = await seedStore();

      await service.update(id, { industries: ['restaurant', 'retail'] } as any);

      const expected = stored();
      expected.general.industries = ['restaurant', 'retail'];
      expect(settingsOf(id)).toEqual(expected);
      expect(db.tables.stores.find((s) => s.id === id)!.industries).toEqual([
        'restaurant',
        'retail',
      ]);
    });

    it('settings parciales se fusionan por sección sin borrar lo demás', async () => {
      const id = await seedStore();

      await service.update(id, {
        industries: ['restaurant'],
        settings: { pos: { tips: { enabled: false } }, general: { currency: 'USD' } },
      } as any);

      const expected: any = stored();
      expected.general.currency = 'USD';
      expected.general.industries = ['restaurant'];
      expected.pos.tips = { enabled: false };
      expect(settingsOf(id)).toEqual(expected);
    });

    it('sin fila de settings previa crea el espejo de industrias', async () => {
      await service.create({ name: 'Café Luna', store_type: 'physical' } as any);
      const id = db.tables.stores[0].id;
      expect(db.tables.store_settings ?? []).toHaveLength(0);

      await service.update(id, { industries: ['restaurant'] } as any);

      expect(settingsOf(id)).toEqual({ general: { industries: ['restaurant'] } });
    });
  });
});
