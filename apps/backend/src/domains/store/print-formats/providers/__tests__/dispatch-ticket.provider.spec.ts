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

/**
 * ADR-9 / dec. usuario 2026-08-31 — `customer_alias` debe llegar al
 * documento del tiquete de despacho en los dos caminos:
 *  - `pos-order-confirmation.component.ts` (auto-print POS), y
 *  - `dispatch-ticket.provider.ts` (render backend).
 *
 * Tres sondas que el bug del pasado cazaba con un «responde 201»: el HTML
 * se ve bien formado aunque el alias no aparezca. La verificación tiene
 * que contar el alias en el modelo devuelto, no quedarse en el status.
 */
describe('DispatchTicketDataProvider — customer_alias (ADR-9 / 2026-08-31)', () => {
  /**
   * Helper que arma una orden mock con el shape mínimo que
   * `mapOrderToDispatchTicket` consume. Mantener el mock cerca del test
   * para que cuando el provider agregue un nuevo campo se note acá.
   */
  function makeOrder(overrides: {
    customer_alias?: string | null;
    customer?: any | null;
  }): any {
    return {
      id: 1000,
      order_number: 'ORD-1000',
      created_at: new Date('2026-08-31T12:00:00Z'),
      state: 'confirmed',
      notes: null,
      customer_alias: overrides.customer_alias ?? null,
      stores: {
        name: 'Tienda 10',
        nit: '900123456',
        phone: '+57 1 234 5678',
        email: null,
        logo_url: null,
        addresses: [{ address_line1: 'Cra 1', address_line2: null }],
        organizations: { name: 'Org 10' },
      },
      users: overrides.customer ?? null,
      order_items: [
        {
          id: 1,
          order_id: 1000,
          product_name: 'Pollo Asado',
          product_id: 1,
          product_variant_id: null,
          quantity: 1,
          variant_sku: 'POLLO-A',
          notes: null,
        },
      ],
      dispatch_notes: [],
    };
  }

  it('7. orden con SOLO alias (sin cliente) → document.customer_alias presente, customer undefined', async () => {
    const order = makeOrder({ customer_alias: 'jorge', customer: null });
    const prisma = {
      orders: { findFirst: jest.fn().mockResolvedValue(order) },
    } as any;
    const p = new DispatchTicketDataProvider(prisma);

    const data = await p.fetchDocumentData(10, 1000);

    // El alias llega al documento (es lo que el compositor pinta en
    // `sec_doc_info` con data-token="document.customer_alias").
    expect(data.document.customer_alias).toBe('jorge');
    // El bloque de cliente formal NO se fabrica a partir del alias
    // (el alias no tiene dirección ni documento). customer queda undefined.
    expect(data.customer).toBeUndefined();
  });

  it('8. orden con cliente real (sin alias) → customer poblado, sin customer_alias', async () => {
    const order = makeOrder({
      customer: {
        id: 42, // el provider gatea el bloque customer por `customer.id`
        first_name: 'María',
        last_name: 'García',
        document_number: '52123456',
        phone: '+57 300 1234567',
        email: 'maria@example.com',
      },
    });
    const prisma = {
      orders: { findFirst: jest.fn().mockResolvedValue(order) },
    } as any;
    const p = new DispatchTicketDataProvider(prisma);

    const data = await p.fetchDocumentData(10, 1000);

    // Sin alias en el documento: el spread condicional lo deja fuera.
    expect(data.document.customer_alias).toBeUndefined();
    // El bloque de cliente formal sale igual que hoy.
    expect(data.customer).toBeDefined();
    expect(data.customer!.name).toBe('María García');
    expect(data.customer!.tax_id).toBe('52123456');
  });

  it('9. orden sin alias ni cliente → ni customer ni customer_alias; sin separador huérfano', async () => {
    const order = makeOrder({ customer: null });
    const prisma = {
      orders: { findFirst: jest.fn().mockResolvedValue(order) },
    } as any;
    const p = new DispatchTicketDataProvider(prisma);

    const data = await p.fetchDocumentData(10, 1000);

    expect(data.document.customer_alias).toBeUndefined();
    expect(data.customer).toBeUndefined();
    // Si el spread hubiera sido siempre-truthy (p. ej. `customer_alias: ''`
    // en vez de spread condicional), document.customer_alias sería string
    // vacío y el compositor pintaría un separador/divisor sin texto.
    // Esa regresión queda cazada: la propiedad tiene que NO existir en el
    // modelo, no existir como string vacío.
    expect('customer_alias' in data.document).toBe(false);
  });
});
