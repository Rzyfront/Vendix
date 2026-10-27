import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { LodgingFolioService } from './folio.service';
import { nightAuditCutoff } from './folio-nights';

interface Item {
  id: number;
  order_id: number;
  product_name: string;
  description: string | null;
  total_price: number;
  tax_amount_item: number;
  quantity: number;
  cancelled_at: Date | null;
  cancellation_reason: string | null;
  inventory_committed: boolean;
  inventory_consumed_at_fire: boolean;
  order_item_taxes: Array<{ tax_amount: number }>;
}

/**
 * H3.4 — folio of H-0001 (order 500): one Doble room 101 with the nights of
 * 10-nov and 11-nov at $250.000 + IVA 19 %, store in Bogotá.
 */
function build(options: { paid?: number; allowOverride?: boolean } = {}) {
  const nights = [
    { id: 1, night_date: new Date('2026-11-10T00:00:00Z'), posted_order_item_id: null as number | null },
    { id: 2, night_date: new Date('2026-11-11T00:00:00Z'), posted_order_item_id: null as number | null },
  ];
  const items: Item[] = [];
  const payments: Array<{ id: number; amount: number; state: string; transaction_id: string }> = [];
  if (options.paid) {
    payments.push({ id: 1, amount: options.paid, state: 'succeeded', transaction_id: 'POS-1' });
  }
  const order = {
    id: 500,
    store_id: 3,
    state: 'draft',
    order_number: 'F-H-0001',
    customer_id: 9,
    currency: 'COP',
    grand_total: 0,
    total_paid: options.paid ?? 0,
    active_financial_split_id: null,
    get payments() {
      return payments;
    },
  };
  const lineTotal = (it: Item) =>
    it.total_price + it.order_item_taxes.reduce((s, t) => s + t.tax_amount, 0);

  const unposted = (where: any) =>
    nights.filter((n) => {
      if (n.posted_order_item_id !== null) return false;
      const date = where.night_date;
      if (date.lte) return n.night_date <= date.lte;
      return n.night_date < date.lt;
    });

  const tx = {
    $queryRaw: jest.fn(async () => [{ id: 500 }]),
    orders: {
      findUnique: jest.fn(async () => order),
      update: jest.fn(async ({ data }: any) => {
        if (data.total_paid?.increment) order.total_paid += data.total_paid.increment;
        return order;
      }),
    },
    lodging_room_nights: {
      findMany: jest.fn(async ({ where }: any) =>
        unposted(where).map((n) => ({
          id: n.id,
          night_date: n.night_date,
          rate_amount: 250000,
          unit: { code: '101' },
          unit_type: { name: 'Doble', product: { id: 900, name: 'Alojamiento Doble', price_unit_quantity: null } },
        })),
      ),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const night = nights.find((n) => n.id === where.id && n.posted_order_item_id === null);
        if (!night) return { count: 0 };
        night.posted_order_item_id = data.posted_order_item_id;
        return { count: 1 };
      }),
    },
    product_tax_assignments: {
      findMany: jest.fn(async () => [
        {
          product_id: 900,
          is_inclusive: false,
          tax_categories: { tax_type: 'IVA', tax_rates: [{ id: 7, name: 'IVA 19%', rate: 0.19 }] },
        },
      ]),
    },
    order_items: {
      create: jest.fn(async ({ data }: any) => {
        const item: Item = {
          id: 1000 + items.length,
          order_id: data.order_id,
          product_name: data.product_name,
          description: data.description,
          total_price: Number(data.total_price),
          tax_amount_item: Number(data.tax_amount_item),
          quantity: data.quantity,
          cancelled_at: null,
          cancellation_reason: null,
          inventory_committed: false,
          inventory_consumed_at_fire: false,
          order_item_taxes: (data.order_item_taxes?.create ?? []).map((t: any) => ({
            tax_amount: t.tax_amount,
          })),
        };
        items.push(item);
        return { id: item.id };
      }),
      findFirst: jest.fn(async ({ where }: any) =>
        items.find((it) => it.id === where.id && it.order_id === where.order_id) ?? null,
      ),
      update: jest.fn(async ({ where, data }: any) => {
        const item = items.find((it) => it.id === where.id)!;
        Object.assign(item, data);
        return item;
      }),
    },
    payments: {
      create: jest.fn(async ({ data }: any) => {
        const payment = { id: 10 + payments.length, ...data, amount: Number(data.amount) };
        payments.push(payment);
        return payment;
      }),
      findFirst: jest.fn(async ({ where }: any) =>
        payments.find((p) => p.transaction_id === where.transaction_id) ?? null,
      ),
    },
  };
  const prisma = {
    lodging_folios: {
      findFirst: jest.fn(async () => ({ id: 70, status: 'open', reservation_id: 1, order_id: 500 })),
    },
    lodging_room_nights: { count: jest.fn(async ({ where }: any) => unposted(where).length) },
    store_settings: {
      findFirst: jest.fn(async () => ({ settings: {}, stores: { timezone: 'America/Bogota' } })),
    },
    store_payment_methods: {
      findFirst: jest.fn(async () => ({
        id: 4,
        display_name: 'Efectivo',
        system_payment_method: { type: 'cash', display_name: 'Efectivo' },
      })),
    },
    payments: {
      findFirst: jest.fn(async ({ where }: any) =>
        payments.find((p) => p.transaction_id === where.transaction_id) ?? null,
      ),
    },
    product_tax_assignments: tx.product_tax_assignments,
    products: {
      findFirst: jest.fn(async (): Promise<Record<string, unknown>> => ({
        id: 77,
        name: 'Lavandería',
        base_price: 30000,
        is_on_sale: false,
        sale_price: null,
        is_sellable: true,
        state: 'active',
        product_type: 'service',
        track_inventory: false,
        allow_pos_price_override: options.allowOverride ?? false,
        price_unit_quantity: null,
        product_variants: [],
      })),
    },
    $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  const orderFlow = {
    // Shared totals rule: active lines only, balance = total - settled.
    recalcOrderTotalsFromActiveLinesInTx: jest.fn(async () => {
      order.grand_total = items.filter((it) => !it.cancelled_at).reduce((s, it) => s + lineTotal(it), 0);
    }),
  };
  const orderHistory = { record: jest.fn(async () => ({ id: 1 })) };
  const cashSessions = {
    assertSessionForSales: jest.fn(async () => undefined),
    getActiveSession: jest.fn(async () => ({ id: 30 })),
  };
  const cashMovements = { recordSaleMovement: jest.fn(async () => ({ id: 1 })) };
  const settings = { getSettings: jest.fn(async () => ({ pos: { cash_register: { enabled: true } } })) };
  const events: string[] = [];
  const eventEmitter = { emit: jest.fn((name: string) => events.push(name)) };

  const service = new LodgingFolioService(
    prisma as any,
    orderFlow as any,
    orderHistory as any,
    cashSessions as any,
    cashMovements as any,
    settings as any,
    eventEmitter as any,
  );
  // The folio view is a plain read; these specs assert the writes.
  jest.spyOn(service, 'getFolio').mockResolvedValue({} as any);
  return { service, prisma, tx, nights, items, order, payments, orderFlow, eventEmitter, cashMovements };
}

