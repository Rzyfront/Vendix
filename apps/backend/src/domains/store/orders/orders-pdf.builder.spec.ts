import { OrderPdfBuilder, OrderPdfData } from './orders-pdf.builder';

function mockOrder(overrides: Partial<OrderPdfData> = {}): OrderPdfData {
  return {
    company_name: 'Vendix Demo Store',
    company_nit: '900.123.456-7',
    company_address: 'Calle 100 # 50-50, Bogota',
    company_phone: '+57 300 000 0000',
    company_email: 'demo@vendix.com',
    order_number: 'ORD-1001',
    order_state: 'finished',
    issue_date: '31/07/2026',
    channel: 'pos',
    currency: 'COP',
    customer_name: 'Consumidor Final',
    items: [
      {
        description: 'Producto de prueba A',
        quantity: 2,
        unit_price: 10000,
        total_amount: 20000,
        applied_price_tier_name: null,
      },
      {
        description: 'Producto de prueba B',
        quantity: 1,
        unit_price: 25000,
        total_amount: 25000,
      },
    ],
    subtotal_amount: 45000,
    discount_amount: 0,
    tax_amount: 8550,
    shipping_cost: 0,
    total_amount: 53550,
    ...overrides,
  };
}

describe('OrderPdfBuilder', () => {
  it('generates a non-empty Buffer for two orders on letter format', async () => {
    const orders = [mockOrder(), mockOrder({ order_number: 'ORD-1002' })];

    const buffer = await OrderPdfBuilder.generate(orders, 'letter');

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
    // PDF magic header.
    expect(buffer.slice(0, 4).toString('ascii')).toBe('%PDF');
  });

  it('generates a non-empty Buffer for thermal_80 (roll) format', async () => {
    const orders = [mockOrder(), mockOrder({ order_number: 'ORD-1002' })];

    const buffer = await OrderPdfBuilder.generate(orders, 'thermal_80');

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.slice(0, 4).toString('ascii')).toBe('%PDF');
  });

  it('returns a valid empty PDF when no orders are provided', async () => {
    const buffer = await OrderPdfBuilder.generate([], 'letter');

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.slice(0, 4).toString('ascii')).toBe('%PDF');
  });

  it('falls back to letter when an unknown format is given', async () => {
    const buffer = await OrderPdfBuilder.generate(
      [mockOrder()],
      'unknown_format' as any,
    );

    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.slice(0, 4).toString('ascii')).toBe('%PDF');
  });
});