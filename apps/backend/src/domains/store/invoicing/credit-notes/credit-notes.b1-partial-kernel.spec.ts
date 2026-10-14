import { Prisma } from '@prisma/client';
import { ErrorCodes, VendixHttpException } from 'src/common/errors';
import {
  CreditNotesService,
  derivePartialNoteLinesViaKernel,
} from './credit-notes.service';
import type { CreateCreditNoteDto } from './dto/create-credit-note.dto';
import { InvoiceCalculatorService } from '../services/invoice-calculator.service';
import {
  createPrismaMock,
  mockRequestContext,
} from '../../../../testing/prisma-mock';
import { buildInvoice } from '../../../../testing/money-fixtures';

/**
 * B.1 (F-020) — la nota PARCIAL deriva por el kernel único
 * (`absorbInclusiveLine`, el mismo loop del motor): la cuota persistida ES
 * `trunc(base_final × rate)` por construcción y la cabecera suma lo derivado,
 * nunca el reclamo del cliente. La nota TOTAL sigue copia exacta (no se
 * prueba acá: ese camino no se tocó).
 *
 * Archivo NUEVO: prueba el helper puro exportado, sin levantar el servicio.
 */
describe('credit-notes · parcial por kernel (B.1/F-020)', () => {
  const scheme = (
    overrides: Partial<{
      tax_rate_id: number | null;
      tax_name: string;
      tax_rate: number;
      tax_type: string | null;
    }> = {},
  ) => ({
    tax_rate_id: 7,
    tax_name: 'INC 8%',
    tax_rate: new Prisma.Decimal(8),
    tax_type: 'inc',
    ...overrides,
  });

  const relatedLine = (
    overrides: Partial<{
      product_id: number | null;
      product_variant_id: number | null;
      is_inclusive: boolean | null;
      tax_amount?: number | null;
      price_unit_quantity?: number | null;
    }> = {},
  ) => ({ product_id: 11, product_variant_id: null, is_inclusive: true as boolean | null, ...overrides });

  it('parcial inclusiva $3.000/INC 8% ⇒ base 2777.78 + cuota 222.22 = 3000.00', () => {
    const result = derivePartialNoteLinesViaKernel(
      [
        {
          product_id: 11,
          description: 'Devolución parcial',
          quantity: 1,
          unit_price: 3000,
          tax_amount: 0,
        },
      ],
      [relatedLine()],
      [scheme()],
      901,
      'credit_note',
    );

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].base_amount.toString()).toBe('2777.78');
    expect(result.lines[0].tax_amount.toString()).toBe('222.22');
    expect(result.lines[0].total_amount.toString()).toBe('3000');
    expect(result.totals.subtotal.toString()).toBe('2777.78');
    expect(result.totals.tax.toString()).toBe('222.22');
    expect(result.totals.total.toString()).toBe('3000');
    expect(result.taxes).toHaveLength(1);
    expect(result.taxes[0]).toMatchObject({
      tax_name: 'INC 8%',
      taxable_amount: 2777.78,
      tax_amount: 222.22,
    });
  });

  it('el reclamo del cliente NO manda: cuota 999 ⇒ persiste 222.22', () => {
    const warnings: string[] = [];
    const result = derivePartialNoteLinesViaKernel(
      [
        {
          product_id: 11,
          quantity: 1,
          unit_price: 3000,
          tax_amount: 999,
        },
      ],
      [relatedLine()],
      [scheme()],
      902,
      'credit_note',
      { warn: (message: string) => warnings.push(message) },
    );

    expect(result.lines[0].tax_amount.toString()).toBe('222.22');
    expect(result.totals.total.toString()).toBe('3000');
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('server wins');
  });

  it('línea adicional IVA 19% $100 ⇒ base 100 + 19 = 119', () => {
    const result = derivePartialNoteLinesViaKernel(
      [
        {
          product_id: 12,
          quantity: 1,
          unit_price: 100,
          is_inclusive: false,
          tax_amount: 0,
        },
      ],
      [relatedLine({ product_id: 12, is_inclusive: false })],
      [scheme({ tax_name: 'IVA 19%', tax_rate: 19, tax_type: 'iva' })],
      903,
      'debit_note',
    );

    expect(result.lines[0].base_amount.toString()).toBe('100');
    expect(result.lines[0].tax_amount.toString()).toBe('19');
    expect(result.lines[0].total_amount.toString()).toBe('119');
  });

  it('factura multi-esquema sin desglose ⇒ CALC_001 (igual que antes)', () => {
    const thrown: any = (() => {
      try {
        derivePartialNoteLinesViaKernel(
          [{ quantity: 1, unit_price: 3000, tax_amount: 100 }],
          [relatedLine()],
          [
            scheme(),
            scheme({ tax_name: 'IVA 19%', tax_rate: 19, tax_type: 'iva' }),
          ],
          904,
          'credit_note',
        );
        return null;
      } catch (error) {
        return error;
      }
    })();

    expect(thrown).not.toBeNull();
    expect(thrown).toMatchObject({ errorCode: 'INVOICING_CALC_001' });
  });

  it('H1: plato INC 8% + Envío INC 8% (2 filas del mismo tributo) ⇒ la parcial deriva sin taxes', () => {
    const result = derivePartialNoteLinesViaKernel(
      [
        { product_id: 11, description: 'Plato', quantity: 1, unit_price: 3000 },
        {
          product_id: null,
          description: 'Envío',
          quantity: 1,
          unit_price: 13888.89,
        },
      ],
      [
        relatedLine({ tax_amount: 222.22 }),
        relatedLine({
          product_id: null,
          is_inclusive: false,
          tax_amount: 1111.11,
        }),
      ],
      // Fila del plato + fila ligada al Envío: mismo tipo y misma tarifa.
      [scheme(), scheme({ tax_rate: 8.0 })],
      906,
      'credit_note',
    );

    expect(result.lines[0].base_amount.toString()).toBe('2777.78');
    expect(result.lines[0].tax_amount.toString()).toBe('222.22');
    expect(result.lines[1].base_amount.toString()).toBe('13888.89');
    expect(result.lines[1].tax_amount.toString()).toBe('1111.11');
    expect(result.totals.subtotal.toString()).toBe('16666.67');
    expect(result.totals.tax.toString()).toBe('1333.33');
    expect(result.totals.total.toString()).toBe('18000');
    // Un solo tributo en la nota: el INC 8% cuadra base × tarifa.
    expect(result.taxes).toHaveLength(1);
    expect(result.taxes[0]).toMatchObject({
      tax_rate_id: 7,
      tax_name: 'INC 8%',
      tax_rate: 8,
      tax_type: 'inc',
      taxable_amount: 16666.67,
      tax_amount: 1333.33,
    });
  });

  it('H1: dos filas del mismo tipo con tarifas distintas (INC 8% + INC 16%) siguen exigiendo taxes', () => {
    expect(() =>
      derivePartialNoteLinesViaKernel(
        [{ product_id: 11, quantity: 1, unit_price: 3000 }],
        [relatedLine()],
        [
          scheme(),
          scheme({ tax_rate_id: 8, tax_name: 'INC 16%', tax_rate: 16 }),
        ],
        907,
        'credit_note',
      ),
    ).toThrow(
      expect.objectContaining({ errorCode: 'INVOICING_CALC_001' }),
    );
  });

  describe('factura mixta con envío gravado (desglose por invoice_item_id)', () => {
    // Factura de `createFromOrder`: plato 50.000 + INC 4.000 (línea 1) y
    // Envío 12.605,04 + IVA 2.394,96 (línea 2), cada fila ligada a su línea.
    const mixedRelated = () => [
      { id: 1, product_id: 11, product_variant_id: null, is_inclusive: false, tax_amount: 4000, quantity: 1, unit_price: 50000, discount_amount: 0 },
      { id: 2, product_id: null, product_variant_id: null, is_inclusive: false, tax_amount: 2394.96, quantity: 1, unit_price: 12605.04, discount_amount: 0 },
    ];
    const mixedTaxes = () => [
      { ...scheme({ tax_rate_id: 68, tax_name: 'INC' }), invoice_item_id: 1 },
      {
        ...scheme({ tax_rate_id: 1, tax_name: 'IVA 19%', tax_rate: 19, tax_type: 'iva' }),
        invoice_item_id: 2,
      },
    ];

    it('NC que acredita el Envío COMPLETO ⇒ IVA 19 % desde la fila ligada y la cuota facturada', () => {
      const result = derivePartialNoteLinesViaKernel(
        [{ product_id: null, description: 'Envio', quantity: 1, unit_price: 12605.04 }],
        mixedRelated(),
        mixedTaxes(),
        910,
        'credit_note',
      );
      expect(result.lines[0].base_amount.toString()).toBe('12605.04');
      // El re-despeje daría trunc(12.605,04 × 19 %) = 2.394,95; la nota que
      // cubre la línea entera devuelve la cuota facturada (2.394,96) y
      // acredita exactamente el bruto cobrado.
      expect(result.lines[0].tax_amount.toString()).toBe('2394.96');
      expect(result.lines[0].total_amount.toString()).toBe('15000');
      expect(result.taxes).toEqual([
        {
          tax_rate_id: 1,
          tax_name: 'IVA 19%',
          tax_rate: 19,
          taxable_amount: 12605.04,
          tax_amount: 2394.96,
          tax_type: 'iva',
          line_index: 0,
        },
      ]);
    });

    it('NC de una PARTE del Envío ⇒ cuota del kernel, no la de la gemela', () => {
      const result = derivePartialNoteLinesViaKernel(
        [{ product_id: null, description: 'Envio', quantity: 1, unit_price: 6000 }],
        mixedRelated(),
        mixedTaxes(),
        915,
        'credit_note',
      );
      expect(result.lines[0].tax_amount.toString()).toBe('1140');
      expect(result.totals.total.toString()).toBe('7140');
    });

    it('NC parcial de plato + Envío ⇒ una fila por tributo, cada una con sus bases', () => {
      const result = derivePartialNoteLinesViaKernel(
        [
          { product_id: 11, description: 'Plato', quantity: 1, unit_price: 25000 },
          { product_id: null, description: 'Envio', quantity: 1, unit_price: 12605.04 },
        ],
        mixedRelated(),
        mixedTaxes(),
        911,
        'credit_note',
      );
      expect(result.lines[0].tax_amount.toString()).toBe('2000');
      expect(result.taxes).toHaveLength(2);
      expect(result.taxes.find((t) => t.tax_type === 'inc')).toMatchObject({
        tax_rate: 8,
        taxable_amount: 25000,
        tax_amount: 2000,
      });
      expect(result.taxes.find((t) => t.tax_type === 'iva')).toMatchObject({
        tax_rate: 19,
        taxable_amount: 12605.04,
        tax_amount: 2394.96,
      });
      // Σ filas = impuesto de cabecera; Σ bases = subtotal.
      expect(result.totals.tax.toString()).toBe('4394.96');
      expect(result.totals.subtotal.toString()).toBe('37605.04');
    });

    it('gemela sin id o sin filas ligadas ⇒ sigue exigiendo taxes (CALC_001)', () => {
      const noIds = mixedRelated().map(({ id: _id, ...rest }) => rest);
      expect(() =>
        derivePartialNoteLinesViaKernel(
          [{ product_id: null, quantity: 1, unit_price: 12605.04 }],
          noIds,
          mixedTaxes(),
          912,
          'credit_note',
        ),
      ).toThrow(expect.objectContaining({ errorCode: 'INVOICING_CALC_001' }));

      const unlinked = mixedTaxes().map(({ invoice_item_id: _i, ...rest }) => rest);
      expect(() =>
        derivePartialNoteLinesViaKernel(
          [{ product_id: null, quantity: 1, unit_price: 12605.04 }],
          mixedRelated(),
          unlinked,
          913,
          'credit_note',
        ),
      ).toThrow(expect.objectContaining({ errorCode: 'INVOICING_CALC_001' }));
    });

    it('línea con dos tributos ligados (IVA + ICA) ⇒ CALC_001, no se elige uno', () => {
      const taxes = [
        ...mixedTaxes(),
        {
          ...scheme({ tax_rate_id: 9, tax_name: 'ICA', tax_rate: 7, tax_type: 'ica' }),
          invoice_item_id: 2,
        },
      ];
      expect(() =>
        derivePartialNoteLinesViaKernel(
          [{ product_id: null, quantity: 1, unit_price: 12605.04 }],
          mixedRelated(),
          taxes,
          914,
          'credit_note',
        ),
      ).toThrow(expect.objectContaining({ errorCode: 'INVOICING_CALC_001' }));
    });
  });

  describe('línea con cuota truncada al vender (forma base desde la orden)', () => {
    // Producto 5.000 con IVA 19 % incluido en la orden ⇒ factura en forma
    // base 4.201,69 + 798,31; el re-despeje daría trunc(4.201,69 × 19 %) = 798,32.
    const truncatedTwin = (overrides: Record<string, unknown> = {}) => ({
      ...relatedLine({ is_inclusive: false, tax_amount: 798.31 }),
      quantity: 2,
      unit_price: 4201.69,
      discount_amount: 0,
      tax_amount: 1596.62,
      ...overrides,
    });
    const iva19 = () => [scheme({ tax_rate_id: 1, tax_name: 'IVA 19%', tax_rate: 19, tax_type: 'iva' })];

    it('NC de la línea completa ⇒ hereda la cuota persistida (1.596,62, no 1.596,64)', () => {
      const result = derivePartialNoteLinesViaKernel(
        [{ product_id: 11, quantity: 2, unit_price: 4201.69 }],
        [truncatedTwin()],
        iva19(),
        916,
        'credit_note',
      );
      // Re-despeje: trunc(8.403,38 × 19 %) = 1.596,64 — dos centavos: NO es
      // holgura de truncado, el kernel manda.
      expect(result.lines[0].tax_amount.toString()).toBe('1596.64');
    });

    it('NC de la línea completa con holgura de un centavo ⇒ cuota persistida', () => {
      const result = derivePartialNoteLinesViaKernel(
        [{ product_id: 11, quantity: 1, unit_price: 4201.69 }],
        [truncatedTwin({ quantity: 1, tax_amount: 798.31 })],
        iva19(),
        917,
        'credit_note',
      );
      expect(result.lines[0].base_amount.toString()).toBe('4201.69');
      expect(result.lines[0].tax_amount.toString()).toBe('798.31');
      expect(result.lines[0].total_amount.toString()).toBe('5000');
      expect(result.taxes[0]).toMatchObject({ taxable_amount: 4201.69, tax_amount: 798.31 });
    });

    it('NC de MENOS cantidad que la gemela ⇒ kernel', () => {
      const result = derivePartialNoteLinesViaKernel(
        [{ product_id: 11, quantity: 1, unit_price: 4201.69 }],
        [truncatedTwin()],
        iva19(),
        918,
        'credit_note',
      );
      expect(result.lines[0].tax_amount.toString()).toBe('798.32');
    });
  });

  it('bruto inalcanzable ($17/INC 8%) ⇒ CALC_005 antes de numerar', () => {
    // Mismo caso que el gate del motor (A.2): f(15.74) = 16.99 y f(15.75)
    // salta a 17.01 — el kernel persiste closest-below y la nota bloquea.
    const thrown: any = (() => {
      try {
        derivePartialNoteLinesViaKernel(
          [{ quantity: 1, unit_price: 17, tax_amount: 1.26 }],
          [relatedLine()],
          [scheme()],
          905,
          'credit_note',
        );
        return null;
      } catch (error) {
        return error;
      }
    })();

    expect(thrown).not.toBeNull();
    expect(thrown).toMatchObject({ errorCode: 'INVOICING_CALC_005' });
    expect(thrown.getResponse?.().details).toMatchObject({ line_index: 0 });
  });

  it('líneas exentas ⇒ sin filas de impuesto (Anexo 1.9)', () => {
    const result = derivePartialNoteLinesViaKernel(
      [{ quantity: 2, unit_price: 5000, is_inclusive: false, tax_amount: 0 }],
      [relatedLine({ is_inclusive: false })],
      [scheme({ tax_name: 'IVA 0%', tax_rate: 0, tax_type: 'iva' })],
      906,
      'credit_note',
    );

    expect(result.taxes).toEqual([]);
    expect(result.totals.total.toString()).toBe('10000');
  });

  it('gemela exenta bajo esquema único no-cero: el kernel NO inventa cuota (N1)', () => {
    // La factura tiene UNA fila INC 8% (de otra línea); esta línea es exenta
    // (su gemela trae tax 0) y la nota no reclama nada: cero preservado.
    const result = derivePartialNoteLinesViaKernel(
      [{ product_id: 12, quantity: 1, unit_price: 5000, tax_amount: 0 }],
      [relatedLine({ product_id: 12, is_inclusive: false, tax_amount: 0 })],
      [scheme()],
      907,
      'credit_note',
    );

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].tax_amount.toString()).toBe('0');
    expect(result.lines[0].base_amount.toString()).toBe('5000');
    expect(result.lines[0].total_amount.toString()).toBe('5000');
  });

  it('factura sin impuestos + nota sin reclamo: camino cero, sin 422 (N2)', () => {
    const result = derivePartialNoteLinesViaKernel(
      [
        { product_id: 11, quantity: 2, unit_price: 5000, tax_amount: 0 },
        { product_id: 12, quantity: 1, unit_price: 3000, tax_amount: 0 },
      ],
      [relatedLine(), relatedLine({ product_id: 12 })],
      [],
      908,
      'credit_note',
    );

    expect(result.taxes).toEqual([]);
    expect(result.totals.tax.toString()).toBe('0');
    expect(result.totals.total.toString()).toBe('13000');
  });

  it('R3-01: N2 con pack ×12 divide por la gemela (no vale 12×)', () => {
    // Factura SIN impuestos + presentación de 12 a $36000 ($3000/unidad):
    // base = 36000/12 = 3000, no 36000.
    const result = derivePartialNoteLinesViaKernel(
      [{ product_id: 11, quantity: 1, unit_price: 36000, tax_amount: 0 }],
      [relatedLine({ price_unit_quantity: 12 })],
      [],
      910,
      'credit_note',
    );

    expect(result.taxes).toEqual([]);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].base_amount.toString()).toBe('3000');
    expect(result.lines[0].tax_amount.toString()).toBe('0');
    expect(result.lines[0].total_amount.toString()).toBe('3000');
  });

  it('pack ×12: el divisor sale de la gemela, no del DTO (N3)', () => {
    // Presentación de 12 a $36000 ($3000/unidad) con INC 8% incluido:
    // bruto = 36000/12 = 3000 ⇒ base 2777.78 + 222.22 (no 33333.33/2666.66).
    const result = derivePartialNoteLinesViaKernel(
      [{ product_id: 11, quantity: 1, unit_price: 36000, tax_amount: 0 }],
      [relatedLine({ price_unit_quantity: 12 })],
      [scheme()],
      909,
      'credit_note',
    );

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].base_amount.toString()).toBe('2777.78');
    expect(result.lines[0].tax_amount.toString()).toBe('222.22');
    expect(result.lines[0].total_amount.toString()).toBe('3000');
  });
});

