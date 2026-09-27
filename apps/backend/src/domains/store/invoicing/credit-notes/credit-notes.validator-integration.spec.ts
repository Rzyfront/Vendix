import { Prisma } from '@prisma/client';
import { CreditNotesService } from './credit-notes.service';
import type { CreateCreditNoteDto } from './dto/create-credit-note.dto';
import {
  createPrismaMock,
  mockRequestContext,
} from '../../../../testing/prisma-mock';
import { buildInvoice } from '../../../../testing/money-fixtures';
import { FiscalDocumentValidator } from '../validators/fiscal-document.validator';

/**
 * Agente E, Task 2 — integra `createNote` (nota crédito) con el prevalidador
 * REAL (`FiscalDocumentValidator`), no con aritmética propia del test. Cada
 * escenario reproduce un cierre de restaurante ya cubierto en
 * `credit-notes.service.createnote.spec.ts` (mismos mocks/fixtures: ver
 * `setup()` abajo, calcado de ese archivo) y corre el documento RESULTANTE
 * —tal como `createCreditNote` lo persistió, no una reconstrucción manual—
 * contra `validate()`. Se verifica la AUSENCIA de los cuatro hallazgos de
 * descuadre aritmético que bloquearían la emisión:
 * `HEADER_LINE_EXTENSION_MISMATCH`, `HEADER_TAX_TOTAL_MISMATCH`,
 * `PAYABLE_AMOUNT_MISMATCH`, `TAX_SUBTOTAL_MISMATCH`. Si alguno apareciera
 * sería un bug real de `credit-notes.service.ts`, no un defecto del test.
 *
 * `document_type: 'credit_note'` no exige rango autorizado
 * (`requires_authorized_range: false` en `fiscal-document-requirements.ts`),
 * así que `resolution: null` no dispara `RESOLUTION_MISSING` — a diferencia
 * de `invoicing.service.order-emission-coherence.spec.ts` (factura de
 * venta), acá SÍ se puede afirmar `emittable` sin ese blocker de por medio.
 *
 * NOTA (hallazgo reportado, no corregido — fuera de los 4 códigos que esta
 * suite exige ausentes): `credit_note.emits_document_allowance_charge` es
 * `false` mientras que `sales_invoice` es `true`. Una factura padre con un
 * descuento de CABECERA no explicado por sus líneas (ej. cupón de orden,
 * patrón ya cubierto por el test "P0/P2" de `credit-notes.service
 * .createnote.spec.ts`) es válida en la factura pero, copiada VERBATIM a una
 * nota crédito por `is_total_copy`, dispararía `ALLOWANCE_TOTAL_UNBACKED`
 * contra el validador real — el UBL `CreditNote` no tiene grupo de pie que
 * respalde ese descuento. Los fixtures de este archivo evitan
 * deliberadamente ese caso (el descuento de orden del escenario D se
 * distribuye a nivel de línea, como ya lo hace `createFromOrder` en
 * producción vía `projectOrderInvoiceLines`); el caso de cabecera-sin-línea
 * queda señalado acá para quien retome el pre-existente `ALLOWANCE_TOTAL_UNBACKED`.
 */
