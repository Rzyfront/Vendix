import { Prisma } from '@prisma/client';
import { CreditNotesService } from './credit-notes.service';
import type { CreateCreditNoteDto } from './dto/create-credit-note.dto';
import {
  createPrismaMock,
  mockRequestContext,
} from '../../../../testing/prisma-mock';
import { buildInvoice } from '../../../../testing/money-fixtures';

/**
 * F-INC6 — pruebas de extremo a extremo de `createNote` (nota crédito), no
 * del kernel puro (`credit-notes.b1-partial-kernel.spec.ts` ya cubre
 * exhaustivamente `derivePartialNoteLinesViaKernel` en aislamiento).
 *
 * Este archivo prueba que el SERVICIO ensambla correctamente lo que el
 * kernel deriva: la cabecera en `Prisma.Decimal` sin fuga de float (P0), la
 * copia verbatim de una nota TOTAL (incluido un descuento a nivel de orden
 * que ninguna línea carga), el snapshot de identidad completo del
 * adquiriente, y —el fix más grande de esta ronda— que
 * `invoice_taxes.invoice_item_id` quede ligado al id REAL de la línea
 * recién creada en la NOTA (no en la factura padre) cuando el documento
 * mezcla ≥2 tributos.
 */
describe('CreditNotesService — createNote extremo a extremo (F-INC6)', () => {
  const money = (v: number | string) => new Prisma.Decimal(v);
  const ENTITY_ID = 3;
  const STORE_ID = 100;
  const NOTE_ID = 9001;

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
    // `resolveNoteTaxTypes` y la fase 2 del create (`invoice_taxes.createMany`)
    // van por `withoutScope()`. Mismo mock, mismos handles.
    (prisma as unknown as { withoutScope: () => unknown }).withoutScope = () =>
      prisma;

    const created: Array<Record<string, any>> = [];
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
      customer_tax_id: last_created_data?.customer_tax_id,
      customer_document_type: last_created_data?.customer_document_type,
      customer_verification_digit:
        last_created_data?.customer_verification_digit,
      customer_email: last_created_data?.customer_email,
      customer_phone: last_created_data?.customer_phone,
      customer_tax_regime: last_created_data?.customer_tax_regime,
      customer_fiscal_responsibilities:
        last_created_data?.customer_fiscal_responsibilities,
      invoice_items: last_created_items,
      invoice_taxes: created_taxes,
    });

    // Distingue la búsqueda de la factura PADRE de la RE-LECTURA de la nota
    // recién creada (segunda fase, tras `invoice_taxes.createMany`).
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
        created.push(data);
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

    return { service, prisma, created, created_taxes, invoice_number_generator };
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

  it('P0 — 3×1300 INC-inclusivo: la cabecera no acumula fuga de float (repro 3900.0000000000005)', async () => {
    // Antes del fix, sumar estos mismos 3 floats con `+=` da
    // 3900.0000000000005 (ver docblock de `createNote`): mayor que el saldo
    // exacto de la factura y rechazado con `INVOICING_CREDIT_NOTE_001` pese a
    // que la nota SÍ cabe. `Prisma.Decimal.reduce` no arrastra ese residuo.
    const parent = baseParent({
      id: 7100,
      total_amount: money(3900),
    });
    const { service } = setup(parent);

    const note = await service.createCreditNote({
      related_invoice_id: 7100,
      reason: 'Anulación parcial',
      items: [
        { product_id: null, description: 'Almuerzo', quantity: 1, unit_price: 1203.7, discount_amount: 0, tax_amount: 96.3 },
        { product_id: null, description: 'Almuerzo', quantity: 1, unit_price: 1203.7, discount_amount: 0, tax_amount: 96.3 },
        { product_id: null, description: 'Almuerzo', quantity: 1, unit_price: 1203.7, discount_amount: 0, tax_amount: 96.3 },
      ],
      taxes: [
        {
          tax_rate_id: 68,
          tax_name: 'INC 8%',
          tax_rate: 8,
          taxable_amount: 3611.1,
          tax_amount: 288.9,
          tax_type: 'inc',
        },
      ],
    } as unknown as CreateCreditNoteDto);

    expect(note.subtotal_amount.toString()).toBe('3611.1');
    expect(note.tax_amount.toString()).toBe('288.9');
    expect(note.total_amount.toString()).toBe('3900');
  });

  it('P0 — el guard de saldo rechaza con INVOICING_CREDIT_NOTE_001 exacto cuando SÍ excede', async () => {
    const parent = baseParent({ id: 7101, total_amount: money(100) });
    const { service, prisma, invoice_number_generator } = setup(parent);

    await expect(
      service.createCreditNote({
        related_invoice_id: 7101,
        reason: 'Excede el saldo',
        items: [
          { product_id: null, description: 'Línea', quantity: 1, unit_price: 150, discount_amount: 0, tax_amount: 0 },
        ],
        taxes: [
          { tax_rate_id: null, tax_name: 'IVA 0%', tax_rate: 0, taxable_amount: 150, tax_amount: 0, tax_type: 'iva' },
        ],
      } as unknown as CreateCreditNoteDto),
    ).rejects.toMatchObject({ errorCode: 'INVOICING_CREDIT_NOTE_001' });

    // Falla ANTES de numerar: un consecutivo autorizado no se devuelve.
    expect(invoice_number_generator.generateNextNumber).not.toHaveBeenCalled();
    expect(prisma.invoices.create).not.toHaveBeenCalled();
  });

  it('P0/P2 — NC TOTAL con descuento a nivel de orden: copia la cabecera verbatim, no recompone Σ(líneas)', async () => {
    // El descuento vive SÓLO en la cabecera del padre (cupón de orden); la
    // única línea no carga ningún descuento. Recomponer por línea (el
    // defecto original, FAU02) perdía los 200 del descuento.
    const parent = baseParent({
      id: 7200,
      subtotal_amount: money(1000),
      discount_amount: money(200),
      tax_amount: money(152),
      total_amount: money(952),
      invoice_items: [
        {
          id: 501,
          product_id: 5,
          product_variant_id: null,
          description: 'Combo con cupón de orden',
          quantity: money(1),
          unit_price: money(1000),
          discount_amount: money(0),
          tax_amount: money(152),
          total_amount: money(1152),
          is_inclusive: false,
          unit_code: 'UND',
          price_unit_quantity: 1,
          stock_units_consumed: null,
          serial_numbers_snapshot: null,
        },
      ],
      invoice_taxes: [
        {
          tax_rate_id: 1,
          tax_name: 'IVA 19%',
          tax_rate: money(19),
          tax_type: 'iva',
          taxable_amount: money(800),
          tax_amount: money(152),
        },
      ],
    });
    const { service } = setup(parent);

    const note = await service.createCreditNote({
      related_invoice_id: 7200,
      reason: 'Anulación total',
    } as unknown as CreateCreditNoteDto);

    expect(note.discount_amount.toString()).toBe('200');
    expect(note.subtotal_amount.toString()).toBe('1000');
    expect(note.total_amount.toString()).toBe('952');
  });

  it('F-INC6 — NC TOTAL de una factura INC 8% de $24.500: Σ líneas = subtotal, forma BASE preservada', async () => {
    const parent = baseParent({
      id: 7300,
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
      related_invoice_id: 7300,
      reason: 'Anulación total',
    } as unknown as CreateCreditNoteDto);

    const item = note.invoice_items[0];
    expect(item.unit_price.toString()).toBe('22685.19');
    expect(item.is_inclusive).toBe(false);
    const lineSum = (note.invoice_items as Array<Record<string, any>>).reduce(
      (acc, i) =>
        acc.plus(
          new Prisma.Decimal(i.quantity).times(i.unit_price).minus(i.discount_amount ?? 0),
        ),
      new Prisma.Decimal(0),
    );
    expect(lineSum.toString()).toBe(note.subtotal_amount.toString());
    expect(note.total_amount.toString()).toBe('24500');
  });

  it('F-INC6 — NC PARCIAL (kernel) sobre la misma factura INC 8%: Σ líneas = subtotal, unit_price re-solved en forma BASE', async () => {
    const parent = baseParent({
      id: 7301,
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
      related_invoice_id: 7301,
      reason: 'Devolución del menú',
      items: [
        { product_id: 9, description: 'Menú ejecutivo', quantity: 1, unit_price: 22685.19 },
      ],
    } as unknown as CreateCreditNoteDto);

    const item = note.invoice_items[0];
    expect(item.is_inclusive).toBe(false);
    expect(item.unit_price.toString()).toBe('22685.19');
    expect(item.tax_amount.toString()).toBe('1814.81');
    const lineSum = (note.invoice_items as Array<Record<string, any>>).reduce(
      (acc, i) =>
        acc.plus(
          new Prisma.Decimal(i.quantity).times(i.unit_price).minus(i.discount_amount ?? 0),
        ),
      new Prisma.Decimal(0),
    );
    expect(lineSum.toString()).toBe(note.subtotal_amount.toString());
    expect(note.total_amount.toString()).toBe('24500');
  });

  it('F-INC6 (Fix G) — mezcla INC+IVA: cada tributo queda ligado al invoice_item_id REAL de la línea de la NOTA, no de la factura padre', async () => {
    // Mismos números que el kernel puro ya prueba en
    // `credit-notes.b1-partial-kernel.spec.ts` («NC parcial de plato +
    // Envío»); acá se prueba que el SERVICIO persiste el vínculo
    // `invoice_taxes.invoice_item_id` contra los ids NUEVOS de la nota.
    const parent = baseParent({
      id: 7400,
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
    const { service, created_taxes } = setup(parent);

    const note = await service.createCreditNote({
      related_invoice_id: 7400,
      reason: 'Devolución parcial del plato + envío completo',
      items: [
        { product_id: 11, description: 'Plato', quantity: 1, unit_price: 25000 },
        { product_id: null, description: 'Envío', quantity: 1, unit_price: 12605.04 },
      ],
    } as unknown as CreateCreditNoteDto);

    expect(created_taxes).toHaveLength(2);
    const platoItem = (note.invoice_items as Array<Record<string, any>>).find(
      (i) => i.product_id === 11,
    );
    const envioItem = (note.invoice_items as Array<Record<string, any>>).find(
      (i) => i.product_id === null,
    );
    expect(platoItem).toBeDefined();
    expect(envioItem).toBeDefined();
    // Ninguno de los dos ids nuevos coincide con los de la factura PADRE
    // (701/702): si el vínculo hubiera quedado apuntando al padre, esta
    // aserción de desigualdad fallaría y delataría el bug que Fix G corrige.
    expect(platoItem!.id).not.toBe(701);
    expect(envioItem!.id).not.toBe(702);

    const incRow = created_taxes.find((t) => t.tax_type === 'inc')!;
    const ivaRow = created_taxes.find((t) => t.tax_type === 'iva')!;
    expect(incRow).toBeDefined();
    expect(ivaRow).toBeDefined();
    expect(incRow.invoice_item_id).toBe(platoItem!.id);
    expect(ivaRow.invoice_item_id).toBe(envioItem!.id);
    expect(incRow.taxable_amount.toString()).toBe('25000');
    expect(incRow.tax_amount.toString()).toBe('2000');
    expect(ivaRow.taxable_amount.toString()).toBe('12605.04');
    expect(ivaRow.tax_amount.toString()).toBe('2394.96');
  });

  it('P1 — factura legada con is_inclusive=true pero unit_price ya en forma BASE: no vuelve a despejar el impuesto', async () => {
    // gross = qty×unit_price = 3000; declared_base = total(3240) − cuota(240)
    // = 3000. gross ≈ declared_base ⇒ `twinIsGenuinelyInclusive` detecta que
    // el `unit_price` YA es base pese al flag y NO lo despeja de nuevo. El
    // defecto original habría dado base=2777.78/cuota=222.22 (mitad de la
    // cuota real) por tratar 3000 como si llevara el 8% mezclado adentro.
    const parent = baseParent({
      id: 7500,
      subtotal_amount: money(3000),
      discount_amount: money(0),
      tax_amount: money(240),
      total_amount: money(3240),
      invoice_items: [
        {
          id: 801,
          product_id: 77,
          product_variant_id: null,
          description: 'Combo legado (pre 8f8427f4b)',
          quantity: money(1),
          unit_price: money(3000),
          discount_amount: money(0),
          tax_amount: money(240),
          total_amount: money(3240),
          is_inclusive: true,
        },
      ],
      invoice_taxes: [
        {
          tax_rate_id: 68,
          tax_name: 'INC 8%',
          tax_rate: money(8),
          tax_type: 'inc',
          taxable_amount: money(3000),
          tax_amount: money(240),
          invoice_item_id: 801,
        },
      ],
    });
    const { service } = setup(parent);

    const note = await service.createCreditNote({
      related_invoice_id: 7500,
      reason: 'Devolución total del combo legado',
      items: [
        { product_id: 77, description: 'Combo legado (pre 8f8427f4b)', quantity: 1, unit_price: 3000 },
      ],
    } as unknown as CreateCreditNoteDto);

    const item = note.invoice_items[0];
    expect(item.is_inclusive).toBe(false);
    expect(item.unit_price.toString()).toBe('3000');
    expect(item.tax_amount.toString()).toBe('240');
    expect(item.total_amount.toString()).toBe('3240');
  });

  it('Identidad — copia snapshot COMPLETO del adquiriente (no sólo nombre/NIT)', async () => {
    // Repro Pollo Arabe → Óptica Panorama SAS: sin estos campos la NC salía a
    // la DIAN como CC + persona natural, sin DV ni email/teléfono.
    const parent = baseParent({
      id: 7600,
      customer_id: 42,
      customer_name: 'Óptica Panorama SAS',
      customer_tax_id: '800214345',
      customer_document_type: '31',
      customer_verification_digit: '7',
      customer_email: 'facturacion@panorama.example.com',
      customer_phone: '+57 3001234567',
      customer_tax_regime: '48',
      customer_fiscal_responsibilities: ['O-48', 'O-13'],
      total_amount: money(1000),
      invoice_items: [
        {
          id: 901,
          product_id: 3,
          product_variant_id: null,
          description: 'Consulta',
          quantity: money(1),
          unit_price: money(1000),
          discount_amount: money(0),
          tax_amount: money(0),
          total_amount: money(1000),
          is_inclusive: false,
        },
      ],
      invoice_taxes: [],
    });
    const { service } = setup(parent);

    const note = await service.createCreditNote({
      related_invoice_id: 7600,
      reason: 'Anulación total',
    } as unknown as CreateCreditNoteDto);

    expect(note.customer_id).toBe(42);
    expect(note.customer_name).toBe('Óptica Panorama SAS');
    expect(note.customer_tax_id).toBe('800214345');
    expect(note.customer_document_type).toBe('31');
    expect(note.customer_verification_digit).toBe('7');
    expect(note.customer_email).toBe('facturacion@panorama.example.com');
    expect(note.customer_phone).toBe('+57 3001234567');
    expect(note.customer_tax_regime).toBe('48');
    expect(note.customer_fiscal_responsibilities).toEqual(['O-48', 'O-13']);
  });
});
