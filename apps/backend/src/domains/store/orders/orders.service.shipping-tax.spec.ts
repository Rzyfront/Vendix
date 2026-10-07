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
        findFirst: jest.fn().mockResolvedValue({ id: 31, shipping_method_id: 4, type: 'flat', base_cost: 15000, is_active: true }),
      },
    };
    snapshotForRate = jest.fn().mockResolvedValue({ ...INC_SNAPSHOT });
    service = Object.create(OrdersService.prototype);
    service.prisma = prisma;
    service.eventEmitter = { emit: jest.fn() };
    service.shippingTaxService = { snapshotForRate };
    service.logger = { warn: jest.fn() };
  });

  afterEach(() => jest.restoreAllMocks());

  it('costo de la tarifa: copia congelada y grand_total sin cambio', async () => {
    // Paso 2 (unificación): `resolveExpectedRateCost` ahora cotiza TODAS
    // las tarifas (incluida `flat`) vía `quoteOrderShippingOptions`, que
    // hace su propia lectura de la orden (2do `orders.findFirst`).
    prisma.orders.findFirst
      .mockResolvedValueOnce({
        id: 10, store_id: 1, state: 'created',
        subtotal_amount: 10000, tax_amount: 800, discount_amount: 0,
      })
      .mockResolvedValueOnce({
        addresses_orders_shipping_address_idToaddresses: { country_code: 'CO', city: 'Bogotá' },
        order_items: [],
      });
    service.shippingCalculatorService = {
      calculateRates: jest.fn().mockResolvedValue([{ method_id: 4, rate_id: 31, cost: 15000 }]),
    };
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
    prisma.orders.findFirst
      .mockResolvedValueOnce({
        id: 10, store_id: 1, state: 'created',
        subtotal_amount: 10000, tax_amount: 800, discount_amount: 0,
      })
      .mockResolvedValueOnce({
        addresses_orders_shipping_address_idToaddresses: { country_code: 'CO', city: 'Bogotá' },
        order_items: [],
      });
    service.shippingCalculatorService = {
      calculateRates: jest.fn().mockResolvedValue([{ method_id: 4, rate_id: 31, cost: 15000 }]),
    };
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

  it('paso 14 — flat agregada sin costo en el DTO: cobra el bruto y guarda modo false', async () => {
    const chargeForRate = jest.fn().mockResolvedValue({
      applies: true, gross: 11900, base: 10000, tax: 1900, reason: 'exclusive',
    });
    service.shippingTaxService.chargeForRate = chargeForRate;
    snapshotForRate.mockResolvedValue({
      shipping_tax_rate_id: 5,
      shipping_tax_name: 'IVA 19%',
      shipping_tax_type: 'iva',
      shipping_tax_rate: 0.19,
      shipping_tax_amount: 1900,
    });
    prisma.shipping_rates.findFirst.mockResolvedValue({
      id: 31, shipping_method_id: 4, type: 'flat', base_cost: 10000, is_active: true,
    });
    // Paso 2 (unificación): el bruto agregado (11900) ahora sale del
    // cálculo único (`quoteOrderShippingOptions` → `calculateRates`), no
    // del atajo `chargeForRate(base_cost)` — `chargeForRate` sigue vivo,
    // pero solo dentro de `resolveShippingTaxChange` para decidir el modo
    // (inclusivo/agregado), ya sobre el costo cotizado.
    prisma.orders.findFirst
      .mockResolvedValueOnce({
        id: 10, store_id: 1, state: 'created',
        subtotal_amount: 10000, tax_amount: 800, discount_amount: 0,
      })
      .mockResolvedValueOnce({
        addresses_orders_shipping_address_idToaddresses: { country_code: 'CO', city: 'Bogotá' },
        order_items: [],
      });
    service.shippingCalculatorService = {
      calculateRates: jest.fn().mockResolvedValue([{ method_id: 4, rate_id: 31, cost: 11900 }]),
    };
    await service.assignShipping(10, { shipping_method_id: 4, shipping_rate_id: 31 });
    expect(chargeForRate).toHaveBeenCalledWith(null, 31, 11900, { store_id: 1 });
    expect(snapshotForRate).toHaveBeenCalledWith(null, 31, 11900, { store_id: 1 });
    const data = prisma.orders.update.mock.calls[0][0].data;
    expect(data).toMatchObject({
      shipping_rate_id: 31,
      shipping_cost: 11900,
      shipping_tax_amount: 1900,
      shipping_tax_is_inclusive: false,
      // 10000 + 800 − 0 + 11900 + 0
      grand_total: 22700,
    });
  });

  /**
   * Tarifa explícita NO flat: el costo esperado lo recalcula el servidor con
   * `ShippingCalculatorService` (mismo contrato que
   * `PaymentsService.resolvePosShippingTax`), no `base_cost`.
   */
  describe('tarifa explícita calculada (no flat)', () => {
    const orderRow = {
      id: 10, store_id: 1, state: 'created',
      subtotal_amount: 10000, tax_amount: 800, discount_amount: 0,
    };
    const orderForCalc = {
      addresses_orders_shipping_address_idToaddresses: { country_code: 'CO', city: 'Bogotá' },
      order_items: [
        {
          product_id: 5, quantity: 2, total_price: 10000, weight: null,
          products: { id: 5, weight: 1.5, product_type: 'physical' },
          order_item_taxes: [{ tax_amount: 800 }],
        },
      ],
    };
    let calculateRates: jest.Mock;
    const arrange = (type: string, quotedCost: number | null) => {
      prisma.shipping_rates.findFirst.mockResolvedValue({
        id: 31, shipping_method_id: 4, type, base_cost: 15000, is_active: true,
      });
      prisma.orders.findFirst
        .mockResolvedValueOnce(orderRow)
        .mockResolvedValueOnce(orderForCalc);
      calculateRates = jest.fn().mockResolvedValue(
        quotedCost == null ? [] : [{ method_id: 4, rate_id: 31, cost: quotedCost }],
      );
      service.shippingCalculatorService = { calculateRates };
    };

    it('weight_based: costo cobrado = recalculado ⇒ copia de la tarifa (líneas en bruto)', async () => {
      arrange('weight_based', 9000);
      await service.assignShipping(10, { shipping_method_id: 4, shipping_rate_id: 31, shipping_cost: 9000 });
      expect(calculateRates).toHaveBeenCalledWith(
        1,
        [{ product_id: 5, quantity: 2, price: 10800, weight: 3, product_type: 'physical' }],
        expect.objectContaining({ country_code: 'CO', city: 'Bogotá' }),
      );
      expect(snapshotForRate).toHaveBeenCalledWith(null, 31, 9000, { store_id: 1 });
      expect(prisma.orders.update.mock.calls[0][0].data.shipping_tax_amount).toBe(1111.11);
    });

    it('weight_based sin costo en el DTO: toma el recalculado, no base_cost', async () => {
      arrange('weight_based', 9000);
      await service.assignShipping(10, { shipping_method_id: 4, shipping_rate_id: 31 });
      const data = prisma.orders.update.mock.calls[0][0].data;
      expect(data.shipping_cost).toBe(9000);
      expect(snapshotForRate).toHaveBeenCalled();
    });

    it('price_based: costo igual a base_cost pero ≠ recalculado (≥1 ¢) ⇒ manual ⇒ copia vacía', async () => {
      arrange('price_based', 9000);
      await service.assignShipping(10, { shipping_method_id: 4, shipping_rate_id: 31, shipping_cost: 15000 });
      expect(snapshotForRate).not.toHaveBeenCalled();
      expect(prisma.orders.update.mock.calls[0][0].data).toMatchObject({
        ...EMPTY_SHIPPING_TAX, shipping_cost: 15000, shipping_rate_id: 31,
      });
    });

    it('un centavo de diferencia basta para copia vacía', async () => {
      arrange('weight_based', 9000);
      await service.assignShipping(10, { shipping_method_id: 4, shipping_rate_id: 31, shipping_cost: 9000.01 });
      expect(snapshotForRate).not.toHaveBeenCalled();
    });

    it('carrier_calculated: sin cotización determinista ⇒ copia vacía', async () => {
      arrange('carrier_calculated', null);
      await service.assignShipping(10, { shipping_method_id: 4, shipping_rate_id: 31, shipping_cost: 15000 });
      expect(snapshotForRate).not.toHaveBeenCalled();
      expect(prisma.orders.update.mock.calls[0][0].data).toMatchObject({
        ...EMPTY_SHIPPING_TAX, shipping_cost: 15000,
      });
    });

    it('fallo del calculador ⇒ copia vacía (nunca inventa impuesto)', async () => {
      arrange('weight_based', 9000);
      calculateRates.mockRejectedValue(new Error('boom'));
      await service.assignShipping(10, { shipping_method_id: 4, shipping_rate_id: 31, shipping_cost: 9000 });
      expect(snapshotForRate).not.toHaveBeenCalled();
      expect(service.logger.warn).toHaveBeenCalled();
    });

    // Paso 2 (unificación de envío) — antes `flat` tenía un atajo propio
    // (`chargeForRate(base_cost)`) que nunca consultaba el calculador, así
    // que ignoraba el umbral de envío gratis, el costo por unidad y la
    // distancia. Reemplaza a la vieja «flat no consulta el calculador»
    // (aserción contraria a la unificación buscada).
    it('flat también pasa por el calculador (unificado): costo cobrado = recalculado, no solo base_cost', async () => {
      arrange('flat', 9000);
      await service.assignShipping(10, { shipping_method_id: 4, shipping_rate_id: 31, shipping_cost: 9000 });
      expect(calculateRates).toHaveBeenCalledWith(
        1,
        [{ product_id: 5, quantity: 2, price: 10800, weight: 3, product_type: 'physical' }],
        expect.objectContaining({ country_code: 'CO', city: 'Bogotá' }),
      );
      expect(snapshotForRate).toHaveBeenCalledWith(null, 31, 9000, { store_id: 1 });
      expect(prisma.orders.update.mock.calls[0][0].data.shipping_tax_amount).toBe(1111.11);
    });

    // Caso de spec del encargo — "assignShipping con tarifa por distancia y
    // dirección con coordenadas ⇒ costo del tramo". La matemática de tramos
    // en sí (`ShippingDistanceService`/`ShippingCalculatorService.
    // applyDistancePrice`) ya está cubierta en
    // `shipping-calculator.service.spec.ts` (paso 1); acá se prueba el
    // CABLEADO de este archivo: `quoteOrderShippingOptions` ahora arrastra
    // `latitude`/`longitude` (numéricos) de la dirección de la orden hacia
    // `calculateRates`, algo que antes de este paso no ocurría (bug #2 del
    // encargo).
    it('con dirección con coordenadas ⇒ el calculador recibe latitude/longitude numéricos', async () => {
      prisma.shipping_rates.findFirst.mockResolvedValue({
        id: 31, shipping_method_id: 4, type: 'flat', base_cost: 15000, is_active: true,
      });
      prisma.orders.findFirst
        .mockResolvedValueOnce(orderRow)
        .mockResolvedValueOnce({
          addresses_orders_shipping_address_idToaddresses: {
            country_code: 'CO',
            city: 'Bogotá',
            latitude: 4.711,
            longitude: -74.0721,
          },
          order_items: [],
        });
      const calcWithDistance = jest
        .fn()
        .mockResolvedValue([{ method_id: 4, rate_id: 31, cost: 6000 }]);
      service.shippingCalculatorService = { calculateRates: calcWithDistance };

      await service.assignShipping(10, { shipping_method_id: 4, shipping_rate_id: 31, shipping_cost: 6000 });

      expect(calcWithDistance).toHaveBeenCalledWith(
        1,
        [],
        expect.objectContaining({
          country_code: 'CO',
          city: 'Bogotá',
          latitude: 4.711,
          longitude: -74.0721,
        }),
      );
      const data = prisma.orders.update.mock.calls[0][0].data;
      expect(data.shipping_cost).toBe(6000);
    });
  });
});

