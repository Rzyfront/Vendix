import { SubscriptionBillingProfileService } from './subscription-billing-profile.service';
import { BillingProfileDto } from '../dto/billing-profile.dto';
// El validador REAL, no un doble. Un doble que siempre dice «emitible» probaría
// que el cableado existe y nada más; el punto de la compuerta es que el juicio
// sea el MISMO que el de la emisión, y eso solo se prueba con el juez de verdad.
import { CustomerFiscalIdentityValidator } from '../../invoicing/validators/customer-fiscal-identity.validator';

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
        // `type` decide el escalón de la cascada. Sin él, la dirección fiscal
        // de la organización se clasificaba como «cualquier otra» y el fixture
        // dejaba de describir el caso que representa.
        type: 'billing',
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
      service: new SubscriptionBillingProfileService(
        prisma as any,
        new CustomerFiscalIdentityValidator(),
      ),
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

  /**
   * La segunda compuerta (3.5). Capturar los seis campos no es lo mismo que
   * poder emitir: pueden estar TODOS y el documento seguir sin salir.
   *
   * El 17/08/2026 una compra pasó porque `getBillingProfile()` falló en el
   * cliente, la sección fiscal se apagó sola y el formulario dejó pasar el
   * cobro. Desde acá la autoridad es el backend, como en el POS: se corta con
   * 422 ANTES de crear la factura y de abrir el widget, para que el cliente no
   * quede pagado y sin documento.
   */
  describe('ensureCaptured — prevalidación de emisión (SUBSCRIPTION_FISCAL_002)', () => {
    const PLATFORM_LIVE = { is_enabled: true, environment: 'production' };

    /** Organización completa salvo por el campo que cada caso rompe. */
    const orgWith = (patch: Record<string, unknown>) => ({
      ...completeOrg,
      ...patch,
    });

    /**
     * `details` no es una propiedad de `VendixHttpException`: viaja dentro del
     * cuerpo que `HttpException` guarda. Leerla como `error.details` daba
     * `undefined` y el `toMatchObject` pasaba sin comprobar nada.
     */
    const detailsOf = (error: unknown): Record<string, any> =>
      (error as { getResponse(): { details?: Record<string, any> } }).getResponse()
        .details ?? {};

    it('deja pasar una identidad que sí emite', async () => {
      const { service } = createService({
        platform: PLATFORM_LIVE,
        orgActive: false,
      });

      await expect(
        service.ensureCaptured(ORG_ID, profile, { required: true }),
      ).resolves.toBeUndefined();
    });

    it('no se deja bloquear por un verification_digit rancio en columna', async () => {
      // El fixture guarda '4' pero el NIT 800987654 deriva otro DV. El emisor
      // usa SIEMPRE el derivado, así que la compuerta tiene que juzgar ese y no
      // el de la columna — si juzgara la columna, cortaría compras sanas.
      const { service } = createService({
        platform: PLATFORM_LIVE,
        orgActive: false,
        org: orgWith({ verification_digit: '9' }) as any,
      });

      await expect(
        service.ensureCaptured(ORG_ID, profile, { required: true }),
      ).resolves.toBeUndefined();
    });

    it('deja pasar una identidad con cédula de ciudadanía sin inyectarle dígito de verificación', async () => {
      const { service } = createService({
        platform: PLATFORM_LIVE,
        orgActive: false,
        org: orgWith({
          document_type: '13',
          tax_id: '1118860902',
          verification_digit: null,
          person_type: '2',
        }) as any,
      });

      await expect(
        service.ensureCaptured(ORG_ID, profile, { required: true }),
      ).resolves.toBeUndefined();
    });

    it('corta con 422 cuando el correo del adquiriente no es un correo', async () => {
      const { service } = createService({
        platform: PLATFORM_LIVE,
        orgActive: false,
        org: orgWith({ email: 'facturacion-arroba-norte' }) as any,
      });

      const error = await service
        .ensureCaptured(ORG_ID, profile, { required: true })
        .catch((e) => e);

      expect(error).toMatchObject({ errorCode: 'SUBSCRIPTION_FISCAL_002' });
      expect(detailsOf(error).blockers.map((b: any) => b.code)).toContain(
        'EMAIL_MALFORMED',
      );
    });

    it('corta con 422 cuando el NIT es un relleno y no un NIT', async () => {
      const { service } = createService({
        platform: PLATFORM_LIVE,
        orgActive: false,
        org: orgWith({ tax_id: '123' }) as any,
      });

      const error = await service
        .ensureCaptured(ORG_ID, profile, { required: true })
        .catch((e) => e);

      expect(error).toMatchObject({ errorCode: 'SUBSCRIPTION_FISCAL_002' });
      expect(detailsOf(error).blockers.map((b: any) => b.code)).toContain(
        'DOCUMENT_NUMBER_PLACEHOLDER',
      );
    });

    it('corta con 422 cuando el NIT tiene una longitud imposible', async () => {
      const { service } = createService({
        platform: PLATFORM_LIVE,
        orgActive: false,
        org: orgWith({ tax_id: '80098765432109876' }) as any,
      });

      const error = await service
        .ensureCaptured(ORG_ID, profile, { required: true })
        .catch((e) => e);

      expect(error).toMatchObject({ errorCode: 'SUBSCRIPTION_FISCAL_002' });
      expect(detailsOf(error).blockers.map((b: any) => b.code)).toContain(
        'DOCUMENT_NUMBER_IMPLAUSIBLE_LENGTH',
      );
    });

    it('cada bloqueo nombra el campo y la pantalla donde se arregla', async () => {
      const { service } = createService({
        platform: PLATFORM_LIVE,
        orgActive: false,
        org: orgWith({ email: 'sin-arroba' }) as any,
      });

      const error = await service
        .ensureCaptured(ORG_ID, profile, { required: true })
        .catch((e) => e);

      const [blocker] = detailsOf(error).blockers;
      expect(blocker.field).toBe('email');
      expect(blocker.problem.length).toBeGreaterThan(0);
      expect(blocker.fix.length).toBeGreaterThan(0);
    });

    it('no prevalida cuando el commit no cobra: sin documento no hay nada que juzgar', async () => {
      const { service } = createService({
        platform: PLATFORM_LIVE,
        orgActive: false,
        org: orgWith({ email: 'sin-arroba' }) as any,
      });

      await expect(
        service.ensureCaptured(ORG_ID, profile, { required: false }),
      ).resolves.toBeUndefined();
    });

    it('no prevalida mientras la plataforma no emite facturas reales', async () => {
      const { service } = createService({
        platform: null,
        org: orgWith({ email: 'sin-arroba' }) as any,
      });

      await expect(
        service.ensureCaptured(ORG_ID, profile, { required: true }),
      ).resolves.toBeUndefined();
    });

    it('también corta cuando el módulo fiscal del cliente es el dueño de la identidad', async () => {
      // Que el cliente sea dueño del dato no lo hace emitible. Saltarse la
      // compuerta acá dejaba abierta la misma puerta por la que entró el
      // incidente, solo que para los tenants que ya facturan.
      const { service } = createService({
        platform: PLATFORM_LIVE,
        orgActive: true,
        org: orgWith({ email: 'sin-arroba' }) as any,
      });

      await expect(
        service.ensureCaptured(ORG_ID, profile, { required: true }),
      ).rejects.toMatchObject({ errorCode: 'SUBSCRIPTION_FISCAL_002' });
    });
  });

  /**
   * `isComplete` traducía mal la fila de `addresses`: casteaba la fila cruda
   * (`address_line1`, `city`, `municipality_code`) al contrato de la cascada
   * (`address_line`, `city_name`, `city_code`). El cast compila y en ejecución
   * deja los tres campos en `undefined`, así que TODA organización salía
   * incompleta — incluida una con su dirección fiscal perfecta.
   */
  describe('isComplete — traducción fila → candidato', () => {
    it('reconoce como completa una organización con dirección fiscal emitible', async () => {
      const { service } = createService({
        platform: { is_enabled: true, environment: 'production' },
      });

      await expect(service.isComplete(ORG_ID)).resolves.toBe(true);
    });

    it('sigue rechazando una dirección colombiana sin municipio DANE', async () => {
      const { service } = createService({
        platform: { is_enabled: true, environment: 'production' },
        org: {
          ...completeOrg,
          addresses: [
            { ...completeOrg.addresses[0], municipality_code: null },
          ],
        } as any,
      });

      await expect(service.isComplete(ORG_ID)).resolves.toBe(false);
    });
  });

  describe('evaluateEmitReadiness', () => {
    it('reporta sin lanzar y sin escribir, para que una pantalla pueda consultarlo', async () => {
      const { service, organizations, addresses } = createService({
        platform: { is_enabled: true, environment: 'production' },
        org: { ...completeOrg, email: 'sin-arroba' } as any,
      });

      const result = await service.evaluateEmitReadiness(ORG_ID);

      expect(result.emittable).toBe(false);
      expect(result.blockers.map((b) => b.code)).toContain('EMAIL_MALFORMED');
      expect(organizations.update).not.toHaveBeenCalled();
      expect(addresses.update).not.toHaveBeenCalled();
    });

    it('el régimen «49» del checkout no se reporta como desconocido', async () => {
      // '48'/'49' son códigos DIAN, no `tax_regime_enum`. Juzgarlos con el
      // catálogo equivocado producía una advertencia permanente sobre un dato
      // correcto — y una advertencia que sale siempre deja de leerse.
      const { service } = createService({
        platform: { is_enabled: true, environment: 'production' },
      });

      const result = await service.evaluateEmitReadiness(ORG_ID);

      expect(result.emittable).toBe(true);
      expect([...result.blockers, ...result.warnings].map((f) => f.code)).not.toContain(
        'TAX_REGIME_UNKNOWN',
      );
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
