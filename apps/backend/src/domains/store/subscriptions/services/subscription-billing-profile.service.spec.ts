import { SubscriptionBillingProfileService } from './subscription-billing-profile.service';
import { BillingProfileDto } from '../dto/billing-profile.dto';

/**
 * The fiscal identity of the paying organization has two guards around it:
 *
 * 1. Vendix only asks for it while it really emits electronic invoices for its
 *    own subscriptions (platform switch on, pointing at production).
 * 2. Once the customer's own fiscal module is live, that module owns the
 *    identity and checkout may not rewrite it.
 *
 * Both are enforced server-side. The checkout UI mirrors them, but a hidden
 * button is not a guard, so these cases exercise the service directly.
 */
describe('SubscriptionBillingProfileService fiscal guards', () => {
  const ORG_ID = 7;

  const completeOrg = {
    legal_name: 'Comercial del Norte SAS',
    tax_id: '800987654-3',
    email: 'facturacion@norte.co',
    document_type: '31',
    verification_digit: '4',
    person_type: '1',
    tax_regime: '49',
    fiscal_responsibilities: ['R-99-PN'],
    // Una organización COMPLETA lleva su NIT en `fiscal_data`, no solo en la
    // columna: `isComplete` lo valida desde el JSON porque las columnas son una
    // proyección y pueden estar vacías o rancias — es la tesis del plan de SSOT.
    // Sin esto el fixture describe el contrato viejo y `complete` sale `false`.
    organization_settings: {
      settings: {
        fiscal_data: {
          nit: '800987654',
          legal_name: 'Comercial del Norte SAS',
          municipality_code: '11001',
          city: 'Bogotá',
          department: 'Bogotá D.C.',
          fiscal_address: 'Calle 10 # 20-30',
        },
      },
    },
    addresses: [
      {
        address_line1: 'Calle 10 # 20-30',
        address_line2: null,
        city: 'Bogotá',
        state_province: 'Bogotá D.C.',
        country_code: 'CO',
        postal_code: null,
        municipality_code: '11001',
      },
    ],
  };

  const profile: BillingProfileDto = {
    legal_name: 'Nombre Cambiado SAS',
    tax_id: '900123456',
    document_type: '31',
    address: {
      address_line1: 'Carrera 1 # 2-3',
      city: 'Medellín',
      municipality_code: '05001',
    },
  } as BillingProfileDto;

  /**
   * @param opts.platform  value stored under the platform billing settings key
   * @param opts.orgActive customer's fiscal module state at organization level
   * @param opts.org       organization row, or null for "not found"
   */
  const createService = (opts: {
    platform?: { is_enabled?: boolean; environment?: string } | null;
    orgActive?: boolean;
    org?: typeof completeOrg | null;
  }) => {
    const organizations = {
      findUnique: jest
        .fn()
        .mockResolvedValue(opts.org === undefined ? completeOrg : opts.org),
      update: jest.fn().mockResolvedValue({}),
    };
    const addresses = {
      findFirst: jest.fn().mockResolvedValue({ id: 1 }),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({}),
    };
    const client = {
      platform_settings: {
        findUnique: jest
          .fn()
          .mockResolvedValue(
            opts.platform === null || opts.platform === undefined
              ? null
              : { value: opts.platform },
          ),
      },
      organization_settings: {
        findFirst: jest
          .fn()
          .mockResolvedValue(opts.orgActive ? { id: 11 } : null),
      },
      // The store-level probe only runs when the organization-level one misses.
      store_settings: { findFirst: jest.fn().mockResolvedValue(null) },
      organizations,
      addresses,
      $transaction: jest.fn(async (fn: any) => fn({ organizations, addresses })),
    };
    const prisma = { withoutScope: () => client };

    return {
      service: new SubscriptionBillingProfileService(prisma as any),
      organizations,
      addresses,
      client,
    };
  };

  describe('platformInvoicingLive', () => {
    it('is false when the platform settings row does not exist', async () => {
      const { service } = createService({ platform: null });
      await expect(service.platformInvoicingLive()).resolves.toBe(false);
    });

    it('is false while the platform is still in the DIAN test environment', async () => {
      const { service } = createService({
        platform: { is_enabled: true, environment: 'test' },
      });
      await expect(service.platformInvoicingLive()).resolves.toBe(false);
    });

    it('is false when production is configured but the switch is off', async () => {
      const { service } = createService({
        platform: { is_enabled: false, environment: 'production' },
      });
      await expect(service.platformInvoicingLive()).resolves.toBe(false);
    });

    it('is true only with the switch on and pointing at production', async () => {
      const { service } = createService({
        platform: { is_enabled: true, environment: 'production' },
      });
      await expect(service.platformInvoicingLive()).resolves.toBe(true);
    });
  });

  describe('ensureCaptured', () => {
    it('does nothing while the platform does not emit invoices, even when required', async () => {
      const { service, organizations } = createService({ platform: null });

      await expect(
        service.ensureCaptured(ORG_ID, undefined, { required: true }),
      ).resolves.toBeUndefined();
      expect(organizations.update).not.toHaveBeenCalled();
    });

    it('drops an incoming profile while the platform does not emit invoices', async () => {
      const { service, organizations } = createService({ platform: null });

      await service.ensureCaptured(ORG_ID, profile, { required: true });

      expect(organizations.update).not.toHaveBeenCalled();
    });

    it('drops the edit when the customer fiscal module owns the identity', async () => {
      const { service, organizations } = createService({
        platform: { is_enabled: true, environment: 'production' },
        orgActive: true,
      });

      await service.ensureCaptured(ORG_ID, profile, { required: true });

      expect(organizations.update).not.toHaveBeenCalled();
    });

    it('saves the profile when the platform emits and the fiscal module is not active', async () => {
      const { service, organizations } = createService({
        platform: { is_enabled: true, environment: 'production' },
        orgActive: false,
      });

      await service.ensureCaptured(ORG_ID, profile, { required: true });

      expect(organizations.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: ORG_ID },
          data: expect.objectContaining({
            legal_name: 'Nombre Cambiado SAS',
            tax_id: '900123456',
            // Derived, never taken from the caller.
            verification_digit: '8',
          }),
        }),
      );
    });

    it('demands a profile when the charge is real and the organization has none', async () => {
      const { service } = createService({
        platform: { is_enabled: true, environment: 'production' },
        org: null,
      });

      await expect(
        service.ensureCaptured(ORG_ID, undefined, { required: true }),
      ).rejects.toMatchObject({ errorCode: 'SUBSCRIPTION_FISCAL_001' });
    });
  });

  describe('get', () => {
    it('reports enabled=false so checkout hides the fiscal section entirely', async () => {
      const { service } = createService({ platform: null, orgActive: true });

      const result = await service.get(ORG_ID);

      expect(result.enabled).toBe(false);
      // `locked` stays honest regardless — the section just is not rendered.
      expect(result.complete).toBe(true);
      expect(result.locked).toBe(true);
    });

    it('locks the profile when it is complete and the fiscal module is active', async () => {
      const { service } = createService({
        platform: { is_enabled: true, environment: 'production' },
        orgActive: true,
      });

      const result = await service.get(ORG_ID);

      expect(result).toMatchObject({
        enabled: true,
        complete: true,
        locked: true,
      });
      // El NIT sale del resolvedor único, que devuelve el número normalizado SIN
      // el DV — el DV viaja aparte en `nit_dv` y se deriva por módulo 11. La
      // columna guardaba '800987654-3', un par imposible: el DV real de
      // 800987654 es 4. Afirmar el valor de la columna era afirmar el defecto.
      expect(result.profile?.tax_id).toBe('800987654');
    });

    it('leaves the profile editable when the fiscal module is not active', async () => {
      const { service } = createService({
        platform: { is_enabled: true, environment: 'production' },
        orgActive: false,
      });

      await expect(service.get(ORG_ID)).resolves.toMatchObject({
        enabled: true,
        complete: true,
        locked: false,
      });
    });

    it('never locks an incomplete profile: the customer must be able to fix it', async () => {
      const { service } = createService({
        platform: { is_enabled: true, environment: 'production' },
        orgActive: true,
        org: { ...completeOrg, addresses: [] },
      });

      await expect(service.get(ORG_ID)).resolves.toMatchObject({
        enabled: true,
        complete: false,
        locked: false,
      });
    });
  });
});
