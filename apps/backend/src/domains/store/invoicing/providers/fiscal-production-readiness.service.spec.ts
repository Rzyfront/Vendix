import { FiscalProductionReadinessService } from './fiscal-production-readiness.service';

describe('FiscalProductionReadinessService', () => {
  const createService = (config: any = null) => {
    const client = {
      dian_configurations: {
        findFirst: jest.fn().mockResolvedValue(config),
      },
      invoice_resolutions: {
        findFirst: jest.fn().mockResolvedValue({
          id: 9,
          current_number: 10,
          range_to: 100,
        }),
        // La detección de clave técnica compartida consulta `findMany`. Por
        // defecto: nadie más comparte la clave.
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const prisma = { withoutScope: () => client };
    return {
      service: new FiscalProductionReadinessService(prisma as any, {
        // A real master key configured: the platform check must pass so these
        // tests keep asserting the tenant-side prerequisites.
        isUsingFallbackKey: () => false,
        // Secrets already in the current envelope, so the `secrets_envelope`
        // warning stays quiet and does not pollute the other assertions.
        needsReencryption: () => false,
      } as any),
      client,
    };
  };

  const readyConfig = (overrides: any = {}) => ({
    id: 1,
    operation_mode: 'own_software',
    environment: 'production',
    enablement_status: 'enabled',
    software_id: 'abc',
    software_pin_encrypted: 'encrypted-pin',
    certificate_s3_key: 'certs/tenant.p12',
    certificate_password_encrypted: 'encrypted-password',
    certificate_expiry: new Date('2099-01-01T00:00:00Z'),
    certificate_fingerprint: 'fingerprint',
    certificate_nit: '900123456',
    enablement_evidence: { track_id: 'track-1' },
    test_set_id: 'set-1',
    last_test_result: { success: true },
    nit: '900123456',
    accounting_entity_id: 77,
    // Una configuración LISTA es una que ya se comprobó y salió limpia. `null` es
    // ese estado; los tests que ejercitan el hallazgo o el caso sin comprobar lo
    // sobreescriben de forma explícita.
    shared_technical_key: null,
    ...overrides,
  });

  const originalNodeEnv = process.env.NODE_ENV;
  const originalEncryptionKey = process.env.DIAN_ENCRYPTION_KEY;

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    if (originalEncryptionKey === undefined) {
      delete process.env.DIAN_ENCRYPTION_KEY;
    } else {
      process.env.DIAN_ENCRYPTION_KEY = originalEncryptionKey;
    }
  });

  it('requires own-software enabled production configuration in production mode', async () => {
    process.env.NODE_ENV = 'production';
    process.env.DIAN_ENCRYPTION_KEY = 'test-key';
    const { service, client } = createService(readyConfig());

    await expect(
      service.resolveOwnSoftwareConfig({
        organization_id: 1,
        store_id: 2,
        accounting_entity_id: 77,
        configuration_type: 'invoicing',
      }),
    ).resolves.toMatchObject({ id: 1 });

    expect(client.invoice_resolutions.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        organization_id: 1,
        accounting_entity_id: 77,
        document_type: 'sales_invoice',
        is_active: true,
      }),
      select: { id: true, current_number: true, range_to: true },
    });

    expect(client.dian_configurations.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        organization_id: 1,
        accounting_entity_id: 77,
        configuration_type: 'invoicing',
        operation_mode: 'own_software',
        environment: 'production',
      }),
      orderBy: [{ is_default: 'desc' }, { created_at: 'desc' }],
    });
  });

  it('blocks production when enablement evidence or secrets are missing', () => {
    const { service } = createService();
    delete process.env.DIAN_ENCRYPTION_KEY;

    expect(() =>
      service.assertProductionReady(
        readyConfig({
          software_pin_encrypted: null,
          last_test_result: null,
          enablement_evidence: null,
        }),
      ),
    ).toThrow(expect.objectContaining({ errorCode: 'DIAN_ENABLEMENT_001' }));
  });

  it('blocks expired certificates before production activation', () => {
    const { service } = createService();
    process.env.DIAN_ENCRYPTION_KEY = 'test-key';

    expect(() =>
      service.assertProductionReady(
        readyConfig({ certificate_expiry: new Date('2000-01-01T00:00:00Z') }),
      ),
    ).toThrow(expect.objectContaining({ errorCode: 'DIAN_CERT_003' }));
  });

  it('blocks production when certificate NIT does not match config NIT', () => {
    const { service } = createService();
    process.env.DIAN_ENCRYPTION_KEY = 'test-key';

    expect(() =>
      service.assertProductionReady(
        readyConfig({ certificate_nit: '999999999' }),
      ),
    ).toThrow(expect.objectContaining({ errorCode: 'DIAN_CERT_004' }));
  });

  it('blocks production when fiscal resolution is missing or exhausted', async () => {
    process.env.NODE_ENV = 'production';
    process.env.DIAN_ENCRYPTION_KEY = 'test-key';
    const { service } = createService(readyConfig());
    const client = (service as any).prisma.withoutScope();
    // `mockResolvedValue`, no `...Once`: la ruta hace DOS lecturas de
    // `invoice_resolutions` — la del detector de clave técnica compartida y la del
    // agotamiento del rango— y con `Once` la primera se quedaba el valor y la
    // segunda recibía el mock por defecto, que no está agotado.
    client.invoice_resolutions.findFirst.mockResolvedValue({
      id: 9,
      current_number: 100,
      range_to: 100,
    });

    await expect(
      service.resolveOwnSoftwareConfig({
        organization_id: 1,
        store_id: 2,
        accounting_entity_id: 77,
        configuration_type: 'invoicing',
      }),
    ).rejects.toMatchObject({ errorCode: 'FISCAL_RESOLUTION_EXHAUSTED' });
  });

  describe('clave técnica compartida entre NIT (§4.5 del anexo)', () => {
    // Forma REAL medida en producción: tres resoluciones de tres NIT distintos
    // comparten número de autorización, rango y clave técnica. La DIAN asigna la
    // ClTec por rango y por NIT, y alimenta el CUFE sin viajar en el XML, así que
    // como mínimo dos de las tres calculan un CUFE que la DIAN recomputa distinto.
    const CLTEC = 'f7cc345ca297aa11bb22cc33dd44ee55ff66aa77';

    function withResolutions(own: any, others: any[]) {
      const client = {
        dian_configurations: { findFirst: jest.fn() },
        invoice_resolutions: {
          findFirst: jest.fn().mockResolvedValue(own),
          findMany: jest.fn().mockResolvedValue(others),
        },
      };
      return new FiscalProductionReadinessService(
        { withoutScope: () => client } as any,
        {
          isUsingFallbackKey: () => false,
          needsReencryption: () => false,
        } as any,
      );
    }

    const PARAMS = {
      organization_id: 1,
      store_id: null,
      accounting_entity_id: 95,
      configuration_type: 'invoicing' as const,
    };

    it('detecta la clave compartida con otro NIT y nombra las resoluciones', async () => {
      const service = withResolutions(
        {
          id: 10,
          technical_key: CLTEC,
          accounting_entity: { tax_id: '902056589' },
        },
        [
          { id: 8, accounting_entity: { tax_id: '902075738' } },
          { id: 9, accounting_entity: { tax_id: '902056589' } },
        ],
      );

      const finding = await service.findResolutionsSharingTechnicalKey(
        PARAMS,
        'production',
      );

      expect(finding).not.toBeNull();
      expect(finding!.resolution_id).toBe(10);
      // La 9 es del MISMO NIT (otra entidad contable del mismo obligado): no es
      // un hallazgo. La 8 es de otro NIT: sí lo es.
      expect(finding!.foreign).toEqual([
        { resolution_id: 8, tax_id: '902075738' },
      ]);
    });

    it('no reporta nada cuando la clave solo la usan entidades del mismo NIT', async () => {
      const service = withResolutions(
        {
          id: 10,
          technical_key: CLTEC,
          accounting_entity: { tax_id: '902056589' },
        },
        [{ id: 9, accounting_entity: { tax_id: '9020565899' } }],
      );

      // Mismo NIT con el DV pegado: `onlyDigits` no basta, así que se compara la
      // base. Aquí se afirma el comportamiento actual — comparación por dígitos—
      // para que un cambio futuro sea visible.
      const finding = await service.findResolutionsSharingTechnicalKey(
        PARAMS,
        'production',
      );
      expect(finding?.foreign.map((f) => f.resolution_id)).toEqual([9]);
    });

    it('no reporta nada cuando la resolución no tiene clave técnica', async () => {
      const service = withResolutions(
        { id: 10, technical_key: null, accounting_entity: { tax_id: '902056589' } },
        [],
      );

      await expect(
        service.findResolutionsSharingTechnicalKey(PARAMS, 'production'),
      ).resolves.toBeNull();
    });

    it('NO reporta nada en habilitación: la DIAN da a todos el mismo rango', async () => {
      // Verificado contra el portal de habilitación de dos NIT distintos: prefijo
      // SETP, resolución 18760000001, rango 990000000-995000000 y la MISMA clave
      // técnica. Compartirla ahí no es contaminación entre tenants, es cómo
      // funciona el ambiente de pruebas. La primera versión de este check no lo
      // distinguía y habría bloqueado a todo tenant en habilitación.
      const service = withResolutions(
        {
          id: 10,
          technical_key: CLTEC,
          accounting_entity: { tax_id: '902056589' },
        },
        [{ id: 8, accounting_entity: { tax_id: '902075738' } }],
      );

      await expect(
        service.findResolutionsSharingTechnicalKey(PARAMS, 'test'),
      ).resolves.toBeNull();
      await expect(
        service.findResolutionsSharingTechnicalKey(PARAMS, undefined),
      ).resolves.toBeNull();
    });

    it('el checklist marca la comprobación como no satisfecha y explica qué copiar', () => {
      const { service } = createService(readyConfig());

      const report = service.evaluateProductionReadiness({
        ...readyConfig(),
        shared_technical_key: {
          resolution_id: 10,
          foreign: [{ resolution_id: 8, tax_id: '902075738' }],
        },
      });

      const check = report.checks.find((c) => c.key === 'technical_key_per_nit');
      expect(check?.satisfied).toBe(false);
      expect(check?.action).toMatch(/902075738/);
      expect(check?.action).toMatch(/portal de habilitación/);
      // Bloqueante: emitir con una ClTec ajena gasta el consecutivo.
      expect(report.missing).toContain('technical_key_per_nit');
    });

    it('FALLA CERRADO cuando el llamador no comprobó el hallazgo', () => {
      const { service } = createService(readyConfig());

      // `undefined`, no `null`: un llamador que difunde una fila de
      // `StorePrismaService` compila sin el campo pese a ser obligatorio, porque
      // sus modelos cuelgan de un `scoped_client: any`. La comprobación no puede
      // afirmar que está limpia sin haberla hecho.
      const report = service.evaluateProductionReadiness({
        ...readyConfig(),
        shared_technical_key: undefined as any,
      });

      const check = report.checks.find((c) => c.key === 'technical_key_per_nit');
      expect(check?.satisfied).toBe(false);
      expect(check?.action).toMatch(/No se comprobó/);
      expect(report.missing).toContain('technical_key_per_nit');
    });

    it('el checklist la marca satisfecha cuando el hallazgo es null', () => {
      const { service } = createService(readyConfig());

      const report = service.evaluateProductionReadiness({
        ...readyConfig(),
        shared_technical_key: null,
      });

      expect(
        report.checks.find((c) => c.key === 'technical_key_per_nit')?.satisfied,
      ).toBe(true);
      expect(report.missing).not.toContain('technical_key_per_nit');
    });
  });

  describe('alertas anticipadas', () => {
    const NOW = new Date('2026-06-01T12:00:00Z');

    it('does not warn while the certificate has more runway than the widest tier', () => {
      const { service } = createService();
      const check = service.buildCertificateExpiryWarning(
        new Date('2026-12-01T12:00:00Z'),
        NOW,
      );

      expect(check.satisfied).toBe(true);
      expect(check.severity).toBe('warning');
    });

    it.each([
      ['30 days', '2026-06-25T12:00:00Z', 24, 'Agenda la renovación'],
      ['15 days', '2026-06-13T12:00:00Z', 12, 'esta semana'],
      ['7 days', '2026-06-05T12:00:00Z', 4, 'YA'],
    ])(
      'escalates the certificate alert at the %s tier',
      (_label, expiry, expected_days, expected_copy) => {
        const { service } = createService();
        const check = service.buildCertificateExpiryWarning(
          new Date(expiry as string),
          NOW,
        );

        expect(check.satisfied).toBe(false);
        expect(check.days_remaining).toBe(expected_days);
        expect(check.action).toContain(expected_copy as string);
      },
    );

    it('floors the countdown instead of rounding it up', () => {
      const { service } = createService();
      // 6 days and 23 hours left must read 6, never 7: a renewal scheduled for
      // day 7 would land after the certificate is already dead.
      const check = service.buildCertificateExpiryWarning(
        new Date('2026-06-08T11:00:00Z'),
        NOW,
      );

      expect(check.days_remaining).toBe(6);
    });

    it('stays silent for an already-expired certificate (the blocking check owns it)', () => {
      const { service } = createService();
      const check = service.buildCertificateExpiryWarning(
        new Date('2020-01-01T00:00:00Z'),
        NOW,
      );

      expect(check.satisfied).toBe(true);
    });

    it('never lets a warning flip `ready` to false', () => {
      const { service } = createService();
      const report = service.evaluateProductionReadiness(
        readyConfig({
          // 3 days left: fires the most urgent tier, yet emission still works.
          certificate_expiry: new Date(Date.now() + 3 * 86_400_000),
        }),
      );

      expect(report.ready).toBe(true);
      expect(report.missing).toEqual([]);
      expect(report.warnings.map((w) => w.key)).toContain(
        'certificate_expiry_soon',
      );
    });

    it('reports the platform fallback encryption key as a blocker', () => {
      const prisma = { withoutScope: () => ({}) } as any;
      const service = new FiscalProductionReadinessService(prisma, {
        isUsingFallbackKey: () => true,
        needsReencryption: () => false,
      } as any);

      const report = service.evaluateProductionReadiness(readyConfig());

      expect(report.ready).toBe(false);
      expect(report.missing).toContain('DIAN_ENCRYPTION_KEY');
      expect(
        report.checks.find((c) => c.key === 'DIAN_ENCRYPTION_KEY')?.owner,
      ).toBe('platform');
    });

    /**
     * The secrets decrypt correctly today; only the KDF salt is weaker. Blocking
     * emission over that would turn a hardening item into an outage, so it must
     * land in `warnings` and leave `ready` alone.
     */
    it('warns about secrets in the legacy envelope WITHOUT blocking emission', () => {
      const prisma = { withoutScope: () => ({}) } as any;
      const service = new FiscalProductionReadinessService(prisma, {
        isUsingFallbackKey: () => false,
        needsReencryption: () => true,
      } as any);

      const report = service.evaluateProductionReadiness(readyConfig());

      expect(report.ready).toBe(true);
      expect(report.missing).not.toContain('secrets_envelope');
      expect(report.warnings.map((w) => w.key)).toContain('secrets_envelope');
      expect(
        report.checks.find((c) => c.key === 'secrets_envelope')?.owner,
      ).toBe('platform');
    });

    /**
     * With no real key there is nothing better to rewrite under, and the blocking
     * DIAN_ENCRYPTION_KEY check already says so. A second message about it would
     * be noise on a screen the merchant is supposed to act on.
     */
    /**
     * An exportable key inside an encrypted `.p12` is a legal, valid configuration
     * — the DIAN requires a certificate, not an HSM. Blocking emission over it
     * would stop a merchant from invoicing for a hardening they never agreed to,
     * which is the outage the alert exists to prevent.
     */
    it('warns about an exportable private key WITHOUT blocking emission', () => {
      const { service } = createService();

      const report = service.evaluateProductionReadiness(readyConfig());

      expect(report.ready).toBe(true);
      expect(report.missing).not.toContain('private_key_custody');
      expect(report.warnings.map((w) => w.key)).toContain(
        'private_key_custody',
      );
      const check = report.checks.find((c) => c.key === 'private_key_custody');
      expect(check?.owner).toBe('platform');
      // The action must name the exact provisioning step, not "harden custody".
      expect(check?.action).toContain('certificate_kms_key_id');
      expect(check?.action).toContain('SIGN_VERIFY');
    });

    it('goes quiet once the private key lives in KMS', () => {
      const { service } = createService();

      const report = service.evaluateProductionReadiness({
        ...readyConfig(),
        certificate_kms_key_id: 'arn:aws:kms:us-east-1:1:key/abc',
      });

      expect(report.warnings.map((w) => w.key)).not.toContain(
        'private_key_custody',
      );
      expect(
        report.checks.find((c) => c.key === 'private_key_custody')?.satisfied,
      ).toBe(true);
    });

    it('does not warn about the envelope while running on the fallback key', () => {
      const prisma = { withoutScope: () => ({}) } as any;
      const service = new FiscalProductionReadinessService(prisma, {
        isUsingFallbackKey: () => true,
        needsReencryption: () => true,
      } as any);

      const report = service.evaluateProductionReadiness(readyConfig());

      expect(report.warnings.map((w) => w.key)).not.toContain(
        'secrets_envelope',
      );
    });

    it('warns at or below 10% of the authorized numbering range', () => {
      const { service } = createService();
      const check = service.buildResolutionRangeWarning({
        prefix: 'FE',
        range_from: 1,
        range_to: 1000,
        current_number: 950,
      });

      expect(check.satisfied).toBe(false);
      expect(check.percent_remaining).toBe(5);
      expect(check.action).toContain('50 números');
    });

    it('stays quiet above the range threshold', () => {
      const { service } = createService();
      const check = service.buildResolutionRangeWarning({
        prefix: 'FE',
        range_from: 1,
        range_to: 1000,
        current_number: 500,
      });

      expect(check.satisfied).toBe(true);
      expect(check.percent_remaining).toBe(50);
    });

    it('measures the share against the AUTHORIZED range, not against the burn rate', () => {
      const { service } = createService();
      // A range starting at 500_000: using range_to alone as the denominator
      // would report ~0.02% and fire a permanent false alarm.
      const check = service.buildResolutionRangeWarning({
        prefix: 'FE',
        range_from: 500_000,
        range_to: 501_000,
        current_number: 500_100,
      });

      expect(check.satisfied).toBe(true);
      expect(check.percent_remaining).toBeCloseTo(89.9, 1);
    });
  });
});
