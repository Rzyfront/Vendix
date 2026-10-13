import { Prisma } from '@prisma/client';
import { CreditNotesService } from './credit-notes.service';
import type { CreateCreditNoteDto } from './dto/create-credit-note.dto';
import {
  createPrismaMock,
  mockRequestContext,
} from '../../../../testing/prisma-mock';
import { buildInvoice } from '../../../../testing/money-fixtures';
import { InvoiceCalculatorService } from '../services/invoice-calculator.service';

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

  function setup(parent: Record<string, any>, balanceOverrides: Record<string, any> = {}) {
    mockRequestContext({ store_id: STORE_ID });

    const prisma = createPrismaMock({
      invoices: ['findFirst', 'findMany', 'create'],
      invoice_items: ['createMany', 'findMany'],
      invoice_taxes: ['createMany'],
      dian_document_events: ['findFirst'],
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
    const created_items: Array<Record<string, any>> = [];

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
      invoice_items: created_items,
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
    prisma.dian_document_events.findFirst.mockResolvedValue(null);
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
        return noteSnapshot();
      },
    );
    prisma.invoice_items.createMany.mockImplementation(
      async ({ data }: { data: Array<Record<string, any>> }) => {
        created_items.push(...data.map((item) => ({ id: next_item_id++, ...item })));
        return { count: data.length };
      },
    );
    prisma.invoice_items.findMany.mockImplementation(async ({ where }: any) =>
      created_items
        .filter((item) => item.invoice_id === where?.invoice_id)
        .map(({ id, source_invoice_item_id }) => ({ id, source_invoice_item_id })),
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

    const credit_note_balance = {
      assertCanCreate: jest.fn().mockResolvedValue(undefined),
      remaining: jest.fn().mockResolvedValue(null),
      ...balanceOverrides,
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
      credit_note_balance as never,
    );

    return { service, prisma, created, created_items, created_taxes, invoice_number_generator, credit_note_balance };
  }

  const baseParent = (overrides: Record<string, any> = {}) => {
    const invoice = buildInvoice({
      invoice_type: 'sales_invoice',
      invoice_number: 'FV-1',
      status: 'accepted',
      accounting_entity_id: ENTITY_ID,
      currency: 'COP',
      ...overrides,
    });
    return {
      ...invoice,
      invoice_items: (invoice.invoice_items ?? []).map((item: Record<string, any>, index: number) => ({
        ...item,
        id: item.id ?? 900000 + index,
        invoice_id: invoice.id,
        unit_code: 'NIU',
        price_unit_quantity: item.price_unit_quantity ?? 1,
      })),
    };
  };
  const noteLine = (
    source_invoice_item_id: number,
    quantity: number,
    unit_price: number,
    extra: Record<string, unknown> = {},
  ) => ({ source_invoice_item_id, quantity, unit_price, ...extra });

  it.each(['033', '034'])('blocks NC creation before numbering when original has accepted RADIAN event %s', async (event_code) => {
    const parent = baseParent({
      id: 7100,
      total_amount: money(3900),
      invoice_items: [{ id: 900000, description: 'Almuerzo', quantity: money(1), unit_price: money(3900), discount_amount: money(0), tax_amount: money(0), total_amount: money(3900) }],
      invoice_taxes: [],
    });
    const h = setup(parent);
    h.prisma.dian_document_events.findFirst.mockResolvedValue({ id: 90, event_code });

    await expect(h.service.createCreditNote({
      related_invoice_id: 7100, reason: 'Anulación parcial',
      items: [{ source_invoice_item_id: 900000, quantity: 1, unit_price: 100, unit_code: 'NIU' }],
    } as unknown as CreateCreditNoteDto)).rejects.toMatchObject({ errorCode: 'INVOICING_STATUS_002' });

    expect(h.invoice_number_generator.generateNextNumber).not.toHaveBeenCalled();
    expect(h.prisma.invoices.create).not.toHaveBeenCalled();
    expect(h.prisma.dian_document_events.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        invoice_id: 7100, organization_id: parent.organization_id,
        OR: [{ store_id: parent.store_id }, { store_id: null }],
        event_code: { in: ['033', '034'] }, status: 'accepted',
      }),
    }));
  });

  it('P0 — 3×1300 INC: aplica el truncamiento fiscal canónico de las cuotas', async () => {
    // 1203.70 × 8% = 96.296; el motor fiscal trunca cada cuota a 96.29.
    // La fuente conserva su snapshot histórico firmado (96.30 por línea);
    // la selección parcial recalculada deriva cuotas canónicas. El payload sólo
    // elige líneas y valores comerciales, nunca fija tax_amount/taxes.
    const parent = baseParent({
      id: 7100,
      subtotal_amount: money(3611.1),
      tax_amount: money(288.9),
      total_amount: money(3900),
      invoice_items: [1, 2, 3].map((id) => ({
        id,
        product_id: null,
        product_variant_id: null,
        description: 'Almuerzo',
        quantity: money(1),
        unit_price: money(1203.7),
        discount_amount: money(0),
        tax_amount: money(96.3),
        total_amount: money(1300),
        is_inclusive: false,
        unit_code: 'NIU',
      })),
      invoice_taxes: [1, 2, 3].map((id) => ({
        invoice_item_id: id,
        tax_rate_id: 68,
        tax_name: 'INC 8%',
        tax_rate: money(8),
        taxable_amount: money(1203.7),
        tax_amount: money(96.3),
        tax_type: 'inc',
        is_inclusive: false,
      })),
    });
    const { service } = setup(parent);

    const note = await service.createCreditNote({
      related_invoice_id: 7100,
      reason: 'Anulación parcial',
      items: [1, 2, 3].map((id) => noteLine(id, 1, 1203.7, { unit_code: 'NIU' })),
    } as unknown as CreateCreditNoteDto);

    expect(note.subtotal_amount.toString()).toBe('3611.1');
    expect(note.tax_amount.toString()).toBe('288.87');
    expect(note.total_amount.toString()).toBe('3899.97');
  });

  it('rejects client-supplied fiscal taxes before numbering', async () => {
    const parent = baseParent({
      id: 7102,
      total_amount: money(100),
      invoice_items: [{
        id: 71021, description: 'Línea', quantity: money(1), unit_price: money(100),
        discount_amount: money(0), tax_amount: money(0), total_amount: money(100),
      }],
      invoice_taxes: [],
    });
    const { service, prisma, invoice_number_generator } = setup(parent);

    await expect(service.createCreditNote({
      related_invoice_id: 7102,
      reason: 'La tasa no puede venir del cliente',
      items: [{
        source_invoice_item_id: 71021,
        quantity: 1,
        unit_price: 100,
        tax_amount: 0,
      }],
      taxes: [],
    } as unknown as CreateCreditNoteDto)).rejects.toMatchObject({
      errorCode: 'INVOICING_NOTE_SOURCE_001',
    });
    expect(invoice_number_generator.generateNextNumber).not.toHaveBeenCalled();
    expect(prisma.invoices.create).not.toHaveBeenCalled();
  });

  it('P0 — el guard de saldo rechaza con INVOICING_CREDIT_NOTE_001 exacto cuando SÍ excede', async () => {
    const parent = baseParent({
      id: 7101,
      total_amount: money(100),
      invoice_items: [{
        id: 71011, description: 'Línea', quantity: money(1), unit_price: money(100),
        discount_amount: money(0), tax_amount: money(0), total_amount: money(100),
      }],
      invoice_taxes: [],
    });
    const { service, prisma, invoice_number_generator, credit_note_balance } = setup(parent, {
      assertCanCreate: jest.fn().mockRejectedValue(
        Object.assign(new Error('Credit note exceeds source balance'), {
          errorCode: 'INVOICING_CREDIT_NOTE_001',
        }),
      ),
    });

    await expect(
      service.createCreditNote({
        related_invoice_id: 7101,
        reason: 'Excede el saldo',
        items: [noteLine(71011, 1, 150, { unit_code: 'NIU' })],
      } as unknown as CreateCreditNoteDto),
    ).rejects.toMatchObject({ errorCode: 'INVOICING_CREDIT_NOTE_001' });

    // Falla ANTES de numerar: un consecutivo autorizado no se devuelve.
    expect(invoice_number_generator.generateNextNumber).not.toHaveBeenCalled();
    expect(prisma.invoices.create).not.toHaveBeenCalled();
    expect(credit_note_balance.assertCanCreate).toHaveBeenCalledTimes(1);
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
      items: [noteLine(602, 1, 22685.19)],
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
    // El snapshot fuente preserva IVA histórico 2394.96; la selección parcial
    // recalcula la cuota canónica 2394.95 sobre la base seleccionada.
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
      items: [noteLine(701, 1, 25000), noteLine(702, 1, 12605.04)],
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
    expect(ivaRow.tax_amount.toString()).toBe('2394.95');
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
      items: [noteLine(801, 1, 3000)],
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
      subtotal_amount: money(1000),
      tax_amount: money(0),
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
