import { SubscriptionFiscalService } from './subscription-fiscal.service';
import { CreatePlatformInvoiceDto } from './dto/subscription-fiscal.dto';
import { CustomerFiscalIdentityValidator } from '../../../store/invoicing/validators/customer-fiscal-identity.validator';
import { FiscalDocumentValidator } from '../../../store/invoicing/validators/fiscal-document.validator';

/**
 * FASE 1.3 — el REENVÍO firma el MISMO documento que el primer intento.
 *
 * `resendPlatformTransmission` reconstruía el payload con defaults: tipo de
 * documento '31', régimen '49', forma de pago '1', medio '42', vencimiento =
 * creación + 7, notas con «(retry)» y la moneda del snapshot. Sobre un
 * consecutivo que la DIAN ya quemó eso es firmar OTRO documento.
 *
 * El primer intento persiste `provider_data` en el snapshot y el reenvío parte
 * de él. Estos tests corren la emisión real, capturan snapshot y payload, y
 * reenvían contra ese snapshot.
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

const CERT = {
  id: 9,
  certificate_s3_key: 'certs/platform.p12',
  certificate_password_encrypted: 'enc',
  certificate_kms_key_id: null,
  certificate_expiry: new Date(Date.now() + 90 * 86400000),
};

const SETTINGS = {
  is_enabled: true,
  platform_organization_id: 1,
  accounting_entity_id: 5,
  dian_configuration_id: 9,
  invoice_resolution_id: 77,
};

function dtoWith(extra: Partial<CreatePlatformInvoiceDto>) {
  return {
    customer: {
      legal_name: 'María Pérez',
      tax_id: '1020304050',
      email: 'maria@correo.co',
      // Cédula de ciudadanía, persona natural, régimen no responsable: NADA de
      // esto es el default ('31' / '2' / '49').
      document_type: '13',
      person_type: '2',
      tax_regime_code: '49',
      fiscal_responsibilities: ['R-99-PN'],
    },
    items: [
      {
        description: 'Capacitación',
        quantity: 3,
        unit_price: 119000,
        discount_amount: 5000,
        unit_code: 'HUR',
        taxes: [{ tax_type: 'IVA', rate: 0.19, is_inclusive: true }],
      },
    ],
    issue_date: '2026-09-11',
    due_date: '2026-10-11',
    payment_form: '2',
    payment_means_code: '48',
    notes: 'Pago a 30 días. Ref. contrato 77.',
    ...extra,
  } as CreatePlatformInvoiceDto;
}

function build(stored: { snapshot?: any; transmission?: any } = {}) {
  const evidences: any[] = [];
  const sent: any[] = [];
  const tx = {
    fiscal_transmissions: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(async ({ data }: any) => ({
        id: 501,
        created_at: new Date('2026-09-11T15:00:00Z'),
        ...data,
      })),
    },
    fiscal_evidences: {
      create: jest.fn(async ({ data }: any) => {
        evidences.push(data);
        return { id: 1 };
      }),
    },
  };
  const transmissionRow = {
    id: 501,
    document_number: 'FE1',
    created_at: new Date('2026-09-11T15:00:00Z'),
    transmission_status: 'rejected',
    dian_status: 'rejected',
    cufe: null,
    error_message: 'FAU02',
    source_type: 'platform_invoice',
  };
  const prisma = {
    withoutScope: () => ({
      invoice_resolutions: {
        findFirst: jest.fn().mockResolvedValue(resolutionRow()),
      },
      dian_configurations: { findUnique: jest.fn().mockResolvedValue(CERT) },
      fiscal_transmissions: {
        findFirst: jest
          .fn()
          .mockResolvedValue(stored.transmission ?? transmissionRow),
        findUnique: jest.fn().mockResolvedValue(transmissionRow),
      },
      fiscal_evidences: {
        findFirst: jest
          .fn()
          .mockResolvedValue(stored.snapshot ? { metadata: stored.snapshot } : null),
      },
    }),
    $transaction: jest.fn(async (cb: any) => cb(tx)),
  };
  const dianProvider = {
    sendInvoice: jest.fn(async (pd: any) => {
      sent.push(JSON.parse(JSON.stringify(pd)));
      return { success: false, errors: ['x'] };
    }),
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
  jest.spyOn(service, 'getSettings').mockResolvedValue(SETTINGS);
  jest.spyOn(service, 'allocateFiscalNumber').mockResolvedValue({
    invoice_number: 'FE1',
    resolution: resolutionRow(),
  });
  for (const m of ['markSubmitted', 'markAccepted', 'markRejected', 'markError']) {
    jest.spyOn(service, m).mockResolvedValue(undefined);
  }
  return { service, evidences, sent, prisma };
}

describe('Reenvío de factura de plataforma — mismo documento (F1.3)', () => {
  it('reenvía EXACTAMENTE el payload del primer intento (cédula, crédito, medio 48, vencimiento, notas, precio despejado)', async () => {
    const first = build();
    await first.service.createPlatformInvoice(dtoWith({}));
    expect(first.sent).toHaveLength(1);
    const snapshot = first.evidences[0].metadata;
    expect(snapshot.provider_data).toBeDefined();

    const second = build({ snapshot });
    await second.service.resendPlatformTransmission(501);
    expect(second.sent).toHaveLength(1);

    expect(second.sent[0]).toEqual(first.sent[0]);
    // Y no es el documento de los defaults.
    expect(second.sent[0].customer_document_type).toBe('13');
    expect(second.sent[0].customer_regime).toBe('49');
    expect(second.sent[0].payment_form).toBe('2');
    expect(second.sent[0].payment_means).toBe('48');
    expect(second.sent[0].due_date).toBe('2026-10-11');
    expect(second.sent[0].issue_date).toBe('2026-09-11');
    expect(second.sent[0].notes).toBe('Pago a 30 días. Ref. contrato 77.');
    expect(second.sent[0].notes).not.toMatch(/retry/);
    expect(second.sent[0].items[0].unit_code).toBe('HUR');
    expect(second.sent[0].currency).toBe('COP');
  });

  it('con TRM (USD) el reenvío conserva la divisa declarada y firma en COP', async () => {
    const dto = dtoWith({
      currency: 'USD',
      exchange_rate_payload: {
        iso_4217: 'USD',
        exchange_rate: 4100.5,
        exchange_rate_date: '2026-09-10',
      },
    });
    const first = build();
    await first.service.createPlatformInvoice(dto);
    const snapshot = first.evidences[0].metadata;

    const second = build({ snapshot });
    await second.service.resendPlatformTransmission(501);
    expect(second.sent[0]).toEqual(first.sent[0]);
    expect(second.sent[0].currency).toBe('COP');
    expect(second.sent[0].exchange_rate).toMatchObject({
      foreign_currency: 'USD',
      date: '2026-09-10',
    });
  });

  it('el snapshot no guarda secretos de la resolución (technical_key / control)', async () => {
    const first = build();
    await first.service.createPlatformInvoice(dtoWith({}));
    const stored = first.evidences[0].metadata.provider_data;
    expect(stored.technical_key).toBeUndefined();
    expect(stored.control).toBeUndefined();
    expect(JSON.stringify(first.evidences[0].metadata)).not.toContain(TECHNICAL_KEY);
  });

  it('el snapshot trae los campos firmados: hora, forma, medio, vencimiento, notas, TRM y desglose', async () => {
    const first = build();
    await first.service.createPlatformInvoice(dtoWith({}));
    const m = first.evidences[0].metadata;
    expect(m).toMatchObject({
      issue_date: '2026-09-11',
      payment_form: '2',
      payment_means_code: '48',
      due_date: '2026-10-11',
      notes: 'Pago a 30 días. Ref. contrato 77.',
    });
    expect(m.issue_time).toMatch(/^\d{2}:\d{2}:\d{2}/);
    expect(m.tax_breakdown).toEqual([
      expect.objectContaining({ tax_type: 'IVA', rate: 0.19 }),
    ]);
    expect(m).toHaveProperty('exchange_rate');
  });

  it('un snapshot SIN provider_data (anterior a este cambio) NO se reconstruye con defaults: se rechaza', async () => {
    const first = build();
    await first.service.createPlatformInvoice(dtoWith({}));
    const legacy = { ...first.evidences[0].metadata };
    delete legacy.provider_data;

    const second = build({ snapshot: legacy });
    await expect(second.service.resendPlatformTransmission(501)).rejects.toThrow(
      /no guarda el payload firmado/,
    );
    expect(second.sent).toHaveLength(0);
  });
});
