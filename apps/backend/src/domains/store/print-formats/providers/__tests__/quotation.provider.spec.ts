/**
 * Suite del proveedor de cotización.
 *
 * Nace de un defecto que el tipado no podía ver: el `include` pedía la
 * relación `stores` (plural) cuando `model quotations` la llama `store`, y
 * los ítems se leían de `(quot as any).items` — un campo que no existe, la
 * relación es `quotation_items` y ni se incluía. TypeScript no valida nombres
 * de `include` contra el schema, así que compilaba y CADA render de
 * cotización moría en `PrismaClientValidationError`: el gateway devolvía 500
 * y el navegador caía al fallback local sin que nadie lo notara.
 *
 * Cobertura:
 *  1. formatType identifica el formato.
 *  2. El `include` nombra las relaciones REALES del schema (el test que
 *     habría atrapado el defecto original).
 *  3. Los ítems salen de `quotation_items`, con SKU y `total_price` guardado.
 *  4. Los totales salen de las columnas reales, no de `total_amount` (que no
 *     existe) ni en cero.
 *  5. El cliente sale de la relación `customer`, no del literal
 *     "Cliente Prospecto".
 *  6. `notes` y `terms_and_conditions` llegan al modelo de impresión, y
 *     `internal_notes` NO (el papel va al cliente).
 *  7. El estado se traduce al español.
 *  8. Los impuestos se agregan por tarifa derivando la base del impuesto.
 *  9. fetchDocumentData rechaza un documentId no numérico antes de tocar la
 *     base, y lanza 404 cuando la cotización no es de la tienda.
 */
import { VendixHttpException } from 'src/common/errors';
import { QuotationDataProvider } from '../quotation.provider';

