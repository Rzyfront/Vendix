import { PaymentsService } from './payments.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { EMPTY_SHIPPING_TAX } from '../shipping/utils/shipping-tax.util';

/**
 * POS a domicilio: copia del impuesto del envío en `createOrUpdateOrderFromPos`.
 * - `shipping_rate_id` validado contra método + tienda ⇒ copia de la tarifa.
 * - Sin `shipping_rate_id` (costo manual) ⇒ copia vacía.
 * - Tarifa ajena al método o a la tienda ⇒ 400 ORD_SHIP_RATE_MISMATCH_001.
 * - `grand_total` idéntico con o sin impuesto (va incluido en el costo).
 */
describe('PaymentsService — impuesto del envío en la venta POS', () => {
  const user = { id: 1, roles: ['super_admin'] };
  const item = {
    item_type: 'custom', product_name: 'Artículo', quantity: 1,
    unit_price: 10000, total_price: 10000,
  };
  const dto = (overrides: Record<string, unknown> = {}) => ({
    store_id: 1, order_id: 41, currency: 'COP', items: [item],
    requires_payment: true, delivery_type: 'home_delivery',
    shipping_method_id: 5, shipping_cost: 15000, ...overrides,
  });
  const order = {
    id: 41, order_number: 'POS-41', state: 'draft',
    subtotal_amount: 10000, tax_amount: 0,
  };
  const INC_SNAPSHOT = {
    shipping_tax_rate_id: 77,
    shipping_tax_name: 'INC 8%',
    shipping_tax_type: 'inc' as const,
    shipping_tax_rate: 0.08,
    shipping_tax_amount: 1111.11,
  };

  let service: any;
  let snapshotForRate: jest.Mock;

  const tx = (rate: any = { id: 9, shipping_method_id: 5 }) => ({
    orders: {
      findFirst: jest.fn().mockResolvedValue(order),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockImplementation(({ data }: any) =>
        Promise.resolve({ ...order, ...data, id: 41, store_id: 1, order_items: [], stores: { id: 1 } }),
      ),
      create: jest.fn(),
    },
    payments: { findFirst: jest.fn().mockResolvedValue(null) },
    bookings: { updateMany: jest.fn() },
    shipping_rates: { findFirst: jest.fn().mockResolvedValue(rate) },
  });

  beforeEach(() => {
    snapshotForRate = jest.fn().mockResolvedValue({ ...INC_SNAPSHOT });
    service = Object.create(PaymentsService.prototype);
    service.logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn(), debug: jest.fn() };
    service.shippingTaxService = { snapshotForRate };
    jest.spyOn(service, 'orderHasSerializedItems').mockResolvedValue(false);
    jest.spyOn(service, 'buildPosOrderItem').mockResolvedValue({
      product_name: 'Artículo', quantity: 1, total_price: 10000, tax_amount_item: 0,
    });
    jest.spyOn(service, 'calculatePosPromotionQuote').mockResolvedValue({
      total_discount: 0, order_promotions_snapshot: [], applied_promotions: [],
    });
    jest.spyOn(service, 'calculatePosCouponDiscount').mockResolvedValue({
      coupon_id: null, coupon_code: null, discount_amount: 0,
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it('con tarifa validada: congela la copia y liga la tarifa; grand_total no cambia', async () => {
    const client = tx();
    await service.createOrUpdateOrderFromPos(client, dto({ shipping_rate_id: 9 }), user);

    expect(client.shipping_rates.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 9,
        shipping_method_id: 5,
        shipping_zone: { OR: [{ store_id: 1 }, { is_system: true, store_id: null }] },
      }),
    }));
    expect(snapshotForRate).toHaveBeenCalledWith(client, 9, 15000, { store_id: 1 });
    const data = client.orders.update.mock.calls[0][0].data;
    expect(data).toEqual(expect.objectContaining({
      ...INC_SNAPSHOT,
      shipping_rate_id: 9,
      shipping_cost: 15000,
      tax_amount: 0,
      grand_total: 25000,
    }));
  });

  it('sin shipping_rate_id (costo manual): copia vacía, sin tocar la tarifa', async () => {
    const client = tx();
    await service.createOrUpdateOrderFromPos(client, dto({ shipping_cost: 12000 }), user);

    expect(client.shipping_rates.findFirst).not.toHaveBeenCalled();
    expect(snapshotForRate).not.toHaveBeenCalled();
    const data = client.orders.update.mock.calls[0][0].data;
    expect(data).toEqual(expect.objectContaining({
      ...EMPTY_SHIPPING_TAX,
      shipping_rate_id: null,
      shipping_cost: 12000,
      grand_total: 22000,
    }));
  });

  it('tarifa que no es del método o de la tienda: 400 sin escribir la orden', async () => {
    const client = tx(null);
    let caught: any;
    try {
      await service.createOrUpdateOrderFromPos(client, dto({ shipping_rate_id: 99 }), user);
    } catch (error) { caught = error; }

    expect(caught).toBeInstanceOf(VendixHttpException);
    expect(caught.errorCode).toBe(ErrorCodes.ORD_SHIP_RATE_MISMATCH_001.code);
    expect(caught.getStatus()).toBe(400);
    expect(client.orders.update).not.toHaveBeenCalled();
    expect(client.orders.create).not.toHaveBeenCalled();
  });

  it('tarifa sin shipping_method_id en el DTO: 400', async () => {
    const client = tx();
    let caught: any;
    try {
      await service.createOrUpdateOrderFromPos(
        client, dto({ shipping_rate_id: 9, shipping_method_id: undefined }), user,
      );
    } catch (error) { caught = error; }
    expect(caught?.errorCode).toBe(ErrorCodes.ORD_SHIP_RATE_MISMATCH_001.code);
  });
});
