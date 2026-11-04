import { ConflictException } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { DomainConfigService } from '@common/config/domain.config';
import { DomainGeneratorHelper } from '@common/helpers/domain-generator.helper';
import { BrandingGeneratorHelper } from '@common/helpers/branding-generator.helper';
import { createInMemoryDb, InMemoryDb } from '../../../testing/in-memory-db';
import { StoresService } from './stores.service';

/**
 * Como dueño de una organización en el panel, quiero que cada tienda nueva
 * nazca con «Inicio de tienda» publicado en su dominio `{tienda}-store`, para
 * que al abrirlo vea la portada que lleva al panel tras el login (y no la
 * landing vieja).
 *
 * Runs the real `StoresService.create` over an in-memory database, so the
 * assertions read the stored `domain_settings` and `store_apps` rows.
 */
describe('StoresService.create · Inicio de tienda por defecto', () => {
  const ORG_ID = 3;
  let db: InMemoryDb;
  let service: StoresService;
  let trial: { createTrialForStore: jest.Mock };

  beforeEach(() => {
    jest
      .spyOn(DomainConfigService, 'getBaseDomain')
      .mockReturnValue('vendix.com');
    jest
      .spyOn(RequestContextService, 'getOrganizationId')
      .mockReturnValue(ORG_ID);
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ user_id: 1, organization_id: ORG_ID } as any);

    db = createInMemoryDb();
    trial = { createTrialForStore: jest.fn().mockResolvedValue(null) };
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
      trial as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('creates the -store domain as STORE_HOME with its store home published and linked', async () => {
    await service.create({ name: 'Café Luna', store_type: 'physical' } as any);

    const store = db.tables.stores[0];
    expect(db.tables.domain_settings).toHaveLength(1);
    const domain = db.tables.domain_settings[0];
    expect(domain).toMatchObject({
      hostname: 'cafe-luna-store.vendix.com',
      store_id: store.id,
      app_type: 'STORE_HOME',
      domain_type: 'store',
      is_primary: true,
      status: 'active',
    });

    expect(db.tables.store_apps).toHaveLength(1);
    expect(db.tables.store_apps[0]).toMatchObject({
      store_id: store.id,
      kind: 'store_home',
      status: 'published',
      domain_settings_id: domain.id,
      config: {
        footer_text: null,
        domain_previous_app_type: 'STORE_LANDING',
        custom_domain_aliases: [],
      },
    });
  });

  it('a second run for the same store duplicates neither the domain nor the app', async () => {
    await service.create({ name: 'Café Luna', store_type: 'physical' } as any);

    await expect(
      service.create({ name: 'Café Luna', store_type: 'physical' } as any),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(db.tables.stores).toHaveLength(1);
    expect(db.tables.domain_settings).toHaveLength(1);
    expect(db.tables.store_apps).toHaveLength(1);
  });

  it('if the store home cannot be created, nothing of the store is left behind', async () => {
    const original = db.client.store_apps.create;
    db.client.store_apps.create = jest
      .fn()
      .mockRejectedValue(new Error('store_apps down'));

    await expect(
      service.create({ name: 'Café Luna', store_type: 'physical' } as any),
    ).rejects.toThrow('store_apps down');

    expect(db.tables.stores ?? []).toHaveLength(0);
    expect(db.tables.domain_settings ?? []).toHaveLength(0);
    expect(db.tables.store_apps ?? []).toHaveLength(0);
    db.client.store_apps.create = original;
  });
});