/**
 * Paso 5 (B1) — `update()` (PATCH): el costo nuevo re-deriva la copia de
 * la tarifa efectiva cuando coincide con su costo; si es manual la copia
 * queda vacía; sin cambio queda intacta. En shipped/delivered/finished el
 * cambio de envío se bloquea con `ORD_SHIP_LOCKED_001`.
 */
describe('OrdersService.update — PATCH de envío (paso 5 B1)', () => {
  const INC_SNAPSHOT = {
    shipping_tax_rate_id: 77,
    shipping_tax_name: 'INC 8%',
    shipping_tax_type: 'inc' as const,
    shipping_tax_rate: 0.08,
    shipping_tax_amount: 1481.48,
  };
  let service: any;
  let prisma: any;
  let snapshotForRate: jest.Mock;

  const baseOrder = {
    id: 10, store_id: 1, state: 'created',
    subtotal_amount: 100000, tax_amount: 19000, discount_amount: 0,
    shipping_cost: 15000, shipping_method_id: 4, shipping_rate_id: 31,
    tip_amount: 0, order_items: [],
    ...INC_SNAPSHOT,
  };

  beforeEach(() => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
      store_id: 1, organization_id: 1, user_id: 9,
    } as any);
    prisma = {
      orders: {
        findFirst: jest.fn().mockResolvedValue({ ...baseOrder }),
        update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 10, ...data })),
      },
      shipping_rates: {
        findFirst: jest.fn().mockResolvedValue({ id: 31, shipping_method_id: 4, type: 'flat', base_cost: 20000, is_active: true }),
      },
      invoices: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      // findOne: division financiera + modo cocina (kitchen_mode).
      order_financial_accounts: { findMany: jest.fn().mockResolvedValue([]) },
      store_settings: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    snapshotForRate = jest.fn().mockResolvedValue({ ...INC_SNAPSHOT });
    service = Object.create(OrdersService.prototype);
    service.prisma = prisma;
    service.eventEmitter = { emit: jest.fn() };
    service.shippingTaxService = { snapshotForRate };
    service.logger = { warn: jest.fn(), error: jest.fn() };
  });

  afterEach(() => jest.restoreAllMocks());

  it('PATCH a 20.000 (= costo de la tarifa): re-deriva la copia y cuadra el total', async () => {
    // Paso 2 (unificación): `resolveExpectedRateCost` cotiza vía
    // `quoteOrderShippingOptions` para toda tarifa (antes `flat` no hacía
    // esta 2da lectura de la orden).
    prisma.orders.findFirst
      .mockResolvedValueOnce({ ...baseOrder })
      .mockResolvedValueOnce({
        addresses_orders_shipping_address_idToaddresses: { country_code: 'CO', city: 'Bogotá' },
        order_items: [],
      });
    service.shippingCalculatorService = {
      calculateRates: jest.fn().mockResolvedValue([{ method_id: 4, rate_id: 31, cost: 20000 }]),
    };
    await service.update(10, { shipping_cost: 20000 });
    expect(snapshotForRate).toHaveBeenCalledWith(null, 31, 20000, { store_id: 1 });
    const data = prisma.orders.update.mock.calls[0][0].data;
    expect(data).toMatchObject({
      ...INC_SNAPSHOT,
      shipping_cost: 20000,
      // 100000 + 19000 - 0 + 20000 + 0
      grand_total: 139000,
    });
  });

  it('paso 14 — PATCH al bruto agregado: re-deriva la copia y guarda modo false', async () => {
    const chargeForRate = jest.fn().mockResolvedValue({
      applies: true, gross: 11900, base: 10000, tax: 1900, reason: 'exclusive',
    });
    service.shippingTaxService.chargeForRate = chargeForRate;
    snapshotForRate.mockResolvedValue({
      shipping_tax_rate_id: 5,
      shipping_tax_name: 'IVA 19%',
      shipping_tax_type: 'iva',
      shipping_tax_rate: 0.19,
      shipping_tax_amount: 1900,
    });
    prisma.shipping_rates.findFirst.mockResolvedValue({
      id: 31, shipping_method_id: 4, type: 'flat', base_cost: 10000, is_active: true,
    });
    // Paso 2 (unificación): el bruto (11900) sale del cálculo único, no
    // del atajo `chargeForRate(base_cost)`; `chargeForRate` sigue
    // llamándose, pero desde `resolveShippingTaxChange` con el costo YA
    // cotizado (11900), para decidir el modo inclusivo/agregado.
    prisma.orders.findFirst
      .mockResolvedValueOnce({ ...baseOrder })
      .mockResolvedValueOnce({
        addresses_orders_shipping_address_idToaddresses: { country_code: 'CO', city: 'Bogotá' },
        order_items: [],
      });
    service.shippingCalculatorService = {
      calculateRates: jest.fn().mockResolvedValue([{ method_id: 4, rate_id: 31, cost: 11900 }]),
    };
    await service.update(10, { shipping_cost: 11900 });
    expect(chargeForRate).toHaveBeenCalledWith(null, 31, 11900, { store_id: 1 });
    expect(snapshotForRate).toHaveBeenCalledWith(null, 31, 11900, { store_id: 1 });
    const data = prisma.orders.update.mock.calls[0][0].data;
    expect(data).toMatchObject({
      shipping_cost: 11900,
      shipping_tax_amount: 1900,
      shipping_tax_is_inclusive: false,
      // 100000 + 19000 - 0 + 11900 + 0
      grand_total: 130900,
    });
  });

  it('PATCH manual (12.000 ≠ tarifa): copia vacía', async () => {
    await service.update(10, { shipping_cost: 12000 });
    expect(snapshotForRate).not.toHaveBeenCalled();
    const data = prisma.orders.update.mock.calls[0][0].data;
    expect(data).toMatchObject({
      ...EMPTY_SHIPPING_TAX,
      shipping_cost: 12000,
      grand_total: 131000,
    });
  });

  it('PATCH sin cambio (mismo costo): conserva la copia, no escribe shipping_tax_*', async () => {
    await service.update(10, { shipping_cost: 15000 });
    expect(snapshotForRate).not.toHaveBeenCalled();
    expect(prisma.shipping_rates.findFirst).not.toHaveBeenCalled();
    const data = prisma.orders.update.mock.calls[0][0].data;
    expect('shipping_tax_amount' in data).toBe(false);
    expect('shipping_tax_rate_id' in data).toBe(false);
    expect(data.grand_total).toBe(134000);
  });

  it('PATCH de envío en delivered ⇒ ORD_SHIP_LOCKED_001 y ningún write', async () => {
    prisma.orders.findFirst.mockResolvedValue({ ...baseOrder, state: 'delivered' });
    await expect(service.update(10, { shipping_cost: 20000 })).rejects.toMatchObject({
      errorCode: 'ORD_SHIP_LOCKED_001',
    });
    expect(prisma.orders.update).not.toHaveBeenCalled();
  });

  it('PATCH de metadata en delivered (sin cambio de envío) pasa', async () => {
    prisma.orders.findFirst.mockResolvedValue({ ...baseOrder, state: 'delivered' });
    await service.update(10, { internal_notes: 'nota' });
    expect(prisma.orders.update).toHaveBeenCalled();
  });
});

