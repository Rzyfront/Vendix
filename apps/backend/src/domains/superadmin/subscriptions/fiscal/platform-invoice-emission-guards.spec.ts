import { SubscriptionFiscalService } from './subscription-fiscal.service';
import { PlatformInvoicingService } from './platform-invoicing.service';
import { CreatePlatformInvoiceDto } from './dto/subscription-fiscal.dto';
import { CustomerFiscalIdentityValidator } from '../../../store/invoicing/validators/customer-fiscal-identity.validator';
import { FiscalDocumentValidator } from '../../../store/invoicing/validators/fiscal-document.validator';
import { ErrorCodes, VendixHttpException } from '../../../../common/errors';

/**
 * FASE 1.4 / 1.5 y 2.5.
 *
 * 1.4  Sin certificado vigente NO se emite (error claro ANTES del consecutivo)
 *      y la respuesta refleja el estado REAL de la transmisión.
 * 1.5  Una colisión de idempotencia nunca responde 500: ni la repetición
 *      secuencial ni la carrera concurrente (P2002 dentro de la transacción).
 * 2.5  `save_as_profile` ya no invierte forma y medio de pago.
 */

const TECHNICAL_KEY = 'a'.repeat(64);

function resolutionRow() {
  const now = new Date();
  return {
    id: 77,
    resolution_number: '18760000001',
    prefix: 'FE',
    range_from: 1,
    range_to: 1000,
    current_number: 0,
    valid_from: new Date(now.getFullYear() - 1, 0, 1),
    valid_to: new Date(now.getFullYear() + 1, 11, 31),
    is_active: true,
    technical_key: TECHNICAL_KEY,
    document_type: 'sales_invoice',
  };
}

const GOOD_CERT = {
  id: 9,
  certificate_s3_key: 'certs/platform.p12',
  certificate_password_encrypted: 'enc',
  certificate_kms_key_id: null,
  certificate_expiry: new Date(Date.now() + 90 * 86400000),
};

const DTO = {
  customer: {
    legal_name: 'Comercializadora Andina S.A.S.',
    tax_id: '902056589',
    tax_id_dv: '9',
    email: 'facturacion@andina.co',
    document_type: '31',
    person_type: '1',
    tax_regime_code: '48',
    fiscal_responsibilities: ['O-13'],
  },
  items: [{ description: 'Implementación', quantity: 1, unit_price: 100000 }],
} as CreatePlatformInvoiceDto;

interface Opts {
  cert?: any;
  prior?: any;
  txError?: any;
  winner?: any;
  finalRow?: any;
  providerResponse?: any;
}

function build(opts: Opts = {}) {
  const tx = {
    fiscal_transmissions: {
      findFirst: jest.fn().mockResolvedValue(opts.prior ?? null),
      create: jest.fn(async ({ data }: any) => ({ id: 501, ...data })),
    },
    fiscal_evidences: { create: jest.fn().mockResolvedValue({ id: 1 }) },
  };
  const finalRow = opts.finalRow ?? {
    id: 501,
    document_number: 'FE1',
    transmission_status: 'accepted',
    dian_status: 'accepted',
    cufe: 'cufe-123',
    error_message: null,
  };
  const winnerFindFirst = jest.fn().mockResolvedValue(opts.winner ?? null);
  const prisma = {
    withoutScope: () => ({
      invoice_resolutions: {
        findFirst: jest.fn().mockResolvedValue(resolutionRow()),
      },
      dian_configurations: {
        findUnique: jest
          .fn()
          .mockResolvedValue(opts.cert === undefined ? GOOD_CERT : opts.cert),
      },
      fiscal_transmissions: {
        findFirst: winnerFindFirst,
        findUnique: jest.fn().mockResolvedValue(finalRow),
      },
    }),
    $transaction: jest.fn(async (cb: any) => {
      if (opts.txError) throw opts.txError;
      return cb(tx);
    }),
  };
  const dianProvider = {
    sendInvoice: jest
      .fn()
      .mockResolvedValue(opts.providerResponse ?? { success: true }),
  };
  const unused = {};
  const service: any = Reflect.construct(SubscriptionFiscalService, [
    prisma,
    unused,
    unused,
    dianProvider,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    { reveal: () => TECHNICAL_KEY },
    new CustomerFiscalIdentityValidator(),
    new FiscalDocumentValidator(),
    unused,
    unused,
  ]);
  jest.spyOn(service, 'getSettings').mockResolvedValue({
    is_enabled: true,
    platform_organization_id: 1,
    accounting_entity_id: 5,
    dian_configuration_id: 9,
    invoice_resolution_id: 77,
  });
  const allocate = jest.spyOn(service, 'allocateFiscalNumber').mockResolvedValue({
    invoice_number: 'FE1',
    resolution: resolutionRow(),
  });
  const submitted = jest.spyOn(service, 'markSubmitted').mockResolvedValue(undefined);
  const accepted = jest.spyOn(service, 'markAccepted').mockResolvedValue(undefined);
  const rejected = jest.spyOn(service, 'markRejected').mockResolvedValue(undefined);
  jest.spyOn(service, 'markError').mockResolvedValue(undefined);
  return { service, tx, prisma, dianProvider, allocate, submitted, accepted, rejected };
}

