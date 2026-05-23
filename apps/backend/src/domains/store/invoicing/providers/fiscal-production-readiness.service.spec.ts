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
      },
    };
    const prisma = { withoutScope: () => client };
    return {
      service: new FiscalProductionReadinessService(prisma as any),
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
    client.invoice_resolutions.findFirst.mockResolvedValueOnce({
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
});
