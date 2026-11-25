import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from 'src/common/errors';
import { BookingChargesService } from './booking-charges.service';

/**
 * QUI-1063 — "Agregar cargo" of a service booking: RSV-12 (order 300, store 3)
 * at $100.000 + IVA 19 %, and a $20.000 + IVA extra.
 */
function build(
  options: {
    bookingStatus?: string;
    orderId?: number | null;
    orderState?: string;
    invoiced?: boolean;
    product?: Record<string, unknown> | null;
  } = {},
) {
  const items: Array<Record<string, any>> = [];
  const order = {
    id: 300,
    store_id: 3,
    state: options.orderState ?? 'created',
    grand_total: 119000,
    remaining_balance: 119000,
    active_financial_split_id: null,
    payments: [] as Array<{ amount: number; state: string }>,
    invoices: options.invoiced ? [{ id: 1 }] : [],
    lodging_folio: null,
  };
  const tx = {
    $queryRaw: jest.fn(async (_sql: unknown, id: number, store: number) =>
      id === 300 && store === 3 ? [{ id: 300 }] : [],
    ),
    orders: {
      findFirst: jest.fn(async ({ where }: any) => (where.id === 300 && where.store_id === 3 ? order : null)),
    },
    order_items: {
      create: jest.fn(async ({ data }: any) => {
        items.push(data);
        return { id: 900 + items.length };
      }),
    },
  };
  const product =
    options.product === null
      ? null
      : {
          id: 55,
          name: 'Toalla extra',
          base_price: 20000,
          is_on_sale: false,
          sale_price: null,
          is_sellable: true,
          usage_nature: 'sale',
          state: 'active',
          product_type: 'service',
          track_inventory: false,
          price_unit_quantity: null,
          product_variants: [],
          ...(options.product ?? {}),
        };
  const prisma = {
    bookings: {
      findFirst: jest.fn(async () => ({
        id: 12,
        status: options.bookingStatus ?? 'confirmed',
        order_id: options.orderId === undefined ? 300 : options.orderId,
        booking_number: 'RSV-12',
      })),
    },
    products: { findFirst: jest.fn(async () => product) },
    product_tax_assignments: {
      findMany: jest.fn(async () => [
        {
          product_id: 55,
          is_inclusive: false,
          tax_categories: { tax_type: 'iva', tax_rates: [{ id: 7, name: 'IVA 19%', rate: 0.19 }] },
        },
      ]),
    },
    $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  const orderFlow = {
    recalcOrderTotalsFromActiveLinesInTx: jest.fn(async () => {
      order.grand_total += 23800;
      order.remaining_balance += 23800;
    }),
  };
  const service = new BookingChargesService(prisma as any, orderFlow as any);
  return { service, prisma, tx, items, order, orderFlow };
}

async function errorOf(promise: Promise<unknown>): Promise<VendixHttpException> {
  try {
    await promise;
  } catch (error) {
    return error as VendixHttpException;
  }
  throw new Error('expected the charge to fail');
}

describe('BookingChargesService (QUI-1063)', () => {
  beforeEach(() => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({ store_id: 3, user_id: 42 } as any);
  });
  afterEach(() => jest.restoreAllMocks());

  it('adds the extra as a line of the booking order with its IVA and recalculates total and balance', async () => {
    const { service, items, order, orderFlow, tx } = build();

    await service.addCharge(12, { product_id: 55, quantity: 2 });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      order_id: 300,
      product_id: 55,
      product_name: 'Toalla extra',
      description: 'Cargo adicional · Reserva RSV-12',
      quantity: 2,
      item_type: 'service',
      order_item_taxes: { create: [expect.objectContaining({ tax_rate_id: 7, tax_amount: 7600 })] },
    });
    expect(Number(items[0].total_price)).toBe(40000);
    expect(orderFlow.recalcOrderTotalsFromActiveLinesInTx).toHaveBeenCalledWith(tx, order, 300);
    expect(order.grand_total).toBe(142800);
    expect(order.remaining_balance).toBe(142800);
  });

  it('the order is locked in the booking store (never another store)', async () => {
    const { service, tx } = build();

    await service.addCharge(12, { product_id: 55, quantity: 1 });

    expect(tx.$queryRaw).toHaveBeenCalledWith(expect.anything(), 300, 3);
    expect(tx.orders.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 300, store_id: 3 } }));
  });

  it('rejects a cancelled or no-show booking', async () => {
    const { service, items } = build({ bookingStatus: 'cancelled' });

    const error = await errorOf(service.addCharge(12, { product_id: 55, quantity: 1 }));

    expect(error.errorCode).toBe(ErrorCodes.BOOKING_CHARGE_001.code);
    expect(items).toHaveLength(0);
  });

  it('rejects a booking without order', async () => {
    const { service } = build({ orderId: null });

    const error = await errorOf(service.addCharge(12, { product_id: 55, quantity: 1 }));

    expect(error.message).toBe('Esta reserva no tiene orden asociada');
  });

  it('rejects an order already paid and closed, or invoiced', async () => {
    for (const options of [{ orderState: 'finished' }, { invoiced: true }]) {
      const { service, items } = build(options);
      const error = await errorOf(service.addCharge(12, { product_id: 55, quantity: 1 }));
      expect(error.message).toBe('La orden de la reserva ya está cerrada o facturada: no admite cargos');
      expect(items).toHaveLength(0);
    }
  });

  it('rejects a product with inventory: it is sold from the POS', async () => {
    const { service, items } = build({ product: { product_type: 'physical', track_inventory: true } });

    const error = await errorOf(service.addCharge(12, { product_id: 55, quantity: 1 }));

    expect(error.message).toBe('"Toalla extra" maneja inventario: véndelo desde el POS');
    expect(items).toHaveLength(0);
  });

  it('rejects a product that does not exist or cannot be sold', async () => {
    const { service } = build({ product: null });

    const error = await errorOf(service.addCharge(12, { product_id: 55, quantity: 1 }));

    expect(error.message).toBe('El producto no existe o no se puede vender');
  });
});
