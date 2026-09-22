import { Prisma } from '@prisma/client';
import { CreditNotesService } from './credit-notes.service';
import type { CreateCreditNoteDto } from './dto/create-credit-note.dto';
import {
  createPrismaMock,
  mockRequestContext,
} from '../../../../testing/prisma-mock';
import { buildInvoice } from '../../../../testing/money-fixtures';

/**
 * QUI-INC — el tipo fiscal de una NOTA CRÉDITO no se inventa en el punto de
 * escritura.
 *
 * El defecto era `tax_type: ((tax_item as any).tax_type ?? 'iva') as any` en
 * el `create` de `invoice_taxes`. Dos `as any` y un `??` sobre el documento
 * electrónico que va FIRMADO a la DIAN: una nota que acredita un tributo
 * distinto del que facturó descuadra la declaración del periodo, y el error
 * sobrevive al documento (las filas ya escritas no se corrigen).
 *
 * El `as any` de entrada ocultaba que las TRES procedencias de `tax_item`
 * difieren: `dto.taxes[]` declara `tax_type?` OPCIONAL, y las dos copias del
 * padre lo leen de `invoice_taxes.tax_type`, columna NULLABLE. El de salida
 * ocultaba que un `string` suelto no es asignable al `tax_type_enum` de
 * Prisma.
 */
describe('CreditNotesService — QUI-INC: tax_type de invoice_taxes', () => {
  const money = (v: number | string) => new Prisma.Decimal(v);
  const PARENT_ID = 9100;
  const ENTITY_ID = 3;
  const STORE_ID = 100;

  function setup(parent_taxes: Array<Record<string, unknown>>) {
    mockRequestContext({ store_id: STORE_ID });

    const parent = buildInvoice({
      id: PARENT_ID,
      invoice_type: 'sales_invoice',
      invoice_number: 'FV-1',
      status: 'accepted',
      accounting_entity_id: ENTITY_ID,
      currency: 'COP',
      subtotal_amount: money(1000),
      tax_amount: money(80),
      total_amount: money(1080),
      invoice_items: [
        {
          product_id: null,
          product_variant_id: null,
          description: 'Bandeja paisa',
          quantity: money(1),
          unit_price: money(1000),
          discount_amount: money(0),
          tax_amount: money(80),
          price_unit_quantity: 1,
          is_inclusive: false,
        },
      ],
      invoice_taxes: parent_taxes,
    });

    const prisma = createPrismaMock({
      invoices: ['findFirst', 'findMany', 'create'],
      products: ['findMany'],
      product_variants: ['findMany'],
      store_settings: ['findFirst'],
      tax_rates: ['findMany'],
    });
    // `resolveNoteTaxTypes` consulta el catálogo con `withoutScope()` (la
    // tarifa puede ser global, `store_id IS NULL`, y el scope automático la
    // dejaría invisible). El doble devuelve el mismo mock para que el test
    // asierte sobre los mismos handles.
    (prisma as unknown as { withoutScope: () => unknown }).withoutScope = () =>
      prisma;

    prisma.invoices.findFirst.mockResolvedValue(parent);
    prisma.invoices.findMany.mockResolvedValue([]);
    prisma.store_settings.findFirst.mockResolvedValue(null);
    prisma.tax_rates.findMany.mockResolvedValue([]);

    const created: Array<Record<string, any>> = [];
    prisma.invoices.create.mockImplementation(
      async ({ data }: { data: Record<string, any> }) => {
        created.push(data);
        return {
          id: 8001,
          invoice_number: data.invoice_number,
          invoice_type: data.invoice_type,
          status: data.status,
        };
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

    return { service, prisma, created, invoice_number_generator };
  }

  /** Nota TOTAL: sin `items` ni `taxes`, copia el documento que corrige. */
  const totalNote = (): CreateCreditNoteDto =>
    ({
      related_invoice_id: PARENT_ID,
      reason: 'Anulación',
    }) as CreateCreditNoteDto;

  const incParentTax = (over: Record<string, unknown> = {}) => ({
    tax_rate_id: 68,
    tax_name: 'INC',
    tax_rate: money(8),
    taxable_amount: money(1000),
    tax_amount: money(80),
    tax_type: 'inc',
    ...over,
  });

  it('la nota que copia una factura INC acredita INC, no IVA', async () => {
    const { service, created } = setup([incParentTax()]);

    await service.createCreditNote(totalNote());

    const taxRow = created[0].invoice_taxes.create[0];
    expect(taxRow).toMatchObject({
      tax_rate_id: 68,
      tax_name: 'INC',
      tax_type: 'inc',
    });
    expect(taxRow.tax_type).not.toBe('iva');
  });

  it('un desglose explícito SIN tax_type se resuelve contra el catálogo (tax_rates → tax_categories), no con "iva"', async () => {
    // Éste es el camino ALCANZABLE por API: `CreateInvoiceTaxDto.tax_type` es
    // opcional, así que un llamador que envía el desglose sin clasificarlo
    // hacía que la nota de un restaurante INC se acreditara como IVA.
    const { service, created, prisma } = setup([incParentTax()]);
    prisma.tax_rates.findMany.mockResolvedValue([
      { id: 68, tax_categories: { tax_type: 'inc' } },
    ]);

    await service.createCreditNote({
      related_invoice_id: PARENT_ID,
      reason: 'Anulación',
      taxes: [
        {
          tax_rate_id: 68,
          tax_name: 'INC',
          tax_rate: 8,
          taxable_amount: 1000,
          tax_amount: 80,
        },
      ],
    } as CreateCreditNoteDto);

    // El lookup se hace contra la tienda o la tarifa global, nunca a ciegas.
    expect(prisma.tax_rates.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: [68] },
          OR: [{ store_id: STORE_ID }, { store_id: null }],
        }),
      }),
    );
    const taxRow = created[0].invoice_taxes.create[0];
    expect(taxRow.tax_type).toBe('inc');
    expect(taxRow.tax_type).not.toBe('iva');
  });

  it('sin tipo y sin fila de catálogo de la cual deducirlo: rechaza y NO gasta consecutivo', async () => {
    const { service, prisma, invoice_number_generator } = setup([
      incParentTax({ tax_type: null, tax_rate_id: null }),
    ]);

    await expect(service.createCreditNote(totalNote())).rejects.toMatchObject({
      errorCode: 'NOTE_TAX_TYPE_UNRESOLVABLE_001',
    });

    // Falla ruidosa ANTES de numerar: un consecutivo autorizado no se
    // devuelve, y una nota fiscalmente ambigua no vale quemar uno.
    expect(invoice_number_generator.generateNextNumber).not.toHaveBeenCalled();
    expect(prisma.invoices.create).not.toHaveBeenCalled();
  });

  it('el tipo declarado en el desglose manda y no dispara lookup de catálogo', async () => {
    const { service, created, prisma } = setup([incParentTax()]);

    await service.createCreditNote({
      related_invoice_id: PARENT_ID,
      reason: 'Anulación',
      taxes: [
        {
          tax_rate_id: 68,
          tax_name: 'INC',
          tax_rate: 8,
          taxable_amount: 1000,
          tax_amount: 80,
          tax_type: 'inc',
        },
      ],
    } as CreateCreditNoteDto);

    expect(prisma.tax_rates.findMany).not.toHaveBeenCalled();
    expect(created[0].invoice_taxes.create[0].tax_type).toBe('inc');
  });
});
