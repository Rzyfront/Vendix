import { Prisma } from '@prisma/client';
import { StorePrismaService } from 'src/prisma/services/store-prisma.service';
import { buildOrder, buildOrderItem } from 'src/testing/money-fixtures';
import { RefundCalculationService } from './refund-calculation.service';

/**
 * Devolución con envío gravado: `shipping_tax_refund` es la parte
 * proporcional de la COPIA `orders.shipping_tax_amount`, a centavos, sobre lo
 * devuelto del envío bruto. No cambia `total_refund` ni `tax_refund`.
 */
describe('RefundCalculationService — impuesto del envío', () => {
  const prisma = { orders: { findFirst: jest.fn() } };
  const service = new RefundCalculationService(prisma as unknown as StorePrismaService);

  function order(overrides: Record<string, unknown> = {}) {
    return buildOrder({
      state: 'finished',
      subtotal_amount: new Prisma.Decimal(20000),
      tax_amount: new Prisma.Decimal(0),
      shipping_cost: new Prisma.Decimal(15000),
      grand_total: new Prisma.Decimal(35000),
      refunds: [],
      order_items: [
        buildOrderItem({ id: 1, product_name: 'A', quantity: 1, unit_price: new Prisma.Decimal(10000), total_price: new Prisma.Decimal(10000), tax_rate: new Prisma.Decimal(0), tax_amount_item: new Prisma.Decimal(0) }),
        buildOrderItem({ id: 2, product_name: 'B', quantity: 1, unit_price: new Prisma.Decimal(10000), total_price: new Prisma.Decimal(10000), tax_rate: new Prisma.Decimal(0), tax_amount_item: new Prisma.Decimal(0) }),
      ],
      ...overrides,
    } as any);
  }
  const item = (id: number) => ({ order_item_id: id, quantity: 1, inventory_action: 'no_return' as const });

  beforeEach(() => jest.resetAllMocks());

  it('devolución total con envío: todo el impuesto del envío', async () => {
    prisma.orders.findFirst.mockResolvedValue(order({
      shipping_tax_type: 'inc', shipping_tax_rate: new Prisma.Decimal(0.08), shipping_tax_amount: new Prisma.Decimal(1111.11),
    }));
    const r = await service.calculate({ order_id: 1, items: [item(1), item(2)], include_shipping: true });
    expect(r.shipping_refund).toBe(15000);
    expect(r.shipping_tax_refund).toBe(1111.11);
    expect(r.shipping_tax_type).toBe('inc');
    expect(r.total_refund).toBe(35000);
    expect(r.tax_refund).toBe(0);
  });

  it('devolución parcial: proporcional y redondeado a centavos', async () => {
    prisma.orders.findFirst.mockResolvedValue(order({
      shipping_tax_type: 'iva', shipping_tax_rate: new Prisma.Decimal(0.19), shipping_tax_amount: new Prisma.Decimal(2394.96),
    }));
    const r = await service.calculate({ order_id: 1, items: [item(1)], include_shipping: true });
    expect(r.shipping_refund).toBe(7500);
    // 2394.96 × 7500 / 15000 = 1197.48
    expect(r.shipping_tax_refund).toBe(1197.48);
    expect(r.shipping_tax_type).toBe('iva');
  });

  it('tres devoluciones parciales que completan el envío: la última cierra el remanente exacto de la copia', async () => {
    // Copia 1.111,12 en tres tercios: proporcional daría 370,37 × 3 = 1.111,11
    // (1 ¢ perdido). Las dos primeras son proporcionales; la que completa el
    // envío devuelve copia − lo ya devuelto = 370,38, y la suma cierra.
    const three = () => [1, 2, 3].map((id) =>
      buildOrderItem({ id, product_name: `P${id}`, quantity: 1, unit_price: new Prisma.Decimal(10000), total_price: new Prisma.Decimal(10000), tax_rate: new Prisma.Decimal(0), tax_amount_item: new Prisma.Decimal(0) }),
    );
    const base = {
      subtotal_amount: new Prisma.Decimal(30000),
      shipping_cost: new Prisma.Decimal(15000),
      grand_total: new Prisma.Decimal(45000),
      shipping_tax_type: 'inc',
      shipping_tax_rate: new Prisma.Decimal(0.08),
      shipping_tax_amount: new Prisma.Decimal(1111.12),
      order_items: three(),
    };
    prisma.orders.findFirst.mockResolvedValue(order({ ...base, refunds: [] }));
    const first = await service.calculate({ order_id: 1, items: [item(1)], include_shipping: true });
    expect(first.shipping_refund).toBe(5000);
    expect(first.shipping_tax_refund).toBe(370.37);

    const prior = (ids: number[]) => ids.map((id) => ({
      id, state: 'completed', amount: new Prisma.Decimal(15000),
      shipping_refund: new Prisma.Decimal(5000),
      refund_items: [{ order_item_id: id, quantity: 1 }],
    }));
    prisma.orders.findFirst.mockResolvedValue(order({ ...base, refunds: prior([1]) }));
    const second = await service.calculate({ order_id: 1, items: [item(2)], include_shipping: true });
    expect(second.shipping_tax_refund).toBe(370.37);

    // La tercera completa el envío: proporcional daría 370,37 otra vez.
    prisma.orders.findFirst.mockResolvedValue(order({ ...base, refunds: prior([1, 2]) }));
    const third = await service.calculate({ order_id: 1, items: [item(3)], include_shipping: true });
    expect(third.shipping_refund).toBe(5000);
    expect(third.shipping_tax_refund).toBe(370.38);
    expect(
      [first, second, third].reduce((sum, r) => sum + Math.round(r.shipping_tax_refund * 100), 0),
    ).toBe(111112);
  });

  it('sin copia o sin devolver envío: 0 y tipo null', async () => {
    prisma.orders.findFirst.mockResolvedValue(order({ shipping_tax_amount: new Prisma.Decimal(0) }));
    const a = await service.calculate({ order_id: 1, items: [item(1)], include_shipping: true });
    expect(a.shipping_tax_refund).toBe(0);
    expect(a.shipping_tax_type).toBeNull();

    prisma.orders.findFirst.mockResolvedValue(order({
      shipping_tax_type: 'inc', shipping_tax_amount: new Prisma.Decimal(1111.11),
    }));
    const b = await service.calculate({ order_id: 1, items: [item(1)], include_shipping: false });
    expect(b.shipping_tax_refund).toBe(0);
  });
});
