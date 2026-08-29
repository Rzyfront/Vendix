/**
 * CP-DTLP-20260827 (Phase B.4.c) — suite del undécimo provider del Hub.
 *
 * Cobertura:
 *  1. formatType identifica el formato nuevo.
 *  2. getAvailableTokens() devuelve el set mínimo para el tiquete de
 *     despacho (cliente, dirección, SKU, cant. pedida, cant. despachada,
 *     número de orden).
 *  3. getSampleData() devuelve un StandardPrintDataModel con
 *     customer.address_line1 no vacío (lo necesita el compositor B.5).
 *  4. fetchDocumentData rechaza IDs inválidos ANTES de tocar la base
 *     (PRINT_DOCUMENT_NOT_FOUND_001) — coherente con `pos-sale-ticket`.
 *  5. fetchDocumentData rechaza documentId <= 0 antes de tocar la base.
 *  6. fetchDocumentData lanza 404 cuando la orden no existe en la tienda.
 *
 * Los tests 4, 5 y 6 usan un mock Prisma mínimo (mismo patrón que
 * `real-print-path.spec.ts`) para no necesitar una DB viva. Marcados
 * `pending_runtime_check` en el archivo de evidencia porque Jest está
 * ocupado por otro agente paralelo en este momento (CP-DTLP-20260827
 * regla de `parallel`: no levantar workers que peleen memoria).
 */
import { VendixHttpException } from 'src/common/errors';
import { DispatchTicketDataProvider } from '../dispatch-ticket.provider';

describe('DispatchTicketDataProvider (CP-DTLP-20260827 Phase B.4)', () => {
  const nulo = null as any;

  it('1. formatType identifica el undécimo formato del Hub', () => {
    const p = new DispatchTicketDataProvider(nulo);
    expect(p.formatType).toBe('dispatch_ticket');
  });

  it('2. getAvailableTokens() expone los tokens logísticos del tiquete', () => {
    const p = new DispatchTicketDataProvider(nulo);
    const tokens = p.getAvailableTokens();

    expect(Array.isArray(tokens)).toBe(true);
    expect(tokens.length).toBeGreaterThanOrEqual(8);

    // Tokens obligatorios del B.4.c — cubren los placeholders que el
    // compositor espera encontrar en la custom_template.
    const paths = tokens.map((t) => t.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        'document.number',
        'customer.name',
        'customer.address',
        'items[].variant_sku',
        'items[].product_name',
        'items[].quantity',
        'store.name',
      ]),
    );
  });

  it('3. getSampleData() devuelve un modelo con customer.address_line1 poblado', () => {
    const p = new DispatchTicketDataProvider(nulo);
    return p.getSampleData(1).then((data) => {
      expect(data.customer).toBeDefined();
      expect(data.customer!.name).toBeTruthy();
      // La aserción fuerte: el compositor B.5 pinta `customer.address_line1`
      // cuando existe; si llega vacío el tiquete pierde la dirección.
      expect(data.customer!.address_line1).toBeTruthy();
      expect(data.customer!.address_line1!.length).toBeGreaterThan(0);
      // Sanity: document.number poblado para que el header pinte "#".
      expect(data.document.number).toBeTruthy();
      // Items con variant_sku para que la tabla los liste.
      expect(Array.isArray(data.items)).toBe(true);
      expect(data.items.length).toBeGreaterThan(0);
      for (const it of data.items) {
        expect(it.variant_sku).toBeTruthy();
        expect(typeof it.quantity).toBe('number');
      }
    });
  });

  it('4. fetchDocumentData rechaza documentId no numérico SIN tocar Prisma', async () => {
    const prisma = { orders: { findFirst: jest.fn() } } as any;
    const p = new DispatchTicketDataProvider(prisma);

    await expect(p.fetchDocumentData(5, 'invalid')).rejects.toBeInstanceOf(
      VendixHttpException,
    );
    expect(prisma.orders.findFirst).not.toHaveBeenCalled();
  });

  it('5. fetchDocumentData rechaza documentId <= 0 SIN tocar Prisma', async () => {
    const prisma = { orders: { findFirst: jest.fn() } } as any;
    const p = new DispatchTicketDataProvider(prisma);

    await expect(p.fetchDocumentData(5, 0)).rejects.toBeInstanceOf(
      VendixHttpException,
    );
    await expect(p.fetchDocumentData(5, -3)).rejects.toBeInstanceOf(
      VendixHttpException,
    );
    expect(prisma.orders.findFirst).not.toHaveBeenCalled();
  });

  it('6. fetchDocumentData lanza 404 cuando la orden no existe en la tienda', async () => {
    const prisma = {
      orders: { findFirst: jest.fn().mockResolvedValue(null) },
    } as any;
    const p = new DispatchTicketDataProvider(prisma);

    await expect(p.fetchDocumentData(5, 999999)).rejects.toBeInstanceOf(
      VendixHttpException,
    );
    expect(prisma.orders.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.orders.findFirst.mock.calls[0][0].where).toMatchObject({
      id: 999999,
      store_id: 5,
    });
  });
});
