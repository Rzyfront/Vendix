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

  const tx = (rate: any = { id: 9, shipping_method_id: 5, type: 'flat', base_cost: 15000 }) => ({
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
    order_items: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
    order_item_taxes: { update: jest.fn() },
    shipping_rates: { findFirst: jest.fn().mockResolvedValue(rate) },
  });
  const pickupRate = (methodType = 'pickup') => ({
    id: 9,
    shipping_method_id: 5,
    type: 'flat',
    base_cost: 15000,
    shipping_method: { type: methodType },
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
        is_active: true,
        shipping_method_id: 5,
        shipping_method: { store_id: 1, is_active: true },
        shipping_zone: { is_active: true, OR: [{ store_id: 1 }, { is_system: true, store_id: null }] },
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

  describe('tarifas de retiro en tienda', () => {
    it('acepta el precio bruto cotizado sin dirección y copia su snapshot fiscal', async () => {
      const client = tx(pickupRate());
      const quotePickupRates = jest.fn().mockResolvedValue([{
        id: 9, cost: 11900, tax_is_inclusive: false,
      }]);
      service.shippingCalculatorService = { quotePickupRates };

      await service.createOrUpdateOrderFromPos(client, dto({
        delivery_type: 'home_delivery', // la relación persistida determina que es pickup
        shipping_rate_id: 9,
        shipping_cost: 11900,
      }), user);

      expect(quotePickupRates).toHaveBeenCalledWith(1, 5);
      expect(snapshotForRate).toHaveBeenCalledWith(client, 9, 11900, { store_id: 1 });
      expect(client.orders.update.mock.calls[0][0].data).toEqual(expect.objectContaining({
        ...INC_SNAPSHOT,
        shipping_rate_id: 9,
        shipping_cost: 11900,
        shipping_tax_is_inclusive: false,
        grand_total: 21900,
      }));
    });

    it.each([10000, 19900])('rechaza costo cliente manipulado (%s) antes de escribir', async (cost) => {
      const client = tx(pickupRate());
      service.shippingCalculatorService = {
        quotePickupRates: jest.fn().mockResolvedValue([{ id: 9, cost: 11900 }]),
      };

      await expect(service.createOrUpdateOrderFromPos(client, dto({
        shipping_rate_id: 9,
        shipping_cost: cost,
      }), user)).rejects.toMatchObject({
        errorCode: ErrorCodes.PAY_VALIDATE_001.code,
      });

      expect(snapshotForRate).not.toHaveBeenCalled();
      expect(client.orders.update).not.toHaveBeenCalled();
      expect(client.orders.create).not.toHaveBeenCalled();
    });

    it('retira gratis: costo 0 conserva snapshot vacío y modo fiscal null', async () => {
      const client = tx(pickupRate());
      snapshotForRate.mockResolvedValue({ ...EMPTY_SHIPPING_TAX });
      service.shippingCalculatorService = {
        quotePickupRates: jest.fn().mockResolvedValue([{
          id: 9, cost: 0, tax_is_inclusive: false,
        }]),
      };

      await service.createOrUpdateOrderFromPos(client, dto({
        shipping_rate_id: 9,
        shipping_cost: 0,
      }), user);

      expect(snapshotForRate).toHaveBeenCalledWith(client, 9, 0, { store_id: 1 });
      expect(client.orders.update.mock.calls[0][0].data).toEqual(expect.objectContaining({
        ...EMPTY_SHIPPING_TAX,
        shipping_rate_id: 9,
        shipping_cost: 0,
        shipping_tax_is_inclusive: null,
        grand_total: 10000,
      }));
    });

    it('rechaza tarifa inexistente en la cotización o retiro manual sin escribir', async () => {
      const quotePickupRates = jest.fn().mockResolvedValue([]);
      service.shippingCalculatorService = { quotePickupRates };
      const missingRateTx = tx(pickupRate());
      await expect(service.createOrUpdateOrderFromPos(missingRateTx, dto({
        shipping_rate_id: 9,
      }), user)).rejects.toMatchObject({
        errorCode: ErrorCodes.ORD_SHIP_RATE_MISMATCH_001.code,
      });
      expect(missingRateTx.orders.update).not.toHaveBeenCalled();

      const manualTx = tx(pickupRate());
      await expect(service.createOrUpdateOrderFromPos(manualTx, dto({
        shipping_rate_id: 9,
        manual_shipping_price: 10000,
        shipping_cost: 11900,
      }), user)).rejects.toMatchObject({
        errorCode: ErrorCodes.PAY_VALIDATE_001.code,
      });
      expect(quotePickupRates).toHaveBeenCalledTimes(1);
      expect(manualTx.orders.update).not.toHaveBeenCalled();
    });

    it('falla de forma protegida si el calculador no implementa quotePickupRates', async () => {
      const client = tx(pickupRate());
      service.shippingCalculatorService = { quoteRateGross: jest.fn() };

      await expect(service.createOrUpdateOrderFromPos(client, dto({
        shipping_rate_id: 9,
        shipping_cost: 15000,
      }), user)).rejects.toMatchObject({
        errorCode: ErrorCodes.PAY_VALIDATE_001.code,
      });

      expect(client.orders.update).not.toHaveBeenCalled();
    });

    it('no clasifica como retiro una tarifa own_fleet aunque DTO diga pickup', async () => {
      const client = tx(pickupRate('own_fleet'));
      const quotePickupRates = jest.fn();
      service.shippingCalculatorService = {
        quoteRateGross: jest.fn().mockResolvedValue(15000),
        quotePickupRates,
      };

      await service.createOrUpdateOrderFromPos(client, dto({
        delivery_type: 'pickup',
        shipping_rate_id: 9,
        shipping_cost: 15000,
      }), user);

      expect(quotePickupRates).not.toHaveBeenCalled();
      expect(client.orders.update.mock.calls[0][0].data).toEqual(expect.objectContaining({
        shipping_rate_id: 9,
        shipping_cost: 15000,
      }));
    });
  });

  it('tarifa fija con costo digitado distinto (costo manual): copia vacía, liga la tarifa', async () => {
    const client = tx();
    await service.createOrUpdateOrderFromPos(
      client, dto({ shipping_rate_id: 9, shipping_cost: 12000 }), user,
    );
    expect(snapshotForRate).not.toHaveBeenCalled();
    const data = client.orders.update.mock.calls[0][0].data;
    expect(data).toEqual(expect.objectContaining({
      ...EMPTY_SHIPPING_TAX,
      shipping_rate_id: 9,
      shipping_cost: 12000,
      grand_total: 22000,
    }));
  });

  it('precio manual con tarifa IVA agregado: deriva bruto, conserva tarifa y copia fiscal', async () => {
    const client = tx();
    service.shippingCalculatorService = { quoteRateGross: jest.fn().mockResolvedValue(15000) };
    const chargeForRate = jest.fn().mockResolvedValue({
      applies: true, reason: 'exclusive', gross: 11900, base: 10000, tax: 1900,
    });
    service.shippingTaxService.chargeForRate = chargeForRate;
    snapshotForRate.mockResolvedValue({
      shipping_tax_rate_id: 78, shipping_tax_name: 'IVA 19%',
      shipping_tax_type: 'iva', shipping_tax_rate: 0.19, shipping_tax_amount: 1900,
    });
    await service.createOrUpdateOrderFromPos(client, dto({
      shipping_rate_id: 9, manual_shipping_price: 10000, shipping_cost: 11900,
      shipping_address_snapshot: { country_code: 'CO', city: 'Bogotá' },
    }), user);

    expect(chargeForRate).toHaveBeenCalledWith(client, 9, 10000, { store_id: 1 });
    expect(snapshotForRate).toHaveBeenCalledWith(client, 9, 11900, { store_id: 1 });
    expect(client.orders.update.mock.calls[0][0].data).toMatchObject({
      shipping_rate_id: 9, shipping_cost: 11900, shipping_tax_amount: 1900,
      shipping_tax_is_inclusive: false, grand_total: 21900,
    });
  });

  it('precio manual rechaza un bruto cliente distinto del calculado antes de mutar', async () => {
    const client = tx();
    service.shippingCalculatorService = { quoteRateGross: jest.fn().mockResolvedValue(15000) };
    service.shippingTaxService.chargeForRate = jest.fn().mockResolvedValue({
      applies: true, reason: 'exclusive', gross: 11900, base: 10000, tax: 1900,
    });
    await expect(service.createOrUpdateOrderFromPos(client, dto({
      shipping_rate_id: 9, manual_shipping_price: 10000, shipping_cost: 10000,
      shipping_address_snapshot: { country_code: 'CO', city: 'Bogotá' },
    }), user)).rejects.toBeInstanceOf(VendixHttpException);
    expect(client.orders.update).not.toHaveBeenCalled();
  });

  describe('H5 — precio manual cuando la tarifa ya no recotiza la dirección', () => {
    it('sin country_code: no rechaza, costo manual sin impuesto, conserva la tarifa', async () => {
      const client = tx();
      const quoteRateGross = jest.fn();
      service.shippingCalculatorService = { quoteRateGross };
      const chargeForRate = jest.fn();
      service.shippingTaxService.chargeForRate = chargeForRate;

      await service.createOrUpdateOrderFromPos(client, dto({
        shipping_rate_id: 9, manual_shipping_price: 10000, shipping_cost: 11900,
        // Sin `country_code` ⇒ `recalculatePosRateCost` devuelve null antes
        // de siquiera llamar al calculador (regresión H5).
        shipping_address_snapshot: { city: 'Bogotá' },
      }), user);

      expect(quoteRateGross).not.toHaveBeenCalled();
      expect(chargeForRate).not.toHaveBeenCalled();
      expect(snapshotForRate).not.toHaveBeenCalled();
      const data = client.orders.update.mock.calls[0][0].data;
      expect(data).toEqual(expect.objectContaining({
        ...EMPTY_SHIPPING_TAX,
        shipping_rate_id: 9,
        shipping_cost: 11900,
        grand_total: 21900,
      }));
    });

    it('tarifa fuera de cobertura (quoteRateGross null): no rechaza, costo manual sin impuesto', async () => {
      const client: any = tx();
      client.addresses = {
        findFirst: jest.fn().mockResolvedValue({ country_code: 'CO', city: 'Bogotá' }),
      };
      client.products = { findMany: jest.fn().mockResolvedValue([]) };
      const quoteRateGross = jest.fn().mockResolvedValue(null);
      service.shippingCalculatorService = { quoteRateGross };
      const chargeForRate = jest.fn();
      service.shippingTaxService.chargeForRate = chargeForRate;

      await service.createOrUpdateOrderFromPos(client, dto({
        shipping_rate_id: 9, manual_shipping_price: 10000, shipping_cost: 11900,
        shipping_address_id: 3,
      }), user);

      expect(quoteRateGross).toHaveBeenCalled();
      expect(chargeForRate).not.toHaveBeenCalled();
      expect(snapshotForRate).not.toHaveBeenCalled();
      const data = client.orders.update.mock.calls[0][0].data;
      expect(data).toEqual(expect.objectContaining({
        ...EMPTY_SHIPPING_TAX,
        shipping_rate_id: 9,
        shipping_cost: 11900,
        grand_total: 21900,
      }));
    });

    it('con manual + tarifa que SÍ recotiza: el comportamiento nuevo sigue intacto', async () => {
      const client = tx();
      service.shippingCalculatorService = { quoteRateGross: jest.fn().mockResolvedValue(15000) };
      const chargeForRate = jest.fn().mockResolvedValue({
        applies: true, reason: 'exclusive', gross: 11900, base: 10000, tax: 1900,
      });
      service.shippingTaxService.chargeForRate = chargeForRate;
      snapshotForRate.mockResolvedValue({
        shipping_tax_rate_id: 78, shipping_tax_name: 'IVA 19%',
        shipping_tax_type: 'iva', shipping_tax_rate: 0.19, shipping_tax_amount: 1900,
      });

      await service.createOrUpdateOrderFromPos(client, dto({
        shipping_rate_id: 9, manual_shipping_price: 10000, shipping_cost: 11900,
        shipping_address_snapshot: { country_code: 'CO', city: 'Bogotá' },
      }), user);

      expect(chargeForRate).toHaveBeenCalledWith(client, 9, 10000, { store_id: 1 });
      expect(snapshotForRate).toHaveBeenCalledWith(client, 9, 11900, { store_id: 1 });
      const data = client.orders.update.mock.calls[0][0].data;
      expect(data).toMatchObject({
        shipping_rate_id: 9, shipping_cost: 11900, shipping_tax_amount: 1900,
        shipping_tax_is_inclusive: false, grand_total: 21900,
      });
    });

    it('sin manual y tarifa que no pertenece al método/tienda: sigue lanzando ORD_SHIP_RATE_MISMATCH_001', async () => {
      const client = tx(null);
      let caught: any;
      try {
        await service.createOrUpdateOrderFromPos(client, dto({ shipping_rate_id: 99 }), user);
      } catch (error) { caught = error; }

      expect(caught).toBeInstanceOf(VendixHttpException);
      expect(caught.errorCode).toBe(ErrorCodes.ORD_SHIP_RATE_MISMATCH_001.code);
      expect(caught.getStatus()).toBe(400);
      expect(client.orders.update).not.toHaveBeenCalled();
    });
  });

  describe('tarifas calculadas: costo recalculado en el servidor (unificado con quoteRateGross)', () => {
    const calcTx = (type: string) => {
      const client: any = tx({ id: 9, shipping_method_id: 5, type, base_cost: 5000 });
      client.addresses = {
        findFirst: jest.fn().mockResolvedValue({ country_code: 'CO', city: 'Bogotá' }),
      };
      client.products = { findMany: jest.fn().mockResolvedValue([]) };
      return client;
    };
    let quoteRateGross: jest.Mock;
    beforeEach(() => {
      quoteRateGross = jest.fn();
      service.shippingCalculatorService = { quoteRateGross };
    });

    it('weight_based con costo igual al recalculado: copia la tarifa', async () => {
      quoteRateGross.mockResolvedValue(15000);
      const client = calcTx('weight_based');
      await service.createOrUpdateOrderFromPos(
        client, dto({ shipping_rate_id: 9, shipping_cost: 15000, shipping_address_id: 3 }), user,
      );
      expect(quoteRateGross).toHaveBeenCalledWith(
        1, 9, expect.any(Array), expect.objectContaining({ country_code: 'CO', city: 'Bogotá' }),
      );
      expect(snapshotForRate).toHaveBeenCalledWith(client, 9, 15000, { store_id: 1 });
    });

    it('price_based con costo distinto al recalculado: costo manual, copia vacía', async () => {
      quoteRateGross.mockResolvedValue(8000);
      const client = calcTx('price_based');
      await service.createOrUpdateOrderFromPos(
        client, dto({ shipping_rate_id: 9, shipping_cost: 15000, shipping_address_id: 3 }), user,
      );
      expect(snapshotForRate).not.toHaveBeenCalled();
      expect(client.orders.update.mock.calls[0][0].data).toEqual(expect.objectContaining({
        ...EMPTY_SHIPPING_TAX, shipping_rate_id: 9, shipping_cost: 15000,
      }));
    });

    it('carrier_calculated (el calculador no la cotiza): copia vacía', async () => {
      quoteRateGross.mockResolvedValue(null);
      const client = calcTx('carrier_calculated');
      await service.createOrUpdateOrderFromPos(
        client, dto({ shipping_rate_id: 9, shipping_cost: 15000, shipping_address_id: 3 }), user,
      );
      expect(snapshotForRate).not.toHaveBeenCalled();
    });

    it('sin dirección resoluble: no recalcula y la copia queda vacía', async () => {
      const client = calcTx('weight_based');
      await service.createOrUpdateOrderFromPos(
        client, dto({ shipping_rate_id: 9, shipping_cost: 15000 }), user,
      );
      expect(quoteRateGross).not.toHaveBeenCalled();
      expect(snapshotForRate).not.toHaveBeenCalled();
    });

    it('flat con quoteRateGross disponible: unificado, ya no usa el atajo base_cost (umbral de envío gratis)', async () => {
      quoteRateGross.mockResolvedValue(0);
      const client = calcTx('flat');
      await service.createOrUpdateOrderFromPos(
        client, dto({ shipping_rate_id: 9, shipping_cost: 0, shipping_address_id: 3 }), user,
      );
      expect(quoteRateGross).toHaveBeenCalledWith(
        1, 9, expect.any(Array), expect.objectContaining({ country_code: 'CO', city: 'Bogotá' }),
      );
      expect(snapshotForRate).toHaveBeenCalledWith(client, 9, 0, { store_id: 1 });
    });

    it('propaga latitude/longitude de la dirección al calculador (distancia)', async () => {
      quoteRateGross.mockResolvedValue(15000);
      const client = calcTx('weight_based');
      client.addresses.findFirst.mockResolvedValue({
        country_code: 'CO', city: 'Bogotá', latitude: 4.711, longitude: -74.072,
      });
      await service.createOrUpdateOrderFromPos(
        client, dto({ shipping_rate_id: 9, shipping_cost: 15000, shipping_address_id: 3 }), user,
      );
      expect(quoteRateGross).toHaveBeenCalledWith(
        1, 9, expect.any(Array),
        expect.objectContaining({ country_code: 'CO', city: 'Bogotá', latitude: 4.711, longitude: -74.072 }),
      );
    });
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

  describe('paso 14 — isManualCost compara contra el bruto', () => {
    const IVA_SNAPSHOT = {
      shipping_tax_rate_id: 5,
      shipping_tax_name: 'IVA 19%',
      shipping_tax_type: 'iva' as const,
      shipping_tax_rate: 0.19,
      shipping_tax_amount: 1900,
    };
    let chargeForRate: jest.Mock;
    const aggTx = () => tx({ id: 9, shipping_method_id: 5, type: 'flat', base_cost: 10000 });

    beforeEach(() => {
      chargeForRate = jest.fn().mockResolvedValue({
        applies: true, gross: 11900, base: 10000, tax: 1900, reason: 'exclusive',
      });
      service.shippingTaxService.chargeForRate = chargeForRate;
      snapshotForRate.mockResolvedValue({ ...IVA_SNAPSHOT });
    });

    it('costo = bruto agregado (11.900): conserva el impuesto y guarda modo false', async () => {
      const client = aggTx();
      await service.createOrUpdateOrderFromPos(
        client, dto({ shipping_rate_id: 9, shipping_cost: 11900 }), user,
      );

      expect(chargeForRate).toHaveBeenCalledWith(client, 9, 10000, { store_id: 1 });
      expect(snapshotForRate).toHaveBeenCalledWith(client, 9, 11900, { store_id: 1 });
      const data = client.orders.update.mock.calls[0][0].data;
      expect(data).toEqual(expect.objectContaining({
        ...IVA_SNAPSHOT,
        shipping_rate_id: 9,
        shipping_cost: 11900,
        shipping_tax_is_inclusive: false,
        grand_total: 21900,
      }));
    });

    it('costo = base agregada (10.000): es manual ⇒ copia vacía', async () => {
      const client = aggTx();
      await service.createOrUpdateOrderFromPos(
        client, dto({ shipping_rate_id: 9, shipping_cost: 10000 }), user,
      );

      expect(snapshotForRate).not.toHaveBeenCalled();
      const data = client.orders.update.mock.calls[0][0].data;
      expect(data).toEqual(expect.objectContaining({
        ...EMPTY_SHIPPING_TAX,
        shipping_rate_id: 9,
        shipping_cost: 10000,
        shipping_tax_is_inclusive: null,
        grand_total: 20000,
      }));
    });
  });
});