describe('QuotationDataProvider', () => {
  const nulo = null as any;

  /** Fila de `quotations` tal como la devolvería Prisma con el include correcto. */
  const quotationRow = () => ({
    id: 140,
    quotation_number: 'QT-20260902-0001',
    status: 'sent',
    channel: 'pos',
    subtotal_amount: '18800000.00',
    discount_amount: '0.00',
    tax_amount: '3572000.00',
    shipping_cost: '0.00',
    grand_total: '22372000.00',
    valid_until: new Date('2026-10-15T00:00:00.000Z'),
    notes: 'Entrega en obra.\nSegunda línea.',
    internal_notes: 'NO IMPRIMIR: margen negociable hasta 8%',
    terms_and_conditions: 'Pago 50% anticipado.',
    created_at: new Date('2026-09-02T10:00:00.000Z'),
    customer: {
      id: 247,
      first_name: 'Constructora',
      last_name: 'Bolívar',
      legal_name: 'Constructora Bolívar S.A.',
      document_number: '860000111',
      phone: '+57 601 321 0000',
      email: 'proyectos@bolivar.com.co',
    },
    store: {
      name: 'Tech Solutions Bogotá',
      legal_name: 'Tech Solutions S.A.S.',
      phone: '+57 300 111 2233',
      email: 'ventas@techsolutions.co',
      logo_url: null,
      addresses: [{ address_line1: 'Calle 127 # 19-45', address_line2: '', city: 'Bogotá D.C.' }],
      organizations: { tax_id: '901888777', legal_name: 'Tech Solutions S.A.S.' },
    },
    quotation_items: [
      {
        id: 1,
        product_name: 'MacBook Pro 14"',
        variant_sku: 'MBP-14-M3',
        quantity: 2,
        unit_price: '6800000.00',
        discount_amount: '0.00',
        tax_rate: '0.19000',
        tax_amount_item: '2584000.00',
        total_price: '13600000.00',
        notes: null,
      },
      {
        id: 2,
        product_name: 'iPhone 15 Pro',
        variant_sku: null,
        quantity: 1,
        unit_price: '5200000.00',
        discount_amount: '0.00',
        tax_rate: '0.19000',
        tax_amount_item: '988000.00',
        total_price: '5200000.00',
        notes: null,
      },
    ],
  });

  /** Prisma mínimo que además captura el argumento del findFirst. */
  const prismaWith = (row: any) => {
    const calls: any[] = [];
    return {
      calls,
      prisma: {
        quotations: {
          findFirst: (args: any) => {
            calls.push(args);
            return Promise.resolve(row);
          },
        },
      } as any,
    };
  };

  it('1. formatType identifica el formato de cotización', () => {
    expect(new QuotationDataProvider(nulo).formatType).toBe('quotation');
  });

  it('2. el include nombra las relaciones reales del schema (store, customer, quotation_items)', async () => {
    const { prisma, calls } = prismaWith(quotationRow());
    await new QuotationDataProvider(prisma).fetchDocumentData(3, 140);

    const include = calls[0].include;
    // `store` en singular: con `stores` Prisma lanza
    // "Unknown field `stores` for include statement on model `quotations`".
    expect(include).toHaveProperty('store');
    expect(include).not.toHaveProperty('stores');
    expect(include).toHaveProperty('customer');
    expect(include).toHaveProperty('quotation_items');
    expect(calls[0].where).toEqual({ id: 140, store_id: 3 });
  });

  it('3. los ítems salen de quotation_items con SKU y el total guardado', async () => {
    const { prisma } = prismaWith(quotationRow());
    const data = await new QuotationDataProvider(prisma).fetchDocumentData(3, 140);

    expect(data.items).toHaveLength(2);
    expect(data.items[0]).toMatchObject({
      index: 1,
      product_name: 'MacBook Pro 14"',
      variant_sku: 'MBP-14-M3',
      quantity: 2,
      unit_price: 6800000,
      total_price: 13600000,
    });
    expect(data.items[0].total_price_formatted).toContain('13.600.000');
    // Sin SKU no se inventa cadena vacía: el compositor decide no pintar la línea.
    expect(data.items[1].variant_sku).toBeUndefined();
  });

  it('4. los totales salen de las columnas reales, no en cero', async () => {
    const { prisma } = prismaWith(quotationRow());
    const data = await new QuotationDataProvider(prisma).fetchDocumentData(3, 140);

    expect(data.totals.subtotal).toBe(18800000);
    expect(data.totals.tax_total).toBe(3572000);
    expect(data.totals.grand_total).toBe(22372000);
    expect(data.totals.grand_total_formatted).toContain('22.372.000');
  });

  it('5. el cliente sale de la relación customer', async () => {
    const { prisma } = prismaWith(quotationRow());
    const data = await new QuotationDataProvider(prisma).fetchDocumentData(3, 140);

    expect(data.customer!.name).toBe('Constructora Bolívar');
    expect(data.customer!.tax_id).toBe('860000111');
    expect(data.customer!.email).toBe('proyectos@bolivar.com.co');
    expect(data.customer!.name).not.toBe('Cliente Prospecto');
  });

  it('6. notes y terms_and_conditions se imprimen; internal_notes no', async () => {
    const { prisma } = prismaWith(quotationRow());
    const data = await new QuotationDataProvider(prisma).fetchDocumentData(3, 140);

    expect(data.document.notes).toContain('Entrega en obra');
    // El salto de línea sobrevive hasta el compositor, que lo pinta con
    // `white-space: pre-wrap`.
    expect(data.document.notes).toContain('\n');
    expect(data.document.terms_and_conditions).toBe('Pago 50% anticipado.');
    expect(data.document.internal_notes).toBeUndefined();
    expect(JSON.stringify(data)).not.toContain('NO IMPRIMIR');
  });

  it('7. el estado se traduce al español y la vigencia se formatea', async () => {
    const { prisma } = prismaWith(quotationRow());
    const data = await new QuotationDataProvider(prisma).fetchDocumentData(3, 140);

    expect(data.document.state).toBe('sent');
    expect(data.document.state_label).toBe('Enviada');
    expect(data.document.valid_until_formatted).toBeTruthy();
  });

  it('8. los impuestos se agregan por tarifa derivando la base del impuesto', async () => {
    const { prisma } = prismaWith(quotationRow());
    const data = await new QuotationDataProvider(prisma).fetchDocumentData(3, 140);

    // Dos líneas al 19% ⇒ una sola fila agregada.
    expect(data.taxes).toHaveLength(1);
    expect(data.taxes[0].rate).toBe(0.19);
    expect(data.taxes[0].tax_amount).toBe(3572000);
    // Base = impuesto / tarifa, no total × tarifa.
    expect(Math.round(data.taxes[0].base_amount)).toBe(Math.round(3572000 / 0.19));
    // La fila no afirma un tributo que la línea no guarda.
    expect(data.taxes[0].name).toBe('Impuesto');
  });

  it('9. rechaza un documentId no numérico y lanza 404 cuando no existe en la tienda', async () => {
    const sinDb = { quotations: { findFirst: () => Promise.reject(new Error('no debió consultarse')) } } as any;
    await expect(
      new QuotationDataProvider(sinDb).fetchDocumentData(3, 'abc'),
    ).rejects.toBeInstanceOf(VendixHttpException);

    const { prisma } = prismaWith(null);
    await expect(
      new QuotationDataProvider(prisma).fetchDocumentData(3, 999),
    ).rejects.toBeInstanceOf(VendixHttpException);
  });

  it('10. getSampleData trae nota y términos para el preview del editor', async () => {
    const data = await new QuotationDataProvider(nulo).getSampleData(1);
    expect(data.document.notes).toBeTruthy();
    expect(data.document.terms_and_conditions).toBeTruthy();
    expect(data.items.length).toBeGreaterThan(0);
  });
});