describe('CreditNotesService.createCreditNote — integración con FiscalDocumentValidator real (Agente E, Task 2)', () => {
  const money = (v: number | string) => new Prisma.Decimal(v);
  const ENTITY_ID = 3;
  const STORE_ID = 100;
  const NOTE_ID = 9500;

  function setup(parent: Record<string, any>) {
    mockRequestContext({ store_id: STORE_ID });

    const prisma = createPrismaMock({
      invoices: ['findFirst', 'findMany', 'create'],
      invoice_taxes: ['createMany'],
      products: ['findMany'],
      product_variants: ['findMany'],
      store_settings: ['findFirst'],
      tax_rates: ['findMany'],
    });
    (prisma as unknown as { withoutScope: () => unknown }).withoutScope = () =>
      prisma;

    const created_taxes: Array<Record<string, any>> = [];
    let next_item_id = 1;
    let last_created_data: Record<string, any> | null = null;
    let last_created_items: Array<Record<string, any>> = [];

    const noteSnapshot = () => ({
      id: NOTE_ID,
      invoice_number: last_created_data?.invoice_number,
      invoice_type: last_created_data?.invoice_type,
      status: last_created_data?.status,
      subtotal_amount: last_created_data?.subtotal_amount,
      discount_amount: last_created_data?.discount_amount,
      tax_amount: last_created_data?.tax_amount,
      total_amount: last_created_data?.total_amount,
      customer_id: last_created_data?.customer_id,
      customer_name: last_created_data?.customer_name,
      invoice_items: last_created_items,
      invoice_taxes: created_taxes,
    });

    prisma.invoices.findFirst.mockImplementation(async ({ where }: any) => {
      if (where?.id === parent.id) return parent;
      if (where?.id === NOTE_ID) return noteSnapshot();
      return null;
    });
    prisma.invoices.findMany.mockResolvedValue([]);
    prisma.store_settings.findFirst.mockResolvedValue(null);
    prisma.tax_rates.findMany.mockResolvedValue([]);
    prisma.products.findMany.mockImplementation(async ({ where }: any) =>
      ((where?.id?.in ?? []) as number[]).map((id) => ({ id })),
    );
    prisma.product_variants.findMany.mockImplementation(
      async ({ where }: any) =>
        ((where?.id?.in ?? []) as number[]).map((id) => ({ id })),
    );

    prisma.invoices.create.mockImplementation(
      async ({ data }: { data: Record<string, any> }) => {
        last_created_data = data;
        last_created_items = (data.invoice_items?.create ?? []).map(
          (item: Record<string, unknown>) => ({
            id: next_item_id++,
            ...item,
          }),
        );
        return noteSnapshot();
      },
    );
    prisma.invoice_taxes.createMany.mockImplementation(
      async ({ data }: { data: Array<Record<string, any>> }) => {
        created_taxes.push(...data);
        return { count: data.length };
      },
    );

    const invoice_number_generator = {
      generateNextNumber: jest.fn(async () => ({
        invoice_number: 'NC1',
        resolution_id: 40,
      })),
    };

    const service = new CreditNotesService(
      prisma as never,
      invoice_number_generator as never,
      { emit: jest.fn() } as never,
      {
        resolveAccountingEntityForFiscal: jest.fn(async () => ({
          id: ENTITY_ID,
        })),
      } as never,
      { assertAreaActive: jest.fn(async () => undefined) } as never,
      {} as never,
    );

    return { service };
  }

  const baseParent = (overrides: Record<string, any> = {}) =>
    buildInvoice({
      invoice_type: 'sales_invoice',
      invoice_number: 'FV-1',
      status: 'accepted',
      accounting_entity_id: ENTITY_ID,
      currency: 'COP',
      ...overrides,
    });

  /** El mismo prevalidador REAL que emitiría/rechazaría el documento en `send()`. */
  const validateNote = (note: Record<string, any>) =>
    new FiscalDocumentValidator().validate({
      document_type: 'credit_note',
      subtotal_amount: note.subtotal_amount,
      discount_amount: note.discount_amount ?? '0.00',
      tax_amount: note.tax_amount,
      total_amount: note.total_amount,
      items: (note.invoice_items as Array<Record<string, any>>).map(
        (line, index) => ({
          line_number: index + 1,
          quantity: line.quantity,
          unit_price: line.unit_price,
          discount_amount: line.discount_amount,
          tax_amount: line.tax_amount,
          price_unit_quantity: line.price_unit_quantity ?? undefined,
        }),
      ),
      taxes: (note.invoice_taxes as Array<Record<string, any>>).map(
        (row) => ({
          tax_name: row.tax_name,
          tax_type: row.tax_type,
          tax_rate: row.tax_rate,
          taxable_amount: row.taxable_amount,
          tax_amount: row.tax_amount,
        }),
      ),
      resolution: null,
    });

  const expectNoArithmeticMismatch = (
    report: ReturnType<FiscalDocumentValidator['validate']>,
  ) => {
    const codes = report.findings.map((f) => f.code);
    expect(codes).not.toContain('HEADER_LINE_EXTENSION_MISMATCH');
    expect(codes).not.toContain('HEADER_TAX_TOTAL_MISMATCH');
    expect(codes).not.toContain('PAYABLE_AMOUNT_MISMATCH');
    expect(codes).not.toContain('TAX_SUBTOTAL_MISMATCH');
  };

  it('1×24500 INC 8% inclusivo (base 22685.19, cuota 1814.81) — NC TOTAL', async () => {
    const parent = baseParent({
      id: 8100,
      subtotal_amount: money(22685.19),
      discount_amount: money(0),
      tax_amount: money(1814.81),
      total_amount: money(24500),
      invoice_items: [
        {
          id: 601,
          product_id: 9,
          product_variant_id: null,
          description: 'Menú ejecutivo',
          quantity: money(1),
          unit_price: money(22685.19),
          discount_amount: money(0),
          tax_amount: money(1814.81),
          total_amount: money(24500),
          is_inclusive: false,
          unit_code: 'UND',
          price_unit_quantity: 1,
          stock_units_consumed: 1,
          serial_numbers_snapshot: null,
        },
      ],
      invoice_taxes: [
        {
          tax_rate_id: 70,
          tax_name: 'INC 8%',
          tax_rate: money(8),
          tax_type: 'inc',
          taxable_amount: money(22685.19),
          tax_amount: money(1814.81),
        },
      ],
    });
    const { service } = setup(parent);

    const note = await service.createCreditNote({
      related_invoice_id: 8100,
      reason: 'Anulación total',
    } as unknown as CreateCreditNoteDto);

    const report = validateNote(note);
    expectNoArithmeticMismatch(report);
  });

  it('1×24500 INC 8% inclusivo (base 22685.19, cuota 1814.81) — NC PARCIAL (misma línea completa vía kernel)', async () => {
    const parent = baseParent({
      id: 8101,
      subtotal_amount: money(22685.19),
      discount_amount: money(0),
      tax_amount: money(1814.81),
      total_amount: money(24500),
      invoice_items: [
        {
          id: 602,
          product_id: 9,
          product_variant_id: null,
          description: 'Menú ejecutivo',
          quantity: money(1),
          unit_price: money(22685.19),
          discount_amount: money(0),
          tax_amount: money(1814.81),
          total_amount: money(24500),
          is_inclusive: false,
          unit_code: 'UND',
          price_unit_quantity: 1,
          stock_units_consumed: 1,
          serial_numbers_snapshot: null,
        },
      ],
      invoice_taxes: [
        {
          tax_rate_id: 70,
          tax_name: 'INC 8%',
          tax_rate: money(8),
          tax_type: 'inc',
          taxable_amount: money(22685.19),
          tax_amount: money(1814.81),
        },
      ],
    });
    const { service } = setup(parent);

    const note = await service.createCreditNote({
      related_invoice_id: 8101,
      reason: 'Devolución del menú',
      items: [
        { product_id: 9, description: 'Menú ejecutivo', quantity: 1, unit_price: 22685.19 },
      ],
    } as unknown as CreateCreditNoteDto);

    const report = validateNote(note);
    expectNoArithmeticMismatch(report);
  });

  it('3×1300 INC 8% inclusivo (base 3611.11, cuota 288.89) — NC TOTAL', async () => {
    const parent = baseParent({
      id: 8102,
      subtotal_amount: money(3611.11),
      discount_amount: money(0),
      tax_amount: money(288.89),
      total_amount: money(3900),
      invoice_items: [
        {
          id: 603,
          product_id: 301,
          product_variant_id: null,
          description: 'Limonada de coco (x3)',
          quantity: money(1),
          unit_price: money(3611.11),
          discount_amount: money(0),
          tax_amount: money(288.89),
          total_amount: money(3900),
          is_inclusive: false,
          unit_code: 'UND',
          price_unit_quantity: 1,
        },
      ],
      invoice_taxes: [
        {
          tax_rate_id: 68,
          tax_name: 'INC 8%',
          tax_rate: money(8),
          tax_type: 'inc',
          taxable_amount: money(3611.11),
          tax_amount: money(288.89),
        },
      ],
    });
    const { service } = setup(parent);

    const note = await service.createCreditNote({
      related_invoice_id: 8102,
      reason: 'Anulación total',
    } as unknown as CreateCreditNoteDto);

    const report = validateNote(note);
    expectNoArithmeticMismatch(report);
  });

  it('2×25000 con descuento de orden de 5000 (distribuido a la línea) — NC TOTAL', async () => {
    // El descuento vive a nivel de LÍNEA (como ya lo persiste
    // `createFromOrder` vía `projectOrderInvoiceLines`), no sólo en la
    // cabecera: así lo explican tanto la factura padre como la nota, y
    // ninguno de los dos dispara `ALLOWANCE_TOTAL_UNBACKED` (ver nota del
    // docblock del describe).
    const parent = baseParent({
      id: 8103,
      subtotal_amount: money(45000),
      discount_amount: money(5000),
      tax_amount: money(8550),
      total_amount: money(53550),
      invoice_items: [
        {
          id: 604,
          product_id: 21,
          product_variant_id: null,
          description: 'Combo pareja',
          quantity: money(2),
          unit_price: money(25000),
          discount_amount: money(5000),
          tax_amount: money(8550),
          total_amount: money(53550),
          is_inclusive: false,
          unit_code: 'UND',
          price_unit_quantity: 1,
        },
      ],
      invoice_taxes: [
        {
          tax_rate_id: 1,
          tax_name: 'IVA 19%',
          tax_rate: money(19),
          tax_type: 'iva',
          taxable_amount: money(45000),
          tax_amount: money(8550),
        },
      ],
    });
    const { service } = setup(parent);

    const note = await service.createCreditNote({
      related_invoice_id: 8103,
      reason: 'Anulación total',
    } as unknown as CreateCreditNoteDto);

    const report = validateNote(note);
    expectNoArithmeticMismatch(report);
  });

  it('mezcla IVA 19% + INC 8% (plato + envío) — NC PARCIAL: cada tributo con su propia fila', async () => {
    const parent = baseParent({
      id: 8104,
      subtotal_amount: money(62605.04),
      discount_amount: money(0),
      tax_amount: money(6394.96),
      total_amount: money(69000),
      invoice_items: [
        {
          id: 701,
          product_id: 11,
          product_variant_id: null,
          description: 'Plato',
          quantity: money(1),
          unit_price: money(50000),
          discount_amount: money(0),
          tax_amount: money(4000),
          total_amount: money(54000),
          is_inclusive: false,
        },
        {
          id: 702,
          product_id: null,
          product_variant_id: null,
          description: 'Envío',
          quantity: money(1),
          unit_price: money(12605.04),
          discount_amount: money(0),
          tax_amount: money(2394.96),
          total_amount: money(15000),
          is_inclusive: false,
        },
      ],
      invoice_taxes: [
        {
          tax_rate_id: 68,
          tax_name: 'INC 8%',
          tax_rate: money(8),
          tax_type: 'inc',
          taxable_amount: money(50000),
          tax_amount: money(4000),
          invoice_item_id: 701,
        },
        {
          tax_rate_id: 1,
          tax_name: 'IVA 19%',
          tax_rate: money(19),
          tax_type: 'iva',
          taxable_amount: money(12605.04),
          tax_amount: money(2394.96),
          invoice_item_id: 702,
        },
      ],
    });
    const { service } = setup(parent);

    const note = await service.createCreditNote({
      related_invoice_id: 8104,
      reason: 'Devolución parcial del plato + envío completo',
      items: [
        { product_id: 11, description: 'Plato', quantity: 1, unit_price: 25000 },
        { product_id: null, description: 'Envío', quantity: 1, unit_price: 12605.04 },
      ],
    } as unknown as CreateCreditNoteDto);

    expect(note.invoice_taxes).toHaveLength(2);
    const report = validateNote(note);
    expectNoArithmeticMismatch(report);
  });
});