async function errorOf(promise: Promise<unknown>): Promise<VendixHttpException> {
  try {
    await promise;
  } catch (error) {
    return error as VendixHttpException;
  }
  throw new Error('expected the folio operation to fail');
}

describe('LodgingFolioService (H3.4)', () => {
  beforeEach(() => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 3, user_id: 42 } as any);
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    // 10-nov 22:00 in Bogotá: the guest of H-0001 is in house.
    jest.setSystemTime(new Date('2026-11-11T03:00:00Z'));
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('posting nights', () => {
    it('"Cargar noche" charges tonight as "Noche 10-nov · Doble · 101" at $250.000 + IVA', async () => {
      const { service, items, nights, order } = build();

      const result = await service.postNights(1);

      expect(result.posted).toBe(1);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        description: 'Noche 10-nov · Doble · 101',
        product_name: 'Alojamiento Doble',
        quantity: 1,
        total_price: 250000,
        order_item_taxes: [{ tax_amount: 47500 }],
      });
      expect(nights[0].posted_order_item_id).toBe(items[0].id);
      // The 11-nov night is not due yet.
      expect(nights[1].posted_order_item_id).toBeNull();
      expect(order.grand_total).toBe(297500);
    });

    it('posting the same night twice does not duplicate it', async () => {
      const { service, items, tx } = build();

      await service.postNights(1);
      const second = await service.postNights(1);

      expect(second.posted).toBe(0);
      expect(items).toHaveLength(1);
      expect(tx.order_items.create).toHaveBeenCalledTimes(1);
    });

    it('a night already taken by a concurrent post rolls the transaction back', async () => {
      const { service, tx } = build();
      tx.lodging_room_nights.updateMany.mockResolvedValueOnce({ count: 0 });

      const error = await errorOf(service.postNights(1));

      expect(error.errorCode).toBe(ErrorCodes.LODGING_FOLIO_CHARGE_001.code);
    });

    it('the night audit charges only the nights before its cutoff', async () => {
      const { service, items, nights } = build();
      const folio = { id: 70, status: 'open', reservation_id: 1, order_id: 500 };

      // 11-nov 01:00 with audit at 02:00: the night of 10-nov is not due yet.
      expect(nightAuditCutoff('2026-11-11', '01:00', '02:00')).toBe('2026-11-10');
      expect(await service.postNightsThrough(folio, '2026-11-10', false)).toBe(0);

      // 11-nov 02:00: the night of 10-nov is charged, 11-nov is not.
      expect(nightAuditCutoff('2026-11-11', '02:00', '02:00')).toBe('2026-11-11');
      expect(await service.postNightsThrough(folio, '2026-11-11', false)).toBe(1);
      expect(await service.postNightsThrough(folio, '2026-11-11', false)).toBe(0);
      expect(items).toHaveLength(1);
      expect(nights.map((n) => n.posted_order_item_id)).toEqual([items[0].id, null]);
    });

    it('a closed folio takes no nights', async () => {
      const { service, prisma, items } = build();
      prisma.lodging_folios.findFirst.mockResolvedValueOnce({
        id: 70,
        status: 'closed',
        reservation_id: 1,
        order_id: 500,
      });

      const error = await errorOf(service.postNights(1));

      expect(error.errorCode).toBe(ErrorCodes.LODGING_FOLIO_CLOSED_001.code);
      expect(items).toHaveLength(0);
    });
  });

  describe('voiding a charge', () => {
    it('requires a reason', async () => {
      const { service, tx } = build();
      await service.postNights(1);

      const error = await errorOf(service.voidCharge(1, 1000, { reason: '  ' }));

      expect(error.errorCode).toBe(ErrorCodes.LODGING_FOLIO_VOID_001.code);
      expect(tx.order_items.update).not.toHaveBeenCalled();
    });

    it('keeps the line struck through with its reason, out of the total, and never re-posts the night', async () => {
      const { service, items, order, tx } = build();
      await service.postNights(1);

      await service.voidCharge(1, 1000, { reason: 'Cortesía de la casa' });

      expect(items).toHaveLength(1);
      expect(items[0].cancelled_at).toBeInstanceOf(Date);
      expect(items[0].cancellation_reason).toBe('Cortesía de la casa');
      expect(order.grand_total).toBe(0);
      // The night stays posted: "Cargar noche" adds nothing.
      expect((await service.postNights(1)).posted).toBe(0);
      // Voiding again writes nothing.
      await service.voidCharge(1, 1000, { reason: 'Otra vez' });
      expect(tx.order_items.update).toHaveBeenCalledTimes(1);
      expect(items[0].cancellation_reason).toBe('Cortesía de la casa');
    });

    it('rejects a void that leaves the folio below what was paid', async () => {
      const { service, items } = build({ paid: 100000 });
      await service.postNights(1);

      const error = await errorOf(service.voidCharge(1, 1000, { reason: 'Error de digitación' }));

      expect(error.errorCode).toBe(ErrorCodes.LODGING_FOLIO_VOID_001.code);
      expect(items[0].cancelled_at).toBeNull();
    });

    it('rejects a line of another order', async () => {
      const { service } = build();

      const error = await errorOf(service.voidCharge(1, 999, { reason: 'No existe' }));

      expect(error.errorCode).toBe(ErrorCodes.LODGING_FOLIO_VOID_001.code);
    });
  });

  describe('manual charges', () => {
    const admin = { roles: ['owner'], permissions: [{ name: 'store:pos:price_override', status: 'active' }] };
    const receptionist = { roles: ['receptionist'], permissions: [] };

    it('adds the laundry at its catalog price', async () => {
      const { service, items, order } = build();

      await service.addCharge(1, { product_id: 77, quantity: 1 }, receptionist);

      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ product_name: 'Lavandería', total_price: 30000 });
      expect(order.grand_total).toBe(30000);
    });

    it('a different price needs the product to allow it and the POS override permission', async () => {
      const { service, items } = build({ allowOverride: true });

      const denied = await errorOf(
        service.addCharge(1, { product_id: 77, quantity: 1, unit_price: 1 }, receptionist),
      );
      expect(denied.errorCode).toBe(ErrorCodes.AUTH_PERM_001.code);
      expect(items).toHaveLength(0);

      await service.addCharge(1, { product_id: 77, quantity: 1, unit_price: 45000 }, admin);
      expect(items[0]).toMatchObject({ total_price: 45000 });
    });

    it('rejects a different price when the product does not allow it', async () => {
      const { service, items } = build();

      const error = await errorOf(
        service.addCharge(1, { product_id: 77, quantity: 1, unit_price: 45000 }, admin),
      );

      expect(error.errorCode).toBe(ErrorCodes.POS_PRICE_OVERRIDE_NOT_ALLOWED_001.code);
      expect(items).toHaveLength(0);
    });

    it('rejects a product with a recipe', async () => {
      const { service, prisma, items } = build();
      const laundry = await prisma.products.findFirst();
      prisma.products.findFirst.mockResolvedValueOnce({ ...laundry, product_type: 'prepared' });

      const error = await errorOf(service.addCharge(1, { product_id: 77, quantity: 1 }, admin));

      expect(error.errorCode).toBe(ErrorCodes.LODGING_FOLIO_CHARGE_001.code);
      expect(items).toHaveLength(0);
    });
  });

  describe('partial payment', () => {
    const request_id = 'req-0001-abcd';

    it('registers a direct cash payment, its cash movement and the folio advance event after commit', async () => {
      const { service, payments, order, cashMovements, eventEmitter, prisma } = build();
      await service.postNights(1);

      await service.registerPayment(1, { amount: 100000, store_payment_method_id: 4, request_id });

      expect(payments).toHaveLength(1);
      expect(payments[0]).toMatchObject({
        order_id: 500,
        amount: 100000,
        state: 'succeeded',
        transaction_id: `FOLIO-70-${request_id}`,
      });
      expect(order.total_paid).toBe(100000);
      expect(order.state).toBe('draft');
      expect(cashMovements.recordSaleMovement).toHaveBeenCalledWith(
        30,
        expect.objectContaining({ amount: 100000, payment_method: 'cash', order_id: 500 }),
        expect.anything(),
      );
      // Booked as a customer advance, never as a sale before the invoice.
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'lodging.folio_payment.received',
        expect.objectContaining({ store_id: 3, payment_id: payments[0].id, amount: 100000, payment_method_type: 'cash' }),
      );
      expect(eventEmitter.emit).not.toHaveBeenCalledWith('payment.received', expect.anything());
      // Emitted once the transaction resolved.
      const txDone = prisma.$transaction.mock.invocationCallOrder.at(-1)!;
      expect(eventEmitter.emit.mock.invocationCallOrder[0]).toBeGreaterThan(txDone);
    });

    it('a double click registers the payment once', async () => {
      const { service, payments, eventEmitter } = build();
      await service.postNights(1);

      await service.registerPayment(1, { amount: 100000, store_payment_method_id: 4, request_id });
      await service.registerPayment(1, { amount: 100000, store_payment_method_id: 4, request_id });

      expect(payments).toHaveLength(1);
      expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
    });

    it('rejects a payment above the balance', async () => {
      const { service, payments, eventEmitter } = build();
      await service.postNights(1);

      const error = await errorOf(
        service.registerPayment(1, { amount: 300000, store_payment_method_id: 4, request_id }),
      );

      expect(error.errorCode).toBe(ErrorCodes.LODGING_FOLIO_PAYMENT_001.code);
      expect(payments).toHaveLength(0);
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('rejects a gateway method the desk cannot confirm', async () => {
      const { service, prisma, payments } = build();
      await service.postNights(1);
      prisma.store_payment_methods.findFirst.mockResolvedValueOnce({
        id: 5,
        display_name: 'Wompi',
        system_payment_method: { type: 'wompi', display_name: 'Wompi' },
      } as any);

      const error = await errorOf(
        service.registerPayment(1, { amount: 100000, store_payment_method_id: 5, request_id }),
      );

      expect(error.errorCode).toBe(ErrorCodes.LODGING_FOLIO_PAYMENT_001.code);
      expect(payments).toHaveLength(0);
    });
  });
});
