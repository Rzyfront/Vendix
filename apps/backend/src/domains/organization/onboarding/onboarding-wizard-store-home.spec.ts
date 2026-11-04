import { DomainConfigService } from '@common/config/domain.config';
import { DomainGeneratorHelper } from '@common/helpers/domain-generator.helper';
import { BrandingGeneratorHelper } from '@common/helpers/branding-generator.helper';
import { createInMemoryDb, InMemoryDb } from '../../../testing/in-memory-db';
import { OnboardingWizardService } from './onboarding-wizard.service';

/**
 * Como dueño que termina el wizard de onboarding, quiero que el dominio
 * `{tienda}-store` de mi tienda quede como «Inicio de tienda» publicado, para
 * que al abrirlo vea la portada que lleva al panel tras el login.
 *
 * Runs the real `setupAppConfig` (the wizard step that creates the store's
 * default domain) over an in-memory database and asserts on stored rows.
 */
describe('OnboardingWizardService.setupAppConfig · Inicio de tienda por defecto', () => {
  const USER_ID = 11;
  const ORG_ID = 5;
  const STORE_ID = 21;
  let db: InMemoryDb;
  let service: OnboardingWizardService;

  const dto = {
    app_type: 'STORE_ADMIN',
    primary_color: '#112233',
    secondary_color: '#445566',
  } as any;

  const storeDomains = () =>
    (db.tables.domain_settings ?? []).filter((d) => d.domain_type === 'store');

  beforeEach(() => {
    jest
      .spyOn(DomainConfigService, 'getBaseDomain')
      .mockReturnValue('vendix.com');

    db = createInMemoryDb({
      users: [{ id: USER_ID, organization_id: ORG_ID }],
      stores: [
        {
          id: STORE_ID,
          organization_id: ORG_ID,
          name: 'Café Luna',
          slug: 'cafe-luna',
        },
      ],
    });

    service = new OnboardingWizardService(
      db.client as any,
      {} as any,
      {} as any,
      { generatePanelUI: jest.fn().mockResolvedValue({}) } as any,
      new DomainGeneratorHelper(),
      new BrandingGeneratorHelper(),
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('creates the -store domain as STORE_HOME with its store home published and linked', async () => {
    const result = await service.setupAppConfig(USER_ID, dto);

    expect(storeDomains()).toHaveLength(1);
    const domain = storeDomains()[0];
    expect(domain).toMatchObject({
      hostname: 'cafe-luna-store.vendix.com',
      store_id: STORE_ID,
      app_type: 'STORE_HOME',
      is_primary: true,
      status: 'active',
    });
    expect(result.store_domain).toMatchObject({ id: domain.id });

    expect(db.tables.store_apps).toHaveLength(1);
    expect(db.tables.store_apps[0]).toMatchObject({
      store_id: STORE_ID,
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

  it('a second run of the step reuses the domain and the app: no duplicates', async () => {
    await service.setupAppConfig(USER_ID, dto);
    await service.setupAppConfig(USER_ID, dto);

    expect(storeDomains()).toHaveLength(1);
    expect(storeDomains()[0].app_type).toBe('STORE_HOME');
    expect(db.tables.store_apps).toHaveLength(1);
    expect(db.tables.store_apps[0]).toMatchObject({
      status: 'published',
      domain_settings_id: storeDomains()[0].id,
    });
  });

  it('if the store home cannot be created, the store domain is rolled back too', async () => {
    db.client.store_apps.create = jest
      .fn()
      .mockRejectedValue(new Error('store_apps down'));

    await expect(service.setupAppConfig(USER_ID, dto)).rejects.toThrow(
      'store_apps down',
    );

    expect(storeDomains()).toHaveLength(0);
    expect(db.tables.store_apps ?? []).toHaveLength(0);
  });
});
