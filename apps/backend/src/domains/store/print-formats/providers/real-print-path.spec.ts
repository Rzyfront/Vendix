import { VendixHttpException } from 'src/common/errors';
import { FiscalCreditNoteDataProvider } from './fiscal-credit-note.provider';
import { CreditNoteDataProvider } from './credit-note.provider';
import { KitchenTicketDataProvider } from './kitchen-ticket.provider';
import { TransferNoteDataProvider } from './transfer-note.provider';
import { mapFiscalDocumentToPrintData } from './fiscal-document-print.mapper';

/**
 * El carril REAL de impresión no puede devolver una muestra.
 *
 * `print-gateway.service.ts:174` llama `fetchDocumentData(storeId, documentId)`
 * para imprimir de verdad; `:280` lo llama para previsualizar, y ahí sí envuelve
 * la llamada en un `try/catch` que cae a `getSampleData`. Cuatro proveedores
 * hacían `return this.getSampleData(storeId)` en el primero, o sea que imprimir
 * entregaba un documento con datos de un tercero y formato impecable. Estas
 * pruebas fijan la separación: el carril real lee o falla, nunca fabrica.
 */

const prismaQueVacia = () => ({
  invoices: {
    findFirst: jest.fn().mockResolvedValue(null),
  },
});

const qrFalso = () => ({
  generateBuffer: jest.fn().mockResolvedValue(Buffer.from('x')),
});

describe('carril real de impresión: leer o fallar, nunca fabricar', () => {
  it('la nota de crédito fiscal LANZA con un id que no existe, en vez de devolver la muestra', async () => {
    const prisma = prismaQueVacia();
    const p = new FiscalCreditNoteDataProvider(prisma as any, qrFalso() as any);

    await expect(p.fetchDocumentData(10, 999999)).rejects.toBeInstanceOf(
      VendixHttpException,
    );
    // La prueba fuerte no es que lance: es que consultó. Un `return sample`
    // habría resuelto sin tocar la base.
    expect(prisma.invoices.findFirst).toHaveBeenCalledTimes(1);
  });

  it('la nota de crédito fiscal filtra por invoice_type: un id de factura de venta no se imprime como nota', async () => {
    const prisma = prismaQueVacia();
    const p = new FiscalCreditNoteDataProvider(prisma as any, qrFalso() as any);

    await expect(p.fetchDocumentData(10, 12)).rejects.toThrow();

    const where = prisma.invoices.findFirst.mock.calls[0][0].where;
    expect(where.store_id).toBe(10);
    expect(where.id).toBe(12);
    expect(where.invoice_type).toEqual({ in: ['credit_note'] });
  });

  it('la nota de crédito NO fiscal también lee, y también filtra por tipo', async () => {
    const prisma = prismaQueVacia();
    const p = new CreditNoteDataProvider(prisma as any);

    await expect(p.fetchDocumentData(10, 12)).rejects.toThrow();

    const where = prisma.invoices.findFirst.mock.calls[0][0].where;
    expect(where.invoice_type).toBe('credit_note');
  });

  it('un id no numérico se rechaza antes de consultar', async () => {
    const prisma = prismaQueVacia();
    const p = new FiscalCreditNoteDataProvider(prisma as any, qrFalso() as any);

    await expect(p.fetchDocumentData(10, 'abc')).rejects.toBeInstanceOf(
      VendixHttpException,
    );
    expect(prisma.invoices.findFirst).not.toHaveBeenCalled();
  });

  it.each([
    ['kitchen_ticket', () => new KitchenTicketDataProvider({} as any)],
    ['transfer_note', () => new TransferNoteDataProvider({} as any)],
  ])(
    '%s se niega con PRINT_DOCUMENT_READER_MISSING_001 en vez de fabricar',
    async (_nombre, construir) => {
      const p: any = construir();

      await expect(p.fetchDocumentData(10, 5)).rejects.toMatchObject({
        errorCode: 'PRINT_DOCUMENT_READER_MISSING_001',
      });

      // 501 y no 404: el documento puede existir; lo que falta es el lector.
      try {
        await p.fetchDocumentData(10, 5);
      } catch (e: any) {
        expect(e.getStatus()).toBe(501);
      }
    },
  );

  it('los cuatro conservan su getSampleData: la previsualización sigue teniendo con qué pintar', async () => {
    const cuatro: any[] = [
      new FiscalCreditNoteDataProvider({} as any, qrFalso() as any),
      new CreditNoteDataProvider({} as any),
      new KitchenTicketDataProvider({} as any),
      new TransferNoteDataProvider({} as any),
    ];

    for (const p of cuatro) {
      const muestra = await p.getSampleData(10);
      expect(muestra.document.number).toBeTruthy();
      expect(muestra.store.name).toBeTruthy();
    }
  });
});