/**
 * Paso 5 (B2) — `assignShipping`: conserva la propina en el total, no
 * re-deriva la copia si nada cambió, y exige no tener reparto activo.
 */
describe('OrdersService.assignShipping — propina, intacta y split (paso 5 B2)', () => {
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
          tip_amount: 5000,
        }),
        update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 10, ...data })),
      },
      shipping_methods: {
        findFirst: jest.fn().mockResolvedValue({ id: 4, store_id: 1, type: 'delivery', is_active: true }),
      },
      shipping_rates: {
        findFirst: jest.fn().mockResolvedValue({ id: 31, shipping_method_id: 4, type: 'flat', base_cost: 15000, is_active: true }),
      },
    };
    snapshotForRate = jest.fn().mockResolvedValue({
      shipping_tax_rate_id: 77,
      shipping_tax_name: 'INC 8%',
      shipping_tax_type: 'inc',
      shipping_tax_rate: 0.08,
      shipping_tax_amount: 1111.11,
    });
    service = Object.create(OrdersService.prototype);
    service.prisma = prisma;
    service.eventEmitter = { emit: jest.fn() };
    service.shippingTaxService = { snapshotForRate };
    service.logger = { warn: jest.fn() };
  });

  afterEach(() => jest.restoreAllMocks());

  it('con propina 5.000: el total la conserva', async () => {
    // Paso 2 (unificación): 2do `orders.findFirst` de
    // `quoteOrderShippingOptions`, ahora también para `flat`.
    prisma.orders.findFirst
      .mockResolvedValueOnce({
        id: 10, store_id: 1, state: 'created',
        subtotal_amount: 10000, tax_amount: 800, discount_amount: 0,
        tip_amount: 5000,
      })
      .mockResolvedValueOnce({
        addresses_orders_shipping_address_idToaddresses: { country_code: 'CO', city: 'Bogotá' },
        order_items: [],
      });
    service.shippingCalculatorService = {
      calculateRates: jest.fn().mockResolvedValue([{ method_id: 4, rate_id: 31, cost: 15000 }]),
    };
    await service.assignShipping(10, { shipping_method_id: 4, shipping_rate_id: 31 });
    const data = prisma.orders.update.mock.calls[0][0].data;
    // 10000 + 800 - 0 + 15000 + 5000
    expect(data.grand_total).toBe(30800);
    expect(data.shipping_tax_amount).toBe(1111.11);
  });

  it('reasignar el mismo envío: copia intacta, no re-deriva', async () => {
    prisma.orders.findFirst.mockResolvedValue({
      id: 10, store_id: 1, state: 'created',
      subtotal_amount: 10000, tax_amount: 800, discount_amount: 0,
      shipping_cost: 15000, shipping_method_id: 4, shipping_rate_id: 31,
      shipping_tax_rate_id: 77, shipping_tax_amount: 1111.11,
    });
    await service.assignShipping(10, { shipping_method_id: 4, shipping_rate_id: 31, shipping_cost: 15000 });
    expect(snapshotForRate).not.toHaveBeenCalled();
    const data = prisma.orders.update.mock.calls[0][0].data;
    expect('shipping_tax_amount' in data).toBe(false);
    expect(data.grand_total).toBe(25800);
  });

  it('con reparto financiero activo ⇒ SPLIT_ACCOUNT_LOCKED', async () => {
    prisma.orders.findFirst.mockResolvedValue({
      id: 10, store_id: 1, state: 'created', active_financial_split_id: 3,
      subtotal_amount: 10000, tax_amount: 800, discount_amount: 0,
    });
    await expect(
      service.assignShipping(10, { shipping_method_id: 4, shipping_rate_id: 31 }),
    ).rejects.toMatchObject({ errorCode: 'SPLIT_ACCOUNT_LOCKED' });
    expect(prisma.orders.update).not.toHaveBeenCalled();
  });
});