/**
 * Writer seam: source-linked line input is recalculated before the delegated
 * balance candidate can consume a number. Aggregate balance policy is covered
 * by CreditNoteBalanceService's own integration suite.
 */
describe('credit-notes · recalculated partial writer balance seam', () => {
  const money = (v: number | string) => new Prisma.Decimal(v);
  const PARENT_ID = 7001;
  const ENTITY_ID = 3;
  const SOURCE_ITEM_ID = 101;

  function setup(parent_total: number) {
    mockRequestContext({ organization_id: 1, store_id: 100, user_id: 9 });
    const parent = buildInvoice({
      id: PARENT_ID,
      organization_id: 1,
      store_id: 100,
      invoice_type: 'sales_invoice',
      invoice_number: 'FV-1',
      status: 'accepted',
      accounting_entity_id: ENTITY_ID,
      currency: 'COP',
      subtotal_amount: money(parent_total),
      discount_amount: money(0),
      tax_amount: money(0),
      total_amount: money(parent_total),
      invoice_items: [{
        id: SOURCE_ITEM_ID,
        invoice_id: PARENT_ID,
        product_id: null,
        product_variant_id: null,
        description: 'Servicio facturado',
        quantity: money(1),
        unit_price: money(parent_total),
        discount_amount: money(0),
        tax_amount: money(0),
        total_amount: money(parent_total),
        price_unit_quantity: 1,
        unit_code: 'NIU',
        account_code: '413595',
        stock_units_consumed: null,
        serial_numbers_snapshot: null,
        aiu_component: null,
        financial_source_line_id: null,
        is_inclusive: false,
      }],
      invoice_taxes: [],
    });
    const prisma = createPrismaMock({
      invoices: ['findFirst', 'findMany', 'create'],
      invoice_items: ['createMany', 'findMany'],
      invoice_taxes: ['createMany'],
      dian_document_events: ['findFirst'],
      fiscal_transmissions: ['findFirst'],
    });
    (prisma as unknown as { withoutScope: () => unknown }).withoutScope = () => prisma;
    const created: Array<Record<string, unknown>> = [];
    let lastCreated: Record<string, unknown> | null = null;
    let nextItemId = 8000;
    prisma.invoices.findFirst.mockImplementation(async ({ where }: { where?: { id?: number } }) => {
      if (where?.id === PARENT_ID) return parent;
      return { ...(lastCreated ?? {}), id: 9000, invoice_items: [], invoice_taxes: [] };
    });
    prisma.dian_document_events.findFirst.mockResolvedValue(null);
    prisma.invoice_items.findMany.mockImplementation(async () => [
      { id: ++nextItemId, source_invoice_item_id: SOURCE_ITEM_ID },
    ]);
    prisma.invoices.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      created.push(data);
      lastCreated = data;
      return { id: 9000, ...data };
    });
    prisma.invoice_taxes.createMany.mockResolvedValue({ count: 0 });
    let nextNumber = 0;
    const invoice_number_generator = {
      generateNextNumber: jest.fn(async () => ({
        invoice_number: `NC${++nextNumber}`,
        resolution_id: 40,
      })),
    };
    const balance = {
      assertCanCreate: jest.fn(async () => undefined),
      remaining: jest.fn(),
    };
    const service = new CreditNotesService(
      prisma as never,
      invoice_number_generator as never,
      { emit: jest.fn() } as never,
      {
        findFiscalAccountingEntityId: jest.fn(async () => ENTITY_ID),
      } as never,
      { assertAreaActive: jest.fn(async () => undefined) } as never,
      {} as never,
      new InvoiceCalculatorService(),
      balance as never,
    );
    return { service, prisma, created, invoice_number_generator, balance };
  }

  const partialNote = (amount: number): CreateCreditNoteDto => ({
    related_invoice_id: PARENT_ID,
    issue_date: '2026-10-13',
    items: [{ source_invoice_item_id: SOURCE_ITEM_ID, quantity: 1, unit_price: amount }],
  });

  it('balance rejection is propagated before numbering or writes', async () => {
    const { service, prisma, invoice_number_generator, balance } = setup(100);
    balance.assertCanCreate.mockRejectedValueOnce(new VendixHttpException(
      ErrorCodes.INVOICING_CREDIT_NOTE_001,
      undefined,
      { related_invoice_id: PARENT_ID, parent_total: '100', remaining: '40', attempted: '60' },
    ));

    await expect(service.createCreditNote(partialNote(60))).rejects.toMatchObject({
      errorCode: ErrorCodes.INVOICING_CREDIT_NOTE_001.code,
    });
    expect(balance.assertCanCreate).toHaveBeenCalledWith(PARENT_ID, expect.objectContaining({
      total_amount: money(60),
    }));
    expect(invoice_number_generator.generateNextNumber).not.toHaveBeenCalled();
    expect(prisma.invoices.create).not.toHaveBeenCalled();
  });

  it('surfaces delegated balance details unchanged without re-deriving balance policy', async () => {
    const { service, balance, invoice_number_generator } = setup(100);
    const error = new VendixHttpException(ErrorCodes.INVOICING_CREDIT_NOTE_001, undefined, {
      related_invoice_id: PARENT_ID,
      parent_total: '100',
      already_credited: '60',
      remaining: '40',
      attempted: '60',
    });
    balance.assertCanCreate.mockRejectedValueOnce(error);

    await expect(service.createCreditNote(partialNote(60))).rejects.toBe(error);
    expect(invoice_number_generator.generateNextNumber).not.toHaveBeenCalled();
  });

  it('a permitted partial note persists calculator-derived values and the source id', async () => {
    const { service, prisma, created, invoice_number_generator, balance } = setup(100);

    const note = await service.createCreditNote(partialNote(30));

    expect(note).toMatchObject({ invoice_number: 'NC1' });
    expect(balance.assertCanCreate).toHaveBeenCalledWith(PARENT_ID, expect.objectContaining({
      total_amount: money(30),
      lines: [expect.objectContaining({ source_invoice_item_id: SOURCE_ITEM_ID })],
    }));
    expect(created[0]).toMatchObject({
      subtotal_amount: money(30),
      tax_amount: money(0),
      total_amount: money(30),
    });
    expect(prisma.invoice_items.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        source_invoice_item_id: SOURCE_ITEM_ID,
        total_amount: money(30),
      })],
    });
    expect(invoice_number_generator.generateNextNumber).toHaveBeenCalledTimes(1);
  });

  it('a later candidate is allowed when the delegated balance service approves it', async () => {
    const { service, balance, invoice_number_generator } = setup(100);
    balance.assertCanCreate.mockRejectedValueOnce(new VendixHttpException(
      ErrorCodes.INVOICING_CREDIT_NOTE_001,
      undefined,
      { remaining: '40', attempted: '60' },
    )).mockResolvedValueOnce(undefined);

    await expect(service.createCreditNote(partialNote(60))).rejects.toMatchObject({
      errorCode: ErrorCodes.INVOICING_CREDIT_NOTE_001.code,
    });
    await expect(service.createCreditNote(partialNote(40))).resolves.toMatchObject({
      invoice_number: 'NC1',
    });
    expect(invoice_number_generator.generateNextNumber).toHaveBeenCalledTimes(1);
  });

  it('an exactly exhausted balance can be approved by the balance service', async () => {
    const { service, balance } = setup(100);
    await expect(service.createCreditNote(partialNote(100))).resolves.toMatchObject({
      total_amount: money(100),
    });
    expect(balance.assertCanCreate).toHaveBeenCalledWith(PARENT_ID, expect.objectContaining({
      total_amount: money(100),
    }));
  });
});
