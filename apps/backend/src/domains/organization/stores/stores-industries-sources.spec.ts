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
});