async function expectCode(promise: Promise<unknown>, code: string) {
  let error: any;
  try {
    await promise;
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(VendixHttpException);
  expect(error.getResponse().error_code).toBe(code);
}

describe('createPlatformInvoice — certificado de firma (F1.4)', () => {
  it('sin certificado => FISCAL_CONFIG_INCOMPLETE y NO se asigna consecutivo ni se crea la fila', async () => {
    const h = build({ cert: { id: 9, certificate_s3_key: null } });
    await expectCode(h.service.createPlatformInvoice(DTO), 'FISCAL_CONFIG_INCOMPLETE');
    expect(h.allocate).not.toHaveBeenCalled();
    expect(h.tx.fiscal_transmissions.create).not.toHaveBeenCalled();
    expect(h.dianProvider.sendInvoice).not.toHaveBeenCalled();
  });

  it('certificado sin credencial de firma (ni clave ni KMS) tampoco emite', async () => {
    const h = build({
      cert: {
        id: 9,
        certificate_s3_key: 'k',
        certificate_password_encrypted: null,
        certificate_kms_key_id: null,
      },
    });
    await expectCode(h.service.createPlatformInvoice(DTO), 'FISCAL_CONFIG_INCOMPLETE');
    expect(h.allocate).not.toHaveBeenCalled();
  });

  it('sin configuración DIAN cargada => mismo error claro', async () => {
    const h = build({ cert: null });
    await expectCode(h.service.createPlatformInvoice(DTO), 'FISCAL_CONFIG_INCOMPLETE');
    expect(h.allocate).not.toHaveBeenCalled();
  });

  it('certificado vencido => DIAN_CERT_003 antes del consecutivo', async () => {
    const h = build({
      cert: { ...GOOD_CERT, certificate_expiry: new Date(Date.now() - 1000) },
    });
    await expectCode(h.service.createPlatformInvoice(DTO), 'DIAN_CERT_003');
    expect(h.allocate).not.toHaveBeenCalled();
  });

  it('el reenvío también exige certificado antes de tocar la transmisión', async () => {
    const h = build({ cert: null });
    jest.spyOn(h.service, 'runInPlatformContext').mockImplementation(
      async (_s: any, fn: any) => fn(),
    );
    const originalSnapshot = {
      kind: 'platform_invoice_snapshot',
      resolution_id: 77,
      provider_data: { items: [], taxes: [] },
    };
    (h.prisma as any).withoutScope = () => ({
      fiscal_transmissions: {
        findFirst: jest.fn().mockResolvedValue({ id: 501, document_number: 'FE1', created_at: new Date() }),
      },
      fiscal_evidences: {
        findFirst: jest.fn().mockResolvedValue({ metadata: originalSnapshot }),
      },
      invoice_resolutions: { findFirst: jest.fn().mockResolvedValue(resolutionRow()) },
      dian_configurations: { findUnique: jest.fn().mockResolvedValue(null) },
    });
    await expectCode(h.service.resendPlatformTransmission(501), 'FISCAL_CONFIG_INCOMPLETE');
    expect(h.submitted).not.toHaveBeenCalled();
    expect(h.dianProvider.sendInvoice).not.toHaveBeenCalled();
  });
});

describe('createPlatformInvoice — la respuesta refleja el estado REAL (F1.4)', () => {
  it('DIAN acepta => accepted: true, sin error_message', async () => {
    const h = build();
    const r = await h.service.createPlatformInvoice(DTO);
    expect(r).toMatchObject({
      accepted: true,
      transmission_status: 'accepted',
      dian_status: 'accepted',
      cufe: 'cufe-123',
      fiscal_number: 'FE1',
      error_message: null,
    });
    expect(h.accepted).toHaveBeenCalled();
  });

  it('DIAN rechaza => accepted: false y el motivo viaja en error_message (no un «creada» mudo)', async () => {
    const h = build({
      providerResponse: { success: false, errors: ['FAU02'] },
      finalRow: {
        id: 501,
        document_number: 'FE1',
        transmission_status: 'rejected',
        dian_status: 'rejected',
        cufe: null,
        error_message: 'FAU02: la suma de líneas no cuadra',
      },
    });
    const r = await h.service.createPlatformInvoice(DTO);
    expect(r.accepted).toBe(false);
    expect(r.transmission_status).toBe('rejected');
    expect(r.error_message).toBe('FAU02: la suma de líneas no cuadra');
    expect(h.rejected).toHaveBeenCalled();
    expect(r.invoice_id).toBe(501);
  });
});

describe('createPlatformInvoice — idempotencia nunca responde 500 (F1.5)', () => {
  const EXISTING = {
    id: 400,
    document_number: 'FE9',
    transmission_status: 'accepted',
  };

  it('repetición: devuelve la factura existente SIN asignar número ni reenviar', async () => {
    const h = build({
      prior: EXISTING,
      finalRow: {
        id: 400,
        document_number: 'FE9',
        transmission_status: 'accepted',
        dian_status: 'accepted',
        cufe: 'c',
        error_message: null,
      },
    });
    const r = await h.service.createPlatformInvoice(DTO);
    expect(r).toMatchObject({
      invoice_id: 400,
      fiscal_number: 'FE9',
      idempotent_replay: true,
      accepted: true,
    });
    expect(h.allocate).not.toHaveBeenCalled();
    expect(h.tx.fiscal_transmissions.create).not.toHaveBeenCalled();
    expect(h.submitted).not.toHaveBeenCalled();
    expect(h.dianProvider.sendInvoice).not.toHaveBeenCalled();
  });

  it('carrera concurrente (P2002 dentro de la transacción): devuelve la ganadora, no 500', async () => {
    const h = build({
      txError: Object.assign(new Error('Unique constraint failed'), {
        code: 'P2002',
      }),
      winner: { id: 400, document_number: 'FE9' },
      finalRow: {
        id: 400,
        document_number: 'FE9',
        transmission_status: 'submitted',
        dian_status: 'pending',
        cufe: null,
        error_message: null,
      },
    });
    const r = await h.service.createPlatformInvoice(DTO);
    expect(r).toMatchObject({
      invoice_id: 400,
      idempotent_replay: true,
      accepted: false,
      transmission_status: 'submitted',
    });
    expect(h.dianProvider.sendInvoice).not.toHaveBeenCalled();
  });

  it('P2002 sin ganadora localizable => 409 FISCAL_IDEMPOTENCY_CONFLICT, nunca 500', async () => {
    const h = build({
      txError: Object.assign(new Error('Unique constraint failed'), {
        code: 'P2002',
      }),
      winner: null,
    });
    await expectCode(
      h.service.createPlatformInvoice(DTO),
      ErrorCodes.FISCAL_IDEMPOTENCY_CONFLICT.code,
    );
  });

  it('un error que no es de unicidad se propaga tal cual', async () => {
    const h = build({ txError: new Error('boom') });
    await expect(h.service.createPlatformInvoice(DTO)).rejects.toThrow('boom');
  });
});

describe('PlatformInvoicingService — save_as_profile y estado real (2.5 / 1.4)', () => {
  function facade(legacyResult: any) {
    const service: any = Object.create(PlatformInvoicingService.prototype);
    service.logger = { warn: jest.fn() };
    service.subscriptionFiscalService = {
      createPlatformInvoice: jest.fn().mockResolvedValue(legacyResult),
    };
    service.platformProfiles = { create: jest.fn().mockResolvedValue({}) };
    jest.spyOn(service, 'mapToStoreCreateInvoiceDto').mockReturnValue({});
    jest.spyOn(service, 'validateCreateInput').mockReturnValue(null);
    jest.spyOn(service, 'mapMvpV1ToLegacyCreateDto').mockReturnValue({});
    return service;
  }
  const ARGS = (extra: any = {}) => ({
    organizationId: 1,
    accountingEntityId: 5,
    dianConfigurationId: 9,
    actorUserId: 1,
    dto: {
      customer: { kind: 'external', legal_name: 'Cliente SAS', tax_id: '900123456' },
      operation_type: '10',
      payment_form: '2',
      payment_means_code: '42',
      notes: 'nota',
      save_as_profile: { name: 'Mi perfil' },
      ...extra,
    },
  });
  const LEGACY = {
    transmission_id: 501,
    fiscal_number: 'FE1',
    transmission_status: 'rejected',
    dian_status: 'rejected',
    cufe: null,
    accepted: false,
    error_message: 'FAU02',
  };

  it('el perfil guarda el MEDIO en payment_means_code y la FORMA en payment_method_code', async () => {
    const service = facade(LEGACY);
    await service.createSalesInvoice(ARGS());
    const config = service.platformProfiles.create.mock.calls[0][0].config;
    expect(config.dian.payment_means_code).toBe('42'); // medio (cbc:PaymentMeansCode)
    expect(config.dian.payment_method_code).toBe('2'); // forma (1 contado / 2 crédito)
  });

  it('sin captura, los defaults siguen el contrato: medio 10, forma 1', async () => {
    const service = facade(LEGACY);
    await service.createSalesInvoice(
      ARGS({ payment_form: undefined, payment_means_code: undefined }),
    );
    const config = service.platformProfiles.create.mock.calls[0][0].config;
    expect(config.dian.payment_means_code).toBe('10');
    expect(config.dian.payment_method_code).toBe('1');
  });

  it('la fachada propaga accepted / error_message del estado real', async () => {
    const service = facade(LEGACY);
    const r = await service.createSalesInvoice(ARGS({ save_as_profile: undefined }));
    expect(r).toMatchObject({
      accepted: false,
      error_message: 'FAU02',
      transmission_status: 'rejected',
      idempotent_replay: false,
    });
  });
});
