/**
 * El número del documento se imprime UNA vez.
 *
 * `PrintLayoutComposerService.renderDocumentInfoSection` compone la cabecera así:
 *
 *     doc.prefix ? doc.prefix + '-' : ''   +   '#'   +   doc.number
 *
 * O sea que `prefix` y `number` no son independientes: si `number` ya trae el
 * prefijo y además se pobla `prefix`, el prefijo sale DOS veces en la cara que
 * ve el cliente. Eso es exactamente lo que pasaba en las dos muestras fiscales
 * antes del 2026-08-24 (`SETP-#SETP-990001`, `NC-SETP-#NC-SETP-0012`).
 *
 * En el camino real el prefijo viene dentro de `invoices.invoice_number`:
 * `InvoiceNumberGenerator` concatena prefijo + consecutivo, y se verificó contra
 * la base de dev que `invoice_number LIKE resolution.prefix || '%'` es cierto en
 * las 12 facturas numeradas. La columna `invoices.prefix` NO existe —
 * `information_schema.columns` devuelve 0 y `schema.prisma` no la declara—, así
 * que leerla daba `undefined` en silencio: los getters de `StorePrismaService`
 * devuelven `any`, con lo que el acceso a campo no se typechequea.
 *
 * Este spec fija el invariante del formato para que un refactor no lo vuelva a
 * partir, y lo hace sobre las muestras porque son literales puros: no necesitan
 * base de datos y son la única superficie del formato que se puede fijar sin
 * montar el módulo entero.
 */
import { DispatchNoteDataProvider } from './dispatch-note.provider';
import { FiscalCreditNoteDataProvider } from './fiscal-credit-note.provider';
import { FiscalInvoiceDataProvider } from './fiscal-invoice.provider';
import { KitchenTicketDataProvider } from './kitchen-ticket.provider';
import { PosSaleTicketDataProvider } from './pos-sale-ticket.provider';
import { PurchaseOrderDataProvider } from './purchase-order.provider';
import { QuotationDataProvider } from './quotation.provider';
import { SalesOrderInvoiceDataProvider } from './sales-order-invoice.provider';
import { TransferNoteDataProvider } from './transfer-note.provider';

const nulo = null as any;

// Los nueve proveedores cuyo `getSampleData` es un literal puro. `credit-note`
// queda fuera a propósito: su muestra llama a servicios, así que fijarla aquí
// exigiría un módulo de prueba y el invariante que se persigue no lo necesita.
const PROVEEDORES: Array<[string, { getSampleData(id?: number): Promise<any> }]> =
  [
    ['fiscal_electronic_invoice', new FiscalInvoiceDataProvider(nulo, nulo)],
    ['fiscal_credit_note', new FiscalCreditNoteDataProvider(nulo, nulo)],
    ['dispatch_note', new DispatchNoteDataProvider(nulo)],
    ['kitchen_ticket', new KitchenTicketDataProvider(nulo)],
    ['pos_sale_ticket', new PosSaleTicketDataProvider(nulo)],
    ['purchase_order', new PurchaseOrderDataProvider(nulo)],
    ['quotation', new QuotationDataProvider(nulo)],
    ['sales_order_invoice', new SalesOrderInvoiceDataProvider(nulo)],
    ['transfer_note', new TransferNoteDataProvider(nulo)],
  ];

describe('formato del número de documento impreso', () => {
  it.each(PROVEEDORES)(
    'la muestra de %s no hace que el prefijo se imprima dos veces',
    async (_nombre, provider) => {
      const data = await provider.getSampleData(1);
      const doc = data.document || {};
      const prefijo = String(doc.prefix ?? '');
      const numero = String(doc.number ?? '');

      expect(numero.length).toBeGreaterThan(0);

      // El invariante: o `prefix` está vacío, o `number` NO empieza por él.
      // Las dos cosas a la vez son el prefijo duplicado.
      if (prefijo) {
        expect(numero.startsWith(prefijo)).toBe(false);
      }
    },
  );

  it('la factura fiscal deja `prefix` fuera porque el número ya lo lleva', async () => {
    const data = await new FiscalInvoiceDataProvider(nulo, nulo).getSampleData(1);
    expect(data.document?.prefix).toBeUndefined();
    expect(data.document?.number).toBe('SETP-990001');
    // El prefijo de la resolución sigue viajando por su campo propio, que es
    // otro sitio del formato y no se concatena al número.
    expect(data.fiscal?.resolution_prefix).toBe('SETP');
  });

  it('la nota de crédito fiscal deja `prefix` fuera por el mismo motivo', async () => {
    const data = await new FiscalCreditNoteDataProvider(nulo, nulo).getSampleData(1);
    expect(data.document?.prefix).toBeUndefined();
    expect(data.document?.number).toBe('NC-SETP-0012');
  });
});
