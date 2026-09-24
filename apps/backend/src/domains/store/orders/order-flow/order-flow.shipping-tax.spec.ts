import { Prisma } from '@prisma/client';
import { OrderFlowService } from './order-flow.service';
import { RequestContextService } from '@common/context/request-context.service';
import { EMPTY_SHIPPING_TAX } from '../../shipping/utils/shipping-tax.util';

/**
 * `shipOrder` al asignar método + tarifa a una orden sin método:
 * - con tarifa ⇒ copia congelada del impuesto del envío;
 * - sin tarifa ⇒ copia vacía;
 * - `grand_total` = total anterior − costo anterior + costo nuevo (el
 *   impuesto va incluido en el costo, no se suma aparte).
 */
describe('OrderFlowService.shipOrder — impuesto del envío', () => {
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
    jest.spyOn(RequestContextService, 'getUserId').mockReturnValue(9 as any);
    prisma = {
      shipping_methods: {
        findFirst: jest.fn().mockResolvedValue({ id: 4, type: 'delivery', is_active: true }),
      },
      shipping_rates: {
        findFirst: jest.fn().mockResolvedValue({ id: 31, shipping_method_id: 4, base_cost: 15000 }),
      },
      orders: {
        update: jest.fn().mockResolvedValue({}),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    snapshotForRate = jest.fn().mockResolvedValue({ ...INC_SNAPSHOT });
    service = Object.create(OrderFlowService.prototype);
    service.prisma = prisma;
    service.eventEmitter = { emit: jest.fn() };
    service.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    service.shippingTaxService = { snapshotForRate };
    jest.spyOn(service, 'getOrder').mockResolvedValue({
      id: 10, store_id: 1, state: 'processing', delivery_type: 'home_delivery',
      shipping_method_id: null, shipping_cost: 0, grand_total: 10800,
    });
    jest.spyOn(service, 'validateTransition').mockImplementation(() => undefined);
    jest.spyOn(service, 'updateOrderState').mockResolvedValue({ id: 10, state: 'shipped' });
  });

  afterEach(() => jest.restoreAllMocks());

  it('con tarifa: copia congelada y grand_total suma el costo bruto', async () => {
    await service.shipOrder(10, { shipping_method_id: 4, shipping_rate_id: 31 });
    expect(snapshotForRate).toHaveBeenCalledWith(null, 31, 15000, { store_id: 1 });
    const data = prisma.orders.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ ...INC_SNAPSHOT, shipping_rate_id: 31, shipping_cost: 15000 });
    expect(new Prisma.Decimal(data.grand_total).toNumber()).toBe(25800);
  });

  it('sin tarifa: copia vacía y costo 0', async () => {
    await service.shipOrder(10, { shipping_method_id: 4 });
    expect(snapshotForRate).not.toHaveBeenCalled();
    const data = prisma.orders.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ ...EMPTY_SHIPPING_TAX, shipping_rate_id: null, shipping_cost: 0 });
    expect(new Prisma.Decimal(data.grand_total).toNumber()).toBe(10800);
  });

  describe('orden ya cobrada', () => {
    const charged = (overrides: Record<string, unknown> = {}) => ({
      id: 10, store_id: 1, state: 'processing', delivery_type: 'home_delivery',
      shipping_method_id: null, shipping_cost: 15000, grand_total: 25800,
      payments: [{ id: 1, state: 'succeeded' }],
      ...overrides,
    });

    it('costo de la tarifa igual al cobrado: liga método/tarifa y NO toca costo, total ni copia', async () => {
      service.getOrder.mockResolvedValue(charged());
      await service.shipOrder(10, { shipping_method_id: 4, shipping_rate_id: 31 });
      expect(snapshotForRate).not.toHaveBeenCalled();
      const data = prisma.orders.update.mock.calls[0][0].data;
      expect(data).toMatchObject({ shipping_method_id: 4, shipping_rate_id: 31 });
      expect('grand_total' in data).toBe(false);
      expect('shipping_cost' in data).toBe(false);
      expect('shipping_tax_amount' in data).toBe(false);
    });

    it('costo distinto al cobrado: 400 sin escribir la orden', async () => {
      service.getOrder.mockResolvedValue(charged({ shipping_cost: 5000, grand_total: 15800 }));
      let caught: any;
      try {
        await service.shipOrder(10, { shipping_method_id: 4, shipping_rate_id: 31 });
      } catch (error) { caught = error; }
      expect(caught?.getStatus?.()).toBe(400);
      expect(caught?.errorCode).toBe('ORD_SHIP_RATE_MISMATCH_001');
      expect(prisma.orders.update).not.toHaveBeenCalled();
      expect(service.updateOrderState).not.toHaveBeenCalled();
    });

    it('pago pendiente también cuenta como cobro; pago fallido no', async () => {
      service.getOrder.mockResolvedValue(charged({
        shipping_cost: 0, grand_total: 10800, payments: [{ id: 1, state: 'pending' }],
      }));
      await expect(
        service.shipOrder(10, { shipping_method_id: 4, shipping_rate_id: 31 }),
      ).rejects.toMatchObject({ errorCode: 'ORD_SHIP_RATE_MISMATCH_001' });

      prisma.orders.update.mockClear();
      service.getOrder.mockResolvedValue(charged({
        shipping_cost: 0, grand_total: 10800, payments: [{ id: 1, state: 'failed' }],
      }));
      await service.shipOrder(10, { shipping_method_id: 4, shipping_rate_id: 31 });
      const data = prisma.orders.update.mock.calls[0][0].data;
      expect(new Prisma.Decimal(data.grand_total).toNumber()).toBe(25800);
    });
  });

  it('reemplaza un costo anterior en el grand_total', async () => {
    service.getOrder.mockResolvedValue({
      id: 10, store_id: 1, state: 'processing', delivery_type: 'home_delivery',
      shipping_method_id: null, shipping_cost: 5000, grand_total: 15800,
    });
    await service.shipOrder(10, { shipping_method_id: 4, shipping_rate_id: 31 });
    const data = prisma.orders.update.mock.calls[0][0].data;
    expect(new Prisma.Decimal(data.grand_total).toNumber()).toBe(25800);
  });
});
