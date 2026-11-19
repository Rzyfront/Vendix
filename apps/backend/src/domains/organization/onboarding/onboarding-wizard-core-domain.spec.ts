import { ConflictException } from '@nestjs/common';
import { DomainConfigService } from '@common/config/domain.config';
import { DomainGeneratorHelper } from '@common/helpers/domain-generator.helper';
import { BrandingGeneratorHelper } from '@common/helpers/branding-generator.helper';
import { createInMemoryDb, InMemoryDb } from '../../../testing/in-memory-db';
import { OnboardingWizardService } from './onboarding-wizard.service';

/**
 * Como Vendix, quiero que cuando alguien complete el onboarding de la
 * organización plataforma (la dueña de vendix.online) el wizard no toque el
 * dominio core, para que la landing pública nunca deje de resolver.
 *
 * Antes, `setupAppConfig` tomaba el PRIMER dominio de la organización, fuera
 * del tipo que fuera, lo renombraba a `{slug}-org` y lo pasaba a ORG_LANDING
 * con config vacía: vendix.online desaparecía.
 *
 * Corre el `setupAppConfig` real sobre una base en memoria.
 */
describe('OnboardingWizardService.setupAppConfig · dominio core de la plataforma', () => {
  const USER_ID = 11;
  const ORG_ID = 1;
  const STORE_ID = 1;
  const CORE_CONFIG = { landing: { hero: 'Vendix' } };
  let db: InMemoryDb;
  let service: OnboardingWizardService;

  const dto = {
    app_type: 'STORE_ADMIN',
    primary_color: '#112233',
    secondary_color: '#445566',
  } as any;

  function build(coreDomainType: string) {
    db = createInMemoryDb({
      users: [{ id: USER_ID, organization_id: ORG_ID }],
      organizations: [{ id: ORG_ID, name: 'Vendix Platform', slug: 'vendix' }],
      stores: [
        {
          id: STORE_ID,
          organization_id: ORG_ID,
          name: 'Vendix Platform',
          slug: 'vendix-crm',
        },
      ],
      domain_settings: [
        {
          id: 1,
          hostname: 'vendix.online',
          organization_id: ORG_ID,
          store_id: null,
          domain_type: coreDomainType,
          app_type: 'VENDIX_LANDING',
          is_primary: true,
          status: 'active',
          ownership: 'vendix_core',
          config: CORE_CONFIG,
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
  }

  const coreDomain = () =>
    (db.tables.domain_settings ?? []).find((d) => d.id === 1);

  beforeEach(() => {
    jest
      .spyOn(DomainConfigService, 'getBaseDomain')
      .mockReturnValue('vendix.online');
  });

  afterEach(() => jest.restoreAllMocks());

  it.each(['vendix_core', 'organization'])(
    'leaves the core domain (domain_type %s) untouched and creates its own -org domain',
    async (coreDomainType) => {
      build(coreDomainType);

      await service.setupAppConfig(USER_ID, dto);

      expect(coreDomain()).toMatchObject({
        hostname: 'vendix.online',
        app_type: 'VENDIX_LANDING',
        domain_type: coreDomainType,
        is_primary: true,
        status: 'active',
        config: CORE_CONFIG,
      });

      const orgDomains = (db.tables.domain_settings ?? []).filter(
        (d) => d.id !== 1 && d.organization_id === ORG_ID,
      );
      expect(orgDomains).toHaveLength(1);
      expect(orgDomains[0]).toMatchObject({
        app_type: 'ORG_LANDING',
        domain_type: 'organization',
      });
      expect(orgDomains[0].hostname).toContain('-org.');
    },
  );

  it('rejects using the core hostname as a custom domain', async () => {
    build('vendix_core');

    await expect(
      service.setupAppConfig(USER_ID, {
        ...dto,
        use_custom_domain: true,
        custom_domain: 'Vendix.Online',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(coreDomain()).toMatchObject({
      hostname: 'vendix.online',
      app_type: 'VENDIX_LANDING',
      config: CORE_CONFIG,
    });
  });
});
