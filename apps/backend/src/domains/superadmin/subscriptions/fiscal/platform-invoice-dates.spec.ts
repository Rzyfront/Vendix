import { SubscriptionFiscalService } from './subscription-fiscal.service';
import { CreatePlatformInvoiceDto } from './dto/subscription-fiscal.dto';
import { CustomerFiscalIdentityValidator } from '../../../store/invoicing/validators/customer-fiscal-identity.validator';
import { FiscalDocumentValidator } from '../../../store/invoicing/validators/fiscal-document.validator';

/**
 * FASE 0 — FECHAS CIVILES DE LA FACTURA DE PLATAFORMA.
 *
 * `issue_date: '2026-09-11'` pasado por `new Date()` es la medianoche UTC, que
 * en Bogotá (UTC-5) es el 10 de septiembre: el documento firmado salía un día
 * antes del elegido. Las fechas de negocio son DÍAS CIVILES.
 */

const STOP = new Error('__stop_after_snapshot__');
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

function baseDto(extra: Partial<CreatePlatformInvoiceDto> = {}) {
  return {
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
    items: [
      { description: 'Implementación', quantity: 1, unit_price: 100000 },
    ],
    ...extra,
  } as CreatePlatformInvoiceDto;
}

async function run(dto: CreatePlatformInvoiceDto) {
  const evidences: any[] = [];
  const dianConfig = {
    id: 9,
    certificate_s3_key: 'certs/platform.p12',
    certificate_password_encrypted: 'enc',
    certificate_kms_key_id: null,
    certificate_expiry: new Date(Date.now() + 90 * 86400000),
  };
  const tx = {
    fiscal_transmissions: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(async ({ data }: any) => ({ id: 501, ...data })),
    },
    fiscal_evidences: {
      create: jest.fn(async ({ data }: any) => {
        evidences.push(data);
        return { id: 1 };
      }),
    },
  };
  const prisma = {
    withoutScope: () => ({
      invoice_resolutions: {
        findFirst: jest.fn().mockResolvedValue(resolutionRow()),
      },
      dian_configurations: {
        findUnique: jest.fn().mockResolvedValue(dianConfig),
        findFirst: jest.fn().mockResolvedValue(dianConfig),
      },
    }),
    $transaction: jest.fn(async (cb: any) => cb(tx)),
  };
  const unused = {};
  const service: SubscriptionFiscalService = Reflect.construct(
    SubscriptionFiscalService,
    [
      prisma,
      unused,
      unused,
      unused,
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
    ],
  );
  const internals = service as any;
  jest.spyOn(internals, 'getSettings').mockResolvedValue({
    is_enabled: true,
    platform_organization_id: 1,
    accounting_entity_id: 5,
    dian_configuration_id: 9,
    invoice_resolution_id: 77,
  });
  jest.spyOn(internals, 'allocateFiscalNumber').mockResolvedValue({
    invoice_number: 'FE1',
    resolution: resolutionRow(),
  });
  jest.spyOn(internals, 'markSubmitted').mockRejectedValue(STOP);
  const builder = jest.spyOn(internals, 'buildPlatformProviderData');

  let error: unknown = null;
  try {
    await service.createPlatformInvoice(dto);
  } catch (caught) {
    error = caught;
  }
  return {
    error,
    evidences,
    providerData: builder.mock.results.at(-1)?.value as any,
  };
}

describe('Factura de plataforma — fechas civiles (F0)', () => {
  it('issue_date 2026-09-11 se firma y se persiste como 2026-09-11 (no 10)', async () => {
    const r = await run(baseDto({ issue_date: '2026-09-11' }));
    expect(r.error).toBe(STOP);
    expect(r.providerData.issue_date).toBe('2026-09-11');
    expect(r.evidences[0].metadata.issue_date).toBe('2026-09-11');
  });

  it('due_date, period_start y period_end civiles se conservan', async () => {
    const r = await run(
      baseDto({
        issue_date: '2026-09-01',
        due_date: '2026-09-30',
        period_start: '2026-09-01',
        period_end: '2026-09-30',
      }),
    );
    expect(r.error).toBe(STOP);
    expect(r.providerData.due_date).toBe('2026-09-30');
    expect(r.providerData.invoice_period).toEqual({
      start_date: '2026-09-01',
      end_date: '2026-09-30',
    });
  });

  it('la medianoche UTC del mismo día (ISO con Z) también es ese día civil', async () => {
    const r = await run(
      baseDto({
        issue_date: '2026-09-11T00:00:00.000Z',
        due_date: '2026-09-20T00:00:00Z',
      }),
    );
    expect(r.providerData.issue_date).toBe('2026-09-11');
    expect(r.providerData.due_date).toBe('2026-09-20');
  });

  it('un instante con hora real se convierte a la fecha civil de Bogotá', async () => {
    const r = await run(
      baseDto({ issue_date: '2026-09-12T03:30:00.000Z' }),
    );
    // 03:30Z = 22:30 del 11 en Bogotá.
    expect(r.providerData.issue_date).toBe('2026-09-11');
  });

  it('la fecha de la TRM viaja como día civil', async () => {
    const r = await run(
      baseDto({
        issue_date: '2026-09-11',
        exchange_rate_payload: {
          iso_4217: 'USD',
          exchange_rate: 4000,
          exchange_rate_date: '2026-09-10',
        },
      }),
    );
    expect(r.error).toBe(STOP);
    expect(r.providerData.exchange_rate.date).toBe('2026-09-10');
  });

  it('el vencimiento por defecto es emisión + 7 días civiles', async () => {
    const r = await run(baseDto({ issue_date: '2026-09-11' }));
    expect(r.providerData.due_date).toBe('2026-09-18');
  });

  it('due_date anterior a issue_date => 400 antes de tocar BD', async () => {
    const r = await run(
      baseDto({ issue_date: '2026-09-11', due_date: '2026-09-10' }),
    );
    expect(r.error).toBeInstanceOf(Error);
    expect((r.error as Error).message).toMatch(/vencimiento.*anterior/i);
    expect(r.evidences).toHaveLength(0);
  });

  it('payment_form 2 (crédito) sin due_date => 400', async () => {
    const r = await run(baseDto({ payment_form: '2' }));
    expect((r.error as Error).message).toMatch(/crédito.*due_date/i);
  });

  it('payment_form 2 con due_date >= issue_date pasa', async () => {
    const r = await run(
      baseDto({
        payment_form: '2',
        issue_date: '2026-09-11',
        due_date: '2026-09-11',
      }),
    );
    expect(r.error).toBe(STOP);
  });

  it('fecha inválida => 400', async () => {
    const r = await run(baseDto({ issue_date: '2026-02-31' }));
    expect((r.error as Error).message).toMatch(/fecha válida/i);
  });
});