/**
 * checkout-whatsapp-location-fallback (Paso 2) — `assignShipping` bloquea el
 * cambio de costo de envío cuando la orden ya tiene pagos aplicados
 * (`total_paid > 0`): el pago ya se aplicó sobre el `grand_total` anterior,
 * así que cambiar el costo aquí lo desincroniza sin tocar el pago. Solo se
 * usa `order.total_paid` (sin consultar `payments`) — mismo signal que
 * `remove()` usa como "evidencia financiera existe" (orders.service.ts).
 */
describe('OrdersService.assignShipping — bloqueo de cambio de costo con pagos aplicados (paso 2)', () => {
  let service: any;
  let prisma: any;

  beforeEach(() => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
      store_id: 1, organization_id: 1, user_id: 9,
    } as any);
    prisma = {
      orders: {
        findFirst: jest.fn().mockResolvedValue({
          id: 10, store_id: 1, state: 'created',
          subtotal_amount: 10000, tax_amount: 800, discount_amount: 0,
          shipping_cost: 5000, shipping_method_id: 4, shipping_rate_id: null,
          total_paid: 5000,
        }),
        update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 10, ...data })),
      },
      shipping_methods: {
        findFirst: jest.fn().mockResolvedValue({ id: 4, store_id: 1, type: 'delivery', is_active: true }),
      },
      shipping_rates: { findFirst: jest.fn() },
    };
    service = Object.create(OrdersService.prototype);
    service.prisma = prisma;
    service.eventEmitter = { emit: jest.fn() };
    service.shippingTaxService = { snapshotForRate: jest.fn() };
    service.logger = { warn: jest.fn() };
  });

  afterEach(() => jest.restoreAllMocks());

  it('rechaza ORD_SHIP_CHARGED_COST_CHANGE_001 cuando hay pagos aplicados y el costo cambia', async () => {
    await expect(
      service.assignShipping(10, { shipping_method_id: 4, shipping_cost: 9000 }),
    ).rejects.toMatchObject({ errorCode: 'ORD_SHIP_CHARGED_COST_CHANGE_001' });
    expect(prisma.orders.update).not.toHaveBeenCalled();
  });

  it('permite reasignar cuando el costo NO cambia aunque haya pagos aplicados', async () => {
    await service.assignShipping(10, { shipping_method_id: 4, shipping_cost: 5000 });
    expect(prisma.orders.update).toHaveBeenCalled();
  });

  it('sin pagos aplicados (total_paid=0), cambiar el costo sigue permitido (comportamiento previo intacto)', async () => {
    prisma.orders.findFirst.mockResolvedValue({
      id: 10, store_id: 1, state: 'created',
      subtotal_amount: 10000, tax_amount: 800, discount_amount: 0,
      shipping_cost: 5000, shipping_method_id: 4, shipping_rate_id: null,
      total_paid: 0,
    });
    await service.assignShipping(10, { shipping_method_id: 4, shipping_cost: 9000 });
    const data = prisma.orders.update.mock.calls[0][0].data;
    expect(data.shipping_cost).toBe(9000);
  });
});