describe('mapeador compartido invoices → modelo de impresión', () => {
  const filaViva = {
    id: 41,
    invoice_number: 'NC107',
    issue_date: new Date('2026-08-20T15:00:00.000Z'),
    dian_status: 'accepted',
    subtotal_amount: 100000,
    discount_amount: 0,
    tax_amount: 19000,
    total_amount: 119000,
    cufe: 'cufe-real-de-la-fila',
    qr_code: 'contenido-qr',
    related_invoice_id: 12,
    invoice_items: [{ name: 'Servicio', quantity: 1, price: 100000, total: 100000 }],
    invoice_taxes: [{ tax_name: 'IVA', tax_rate: 19, taxable_amount: 100000, tax_amount: 19000 }],
    resolution: { resolution_number: '18760000001', prefix: 'NC' },
    store: { name: 'Tienda Real', addresses: [{ address_line1: 'Calle 1', city: 'Bogotá D.C.' }] },
    organization: { name: 'Org Real', tax_id: '900000000-1', addresses: [] },
    customer: { first_name: 'Ana', last_name: 'Gómez', document_number: '1020304050' },
  };

  it('no imprime el prefijo dos veces: `number` sale limpio y `prefix` no se rellena', () => {
    const d = mapFiscalDocumentToPrintData(filaViva);

    // El compositor arma `doc.prefix ? doc.prefix + '-' : ''` + '#' + doc.number
    // (`print-layout-composer.service.ts:114`). El prefijo ya viene dentro de
    // `invoice_number`, así que poblar `prefix` daría `NC-#NC107`.
    expect(d.document.number).toBe('NC107');
    expect(d.document.prefix).toBeUndefined();
    expect(d.fiscal?.resolution_prefix).toBe('NC');
  });

  it('el CUFE y el adquiriente salen de la fila, no de una muestra', () => {
    const d = mapFiscalDocumentToPrintData(filaViva);

    expect(d.fiscal?.cufe).toBe('cufe-real-de-la-fila');
    expect(d.customer?.name).toBe('Ana Gómez');
    expect(d.customer?.tax_id).toBe('1020304050');
    // El NIT de la muestra fiscal que se imprimía antes por cualquier id.
    expect(d.customer?.tax_id).not.toBe('800.123.987-6');
  });

  it('la referencia al documento corregido viaja cuando se le pasa', () => {
    const sin = mapFiscalDocumentToPrintData(filaViva);
    const con = mapFiscalDocumentToPrintData(filaViva, {
      referenceDocumentNumber: 'QA107',
    });

    expect(sin.document.reference_document_number).toBeUndefined();
    expect(con.document.reference_document_number).toBe('QA107');
  });

  it('las etiquetas de estado son configurables y respetan dian_status', () => {
    const aceptada = mapFiscalDocumentToPrintData(filaViva, {
      acceptedLabel: 'Nota crédito aprobada por DIAN',
      pendingLabel: 'Nota crédito pendiente',
    });
    const pendiente = mapFiscalDocumentToPrintData(
      { ...filaViva, dian_status: 'pending' },
      {
        acceptedLabel: 'Nota crédito aprobada por DIAN',
        pendingLabel: 'Nota crédito pendiente',
      },
    );

    expect(aceptada.document.state_label).toBe('Nota crédito aprobada por DIAN');
    expect(pendiente.document.state_label).toBe('Nota crédito pendiente');
  });

  it('los totales cierran contra la fila y el importe en letras sale del mismo total', () => {
    const d = mapFiscalDocumentToPrintData(filaViva);

    expect(d.totals?.subtotal).toBe(100000);
    expect(d.totals?.tax_total).toBe(19000);
    expect(d.totals?.grand_total).toBe(119000);
    expect(d.totals?.grand_total_in_words).toContain('M/CTE');
  });

  it('una fila sin total_amount lo deriva, en vez de imprimir cero', () => {
    const d = mapFiscalDocumentToPrintData({
      ...filaViva,
      total_amount: null,
    });

    expect(d.totals?.grand_total).toBe(119000);
  });
});
