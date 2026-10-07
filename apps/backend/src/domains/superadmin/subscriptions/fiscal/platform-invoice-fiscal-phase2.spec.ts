import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { create as xmlCreate } from 'xmlbuilder2';

import { SubscriptionFiscalService } from './subscription-fiscal.service';
import {
  CreatePlatformInvoiceDto,
  CreatePlatformSalesInvoiceDto,
} from './dto/subscription-fiscal.dto';
import { PlatformInvoicePdfService } from './platform-invoice-pdf.service';
import { CustomerFiscalIdentityValidator } from '../../../store/invoicing/validators/customer-fiscal-identity.validator';
import { FiscalDocumentValidator } from '../../../store/invoicing/validators/fiscal-document.validator';
import { InvoicePdfBuilder } from '../../../store/invoicing/services/invoice-pdf.builder';
import {
  UblCommonBuilder,
} from '../../../store/invoicing/providers/dian-direct/xml/ubl-common.builder';
import { UBL_NAMESPACES } from '../../../store/invoicing/providers/dian-direct/xml/xml-namespaces';

/**
 * FASE 2 fiscal de la factura de plataforma: exento vs excluido, retenciones,
 * unidad de medida, desglose contable y neto a pagar del PDF.
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

function baseDto(extra: Record<string, unknown> = {}) {
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
    items: [{ description: 'Implementación', quantity: 1, unit_price: 100000 }],
    ...extra,
  } as unknown as CreatePlatformInvoiceDto;
}

const CONCEPTS = [
  { id: 11, code: 'RTE_SERV', withholding_type: 'retefuente', account_code: '135515' },
  { id: 12, code: 'RTE_ICA', withholding_type: 'reteica', account_code: null },
];

function makeService(prisma: any) {
  const unused = {};
  return Reflect.construct(SubscriptionFiscalService, [
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
  ]) as SubscriptionFiscalService;
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
  const allocate = jest.fn();
  const prisma = {
    withoutScope: () => ({
      invoice_resolutions: { findFirst: jest.fn().mockResolvedValue(resolutionRow()) },
      dian_configurations: {
        findUnique: jest.fn().mockResolvedValue(dianConfig),
        findFirst: jest.fn().mockResolvedValue(dianConfig),
      },
      withholding_concepts: { findMany: jest.fn().mockResolvedValue(CONCEPTS) },
    }),
    $transaction: jest.fn(async (cb: any) => cb(tx)),
  };
  const service = makeService(prisma);
  const internals = service as any;
  jest.spyOn(internals, 'getSettings').mockResolvedValue({
    is_enabled: true,
    platform_organization_id: 1,
    accounting_entity_id: 5,
    dian_configuration_id: 9,
    invoice_resolution_id: 77,
  });
  allocate.mockResolvedValue({ invoice_number: 'FE1', resolution: resolutionRow() });
  jest.spyOn(internals, 'allocateFiscalNumber').mockImplementation(allocate);
  jest.spyOn(internals, 'markSubmitted').mockRejectedValue(STOP);
  const builder = jest.spyOn(internals, 'buildPlatformProviderData');

  let error: unknown = null;
  try {
    await service.createPlatformInvoice(dto);
  } catch (caught) {
    error = caught;
  }
  return {
    service,
    error,
    allocate,
    evidences,
    providerData: builder.mock.results.at(-1)?.value as any,
  };
}

describe('Plataforma fase 2 — 1) exento vs excluido', () => {
  afterEach(() => jest.restoreAllMocks());

  it('IVA tarifa 0 va como TaxTotal 01 @ 0.00 con su base y la nota cita el art. 477 (no el 476)', async () => {
    const r = await run(
      baseDto({
        items: [
          {
            description: 'Servicio exento',
            quantity: 1,
            unit_price: 100000,
            taxes: [{ tax_type: 'IVA', rate: 0 }],
          },
        ],
      }),
    );
    expect(r.error).toBe(STOP);
    const pd = r.providerData;
    expect(pd.items[0].omit_tax_total).toBe(false);
    expect(pd.items[0].taxes).toEqual([
      expect.objectContaining({ tax_rate: '0.00', taxable_amount: '100000.00', tax_amount: '0.00' }),
    ]);
    expect(pd.taxes).toHaveLength(1);
    expect(pd.total_amount).toBe('100000.00');
    expect(pd.notes).toContain('art. 477');
    expect(pd.notes).not.toContain('476');
    // El XML de totales cuadra (FAU/FAX) con el grupo en 0,00.
    expect(() => (r.service as any).assertPlatformTotalsCoherent(pd)).not.toThrow();
  });

  it('sin ningún impuesto la nota sigue siendo el art. 476 num. 21 (excluido)', async () => {
    const r = await run(baseDto());
    expect(r.providerData.notes).toContain('art. 476');
    expect(r.providerData.notes).not.toContain('477');
    expect(r.providerData.items[0].omit_tax_total).toBe(true);
  });

  it('con IVA 19 % no hay nota de exclusión ni de exento', async () => {
    const r = await run(
      baseDto({
        items: [
          { description: 'Gravado', quantity: 1, unit_price: 100000, taxes: [{ tax_type: 'IVA', rate: 0.19 }] },
        ],
      }),
    );
    expect(r.providerData.notes).not.toContain('476');
    expect(r.providerData.notes).not.toContain('477');
  });
});

describe('Plataforma fase 2 — 5) tax_breakdown.rate es FRACCIÓN', () => {
  afterEach(() => jest.restoreAllMocks());

  it('IVA 19 % y INC 8 % se guardan como 0.19 y 0.08, igual que las líneas', async () => {
    const r = await run(
      baseDto({
        items: [
          { description: 'A', quantity: 1, unit_price: 100000, taxes: [{ tax_type: 'IVA', rate: 0.19 }] },
          { description: 'B', quantity: 1, unit_price: 50000, taxes: [{ tax_type: 'INC', rate: 0.08 }] },
        ],
      }),
    );
    const meta = r.evidences[0].metadata;
    expect(meta.tax_breakdown.map((b: any) => b.rate)).toEqual([0.19, 0.08]);
    expect(meta.items[0].taxes[0].rate).toBe(0.19);
  });

  it('una tarifa por mil conserva todos sus decimales (0.00966)', async () => {
    const r = await run(
      baseDto({
        items: [
          { description: 'ICA', quantity: 1, unit_price: 100000, taxes: [{ tax_type: 'ICA', rate: 0.00966 }] },
        ],
      }),
    );
    expect((r.error as Error).message).toBe(STOP.message);
    expect(r.evidences[0].metadata.tax_breakdown[0].rate).toBe(0.00966);
  });
});

describe('Plataforma fase 2 — 2) retenciones', () => {
  afterEach(() => jest.restoreAllMocks());

  const withholdings = [
    { role: 'suffered', concept_id: 11, base_amount: 100000, rate: 0.04 },
    { role: 'self', concept_id: 12, base_amount: 100000, rate: 0.00966 },
  ];

  it('declara WithholdingTaxTotal en el XML (como la tienda) sin alterar PayableAmount', async () => {
    const r = await run(baseDto({ withholdings }));
    expect(r.error).toBe(STOP);
    const pd = r.providerData;
    expect(pd.withholdings).toEqual([
      { withholding_type: 'retefuente', concept_code: 'RTE_SERV', rate: '4.00', base: '100000.00', amount: '4000.00' },
      expect.objectContaining({ withholding_type: 'reteica', concept_code: 'RTE_ICA', amount: '966.00' }),
    ]);
    // Las retenciones no restan: total = subtotal + impuestos.
    expect(pd.total_amount).toBe('100000.00');
    expect(pd.withholding_amount).toBe('4966.00');

    const doc = xmlCreate({ version: '1.0' }).ele(UBL_NAMESPACES.INVOICE, 'Invoice', {
      'xmlns:cac': UBL_NAMESPACES.CAC,
      'xmlns:cbc': UBL_NAMESPACES.CBC,
    });
    UblCommonBuilder.buildWithholdingTaxTotal(doc, pd.withholdings, 'COP');
    const xml = doc.end({ prettyPrint: false });
    expect(xml.match(/<cac:WithholdingTaxTotal>/g)).toHaveLength(2);
    expect((r.service as any).assertPlatformTotalsCoherent(pd)).toBeUndefined();
  });

  it('el snapshot guarda tipo y concepto, y un importe calculado por el servidor', async () => {
    const r = await run(
      baseDto({ withholdings: [{ ...withholdings[0], amount: 1 }] }),
    );
    expect(r.evidences[0].metadata.withholdings).toEqual([
      expect.objectContaining({
        role: 'suffered',
        withholding_type: 'retefuente',
        concept_code: 'RTE_SERV',
        amount: 4000,
      }),
    ]);
  });

  it('un concepto no resoluble no bloquea la emisión: sólo se omite del XML', async () => {
    const r = await run(
      baseDto({ withholdings: [{ role: 'suffered', concept_id: 999, base_amount: 1000, rate: 0.1 }] }),
    );
    expect(r.error).toBe(STOP);
    expect(r.providerData.withholdings).toBeUndefined();
  });

  it('filas RETE_* dentro de items[].taxes no rompen la línea ni suman impuesto', async () => {
    const r = await run(
      baseDto({
        items: [
          {
            description: 'Con rete en taxes',
            quantity: 1,
            unit_price: 100000,
            taxes: [
              { tax_type: 'IVA', rate: 0.19 },
              { tax_type: 'RETE_ICA', rate: 0.00966 },
              { tax_type: 'RETE_FUENTE', rate: 0.04 },
            ],
          },
        ],
      }),
    );
    expect(r.error).toBe(STOP);
    expect(r.providerData.tax_amount).toBe('19000.00');
    expect(r.providerData.total_amount).toBe('119000.00');
    expect(r.providerData.items[0].taxes).toHaveLength(1);
  });

  it('el DTO acepta tarifas por mil (6 decimales) en impuestos y retenciones', async () => {
    const dto = plainToInstance(
      CreatePlatformSalesInvoiceDto,
      {
        tenant_ref: { kind: 'store', tenant_id: 1 },
        items: [
          {
            description: 'x',
            quantity: 1,
            unit_price: 1000,
            taxes: [{ tax_type: 'RETE_ICA', rate: 0.00966 }],
          },
        ],
        withholdings: [{ role: 'suffered', concept_id: 1, base_amount: 1000, rate: 0.00966 }],
      },
      { enableImplicitConversion: true },
    );
    const errors = await validate(dto as object, { skipMissingProperties: false });
    const flat = JSON.stringify(errors);
    expect(flat).not.toContain('maxDecimalPlaces');
  });
});

describe('Plataforma fase 2 — 3) unidad de medida', () => {
  afterEach(() => jest.restoreAllMocks());

  const line = (unit_code?: string) => ({
    items: [{ description: 'x', quantity: 1, unit_price: 1000, ...(unit_code ? { unit_code } : {}) }],
  });

  it('default NIU cuando falta', async () => {
    const r = await run(baseDto(line()));
    expect(r.providerData.items[0].unit_code).toBe('NIU');
    expect(r.evidences[0].metadata.items[0].unit_code).toBe('NIU');
  });

  it('MON (perfiles guardados) se mapea a LUN en vez de rechazarse', async () => {
    const r = await run(baseDto(line('MON')));
    expect(r.error).toBe(STOP);
    expect(r.providerData.items[0].unit_code).toBe('LUN');
  });

  it('un código del catálogo (HUR) pasa intacto', async () => {
    const r = await run(baseDto(line('HUR')));
    expect(r.providerData.items[0].unit_code).toBe('HUR');
  });

  it('un código inexistente es un 400 legible ANTES del consecutivo', async () => {
    const r = await run(baseDto(line('ZZZ9')));
    expect((r.error as Error).message).toContain('Línea 1');
    expect((r.error as Error).message).toContain('ZZZ9');
    expect(r.allocate).not.toHaveBeenCalled();
  });
});

describe('Plataforma fase 2 — 4) asiento contable por tipo de impuesto', () => {
  afterEach(() => jest.restoreAllMocks());

  function setupEmit(metadata: Record<string, unknown>, snapshotTotals: any) {
    const prisma = {
      withoutScope: () => ({
        fiscal_evidences: { findFirst: jest.fn().mockResolvedValue({ metadata }) },
      }),
    };
    const service = makeService(prisma);
    const emit = jest.fn();
    (service as any).eventEmitter = { emit };
    (service as any).persistence = {
      loadInvoiceSnapshot: jest.fn().mockResolvedValue({
        customer: {},
        items: [],
        totals: snapshotTotals,
        withholdings: (metadata as any).withholdings ?? [],
      }),
    };
    return { service, emit };
  }

  const tx = {
    id: 501,
    organization_id: 1,
    store_id: null,
    accounting_entity_id: 5,
    document_number: 'FE1',
    created_by_user_id: 1,
  };

  it('el INC va a su propio tipo (inc), no a la cuenta de IVA', async () => {
    const meta = {
      kind: 'platform_invoice_snapshot',
      tax_breakdown: [
        { tax_type: 'IVA', rate: 0.19, base: '100000.00', amount: '19000.00' },
        { tax_type: 'INC', rate: 0.08, base: '50000.00', amount: '4000.00' },
      ],
    };
    const { service, emit } = setupEmit(meta, { subtotal: 150000, tax_amount: 23000, total: 173000 });
    await (service as any).emitInvoiceAccepted(tx);
    const payload = emit.mock.calls[0][1];
    expect(payload.tax_breakdown).toEqual([
      { tax_type: 'iva', tax_amount: 19000 },
      { tax_type: 'inc', tax_amount: 4000 },
    ]);
  });

  it('snapshot viejo sin desglose: comportamiento actual (sin tax_breakdown)', async () => {
    const { service, emit } = setupEmit(
      { kind: 'platform_invoice_snapshot' },
      { subtotal: 100000, tax_amount: 19000, total: 119000 },
    );
    await (service as any).emitInvoiceAccepted(tx);
    expect(emit.mock.calls[0][1].tax_breakdown).toBeUndefined();
  });

  it('un desglose que no suma el impuesto de cabecera cae al comportamiento actual', async () => {
    const meta = {
      kind: 'platform_invoice_snapshot',
      tax_breakdown: [{ tax_type: 'IVA', rate: 0.19, base: '1', amount: '10.00' }],
    };
    const { service, emit } = setupEmit(meta, { subtotal: 100, tax_amount: 19, total: 119 });
    await (service as any).emitInvoiceAccepted(tx);
    expect(emit.mock.calls[0][1].tax_breakdown).toBeUndefined();
  });

  it('sólo la retención sufrida entra al asiento; la autorretención no rebaja la CxC', async () => {
    const meta = {
      kind: 'platform_invoice_snapshot',
      withholdings: [
        { role: 'suffered', concept_id: 11, withholding_type: 'retefuente', concept_code: 'RTE_SERV', base_amount: 100000, rate: 0.04, amount: 4000, account_code: '135515' },
        { role: 'self', concept_id: 12, withholding_type: 'reteica', concept_code: 'RTE_ICA', base_amount: 100000, rate: 0.00966, amount: 966 },
        { role: 'suffered', concept_id: 13, base_amount: 1, rate: 0.1, amount: 0.1 },
      ],
    };
    const { service, emit } = setupEmit(meta, { subtotal: 100000, tax_amount: 0, total: 100000 });
    await (service as any).emitInvoiceAccepted(tx);
    const wb = emit.mock.calls[0][1].withholding_breakdown;
    expect(wb).toHaveLength(1);
    expect(wb[0]).toEqual(
      expect.objectContaining({
        role: 'suffered',
        withholding_type: 'retefuente',
        amount: 4000,
        account_role: 'withholding.suffered.retefuente_receivable',
      }),
    );
  });
});

describe('Plataforma fase 2 — 6) PDF: NETO A PAGAR', () => {
  afterEach(() => jest.restoreAllMocks());

  const ORG = {
    id: 1,
    name: 'Vendix Corp',
    legal_name: 'QUICKSS S.A.S.',
    tax_id: '902056589',
    logo_url: null,
    fiscal_scope: 'ORGANIZATION',
    document_type: '31',
    person_type: '1',
    fiscal_responsibilities: ['O-13'],
    addresses: [],
    organization_settings: { settings: { fiscal_data: { nit: '902056589', nit_dv: '9', legal_name: 'QUICKSS S.A.S.' } } },
  };

  async function withholdingAmountFor(withholdings: any[]) {
    const gen = jest.spyOn(InvoicePdfBuilder, 'generate').mockResolvedValue(Buffer.from('%PDF'));
    const snapshot = {
      kind: 'platform_invoice_snapshot',
      issue_date: '2026-09-10',
      items: [{ position: 1, quantity: 1, unit_code: 'NIU', unit_price: 1000, line_total: 1000, description: 'x', discount_amount: 0, taxes: [] }],
      totals: { subtotal: 1000, tax_amount: 0, total: 1000 },
      withholdings,
      customer: { legal_name: 'C', tax_id: '900066371' },
    };
    const db: any = {
      fiscal_transmissions: {
        findFirst: jest.fn().mockResolvedValue({
          id: 69, organization_id: 1, document_number: 'VNDS1', document_type: 'sales_invoice',
          source_type: 'platform_invoice', dian_status: 'accepted', transmission_status: 'accepted',
          pdf_url: null, cufe: 'abc', qr_code: null, created_at: new Date('2026-09-12T01:12:57Z'),
        }),
        update: jest.fn(),
      },
      organizations: { findFirst: jest.fn().mockResolvedValue(ORG) },
      invoice_profiles: { findFirst: jest.fn().mockResolvedValue(null) },
      invoice_profile_versions: { findFirst: jest.fn().mockResolvedValue(null) },
      fiscal_evidences: { findMany: jest.fn().mockResolvedValue([{ metadata: snapshot }]) },
      platform_settings: { findUnique: jest.fn().mockResolvedValue(null) },
      invoice_resolutions: { findUnique: jest.fn().mockResolvedValue(null), findFirst: jest.fn().mockResolvedValue(null) },
    };
    const svc = new PlatformInvoicePdfService(
      { withoutScope: () => db } as any,
      { requirePlatformContext: jest.fn().mockResolvedValue({ organization_id: 1 }) } as any,
      { downloadImage: jest.fn(), uploadFile: jest.fn(), getPresignedUrl: jest.fn() } as any,
    );
    await svc.previewPdf(69);
    return (gen.mock.calls[0][0] as any).withholding_amount as number;
  }

  it('resta sólo la retención practicada por el adquiriente (sufrida por la plataforma)', async () => {
    const amount = await withholdingAmountFor([
      { role: 'suffered', withholding_type: 'retefuente', base_amount: 1000, rate: 0.04, amount: 40 },
      { role: 'self', withholding_type: 'reteica', base_amount: 1000, rate: 0.00966, amount: 9.66 },
    ]);
    expect(amount).toBe(40);
  });

  it('snapshot anterior (sin withholding_type) conserva el neto histórico', async () => {
    const amount = await withholdingAmountFor([
      { role: 'practiced', base_amount: 1000, rate: 0.04, amount: 40 },
      { role: 'self', base_amount: 1000, rate: 0.01, amount: 10 },
    ]);
    expect(amount).toBe(50);
  });
});
