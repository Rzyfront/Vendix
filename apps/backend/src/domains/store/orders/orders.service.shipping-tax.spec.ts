import { OrdersService } from './orders.service';
import { RequestContextService } from '@common/context/request-context.service';
import { EMPTY_SHIPPING_TAX } from '../shipping/utils/shipping-tax.util';

/**
 * `assignShipping` — copia del impuesto del envío:
 * - costo == tarifa (o calculado) ⇒ copia de la tarifa;
 * - costo digitado distinto ⇒ manual ⇒ copia vacía;
 * - `grand_total` = subtotal + tax − descuento + costo (el impuesto va incluido).
 */
describe('OrdersService.assignShipping — impuesto del envío', () => {
  const INC_SNAPSHOT = {
    shipping_tax_rate_id: 77,
    shipping_tax_name: 'INC 8%',
    shipping_tax_type: 'inc' as const,
    shipping_tax_rate: 0.08,
    shipping_tax_amount: 1111.11,
  };
  let service: any;
  let prisma: any;
  let snapshotForRate: jest.Mock;

  beforeEach(() => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
      store_id: 1, organization_id: 1, user_id: 9,
    } as any);
    prisma = {
      orders: {
        findFirst: jest.fn().mockResolvedValue({
          id: 10, store_id: 1, state: 'created',
          subtotal_amount: 10000, tax_amount: 800, discount_amount: 0,
        }),
        update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 10, ...data })),
      },
      shipping_methods: {
        findFirst: jest.fn().mockResolvedValue({ id: 4, store_id: 1, type: 'delivery', is_active: true }),
      },
      shipping_rates: {
        findFirst: jest.fn().mockResolvedValue({ id: 31, shipping_method_id: 4, base_cost: 15000, is_active: true }),
      },
    };
    snapshotForRate = jest.fn().mockResolvedValue({ ...INC_SNAPSHOT });
    service = Object.create(OrdersService.prototype);
    service.prisma = prisma;
    service.eventEmitter = { emit: jest.fn() };
    service.shippingTaxService = { snapshotForRate };
  });

  afterEach(() => jest.restoreAllMocks());

  it('costo de la tarifa: copia congelada y grand_total sin cambio', async () => {
    await service.assignShipping(10, { shipping_method_id: 4, shipping_rate_id: 31 });
    expect(snapshotForRate).toHaveBeenCalledWith(null, 31, 15000, { store_id: 1 });
    const data = prisma.orders.update.mock.calls[0][0].data;
    expect(data).toMatchObject({
      ...INC_SNAPSHOT,
      shipping_rate_id: 31,
      shipping_cost: 15000,
      grand_total: 25800,
    });
  });

  it('costo digitado igual a la tarifa: cuenta como tarifa', async () => {
    await service.assignShipping(10, { shipping_method_id: 4, shipping_rate_id: 31, shipping_cost: 15000 });
    expect(snapshotForRate).toHaveBeenCalled();
    expect(prisma.orders.update.mock.calls[0][0].data.shipping_tax_amount).toBe(1111.11);
  });

  it('costo digitado distinto (override manual): copia vacía', async () => {
    await service.assignShipping(10, { shipping_method_id: 4, shipping_rate_id: 31, shipping_cost: 12000 });
    expect(snapshotForRate).not.toHaveBeenCalled();
    const data = prisma.orders.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ ...EMPTY_SHIPPING_TAX, shipping_cost: 12000, grand_total: 22800 });
  });

  it('sin tarifa (solo método + costo): copia vacía', async () => {
    await service.assignShipping(10, { shipping_method_id: 4, shipping_cost: 5000 });
    expect(snapshotForRate).not.toHaveBeenCalled();
    expect(prisma.orders.update.mock.calls[0][0].data).toMatchObject({
      ...EMPTY_SHIPPING_TAX, shipping_rate_id: null,
    });
  });

  it('auto_calculate: copia de la tarifa calculada', async () => {
    prisma.orders.findFirst
      .mockResolvedValueOnce({ id: 10, store_id: 1, state: 'created', subtotal_amount: 10000, tax_amount: 800, discount_amount: 0 })
      .mockResolvedValueOnce({
        addresses_orders_shipping_address_idToaddresses: { country_code: 'CO', city: 'Bogotá' },
        order_items: [],
      });
    service.shippingCalculatorService = {
      calculateRates: jest.fn().mockResolvedValue([{ method_id: 4, rate_id: 31, cost: 9000 }]),
    };
    await service.assignShipping(10, { shipping_method_id: 4, auto_calculate: true });
    expect(snapshotForRate).toHaveBeenCalledWith(null, 31, 9000, { store_id: 1 });
  });
});
