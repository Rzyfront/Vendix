import { QuotationsService } from './quotations.service';
import { OrdersService } from '../orders/orders.service';
import { RequestContextService } from '@common/context/request-context.service';
import { resolveQuotationLine } from './quotation-line-tax.util';

/**
 * P1-1 — el impuesto de la cotización lo resuelve el servidor con las tasas
 * del producto (incluido vs agregado, tipo real) y `convertToOrder` entrega a
 * `orders.create` el impuesto POR UNIDAD (ADR-08), de modo que
 * `order_item_taxes` —que escala por `line_units`— no se multiplique otra vez
 * por la cantidad.
 *
 * `order_item_taxes` se construye con el `buildOrderItemTaxesCreate` REAL de
 * `OrdersService` (no una copia): la prueba cruza el contrato entre los dos
 * servicios, no la aritmética de uno solo.
 */

type CatalogRate = {
  id: number;
  name: string;
  rate: number;
  tax_type: 'iva' | 'inc';
  is_inclusive: boolean;
};

const IVA_INCL: CatalogRate = {
  id: 1,
  name: 'IVA 19%',
  rate: 0.19,
  tax_type: 'iva',
  is_inclusive: true,
};
const IVA_EXCL: CatalogRate = { ...IVA_INCL, id: 2, is_inclusive: false };
const INC_INCL: CatalogRate = {
  id: 3,
  name: 'INC 8%',
  rate: 0.08,
  tax_type: 'inc',
  is_inclusive: true,
};

const requestContext = {
  user_id: 9,
  organization_id: 1,
  store_id: 2,
  is_super_admin: false,
  is_owner: true,
};

function buildService(catalog: Record<number, { base_price: number; rates: CatalogRate[] }>) {
  const prisma: any = {
    products: {
      findMany: jest.fn(({ where }: any) =>
        Promise.resolve(
          where.id.in.map((id: number) => ({
            id,
            base_price: catalog[id].base_price,
            is_on_sale: false,
            sale_price: null,
          })),
        ),
      ),
    },
    product_variants: { findMany: jest.fn().mockResolvedValue([]) },
    quotations: {
      findFirst: jest.fn(),
      create: jest.fn(({ data }: any) => Promise.resolve({ id: 1, ...data })),
      update: jest.fn(({ data }: any) => Promise.resolve({ id: 1, ...data })),
    },
  };
  const taxesService: any = {
    calculateProductTaxes: jest.fn((productId: number) =>
      Promise.resolve({
        taxes: catalog[productId].rates.map((r) => ({
          tax_rate_id: r.id,
          name: r.name,
          rate: r.rate,
          tax_type: r.tax_type,
          is_inclusive: r.is_inclusive,
        })),
      }),
    ),
  };
  const ordersCreate = jest.fn().mockResolvedValue({ id: 50, order_number: 'ORD-1' });
  const service = new QuotationsService(
    prisma,
    { create: ordersCreate } as any,
    { emit: jest.fn() } as any,
    {} as any,
    {} as any,
    taxesService,
  );
  return { service, prisma, ordersCreate };
}

/** `order_item_taxes` tal como lo escribiría `orders.create`. */
function orderItemTaxes(item: any, rates: CatalogRate[]) {
  const build = (OrdersService.prototype as any).buildOrderItemTaxesCreate;
  const payload = build.call(
    {},
    item,
    rates.map((r) => ({ ...r, is_compound: false })),
  );
  return (payload?.create ?? []).map((row: any) => ({
    tax_type: row.tax_type,
    is_inclusive: row.is_inclusive,
    tax_amount: Number(row.tax_amount),
  }));
}

