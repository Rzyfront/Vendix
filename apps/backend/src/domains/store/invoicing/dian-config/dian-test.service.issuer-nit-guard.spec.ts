import { DianTestService } from './dian-test.service';
import { VendixHttpException } from 'src/common/errors';
import { RequestContextService } from '../../../../common/context/request-context.service';

/**
 * El NIT del emisor que sale en el XML (fiscal_data gana sobre config.nit) debe
 * coincidir con el NIT de la configuración DIAN ANTES de reservar numeración o
 * hablar con la DIAN. Ejemplo: fiscal_data `90012345` vs config `900123456`.
 */
describe('DianTestService — guarda de NIT del emisor', () => {
  const TECHNICAL_KEY = '0123456789abcdef0123456789abcdef01234567';

  const build = (config_nit: string, fiscal_nit: string) => {
    const config = {
      id: 27,
      name: 'Licores',
      nit: config_nit,
      test_set_id: 'set-1',
      enablement_status: 'testing',
      last_test_result: null,
      environment: 'test',
      operation_mode: 'own_software',
      software_pin_encrypted: 'pin',
      certificate_password_encrypted: null,
      certificate_s3_key: null,
      accounting_entity_id: 5,
    };
    const resolution = {
      id: 9,
      organization_id: 1,
      accounting_entity_id: 5,
      document_type: 'invoice',
      resolution_number: '18760000001',
      prefix: 'SETP',
      range_from: 990000000,
      range_to: 995000000,
      current_number: 0,
      is_active: true,
      valid_from: new Date('2020-01-01'),
      valid_to: new Date('2099-01-01'),
    };
    const entity = {
      name: 'Licores',
      legal_name: 'Licores SAS',
      fiscal_scope: 'STORE',
      organization: {
        organization_settings: null,
        addresses: [],
        email: null,
      },
      store: {
        store_settings: {
          settings: {
            fiscal_data: {
              nit: fiscal_nit,
              legal_name: 'Licores SAS',
              municipality_code: '85001',
              department: 'Casanare',
            },
          },
        },
        addresses: [],
      },
    };
    const prisma: any = {
      dian_configurations: {
        findFirst: jest.fn().mockResolvedValue(config),
        update: jest.fn(),
      },
      invoice_resolutions: {
        findFirst: jest
          .fn()
          .mockImplementation(({ where }: any) =>
            Promise.resolve(where.id === 9 ? resolution : null),
          ),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      organizations: { findFirst: jest.fn().mockResolvedValue(null) },
      withoutScope: jest.fn().mockReturnValue({
        invoices: { count: jest.fn().mockResolvedValue(0) },
        accounting_entities: {
          findFirst: jest.fn().mockResolvedValue(entity),
        },
      }),
    };
    const soap_client: any = {
      sendTestSetAsync: jest.fn(),
      sendBillSync: jest.fn(),
      getStatusZip: jest.fn(),
    };
    const s3_service: any = { downloadImage: jest.fn() };
    const service = new DianTestService(
      prisma,
      { decrypt: jest.fn().mockReturnValue('x') } as any,
      soap_client,
      {} as any,
      s3_service,
      {} as any,
      { upgradeInPlace: jest.fn() } as any,
      { reveal: jest.fn().mockReturnValue(TECHNICAL_KEY) } as any,
      {} as any,
    );
    return { service, prisma, soap_client, s3_service };
  };

  beforeEach(() => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ organization_id: 1 } as any);
  });
  afterEach(() => jest.restoreAllMocks());

  it('rechaza con DIAN_TEST_SET_009 sin reservar numeración ni llamar a la DIAN cuando los NIT difieren', async () => {
    const { service, prisma, soap_client, s3_service } = build(
      '900123456',
      '90012345',
    );

    const error: VendixHttpException = await service
      .executeTestSet(27, 9, { smoke: true })
      .then(
        () => {
          throw new Error('debió rechazar');
        },
        (e) => e,
      );

    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.errorCode).toBe('DIAN_TEST_SET_009');
    expect(error.message).toContain('90012345');
    expect(error.message).toContain('900123456');
    expect(error.message).toContain('Identidad legal');
    expect(prisma.invoice_resolutions.updateMany).not.toHaveBeenCalled();
    expect(prisma.dian_configurations.update).not.toHaveBeenCalled();
    expect(s3_service.downloadImage).not.toHaveBeenCalled();
    expect(soap_client.sendTestSetAsync).not.toHaveBeenCalled();
    expect(soap_client.sendBillSync).not.toHaveBeenCalled();
  });

  it('con NIT coincidente (config con DV) sigue el flujo de siempre: reserva numeración', async () => {
    const { service, prisma } = build('900123456-8', '900123456');

    await expect(
      service.executeTestSet(27, 9, { smoke: true }),
    ).rejects.toMatchObject({
      errorCode: 'DIAN_CERT_001',
    });
    expect(prisma.invoice_resolutions.updateMany).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['iguales', '900123456', '900123456'],
    ['emisor con DV pegado', '900123456', '9001234568'],
    ['config con DV pegado', '9001234568', '900123456'],
  ])(
    'NIT %s (%s vs %s) no bloquea: reserva numeración',
    async (_caso, config_nit, fiscal_nit) => {
      const { service, prisma } = build(config_nit, fiscal_nit);

      await expect(
        service.executeTestSet(27, 9, { smoke: true }),
      ).rejects.toMatchObject({
        errorCode: 'DIAN_CERT_001',
      });
      expect(prisma.invoice_resolutions.updateMany).toHaveBeenCalledTimes(1);
    },
  );

  it('con config.nit vacío no bloquea: reserva numeración como antes', async () => {
    const { service, prisma } = build('', '900123456');

    await expect(
      service.executeTestSet(27, 9, { smoke: true }),
    ).rejects.toMatchObject({
      errorCode: 'DIAN_CERT_001',
    });
    expect(prisma.invoice_resolutions.updateMany).toHaveBeenCalledTimes(1);
  });
});