describe('QuotationsService — impuesto resuelto en servidor (P1-1)', () => {
  const cases = [
    {
      label: 'IVA 19% incluido a $11.900',
      rate: IVA_INCL,
      price: 11900,
      unitBase: 10000,
      unitTax: 1900,
      grand: 35700,
    },
    {
      label: 'IVA 19% agregado a $10.000',
      rate: IVA_EXCL,
      price: 10000,
      unitBase: 10000,
      unitTax: 1900,
      grand: 35700,
    },
    {
      label: 'INC 8% incluido a $10.800',
      rate: INC_INCL,
      price: 10800,
      unitBase: 10000,
      unitTax: 800,
      grand: 32400,
    },
  ];

  it.each(cases)(
    'create: $label × 3 guarda base neta, impuesto de línea y total correcto',
    async ({ rate, price, unitBase, unitTax, grand }) => {
      const { service, prisma } = buildService({
        7: { base_price: price, rates: [rate] },
      });
      prisma.quotations.findFirst.mockResolvedValue(null);

      await RequestContextService.run(requestContext as any, () =>
        service.create({
          items: [
            {
              product_id: 7,
              product_name: 'P',
              quantity: 3,
              unit_price: price,
              // Lo que mande el cliente ya no decide el impuesto.
              tax_rate: rate.rate,
              tax_amount_item: 999999,
              total_price: price * 3,
            },
          ],
        } as any),
      );

      const data = prisma.quotations.create.mock.calls[0][0].data;
      expect(data.subtotal_amount).toBe(unitBase * 3);
      expect(data.tax_amount).toBe(unitTax * 3);
      expect(data.grand_total).toBe(grand);
      const line = data.quotation_items.create[0];
      expect(line.unit_price).toBe(price);
      expect(line.total_price).toBe(unitBase * 3);
      expect(line.tax_amount_item).toBe(unitTax * 3);
      expect(line.tax_rate).toBe(rate.rate);
    },
  );

  it.each(cases)(
    'convertToOrder: $label × 3 ⇒ order_item_taxes = impuesto de línea (no × cantidad)',
    async ({ rate, price, unitBase, unitTax, grand }) => {
      const { service, prisma, ordersCreate } = buildService({
        7: { base_price: price, rates: [rate] },
      });
      prisma.quotations.findFirst.mockResolvedValue({
        id: 1,
        status: 'accepted',
        destination: 'sale',
        customer_id: 3,
        quotation_number: 'QT-1',
        channel: 'pos',
        quotation_items: [
          {
            product_id: 7,
            product_variant_id: null,
            product_name: 'P',
            quantity: 3,
            unit_price: price,
            discount_amount: 0,
            tax_rate: rate.rate,
            // Grabado con la convención vieja (línea): se ignora al convertir.
            tax_amount_item: unitTax * 3,
            total_price: price * 3,
            price_unit_quantity: null,
            applied_price_tier_id: null,
          },
        ],
      });

      await RequestContextService.run(requestContext as any, () =>
        service.convertToOrder(1),
      );

      const dto = ordersCreate.mock.calls[0][0];
      const item = dto.items[0];
      expect(item.unit_price).toBe(unitBase);
      expect(item.tax_amount_item).toBe(unitTax);
      expect(item.total_price).toBe(unitBase * 3);
      expect(item.final_unit_price).toBe(unitBase + unitTax);
      expect(item.is_price_overridden).toBeUndefined();
      expect(dto.subtotal).toBe(unitBase * 3);
      expect(dto.tax_amount).toBe(unitTax * 3);
      expect(dto.total_amount).toBe(grand);

      expect(orderItemTaxes(item, [rate])).toEqual([
        {
          tax_type: rate.tax_type,
          is_inclusive: rate.is_inclusive,
          tax_amount: unitTax * 3,
        },
      ]);
    },
  );

  it('precio manual distinto del catálogo = bruto declarado (regla POS)', async () => {
    const { service, prisma, ordersCreate } = buildService({
      7: { base_price: 10000, rates: [IVA_EXCL] },
    });
    prisma.quotations.findFirst.mockResolvedValue({
      id: 1,
      status: 'accepted',
      destination: 'sale',
      customer_id: 3,
      quotation_number: 'QT-2',
      channel: 'pos',
      quotation_items: [
        {
          product_id: 7,
          product_name: 'P',
          quantity: 3,
          unit_price: 11900,
          discount_amount: 0,
          price_unit_quantity: null,
        },
      ],
    });

    await RequestContextService.run(requestContext as any, () =>
      service.convertToOrder(1),
    );

    const dto = ordersCreate.mock.calls[0][0];
    const item = dto.items[0];
    // 11.900 declarados contienen el IVA: no se le suma encima.
    expect(item.unit_price).toBe(10000);
    expect(item.tax_amount_item).toBe(1900);
    expect(item.final_unit_price).toBe(11900);
    expect(item.is_price_overridden).toBe(true);
    expect(dto.total_amount).toBe(35700);
  });

  it('línea libre: la tasa digitada se suma sobre el precio, sin tipo fiscal', () => {
    const line = resolveQuotationLine(
      { unit_price: 10000, quantity: 3 },
      [{ rate: 0.19, is_inclusive: false, tax_type: null, name: null, tax_rate_id: null }],
      { declared_gross: false },
    );
    expect(line.line_net_total).toBe(30000);
    expect(line.line_tax_total).toBe(5700);
    expect(line.taxes[0].tax_type).toBeNull();
  });

  it('descuento reduce la base gravable', () => {
    const line = resolveQuotationLine(
      { unit_price: 11900, quantity: 3, discount_amount: 3000 },
      [{ rate: 0.19, is_inclusive: true, tax_type: 'iva', name: 'IVA', tax_rate_id: 1 }],
      { declared_gross: false },
    );
    // base 10.000 × 3 = 30.000; −3.000 ⇒ 27.000 gravables ⇒ IVA 5.130.
    expect(line.line_net_total).toBe(30000);
    expect(line.unit_tax_amount).toBe(1710);
    expect(line.line_tax_total).toBe(5130);
  });
});
