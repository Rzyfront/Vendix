import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { OrderFlowService, isActualCodTender, isManualConfirmationPending } from './order-flow.service';
import { OrderFlowController } from './order-flow.controller';
import { PERMISSIONS_KEY } from '../../../auth/decorators/permissions.decorator';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { PaymentError, PaymentErrorCodes } from '../../payments/utils/payment-errors';
import { PaymentType } from './dto';
import { Prisma } from '@prisma/client';
import {
  createPrismaMock,
  mockRequestContext,
  PrismaMock,
} from 'src/testing/prisma-mock';
import { buildOrder, buildPayment } from 'src/testing/money-fixtures';

describe('COD settlement tender', () => {
  it('accepts cash, bank transfer and seeded datáfono; rejects COD itself and Stripe card', () => {
    expect(isActualCodTender({ type: 'cash', processing_mode: 'DIRECT' })).toBe(true);
    expect(isActualCodTender({ type: 'bank_transfer', processing_mode: 'ONLINE' })).toBe(true);
    expect(isActualCodTender({ type: 'voucher', processing_mode: 'ONLINE' })).toBe(true);
    expect(isActualCodTender({ type: 'cash_on_delivery', processing_mode: 'ON_DELIVERY' })).toBe(false);
    expect(isActualCodTender({ type: 'card', processing_mode: 'ONLINE' })).toBe(false);
  });
});

describe('OrderFlowService.payOrder — reserva del draft tras el claim POS (E.2)', () => {
  const DTO: any = { store_payment_method_id: 1, payment_type: PaymentType.DIRECT };

  const harness = (
    consumedAtFire = false,
    initialState = 'draft',
    existingPayments: Array<{ state: string; amount: number }> = [],
  ) => {
    let state = initialState;
    const reservations: Array<{ product_id: number; status: string }> = [];
    const events: Array<string> = [];
    const stateUpdates: Array<{ state: string; metadata: Record<string, unknown> }> = [];
    // Compartido entre `tx` y `prismaMock`: `createLegPayments`/`cancelLegPayments`
    // ahora corren dentro de `this.prisma.$transaction(async (tx) => …)`, así
    // que `tx.payments` debe ser el MISMO mock que `prismaMock.payments` (el
    // que otras rutas no transaccionales y las aserciones de los tests leen).
    const paymentsMock: any = {
      create: jest.fn(async () => { events.push('payment'); return { id: 99, gateway_response: {} }; }),
      update: jest.fn(async () => ({ id: 99, state: 'cancelled' })),
      updateMany: jest.fn(async () => ({ count: 1 })),
      // B8/B4 — pre-chequeo de delivered/finished: pagos liquidados.
      count: jest.fn(async () => events.filter((e) => e === 'payment').length),
    };
    const tx: any = {
      $queryRaw: jest.fn(async () => [{ id: 1, state }]),
      orders: {
        findFirst: jest.fn(async () => ({
          id: 1,
          store_id: 4,
          order_items: [{
            product_id: 701,
            product_variant_id: null,
            quantity: 2,
            inventory_consumed_at_fire: consumedAtFire,
            products: { id: 701, track_inventory: true, product_type: 'product' },
          }],
        })),
        update: jest.fn(async ({ data }: any) => { state = data.state; return { id: 1, state }; }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          if (where.state !== state || where.store_id !== 4) return { count: 0 };
          state = data.state;
          return { count: 1 };
        }),
      },
      stock_reservations: {
        findFirst: jest.fn(async () => reservations.find((row) => row.status === 'active') ?? null),
        // Step 4 (no-overselling-stock-guard-plan): promoteDraftToCreated now
        // aggregates already-active quantity per identity instead of an
        // existence-only check. This fixture's single line always demands 2
        // (item.quantity); an existing active row is treated as covering the
        // full demand, matching the old existence-based dedup semantics this
        // harness's tests already assume.
        aggregate: jest.fn(async () => ({
          _sum: {
            quantity: reservations.some((row) => row.status === 'active') ? 2 : 0,
          },
        })),
      },
      payments: paymentsMock,
    };
    const prismaMock: any = {
      $transaction: jest.fn(async (callback: any) => callback(tx)),
      orders: {
        findFirst: jest.fn(async ({ select }: any) => select?.state
          ? { state }
          : { active_financial_split_id: null, delivery_type: 'direct_delivery', shipping_method_id: null, order_items: [{ products: { product_type: 'product' } }] }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          if (where.state?.in && !where.state.in.includes(state)) return { count: 0 };
          if (where.state && typeof where.state === 'string' && where.state !== state) return { count: 0 };
          state = data.state;
          return { count: 1 };
        }),
      },
      stock_reservations: {
        count: jest.fn(async () => reservations.filter((row) => row.status === 'active').length),
      },
      store_payment_methods: { findFirst: jest.fn(async () => ({ id: 1, system_payment_method: { type: 'card' } })) },
      payments: paymentsMock,
    };
    const stock: any = {
      getDefaultLocationForProduct: jest.fn(async () => 11),
      reserveStock: jest.fn(async (...args: any[]) => {
        events.push('reserve');
        reservations.push({ product_id: args[0], status: 'active' });
      }),
      releaseReservation: jest.fn(async (productId: number) => {
        const row = reservations.find((reservation) =>
          reservation.product_id === productId && reservation.status === 'active');
        if (row) row.status = 'consumed';
        events.push('release');
      }),
      // Step 4 — `compensateClaimedDraftPayment` now releases a bounded
      // quantity instead of the whole identity, so it never touches an
      // older reservation on the order.
      releaseReservationQuantity: jest.fn(async (
        _refType: string, _refId: number, productId: number,
        _variantId: number | undefined, _quantity: number, _status: string,
        _tx: any, options?: { newestFirst?: boolean },
      ) => {
        const matching = reservations.filter((reservation) =>
          reservation.product_id === productId && reservation.status === 'active');
        const row = options?.newestFirst ? matching.at(-1) : matching[0];
        if (row) row.status = 'consumed';
        events.push('release');
        return 1;
      }),
    };
    const audit: any = { logCustom: jest.fn(async () => undefined) };
    const service = new OrderFlowService(
      prismaMock, {} as any, {} as any,
      { assertSessionForSales: jest.fn() } as any, {} as any, stock,
      {} as any, {} as any, audit,
    );
    jest.spyOn(service as any, 'getOrder').mockImplementation(async () => ({
      id: 1, state, store_id: 4, customer_id: 44, delivery_type: 'direct_delivery',
      grand_total: 100, currency: 'COP', payments: existingPayments,
    }));
    jest.spyOn(service as any, 'appendFlowMetadata').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'updateOrderState').mockImplementation(async (_id: number, nextState: string, metadata: Record<string, unknown> = {}) => {
      stateUpdates.push({ state: nextState, metadata });
      state = nextState;
      return { id: 1, state, ...metadata };
    });
    jest.spyOn(service as any, 'commitCouponUseForOrder').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'generateTransactionId').mockResolvedValue('TXN-1');
    jest.spyOn(service as any, 'hasPendingKitchenItems').mockResolvedValue(false);
    jest.spyOn(service as any, 'recordPayOrderCashMovement').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'computeAndPersistEta').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'emitPosSaleCompletedIfFullyPaid').mockResolvedValue(undefined);
    return { service, prismaMock, tx, stock, audit, reservations, events, stateUpdates, getState: () => state };
  };

  it('reserva antes del pago, mantiene processing durante el cobro y audita el conteo', async () => {
    const h = harness();
    await h.service.payOrder(1, DTO);
    expect(h.reservations).toHaveLength(1);
    expect(h.events).toEqual(['reserve', 'payment']);
    expect(h.prismaMock.payments.create).toHaveBeenCalledTimes(1);
    const args = h.stock.reserveStock.mock.calls[0];
    expect(args.slice(0, 6)).toEqual([701, undefined, 11, 2, 'order', 1]);
    expect([args[7], args[8], args[10], args[12]]).toEqual([
      true, h.tx, false, false,
    ]);
    expect(h.audit.logCustom).toHaveBeenCalledWith(
      expect.any(Number), 'order.promoted_to_created', expect.anything(),
      expect.objectContaining({ order_id: 1, reservation_count: 1 }), 1,
    );
    expect(h.getState()).toBe('finished');
    expect(h.stock.releaseReservation).not.toHaveBeenCalled();
  });

  it('COD creates a real cash payment, keeps the original COD origin and voids only its pending marker', async () => {
    const marker = {
      id: 51, state: 'pending', amount: 100,
      store_payment_method: {
        system_payment_method: { type: 'cash_on_delivery', processing_mode: 'ON_DELIVERY' },
      },
    };
    const h = harness(false, 'pending_payment', [marker as any]);
    h.prismaMock.store_payment_methods.findFirst.mockResolvedValue({
      id: 1, system_payment_method: { type: 'cash', processing_mode: 'DIRECT', display_name: 'Efectivo' },
    });
    const history = { record: jest.fn().mockResolvedValue({ id: 1 }) };
    (h.service as any).orderHistoryService = history;

    await h.service.payOrder(1, DTO);

    expect(h.prismaMock.payments.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        store_payment_method_id: 1,
        state: 'succeeded',
        gateway_response: expect.objectContaining({
          metadata: expect.objectContaining({
            payment_origin: 'cash_on_delivery',
            original_pending_payment_ids: [51],
          }),
        }),
      }),
    }));
    expect(h.prismaMock.payments.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [51] }, state: 'pending' },
      data: expect.objectContaining({ state: 'cancelled' }),
    });
    expect(history.record).toHaveBeenCalledWith(h.tx, expect.objectContaining({
      type: 'payment_registered',
      payload: expect.objectContaining({
        payment_origin: 'cash_on_delivery',
        actual_store_payment_method_id: 1,
      }),
    }));
  });

  it('mesa draft con propina reserva Wompi una vez y expone el id sin duplicar en un segundo flow/pay', async () => {
    const h = harness();
    const order = {
      id: 1,
      store_id: 4,
      customer_id: 44,
      table_session_id: 55,
      delivery_type: 'dine_in',
      subtotal_amount: 100,
      tax_amount: 0,
      grand_total: 100,
      tip_amount: 0,
      currency: 'COP',
    };
    const payments: any[] = [];
    jest.spyOn(h.service as any, 'getOrder').mockImplementation(async () => ({
      ...order,
      state: h.getState(),
      payments,
    }));
    h.prismaMock.orders.update = jest.fn(async ({ data }: any) => {
      Object.assign(order, data);
      return { ...order };
    });
    h.prismaMock.store_payment_methods.findFirst.mockResolvedValue({
      id: 1,
      system_payment_method: { type: 'wompi', processing_mode: 'ONLINE' },
    });
    h.prismaMock.payments.create.mockImplementation(async ({ data }: any) => {
      const payment = {
        id: 99,
        ...data,
        store_payment_method: {
          system_payment_method: { type: 'wompi' },
        },
      };
      payments.push(payment);
      h.events.push('payment');
      return payment;
    });
    const dto = {
      store_payment_method_id: 1,
      payment_type: PaymentType.ONLINE,
      payment_reference: 'untrusted-client-reference',
      tip_type: 'percentage' as const,
      tip_value: 10,
    };

    const reserved = await h.service.payOrder(1, dto);

    expect(h.prismaMock.orders.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({ tip_amount: 10, grand_total: 110 }),
    });
    expect(h.prismaMock.payments.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        amount: 110,
        state: 'pending',
        gateway_reference: null,
        gateway_response: { payment_type: 'online' },
      }),
    });
    expect(reserved.payment).toEqual({ id: 99, transaction_id: 'TXN-1' });
    expect(h.getState()).toBe('pending_payment');
    expect(h.reservations).toHaveLength(1);
    expect(h.events).toEqual(['reserve', 'payment']);

    const retryError = await h.service.payOrder(1, dto).catch((failure) => failure);
    expect(retryError).toBeInstanceOf(VendixHttpException);
    expect(retryError.errorCode).toBe(ErrorCodes.ORD_FLOW_PAYMENT_FAILED_001.code);
    expect(h.getState()).toBe('pending_payment');
    expect(h.prismaMock.payments.create).toHaveBeenCalledTimes(1);
    expect(h.prismaMock.orders.update).toHaveBeenCalledTimes(1);
    expect(h.reservations).toHaveLength(1);
  });

  it.each([
    ['antes de escribir estado', false],
    ['después de escribir estado (historial)', true],
  ])('reserva digital: fallo %s anula sólo el pending nuevo y restaura el draft', async (_label, stateWritten) => {
    const h = harness();
    h.prismaMock.store_payment_methods.findFirst.mockResolvedValue({
      id: 1,
      system_payment_method: { type: 'wompi', processing_mode: 'ONLINE' },
    });
    h.tx.payments.updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const updateState = (h.service as any).updateOrderState as jest.Mock;
    updateState.mockImplementationOnce(async () => {
      if (stateWritten) {
        await h.prismaMock.orders.updateMany({
          where: { id: 1, state: 'processing' },
          data: { state: 'pending_payment' },
        });
      }
      throw new Error('state/history write failed');
    });

    await expect(h.service.payOrder(1, {
      store_payment_method_id: 1,
      payment_type: PaymentType.ONLINE,
    })).rejects.toThrow('state/history write failed');

    expect(h.tx.payments.updateMany).toHaveBeenCalledWith({
      where: { id: 99, order_id: 1, state: 'pending' },
      data: expect.objectContaining({ state: 'cancelled' }),
    });
    expect(h.getState()).toBe('draft');
    expect(h.reservations.filter((row) => row.status === 'active')).toHaveLength(0);
    expect(h.prismaMock.payments.create).toHaveBeenCalledTimes(1);

    await h.service.payOrder(1, {
      store_payment_method_id: 1,
      payment_type: PaymentType.ONLINE,
    });
    expect(h.getState()).toBe('pending_payment');
    expect(h.reservations.filter((row) => row.status === 'active')).toHaveLength(1);
    expect(h.prismaMock.payments.create).toHaveBeenCalledTimes(2);
  });

  it('si la compensación falla tras escribir pending_payment, el retry no crea otra reserva', async () => {
    const h = harness(false, 'created');
    h.prismaMock.store_payment_methods.findFirst.mockResolvedValue({
      id: 1,
      system_payment_method: { type: 'wompi', processing_mode: 'ONLINE' },
    });
    let reserved: any;
    jest.spyOn(h.service as any, 'getOrder').mockImplementation(async () => ({
      id: 1,
      state: h.getState(),
      store_id: 4,
      customer_id: 44,
      delivery_type: 'direct_delivery',
      grand_total: 100,
      currency: 'COP',
      payments: reserved ? [reserved] : [],
    }));
    h.prismaMock.payments.create.mockImplementation(async ({ data }: any) => {
      reserved = {
        id: 99,
        ...data,
        store_payment_method: { system_payment_method: { type: 'wompi' } },
      };
      return reserved;
    });
    h.tx.payments.updateMany = jest.fn().mockRejectedValue(new Error('cannot cancel pending row'));
    ((h.service as any).updateOrderState as jest.Mock).mockImplementationOnce(async () => {
      await h.prismaMock.orders.updateMany({
        where: { id: 1, state: 'processing' },
        data: { state: 'pending_payment' },
      });
      throw new Error('history failed');
    });
    const dto = { store_payment_method_id: 1, payment_type: PaymentType.ONLINE };

    await expect(h.service.payOrder(1, dto)).rejects.toThrow('history failed');
    expect(h.getState()).toBe('pending_payment');
    expect(reserved.state).toBe('pending');

    const retryError = await h.service.payOrder(1, dto).catch((failure) => failure);
    expect(retryError).toBeInstanceOf(VendixHttpException);
    expect(retryError.errorCode).toBe(ErrorCodes.ORD_FLOW_PAYMENT_FAILED_001.code);
    expect(h.getState()).toBe('pending_payment');
    expect(h.prismaMock.payments.create).toHaveBeenCalledTimes(1);
  });

  it('segundo submit no reserva ni cobra y conserva el 409 tipado', async () => {
    const h = harness();
    await h.service.payOrder(1, DTO);
    const error = await h.service.payOrder(1, DTO).catch((failure) => failure);
    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.errorCode).toBe('ORD_FLOW_PAYMENT_FAILED_001');
    expect(error.getStatus()).toBe(409);
    expect(h.stock.reserveStock).toHaveBeenCalledTimes(1);
    expect(h.prismaMock.payments.create).toHaveBeenCalledTimes(1);
  });

  it('rechaza draft ya pagado después del claim sin reservar ni crear otro pago', async () => {
    const h = harness(false, 'draft', [{ state: 'succeeded', amount: 60 }, { state: 'captured', amount: 40 }]);
    const error = await h.service.payOrder(1, DTO).catch((failure) => failure);
    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.errorCode).toBe('ORD_PAY_ALREADY_PAID_001');
    expect(error.getStatus()).toBe(409);
    expect(h.prismaMock.orders.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ state: 'processing' }),
    }));
    expect(h.prismaMock.payments.create).not.toHaveBeenCalled();
    expect(h.stock.reserveStock).not.toHaveBeenCalled();
    expect(h.stock.releaseReservation).not.toHaveBeenCalled();
    expect(h.getState()).toBe('draft');
  });

  it('rechaza orden created ya pagada y revierte el claim sin crear otro pago', async () => {
    const h = harness(false, 'created', [{ state: 'succeeded', amount: 100 }]);
    const error = await h.service.payOrder(1, DTO).catch((failure) => failure);
    expect(error.errorCode).toBe('ORD_PAY_ALREADY_PAID_001');
    expect(h.prismaMock.payments.create).not.toHaveBeenCalled();
    expect(h.getState()).toBe('created');
  });

  it.each(['created', 'shipped', 'pending_payment'] as const)(
    'método de pago inválido restaura %s tras el claim, sin pago ni finish',
    async (state) => {
      const h = harness(false, state);
      h.prismaMock.store_payment_methods.findFirst.mockResolvedValue(null);

      await expect(h.service.payOrder(1, DTO)).rejects.toMatchObject({
        errorCode: 'ORD_FLOW_PAYMENT_FAILED_001',
        response: expect.objectContaining({
          details: expect.objectContaining({ stage: 'payment_method_not_found' }),
        }),
      });
      expect(h.getState()).toBe(state);
      expect(h.prismaMock.payments.create).not.toHaveBeenCalled();
      expect(h.stateUpdates).toEqual([]);
    },
  );

  it('rechaza orden shipped ya saldada y conserva su estado logístico', async () => {
    const h = harness(false, 'shipped', [{ state: 'captured', amount: 40 }, { state: 'succeeded', amount: 60 }]);
    const error = await h.service.payOrder(1, DTO).catch((failure) => failure);
    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.errorCode).toBe('ORD_PAY_ALREADY_PAID_001');
    expect(error.getStatus()).toBe(409);
    expect(h.prismaMock.payments.create).not.toHaveBeenCalled();
    expect(h.getState()).toBe('shipped');
  });

  it('no reclama processing ni cobra otra vez una orden saldada', async () => {
    const h = harness(false, 'processing', [{ state: 'succeeded', amount: 100 }]);
    const error = await h.service.payOrder(1, DTO).catch((failure) => failure);
    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.getStatus()).toBe(409);
    expect(error.errorCode).toBe('ORD_FLOW_PAYMENT_FAILED_001');
    expect(h.prismaMock.payments.create).not.toHaveBeenCalled();
    expect(h.getState()).toBe('processing');
  });

  it('dos flow/pay concurrentes sobre created crean solo un pago', async () => {
    const h = harness(false, 'created');
    const results = await Promise.allSettled([
      h.service.payOrder(1, DTO),
      h.service.payOrder(1, DTO),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected).toMatchObject({
      reason: expect.objectContaining({ errorCode: 'ORD_FLOW_PAYMENT_FAILED_001' }),
    });
    expect(h.prismaMock.payments.create).toHaveBeenCalledTimes(1);
    expect(h.getState()).toBe('finished');
  });

  it('permite un abono parcial y cobra solo el saldo pendiente', async () => {
    const h = harness(false, 'created', [{ state: 'succeeded', amount: 40 }]);
    const result = await h.service.payOrder(1, DTO);
    expect(h.prismaMock.payments.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ amount: 60, state: 'succeeded' }),
    }));
    expect(h.stateUpdates).toContainEqual({
      state: 'finished',
      metadata: expect.objectContaining({ total_paid: 100, remaining_balance: 0 }),
    });
    expect(result.order).toEqual(expect.objectContaining({ total_paid: 100, remaining_balance: 0 }));
    expect(h.getState()).toBe('finished');
  });

  it('restaura shipped y proyecta el saldo al cobrar el remanente', async () => {
    const h = harness(false, 'shipped', [{ state: 'captured', amount: 40 }]);
    h.prismaMock.orders.findFirst.mockImplementation(async () => ({
      id: 1, state: h.getState(), total_paid: 100, remaining_balance: 0,
    }));
    const result = await h.service.payOrder(1, DTO);
    expect(h.prismaMock.payments.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ amount: 60, state: 'succeeded' }),
    }));
    expect(h.stateUpdates).toContainEqual({
      state: 'shipped',
      metadata: { total_paid: 100, remaining_balance: 0 },
    });
    expect(result.order).toEqual(expect.objectContaining({ total_paid: 100, remaining_balance: 0 }));
    expect(h.getState()).toBe('shipped');
  });

  it('B1b: cobra una orden delivered, la deja delivered saldada y NO emite la factura POS (se emite al finalizar)', async () => {
    const h = harness(false, 'delivered', [{ state: 'succeeded', amount: 40 }]);
    h.prismaMock.orders.findFirst.mockImplementation(async () => ({
      id: 1, state: h.getState(), total_paid: 100, remaining_balance: 0,
    }));

    const result = await h.service.payOrder(1, DTO);

    expect(h.prismaMock.payments.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ amount: 60, state: 'succeeded' }),
    }));
    // Settles money on `delivered` — never advances to `finished` (that is
    // `confirmDelivery`/`finishOrder`'s job, not `payOrder`'s).
    expect(h.stateUpdates).toContainEqual({
      state: 'delivered',
      metadata: expect.objectContaining({ total_paid: 100, remaining_balance: 0 }),
    });
    expect(h.stateUpdates.some((u) => u.state === 'finished')).toBe(false);
    expect((h.service as any).emitPosSaleCompletedIfFullyPaid).not.toHaveBeenCalled();
    expect(result.order).toEqual(expect.objectContaining({ total_paid: 100, remaining_balance: 0 }));
    expect(h.getState()).toBe('delivered');
  });

  it('consumo previo en cocina evita reservar el plato otra vez', async () => {
    const h = harness(true);
    await h.service.payOrder(1, DTO);
    expect(h.stock.reserveStock).not.toHaveBeenCalled();
    expect(h.prismaMock.payments.create).toHaveBeenCalledTimes(1);
  });

  it('suma dos líneas del mismo producto y reserva solo la diferencia pendiente', async () => {
    const h = harness();
    h.tx.orders.findFirst.mockResolvedValueOnce({
      id: 1,
      store_id: 4,
      order_items: [
        { product_id: 701, product_variant_id: null, quantity: 2,
          products: { id: 701, name: 'MODELO', track_inventory: true, product_type: 'physical' } },
        { product_id: 701, product_variant_id: null, quantity: 3,
          products: { id: 701, name: 'MODELO', track_inventory: true, product_type: 'physical' } },
      ],
    });
    h.tx.stock_reservations.aggregate.mockResolvedValueOnce({ _sum: { quantity: 2 } });
    const validator = {
      assertLinesAvailable: jest.fn().mockResolvedValue([]),
      // docs/plans/no-overselling-stock-guard-plan.md step 9 — strict
      // default (allowOversell=false) preserves this assertion byte-for-byte.
      resolveInventoryPolicy: jest.fn().mockResolvedValue({
        allowOversell: false,
        allowIngredientOveruse: true,
      }),
    };
    (h.service as any).stockValidator = validator;

    await h.service.payOrder(1, DTO);

    expect(validator.assertLinesAvailable).toHaveBeenCalledWith(
      [expect.objectContaining({ product_id: 701, quantity: 5 })],
      { orderId: 1, tx: h.tx, allowOversell: false },
    );
    expect(h.stock.reserveStock).toHaveBeenCalledTimes(1);
    expect(h.stock.reserveStock.mock.calls[0][3]).toBe(3);
  });

  it('promoción del borrador reparte el top-up entre bodegas vendibles', async () => {
    const h = harness();
    (h.service as any).sellableStockAllocator = {
      allocateForLine: jest.fn().mockResolvedValue({
        slices: [{ location_id: 11, quantity: 1 }, { location_id: 12, quantity: 1 }],
        allocated: 2, available: 2, shortfall: 0,
      }),
    };

    await h.service.payOrder(1, DTO);

    expect(h.stock.reserveStock).toHaveBeenCalledTimes(2);
    expect(h.stock.reserveStock.mock.calls.map((args: any[]) => [args[2], args[3]]))
      .toEqual([[11, 1], [12, 1]]);
  });

  it('faltante al promover bloquea antes de reservar o crear el pago', async () => {
    const h = harness();
    (h.service as any).stockValidator = {
      assertLinesAvailable: jest.fn().mockRejectedValue(
        new VendixHttpException(ErrorCodes.INV_STOCK_INSUFFICIENT_LINES,
          'Stock insuficiente para MODELO', { items: [{ product_name: 'MODELO', requested: 2, available: 0 }] }),
      ),
      // docs/plans/no-overselling-stock-guard-plan.md step 9 — strict
      // default (allowOversell=false): the guard above still throws.
      resolveInventoryPolicy: jest.fn().mockResolvedValue({
        allowOversell: false,
        allowIngredientOveruse: true,
      }),
    };

    const error = await h.service.payOrder(1, DTO).catch((failure) => failure);
    expect(error.errorCode).toBe('ORD_FLOW_PAYMENT_FAILED_001');
    expect(error.getResponse()).toMatchObject({ details: {
      cause_code: 'INV_STOCK_INSUFFICIENT_LINES',
      items: [expect.objectContaining({ product_name: 'MODELO' })],
    } });
    expect(h.stock.reserveStock).not.toHaveBeenCalled();
    expect(h.prismaMock.payments.create).not.toHaveBeenCalled();
  });

  it('si falla la infraestructura de reserva, no cobra y restaura el draft', async () => {
    const h = harness();
    h.stock.reserveStock.mockRejectedValueOnce(new Error('db unavailable'));
    const error = await h.service.payOrder(1, DTO).catch((failure) => failure);
    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.errorCode).toBe('ORD_FLOW_PAYMENT_FAILED_001');
    expect(h.prismaMock.payments.create).not.toHaveBeenCalled();
    expect(h.reservations).toHaveLength(0);
    expect(h.getState()).toBe('draft');
  });

  it('método de pago inexistente libera solo la reserva del draft y restaura claim', async () => {
    const h = harness();
    h.prismaMock.store_payment_methods.findFirst.mockResolvedValueOnce(null);
    const error = await h.service.payOrder(1, DTO).catch((failure) => failure);
    expect(error.errorCode).toBe('ORD_FLOW_PAYMENT_FAILED_001');
    expect(h.prismaMock.payments.create).not.toHaveBeenCalled();
    expect(h.stock.releaseReservationQuantity).toHaveBeenCalledWith(
      'order', 1, 701, undefined, 2, 'cancelled', h.tx,
      { newestFirst: true },
    );
    expect(h.reservations[0].status).toBe('consumed');
    expect(h.getState()).toBe('draft');
  });

  it('efectivo corto libera y restaura sin crear pago', async () => {
    const h = harness();
    h.prismaMock.store_payment_methods.findFirst.mockResolvedValueOnce({
      id: 1, system_payment_method: { type: 'cash' },
    });
    const error = await h.service.payOrder(1, { ...DTO, amount_received: 50 }).catch((failure) => failure);
    // PLAN-pago-multimetodo-pendientes paso 3 — el efectivo corto lo rechaza
    // el normalizador (`PAY_MULTI_TENDER_CASH_INSUFFICIENT`, rechazo de
    // VALIDACIÓN de payload) y se relanza SIN envolver: 400 de superficie,
    // ya NO el 409 `ORD_FLOW_PAYMENT_FAILED_001`. La restauración (liberar la
    // reserva del draft) es igual para cualquier error, sin depender del código.
    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.errorCode).toBe('PAY_MULTI_TENDER_CASH_INSUFFICIENT');
    expect(error.getStatus()).toBe(400);
    expect(h.prismaMock.payments.create).not.toHaveBeenCalled();
    expect(h.stock.releaseReservationQuantity).toHaveBeenCalledTimes(1);
    expect(h.reservations[0].status).toBe('consumed');
    expect(h.getState()).toBe('draft');
  });

  it('fallo al crear el pago libera la reserva y mantiene el draft cobrable', async () => {
    const h = harness();
    h.prismaMock.payments.create.mockRejectedValueOnce(new Error('payment db unavailable'));
    await expect(h.service.payOrder(1, DTO)).rejects.toThrow('payment db unavailable');
    expect(h.stock.releaseReservationQuantity).toHaveBeenCalledTimes(1);
    expect(h.reservations[0].status).toBe('consumed');
    expect(h.getState()).toBe('draft');
  });

  it('finish bloqueado compensa el pago y libera la reserva nueva', async () => {
    const h = harness();
    jest.spyOn(h.service as any, 'updateOrderState').mockRejectedValueOnce(
      new VendixHttpException(ErrorCodes.INV_STOCK_002),
    );
    const error = await h.service.payOrder(1, DTO).catch((failure) => failure);
    expect(error.errorCode).toBe('ORD_FLOW_PAYMENT_FAILED_001');
    expect(h.prismaMock.payments.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 99 }, data: expect.objectContaining({ state: 'cancelled' }),
    }));
    expect(h.stock.releaseReservationQuantity).toHaveBeenCalledTimes(1);
    expect(h.reservations[0].status).toBe('consumed');
    expect(h.getState()).toBe('draft');
  });

  it('B13 — cocina pendiente en cobro directo: conserva el pago y deja la orden en processing', async () => {
    const h = harness();
    jest.spyOn(h.service as any, 'hasPendingKitchenItems').mockResolvedValueOnce(true);
    jest.spyOn(h.service as any, 'projectPaidOrderToTable').mockResolvedValue(undefined);
    await h.service.payOrder(1, DTO);
    expect(h.prismaMock.payments.create).toHaveBeenCalledTimes(1);
    expect(h.prismaMock.payments.update).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ state: 'cancelled' }),
    }));
    expect(h.getState()).toBe('processing');
    expect(h.stateUpdates.at(-1)?.metadata).toEqual(expect.objectContaining({ paid_at: expect.any(Date) }));
  });

  it('cocina pendiente en modo estricto (fastTrackOrder) cancela el pago y libera la reserva nueva', async () => {
    const h = harness();
    jest.spyOn(h.service as any, 'hasPendingKitchenItems').mockResolvedValueOnce(true);
    const error = await h.service
      .payOrder(1, DTO, { strictKitchenPending: true })
      .catch((failure) => failure);
    expect(error.errorCode).toBe('ORD_FLOW_PAYMENT_FAILED_001');
    expect(h.prismaMock.payments.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 99 }, data: expect.objectContaining({ state: 'cancelled' }),
    }));
    expect(h.stock.releaseReservationQuantity).toHaveBeenCalledTimes(1);
    expect(h.reservations[0].status).toBe('consumed');
    expect(h.getState()).toBe('draft');
  });

  it('no libera una reserva activa que ya existía antes de promover el draft', async () => {
    const h = harness();
    h.reservations.push({ product_id: 701, status: 'active' });
    h.prismaMock.store_payment_methods.findFirst.mockResolvedValueOnce(null);
    await h.service.payOrder(1, DTO).catch(() => undefined);
    expect(h.stock.reserveStock).not.toHaveBeenCalled();
    expect(h.stock.releaseReservation).not.toHaveBeenCalled();
    expect(h.reservations[0].status).toBe('active');
    expect(h.getState()).toBe('draft');
  });

  it('al compensar un top-up conserva la reserva anterior y libera sólo la nueva', async () => {
    const h = harness();
    h.reservations.push({ product_id: 701, status: 'active' });
    h.tx.orders.findFirst.mockResolvedValueOnce({
      id: 1, store_id: 4,
      order_items: [{ product_id: 701, product_variant_id: null, quantity: 5,
        products: { id: 701, name: 'MODELO', track_inventory: true, product_type: 'physical' } }],
    });
    h.prismaMock.store_payment_methods.findFirst.mockResolvedValueOnce(null);

    await expect(h.service.payOrder(1, DTO)).rejects.toMatchObject({
      errorCode: 'ORD_FLOW_PAYMENT_FAILED_001',
    });

    expect(h.stock.reserveStock.mock.calls[0][3]).toBe(3);
    expect(h.stock.releaseReservationQuantity).toHaveBeenCalledWith(
      'order', 1, 701, undefined, 3, 'cancelled', h.tx, { newestFirst: true },
    );
    expect(h.reservations[0].status).toBe('active');
    expect(h.reservations[1].status).toBe('consumed');
  });

  it('ERR-33 postcommit conserva el pago succeeded y la reserva activa', async () => {
    const h = harness();
    jest.spyOn(h.service as any, 'projectPaidOrderToTable').mockRejectedValueOnce(
      new VendixHttpException(ErrorCodes.POS_TABLE_SESSION_PROJECTION_FAILED_001),
    );
    const error = await h.service.payOrder(1, DTO).catch((failure) => failure);
    expect(error.errorCode).toBe('POS_TABLE_SESSION_PROJECTION_FAILED_001');
    expect(h.prismaMock.payments.create).toHaveBeenCalledTimes(1);
    expect(h.prismaMock.payments.update).not.toHaveBeenCalled();
    expect(h.stock.releaseReservation).not.toHaveBeenCalled();
    expect(h.reservations[0].status).toBe('active');
    expect(h.getState()).toBe('finished');
  });

  it('la promoción independiente de mesa/split sigue dejando created', async () => {
    const h = harness();
    const promoted = await (h.service as any).promoteDraftToCreated(1, 4);
    expect(promoted).toBe(true);
    expect(h.getState()).toBe('created');
    expect(h.reservations).toHaveLength(1);
    expect(h.prismaMock.payments.create).not.toHaveBeenCalled();
  });

  // no-overselling-stock-guard-plan.md, BUG 1 (2026-09-26): la misma clase
  // de defecto que en `payments.service.ts` — el bucle de `groups` sólo
  // excluía `inventory_consumed_at_fire` (cocina) y los platos que van a
  // KDS, nunca una línea ya ENTREGADA (`inventory_committed=true`, stock ya
  // descontado por `commitOrderLines`, reserva ya consumida) ni una línea
  // CANCELADA (reserva ya liberada por `cancelOrderItem`). Una mesa con
  // ambas volvía a demandarlas al promover el draft a `created` (justo
  // antes de cobrar) y podía 409 con `INV_STOCK_INSUFFICIENT_LINES` aunque
  // el faltante real fuera cero — no queda nada que reclamar de ninguna de
  // las dos.
  it('BUG 1: una línea entregada o cancelada no se re-demanda ni se re-reserva al promover el draft', async () => {
    const tx: any = {
      $queryRaw: jest.fn(async () => [{ id: 1, state: 'draft' }]),
      orders: {
        findFirst: jest.fn(async () => ({
          id: 1,
          store_id: 4,
          order_items: [
            {
              product_id: 701, product_variant_id: null, quantity: 5,
              inventory_committed: true, cancelled_at: null,
              products: { id: 701, name: 'MODELO', track_inventory: true, product_type: 'physical' },
            },
            {
              product_id: 702, product_variant_id: null, quantity: 3,
              inventory_committed: false, cancelled_at: new Date(),
              products: { id: 702, name: 'OTRO', track_inventory: true, product_type: 'physical' },
            },
          ],
        })),
        update: jest.fn(async ({ data }: any) => ({ id: 1, state: data.state })),
      },
      stock_reservations: { aggregate: jest.fn(async () => ({ _sum: { quantity: 0 } })) },
    };
    const prisma: any = { $transaction: jest.fn(async (cb: any) => cb(tx)) };
    const stockLevelManager: any = {
      reserveStock: jest.fn(),
      getDefaultLocationForProduct: jest.fn().mockResolvedValue(11),
    };
    // Sonda: si el fix no excluyera las dos líneas ya asentadas, `groups`
    // llegaría con demanda > 0 y este mock rechazaría con el mismo 409 que
    // produciría un stock realmente en 0.
    const assertLinesAvailable = jest.fn().mockImplementation((lines: any[]) => {
      if (lines.length > 0) {
        throw new VendixHttpException(
          ErrorCodes.INV_STOCK_INSUFFICIENT_LINES,
          'Stock insuficiente',
          {
            items: lines.map((l: any) => ({
              product_name: l.product_name, requested: l.quantity, available: 0,
            })),
          },
        );
      }
      return Promise.resolve([]);
    });
    const stockValidator: any = {
      resolveInventoryPolicy: jest.fn().mockResolvedValue({
        allowOversell: false, allowIngredientOveruse: true,
      }),
      assertLinesAvailable,
    };
    const audit: any = { logCustom: jest.fn() };

    const service = new OrderFlowService(
      prisma, {} as any, {} as any, {} as any, {} as any,
      stockLevelManager, {} as any, {} as any, audit,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      stockValidator,
    );
    jest.spyOn(service as any, 'updateOrderState').mockResolvedValue(undefined);

    const promoted = await (service as any).promoteDraftToCreated(1, 4);

    expect(promoted).toBe(true);
    expect(assertLinesAvailable).not.toHaveBeenCalled();
    expect(stockLevelManager.reserveStock).not.toHaveBeenCalled();
  });
});

describe('OrderFlowService.confirmDelivery — platos pendientes (E.4)', () => {
  const pendingItems = [
    { order_item_id: 11, status: 'ready', quantity: 2, variant_label: 'Grande', order_item: { product_name: 'Hamburguesa' } },
    { order_item_id: 12, status: 'in_preparation', quantity: 1, variant_label: null, order_item: { product_name: 'Papas' } },
  ];

  const harness = (state: string, items: typeof pendingItems) => {
    const prisma: any = {
      kitchen_ticket_items: { findMany: jest.fn().mockResolvedValue(items) },
      order_items: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new OrderFlowService(
      prisma, {} as any, {} as any, {} as any, {} as any,
      {} as any, {} as any, {} as any, {} as any,
    );
    jest.spyOn(service as any, 'getOrder').mockResolvedValue({ id: 1, state });
    const updateState = jest.spyOn(service as any, 'updateOrderState')
      .mockResolvedValue({ id: 1, state: 'finished' });
    return { service, prisma, updateState };
  };

  it.each(['processing', 'delivered'])(
    'rechaza finalizar desde %s con lista de platos accionable',
    async (state) => {
      const { service, prisma, updateState } = harness(state, pendingItems);
      await expect(service.confirmDelivery(1)).rejects.toMatchObject({
        errorCode: 'ORDER_HAS_PENDING_KITCHEN_ITEMS',
        response: expect.objectContaining({
          details: {
            pending_items: [
              { order_item_id: 11, product_name: 'Hamburguesa', variant_label: 'Grande', quantity: 2, status: 'ready' },
              { order_item_id: 12, product_name: 'Papas', variant_label: null, quantity: 1, status: 'in_preparation' },
            ],
          },
        }),
      });
      expect(prisma.kitchen_ticket_items.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { kitchen_ticket: { order_id: 1 }, status: { notIn: ['delivered', 'cancelled'] } },
      }));
      expect(updateState).not.toHaveBeenCalled();
    },
  );

  it.each(['processing', 'delivered'])(
    'finaliza desde %s cuando no quedan platos pendientes',
    async (state) => {
      const { service, updateState } = harness(state, []);
      await expect(service.confirmDelivery(1)).resolves.toMatchObject({ state: 'finished' });
      expect(updateState).toHaveBeenCalledWith(1, 'finished', expect.objectContaining({ finished_at: expect.any(Date) }));
    },
  );

  it('no consulta cocina ni muta un estado no finalizable', async () => {
    const { service, prisma, updateState } = harness('refunded', pendingItems);
    await expect(service.confirmDelivery(1)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.kitchen_ticket_items.findMany).not.toHaveBeenCalled();
    expect(updateState).not.toHaveBeenCalled();
  });
});

/**
 * Regresión de la compensación de pago en {@link OrderFlowService.payOrder}
 * rama `direct → finished` (POS).
 *
 * El pago (`state:'succeeded'`) se crea ANTES del finish. Si el finish bloquea
 * por stock insuficiente (`INV_STOCK_002`) o seriales faltantes
 * (`SERIAL_REQUIRED_001`), la orden queda `created` y ese pago quedaría
 * HUÉRFANO. Regla de negocio (confirmada): mantener + compensar → anular el
 * pago (`state:'cancelled'` + razón, preservando auditoría) y propagar el 409.
 *
 * El guard de cocina (`ORDER_HAS_PENDING_KITCHEN_ITEMS`) NO compensa: ahí
 * retener el pago es intencional. La compensación es exclusiva del throw de
 * `updateOrderState('finished')`.
 */
describe('OrderFlowService — compensación de pago POS cuando el finish bloquea', () => {
  let service: OrderFlowService;
  let prismaMock: any;
  let projectTablePayment: jest.Mock;

  const buildOrder = () => ({
    id: 1,
    state: 'created',
    delivery_type: 'direct_delivery', // → requiresFulfillment=false → intenta finished
    grand_total: 4000,
    currency: 'COP',
    store_id: 4,
  });

  const DTO: any = { store_payment_method_id: 1, payment_type: PaymentType.DIRECT };

  const CREATED_PAYMENT = {
    id: 999,
    gateway_response: { payment_type: 'direct' },
  };

  beforeEach(() => {
    projectTablePayment = jest.fn().mockResolvedValue(null);
    prismaMock = {
      store_payment_methods: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 1, system_payment_method: { type: 'card' } }),
      },
      payments: {
        create: jest.fn().mockResolvedValue(CREATED_PAYMENT),
        update: jest.fn().mockResolvedValue({}),
      },
      // Round 1 MAJOR #13: payOrder ahora llama commitCouponUseForOrder
      // después de cada pago creado. La orden mockeada (buildOrder) NO trae
      // `coupon_id`, así que el primer findFirst devuelve `null` y el método
      // retorna sin tocar cupones. Mock explícito para evitar TypeErrors.
      orders: {
        findFirst: jest.fn().mockResolvedValue(null),
        // Fix v2 (race-claim FB-10): `payOrder` reclama la orden con
        // `orders.updateMany` ANTES de leerla. Sin este mock el describe
        // cae con `updateMany is not a function` (roto desde el PR que metió
        // el claim, sin relación con el seam cancelOrderItem). `count: 1`
        // = la orden era pagable y el flujo sigue a la rama que el test
        // espía (`updateOrderState`).
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      // CP-POS-MODAL-SCOPE-001 / C.4: `payOrder` exige cliente salvo escape
      // hatch `pos.allow_anonymous_sales`. La orden mockeada no trae
      // `customer_id`; sin este mock el describe cae con
      // `store_settings.findFirst is not a function` (misma staleness que
      // el claim de arriba). Se permite anónimo para preservar la ruta que
      // el test ejercita desde su creación.
      store_settings: {
        findFirst: jest.fn().mockResolvedValue({
          settings: { pos: { allow_anonymous_sales: true } },
        }),
      },
      coupon_uses: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      coupons: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    // `createLegPayments`/`cancelLegPayments` corren dentro de
    // `this.prisma.$transaction(async (tx) => …)`; el mock resuelve el
    // callback contra el mismo `prismaMock`, así que `tx.payments` es el
    // mock que estos tests ya assertan sobre `prismaMock.payments`.
    prismaMock.$transaction = jest.fn(async (callback: any) => callback(prismaMock));

    // 9 args del constructor (incluye AuditService — F.2). Sólo `prisma`
    // se ejercita directamente; el resto se espía o no se alcanza en la
    // rama de bloqueo.
    service = new OrderFlowService(
      prismaMock as unknown as StorePrismaService,
      {} as any,
      {} as any,
      { assertSessionForSales: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { logCustom: jest.fn().mockResolvedValue(undefined) } as any,
      undefined,
      undefined,
      { get: jest.fn(() => ({ projectOrderPaymentToTableSession: projectTablePayment })) } as any,
    );

    // Aísla la rama: métodos privados/colaboradores reducidos a stubs.
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(buildOrder());
    jest
      .spyOn(service as any, 'generateTransactionId')
      .mockResolvedValue('TXN-1');
    jest
      .spyOn(service as any, 'hasPendingKitchenItems')
      .mockResolvedValue(false);
    jest.spyOn(service as any, 'validateTransition').mockReturnValue(undefined);
    jest
      .spyOn(service as any, 'recordPayOrderCashMovement')
      .mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'computeAndPersistEta')
      .mockResolvedValue(undefined);
  });

  it('finish → INV_STOCK_002: anula el pago succeeded y re-lanza el 409', async () => {
    jest
      .spyOn(service as any, 'updateOrderState')
      .mockRejectedValue(new VendixHttpException(ErrorCodes.INV_STOCK_002));

    await expect(service.payOrder(1, DTO)).rejects.toBeInstanceOf(
      VendixHttpException,
    );

    // Pago creado y luego anulado con razón de auditoría → sin pago huérfano.
    expect(prismaMock.payments.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.payments.update).toHaveBeenCalledWith({
      where: { id: 999 },
      data: expect.objectContaining({
        state: 'cancelled',
        gateway_response: expect.objectContaining({
          cancellation_reason: 'finish_blocked_insufficient_stock',
        }),
      }),
    });
  });

  it('finish OK: NO anula el pago', async () => {
    jest
      .spyOn(service as any, 'updateOrderState')
      .mockResolvedValue({ id: 1, state: 'finished' });

    await service.payOrder(1, DTO);

    expect(prismaMock.payments.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.payments.update).not.toHaveBeenCalled();
    expect(projectTablePayment).toHaveBeenCalledWith(1, 999);
  });

  it('E.6 flow/pay: 10% usa productos brutos, suma propina al cargo sin gravarla', async () => {
    const orderRow = {
      ...buildOrder(), customer_id: 44, subtotal_amount: 100000,
      tax_amount: 19000, discount_amount: 2000, shipping_cost: 5000,
      grand_total: 122000, tip_amount: 0,
      payments: [],
    };
    jest.spyOn(service as any, 'getOrder').mockImplementation(async () => ({ ...orderRow }));
    prismaMock.orders.update = jest.fn(async ({ data }: any) => {
      Object.assign(orderRow, data);
      return { ...orderRow };
    });
    jest.spyOn(service as any, 'updateOrderState')
      .mockResolvedValue({ id: 1, state: 'finished' });

    await service.payOrder(1, {
      ...DTO, tip_type: 'percentage', tip_value: 10,
    });

    expect(prismaMock.orders.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        tip_amount: 11900, tip_type: 'fixed', tip_value: 11900,
        grand_total: 133900,
      }),
    }));
    expect(orderRow.subtotal_amount).toBe(100000);
    expect(orderRow.tax_amount).toBe(19000);
    expect(prismaMock.payments.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ amount: 133900, state: 'succeeded' }),
    }));
  });

  it('proyección falla post-commit: conserva el pago y responde ERR-33 tipado (409)', async () => {
    jest.spyOn(service as any, 'updateOrderState').mockResolvedValue({ id: 1, state: 'finished' });
    projectTablePayment.mockRejectedValue(new Error('mesa cerrada'));

    const error = await service.payOrder(1, DTO).catch((failure) => failure);
    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.errorCode).toBe(ErrorCodes.POS_TABLE_SESSION_PROJECTION_FAILED_001.code);
    expect(error.getStatus()).toBe(409);
    expect(prismaMock.payments.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.payments.update).not.toHaveBeenCalled();
    expect(projectTablePayment).toHaveBeenCalledWith(1, 999);
  });
});

/** D.1 — la reversa de cocina devuelve consumos reales del ítem, no el plato vendido. */
describe('OrderFlowService.cancelOrder — kitchenDisposition y reversa de hojas BOM', () => {
  const ORDER_ID = 8101;
  const ITEM_ID = 8102;
  const TICKET_ID = 8103;
  const reason = '  cliente canceló el plato  ';

  const firedItem = (status: 'pending' | 'in_preparation' | 'ready') => ({
    id: ITEM_ID,
    inventory_consumed_at_fire: true,
    cancelled_at: null,
    products: { product_type: 'prepared' },
    kitchen_ticket_items: [{
      kitchen_ticket_id: TICKET_ID,
      kitchen_ticket: { id: TICKET_ID, status },
    }],
  });

  const buildKitchenHarness = (
    status: 'pending' | 'in_preparation' | 'ready',
    consumptions: Array<{
      product_id: number;
      product_variant_id: number | null;
      quantity_change: number;
    }> = [],
  ) => {
    const prismaMock = createPrismaMock({
      orders: ['updateMany', 'update'],
      order_items: ['findMany', 'update'],
      inventory_transactions: ['findMany'],
      kitchen_tickets: ['findFirst', 'updateMany'],
      kitchen_ticket_items: ['findFirst', 'findMany', 'updateMany'],
      invoices: ['findMany', 'findFirst'],
      accounts_receivable: ['findMany', 'update'],
      order_installments: ['updateMany'],
      audit_logs: ['findFirst', 'create'],
      inventory_cost_layers: ['create'],
    });
    prismaMock.invoices.findMany.mockResolvedValue([]);
    prismaMock.accounts_receivable.findMany.mockResolvedValue([]);
    prismaMock.$queryRaw = jest.fn().mockResolvedValue([{ id: ORDER_ID, state: 'processing' }]);
    prismaMock.orders.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.orders.update.mockResolvedValue({ id: ORDER_ID, store_id: 100, state: 'cancelled' });
    prismaMock.order_items.findMany.mockResolvedValue([firedItem(status)]);
    prismaMock.order_items.update.mockResolvedValue({});
    prismaMock.inventory_transactions.findMany.mockResolvedValue(consumptions);
    prismaMock.audit_logs.findFirst.mockResolvedValue(null);
    prismaMock.audit_logs.create.mockResolvedValue({ id: 1 });
    prismaMock.inventory_cost_layers.create.mockResolvedValue({ id: 1 });
    prismaMock.kitchen_tickets.findFirst.mockResolvedValue({ status });
    prismaMock.kitchen_ticket_items.findFirst.mockResolvedValue(null);
    prismaMock.kitchen_ticket_items.findMany.mockResolvedValue([]);

    const stock = {
      getDefaultLocationForProduct: jest.fn().mockImplementation(
        async (productId: number, variantId?: number) => {
          if (productId === 701 && variantId === undefined) return 11;
          if (productId === 702 && variantId === 91) return 22;
          if (productId === 703 && variantId === undefined) return 33;
          throw new Error(`Unexpected leaf/location lookup ${productId}/${variantId}`);
        },
      ),
      updateStock: jest.fn().mockResolvedValue({}),
      releaseReservationsByReference: jest.fn().mockResolvedValue(undefined),
    };
    const kds = {
      cancelTicketItemInTx: jest.fn().mockResolvedValue('cancelled'),
      emitTicketCancelledEvent: jest.fn().mockResolvedValue(undefined),
    };
    const emitter = { emit: jest.fn(), emitAsync: jest.fn().mockResolvedValue([]) };
    const service = new OrderFlowService(
      prismaMock as unknown as StorePrismaService,
      emitter as any,
      {} as any,
      {} as any,
      {} as any,
      stock as any,
      {} as any,
      {} as any,
      { logCustom: jest.fn().mockResolvedValue(undefined) } as any,
      kds as any,
    );
    jest.spyOn(service, 'getOrder').mockResolvedValue(buildOrder({
      id: ORDER_ID,
      state: 'processing',
      internal_notes: null,
      payments: [],
      order_items: [{ id: ITEM_ID, inventory_consumed_at_fire: true }],
    }) as any);
    return { service, prismaMock, stock, kds, emitter };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockRequestContext({ store_id: 100, organization_id: 1, user_id: 7 });
  });

  it('kitchenDisposition reuse: devuelve exactamente las tres hojas consumidas, con signo absoluto y ubicación por variante', async () => {
    // Tres transacciones del ítem (una hoja variante) deliberadamente distintas
    // del producto preparado vendido; los valores esperados NO salen del mock.
    const { service, prismaMock, stock, kds, emitter } = buildKitchenHarness('in_preparation', [
      { product_id: 701, product_variant_id: null, quantity_change: -2.5 },
      { product_id: 702, product_variant_id: 91, quantity_change: -1.25 },
      { product_id: 703, product_variant_id: null, quantity_change: -4 },
    ]);

    await expect(service.cancelOrder(ORDER_ID, { reason, kitchenDisposition: 'reuse' }))
      .resolves.toMatchObject({ state: 'cancelled' });

    expect(prismaMock.inventory_transactions.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.inventory_transactions.findMany).toHaveBeenCalledWith({
      where: { order_item_id: ITEM_ID, quantity_change: { lt: 0 } },
      select: { id: true, product_id: true, product_variant_id: true, quantity_change: true, unit_cost: true, total_cost: true },
    });
    expect(stock.getDefaultLocationForProduct.mock.calls).toEqual([
      [701, undefined], [702, 91], [703, undefined],
    ]);
    expect(stock.updateStock).toHaveBeenCalledTimes(3);
    const expectedReturns = [
      { product_id: 701, variant_id: undefined, location_id: 11, quantity_change: 2.5 },
      { product_id: 702, variant_id: 91, location_id: 22, quantity_change: 1.25 },
      { product_id: 703, variant_id: undefined, location_id: 33, quantity_change: 4 },
    ];
    expectedReturns.forEach((leaf, index) => {
      const [movement, tx] = stock.updateStock.mock.calls[index];
      expect(movement).toMatchObject({
        ...leaf,
        movement_type: 'return',
        source_module: 'order_item_cancellation',
        create_movement: true,
        validate_availability: false,
        allow_negative: true,
      });
      expect(movement.reason).toContain(`orden #${ORDER_ID} ítem #${ITEM_ID}`);
      expect(movement).not.toHaveProperty('order_item_id');
      expect(tx).toBe(prismaMock);
    });
    expect(prismaMock.order_items.update).toHaveBeenCalledWith({
      where: { id: ITEM_ID },
      data: expect.objectContaining({
        cancellation_type: 'after_fire_reused',
        cancellation_reason: 'cliente canceló el plato',
      }),
    });
    expect(prismaMock.order_items.update.mock.calls[0][0].data)
      .not.toHaveProperty('inventory_consumed_at_fire');
    expect(kds.cancelTicketItemInTx).not.toHaveBeenCalled();
    expect(emitter.emit).toHaveBeenCalledWith('order.status_changed', expect.objectContaining({
      order_id: ORDER_ID, new_state: 'cancelled',
    }));
  });

  it('kitchenDisposition waste: registra el costo consumido para reclasificar sin devolver stock', async () => {
    const { service, prismaMock, stock, kds } = buildKitchenHarness('ready', [
      { product_id: 701, product_variant_id: null, quantity_change: -2.5 },
      { product_id: 702, product_variant_id: 91, quantity_change: -1.25 },
    ]);

    await expect(service.cancelOrder(ORDER_ID, { reason, kitchenDisposition: 'waste' }))
      .resolves.toMatchObject({ state: 'cancelled' });

    expect(prismaMock.orders.updateMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.order_items.update).toHaveBeenCalledWith({
      where: { id: ITEM_ID },
      data: expect.objectContaining({ cancellation_type: 'after_fire_waste' }),
    });
    expect(prismaMock.order_items.update.mock.calls[0][0].data)
      .not.toHaveProperty('inventory_consumed_at_fire');
    expect(prismaMock.inventory_transactions.findMany).toHaveBeenCalledTimes(1);
    expect(stock.getDefaultLocationForProduct).not.toHaveBeenCalled();
    expect(stock.updateStock).not.toHaveBeenCalled();
    expect(kds.cancelTicketItemInTx).not.toHaveBeenCalled();
  });

  it('sin kitchenDisposition y ticket avanzado: error tipado antes del claim, sin efectos', async () => {
    const { service, prismaMock, stock } = buildKitchenHarness('in_preparation');

    await expect(service.cancelOrder(ORDER_ID, { reason })).rejects.toMatchObject({
      errorCode: 'TABLE_SESSION_ADD_ITEMS_INVALID',
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.orders.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.order_items.update).not.toHaveBeenCalled();
    expect(stock.updateStock).not.toHaveBeenCalled();
  });

  it('ticket pending: cancela sin kitchenDisposition y reintegra automáticamente', async () => {
    const { service, prismaMock, stock, kds, emitter } = buildKitchenHarness('pending');

    await expect(service.cancelOrder(ORDER_ID, { reason }))
      .resolves.toMatchObject({ state: 'cancelled' });

    expect(prismaMock.kitchen_tickets.findFirst).toHaveBeenCalledWith({
      where: { id: TICKET_ID }, select: { status: true },
    });
    expect(kds.cancelTicketItemInTx).toHaveBeenCalledWith(prismaMock, TICKET_ID, ITEM_ID);
    expect(kds.emitTicketCancelledEvent).toHaveBeenCalledWith(TICKET_ID);
    expect(prismaMock.order_items.update).toHaveBeenCalledWith({
      where: { id: ITEM_ID },
      data: expect.objectContaining({ cancellation_type: 'after_fire_reused' }),
    });
    expect(prismaMock.inventory_transactions.findMany).toHaveBeenCalledTimes(1);
    expect(stock.updateStock).not.toHaveBeenCalled();
    expect(emitter.emit).toHaveBeenCalledWith('order.status_changed', expect.anything());
  });

  it('R2: filas KDS vivas (incluso delivered) de la orden quedan cancelled y su ticket se emite post-commit', async () => {
    const { service, prismaMock, kds } = buildKitchenHarness('ready', []);
    // Barrido final: quedan filas no canceladas (p. ej. una `delivered` que
    // la rama avanzada no cubre) en el ticket TICKET_ID.
    prismaMock.kitchen_ticket_items.findMany.mockResolvedValue([
      { kitchen_ticket_id: TICKET_ID },
      { kitchen_ticket_id: TICKET_ID },
    ]);
    prismaMock.kitchen_tickets.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.kitchen_ticket_items.updateMany.mockResolvedValue({ count: 2 });

    await service.cancelOrder(ORDER_ID, { reason, kitchenDisposition: 'reuse' });

    expect(prismaMock.kitchen_ticket_items.updateMany).toHaveBeenCalledWith({
      where: { kitchen_ticket_id: { in: [TICKET_ID] }, status: { not: 'cancelled' } },
      data: expect.objectContaining({ status: 'cancelled' }),
    });
    expect(prismaMock.kitchen_tickets.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [TICKET_ID] }, status: { not: 'cancelled' } },
      data: expect.objectContaining({ status: 'cancelled' }),
    });
    expect(kds.emitTicketCancelledEvent).toHaveBeenCalledWith(TICKET_ID);
  });

  it('kitchenDisposition reuse sin consumo registrado: cancela la línea sin devoluciones ni excepción', async () => {
    const { service, prismaMock, stock } = buildKitchenHarness('ready', []);

    await expect(service.cancelOrder(ORDER_ID, { reason, kitchenDisposition: 'reuse' }))
      .resolves.toMatchObject({ state: 'cancelled' });

    expect(prismaMock.inventory_transactions.findMany).toHaveBeenCalledWith({
      where: { order_item_id: ITEM_ID, quantity_change: { lt: 0 } },
      select: { id: true, product_id: true, product_variant_id: true, quantity_change: true, unit_cost: true, total_cost: true },
    });
    expect(prismaMock.order_items.update).toHaveBeenCalledWith({
      where: { id: ITEM_ID },
      data: expect.objectContaining({ cancellation_type: 'after_fire_reused' }),
    });
    expect(stock.getDefaultLocationForProduct).not.toHaveBeenCalled();
    expect(stock.updateStock).not.toHaveBeenCalled();
  });
});

/**
 * Tabla de derivación de {@link OrderFlowService.reconcileOrderFromDispatch}
 * (fuente única de verdad orden ↔ remisión). Se mockea prisma (orden, notas,
 * ruta abierta, modo) y se espía `updateOrderState` para capturar la escalera
 * caminada. `validateTransition` corre REAL (todas las aristas de la escalera
 * pending_payment→processing→shipped→delivered→finished existen en
 * VALID_TRANSITIONS).
 */
describe('OrderFlowService.reconcileOrderFromDispatch — tabla de derivación', () => {
  const STORE_ID = 10;
  const ORDER_ID = 55;

  type Note = { id: number; status: string };

  const buildService = (opts: {
    order: {
      state: string;
      delivery_type: string;
      remaining_balance: number;
    } | null;
    notes?: Note[];
    openRouteStop?: { id: number } | null;
    mode?: 'live' | 'on_close';
  }) => {
    const prismaMock: any = {
      orders: {
        findFirst: jest.fn().mockResolvedValue(
          opts.order
            ? { id: ORDER_ID, ...opts.order }
            : null,
        ),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      dispatch_notes: {
        findMany: jest.fn().mockResolvedValue(opts.notes ?? []),
      },
      dispatch_route_stops: {
        findFirst: jest.fn().mockResolvedValue(opts.openRouteStop ?? null),
      },
      store_settings: {
        findFirst: jest.fn().mockResolvedValue({
          settings: {
            dispatch: { order_state_update_mode: opts.mode ?? 'on_close' },
          },
        }),
      },
    };

    const service = new OrderFlowService(
      prismaMock as unknown as StorePrismaService,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { logCustom: jest.fn().mockResolvedValue(undefined) } as any,
    );

    const updateSpy = jest
      .spyOn(service as any, 'updateOrderState')
      .mockResolvedValue({});

    return { service, prismaMock, updateSpy };
  };

  const targets = (updateSpy: jest.SpyInstance) =>
    updateSpy.mock.calls.map((c) => c[1] as string);

  it('prepago (balance 0) + allFulfilled → finished', async () => {
    const { service, updateSpy } = buildService({
      order: {
        state: 'processing',
        delivery_type: 'home_delivery',
        remaining_balance: 0,
      },
      notes: [{ id: 1, status: 'delivered' }],
    });

    await service.reconcileOrderFromDispatch(ORDER_ID, STORE_ID);

    expect(targets(updateSpy)).toEqual(['shipped', 'delivered', 'finished']);
  });

  it('COD (balance > 0) + allFulfilled → delivered', async () => {
    const { service, updateSpy } = buildService({
      order: {
        state: 'processing',
        delivery_type: 'home_delivery',
        remaining_balance: 5000,
      },
      notes: [
        { id: 1, status: 'delivered' },
        { id: 2, status: 'invoiced' },
      ],
    });

    await service.reconcileOrderFromDispatch(ORDER_ID, STORE_ID);

    expect(targets(updateSpy)).toEqual(['shipped', 'delivered']);
  });

  it('parcial (anyFulfilled, !allFulfilled) → shipped', async () => {
    const { service, updateSpy } = buildService({
      order: {
        state: 'processing',
        delivery_type: 'home_delivery',
        remaining_balance: 5000,
      },
      notes: [
        { id: 1, status: 'delivered' },
        { id: 2, status: 'confirmed' },
      ],
    });

    await service.reconcileOrderFromDispatch(ORDER_ID, STORE_ID);

    expect(targets(updateSpy)).toEqual(['shipped']);
  });

  it('!anyFulfilled + anyDispatched (confirmed) → shipped', async () => {
    const { service, updateSpy } = buildService({
      order: {
        state: 'processing',
        delivery_type: 'home_delivery',
        remaining_balance: 5000,
      },
      notes: [{ id: 1, status: 'confirmed' }],
    });

    await service.reconcileOrderFromDispatch(ORDER_ID, STORE_ID);

    expect(targets(updateSpy)).toEqual(['shipped']);
  });

  it('cap on_close con ruta abierta: finished derivado → tope shipped', async () => {
    const { service, updateSpy, prismaMock } = buildService({
      order: {
        state: 'processing',
        delivery_type: 'home_delivery',
        remaining_balance: 0, // sin tope derivaría a finished
      },
      notes: [{ id: 1, status: 'delivered' }],
      openRouteStop: { id: 99 },
      mode: 'on_close',
    });

    await service.reconcileOrderFromDispatch(ORDER_ID, STORE_ID);

    expect(targets(updateSpy)).toEqual(['shipped']);
    expect(prismaMock.store_settings.findFirst).toHaveBeenCalled();
  });

  it('cap live con ruta abierta: finished derivado → tope delivered', async () => {
    const { service, updateSpy } = buildService({
      order: {
        state: 'processing',
        delivery_type: 'home_delivery',
        remaining_balance: 0,
      },
      notes: [{ id: 1, status: 'delivered' }],
      openRouteStop: { id: 99 },
      mode: 'live',
    });

    await service.reconcileOrderFromDispatch(ORDER_ID, STORE_ID);

    expect(targets(updateSpy)).toEqual(['shipped', 'delivered']);
  });

  it('NO-OP: delivery_type direct_delivery', async () => {
    const { service, updateSpy, prismaMock } = buildService({
      order: {
        state: 'processing',
        delivery_type: 'direct_delivery',
        remaining_balance: 0,
      },
      notes: [{ id: 1, status: 'delivered' }],
    });

    await service.reconcileOrderFromDispatch(ORDER_ID, STORE_ID);

    expect(updateSpy).not.toHaveBeenCalled();
    expect(prismaMock.dispatch_notes.findMany).not.toHaveBeenCalled();
  });

  it('NO-OP: delivery_type dine_in', async () => {
    const { service, updateSpy } = buildService({
      order: {
        state: 'processing',
        delivery_type: 'dine_in',
        remaining_balance: 0,
      },
      notes: [{ id: 1, status: 'delivered' }],
    });

    await service.reconcileOrderFromDispatch(ORDER_ID, STORE_ID);

    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('NO-OP: sin remisiones (|N| = 0)', async () => {
    const { service, updateSpy } = buildService({
      order: {
        state: 'processing',
        delivery_type: 'home_delivery',
        remaining_balance: 0,
      },
      notes: [],
    });

    await service.reconcileOrderFromDispatch(ORDER_ID, STORE_ID);

    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('NO-OP: estado no-escalera (created)', async () => {
    const { service, updateSpy } = buildService({
      order: {
        state: 'created',
        delivery_type: 'home_delivery',
        remaining_balance: 0,
      },
      notes: [{ id: 1, status: 'delivered' }],
    });

    await service.reconcileOrderFromDispatch(ORDER_ID, STORE_ID);

    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('solo drafts (nada despachado) → NO-OP', async () => {
    const { service, updateSpy } = buildService({
      order: {
        state: 'processing',
        delivery_type: 'home_delivery',
        remaining_balance: 5000,
      },
      notes: [{ id: 1, status: 'draft' }],
    });

    await service.reconcileOrderFromDispatch(ORDER_ID, STORE_ID);

    expect(updateSpy).not.toHaveBeenCalled();
  });
});

/**
 * QUI-777 — Cobertura dedicada del puente de cocina del
 * {@link OrderFlowService.markKitchenOrderDelivered} (y su reversa
 * {@link OrderFlowService.revertKitchenOrderDelivery}). El listener que
 * traduce `kitchen.order_all_delivered` a `OrderSseService.pushOrderEvent`
 * depende de la DECISIÓN que toma este método: ¿la orden estaba en
 * `processing`?, ¿se transicionó a `delivered`? El método reporta
 * `{ order, transitioned, previousState }`: si devuelve la fila sin
 * transicionar (`transitioned: false`), el listener NO emite SSE — y esa
 * decisión se prueba aquí, no en el listener.
 *
 * Patrón: factory `buildService()` análogo al de `reconcileOrderFromDispatch`.
 * `getOrder` se espía (es método privado) y `updateOrderState` también, para
 * capturar argumentos exactos (incluido `source: 'kitchen_bridge'` T9).
 */
describe('OrderFlowService.markKitchenOrderDelivered — restaurant bridge', () => {
  const ORDER_ID = 77;

  const buildService = (
    order: { state: string; delivery_type?: string } | null,
  ) => {
    const prismaMock: any = {
      orders: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const service = new OrderFlowService(
      prismaMock as unknown as StorePrismaService,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { logCustom: jest.fn().mockResolvedValue(undefined) } as any,
    );

    // `getOrder` es el seam público que el método usa para cargar la fila.
    // Espiamos con el order que el test quiera — refleja el SELECT real del
    // service (incluye state + order_number + delivery_type, no solo state).
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(
      order ? { id: ORDER_ID, ...order } : null,
    );
    const updateSpy = jest
      .spyOn(service as any, 'updateOrderState')
      .mockResolvedValue({ id: ORDER_ID, state: 'delivered' });

    return { service, prismaMock, updateSpy };
  };

  it('happy path: orden en processing transiciona a delivered con source kitchen_bridge', async () => {
    const { service, updateSpy } = buildService({ state: 'processing' });

    const result = await service.markKitchenOrderDelivered(ORDER_ID);

    expect(updateSpy).toHaveBeenCalledTimes(1);
    // T9: el source marca este flujo como "puente de cocina" para que el
    // listener de notificaciones silencie el evento (entregado NO alerta;
    // el LISTO ya sonó por `kitchen.ticket_ready`).
    expect(updateSpy).toHaveBeenCalledWith(
      ORDER_ID,
      'delivered',
      expect.objectContaining({
        delivered_at: expect.any(Date),
        kitchen_all_delivered: true,
      }),
      { source: 'kitchen_bridge' },
    );
    expect(result.transitioned).toBe(true);
    expect(result.previousState).toBe('processing');
    expect(result.order?.state).toBe('delivered');
  });

  it('domicilio: cocina terminada NO entrega la orden — queda en processing para despacho', async () => {
    const { service, updateSpy } = buildService({
      state: 'processing',
      delivery_type: 'home_delivery',
    });

    const result = await service.markKitchenOrderDelivered(ORDER_ID);

    // Entregar los platos es entregarlos al domiciliario, no al cliente. Si
    // el puente moviera la orden a `delivered`, el detalle perdería el botón
    // "Despachar Orden" y `createFromOrder` rechazaría la remisión (exige
    // `processing`/`pending_payment`).
    expect(updateSpy).not.toHaveBeenCalled();
    expect(result.transitioned).toBe(false);
    expect(result.previousState).toBe('processing');
    expect(result.order?.state).toBe('processing');
  });

  it('idempotencia: orden ya en delivered devuelve la fila sin transicionar', async () => {
    const { service, updateSpy } = buildService({ state: 'delivered' });

    const result = await service.markKitchenOrderDelivered(ORDER_ID);

    // Re-trigger desde KDS o reconexión SSE: no-op real. El listener decide
    // por `transitioned === true`, así que este no-op NO emite SSE (el
    // chequeo viejo por `state === 'delivered'` sí emitía, con `old_state`
    // inventado).
    expect(updateSpy).not.toHaveBeenCalled();
    expect(result.transitioned).toBe(false);
    expect(result.previousState).toBe('delivered');
    expect(result.order?.state).toBe('delivered');
  });

  it('idempotencia: orden en finished (auto-finalizada por job 4h) NO transiciona', async () => {
    const { service, updateSpy } = buildService({ state: 'finished' });

    const result = await service.markKitchenOrderDelivered(ORDER_ID);

    expect(updateSpy).not.toHaveBeenCalled();
    expect(result.transitioned).toBe(false);
    expect(result.previousState).toBe('finished');
    expect(result.order?.state).toBe('finished');
  });

  it('validateTransition lanza ORDER_INVALID_TRANSITION: el error se propaga al listener', async () => {
    // Defensa en profundidad: si por alguna razón la fila cargada tiene un
    // estado desde el que `delivered` no es alcanzable, validateTransition
    // lanza 409 ORDER_INVALID_TRANSITION. El listener captura con try/catch
    // (log + swallow) — pero el service NO debe silenciar el error.
    const prismaMock: any = {
      orders: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new OrderFlowService(
      prismaMock as unknown as StorePrismaService,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { logCustom: jest.fn().mockResolvedValue(undefined) } as any,
    );
    jest.spyOn(service as any, 'getOrder').mockResolvedValue({
      id: ORDER_ID,
      state: 'processing',
    });
    jest.spyOn(service as any, 'updateOrderState').mockResolvedValue({});
    jest
      .spyOn(service as any, 'validateTransition')
      .mockImplementation(() => {
        throw new BadRequestException('Invalid state transition');
      });

    await expect(
      service.markKitchenOrderDelivered(ORDER_ID),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

/**
 * QUI-777 — Hermano reverso del describe anterior. Cubre
 * {@link OrderFlowService.revertKitchenOrderDelivery} (delivered → processing
 * cuando el KDS revierte un ticket terminal). El método es la imagen espejo:
 * gate por `state === 'delivered'`, mismo seam `updateOrderState`, mismo
 * patrón de no-op idempotente.
 *
 * Diferencia clave vs. `markKitchenOrderDelivered`: este método NO usa
 * `getOrder()` — hace su propio `prisma.orders.findFirst` con select mínimo
 * (id + state). Cubrimos esa ruta aquí para que el spec refleje la
 * implementación real y no la contratemos por accidente.
 */
describe('OrderFlowService.revertKitchenOrderDelivery — kitchen bridge reverse', () => {
  const ORDER_ID = 99;

  const buildService = (order: { id: number; state: string } | null) => {
    const prismaMock: any = {
      orders: {
        findFirst: jest.fn().mockResolvedValue(order),
      },
    };
    const service = new OrderFlowService(
      prismaMock as unknown as StorePrismaService,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { logCustom: jest.fn().mockResolvedValue(undefined) } as any,
    );
    const updateSpy = jest
      .spyOn(service as any, 'updateOrderState')
      .mockResolvedValue({ id: ORDER_ID, state: 'processing' });

    return { service, prismaMock, updateSpy };
  };

  it('happy path: orden en delivered transiciona a processing', async () => {
    const { service, updateSpy, prismaMock } = buildService({
      id: ORDER_ID,
      state: 'delivered',
    });

    const result = await service.revertKitchenOrderDelivery(ORDER_ID);

    // El service usa su propio findFirst con select mínimo (id, state) —
    // NO pasa por getOrder. Cubrir esa ruta evita que un refactor futuro
    // acople accidentalmente los dos métodos.
    expect(prismaMock.orders.findFirst).toHaveBeenCalledWith({
      where: { id: ORDER_ID },
      select: { id: true, state: true },
    });
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledWith(
      ORDER_ID,
      'processing',
      expect.objectContaining({ kitchen_delivery_reverted: true }),
      { source: 'kitchen_bridge' },
    );
    expect(result.transitioned).toBe(true);
    expect(result.previousState).toBe('delivered');
    expect(result.order?.state).toBe('processing');
  });

  it('idempotencia: orden inexistente (findFirst retorna null) NO transiciona', async () => {
    const { service, updateSpy } = buildService(null);

    const result = await service.revertKitchenOrderDelivery(ORDER_ID);

    expect(updateSpy).not.toHaveBeenCalled();
    expect(result.order).toBeNull();
    expect(result.transitioned).toBe(false);
    expect(result.previousState).toBeNull();
  });

  it('idempotencia: orden en processing (ya estaba) NO transiciona', async () => {
    const { service, updateSpy } = buildService({
      id: ORDER_ID,
      state: 'processing',
    });

    const result = await service.revertKitchenOrderDelivery(ORDER_ID);

    expect(updateSpy).not.toHaveBeenCalled();
    expect(result.transitioned).toBe(false);
    expect(result.previousState).toBe('processing');
    expect(result.order?.state).toBe('processing');
  });

  it('idempotencia: orden en finished (pago confirmado antes de la reversa) NO transiciona', async () => {
    const { service, updateSpy } = buildService({
      id: ORDER_ID,
      state: 'finished',
    });

    const result = await service.revertKitchenOrderDelivery(ORDER_ID);

    expect(updateSpy).not.toHaveBeenCalled();
    expect(result.transitioned).toBe(false);
    expect(result.previousState).toBe('finished');
    expect(result.order?.state).toBe('finished');
  });

  it('validateTransition lanza: el error se propaga al listener', async () => {
    const { service } = buildService({ id: ORDER_ID, state: 'delivered' });
    jest
      .spyOn(service as any, 'validateTransition')
      .mockImplementation(() => {
        throw new BadRequestException('Invalid state transition');
      });

    await expect(
      service.revertKitchenOrderDelivery(ORDER_ID),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

/**
 * PLAN-order-detail-cancel-item (paso 1) — contrato del seam compartido
 * {@link OrderFlowService.cancelOrderItem} (mudado de mesa).
 *
 * Cubre: 404 orden / 404 ítem ajeno, guards paid/terminal (409), motivo
 * obligatorio (422 en llamada directa), idempotencia, derivación del tipo
 * contable, soft cancel + recálculo con `cancelled_at IS NULL`, cancel KDS
 * `pending` in-tx + SSE post-commit, TOCTOU (ticket avanzado → merma sin
 * tocar cocina) y fail-loud si el KDS no está cableado.
 */
describe('OrderFlowService.cancelOrderItem — seam compartido', () => {
  const ORDER_ID = 1017;
  const ITEM_ID = 501;
  const TICKET_ID = 77;

  const unfiredItem = (overrides: Record<string, unknown> = {}) => ({
    id: ITEM_ID,
    product_name: 'Bandeja paisa',
    inventory_consumed_at_fire: false,
    cancelled_at: null,
    kitchen_ticket_items: [],
    ...overrides,
  });

  const firedItemPending = () => ({
    ...unfiredItem({ inventory_consumed_at_fire: true }),
    kitchen_ticket_items: [
      {
        id: 900,
        status: 'pending',
        kitchen_ticket_id: TICKET_ID,
        kitchen_ticket: { id: TICKET_ID, status: 'pending' },
      },
    ],
  });

  const buildService = (opts: {
    order?: Record<string, unknown>;
    orderError?: unknown;
    // `undefined` → ítem base sin disparar; `null` → ítem inexistente (404).
    item?: Record<string, unknown> | null;
    freshTicketStatus?: string | null;
    // C.8/F-082 — `order_item_taxes` (fila autoritativa persistida por
    // línea), no `tax_amount_item` (ambiguo en unidad, F-003): el `select`
    // real de `cancelOrderItem` pide la relación, no el campo suelto.
    activeItems?: Array<{
      total_price: number;
      order_item_taxes?: Array<{ tax_amount: number | null }>;
    }>;
    withKds?: boolean;
  }) => {
    const txMock: any = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: ORDER_ID, state: 'created' }]),
      // Sincronía cancelado orden↔cocina: sin fila KDS viva por defecto.
      kitchen_ticket_items: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      kitchen_tickets: {
        findFirst: jest.fn().mockResolvedValue(
          opts.freshTicketStatus == null
            ? null
            : { status: opts.freshTicketStatus },
        ),
      },
      inventory_transactions: { findMany: jest.fn().mockResolvedValue([]) },
      audit_logs: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 1 }) },
      inventory_cost_layers: { create: jest.fn().mockResolvedValue({ id: 1 }) },
      payments: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      order_items: {
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue(
          opts.activeItems ?? [{ total_price: 50000, order_item_taxes: [] }],
        ),
      },
      orders: {
        findFirst: jest.fn().mockResolvedValue({ active_financial_split_id: null }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const prismaMock: any = {
      order_items: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            opts.item === undefined ? unfiredItem() : opts.item,
          ),
      },
      $transaction: jest.fn((cb: any) => cb(txMock)),
    };
    const stockLevelManager = {
      getDefaultLocationForProduct: jest.fn().mockResolvedValue(1),
      updateStock: jest.fn().mockResolvedValue({}),
    };
    const kitchenFireService = {
      cancelTicketItemInTx: jest.fn().mockResolvedValue('cancelled'),
      emitTicketCancelledEvent: jest.fn().mockResolvedValue(undefined),
    };

    const service = new OrderFlowService(
      prismaMock as unknown as StorePrismaService,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      stockLevelManager as any,
      {} as any,
      {} as any,
      { logCustom: jest.fn().mockResolvedValue(undefined) } as any,
      (opts.withKds === false ? undefined : kitchenFireService) as any,
    );

    if (opts.orderError !== undefined) {
      jest
        .spyOn(service as any, 'getOrder')
        .mockRejectedValue(opts.orderError);
    } else {
      jest
        .spyOn(service as any, 'getOrder')
        .mockResolvedValue(opts.order ?? { id: ORDER_ID, state: 'created' });
    }

    return { service, prismaMock, txMock, stockLevelManager, kitchenFireService };
  };

  it('404 si la orden no existe en la tienda', async () => {
    const { service, prismaMock } = buildService({
      orderError: new NotFoundException(`Order #${ORDER_ID} not found`),
    });

    await expect(
      service.cancelOrderItem(ORDER_ID, ITEM_ID, 'cliente se arrepintió'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prismaMock.order_items.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('no cancela una línea cuando la orden ya tiene cuentas financieras activas', async () => {
    const { service, prismaMock } = buildService({
      order: { id: ORDER_ID, store_id: 4, state: 'draft', active_financial_split_id: 3 },
    });

    await expect(service.cancelOrderItem(
      ORDER_ID, ITEM_ID, 'cliente se arrepintió',
    )).rejects.toMatchObject({ errorCode: 'SPLIT_ACCOUNT_LOCKED' });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('si el split aparece tras la prelectura, el lock lo detecta antes del soft cancel', async () => {
    const { service, txMock } = buildService({
      order: { id: ORDER_ID, store_id: 4, state: 'draft', active_financial_split_id: null },
    });
    txMock.orders.findFirst.mockResolvedValueOnce({ active_financial_split_id: 3 });

    await expect(service.cancelOrderItem(
      ORDER_ID, ITEM_ID, 'cliente se arrepintió',
    )).rejects.toMatchObject({ errorCode: 'SPLIT_ACCOUNT_LOCKED' });
    expect(txMock.order_items.update).not.toHaveBeenCalled();
    expect(txMock.orders.update).not.toHaveBeenCalled();
  });

  it('404 si el ítem no pertenece a la orden (sin filtrar)', async () => {
    const { service, prismaMock } = buildService({ item: null });

    await expect(
      service.cancelOrderItem(ORDER_ID, 999999, 'cliente se arrepintió'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prismaMock.order_items.findFirst).toHaveBeenCalledWith({
      where: { id: 999999, order_id: ORDER_ID },
      select: expect.anything(),
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('idempotencia: ítem ya cancelado devuelve la vista sin reescribir', async () => {
    const CANCELLED_AT = new Date('2026-09-01T12:00:00.000Z');
    const { service, prismaMock, kitchenFireService } = buildService({
      item: unfiredItem({ cancelled_at: CANCELLED_AT }),
    });

    const result = await service.cancelOrderItem(
      ORDER_ID,
      ITEM_ID,
      'segundo intento con otro motivo',
    );

    expect((result as any).id).toBe(ORDER_ID);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(kitchenFireService.cancelTicketItemInTx).not.toHaveBeenCalled();
    expect(kitchenFireService.emitTicketCancelledEvent).not.toHaveBeenCalled();
  });

  it('saldo tras cancelación: COD pendiente de 156000 queda en 38000 en la misma tx', async () => {
    const { service, txMock } = buildService({
      order: {
        id: ORDER_ID, store_id: 4, state: 'pending_payment', payment_form: '1',
        grand_total: new Prisma.Decimal(156000), remaining_balance: new Prisma.Decimal(156000),
        payments: [{
          id: 8556, state: 'pending', amount: new Prisma.Decimal(156000),
          store_payment_method: { system_payment_method: { processing_mode: 'ON_DELIVERY' } },
        }],
      },
      activeItems: [{ total_price: 38000, order_item_taxes: [] }],
    });

    await service.cancelOrderItem(ORDER_ID, ITEM_ID, 'cliente se arrepintió');

    expect(txMock.orders.update).toHaveBeenCalledTimes(1);
    expect(txMock.orders.update).toHaveBeenCalledWith({
      where: { id: ORDER_ID },
      data: expect.objectContaining({
        grand_total: new Prisma.Decimal(38000),
        remaining_balance: new Prisma.Decimal(38000),
      }),
    });
    expect(txMock.payments.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [8556] }, order_id: ORDER_ID, state: 'pending' },
      data: expect.objectContaining({ amount: new Prisma.Decimal(38000) }),
    });
  });

  it('saldo tras cancelación: no sobrescribe el saldo de una orden crédito', async () => {
    const { service, txMock } = buildService({
      order: {
        id: ORDER_ID, store_id: 4, state: 'created', payment_form: '2',
        remaining_balance: new Prisma.Decimal(156000), payments: [],
      },
      activeItems: [{ total_price: 38000, order_item_taxes: [] }],
    });

    await service.cancelOrderItem(ORDER_ID, ITEM_ID, 'cliente se arrepintió');

    expect(txMock.orders.update).toHaveBeenCalledTimes(1);
    expect(txMock.orders.update.mock.calls[0][0].data).not.toHaveProperty('remaining_balance');
    expect(txMock.orders.update.mock.calls[0][0].data.grand_total).toEqual(new Prisma.Decimal(38000));
  });

  it('saldo tras cancelación: el recálculo aislado descuenta abonos con precisión Decimal', async () => {
    const { service, txMock } = buildService({
      activeItems: [{ total_price: 38000.01, order_item_taxes: [] }],
    });

    // El seam público rechaza cualquier pago liquidado; probar su aritmética
    // por separado no habilita la cancelación de una orden ya cobrada.
    await service['recalcOrderTotalsAfterItemCancelInTx'](txMock, {
      payment_form: '1',
      payments: [
        { state: 'succeeded', amount: new Prisma.Decimal(10000.02) },
        { state: 'pending', amount: new Prisma.Decimal(156000) },
      ],
    }, ORDER_ID);

    expect(txMock.orders.update).toHaveBeenCalledWith({
      where: { id: ORDER_ID },
      data: expect.objectContaining({ remaining_balance: new Prisma.Decimal(27999.99) }),
    });
  });

  it('saldo tras cancelación: el recálculo aislado nunca persiste saldo negativo', async () => {
    const { service, txMock } = buildService({
      activeItems: [{ total_price: 38000, order_item_taxes: [] }],
    });

    await service['recalcOrderTotalsAfterItemCancelInTx'](txMock, {
      payments: [{ state: 'captured', amount: new Prisma.Decimal(40000) }],
    }, ORDER_ID);

    expect(txMock.orders.update).toHaveBeenCalledWith({
      where: { id: ORDER_ID },
      data: expect.objectContaining({ remaining_balance: new Prisma.Decimal(0) }),
    });
  });

  it('409 si la orden tiene pago real succeeded, no un payment_status inexistente', async () => {
    const { service } = buildService({
      order: { id: ORDER_ID, state: 'created', payments: [{ state: 'succeeded' }] },
    });

    await expect(
      service.cancelOrderItem(ORDER_ID, ITEM_ID, 'cliente se arrepintió'),
    ).rejects.toMatchObject({
      errorCode: 'TABLE_SESSION_ITEM_NOT_REMOVABLE',
    });
  });

  it('si el pago entra después de la prelectura, el lock impide cancelar la línea', async () => {
    const { service, txMock } = buildService({
      order: { id: ORDER_ID, store_id: 4, state: 'created', payments: [] },
    });
    txMock.payments.findFirst.mockResolvedValueOnce({ id: 81 });

    await expect(service.cancelOrderItem(
      ORDER_ID, ITEM_ID, 'cliente se arrepintió',
    )).rejects.toMatchObject({ errorCode: 'TABLE_SESSION_ITEM_NOT_REMOVABLE' });
    expect(txMock.order_items.update).not.toHaveBeenCalled();
    expect(txMock.orders.update).not.toHaveBeenCalled();
  });

  it('409 si la orden está finished aunque no traiga el campo legado completed', async () => {
    const { service } = buildService({
      order: { id: ORDER_ID, state: 'finished', payments: [] },
    });

    await expect(service.cancelOrderItem(
      ORDER_ID, ITEM_ID, 'cliente se arrepintió',
    )).rejects.toMatchObject({ errorCode: 'TABLE_SESSION_ITEM_NOT_REMOVABLE' });
  });

  it('409 si la orden está en estado terminal', async () => {
    const { service, prismaMock } = buildService({
      order: { id: ORDER_ID, state: 'cancelled' },
    });

    await expect(
      service.cancelOrderItem(ORDER_ID, ITEM_ID, 'cliente se arrepintió'),
    ).rejects.toMatchObject({
      errorCode: 'TABLE_SESSION_ITEM_NOT_REMOVABLE',
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('422 si el motivo tiene menos de 3 caracteres (defensa en profundidad)', async () => {
    const { service, prismaMock } = buildService({});

    await expect(
      service.cancelOrderItem(ORDER_ID, ITEM_ID, 'x'),
    ).rejects.toMatchObject({
      errorCode: 'TABLE_SESSION_ADD_ITEMS_INVALID',
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('happy before_fire: soft cancel + recálculo excluyendo cancelados', async () => {
    const { service, txMock, kitchenFireService } = buildService({
      activeItems: [
        { total_price: 50000, order_item_taxes: [{ tax_amount: 8000 }] },
        { total_price: 20000, order_item_taxes: [{ tax_amount: 0 }] },
      ],
    });

    await service.cancelOrderItem(
      ORDER_ID,
      ITEM_ID,
      '  cliente se arrepintió  ',
    );

    expect(txMock.order_items.update).toHaveBeenCalledWith({
      where: { id: ITEM_ID },
      data: expect.objectContaining({
        cancellation_reason: 'cliente se arrepintió',
        cancellation_type: 'before_fire',
        updated_at: expect.any(Date),
      }),
    });
    const updateData = txMock.orders.update.mock.calls[0][0].data;
    expect(Number(updateData.subtotal_amount)).toBe(70000);
    expect(Number(updateData.tax_amount)).toBe(8000);
    expect(Number(updateData.grand_total)).toBe(78000);
    expect(kitchenFireService.cancelTicketItemInTx).not.toHaveBeenCalled();
    expect(kitchenFireService.emitTicketCancelledEvent).not.toHaveBeenCalled();
  });

  it('ajusta el marcador COD pendiente al nuevo total tras cancelar un ítem', async () => {
    const { service, txMock } = buildService({
      order: {
        id: ORDER_ID, store_id: 4, state: 'pending_payment',
        shipping_cost: 5000,
        payments: [{
          id: 88, state: 'pending', amount: 71000,
          store_payment_method: {
            system_payment_method: { processing_mode: 'ON_DELIVERY' },
          },
        }],
      },
      activeItems: [{ total_price: 38000, order_item_taxes: [] }],
    });

    await service.cancelOrderItem(ORDER_ID, ITEM_ID, 'plato cancelado');

    const orderData = txMock.orders.update.mock.calls[0][0].data;
    expect(Number(orderData.subtotal_amount)).toBe(38000);
    expect(Number(orderData.grand_total)).toBe(43000);
    expect(txMock.payments.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [88] }, order_id: ORDER_ID, state: 'pending' },
      data: { amount: expect.anything(), updated_at: expect.any(Date) },
    });
    expect(Number(txMock.payments.updateMany.mock.calls[0][0].data.amount)).toBe(43000);
  });

  it('no ajusta un pago pendiente de pasarela al cancelar un ítem', async () => {
    const { service, txMock } = buildService({
      order: {
        id: ORDER_ID, store_id: 4, state: 'pending_payment',
        payments: [{
          id: 89, state: 'pending', amount: 71000,
          store_payment_method: {
            system_payment_method: { processing_mode: 'ONLINE' },
          },
        }],
      },
    });

    await service.cancelOrderItem(ORDER_ID, ITEM_ID, 'plato cancelado');
    expect(txMock.payments.updateMany).not.toHaveBeenCalled();
  });

  // C.8/F-082 (blocker) — antes el recálculo escribía `grand_total` como
  // `subtotal + tax` a secas: envío, propina y descuento vivos en la orden
  // se perdían apenas se cancelaba UN ítem, aunque la orden siguiera
  // teniendo ambos cargos. Ahora los conserva (`shipping_cost + tip_amount
  // - discount_amount`), clampado a 0.
  it('F-082: conserva envío, propina y descuento al recalcular grand_total', async () => {
    const { service, txMock } = buildService({
      order: {
        id: ORDER_ID,
        state: 'created',
        shipping_cost: 12000,
        tip_amount: 20000,
        discount_amount: 5000,
      },
      activeItems: [
        { total_price: 50000, order_item_taxes: [{ tax_amount: 9500 }] },
        { total_price: 50000, order_item_taxes: [{ tax_amount: 9500 }] },
      ],
    });

    await service.cancelOrderItem(
      ORDER_ID,
      ITEM_ID,
      'cliente pidió una línea de menos',
    );

    const updateData = txMock.orders.update.mock.calls[0][0].data;
    expect(Number(updateData.subtotal_amount)).toBe(100000);
    expect(Number(updateData.tax_amount)).toBe(19000);
    // 100000 + 19000 + 12000 (envío) + 20000 (propina) - 5000 (descuento)
    expect(Number(updateData.grand_total)).toBe(146000);
  });

  it('happy after_fire pending: cancela el ticket in-tx + SSE post-commit', async () => {
    const { service, txMock, kitchenFireService } = buildService({
      item: firedItemPending(),
      freshTicketStatus: 'pending',
    });

    await service.cancelOrderItem(ORDER_ID, ITEM_ID, 'se quemó el plato');

    expect(kitchenFireService.cancelTicketItemInTx).toHaveBeenCalledTimes(1);
    expect(kitchenFireService.cancelTicketItemInTx.mock.calls[0][1]).toBe(
      TICKET_ID,
    );
    expect(kitchenFireService.emitTicketCancelledEvent).toHaveBeenCalledWith(
      TICKET_ID,
    );
    expect(txMock.order_items.update).toHaveBeenCalledWith({
      where: { id: ITEM_ID },
      data: expect.objectContaining({ cancellation_type: 'after_fire_waste' }),
    });
  });

  it('TOCTOU: ticket avanzado en cocina → rechaza antes de mover stock o KDS', async () => {
    const { service, txMock, kitchenFireService } = buildService({
      item: firedItemPending(),
      freshTicketStatus: 'in_preparation',
    });

    await expect(service.cancelOrderItem(ORDER_ID, ITEM_ID, 'el cliente se fue')).rejects.toMatchObject({
      errorCode: 'TABLE_SESSION_ADD_ITEMS_INVALID',
    });

    expect(kitchenFireService.cancelTicketItemInTx).not.toHaveBeenCalled();
    expect(kitchenFireService.emitTicketCancelledEvent).not.toHaveBeenCalled();
    expect(txMock.order_items.update).not.toHaveBeenCalled();
  });

  it('cancellation_type explícito se respeta aunque sea inconsistente', async () => {
    const { service, txMock, stockLevelManager } = buildService({});

    await service.cancelOrderItem(
      ORDER_ID,
      ITEM_ID,
      'merma pactada con el dueño',
      'after_fire_waste',
    );

    expect(txMock.order_items.update).toHaveBeenCalledWith({
      where: { id: ITEM_ID },
      data: expect.objectContaining({ cancellation_type: 'after_fire_waste' }),
    });
    expect(stockLevelManager.updateStock).not.toHaveBeenCalled();
  });

  it('falla fuerte si KitchenFireService no está cableado', async () => {
    const { service } = buildService({ withKds: false });

    await expect(
      service.cancelOrderItem(ORDER_ID, ITEM_ID, 'cliente se arrepintió'),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });
});

describe('OrderFlowService — charge-time shipping gate (A.2 CP-facturacion-fixes)', () => {
  const DTO: any = { store_payment_method_id: 1, payment_type: PaymentType.DIRECT };

  const buildService = (probe: any) => {
    const prismaMock: any = {
      orders: {
        findFirst: jest.fn().mockResolvedValue(probe),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const service = new OrderFlowService(
      prismaMock as unknown as StorePrismaService,
      {} as any,
      {} as any,
      { assertSessionForSales: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { logCustom: jest.fn().mockResolvedValue(undefined) } as any,
    );
    return { service, prismaMock };
  };

  const physicalProbe = (over: any = {}) => ({
    id: 1,
    state: 'created',
    customer_id: 5,
    store_id: 4,
    delivery_type: 'other',
    shipping_method_id: null,
    order_items: [
      { products: { product_type: 'physical' } },
    ],
    ...over,
  });

  it.each(['home_delivery', 'other'])(
    'blocks charging a %s order without shipping BEFORE the state claim',
    async (delivery_type) => {
      const { service, prismaMock } = buildService(
        physicalProbe({ delivery_type }),
      );

      await expect(service.payOrder(1, DTO)).rejects.toMatchObject({
        errorCode: ErrorCodes.ORD_SHIP_CHARGE_001.code,
      });
      // Read-only gate: the race claim was never taken.
      expect(prismaMock.orders.updateMany).not.toHaveBeenCalled();
    },
  );

  it('lets the charge through once a method is assigned', async () => {
    const { service, prismaMock } = buildService(
      physicalProbe({ shipping_method_id: 9 }),
    );

    try {
      await service.payOrder(1, DTO);
    } catch (e: any) {
      // Fails LATER (payment-method lookup unmocked here), never on the gate.
      expect(e?.errorCode).not.toBe(ErrorCodes.ORD_SHIP_CHARGE_001.code);
    }
    expect(prismaMock.orders.updateMany).toHaveBeenCalled();
  });

  it.each(['pickup', 'direct_delivery', 'dine_in'])(
    'does not block a %s order without shipping',
    async (delivery_type) => {
      const { service, prismaMock } = buildService(
        physicalProbe({ delivery_type }),
      );
      try {
        await service.payOrder(1, DTO);
      } catch (e: any) {
        // A later, unmocked payment step may reject; the shipping gate may not.
        expect(e?.errorCode).not.toBe(ErrorCodes.ORD_SHIP_CHARGE_001.code);
      }
      expect(prismaMock.orders.updateMany).toHaveBeenCalled();
    },
  );

  it('exempts services-only carts', async () => {
    const servicesOnly = buildService(
      physicalProbe({
        order_items: [{ products: { product_type: 'service' } }],
      }),
    );
    try {
      await servicesOnly.service.payOrder(1, DTO);
    } catch (e: any) {
      expect(e?.errorCode).not.toBe(ErrorCodes.ORD_SHIP_CHARGE_001.code);
    }
    expect(servicesOnly.prismaMock.orders.updateMany).toHaveBeenCalled();
  });
});

/**
 * Paso 2 sync cocina↔orden — propagación orden→cocina en
 * {@link OrderFlowService.deliverOrderItem} (DESPUÉS del stamp de
 * `delivered_at`, incluido el caso idempotente).
 *
 * Cubre: (a) ticket ready mono-ítem no-takeaway → deliver estampa el ítem,
 * cierra el ticket y emite el puente `kitchen.order_all_delivered` (el
 * listener mueve la orden `processing -> delivered` vía
 * `markKitchenOrderDelivered`); (b) ticket con hermano pendiente → solo la
 * fila del ítem cambia, ticket sigue abierto, sin evento; (c) ítem ya
 * delivered + fila ready (caso 6229) → reconcilia sin re-estampar;
 * (d) re-disparo en cocina (pending) → no toca; (e) sin filas → nada.
 *
 * Guards intactos: 404, idempotencia del stamp y ORDER_ITEM_NOT_DELIVERABLE
 * no se tocan — el sync es best-effort post-commit.
 */
describe('OrderFlowService.deliverOrderItem — sync orden→cocina (paso 2)', () => {
  const ORDER_ID = 2001;
  const ITEM_ID = 701;
  const STORE_ID = 4;
  const TICKET_ID = 55;

  const readyItem = (overrides: Record<string, unknown> = {}) => ({
    id: ITEM_ID,
    order_id: ORDER_ID,
    product_name: 'Pollo asado',
    item_type: 'prepared',
    delivered_at: null,
    kitchen_ticket_items: [{ id: 900, status: 'ready' }],
    ...overrides,
  });

  const buildService = (opts: {
    order?: Record<string, unknown>;
    // `undefined` → ítem base ready; `null` → ítem inexistente (404).
    item?: Record<string, unknown> | null;
    latestRow?: { id: number; status: string; kitchen_ticket_id: number } | null;
    // Filas del ticket VISTAS tras marcar la nuestra (el mock no muta solo).
    ticketRows?: Array<{ status: string }>;
    orderTickets?: Array<{ status: string }>;
  }) => {
    const eventEmitter = { emit: jest.fn(), emitAsync: jest.fn().mockResolvedValue([]) };
    const kitchenFireService = {
      emitTicketUpdatedEvent: jest.fn().mockResolvedValue(undefined),
    };
    const commitOrderLines = jest.fn().mockResolvedValue({ committedItemCount: 1, totalCost: 0 });
    const orderView = {
      id: ORDER_ID,
      store_id: STORE_ID,
      state: 'processing',
      delivery_type: 'direct_delivery',
      ...(opts.order ?? {}),
    };
    const prismaMock: any = {
      $transaction: jest.fn(async (callback: any) => callback(prismaMock)),
      order_items: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            opts.item === undefined ? readyItem() : opts.item,
          ),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      kitchen_ticket_items: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            opts.latestRow === undefined ? null : opts.latestRow,
          ),
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue(opts.ticketRows ?? []),
      },
      kitchen_tickets: {
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue(opts.orderTickets ?? []),
      },
    };
    const service = new OrderFlowService(
      prismaMock as unknown as StorePrismaService,
      eventEmitter as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { commitOrderLines } as any,
      { logCustom: jest.fn().mockResolvedValue(undefined) } as any,
      kitchenFireService as any,
    );
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(orderView);
    return { service, prismaMock, eventEmitter, kitchenFireService, orderView, commitOrderLines };
  };

  it('rechaza entrega de plato physical aún pendiente en cocina sin mover stock ni sello', async () => {
    const { service, prismaMock, commitOrderLines } = buildService({
      item: readyItem({
        item_type: 'physical',
        products: { product_type: 'prepared' },
        skip_kds: false,
        kitchen_ticket_items: [{ id: 900, status: 'pending' }],
      }),
    });

    await expect(service.deliverOrderItem(ORDER_ID, ITEM_ID)).rejects.toMatchObject({
      errorCode: ErrorCodes.ORDER_ITEM_NOT_DELIVERABLE.code,
    });
    expect(commitOrderLines).not.toHaveBeenCalled();
    expect(prismaMock.order_items.updateMany).not.toHaveBeenCalled();
  });

  it('faltante al entregar no estampa delivered_at ni actualiza cocina', async () => {
    const { service, prismaMock, commitOrderLines } = buildService({});
    commitOrderLines.mockRejectedValueOnce(new VendixHttpException(ErrorCodes.INV_STOCK_002));

    await expect(service.deliverOrderItem(ORDER_ID, ITEM_ID)).rejects.toMatchObject({
      errorCode: 'INV_STOCK_002',
    });
    expect(prismaMock.order_items.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.kitchen_ticket_items.update).not.toHaveBeenCalled();
  });

  it('entregar un ítem hace commit solo de esa línea antes de estamparla', async () => {
    const { service, prismaMock, commitOrderLines } = buildService({});

    await service.deliverOrderItem(ORDER_ID, ITEM_ID);

    expect(commitOrderLines).toHaveBeenCalledWith(ORDER_ID, [ITEM_ID],
      expect.objectContaining({ blockOnInsufficient: true }));
    expect(commitOrderLines.mock.invocationCallOrder[0]).toBeLessThan(
      prismaMock.order_items.updateMany.mock.invocationCallOrder[0],
    );
  });

  it('(a) ticket ready mono-ítem no-takeaway → estampa, cierra ticket y emite puente', async () => {
    const { service, prismaMock, eventEmitter, kitchenFireService, orderView } = buildService({
      latestRow: { id: 900, status: 'ready', kitchen_ticket_id: TICKET_ID },
      ticketRows: [{ status: 'delivered' }],
      orderTickets: [{ status: 'delivered' }],
    });

    const result = await service.deliverOrderItem(ORDER_ID, ITEM_ID);

    // Stamp del ítem (el hecho de servicio).
    expect(prismaMock.order_items.updateMany).toHaveBeenCalledWith({
      where: { id: ITEM_ID, order_id: ORDER_ID },
      data: expect.objectContaining({ delivered_at: expect.any(Date) }),
    });
    // Solo LA fila del ítem pasa a delivered.
    expect(prismaMock.kitchen_ticket_items.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.kitchen_ticket_items.update).toHaveBeenCalledWith({
      where: { id: 900 },
      data: expect.objectContaining({ status: 'delivered' }),
    });
    // Ticket todo-terminal + ≥1 delivered → se cierra en delivered.
    expect(prismaMock.kitchen_tickets.update).toHaveBeenCalledWith({
      where: { id: TICKET_ID },
      data: expect.objectContaining({ status: 'delivered' }),
    });
    expect(kitchenFireService.emitTicketUpdatedEvent).toHaveBeenCalledWith(TICKET_ID);
    // Puente all-terminal (mismo criterio que markDelivered): el listener
    // mueve la orden `processing -> delivered`.
    expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'kitchen.order_all_delivered',
      { orderId: ORDER_ID, storeId: STORE_ID },
    );
    // Contrato intacto: devuelve la vista de la orden.
    expect(result).toEqual(orderView);
  });

  it('(b) ticket con hermano pendiente → solo la fila del ítem cambia, sin evento', async () => {
    const { service, prismaMock, eventEmitter, kitchenFireService } = buildService({
      latestRow: { id: 900, status: 'ready', kitchen_ticket_id: TICKET_ID },
      ticketRows: [{ status: 'delivered' }, { status: 'pending' }],
      orderTickets: [{ status: 'ready' }],
    });

    await service.deliverOrderItem(ORDER_ID, ITEM_ID);

    expect(prismaMock.order_items.updateMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.kitchen_ticket_items.update).toHaveBeenCalledWith({
      where: { id: 900 },
      data: expect.objectContaining({ status: 'delivered' }),
    });
    // El ticket sigue abierto (hermano pendiente) → no se cierra ni se emite.
    expect(prismaMock.kitchen_tickets.update).not.toHaveBeenCalled();
    expect(kitchenFireService.emitTicketUpdatedEvent).toHaveBeenCalledWith(TICKET_ID);
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });

  it('(c) ítem ya delivered + fila ready (caso 6229) → reconcilia sin re-estampar', async () => {
    const STAMP = new Date('2026-09-10T12:00:00.000Z');
    const { service, prismaMock, eventEmitter } = buildService({
      item: readyItem({ delivered_at: STAMP }),
      latestRow: { id: 900, status: 'ready', kitchen_ticket_id: TICKET_ID },
      ticketRows: [{ status: 'delivered' }],
      orderTickets: [{ status: 'delivered' }],
    });

    await service.deliverOrderItem(ORDER_ID, ITEM_ID);

    // Idempotencia del stamp: la primera entrega es la que ocurrió.
    expect(prismaMock.order_items.updateMany).not.toHaveBeenCalled();
    // Pero sí sincroniza: fila → delivered, ticket cierra, puente emite.
    expect(prismaMock.kitchen_ticket_items.update).toHaveBeenCalledWith({
      where: { id: 900 },
      data: expect.objectContaining({ status: 'delivered' }),
    });
    expect(prismaMock.kitchen_tickets.update).toHaveBeenCalledWith({
      where: { id: TICKET_ID },
      data: expect.objectContaining({ status: 'delivered' }),
    });
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'kitchen.order_all_delivered',
      { orderId: ORDER_ID, storeId: STORE_ID },
    );
  });

  it('(d) re-disparo en cocina (fila pending) → no toca cocina ni emite', async () => {
    const STAMP = new Date('2026-09-10T12:00:00.000Z');
    const { service, prismaMock, eventEmitter, orderView } = buildService({
      item: readyItem({ delivered_at: STAMP }),
      latestRow: { id: 901, status: 'pending', kitchen_ticket_id: TICKET_ID },
      ticketRows: [{ status: 'pending' }],
      orderTickets: [{ status: 'pending' }],
    });

    const result = await service.deliverOrderItem(ORDER_ID, ITEM_ID);

    expect(prismaMock.kitchen_ticket_items.update).not.toHaveBeenCalled();
    expect(prismaMock.kitchen_tickets.update).not.toHaveBeenCalled();
    expect(eventEmitter.emit).not.toHaveBeenCalled();
    expect(result).toEqual(orderView);
  });

  it('(dispatch) reconciles a pending kitchen row after physical delivery without a KDS order-state bridge', async () => {
    const { service, prismaMock, eventEmitter } = buildService({
      latestRow: { id: 901, status: 'pending', kitchen_ticket_id: TICKET_ID },
      ticketRows: [{ status: 'delivered' }],
      orderTickets: [{ status: 'delivered' }],
    });
    prismaMock.orders = {
      findFirst: jest.fn().mockResolvedValue({ id: ORDER_ID }),
    };
    prismaMock.order_items.findMany = jest.fn().mockResolvedValue([{ id: ITEM_ID }]);

    await (service as any).reconcileKitchenAfterDispatch(ORDER_ID, STORE_ID);

    expect(prismaMock.orders.findFirst).toHaveBeenCalledWith({
      where: { id: ORDER_ID, store_id: STORE_ID },
      select: { id: true },
    });
    expect(prismaMock.order_items.findMany).toHaveBeenCalledWith({
      where: {
        order_id: ORDER_ID,
        delivered_at: { not: null },
        cancelled_at: null,
        kitchen_ticket_items: { some: {} },
      },
      select: { id: true },
    });
    expect(prismaMock.kitchen_ticket_items.update).toHaveBeenCalledWith({
      where: { id: 901 },
      data: expect.objectContaining({ status: 'delivered' }),
    });
    expect(prismaMock.kitchen_tickets.update).toHaveBeenCalledWith({
      where: { id: TICKET_ID },
      data: expect.objectContaining({ status: 'delivered' }),
    });
    expect(prismaMock.order_items.updateMany).not.toHaveBeenCalled();
    expect(eventEmitter.emit).not.toHaveBeenCalledWith(
      'kitchen.order_all_delivered',
      expect.anything(),
    );
  });

  it('(dispatch) does not project kitchen for an order outside the explicit store', async () => {
    const { service, prismaMock } = buildService({});
    prismaMock.orders = { findFirst: jest.fn().mockResolvedValue(null) };
    prismaMock.order_items.findMany = jest.fn();

    await service.reconcileKitchenAfterDispatch(ORDER_ID, STORE_ID);

    expect(prismaMock.order_items.findMany).not.toHaveBeenCalled();
    expect(prismaMock.kitchen_ticket_items.update).not.toHaveBeenCalled();
  });

  it('(e) sin filas de cocina → nada que hacer, contrato intacto', async () => {
    const { service, prismaMock, eventEmitter, orderView } = buildService({
      item: {
        ...readyItem(),
        item_type: 'physical',
        kitchen_ticket_items: [],
      },
      latestRow: null,
    });

    const result = await service.deliverOrderItem(ORDER_ID, ITEM_ID);

    expect(prismaMock.order_items.updateMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.kitchen_ticket_items.update).not.toHaveBeenCalled();
    expect(prismaMock.kitchen_tickets.update).not.toHaveBeenCalled();
    expect(eventEmitter.emit).not.toHaveBeenCalled();
    expect(result).toEqual(orderView);
  });

  it('un plato pendiente rechaza sin escribir y dirige al operador al KDS', async () => {
    const { service, prismaMock } = buildService({
      item: readyItem({ kitchen_ticket_items: [{ id: 901, status: 'pending' }] }),
    });

    await expect(service.deliverOrderItem(ORDER_ID, ITEM_ID)).rejects.toMatchObject({
      errorCode: ErrorCodes.ORDER_ITEM_NOT_DELIVERABLE.code,
      message: expect.stringMatching(/KDS/),
    });
    expect(prismaMock.order_items.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.kitchen_ticket_items.update).not.toHaveBeenCalled();
  });
});

/**
 * 1060 paso 1 — guarda de entregado en {@link OrderFlowService.cancelOrderItem}.
 *
 * Un ítem con `delivered_at != null` es un hecho de servicio consumado: la
 * cancelación normal lo rechaza con `ITEM_ALREADY_DELIVERED` (409) SIN mutar
 * nada (sin tx, sin KDS, sin stock, sin soft cancel). Cubre mesa, legacy y
 * detalle porque las tres rutas pasan por este seam.
 */
describe('OrderFlowService.cancelOrderItem — guarda delivered (1060 paso 1)', () => {
  const ORDER_ID = 3017;
  const ITEM_ID = 701;

  const deliveredItem = (overrides: Record<string, unknown> = {}) => ({
    id: ITEM_ID,
    product_name: 'Pollo asado',
    inventory_consumed_at_fire: false,
    cancelled_at: null,
    delivered_at: new Date('2026-09-10T12:00:00.000Z'),
    kitchen_ticket_items: [],
    ...overrides,
  });

  const buildService = (item: Record<string, unknown>) => {
    const txMock: any = {
      kitchen_tickets: { findFirst: jest.fn() },
      inventory_transactions: { findMany: jest.fn().mockResolvedValue([]) },
      order_items: {
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
      orders: { update: jest.fn().mockResolvedValue({}) },
    };
    const prismaMock: any = {
      order_items: { findFirst: jest.fn().mockResolvedValue(item) },
      $transaction: jest.fn((cb: any) => cb(txMock)),
    };
    const kitchenFireService = {
      cancelTicketItemInTx: jest.fn().mockResolvedValue('cancelled'),
      emitTicketCancelledEvent: jest.fn().mockResolvedValue(undefined),
    };
    const service = new OrderFlowService(
      prismaMock as unknown as StorePrismaService,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { logCustom: jest.fn().mockResolvedValue(undefined) } as any,
      kitchenFireService as any,
    );
    jest
      .spyOn(service as any, 'getOrder')
      .mockResolvedValue({ id: ORDER_ID, state: 'created' });
    return { service, prismaMock, txMock, kitchenFireService };
  };

  it('409 ITEM_ALREADY_DELIVERED sin mutación (ruta por defecto)', async () => {
    const { service, prismaMock, txMock, kitchenFireService } = buildService(
      deliveredItem(),
    );

    await expect(
      service.cancelOrderItem(ORDER_ID, ITEM_ID, 'cliente se arrepintió'),
    ).rejects.toMatchObject({ errorCode: 'ITEM_ALREADY_DELIVERED' });

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(txMock.order_items.update).not.toHaveBeenCalled();
    expect(txMock.orders.update).not.toHaveBeenCalled();
    expect(kitchenFireService.cancelTicketItemInTx).not.toHaveBeenCalled();
    expect(kitchenFireService.emitTicketCancelledEvent).not.toHaveBeenCalled();
  });

  it('409 ITEM_ALREADY_DELIVERED sin mutación (ruta con cancellation_type explícito)', async () => {
    const { service, prismaMock, txMock } = buildService(deliveredItem());

    await expect(
      service.cancelOrderItem(
        ORDER_ID,
        ITEM_ID,
        'merma pactada con el dueño',
        'after_fire_waste',
      ),
    ).rejects.toMatchObject({ errorCode: 'ITEM_ALREADY_DELIVERED' });

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(txMock.order_items.update).not.toHaveBeenCalled();
  });

  it('el conflicto de estado domina: entregado + motivo corto sigue siendo 409', async () => {
    const { service, prismaMock } = buildService(deliveredItem());

    await expect(
      service.cancelOrderItem(ORDER_ID, ITEM_ID, 'x'),
    ).rejects.toMatchObject({ errorCode: 'ITEM_ALREADY_DELIVERED' });

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});

/**
 * 1060 paso 2 — reversa de entrega {@link OrderFlowService.cancelDeliveredOrderItem}.
 *
 * Único camino para cancelar un ítem ya entregado: exige motivo (mín 3) y
 * destino (`restock` | `waste`). `restock` devuelve las unidades al stock vía
 * `StockLevelManager`; `waste` no toca stock (la merma queda auditada). Ambas
 * escriben `audit_logs` (`order_item.cancel_delivered` con usuario, motivo y
 * destino) y devuelven la vista de la orden.
 */
describe('OrderFlowService.cancelDeliveredOrderItem — reversa (1060 paso 2)', () => {
  const ORDER_ID = 4017;
  const ITEM_ID = 801;

  const deliveredItem = (overrides: Record<string, unknown> = {}) => ({
    id: ITEM_ID,
    product_id: 11,
    product_variant_id: null,
    product_name: 'Pollo asado',
    quantity: 2,
    stock_units_consumed: 2,
    inventory_committed: true,
    delivered_at: new Date('2026-09-10T12:00:00.000Z'),
    cancelled_at: null,
    // H2/H4 — `cancelDeliveredOrderItem` now selects this to resolve the
    // ticket the item was fired under; default to "no ticket resolvable"
    // (legacy/untracked row) unless a test overrides it.
    kitchen_ticket_items: [],
    ...overrides,
  });

  const buildService = (opts: {
    order?: Record<string, unknown>;
    item?: Record<string, unknown> | null;
    activeItems?: Array<{
      total_price: number;
      order_item_taxes?: Array<{ tax_amount: number | null }>;
    }>;
  }) => {
    const txMock: any = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: ORDER_ID, state: 'created' }]),
      // Sincronía cancelado orden↔cocina: sin fila KDS viva por defecto.
      kitchen_ticket_items: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      payments: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      order_items: {
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue(
          opts.activeItems ?? [{ total_price: 30000, order_item_taxes: [] }],
        ),
      },
      orders: {
        findFirst: jest.fn().mockResolvedValue({ active_financial_split_id: null }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const prismaMock: any = {
      order_items: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            opts.item === undefined ? deliveredItem() : opts.item,
          ),
      },
      $transaction: jest.fn((cb: any) => cb(txMock)),
    };
    const stockLevelManager = {
      getDefaultLocationForProduct: jest.fn().mockResolvedValue(1),
      updateStock: jest.fn().mockResolvedValue({}),
      releaseReservationQuantity: jest.fn().mockResolvedValue(0),
    };
    const auditService = { logCustom: jest.fn().mockResolvedValue(undefined) };
    const service = new OrderFlowService(
      prismaMock as unknown as StorePrismaService,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      stockLevelManager as any,
      {} as any,
      {} as any,
      auditService as any,
    );
    const orderView = {
      id: ORDER_ID,
      state: 'created',
      store_id: 4,
      ...(opts.order ?? {}),
    };
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(orderView);
    return { service, prismaMock, txMock, stockLevelManager, auditService };
  };

  it.each(['succeeded', 'captured', 'partially_refunded', 'refunded'])(
    '409 tipado si hay pago %s, sin tocar totales, stock ni auditoría',
    async (state) => {
      const { service, prismaMock, stockLevelManager, auditService } = buildService({
        order: { state: 'finished', payments: [{ state }] },
      });

      await expect(service.cancelDeliveredOrderItem(
        ORDER_ID, ITEM_ID, 'mosca en el plato', 'waste',
      )).rejects.toMatchObject({ errorCode: 'ORD_ITEM_CANCEL_PAID_001' });
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
      expect(stockLevelManager.updateStock).not.toHaveBeenCalled();
      expect(auditService.logCustom).not.toHaveBeenCalled();
    },
  );

  it('no reversa una línea entregada mientras exista split financiero activo', async () => {
    const { service, prismaMock, stockLevelManager } = buildService({
      order: { state: 'created', active_financial_split_id: 3, payments: [] },
    });

    await expect(service.cancelDeliveredOrderItem(
      ORDER_ID, ITEM_ID, 'cliente se arrepintió', 'waste',
    )).rejects.toMatchObject({ errorCode: 'SPLIT_ACCOUNT_LOCKED' });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(stockLevelManager.updateStock).not.toHaveBeenCalled();
  });

  it('relee el split bajo lock antes de reversar una entrega', async () => {
    const { service, txMock, stockLevelManager } = buildService({
      order: { state: 'created', active_financial_split_id: null, payments: [] },
    });
    txMock.orders.findFirst.mockResolvedValueOnce({ active_financial_split_id: 3 });

    await expect(service.cancelDeliveredOrderItem(
      ORDER_ID, ITEM_ID, 'cliente se arrepintió', 'restock',
    )).rejects.toMatchObject({ errorCode: 'SPLIT_ACCOUNT_LOCKED' });
    expect(stockLevelManager.updateStock).not.toHaveBeenCalled();
    expect(txMock.order_items.update).not.toHaveBeenCalled();
  });

  it('si el cobro entra tras la prelectura, no reversa entrega ni stock', async () => {
    const { service, txMock, stockLevelManager } = buildService({
      order: { state: 'created', payments: [] },
    });
    txMock.payments.findFirst.mockResolvedValueOnce({ id: 81 });

    await expect(service.cancelDeliveredOrderItem(
      ORDER_ID, ITEM_ID, 'cliente se arrepintió', 'restock',
    )).rejects.toMatchObject({ errorCode: 'ORD_ITEM_CANCEL_PAID_001' });
    expect(stockLevelManager.updateStock).not.toHaveBeenCalled();
    expect(txMock.order_items.update).not.toHaveBeenCalled();
  });

  it.each(['cancelled', 'refunded', 'finished'])(
    '409 tipado para estado terminal %s sin pago',
    async (state) => {
      const { service, prismaMock } = buildService({ order: { state, payments: [] } });
      const error = await service.cancelDeliveredOrderItem(
        ORDER_ID, ITEM_ID, 'mosca en el plato', 'waste',
      ).catch((caught) => caught);

      expect(error.errorCode).toBe('ORD_ITEM_CANCEL_STATE_001');
      expect(error.getResponse()).toMatchObject({ details: { state } });
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    },
  );

  it('prioriza el estado refunded aunque conserve un pago reembolsado', async () => {
    const { service, prismaMock, stockLevelManager } = buildService({
      order: { state: 'refunded', payments: [{ state: 'refunded' }] },
    });
    const error = await service.cancelDeliveredOrderItem(
      ORDER_ID, ITEM_ID, 'reversa sobre reembolso', 'waste',
    ).catch((caught) => caught);

    expect(error.errorCode).toBe('ORD_ITEM_CANCEL_STATE_001');
    expect(error.getResponse()).toMatchObject({ details: { state: 'refunded' } });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(stockLevelManager.updateStock).not.toHaveBeenCalled();
  });

  it('pago pendiente no impide cancelar un plato de cuenta abierta', async () => {
    const { service, prismaMock } = buildService({
      order: { state: 'processing', payments: [{ state: 'pending' }] },
    });
    await service.cancelDeliveredOrderItem(
      ORDER_ID, ITEM_ID, 'mosca en el plato', 'waste',
    );
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  it('reprecio COD pendiente al reversar una línea entregada sin cobrar', async () => {
    const { service, txMock } = buildService({
      order: {
        state: 'delivered', shipping_cost: 5000,
        payments: [{
          id: 92, state: 'pending', amount: 71000,
          store_payment_method: {
            system_payment_method: { processing_mode: 'ON_DELIVERY' },
          },
        }],
      },
      activeItems: [{ total_price: 38000, order_item_taxes: [] }],
    });

    await service.cancelDeliveredOrderItem(
      ORDER_ID, ITEM_ID, 'plato devuelto sin cobro', 'waste',
    );

    expect(Number(txMock.orders.update.mock.calls[0][0].data.grand_total)).toBe(43000);
    expect(txMock.payments.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [92] }, order_id: ORDER_ID, state: 'pending' },
      data: { amount: expect.anything(), updated_at: expect.any(Date) },
    });
    expect(Number(txMock.payments.updateMany.mock.calls[0][0].data.amount)).toBe(43000);
  });

  it('restock: devuelve stock, cancela suave y audita con destino', async () => {
    const { service, txMock, stockLevelManager, auditService } = buildService(
      {},
    );

    const result = await service.cancelDeliveredOrderItem(
      ORDER_ID,
      ITEM_ID,
      'el cliente devolvió el plato intacto',
      'restock',
    );

    // Destino aplicado: las 2 unidades vuelven al stock como `return`.
    expect(
      stockLevelManager.getDefaultLocationForProduct,
    ).toHaveBeenCalledWith(11, undefined);
    expect(stockLevelManager.updateStock).toHaveBeenCalledTimes(1);
    expect(stockLevelManager.updateStock.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        product_id: 11,
        quantity_change: 2,
        movement_type: 'return',
        source_module: 'order_item_cancel_delivered',
        create_movement: true,
        validate_availability: false,
      }),
    );
    // Soft cancel con el tipo contable de la reversa. D.2+D.3: vocabulario
    // canónico — la reversa de entrega escribe after_fire_* (el remake lo
    // exige); 'before_fire' era el contrato pre-D.2 de 1060 paso 2.
    expect(txMock.order_items.update).toHaveBeenCalledWith({
      where: { id: ITEM_ID },
      data: expect.objectContaining({
        cancellation_reason: 'el cliente devolvió el plato intacto',
        cancellation_type: 'after_fire_reused',
        updated_at: expect.any(Date),
      }),
    });
    // Auditoría con usuario, motivo y destino.
    expect(auditService.logCustom).toHaveBeenCalledTimes(1);
    expect(auditService.logCustom.mock.calls[0][1]).toBe(
      'order_item.cancel_delivered',
    );
    expect(auditService.logCustom.mock.calls[0][3]).toEqual(
      expect.objectContaining({
        order_id: ORDER_ID,
        order_item_id: ITEM_ID,
        reason: 'el cliente devolvió el plato intacto',
        destination: 'restock',
      }),
    );
    expect((result as any).id).toBe(ORDER_ID);
  });

  it('entrega no comprometida libera reserva sin inventar stock', async () => {
    const { service, stockLevelManager, txMock } = buildService({
      item: deliveredItem({ inventory_committed: false, stock_units_consumed: 3 }),
    });

    await service.cancelDeliveredOrderItem(ORDER_ID, ITEM_ID, 'sin stock físico', 'restock');

    expect(stockLevelManager.updateStock).not.toHaveBeenCalled();
    expect(stockLevelManager.releaseReservationQuantity).toHaveBeenCalledWith(
      'order', ORDER_ID, 11, undefined, 3, 'cancelled', txMock,
    );
  });

  it('restock comprometido devuelve stock_units_consumed y no la cantidad lógica', async () => {
    const { service, stockLevelManager } = buildService({
      item: deliveredItem({ inventory_committed: true, stock_units_consumed: 6 }),
    });

    await service.cancelDeliveredOrderItem(ORDER_ID, ITEM_ID, 'devolución', 'restock');

    expect(stockLevelManager.updateStock).toHaveBeenCalledWith(
      expect.objectContaining({ quantity_change: 6 }),
      expect.anything(),
    );
    expect(stockLevelManager.releaseReservationQuantity).not.toHaveBeenCalled();
  });

  it('waste: NO toca stock, deja merma auditada', async () => {
    const { service, txMock, stockLevelManager, auditService } = buildService(
      {},
    );

    await service.cancelDeliveredOrderItem(
      ORDER_ID,
      ITEM_ID,
      'se cayó el plato al llevarlo',
      'waste',
    );

    expect(stockLevelManager.updateStock).not.toHaveBeenCalled();
    expect(
      stockLevelManager.getDefaultLocationForProduct,
    ).not.toHaveBeenCalled();
    expect(txMock.order_items.update).toHaveBeenCalledWith({
      where: { id: ITEM_ID },
      data: expect.objectContaining({ cancellation_type: 'after_fire_waste' }),
    });
    expect(auditService.logCustom).toHaveBeenCalledTimes(1);
    expect(auditService.logCustom.mock.calls[0][3]).toEqual(
      expect.objectContaining({ destination: 'waste' }),
    );
  });

  it('422 si el motivo tiene menos de 3 caracteres (sin mutación)', async () => {
    const { service, prismaMock, stockLevelManager, auditService } =
      buildService({});

    await expect(
      service.cancelDeliveredOrderItem(ORDER_ID, ITEM_ID, 'x', 'restock'),
    ).rejects.toMatchObject({
      errorCode: 'TABLE_SESSION_ADD_ITEMS_INVALID',
    });

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(stockLevelManager.updateStock).not.toHaveBeenCalled();
    expect(auditService.logCustom).not.toHaveBeenCalled();
  });

  it('422 si el destino no es restock|waste (sin mutación)', async () => {
    const { service, prismaMock, stockLevelManager, auditService } =
      buildService({});

    await expect(
      service.cancelDeliveredOrderItem(
        ORDER_ID,
        ITEM_ID,
        'motivo válido pero destino no',
        'invalid' as any,
      ),
    ).rejects.toMatchObject({
      errorCode: 'TABLE_SESSION_ADD_ITEMS_INVALID',
    });

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(stockLevelManager.updateStock).not.toHaveBeenCalled();
    expect(auditService.logCustom).not.toHaveBeenCalled();
  });

  it('409 si el ítem no está entregado (sin mutación)', async () => {
    const { service, prismaMock, stockLevelManager, auditService } =
      buildService({ item: deliveredItem({ delivered_at: null }) });

    await expect(
      service.cancelDeliveredOrderItem(
        ORDER_ID,
        ITEM_ID,
        'no hay entrega que reversar',
        'waste',
      ),
    ).rejects.toMatchObject({
      errorCode: 'TABLE_SESSION_ITEM_NOT_REMOVABLE',
    });

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(stockLevelManager.updateStock).not.toHaveBeenCalled();
    expect(auditService.logCustom).not.toHaveBeenCalled();
  });

  it('404 si el ítem no pertenece a la orden', async () => {
    const { service, prismaMock } = buildService({ item: null });

    await expect(
      service.cancelDeliveredOrderItem(ORDER_ID, 999999, 'motivo válido', 'waste'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('idempotencia: ítem ya cancelado devuelve la vista sin reescribir ni auditar', async () => {
    const { service, prismaMock, stockLevelManager, auditService } =
      buildService({
        item: deliveredItem({
          cancelled_at: new Date('2026-09-01T12:00:00.000Z'),
        }),
      });

    const result = await service.cancelDeliveredOrderItem(
      ORDER_ID,
      ITEM_ID,
      'segundo intento',
      'restock',
    );

    expect((result as any).id).toBe(ORDER_ID);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(stockLevelManager.updateStock).not.toHaveBeenCalled();
    expect(auditService.logCustom).not.toHaveBeenCalled();
  });
});

describe('D.2 — cancelación de una línea prepared ya consumida', () => {
  const orderId = 5017;
  const itemId = 901;
  const leaves = [
    { id: 31, product_id: 701, product_variant_id: null, quantity_change: -2, unit_cost: 7, total_cost: 14 },
    { id: 32, product_id: 702, product_variant_id: 91, quantity_change: -3, unit_cost: 5, total_cost: 15 },
    { id: 33, product_id: 703, product_variant_id: null, quantity_change: -1, unit_cost: null, total_cost: null },
  ];
  const harness = (delivered: boolean, destination: 'restock' | 'waste', options: {
    accountingFailure?: boolean;
    accountingDisabled?: boolean;
    alreadyCancelledInTx?: boolean;
    zeroCost?: boolean;
    paid?: boolean;
    missingOrganization?: boolean;
    unfired?: boolean;
  } = {}) => {
    const item = {
      id: itemId, product_id: 333, product_variant_id: null,
      product_name: 'Plato', quantity: 1, cancelled_at: null,
      delivered_at: delivered ? new Date() : null,
      inventory_consumed_at_fire: !options.unfired,
      products: { product_type: 'prepared' },
      kitchen_ticket_items: [],
    };
    const tx: any = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: orderId, state: 'created' }]),
      // Sincronía cancelado orden↔cocina: sin fila KDS viva por defecto.
      kitchen_ticket_items: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      orders: { findFirst: jest.fn().mockResolvedValue({ active_financial_split_id: null }), update: jest.fn() },
      payments: { findFirst: jest.fn().mockResolvedValue(null) },
      order_items: {
        findFirst: jest.fn().mockResolvedValue({ cancelled_at: options.alreadyCancelledInTx ? new Date() : null }),
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([{ total_price: 10000, order_item_taxes: [{ tax_amount: 1900 }] }]),
      },
      inventory_transactions: { findMany: jest.fn().mockResolvedValue(
        options.unfired ? [] : options.zeroCost
          ? leaves.map((leaf) => ({ ...leaf, unit_cost: null, total_cost: null })) : leaves,
      ) },
      inventory_cost_layers: { create: jest.fn().mockResolvedValue({ id: 1 }) },
      audit_logs: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 99 }) },
    };
    const prisma: any = {
      order_items: { findFirst: jest.fn().mockResolvedValue(item) },
      $transaction: jest.fn((fn: any) => fn(tx)),
    };
    const stock = {
      getDefaultLocationForProduct: jest.fn()
        .mockImplementation(async (productId: number, variantId?: number) => {
          if (destination === 'waste') throw new Error('No default location');
          return productId === 702 && variantId === 91 ? 82 : 81;
        }),
      updateStock: jest.fn().mockResolvedValue({}),
    };
    const events = { emit: jest.fn(), emitAsync: jest.fn().mockResolvedValue([]) };
    const accounting = {
      onPreparedDishDisposition: jest.fn().mockImplementation(async () => {
        if (options.accountingFailure) throw new Error('Ledger unavailable');
        if (options.accountingDisabled) return null;
        return { id: 991 };
      }),
    };
    const audit = { logCustom: jest.fn().mockResolvedValue(undefined) };
    const service = new OrderFlowService(
      prisma, events as any, {} as any, {} as any, {} as any,
      stock as any, {} as any, {} as any, audit as any,
      { cancelTicketItemInTx: jest.fn(), emitTicketCancelledEvent: jest.fn() } as any,
      undefined, undefined, undefined, accounting as any,
    );
    jest.spyOn(service, 'getOrder').mockResolvedValue({
      id: orderId, store_id: 4,
      stores: { organization_id: options.missingOrganization ? null : 2 },
      state: 'created', payments: options.paid ? [{ state: 'succeeded' }] : [],
      shipping_cost: 500, tip_amount: 100, discount_amount: 50,
    } as any);
    const cancel = () => delivered
      ? service.cancelDeliveredOrderItem(orderId, itemId, 'motivo válido', destination)
      : service.cancelOrderItem(orderId, itemId, 'motivo válido',
          destination === 'restock' ? 'after_fire_reused' : 'after_fire_waste');
    return { cancel, tx, stock, events, audit, accounting, item, service };
  };

  it.each([false, true])('reuse delivered=%s devuelve SOLO hojas reales y excluye el plato del total', async (delivered) => {
    const { cancel, tx, stock, events, accounting } = harness(delivered, 'restock');
    await cancel();
    expect(tx.inventory_transactions.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { order_item_id: itemId, quantity_change: { lt: 0 } },
    }));
    expect(stock.updateStock).toHaveBeenCalledTimes(3);
    expect(tx.inventory_cost_layers.create).toHaveBeenCalledTimes(3);
    expect(tx.inventory_cost_layers.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      organization_id: 2, product_id: 702, product_variant_id: 91,
      location_id: 82, quantity_remaining: 3, unit_cost: new Prisma.Decimal(5),
    }) });
    expect(stock.updateStock.mock.calls.map(([p]) => [p.product_id, p.variant_id, p.location_id, p.quantity_change]))
      .toEqual([[701, undefined, 81, 2], [702, 91, 82, 3], [703, undefined, 81, 1]]);
    expect(stock.updateStock.mock.calls.every(([p]) =>
      p.movement_type === 'return' && p.order_item_id === undefined && p.product_id !== 333)).toBe(true);
    expect(events.emit).not.toHaveBeenCalledWith('order_item.prepared_waste', expect.anything());
    expect(accounting.onPreparedDishDisposition).toHaveBeenCalledWith(expect.objectContaining({
      organization_id: 2, disposition: 'reuse', total_cost: 29,
    }));
    expect(tx.orders.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ subtotal_amount: new Prisma.Decimal(10000), grand_total: new Prisma.Decimal(12450) }),
    }));
    expect(tx.audit_logs.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      metadata: expect.objectContaining({ destination: 'reuse', leaves: expect.arrayContaining([
        expect.objectContaining({ product_id: 702, product_variant_id: 91, quantity: 3 }),
      ]) }),
    }) });
  });

  it.each([false, true])('waste delivered=%s reclasifica costo sin segundo descuento', async (delivered) => {
    const { cancel, tx, stock, events, accounting } = harness(delivered, 'waste');
    await cancel();
    expect(stock.updateStock).not.toHaveBeenCalled();
    expect(tx.inventory_cost_layers.create).not.toHaveBeenCalled();
    expect(stock.getDefaultLocationForProduct).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalledWith('order_item.prepared_waste', expect.anything());
    expect(accounting.onPreparedDishDisposition).toHaveBeenCalledWith(expect.objectContaining({
      order_item_id: itemId, organization_id: 2, disposition: 'waste', total_cost: 29,
    }));
    expect(tx.audit_logs.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      metadata: expect.objectContaining({ destination: 'waste', leaves: expect.arrayContaining([
        expect.objectContaining({ product_id: 703, unknown_cost: true }),
      ]) }),
    }) });
    expect(tx.orders.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ grand_total: new Prisma.Decimal(12450) }),
    }));
  });

  it('fallo contable activo deja la cancelación y auditoría persistidas para reparación', async () => {
    const { cancel, tx } = harness(true, 'waste', { accountingFailure: true });
    await expect(cancel()).resolves.toMatchObject({ id: orderId });
    expect(tx.order_items.update).toHaveBeenCalledTimes(1);
    expect(tx.orders.update).toHaveBeenCalledTimes(1);
    expect(tx.audit_logs.create).toHaveBeenCalledTimes(1);
  });

  it.each(['restock', 'waste'] as const)('contabilidad inactiva no bloquea %s', async (destination) => {
    const { cancel, tx, accounting, stock } = harness(true, destination, { accountingDisabled: true });
    await expect(cancel()).resolves.toMatchObject({ id: orderId });
    expect(tx.order_items.update).toHaveBeenCalledTimes(1);
    expect(tx.audit_logs.create).toHaveBeenCalledTimes(1);
    expect(accounting.onPreparedDishDisposition).toHaveBeenCalledTimes(1);
    expect(stock.updateStock).toHaveBeenCalledTimes(destination === 'restock' ? 3 : 0);
  });

  it('relectura bajo lock hace replay idempotente antes de stock o asiento', async () => {
    const { cancel, tx, stock, accounting } = harness(true, 'restock', { alreadyCancelledInTx: true });
    await cancel();
    expect(tx.inventory_transactions.findMany).not.toHaveBeenCalled();
    expect(stock.updateStock).not.toHaveBeenCalled();
    expect(tx.inventory_cost_layers.create).not.toHaveBeenCalled();
    expect(accounting.onPreparedDishDisposition).not.toHaveBeenCalled();
    expect(tx.order_items.update).not.toHaveBeenCalled();
  });

  it('costo cero no postea asiento pero la auditoría conserva las hojas desconocidas', async () => {
    const { cancel, tx, stock, accounting } = harness(true, 'waste', { zeroCost: true });
    await cancel();
    expect(stock.updateStock).not.toHaveBeenCalled();
    expect(accounting.onPreparedDishDisposition).not.toHaveBeenCalled();
    expect(tx.audit_logs.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      metadata: expect.objectContaining({ consumed_cost: 0, leaves: expect.arrayContaining([
        expect.objectContaining({ product_id: 701, unknown_cost: true }),
      ]) }),
    }) });
  });

  it('orden cobrada rechaza antes de inventario, asiento y auditoría', async () => {
    const { cancel, tx, stock, accounting } = harness(true, 'waste', { paid: true });
    await expect(cancel()).rejects.toMatchObject({ errorCode: 'ORD_ITEM_CANCEL_PAID_001' });
    expect(tx.inventory_transactions.findMany).not.toHaveBeenCalled();
    expect(stock.updateStock).not.toHaveBeenCalled();
    expect(accounting.onPreparedDishDisposition).not.toHaveBeenCalled();
    expect(tx.audit_logs.create).not.toHaveBeenCalled();
  });

  it('no acepta org=0 sintético aunque el contexto tenga actor', async () => {
    const { cancel, tx, accounting } = harness(true, 'waste', { missingOrganization: true });
    await expect(cancel()).rejects.toThrow('organización de la orden');
    expect(tx.inventory_transactions.findMany).not.toHaveBeenCalled();
    expect(accounting.onPreparedDishDisposition).not.toHaveBeenCalled();
  });

  it('prepared entregado sin consumo histórico nunca inventa stock del plato vendido', async () => {
    const { cancel, tx, stock, accounting } = harness(true, 'restock', { unfired: true });
    await cancel();
    expect(stock.updateStock).not.toHaveBeenCalled();
    expect(accounting.onPreparedDishDisposition).not.toHaveBeenCalled();
    expect(tx.audit_logs.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      metadata: expect.objectContaining({ leaves: [], consumed_cost: 0 }),
    }) });
  });

  it('D.2 item 6: una línea avanzada sin decisión explícita se rechaza antes de mutar', async () => {
    const { tx, stock, accounting, service } = harness(false, 'waste');
    await expect(service.cancelOrderItem(orderId, itemId, 'motivo válido')).rejects.toMatchObject({
      errorCode: 'TABLE_SESSION_ADD_ITEMS_INVALID',
    });
    expect(tx.order_items.update).not.toHaveBeenCalled();
    expect(stock.updateStock).not.toHaveBeenCalled();
    expect(accounting.onPreparedDishDisposition).not.toHaveBeenCalled();
    expect(tx.audit_logs.create).not.toHaveBeenCalled();
  });
});

/**
 * 1060 paso 3 — si el finish falla tras el claim, `payOrder` restaura el
 * estado previo al claim (el pago compensado con motivo se conserva).
 */
describe('D.4 — recálculo de propina al cancelar (F-001)', () => {
  const ORDER_ID = 5017;
  const ITEM_ID = 901;

  const buildService = (orderTip: Record<string, unknown>) => {
    const txMock: any = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: ORDER_ID, state: 'created' }]),
      // Sincronía cancelado orden↔cocina: sin fila KDS viva por defecto.
      kitchen_ticket_items: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      payments: { findFirst: jest.fn().mockResolvedValue(null) },
      order_items: {
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([
          { total_price: 20000, order_item_taxes: [{ tax_amount: 3800 }] },
        ]),
      },
      orders: {
        findFirst: jest.fn().mockResolvedValue({ active_financial_split_id: null }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const prismaMock: any = {
      order_items: {
        findFirst: jest.fn().mockResolvedValue({
          id: ITEM_ID,
          product_id: 11,
          product_variant_id: null,
          quantity: 1,
          delivered_at: new Date('2026-09-10T12:00:00.000Z'),
          cancelled_at: null,
          // H2/H4 — `cancelDeliveredOrderItem` selects this to resolve the
          // ticket the item was fired under; empty ⇒ no ticket resolvable.
          kitchen_ticket_items: [],
        }),
      },
      $transaction: jest.fn((cb: any) => cb(txMock)),
    };
    const service = new OrderFlowService(
      prismaMock as unknown as StorePrismaService,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { updateStock: jest.fn(), releaseReservationQuantity: jest.fn().mockResolvedValue(0) } as any,
      {} as any,
      {} as any,
      { logCustom: jest.fn() } as any,
    );
    jest.spyOn(service as any, 'getOrder').mockResolvedValue({
      id: ORDER_ID,
      state: 'created',
      store_id: 4,
      payments: [],
      shipping_cost: 0,
      discount_amount: 0,
      ...orderTip,
    });
    return { service, txMock };
  };

  it('porcentual: se re-deriva sobre la base viva y persiste tip_amount', async () => {
    const { service, txMock } = buildService({
      tip_type: 'percentage',
      tip_value: 10,
      tip_amount: 3000,
    });
    await service.cancelDeliveredOrderItem(ORDER_ID, ITEM_ID, 'motivo válido', 'waste');
    const data = txMock.orders.update.mock.calls[0][0].data;
    // Base viva 20000+3800 al 10% = 2380 (no los 3000 viejos).
    expect(Number(data.tip_amount)).toBe(2380);
    expect(Number(data.grand_total)).toBe(20000 + 3800 + 2380);
    expect(Number(data.subtotal_amount)).toBe(20000);
  });

  it('fija: conserva su monto exacto y no re-persiste tip_amount', async () => {
    const { service, txMock } = buildService({
      tip_type: 'fixed',
      tip_value: 2000,
      tip_amount: 2000,
    });
    await service.cancelDeliveredOrderItem(ORDER_ID, ITEM_ID, 'motivo válido', 'waste');
    const data = txMock.orders.update.mock.calls[0][0].data;
    expect('tip_amount' in data).toBe(false);
    expect(Number(data.grand_total)).toBe(20000 + 3800 + 2000);
  });

  it('rederivePercentageTip: null para fija, sin tipo o porcentaje no positivo', async () => {
    const { service } = buildService({});
    const rederive = (service as any).rederivePercentageTip.bind(service);
    expect(rederive({ tip_type: 'fixed', tip_value: 2000 }, 20000, 3800)).toBeNull();
    expect(rederive({ tip_type: null, tip_value: null }, 20000, 3800)).toBeNull();
    expect(rederive({ tip_type: 'percentage', tip_value: 0 }, 20000, 3800)).toBeNull();
    expect(rederive({ tip_type: 'percentage', tip_value: 10 }, 20000, 3800)).toBe(2380);
  });
});

describe('OrderFlowService.payOrder — finish-falla restaura estado (1060 paso 3)', () => {
  const DTO: any = { store_payment_method_id: 1, payment_type: PaymentType.DIRECT };

  const CREATED_PAYMENT = {
    id: 999,
    gateway_response: { payment_type: 'direct' },
  };

  const buildService = () => {
    const prismaMock: any = {
      store_payment_methods: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 1, system_payment_method: { type: 'card' } }),
      },
      payments: {
        create: jest.fn().mockResolvedValue(CREATED_PAYMENT),
        update: jest.fn().mockResolvedValue({}),
      },
      // Pre-claim (paso 3), shipping-gate y cupón comparten este mock: sin
      // `coupon_id` el cupón no hace nada; sin `delivery_type`/`shipping`
      // el gate no aplica; `state` alimenta la restauración.
      orders: {
        findFirst: jest.fn().mockResolvedValue({ state: 'created' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      store_settings: {
        findFirst: jest.fn().mockResolvedValue({
          settings: { pos: { allow_anonymous_sales: true } },
        }),
      },
      coupon_uses: { findFirst: jest.fn().mockResolvedValue(null) },
      coupons: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    // `createLegPayments`/`cancelLegPayments` corren dentro de
    // `this.prisma.$transaction(async (tx) => …)`; el mock resuelve el
    // callback contra el mismo `prismaMock` para que `tx.payments` sea el
    // mock que estos tests ya assertan sobre `prismaMock.payments`.
    prismaMock.$transaction = jest.fn(async (callback: any) => callback(prismaMock));
    const emitter = { emit: jest.fn(), emitAsync: jest.fn().mockResolvedValue([]) };
    const service = new OrderFlowService(
      prismaMock as unknown as StorePrismaService,
      emitter as any,
      {} as any,
      { assertSessionForSales: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { logCustom: jest.fn().mockResolvedValue(undefined) } as any,
    );
    jest.spyOn(service as any, 'getOrder').mockResolvedValue({
      id: 1,
      state: 'created',
      delivery_type: 'direct_delivery',
      grand_total: 4000,
      currency: 'COP',
      store_id: 4,
    });
    jest
      .spyOn(service as any, 'generateTransactionId')
      .mockResolvedValue('TXN-1');
    jest
      .spyOn(service as any, 'hasPendingKitchenItems')
      .mockResolvedValue(false);
    jest.spyOn(service as any, 'validateTransition').mockReturnValue(undefined);
    jest
      .spyOn(service as any, 'recordPayOrderCashMovement')
      .mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'computeAndPersistEta')
      .mockResolvedValue(undefined);
    return { service, prismaMock, emitter };
  };

  it('finish → INV_STOCK_002: anula el pago Y restaura created', async () => {
    const { service, prismaMock, emitter } = buildService();
    jest
      .spyOn(service as any, 'updateOrderState')
      .mockRejectedValue(new VendixHttpException(ErrorCodes.INV_STOCK_002));

    await expect(service.payOrder(1, DTO)).rejects.toMatchObject({
      errorCode: 'ORD_FLOW_PAYMENT_FAILED_001',
    });

    // Pago compensado con motivo (regla existente, intacta).
    expect(prismaMock.payments.update).toHaveBeenCalledWith({
      where: { id: 999 },
      data: expect.objectContaining({
        state: 'cancelled',
        gateway_response: expect.objectContaining({
          cancellation_reason: 'finish_blocked_insufficient_stock',
        }),
      }),
    });
    // Estado restaurado al previo al claim (no varado en `processing`).
    const restoreCalls = prismaMock.orders.updateMany.mock.calls.filter(
      (c: any) => c[0]?.data?.state === 'created',
    );
    expect(restoreCalls.length).toBeGreaterThanOrEqual(1);
    expect(restoreCalls[0][0]).toEqual({
      where: { id: 1, state: 'processing' },
      data: expect.objectContaining({ state: 'created' }),
    });
    // PLAN-pago-multimetodo-pendientes paso 2 — una carga compensada NUNCA
    // emite `payment.received`: `emitLegPaymentReceivedEvents` sólo se llama
    // desde el camino de éxito de cada rama, nunca desde `cancelLegPayments`.
    expect(
      emitter.emitAsync.mock.calls.filter((c: any[]) => c[0] === 'payment.received'),
    ).toHaveLength(0);
  });

  it('finish OK: NO restaura (el claim es el único updateMany)', async () => {
    const { service, prismaMock } = buildService();
    jest
      .spyOn(service as any, 'updateOrderState')
      .mockResolvedValue({ id: 1, state: 'finished' });

    await service.payOrder(1, DTO);

    expect(prismaMock.payments.update).not.toHaveBeenCalled();
    expect(prismaMock.orders.updateMany).toHaveBeenCalledTimes(1);
  });
});

/**
 * 1060 paso 2 (RBAC) — el endpoint de reversa exige el permiso propio
 * `store:orders:order_flow:cancel_delivered` (no hereda `order_flow:create`
 * del mesero). El seed lo asigna a cashier/admin/owner y NUNCA a
 * waiter/employee; el guard niega (403) a quien no lo porta.
 */
describe('OrderFlowController.cancelDeliveredOrderItem — permiso propio (1060 paso 2)', () => {
  it(`declara @Permissions('store:orders:order_flow:cancel_delivered')`, () => {
    const perms = Reflect.getMetadata(
      PERMISSIONS_KEY,
      (OrderFlowController.prototype as any).cancelDeliveredOrderItem,
    );
    expect(perms).toContain('store:orders:order_flow:cancel_delivered');
  });
});

/**
 * Cancelar una venta YA COBRADA EN EFECTIVO tiene que mover la caja.
 *
 * El dinero salió del cajón cuando el cliente pagó y vuelve a salir cuando se
 * le devuelve al cancelar: si nadie registra ese egreso, el arqueo del cierre
 * reporta un faltante sin causa. `createRefund` NO es reutilizable para
 * taparlo — `CANCELABLE_STATES` (`created`/`pending_payment`/`processing`) y
 * `REFUNDABLE_STATES` (`delivered`/`finished`) son conjuntos DISJUNTOS, así
 * que la llamada moriría en 400 antes de tocar caja.
 *
 * Lo que estos casos fijan:
 *  - el egreso se escribe contra la sesión de caja abierta, por el monto
 *    exacto de los pagos `succeeded` en efectivo (no de la orden: un cobro
 *    parcial o mixto devuelve sólo lo que entró en billetes);
 *  - un pago `pending` no movió dinero y NO genera egreso;
 *  - una venta con tarjeta cancela igual y no toca la caja;
 *  - cuando el egreso NO se puede registrar, la falla queda AUDITADA. El
 *    anti-ejemplo vivo es `recordRefundCashRegisterMovement`
 *    (refund-flow.service.ts:842): `catch {}` adentro y `.catch(() => {})`
 *    afuera — dos mordazas en serie que hacen indistinguible el egreso
 *    escrito del egreso perdido.
 */
describe('OrderFlowService.cancelOrder — egreso de caja de la venta cobrada en efectivo', () => {
  const ORDER_ID = 9001;
  const SESSION_ID = 77;
  const CASH_METHOD_ID = 11;
  const CARD_METHOD_ID = 22;
  const CASH_PAYMENT_ID = 5001;
  const CARD_PAYMENT_ID = 5002;

  const DTO: any = { reason: 'El cliente desistió de la compra' };

  let service: OrderFlowService;
  let prismaMock: PrismaMock;
  let settings: { getSettings: jest.Mock };
  let sessions: { getActiveSession: jest.Mock };
  let movements: { recordCompensationCashMovementDurable: jest.Mock };
  let audit: { log: jest.Mock; logCustom: jest.Mock };
  let stock: { releaseReservationsByReference: jest.Mock };
  let emitter: { emit: jest.Mock; emitAsync: jest.Mock };
  let refundFlow: { recordCancellationPendingRefunds: jest.Mock; recordCancellationCashRefund: jest.Mock; completeCancellationCashRefund: jest.Mock; emitCancellationCashRefund: jest.Mock; completeCancellationNonCashRefunds: jest.Mock };

  /** Orden cancelable (estado `processing`) con los pagos que se le pasen. */
  const cancelableOrder = (payments: any[]) =>
    buildOrder({
      id: ORDER_ID,
      state: 'processing',
      order_number: 'POS-1',
      internal_notes: null,
      payments: payments.map((p) => ({
        ...p,
        store_payment_method: p.store_payment_method ?? { system_payment_method: {
          type: p.store_payment_method_id === CARD_METHOD_ID ? 'card' : 'cash', processing_mode: 'DIRECT',
        } },
      })),
    });

  beforeEach(() => {
    jest.clearAllMocks();
    // `getContext` es estático: el spy se re-aplica por test (ver prisma-mock).
    mockRequestContext({ store_id: 100, organization_id: 1, user_id: 7 });

    prismaMock = createPrismaMock({
      orders: ['updateMany', 'update'],
      order_items: ['findMany'],
      payments: ['findMany', 'update'],
      table_sessions: ['findFirst'],
      kitchen_ticket_items: ['findMany'],
      invoices: ['findMany', 'findFirst'],
      accounts_receivable: ['findMany', 'update'],
      order_installments: ['updateMany'],
    });
    prismaMock.invoices.findMany.mockResolvedValue([]);
    prismaMock.accounts_receivable.findMany.mockResolvedValue([]);
    prismaMock.$queryRaw = jest.fn().mockResolvedValue([{ id: ORDER_ID, state: 'processing' }]);
    prismaMock.kitchen_ticket_items.findMany.mockResolvedValue([]);
    // Sin ítems de cocina: la rama KDS de `cancelOrder` no participa aquí.
    prismaMock.order_items.findMany.mockResolvedValue([]);
    // El claim atómico gana (count=1) → corre la cadena de efectos.
    prismaMock.orders.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.orders.update.mockResolvedValue({
      id: ORDER_ID,
      store_id: 100,
      state: 'cancelled',
    });
    prismaMock.payments.update.mockResolvedValue({});
    // Por defecto: ningún pago del lote es en efectivo. Cada test que necesita
    // efectivo lo declara explícitamente.
    prismaMock.payments.findMany.mockResolvedValue([]);
    prismaMock.table_sessions.findFirst.mockResolvedValue(null);

    settings = {
      getSettings: jest
        .fn()
        .mockResolvedValue({ pos: { cash_register: { enabled: true } } }),
    };
    sessions = {
      getActiveSession: jest.fn().mockResolvedValue({ id: SESSION_ID }),
    };
    movements = {
      recordCompensationCashMovementDurable: jest
        .fn()
        .mockResolvedValue({ status: 'recorded', movement_id: 31 }),
    };
    audit = {
      log: jest.fn().mockResolvedValue(undefined),
      logCustom: jest.fn().mockResolvedValue(undefined),
    };
    stock = {
      releaseReservationsByReference: jest.fn().mockResolvedValue(undefined),
    };
    emitter = { emit: jest.fn(), emitAsync: jest.fn().mockResolvedValue([]) };
    refundFlow = {
      recordCancellationPendingRefunds: jest.fn().mockResolvedValue([]),
      completeCancellationNonCashRefunds: jest.fn().mockResolvedValue(undefined),
      recordCancellationCashRefund: jest.fn().mockResolvedValue({
        refund: { id: 81, state: 'processing', amount: new Prisma.Decimal('59.50') },
        breakdown: { amount: new Prisma.Decimal('59.50') },
      }),
      completeCancellationCashRefund: jest.fn().mockResolvedValue({ id: 81, state: 'completed' }),
      emitCancellationCashRefund: jest.fn().mockResolvedValue(undefined),
    };

    service = new OrderFlowService(
      prismaMock as unknown as StorePrismaService,
      emitter as any,
      settings as any,
      sessions as any,
      movements as any,
      stock as any,
      {} as any,
      {} as any,
      audit as any,
      undefined,
      undefined,
      undefined,
      refundFlow as any,
    );
  });

  it('cancela un draft sin mesa mediante el claim condicional', async () => {
    const draft = { ...cancelableOrder([]), state: 'draft', order_items: [] };
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(draft);

    await expect(service.cancelOrder(ORDER_ID, DTO)).resolves.toMatchObject({ state: 'cancelled' });
    expect(prismaMock.orders.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: ORDER_ID, state: { in: expect.arrayContaining(['draft']) },
      }),
    }));
    expect(prismaMock.table_sessions.findFirst).toHaveBeenCalledWith({
      where: { order_id: ORDER_ID, store_id: 100, closed_at: null },
      select: { id: true },
    });
  });

  it.each(['finished', 'refunded', 'cancelled'] as const)(
    'rechaza cancelación de %s con código y estado, sin claim',
    async (state) => {
      jest.spyOn(service as any, 'getOrder').mockResolvedValue({
        ...cancelableOrder([]), state,
      });

      await expect(service.cancelOrder(ORDER_ID, DTO)).rejects.toMatchObject({
        errorCode: 'ORD_STATUS_001',
        response: expect.objectContaining({ details: { state } }),
      });
      expect(prismaMock.orders.updateMany).not.toHaveBeenCalled();
    },
  );

  it('rechaza draft con mesa abierta antes de escribir, con código y sesión', async () => {
    jest.spyOn(service as any, 'getOrder').mockResolvedValue({
      ...cancelableOrder([]), state: 'draft', order_items: [],
    });
    prismaMock.table_sessions.findFirst.mockResolvedValue({ id: 55 });

    await expect(service.cancelOrder(ORDER_ID, DTO)).rejects.toMatchObject({
      errorCode: 'ORD_CANCEL_OPEN_TABLE_001',
      response: expect.objectContaining({ details: { table_session_id: 55 } }),
    });
    expect(prismaMock.orders.updateMany).not.toHaveBeenCalled();
    expect(stock.releaseReservationsByReference).not.toHaveBeenCalled();
  });

  it('pago succeeded en efectivo: registra el egreso por el monto exacto', async () => {
    jest
      .spyOn(service as any, 'getOrder')
      .mockResolvedValue(
        cancelableOrder([
          buildPayment({
            id: CASH_PAYMENT_ID,
            state: 'succeeded',
            store_payment_method_id: CASH_METHOD_ID,
            amount: new Prisma.Decimal('59.50'),
          }),
        ]),
      );
    prismaMock.payments.findMany.mockResolvedValue([
      { id: CASH_PAYMENT_ID, amount: new Prisma.Decimal('59.50') },
    ]);

    await service.cancelOrder(ORDER_ID, DTO);

    // Un movimiento refund/order_cancelled por pago en efectivo, con su payment_id.
    expect(movements.recordCompensationCashMovementDurable).toHaveBeenCalledTimes(1);
    const [payload] = movements.recordCompensationCashMovementDurable.mock.calls[0];
    expect(payload).toMatchObject({
      store_id: 100,
      user_id: 7,
      order_id: ORDER_ID,
      payment_id: CASH_PAYMENT_ID,
      reference: 'order_cancelled',
      dedupe_key: `order_cancelled:${ORDER_ID}:${CASH_PAYMENT_ID}`,
    });
    // Comparación en Decimal: `59.5 === 59.50` como float esconde justo el
    // error de escala que este caso persigue.
    expect(
      new Prisma.Decimal(payload.amount).equals(new Prisma.Decimal('59.50')),
    ).toBe(true);
    expect(refundFlow.recordCancellationCashRefund).toHaveBeenCalledTimes(1);
    expect(refundFlow.recordCancellationCashRefund).toHaveBeenCalledWith(
      prismaMock, expect.objectContaining({ id: ORDER_ID }),
      [CASH_PAYMENT_ID], new Prisma.Decimal('59.50'), DTO.reason,
    );
    expect(refundFlow.completeCancellationCashRefund).toHaveBeenCalledWith(81);
    expect(refundFlow.emitCancellationCashRefund).toHaveBeenCalledTimes(1);
    // UN solo asiento de la salida de efectivo: `refund.completed` (vía
    // emitCancellationCashRefund). El movimiento no emite `cash_register.movement`
    // (antes el cash_out lo emitía y el efectivo se acreditaba dos veces).
    expect(
      emitter.emit.mock.calls.filter(([name]: [string]) => name === 'cash_register.movement'),
    ).toHaveLength(0);
  });

  it('dos pagos en efectivo: un movimiento por pago, cada uno con su payment_id', async () => {
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(
      cancelableOrder([
        buildPayment({ id: CASH_PAYMENT_ID, state: 'succeeded', store_payment_method_id: CASH_METHOD_ID, amount: new Prisma.Decimal('40.00') }),
        buildPayment({ id: CASH_PAYMENT_ID + 1, state: 'succeeded', store_payment_method_id: CASH_METHOD_ID, amount: new Prisma.Decimal('19.50') }),
      ]),
    );
    prismaMock.payments.findMany.mockResolvedValue([
      { id: CASH_PAYMENT_ID, amount: new Prisma.Decimal('40.00') },
      { id: CASH_PAYMENT_ID + 1, amount: new Prisma.Decimal('19.50') },
    ]);

    await service.cancelOrder(ORDER_ID, DTO);

    const calls = movements.recordCompensationCashMovementDurable.mock.calls.map(([p]: [any]) => [p.payment_id, p.amount]);
    expect(calls).toEqual([[CASH_PAYMENT_ID, 40], [CASH_PAYMENT_ID + 1, 19.5]]);
  });

  it('rechaza cobro mixto liquidado sin reversa de tarjeta; no sale efectivo', async () => {
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(
      cancelableOrder([
        buildPayment({
          id: CASH_PAYMENT_ID,
          state: 'succeeded',
          store_payment_method_id: CASH_METHOD_ID,
          amount: new Prisma.Decimal('40.00'),
        }),
        buildPayment({
          id: CARD_PAYMENT_ID,
          state: 'succeeded',
          store_payment_method_id: CARD_METHOD_ID,
          amount: new Prisma.Decimal('19.50'),
        }),
      ]),
    );
    // El filtro por canal vive en SQL: sólo vuelve el pago en efectivo.
    prismaMock.payments.findMany.mockResolvedValue([
      { id: CASH_PAYMENT_ID, amount: new Prisma.Decimal('40.00') },
    ]);

    await expect(service.cancelOrder(ORDER_ID, DTO)).rejects.toMatchObject({
      errorCode: 'ORD_CANCEL_PAYMENT_REVERSAL_REQUIRED_001',
    });
    expect(prismaMock.orders.updateMany).not.toHaveBeenCalled();
    expect(movements.recordCompensationCashMovementDurable).not.toHaveBeenCalled();
    expect(refundFlow.recordCancellationCashRefund).not.toHaveBeenCalled();
  });

  it('venta con tarjeta liquidada: 409 tipado sin cancelar pago ni orden', async () => {
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(
      cancelableOrder([
        buildPayment({
          id: CARD_PAYMENT_ID,
          state: 'succeeded',
          store_payment_method_id: CARD_METHOD_ID,
        }),
      ]),
    );
    prismaMock.payments.findMany.mockResolvedValue([]);

    await expect(service.cancelOrder(ORDER_ID, DTO)).rejects.toMatchObject({
      errorCode: 'ORD_CANCEL_PAYMENT_REVERSAL_REQUIRED_001',
    });
    expect(prismaMock.orders.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.payments.update).not.toHaveBeenCalled();
    expect(emitter.emit).not.toHaveBeenCalled();
    expect(movements.recordCompensationCashMovementDurable).not.toHaveBeenCalled();
    expect(refundFlow.recordCancellationCashRefund).not.toHaveBeenCalled();
  });

  it('pago en efectivo `pending`: nunca entró al cajón, no hay egreso', async () => {
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(
      cancelableOrder([
        buildPayment({
          id: CASH_PAYMENT_ID,
          state: 'pending',
          store_payment_method_id: CASH_METHOD_ID,
          amount: new Prisma.Decimal('59.50'),
        }),
      ]),
    );
    // Trampa deliberada: si el código mandara los pagos `pending` a la
    // clasificación por canal, esta fila lo delataría con un egreso fantasma.
    prismaMock.payments.findMany.mockResolvedValue([
      { id: CASH_PAYMENT_ID, amount: new Prisma.Decimal('59.50') },
    ]);

    await service.cancelOrder(ORDER_ID, DTO);

    expect(movements.recordCompensationCashMovementDurable).not.toHaveBeenCalled();
    expect(refundFlow.recordCancellationCashRefund).not.toHaveBeenCalled();
  });

  it('el egreso que falla deja constancia auditable (no es un catch mudo)', async () => {
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(
      cancelableOrder([
        buildPayment({
          id: CASH_PAYMENT_ID,
          state: 'succeeded',
          store_payment_method_id: CASH_METHOD_ID,
          amount: new Prisma.Decimal('59.50'),
        }),
      ]),
    );
    prismaMock.payments.findMany.mockResolvedValue([
      { id: CASH_PAYMENT_ID, amount: new Prisma.Decimal('59.50') },
    ]);
    movements.recordCompensationCashMovementDurable.mockRejectedValue(
      new Error('caja no disponible'),
    );

    // La cancelación ya hizo commit: relanzar aquí le diría al operador que
    // falló lo que sí ocurrió, y su reintento chocaría contra el 400 de
    // `CANCELABLE_STATES`. La falla se ESCALA, no se propaga.
    await expect(service.cancelOrder(ORDER_ID, DTO)).resolves.toMatchObject({
      state: 'cancelled',
    });

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'order.cancel.cash_out_unrecorded',
        resourceId: ORDER_ID,
        metadata: expect.objectContaining({ cause: 'movement_write_failed' }),
      }),
    );
    expect(refundFlow.completeCancellationCashRefund).not.toHaveBeenCalled();
  });

  it('sin sesión de caja: el movimiento queda encolado (durable) y el refund se completa', async () => {
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(
      cancelableOrder([
        buildPayment({
          id: CASH_PAYMENT_ID,
          state: 'succeeded',
          store_payment_method_id: CASH_METHOD_ID,
          amount: new Prisma.Decimal('59.50'),
        }),
      ]),
    );
    prismaMock.payments.findMany.mockResolvedValue([
      { id: CASH_PAYMENT_ID, amount: new Prisma.Decimal('59.50') },
    ]);
    movements.recordCompensationCashMovementDurable.mockResolvedValue({
      status: 'pending', failure_id: 9, reason: 'no_open_cash_session',
    });

    await service.cancelOrder(ORDER_ID, DTO);

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'order.cancel.cash_out_queued',
        resourceId: ORDER_ID,
      }),
    );
    expect(audit.log).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'order.cancel.cash_out_unrecorded' }),
    );
    expect(refundFlow.completeCancellationCashRefund).toHaveBeenCalledWith(81);
    expect(refundFlow.emitCancellationCashRefund).toHaveBeenCalledTimes(1);
  });

  it('módulo de caja apagado: ni movimiento ni escalamiento', async () => {
    settings.getSettings.mockResolvedValue({
      pos: { cash_register: { enabled: false } },
    });
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(
      cancelableOrder([
        buildPayment({
          id: CASH_PAYMENT_ID,
          state: 'succeeded',
          store_payment_method_id: CASH_METHOD_ID,
          amount: new Prisma.Decimal('59.50'),
        }),
      ]),
    );
    prismaMock.payments.findMany.mockResolvedValue([
      { id: CASH_PAYMENT_ID, amount: new Prisma.Decimal('59.50') },
    ]);

    await service.cancelOrder(ORDER_ID, DTO);

    // La cancelación sí corrió (el mock no está muerto)...
    expect(prismaMock.orders.updateMany).toHaveBeenCalled();
    // ...pero sin cajón que cuadrar no hay egreso que registrar NI falla que
    // escalar: la venta tampoco registró su `sale` al cobrar (mismo gate en
    // `recordPayOrderCashMovement`), así que escribir sólo el egreso
    // descuadraría una sesión que no existe.
    expect(movements.recordCompensationCashMovementDurable).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });
  it.each([false, true])('rechaza cancelar stock comprometido incluso force=%s', async (force) => {
    const order = cancelableOrder([buildPayment({ state: 'succeeded' })]);
    order.order_items = [{ ...order.order_items[0], inventory_committed: true,
      inventory_consumed_at_fire: false }] as any;
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(order);
    await expect(service.cancelOrder(ORDER_ID, DTO, force)).rejects.toMatchObject({
      response: expect.objectContaining({ error_code: 'ORD_CANCEL_STOCK_COMMITTED_001' }),
    });
    expect(prismaMock.payments.update).not.toHaveBeenCalled();
    expect(stock.releaseReservationsByReference).not.toHaveBeenCalled();
  });

  it('no anula localmente un pago ONLINE confirmado sin devolución monetaria', async () => {
    const order = cancelableOrder([buildPayment({ state: 'succeeded',
      store_payment_method: { system_payment_method: { type: 'wompi', processing_mode: 'ONLINE' } },
    })]);
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(order);
    await expect(service.cancelOrder(ORDER_ID, DTO)).rejects.toMatchObject({
      response: expect.objectContaining({ error_code: 'ORD_CANCEL_PAYMENT_REVERSAL_REQUIRED_001' }),
    });
    expect(prismaMock.payments.update).not.toHaveBeenCalled();
  });

  it('cancelPayment tampoco puede anular un ONLINE succeeded', async () => {
    const order = cancelableOrder([buildPayment({ state: 'succeeded',
      store_payment_method: { system_payment_method: { type: 'wompi', processing_mode: 'ONLINE' } },
    })]);
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(order);
    await expect(service.cancelPayment(ORDER_ID, { reason: 'QA' }, 'admin')).rejects
      .toMatchObject({ errorCode: 'ORD_CANCEL_PAYMENT_REVERSAL_REQUIRED_001' });
    expect(prismaMock.payments.update).not.toHaveBeenCalled();
    expect(prismaMock.orders.update).not.toHaveBeenCalled();
  });

  it('relee líneas después de esperar el lock, no usa el snapshot cancelable anterior', async () => {
    const before = cancelableOrder([]);
    const after = { ...before, order_items: [{ inventory_committed: true }] };
    jest.spyOn(service as any, 'getOrder').mockResolvedValueOnce(before).mockResolvedValueOnce(after);
    await expect(service.cancelOrder(ORDER_ID, DTO)).rejects
      .toMatchObject({ errorCode: 'ORD_CANCEL_STOCK_COMMITTED_001' });
    expect(prismaMock.orders.updateMany).not.toHaveBeenCalled();
  });

  it('confirmPayment no resucita la orden si cancelación ganó el lock', async () => {
    const pending = { ...cancelableOrder([]), state: 'pending_payment' };
    jest.spyOn(service as any, 'getOrder').mockResolvedValueOnce(pending)
      .mockResolvedValueOnce({ ...pending, state: 'cancelled' });
    await expect(service.confirmPayment(ORDER_ID)).resolves.toMatchObject({
      state: 'cancelled', payment_confirmation_applied: false,
    });
    expect(prismaMock.orders.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.payments.update).not.toHaveBeenCalled();
    expect(emitter.emit).not.toHaveBeenCalled();
  });

  it('cancelación registra el estado fresco ganador, no la prelectura', async () => {
    const before = { ...cancelableOrder([]), state: 'pending_payment' };
    jest.spyOn(service as any, 'getOrder').mockResolvedValueOnce(before)
      .mockResolvedValueOnce({ ...before, state: 'processing' });
    await service.cancelOrder(ORDER_ID, DTO);
    expect(emitter.emit).toHaveBeenCalledWith('order.status_changed', expect.objectContaining({ old_state: 'processing' }));
    const write = prismaMock.orders.update.mock.calls[0][0];
    expect(JSON.parse(write.data.internal_notes)._flow_metadata.previous_state).toBe('processing');
  });

  it('ADR-13: pago por transferencia pasa a cancelled y su reembolso se completa tras el commit', async () => {
    const TRANSFER_PAYMENT_ID = 7701;
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(
      cancelableOrder([
        buildPayment({
          id: TRANSFER_PAYMENT_ID,
          state: 'succeeded',
          amount: new Prisma.Decimal('60.00'),
          store_payment_method: { system_payment_method: { type: 'bank_transfer', processing_mode: 'DIRECT' } },
        }),
      ]),
    );
    // 1ª consulta (efectivo): nada. 2ª (no efectivo): la transferencia.
    prismaMock.payments.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: TRANSFER_PAYMENT_ID,
          amount: new Prisma.Decimal('60.00'),
          store_payment_method: { system_payment_method: { type: 'bank_transfer' } },
        },
      ]);
    const created = [{ refund: { id: 382 }, breakdown: {}, leg: { payment_id: TRANSFER_PAYMENT_ID } }];
    refundFlow.recordCancellationPendingRefunds.mockResolvedValue(created);

    await service.cancelOrder(ORDER_ID, DTO);

    expect(refundFlow.recordCancellationPendingRefunds).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({ id: ORDER_ID }),
      [expect.objectContaining({ payment_id: TRANSFER_PAYMENT_ID, method_type: 'bank_transfer' })],
      DTO.reason,
      expect.anything(),
    );
    expect(prismaMock.payments.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: TRANSFER_PAYMENT_ID },
        data: expect.objectContaining({ state: 'cancelled' }),
      }),
    );
    expect(refundFlow.completeCancellationNonCashRefunds).toHaveBeenCalledTimes(1);
    expect(refundFlow.completeCancellationNonCashRefunds).toHaveBeenCalledWith(
      expect.objectContaining({ id: ORDER_ID }),
      created,
    );
    // Sin salida de efectivo: la transferencia no toca el cajón.
    expect(refundFlow.recordCancellationCashRefund).not.toHaveBeenCalled();
  });

  it('ADR-13: un fallo en el cierre post-commit no rompe la anulación', async () => {
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(
      cancelableOrder([
        buildPayment({
          id: 7702,
          state: 'succeeded',
          store_payment_method: { system_payment_method: { type: 'bank_transfer', processing_mode: 'DIRECT' } },
        }),
      ]),
    );
    prismaMock.payments.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 7702,
          amount: new Prisma.Decimal('10.00'),
          store_payment_method: { system_payment_method: { type: 'bank_transfer' } },
        },
      ]);
    refundFlow.recordCancellationPendingRefunds.mockResolvedValue([
      { refund: { id: 9 }, breakdown: {}, leg: { payment_id: 7702 } },
    ]);
    refundFlow.completeCancellationNonCashRefunds.mockRejectedValue(new Error('boom'));

    await expect(service.cancelOrder(ORDER_ID, DTO)).resolves.toMatchObject({ state: 'cancelled' });
  });

  it('ADR-13: cash_on_delivery viaja por el carril de efectivo, no como pierna no efectivo', async () => {
    const COD_PAYMENT_ID = 7703;
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(
      cancelableOrder([
        buildPayment({
          id: COD_PAYMENT_ID,
          state: 'succeeded',
          amount: new Prisma.Decimal('59.50'),
          store_payment_method: { system_payment_method: { type: 'cash_on_delivery', processing_mode: 'DIRECT' } },
        }),
      ]),
    );
    prismaMock.payments.findMany.mockImplementation(async (args: any) => {
      const typeFilter = args?.where?.store_payment_method?.system_payment_method?.type;
      // Solo la consulta de efectivo (`type: { in: [...] }` sin NOT) lo trae.
      return typeFilter?.in?.includes('cash_on_delivery') && !args.where.NOT
        ? [{ id: COD_PAYMENT_ID, amount: new Prisma.Decimal('59.50') }]
        : [];
    });

    await service.cancelOrder(ORDER_ID, DTO);

    const cashQuery = prismaMock.payments.findMany.mock.calls[0][0];
    expect(cashQuery.where.store_payment_method.system_payment_method.type.in).toEqual(
      expect.arrayContaining(['cash', 'cash_on_delivery']),
    );
    const nonCashQuery = prismaMock.payments.findMany.mock.calls[1][0];
    expect(nonCashQuery.where.NOT.store_payment_method.system_payment_method.type.in).toEqual(
      expect.arrayContaining(['cash', 'cash_on_delivery']),
    );
    expect(refundFlow.recordCancellationCashRefund).toHaveBeenCalledWith(
      prismaMock, expect.objectContaining({ id: ORDER_ID }),
      [COD_PAYMENT_ID], new Prisma.Decimal('59.50'), DTO.reason,
    );
    expect(refundFlow.recordCancellationPendingRefunds).not.toHaveBeenCalled();
    expect(refundFlow.completeCancellationNonCashRefunds).not.toHaveBeenCalled();
  });

});

/**
 * B4 (release-855) / B1b (order-truth-and-invoice-tz plan) — `shipped`/
 * `delivered` are money-only payment reversal states now (see
 * `FULFILLED_PAYMENT_CANCELABLE_STATES`): the goods already left, so
 * cancelling the payment does NOT touch stock and lands the order back on
 * the SAME state (never `created`) so `payOrder` can re-charge it. `finished`
 * is a hard reject (B1b): use a refund instead.
 */
describe('OrderFlowService.cancelPayment — B4 (release-855) delivered/finished branch', () => {
  const ORDER_ID = 9001;
  let service: OrderFlowService;
  let prismaMock: PrismaMock;
  let emitter: { emit: jest.Mock; emitAsync: jest.Mock };

  const directCashPayment = (overrides: Record<string, unknown> = {}) =>
    buildPayment({
      id: 5001,
      state: 'succeeded',
      amount: new Prisma.Decimal('59.50'),
      store_payment_method: {
        system_payment_method: { type: 'cash', processing_mode: 'DIRECT' },
      },
      ...overrides,
    });

  const deliveredOrder = (payments: any[], overrides: Record<string, unknown> = {}) =>
    buildOrder({
      id: ORDER_ID,
      state: 'delivered',
      grand_total: new Prisma.Decimal('59.50'),
      payments,
      ...overrides,
    });

  beforeEach(() => {
    jest.clearAllMocks();
    mockRequestContext({ store_id: 100, organization_id: 1, user_id: 7 });

    prismaMock = createPrismaMock({
      orders: ['update', 'findFirst'],
      payments: ['update'],
      invoices: ['findFirst'],
    });
    // Lock: first $queryRaw call is the order row (must be non-empty or
    // `lockOrderLifecycle` throws NotFoundException); the second is the
    // payments-row lock, whose return value is unused here.
    prismaMock.$queryRaw = jest
      .fn()
      .mockResolvedValueOnce([{ id: ORDER_ID, state: 'delivered' }])
      .mockResolvedValue([]);
    prismaMock.invoices.findFirst.mockResolvedValue(null);
    prismaMock.orders.update.mockResolvedValue({ id: ORDER_ID, state: 'delivered' });
    prismaMock.orders.findFirst.mockResolvedValue({ id: ORDER_ID, state: 'delivered', payments: [] });

    emitter = { emit: jest.fn(), emitAsync: jest.fn().mockResolvedValue([]) };

    service = new OrderFlowService(
      prismaMock as unknown as StorePrismaService,
      emitter as any,
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
      { log: jest.fn().mockResolvedValue(undefined), logCustom: jest.fn().mockResolvedValue(undefined) } as any,
      undefined, undefined, undefined, undefined,
    );
  });

  it('voids a settled DIRECT payment and returns the order to delivered, unpaid', async () => {
    const order = deliveredOrder([directCashPayment()]);
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(order);

    await service.cancelPayment(ORDER_ID, { reason: 'QA' } as any, 'admin');

    expect(prismaMock.payments.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 5001 },
        data: expect.objectContaining({ state: 'cancelled' }),
      }),
    );
    expect(prismaMock.orders.update).toHaveBeenCalledWith({
      where: { id: ORDER_ID },
      data: expect.objectContaining({
        state: 'delivered',
        completed_at: null,
        total_paid: 0,
        remaining_balance: order.grand_total,
      }),
    });
  });

  it('B1b: rejects a finished order — use a refund instead, never re-lands on delivered', async () => {
    const order = deliveredOrder([directCashPayment()], { state: 'finished' });
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(order);

    await expect(
      service.cancelPayment(ORDER_ID, { reason: 'QA' } as any, 'admin'),
    ).rejects.toMatchObject({ errorCode: 'ORD_PAYMENT_CANCEL_FINISHED_001' });
    expect(prismaMock.payments.update).not.toHaveBeenCalled();
    expect(prismaMock.orders.update).not.toHaveBeenCalled();
  });

  it('B1b: voids a settled DIRECT payment on a shipped order and keeps it shipped, unpaid', async () => {
    const order = deliveredOrder([directCashPayment()], { state: 'shipped' });
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(order);
    prismaMock.$queryRaw = jest
      .fn()
      .mockResolvedValueOnce([{ id: ORDER_ID, state: 'shipped' }])
      .mockResolvedValue([]);

    await service.cancelPayment(ORDER_ID, { reason: 'QA' } as any, 'admin');

    expect(prismaMock.orders.update).toHaveBeenCalledWith({
      where: { id: ORDER_ID },
      data: expect.objectContaining({
        state: 'shipped',
        completed_at: null,
        total_paid: 0,
        remaining_balance: order.grand_total,
      }),
    });
  });

  it('voids every settled/pending leg of a multi-tender payment, not just the first', async () => {
    const order = deliveredOrder([
      directCashPayment({ id: 5001, amount: new Prisma.Decimal('30.00') }),
      directCashPayment({ id: 5002, state: 'pending', amount: new Prisma.Decimal('29.50') }),
    ]);
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(order);

    await service.cancelPayment(ORDER_ID, { reason: 'QA' } as any, 'admin');

    expect(prismaMock.payments.update).toHaveBeenCalledTimes(2);
    expect(prismaMock.payments.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 5001 } }),
    );
    expect(prismaMock.payments.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 5002 } }),
    );
  });

  it('rejects when an issued sales invoice blocks the reversal', async () => {
    const order = deliveredOrder([directCashPayment()]);
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(order);
    prismaMock.invoices.findFirst.mockResolvedValue({ id: 777, status: 'accepted' });

    await expect(
      service.cancelPayment(ORDER_ID, { reason: 'QA' } as any, 'admin'),
    ).rejects.toMatchObject({ errorCode: 'ORD_PAYMENT_CANCEL_INVOICED_001' });
    expect(prismaMock.payments.update).not.toHaveBeenCalled();
    expect(prismaMock.orders.update).not.toHaveBeenCalled();
  });

  it('does not block on a DRAFT invoice — only an issued one counts', async () => {
    const order = deliveredOrder([directCashPayment()]);
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(order);
    prismaMock.invoices.findFirst.mockResolvedValue({ id: 777, status: 'draft' });

    await expect(
      service.cancelPayment(ORDER_ID, { reason: 'QA' } as any, 'admin'),
    ).resolves.toBeDefined();
    expect(prismaMock.orders.update).toHaveBeenCalled();
  });

  it('rejects a non-direct settled payment (needs processor reversal, not a local cancel)', async () => {
    const order = deliveredOrder([
      directCashPayment({
        store_payment_method: { system_payment_method: { type: 'wompi', processing_mode: 'ONLINE' } },
      }),
    ]);
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(order);

    await expect(
      service.cancelPayment(ORDER_ID, { reason: 'QA' } as any, 'admin'),
    ).rejects.toMatchObject({ errorCode: 'ORD_CANCEL_PAYMENT_REVERSAL_REQUIRED_001' });
    expect(prismaMock.payments.update).not.toHaveBeenCalled();
    expect(prismaMock.invoices.findFirst).not.toHaveBeenCalled();
  });

  // Accounting reversal — `payment.voided`. `store_id`/`organization_id` come
  // from `order.stores` (the same shape `getOrder`'s real `include` produces),
  // so these tests attach it explicitly — `buildOrder`'s default fixture only
  // sets a flat `organization_id`, which this code path does NOT read.
  const storesOverride = { id: 100, name: 'Test Store', store_code: 'T1', organization_id: 1 };

  it('emits payment.voided once for a settled DIRECT payment, with the exact contract payload', async () => {
    const order = deliveredOrder(
      [directCashPayment({ id: 5001, amount: new Prisma.Decimal('59.50') })],
      { stores: storesOverride },
    );
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(order);

    await service.cancelPayment(ORDER_ID, { reason: 'QA' } as any, 'admin');

    const voidCalls = emitter.emit.mock.calls.filter(([event]: any[]) => event === 'payment.voided');
    expect(voidCalls).toHaveLength(1);
    expect(voidCalls[0][1]).toEqual({
      store_id: 100,
      organization_id: 1,
      order_id: ORDER_ID,
      payment_id: 5001,
      amount: 59.5,
      payment_method: 'cash',
      user_id: 7,
      reason: 'payment_cancelled',
    });
  });

  it('does NOT emit payment.voided for a voided pending marker (it never posted an auto-entry)', async () => {
    const order = deliveredOrder(
      [directCashPayment({ id: 5001, state: 'pending' })],
      { stores: storesOverride },
    );
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(order);

    await service.cancelPayment(ORDER_ID, { reason: 'QA' } as any, 'admin');

    expect(
      emitter.emit.mock.calls.some(([event]: any[]) => event === 'payment.voided'),
    ).toBe(false);
  });

  it('emits payment.voided once per succeeded leg in a multi-tender cancel, never for the pending leg', async () => {
    const order = deliveredOrder(
      [
        directCashPayment({ id: 5001, amount: new Prisma.Decimal('30.00') }),
        directCashPayment({ id: 5002, state: 'pending', amount: new Prisma.Decimal('29.50') }),
      ],
      { stores: storesOverride },
    );
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(order);

    await service.cancelPayment(ORDER_ID, { reason: 'QA' } as any, 'admin');

    const voidCalls = emitter.emit.mock.calls.filter(([event]: any[]) => event === 'payment.voided');
    expect(voidCalls).toHaveLength(1);
    expect(voidCalls[0][1]).toMatchObject({ payment_id: 5001, amount: 30 });
  });
});

/**
 * B4/B8 follow-up — resolución de sesión de caja en la reversa de
 * `cancelPayment`. Antes SIEMPRE caía en `getActiveSession(userId)` del
 * operador que anula: si ese admin no tenía caja abierta, la reversa salía en
 * silencio y la venta original quedaba contada doble en el cuadre. Ahora
 * prioriza la sesión ORIGINAL del movimiento `sale` si sigue abierta.
 */
describe('OrderFlowService.reversePaymentCashMovements — resolución de sesión', () => {
  let service: OrderFlowService;
  let prismaMock: PrismaMock;
  let sessionsService: { getActiveSession: jest.Mock };
  let movementsService: {
    recordRefundMovement: jest.Mock;
    recordCompensationCashMovementDurable: jest.Mock;
    resolveCompensationSessionId: jest.Mock;
  };
  let audit: { log: jest.Mock; logCustom: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    mockRequestContext({ store_id: 100, organization_id: 1, user_id: 7 });

    prismaMock = createPrismaMock({
      cash_register_movements: ['findMany'],
      cash_register_sessions: ['findMany'],
    });

    sessionsService = { getActiveSession: jest.fn() };
    movementsService = {
      recordRefundMovement: jest.fn().mockResolvedValue({ id: 999 }),
      recordCompensationCashMovementDurable: jest
        .fn()
        .mockResolvedValue({ status: 'recorded', movement_id: 999 }),
      resolveCompensationSessionId: jest.fn().mockResolvedValue(null),
    };
    audit = { log: jest.fn().mockResolvedValue(undefined), logCustom: jest.fn() };

    service = new OrderFlowService(
      prismaMock as unknown as StorePrismaService,
      { emit: jest.fn(), emitAsync: jest.fn().mockResolvedValue([]) } as any,
      {} as any,
      sessionsService as any,
      movementsService as any,
      {} as any, {} as any, {} as any,
      audit as any,
      undefined, undefined, undefined, undefined,
    );
  });

  const cashSale = (method = 'cash') => [
    { session_id: 501, payment_id: 5001, amount: new Prisma.Decimal('59.50'), payment_method: method },
  ];

  it('efectivo: delega en la cola durable con reference payment_cancelled y dedupe por pago', async () => {
    prismaMock.cash_register_movements.findMany.mockResolvedValue(cashSale());

    await (service as any).reversePaymentCashMovements(100, 9001, [5001]);

    expect(movementsService.recordCompensationCashMovementDurable).toHaveBeenCalledWith(
      expect.objectContaining({
        store_id: 100,
        user_id: 7,
        order_id: 9001,
        payment_id: 5001,
        amount: 59.5,
        reference: 'payment_cancelled',
        dedupe_key: 'payment_cancelled:5001',
      }),
    );
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('efectivo sin ninguna sesión: queda encolado, con warn y auditoría (nunca en silencio)', async () => {
    prismaMock.cash_register_movements.findMany.mockResolvedValue(cashSale());
    movementsService.recordCompensationCashMovementDurable.mockResolvedValue({
      status: 'pending', failure_id: 12, reason: 'no_open_cash_session',
    });
    const warnSpy = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);

    await (service as any).reversePaymentCashMovements(100, 9001, [5001]);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('9001'));
    expect(warnSpy.mock.calls[0][0]).toEqual(expect.stringContaining('5001'));
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'payment.cancel.cash_reversal_issue',
        resourceId: 9001,
        metadata: expect.objectContaining({ cause: 'queued_no_open_cash_session', payment_ids: [5001] }),
      }),
    );
  });

  it('no efectivo con sesión destino: contra-movimiento directo en esa sesión', async () => {
    prismaMock.cash_register_movements.findMany.mockResolvedValue(cashSale('card'));
    movementsService.resolveCompensationSessionId.mockResolvedValue(501);

    await (service as any).reversePaymentCashMovements(100, 9001, [5001]);

    expect(movementsService.recordCompensationCashMovementDurable).not.toHaveBeenCalled();
    expect(movementsService.recordRefundMovement).toHaveBeenCalledWith(
      501,
      expect.objectContaining({ payment_method: 'card', payment_id: 5001, reference: 'payment_cancelled' }),
    );
  });

  it('no efectivo sin sesión: se audita, NO se encola', async () => {
    prismaMock.cash_register_movements.findMany.mockResolvedValue(cashSale('card'));
    movementsService.resolveCompensationSessionId.mockResolvedValue(null);

    await (service as any).reversePaymentCashMovements(100, 9001, [5001]);

    expect(movementsService.recordCompensationCashMovementDurable).not.toHaveBeenCalled();
    expect(movementsService.recordRefundMovement).not.toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'payment.cancel.cash_reversal_issue',
        metadata: expect.objectContaining({ cause: 'no_open_session_non_cash' }),
      }),
    );
  });

  it('un fallo de escritura no rompe la anulación pero se loguea y audita (sin catch mudo)', async () => {
    prismaMock.cash_register_movements.findMany.mockResolvedValue(cashSale());
    movementsService.recordCompensationCashMovementDurable.mockRejectedValue(new Error('db caída'));
    const errSpy = jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);

    await expect(
      (service as any).reversePaymentCashMovements(100, 9001, [5001]),
    ).resolves.toBeUndefined();

    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('db caída'), expect.anything());
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'payment.cancel.cash_reversal_issue',
        metadata: expect.objectContaining({ cause: 'movement_write_failed', error: 'db caída' }),
      }),
    );
  });
});

/**
 * B4/B8 (release-855) — `getAvailableActions` on `delivered`/`finished`
 * surfaces `pay`/`cancel_payment` on their own merits (money and fulfillment
 * are independent axes there now), bypassing the generic
 * `getOrderCancellationPolicy` overwrite for these two states.
 */
describe('OrderFlowService.getAvailableActions — B4 (release-855) delivered/finished', () => {
  const ORDER_ID = 9001;
  let service: OrderFlowService;
  let prismaMock: PrismaMock;

  const deliveredOrder = (payments: any[], overrides: Record<string, unknown> = {}) =>
    buildOrder({ id: ORDER_ID, state: 'delivered', payments, ...overrides });

  beforeEach(() => {
    jest.clearAllMocks();
    // `roles: ['owner']` — B1b (order-truth-and-invoice-tz plan) wired
    // `getAvailableActions`'s `cancel_payment` through `canCancelPaymentAsRole`,
    // matching the `/cancel-payment` endpoint's `@Roles('owner','admin')`
    // guard. Without a privileged role here every `cancel_payment` assertion
    // below would see `FORBIDDEN` instead of the state/settlement reason
    // under test — see the dedicated role-gating test below for the
    // non-privileged case.
    mockRequestContext({ store_id: 100, organization_id: 1, user_id: 7, roles: ['owner'] } as any);

    prismaMock = createPrismaMock({
      invoices: ['findFirst'],
      shipping_methods: ['findFirst'],
      refunds: ['findMany'],
      order_items: ['findMany'],
    });
    prismaMock.invoices.findFirst.mockResolvedValue(null);
    prismaMock.refunds.findMany.mockResolvedValue([]);
    prismaMock.order_items.findMany.mockResolvedValue([]);

    service = new OrderFlowService(
      prismaMock as unknown as StorePrismaService,
      { emit: jest.fn(), emitAsync: jest.fn().mockResolvedValue([]) } as any,
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
      { log: jest.fn(), logCustom: jest.fn() } as any,
      undefined, undefined, undefined, undefined,
    );
  });

  it('surfaces `pay` enabled and no `cancel_payment` when nothing is settled yet', async () => {
    const order = deliveredOrder([]);
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(order);

    const actions = await service.getAvailableActions(ORDER_ID);

    expect(actions.find((a) => a.code === 'pay')).toMatchObject({ enabled: true });
    expect(actions.find((a) => a.code === 'cancel_payment')).toBeUndefined();
  });

  it('COD home delivery pending payment exposes one dispatch action, never pickup or a second disabled dispatch', async () => {
    const order = deliveredOrder([], {
      state: 'pending_payment', delivery_type: 'home_delivery', shipping_method_id: 4,
      payment_form: '1', order_items: [{ id: 1 }],
    });
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(order);
    const actions = await service.getAvailableActions(ORDER_ID);
    expect(actions.filter((action) => action.code === 'dispatch_order')).toHaveLength(1);
    expect(actions.some((action) => action.code === 'manual_ship' || action.code === 'ready_for_pickup')).toBe(false);
    // Fase 2 paso 6 — pending_payment con saldo (remaining 59.50) ya no
    // ofrece confirm_payment: el personal REGISTRA por `flow/pay`.
    expect(actions.find((action) => action.code === 'pay')).toMatchObject({ enabled: true });
    expect(actions.some((action) => action.code === 'confirm_payment')).toBe(false);
  });

  it('home delivery processing keeps only its dispatch action, not legacy pickup/shipping duplicates', async () => {
    const order = deliveredOrder([], {
      state: 'processing', delivery_type: 'home_delivery', shipping_method_id: 4,
      order_items: [{ id: 1 }],
    });
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(order);
    const actions = await service.getAvailableActions(ORDER_ID);
    expect(actions.filter((action) => action.code === 'dispatch_order')).toHaveLength(1);
    expect(actions.some((action) => ['manual_ship', 'ready_for_pickup', 'ship_with_tracking'].includes(action.code))).toBe(false);
  });

  it('surfaces `pay` disabled (already paid) and `cancel_payment` enabled for a settled direct payment', async () => {
    const order = deliveredOrder([
      buildPayment({
        state: 'succeeded',
        store_payment_method: { system_payment_method: { type: 'cash', processing_mode: 'DIRECT' } },
      }),
    ]);
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(order);

    const actions = await service.getAvailableActions(ORDER_ID);

    expect(actions.find((a) => a.code === 'pay')).toMatchObject({
      enabled: false, reason: 'ORD_PAY_ALREADY_PAID_001',
    });
    expect(actions.find((a) => a.code === 'cancel_payment')).toMatchObject({ enabled: true });
  });

  it('disables `cancel_payment` with the invoice code when a sales invoice is already issued', async () => {
    const order = deliveredOrder([
      buildPayment({
        state: 'succeeded',
        store_payment_method: { system_payment_method: { type: 'cash', processing_mode: 'DIRECT' } },
      }),
    ]);
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(order);
    prismaMock.invoices.findFirst.mockResolvedValue({ id: 777, status: 'accepted' });

    const actions = await service.getAvailableActions(ORDER_ID);

    expect(actions.find((a) => a.code === 'cancel_payment')).toMatchObject({
      enabled: false, reason: 'ORD_PAYMENT_CANCEL_INVOICED_001',
    });
  });

  it('disables `cancel_payment` with the reversal code for a settled non-direct payment', async () => {
    const order = deliveredOrder([
      buildPayment({
        state: 'succeeded',
        store_payment_method: { system_payment_method: { type: 'wompi', processing_mode: 'ONLINE' } },
      }),
    ]);
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(order);

    const actions = await service.getAvailableActions(ORDER_ID);

    expect(actions.find((a) => a.code === 'cancel_payment')).toMatchObject({
      enabled: false, reason: 'ORD_CANCEL_PAYMENT_REVERSAL_REQUIRED_001',
    });
  });

  it.each(['delivered', 'finished'] as const)(
    'does the same on %s (not just delivered)',
    async (state) => {
      const order = deliveredOrder([], { state });
      jest.spyOn(service as any, 'getOrder').mockResolvedValue(order);

      const actions = await service.getAvailableActions(ORDER_ID);

      expect(actions.find((a) => a.code === 'pay')).toMatchObject({ enabled: true });
    },
  );

  // B1b (order-truth-and-invoice-tz plan, STATE gap #2) — `cancel_payment`
  // must be role-gated the same way the `/cancel-payment` endpoint's
  // `RolesGuard` + `@Roles('owner','admin')` already are, regardless of
  // order state. A non-privileged role sees `FORBIDDEN`, never the
  // underlying settlement reason.
  it('disables `cancel_payment` with FORBIDDEN for a non-owner/admin role', async () => {
    mockRequestContext({
      store_id: 100, organization_id: 1, user_id: 7, roles: ['cashier'],
    } as any);
    const order = deliveredOrder([
      buildPayment({
        state: 'succeeded',
        store_payment_method: { system_payment_method: { type: 'cash', processing_mode: 'DIRECT' } },
      }),
    ]);
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(order);

    const actions = await service.getAvailableActions(ORDER_ID);

    expect(actions.find((a) => a.code === 'cancel_payment')).toMatchObject({
      enabled: false, reason: 'FORBIDDEN',
    });
  });
});

/**
 * B8 (release-855) — checkout now persists `remaining_balance=grand_total`
 * at order creation (see `checkout.service.ts`) instead of relying on the
 * schema default of 0. `confirmPayment` (online/gateway confirmation path,
 * e.g. Wompi webhook) must settle that balance to 0 on success, or every
 * online-confirmed order would permanently read "still owes the full total".
 */
describe('OrderFlowService.confirmPayment — B8 (release-855) settles the balance', () => {
  const ORDER_ID = 9001;
  let service: OrderFlowService;
  let prismaMock: PrismaMock;
  let emitter: { emit: jest.Mock; emitAsync: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    mockRequestContext({ store_id: 100, organization_id: 1, user_id: 7 });

    prismaMock = createPrismaMock({
      orders: ['update', 'updateMany', 'findFirst', 'findUnique'],
      payments: ['update', 'updateMany', 'findMany'],
      store_payment_methods: ['findFirst'],
      // Paso 2 — `emitLegPaymentReceivedEvents` lee las líneas de la orden
      // para armar `sale_tax`/la retención antes de emitir. Vacío es válido:
      // degrada a los totales de la orden (mismo criterio que en el harness
      // de "Paso 3"). Sin este mock, `this.prisma.order_items` es
      // `undefined` y el `TypeError` lo traga el try/catch exterior,
      // dejando 0 emits en vez de 1.
      order_items: ['findMany'],
    });
    prismaMock.$queryRaw = jest.fn().mockResolvedValue([{ id: ORDER_ID, state: 'pending_payment' }]);
    prismaMock.orders.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.orders.update.mockResolvedValue({ id: ORDER_ID, state: 'processing' });
    prismaMock.orders.findFirst.mockResolvedValue({ id: ORDER_ID, state: 'processing', payments: [] });
    prismaMock.order_items.findMany.mockResolvedValue([]);
    // Paso 2 — `resolvePaymentReceivedSaleFields` (dentro de la emisión de
    // `payment.received` de `confirmPayment`) lee la orden y los pagos
    // previos vía `this.prisma`, no vía `tx`.
    prismaMock.orders.findUnique.mockResolvedValue({
      subtotal_amount: 50,
      discount_amount: 0,
      tax_amount: 9.5,
      shipping_cost: 0,
      shipping_tax_amount: 0,
      tip_amount: 0,
      grand_total: 59.5,
      shipping_tax_type: null,
      shipping_tax_rate: null,
      order_items: [],
    });
    prismaMock.payments.findMany.mockResolvedValue([]);
    prismaMock.store_payment_methods.findFirst.mockResolvedValue({
      display_name: 'Efectivo',
      system_payment_method: { display_name: 'Efectivo' },
    });
    prismaMock.payments.update.mockResolvedValue({});
    prismaMock.payments.updateMany.mockResolvedValue({ count: 1 });

    emitter = { emit: jest.fn(), emitAsync: jest.fn().mockResolvedValue([]) };

    service = new OrderFlowService(
      prismaMock as unknown as StorePrismaService,
      emitter as any,
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
      { log: jest.fn().mockResolvedValue(undefined), logCustom: jest.fn().mockResolvedValue(undefined) } as any,
      undefined, undefined, undefined, undefined,
    );
    jest.spyOn(service as any, 'commitCouponUseForOrder').mockResolvedValue(undefined);
  });

  it('refuses manual confirmation of an unpaid reserved wallet or Wompi charge', async () => {
    const grandTotal = new Prisma.Decimal('59.50');
    const order = buildOrder({
      id: ORDER_ID,
      state: 'pending_payment',
      grand_total: grandTotal,
      payments: [{
        ...buildPayment({ id: 5004, state: 'pending', amount: grandTotal }),
        gateway_response: { payment_type: 'online', pos_reserved_payment: true },
        store_payment_method: { system_payment_method: { type: 'wallet' } },
      }],
    });
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(order);

    await expect(service.confirmPayment(ORDER_ID)).rejects.toThrow(
      'pendiente de confirmación',
    );
    expect(prismaMock.payments.updateMany).not.toHaveBeenCalled();
  });

  it('never marks the ON_DELIVERY promise succeeded without selecting the actual tender', async () => {
    const grandTotal = new Prisma.Decimal('59.50');
    const order = buildOrder({
      id: ORDER_ID,
      state: 'pending_payment',
      grand_total: grandTotal,
      payments: [{
        ...buildPayment({ id: 5005, state: 'pending', amount: grandTotal }),
        store_payment_method: { system_payment_method: { type: 'cash_on_delivery', processing_mode: 'ON_DELIVERY' } },
      }],
    });
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(order);

    await expect(service.confirmPayment(ORDER_ID)).rejects.toThrow('método real');
    expect(prismaMock.payments.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.orders.updateMany).not.toHaveBeenCalled();
  });

  it('settles total_paid/remaining_balance to grand_total/0 when the pending payment is confirmed', async () => {
    const grandTotal = new Prisma.Decimal('59.50');
    const order = buildOrder({
      id: ORDER_ID,
      state: 'pending_payment',
      grand_total: grandTotal,
      total_paid: new Prisma.Decimal('0'),
      remaining_balance: grandTotal,
      payments: [
        buildPayment({ id: 5001, state: 'pending', amount: grandTotal }),
      ],
    });
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(order);

    await service.confirmPayment(ORDER_ID);

    const balanceWrite = prismaMock.orders.updateMany.mock.calls.find(
      (call: any[]) => call[0]?.data?.remaining_balance !== undefined
        || call[0]?.data?.total_paid !== undefined,
    );
    expect(balanceWrite).toBeDefined();
    expect(Number(balanceWrite![0].data.remaining_balance)).toBe(0);
    expect(Number(balanceWrite![0].data.total_paid)).toBe(59.50);
  });

  it('PLAN-pago-multimetodo-pendientes paso 2 — emite payment.received UNA vez para el pago confirmado', async () => {
    const grandTotal = new Prisma.Decimal('59.50');
    const order = buildOrder({
      id: ORDER_ID,
      state: 'pending_payment',
      grand_total: grandTotal,
      total_paid: new Prisma.Decimal('0'),
      remaining_balance: grandTotal,
      payments: [
        buildPayment({ id: 5001, state: 'pending', amount: grandTotal }),
      ],
    });
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(order);

    await service.confirmPayment(ORDER_ID);

    const paymentReceivedCalls = emitter.emitAsync.mock.calls.filter(
      (call: any[]) => call[0] === 'payment.received',
    );
    expect(paymentReceivedCalls).toHaveLength(1);
    // `confirmPayment` toma `Number(confirmedPayment.amount)` (no el Decimal
    // crudo) al armar el leg — mismo criterio que `payOrder`'s `NormalizedLeg`.
    expect(paymentReceivedCalls[0][1]).toMatchObject({
      payment_id: 5001,
      amount: 59.5,
      payment_method: 'Efectivo',
    });
  });

  it('PLAN-pago-multimetodo-pendientes paso 2 — llamada del webhook (source: "webhook") NO emite payment.received (ya lo emitió emitPaymentReceivedAccounting)', async () => {
    const grandTotal = new Prisma.Decimal('59.50');
    const order = buildOrder({
      id: ORDER_ID,
      state: 'pending_payment',
      grand_total: grandTotal,
      total_paid: new Prisma.Decimal('0'),
      remaining_balance: grandTotal,
      payments: [
        buildPayment({ id: 5002, state: 'pending', amount: grandTotal }),
      ],
    });
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(order);

    await service.confirmPayment(ORDER_ID, { source: 'webhook' });

    const paymentReceivedCalls = emitter.emitAsync.mock.calls.filter(
      (call: any[]) => call[0] === 'payment.received',
    );
    expect(paymentReceivedCalls).toHaveLength(0);
  });

  it('re-confirmación idempotente (applied=true, sin pago pending que confirmar) no emite payment.received', async () => {
    const grandTotal = new Prisma.Decimal('59.50');
    // `state: 'pending_payment'` mantiene la rama `applied` (no dispara el
    // early-return `applied:false`), pero SIN un pago `pending` que
    // confirmar — el mismo shape que ve una segunda llamada replay tras un
    // primer confirm exitoso.
    const order = buildOrder({
      id: ORDER_ID,
      state: 'pending_payment',
      grand_total: grandTotal,
      total_paid: grandTotal,
      remaining_balance: new Prisma.Decimal('0'),
      payments: [
        buildPayment({ id: 5003, state: 'succeeded', amount: grandTotal }),
      ],
    });
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(order);

    await service.confirmPayment(ORDER_ID);

    const paymentReceivedCalls = emitter.emitAsync.mock.calls.filter(
      (call: any[]) => call[0] === 'payment.received',
    );
    expect(paymentReceivedCalls).toHaveLength(0);
  });
});

describe('OrderFlowService.registerCreditPayment — table projection (B.2/T5)', () => {
  const CREDIT_DTO: any = { store_payment_method_id: 5, amount: 60 };

  const harness = (remainingBalance = 60, totalPaid = 40) => {
    mockRequestContext({ store_id: 4, organization_id: 1, user_id: 42 });
    const orderRow: any = {
      id: 1,
      order_number: 'CR-1',
      state: 'processing',
      store_id: 4,
      organization_id: 1,
      customer_id: 44,
      currency: 'COP',
      payment_form: '2',
      credit_type: 'libre',
      grand_total: 100,
      total_paid: totalPaid,
      remaining_balance: remainingBalance,
      payments: [],
      order_installments: [],
    };
    const prismaMock: any = {
      orders: {
        findFirst: jest.fn(async () => orderRow),
        update: jest.fn(async () => ({ id: 1 })),
      },
      store_payment_methods: {
        findFirst: jest.fn(async () => ({
          id: 5,
          system_payment_method: { type: 'cash' },
        })),
      },
      payments: {
        create: jest.fn(async () => ({ id: 501 })),
      },
      order_installments: {
        findFirst: jest.fn(async () => null),
        findMany: jest.fn(async () => []),
        update: jest.fn(async () => ({})),
      },
    };
    const eventEmitter: any = { emit: jest.fn(), emitAsync: jest.fn().mockResolvedValue([]) };
    const service = new OrderFlowService(
      prismaMock, eventEmitter, {} as any,
      { assertSessionForSales: jest.fn() } as any, {} as any,
      {} as any, {} as any, {} as any, {} as any,
    );
    jest.spyOn(service as any, 'hasPendingKitchenItems').mockResolvedValue(false);
    const updateOrderState = jest
      .spyOn(service as any, 'updateOrderState')
      .mockResolvedValue({ id: 1, state: 'finished' });
    const cashMovement = jest
      .spyOn(service as any, 'recordPayOrderCashMovement')
      .mockResolvedValue(undefined);
    const project = jest
      .spyOn(service as any, 'projectPaidOrderToTable')
      .mockResolvedValue(undefined);
    return { service, prismaMock, eventEmitter, updateOrderState, cashMovement, project };
  };

  it('rechaza el abono con SPLIT_ACCOUNT_LOCKED si la orden tiene cuentas independientes', async () => {
    const h = harness(60, 40);
    h.prismaMock.orders.findFirst.mockImplementationOnce(async () => ({
      id: 1, state: 'processing', payment_form: '2', remaining_balance: 60,
      active_financial_split_id: 9,
    }));

    const error = await h.service.registerCreditPayment(1, CREDIT_DTO).catch((failure) => failure);

    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.errorCode).toBe('SPLIT_ACCOUNT_LOCKED');
    expect(h.prismaMock.payments.create).not.toHaveBeenCalled();
  });

  it('projects the table session only when the credit is fully settled', async () => {
    const h = harness(60, 40);

    const result = await h.service.registerCreditPayment(1, CREDIT_DTO);

    expect(h.prismaMock.payments.create).toHaveBeenCalledTimes(1);
    expect(h.project).toHaveBeenCalledTimes(1);
    expect(h.project).toHaveBeenCalledWith(1, 501);
    expect(h.updateOrderState).toHaveBeenCalledWith(
      1, 'finished', expect.objectContaining({ finished_at: expect.any(Date) }),
    );
    expect(result.finished).toBe(true);
    expect(result.payment_recorded).toBe(true);
  });

  it('does not project a partial abono', async () => {
    const h = harness(100, 0);

    const result = await h.service.registerCreditPayment(1, CREDIT_DTO);

    expect(h.prismaMock.payments.create).toHaveBeenCalledTimes(1);
    expect(h.project).not.toHaveBeenCalled();
    expect(h.updateOrderState).not.toHaveBeenCalled();
    expect(result.finished).toBe(false);
    expect(result.payment_recorded).toBe(true);
  });

  it('projection failure throws typed ERR-33, keeps payment/cash, skips finish', async () => {
    const h = harness(60, 40);
    h.project.mockRejectedValueOnce(
      new VendixHttpException(ErrorCodes.POS_TABLE_SESSION_PROJECTION_FAILED_001),
    );

    const error = await h.service.registerCreditPayment(1, CREDIT_DTO).catch((failure) => failure);

    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.errorCode).toBe('POS_TABLE_SESSION_PROJECTION_FAILED_001');
    // Payment + balances + installments kept; cash + events already ran.
    expect(h.prismaMock.payments.create).toHaveBeenCalledTimes(1);
    expect(h.prismaMock.orders.update).toHaveBeenCalledTimes(1);
    expect(h.cashMovement).toHaveBeenCalledTimes(1);
    expect(h.eventEmitter.emit).toHaveBeenCalledWith(
      'installment_payment.received', expect.objectContaining({ payment_id: 501 }),
    );
    // No false `finished`: the finish transition never ran.
    expect(h.updateOrderState).not.toHaveBeenCalled();
  });

  it('projects even when the kitchen keeps a settled order open', async () => {
    const h = harness(60, 40);
    (h.service as any).hasPendingKitchenItems.mockResolvedValue(true);

    const result = await h.service.registerCreditPayment(1, CREDIT_DTO);

    expect(h.project).toHaveBeenCalledTimes(1);
    expect(h.updateOrderState).not.toHaveBeenCalled();
    expect(result.finished).toBe(false);
    expect(result.payment_recorded).toBe(true);
  });
});

describe('OrderFlowService — gate de caja para cobros (CASH_SESSION_REQUIRED_001)', () => {
  const USER_B = 42;
  const SESSION_B = 900;
  const CREDIT_DTO: any = { store_payment_method_id: 5, amount: 60 };

  // Sin restore a propósito (misma convención del harness vecino): el
  // contexto simulado coincide con el que ya ven los describes posteriores.
  const gateRejecting = () => ({
    assertSessionForSales: jest.fn().mockRejectedValue(
      new VendixHttpException(ErrorCodes.CASH_SESSION_REQUIRED_001),
    ),
    getActiveSession: jest.fn(),
  });

  it('payOrder sin caja: rechaza CASH_SESSION_REQUIRED_001 antes del claim de estado', async () => {
    mockRequestContext({ store_id: 4, organization_id: 1, user_id: USER_B });
    const prismaMock: any = {
      orders: {
        findFirst: jest.fn(async () => null),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      payments: { create: jest.fn() },
      $transaction: jest.fn(),
    };
    const sessions = gateRejecting();
    const service = new OrderFlowService(
      prismaMock,
      { emit: jest.fn() } as any,
      {} as any,
      sessions as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    const error = await service
      .payOrder(1, { store_payment_method_id: 1 } as any)
      .catch((failure) => failure);

    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.errorCode).toBe('CASH_SESSION_REQUIRED_001');
    expect(sessions.assertSessionForSales).toHaveBeenCalledWith(USER_B);
    // El gate es lo primero: ni el probe de envío, ni el claim (la orden no
    // queda varada en `processing`), ni pagos, ni transacciones.
    expect(prismaMock.orders.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.orders.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.payments.create).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('registerCreditPayment sin caja: rechaza CASH_SESSION_REQUIRED_001 sin crear el pago', async () => {
    mockRequestContext({ store_id: 4, organization_id: 1, user_id: USER_B });
    const prismaMock: any = {
      orders: { findFirst: jest.fn(async () => null) },
      payments: { create: jest.fn() },
    };
    const sessions = gateRejecting();
    const service = new OrderFlowService(
      prismaMock,
      { emit: jest.fn() } as any,
      {} as any,
      sessions as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    const error = await service
      .registerCreditPayment(1, CREDIT_DTO)
      .catch((failure) => failure);

    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.errorCode).toBe('CASH_SESSION_REQUIRED_001');
    expect(sessions.assertSessionForSales).toHaveBeenCalledWith(USER_B);
    expect(prismaMock.orders.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.payments.create).not.toHaveBeenCalled();
  });

  it('registerCreditPayment con caja de B: el movimiento sale cae en la sesión de B', async () => {
    mockRequestContext({ store_id: 4, organization_id: 1, user_id: USER_B });
    const orderRow: any = {
      id: 1,
      order_number: 'CR-B',
      state: 'processing',
      store_id: 4,
      organization_id: 1,
      customer_id: 44,
      currency: 'COP',
      payment_form: '2',
      credit_type: 'libre',
      grand_total: 100,
      total_paid: 0,
      remaining_balance: 100,
      payments: [],
      order_installments: [],
    };
    const prismaMock: any = {
      orders: {
        findFirst: jest.fn(async () => orderRow),
        update: jest.fn(async () => ({ id: 1 })),
      },
      store_payment_methods: {
        findFirst: jest.fn(async () => ({
          id: 5,
          system_payment_method: { type: 'cash' },
        })),
      },
      payments: {
        create: jest.fn(async () => ({ id: 501 })),
      },
      order_installments: {
        findFirst: jest.fn(async () => null),
        findMany: jest.fn(async () => []),
        update: jest.fn(async () => ({})),
      },
    };
    const settingsService = {
      getSettings: jest.fn(async () => ({
        pos: { cash_register: { enabled: true } },
      })),
    };
    const sessions = {
      assertSessionForSales: jest.fn(async () => undefined),
      getActiveSession: jest.fn(async () => ({ id: SESSION_B })),
    };
    const movements = { recordSaleMovement: jest.fn(async () => ({})) };
    const service = new OrderFlowService(
      prismaMock,
      { emit: jest.fn(), emitAsync: jest.fn().mockResolvedValue([]) } as any,
      settingsService as any,
      sessions as any,
      movements as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    jest.spyOn(service as any, 'hasPendingKitchenItems').mockResolvedValue(false);
    jest
      .spyOn(service as any, 'updateOrderState')
      .mockResolvedValue({ id: 1, state: 'finished' });
    jest
      .spyOn(service as any, 'projectPaidOrderToTable')
      .mockResolvedValue(undefined);

    // Abono parcial (60 de 100): registra pago y movimiento sin finish.
    const result = await service.registerCreditPayment(1, CREDIT_DTO);
    // `recordPayOrderCashMovement` es fire-and-forget: vaciar microtareas.
    await new Promise((resolve) => setImmediate(resolve));

    expect(result.payment_recorded).toBe(true);
    expect(result.finished).toBe(false);
    expect(sessions.assertSessionForSales).toHaveBeenCalledWith(USER_B);
    expect(sessions.getActiveSession).toHaveBeenCalledWith(USER_B);
    expect(movements.recordSaleMovement).toHaveBeenCalledWith(
      SESSION_B,
      expect.objectContaining({
        order_id: 1,
        amount: 60,
        payment_method: 'cash',
        user_id: USER_B,
        payment_id: 501,
      }),
    );
  });
});

describe('OrderFlowService.payOrder — cobro multimétodo de contado (Paso 3)', () => {
  const CASH_ID = 1;
  const TRANSFER_ID = 2;

  const LEG_METHODS = [
    {
      id: CASH_ID,
      display_name: 'Efectivo',
      system_payment_method: {
        type: 'cash',
        processing_mode: 'DIRECT',
        display_name: 'Efectivo',
      },
    },
    {
      id: TRANSFER_ID,
      display_name: 'Transferencia',
      system_payment_method: {
        type: 'bank_transfer',
        processing_mode: 'DIRECT',
        display_name: 'Transferencia',
      },
    },
  ];

  const MULTI_DTO: any = {
    store_payment_method_id: CASH_ID,
    payment_type: PaymentType.DIRECT,
    payments: [
      {
        store_payment_method_id: CASH_ID,
        amount: 20000,
        amount_received: 50000,
      },
      {
        store_payment_method_id: TRANSFER_ID,
        amount: 80000,
        payment_reference: 'TRX-1',
        bank_account_id: 7,
      },
    ],
  };

  const buildHarness = (opts?: {
    preClaimState?: string;
    kitchenPending?: boolean;
  }) => {
    let paySeq = 100;
    let txnSeq = 0;
    const stateUpdates: Array<{ state: string; metadata: unknown }> = [];
    const createdPayments: any[] = [];
    const prismaMock: any = {
      store_payment_methods: {
        findFirst: jest.fn().mockResolvedValue(LEG_METHODS[0]),
        // El harness histórico no mockeaba `findMany`: el carril multi lo
        // necesita para cargar los métodos de los tramos (N métodos).
        findMany: jest.fn().mockImplementation(async ({ where }: any) => {
          const ids: number[] = where?.id?.in ?? [];
          return LEG_METHODS.filter((row) => ids.includes(row.id));
        }),
      },
      payments: {
        create: jest.fn().mockImplementation(async ({ data }: any) => {
          const row = { id: ++paySeq, ...data };
          createdPayments.push(row);
          return row;
        }),
        update: jest.fn().mockResolvedValue({}),
        // `resolvePaymentReceivedSaleFields`: pagos previos del mismo cobro
        // (sólo los tramos ya creados), para el reparto secuencial.
        findMany: jest.fn().mockImplementation(async ({ where }: any) =>
          createdPayments
            .filter((row) => row.id !== where?.id?.not)
            .map((row) => ({ amount: row.amount })),
        ),
      },
      orders: {
        // `resolvePaymentReceivedSaleFields` lee los totales de la orden.
        findUnique: jest.fn().mockResolvedValue({
          subtotal_amount: 100000,
          discount_amount: 0,
          tax_amount: 0,
          shipping_cost: 0,
          shipping_tax_amount: 0,
          tip_amount: 0,
          grand_total: 100000,
          order_items: [],
        }),
        findFirst: jest.fn().mockImplementation(async (args: any) => {
          if (args?.select?.state) return { state: opts?.preClaimState ?? 'created' };
          // Sonda del shipping-gate / cupón / orden actualizada: sin cupón,
          // con método de envío (el gate no aplica) y sin split financiero.
          return {
            id: 1,
            state: opts?.preClaimState ?? 'created',
            active_financial_split_id: null,
            delivery_type: 'direct_delivery',
            shipping_method_id: 7,
            order_items: [{ products: { product_type: 'product' } }],
            coupon_id: null,
          };
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      store_settings: {
        findFirst: jest.fn().mockResolvedValue({
          settings: { pos: { allow_anonymous_sales: true } },
        }),
      },
      coupon_uses: { findFirst: jest.fn().mockResolvedValue(null) },
      coupons: { findFirst: jest.fn().mockResolvedValue(null) },
      // PLAN-pago-multimetodo-pendientes paso 2 — `emitLegPaymentReceivedEvents`
      // lee las líneas de la orden (con impuestos) para armar `sale_tax`/la
      // retención. Vacío es válido: `buildOrderSaleTaxPayload` degrada a
      // ceros y el payload cae a los totales de la orden (`getOrder` mock).
      order_items: { findMany: jest.fn().mockResolvedValue([]) },
    };
    // `createLegPayments`/`cancelLegPayments` corren dentro de
    // `this.prisma.$transaction(async (tx) => …)`; el mock resuelve el
    // callback contra el mismo `prismaMock` (no tautológico: si el callback
    // rechaza —p. ej. el segundo `payments.create` de un tramo falla—, la
    // promesa que devuelve `$transaction` rechaza igual, tal como Prisma
    // revertiría de verdad).
    prismaMock.$transaction = jest.fn(async (callback: any) => callback(prismaMock));

    // Plan PLAN-pago-multimetodo-fixes paso 1 — objetivo 4: por defecto
    // resuelve/valida cualquier `bank_account_id` tal cual (pass-through),
    // igual que si perteneciera a la tienda, para no romper los tests
    // existentes que ya usan `bank_account_id: 7` en `MULTI_DTO`.
    const paymentGatewayService: any = {
      resolveAndValidateBankAccount: jest
        .fn()
        .mockImplementation(async (bankAccountId: number) => ({
          id: bankAccountId,
          name: 'Cuenta',
          bank_name: 'Banco',
          account_number: '123',
          currency: 'COP',
        })),
    };

    const emitter = { emit: jest.fn(), emitAsync: jest.fn().mockResolvedValue([]) };
    const service = new OrderFlowService(
      prismaMock as unknown as StorePrismaService,
      emitter as any,
      {} as any,
      { assertSessionForSales: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { logCustom: jest.fn().mockResolvedValue(undefined) } as any,
      undefined, // kitchenFireService
      undefined, // shippingTaxService
      undefined, // moduleRef
      undefined, // refundFlowService
      undefined, // autoEntryService
      undefined, // orderSse
      undefined, // orderHistoryService
      undefined, // stockValidator
      undefined, // sellableStockAllocator
      paymentGatewayService as any,
    );

    jest.spyOn(service as any, 'getOrder').mockResolvedValue({
      id: 1,
      // Recarga post-claim: el claim ya movió la orden a `processing`.
      state: 'processing',
      delivery_type: 'direct_delivery',
      grand_total: 100000,
      currency: 'COP',
      store_id: 4,
      customer_id: 44,
      payments: [],
    });
    jest
      .spyOn(service as any, 'generateTransactionId')
      .mockImplementation(async () => `TXN-${++txnSeq}`);
    jest
      .spyOn(service as any, 'hasPendingKitchenItems')
      .mockResolvedValue(opts?.kitchenPending ?? false);
    jest.spyOn(service as any, 'validateTransition').mockReturnValue(undefined);
    const cashMovement = jest
      .spyOn(service as any, 'recordPayOrderCashMovement')
      .mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'computeAndPersistEta')
      .mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'emitPosSaleCompletedIfFullyPaid')
      .mockResolvedValue(undefined);
    const project = jest
      .spyOn(service as any, 'projectPaidOrderToTable')
      .mockResolvedValue(undefined);
    const updateOrderState = jest
      .spyOn(service as any, 'updateOrderState')
      .mockImplementation(async (_id: number, next: string, metadata: unknown = {}) => {
        stateUpdates.push({ state: next, metadata });
        return { id: 1, state: next };
      });

    return {
      service,
      prismaMock,
      stateUpdates,
      cashMovement,
      project,
      updateOrderState,
      paymentGatewayService,
      emitter,
    };
  };

  it('2 tramos → 2 filas succeeded + finished + caja por tramo', async () => {
    const h = buildHarness();

    const result: any = await h.service.payOrder(1, MULTI_DTO);

    // Una fila por tramo, cada una con su transaction_id.
    expect(h.prismaMock.payments.create).toHaveBeenCalledTimes(2);
    const [cashCall, transferCall] =
      h.prismaMock.payments.create.mock.calls.map((call: any) => call[0].data);
    expect(cashCall).toEqual(
      expect.objectContaining({
        order_id: 1,
        store_payment_method_id: CASH_ID,
        amount: 20000,
        state: 'succeeded',
        transaction_id: 'TXN-1',
      }),
    );
    // Tramo en efectivo: claves planas históricas + metadata para el ticket.
    expect(cashCall.gateway_response).toEqual({
      payment_type: 'direct',
      amount_received: 50000,
      change: 30000,
      metadata: { amount_received: 50000 },
    });
    expect(transferCall).toEqual(
      expect.objectContaining({
        store_payment_method_id: TRANSFER_ID,
        amount: 80000,
        state: 'succeeded',
        transaction_id: 'TXN-2',
        gateway_reference: 'TRX-1',
        bank_account_id: 7,
      }),
    );
    // Tramo no-efectivo: vuelto 0 y SIN metadata (el lector del ticket no
    // debe tomar el recibido de una tarjeta).
    expect(transferCall.gateway_response).toEqual({
      payment_type: 'direct',
      amount_received: undefined,
      change: 0,
    });
    expect(transferCall.gateway_response).not.toHaveProperty('metadata');

    // Métodos cargados por id bajo el scope de tienda.
    expect(
      h.prismaMock.store_payment_methods.findMany,
    ).toHaveBeenCalledWith({
      where: { id: { in: [CASH_ID, TRANSFER_ID] } },
      include: { system_payment_method: true },
    });

    // Un movimiento de caja por tramo, cada uno con su payment_id.
    expect(h.cashMovement).toHaveBeenCalledTimes(2);
    expect(h.cashMovement).toHaveBeenNthCalledWith(
      1, 4, 1, 20000, 'cash', 101,
    );
    expect(h.cashMovement).toHaveBeenNthCalledWith(
      2, 4, 1, 80000, 'bank_transfer', 102,
    );

    // Orden saldada: Σ = total ⇒ finished con saldo 0.
    expect(h.updateOrderState).toHaveBeenCalledWith(
      1,
      'finished',
      expect.objectContaining({ total_paid: 100000, remaining_balance: 0 }),
      { historyFromState: 'created' },
    );

    // Proyección a mesa: un solo llamado (first-wins) con el primer tramo.
    expect(h.project).toHaveBeenCalledTimes(1);
    expect(h.project).toHaveBeenCalledWith(1, 101);

    // Respuesta: `payment` histórico (primero + vuelto total) + `payments[]`.
    expect(result.payment).toEqual({ transaction_id: 'TXN-1', change: 30000 });
    expect(result.payments).toEqual([
      {
        id: 101,
        transaction_id: 'TXN-1',
        store_payment_method_id: CASH_ID,
        amount: 20000,
        change: 30000,
        payment_method: 'Efectivo',
      },
      {
        id: 102,
        transaction_id: 'TXN-2',
        store_payment_method_id: TRANSFER_ID,
        amount: 80000,
        change: 0,
        payment_method: 'Transferencia',
      },
    ]);
    expect(result.payments[0].payment_method).toBe('Efectivo');
    expect(result.payments[1].payment_method).toBe('Transferencia');

    // Cuenta bancaria validada por el mismo gateway que usa el POS, con el
    // id ya resuelto y el store_id de la orden (nunca el crudo sin validar).
    expect(
      h.paymentGatewayService.resolveAndValidateBankAccount,
    ).toHaveBeenCalledWith(7, 4, h.prismaMock);

    // PLAN-pago-multimetodo-pendientes paso 2 — un `payment.received` por
    // tramo, cada uno con su monto y su método (no un solo evento agregado).
    const paymentReceivedCalls = h.emitter.emitAsync.mock.calls.filter(
      (call: any[]) => call[0] === 'payment.received',
    );
    expect(paymentReceivedCalls).toHaveLength(2);
    expect(paymentReceivedCalls[0][1]).toMatchObject({
      amount: 20000,
      payment_method: 'Efectivo',
      // Porción propia del tramo, no el subtotal de la orden (100.000):
      // con los totales completos cada tramo reconocería el ingreso entero.
      subtotal_amount: 20000,
    });
    expect(paymentReceivedCalls[1][1]).toMatchObject({
      amount: 80000,
      payment_method: 'Transferencia',
      subtotal_amount: 80000,
    });
  });

  // PR #858 hallazgo 1 — `resolveCashBankKey` elige Caja/Bancos por la
  // etiqueta que viaja en `payment_method`. Si la tienda llamó «Caja» a su
  // efectivo, el payload debe llevar el nombre del SISTEMA; el nombre de la
  // tienda sólo vive en la respuesta HTTP/ticket.
  it('tienda renombró su efectivo «Caja» → payment.received lleva el nombre del sistema, la respuesta el de la tienda', async () => {
    const h = buildHarness();
    const renamed = [
      {
        ...LEG_METHODS[0],
        display_name: 'Caja',
        system_payment_method: {
          ...LEG_METHODS[0].system_payment_method,
          display_name: 'Efectivo',
        },
      },
      {
        ...LEG_METHODS[1],
        display_name: 'Nequi del local',
        system_payment_method: {
          ...LEG_METHODS[1].system_payment_method,
          display_name: 'Transferencia',
        },
      },
    ];
    h.prismaMock.store_payment_methods.findMany.mockImplementation(
      async ({ where }: any) => {
        const ids: number[] = where?.id?.in ?? [];
        return renamed.filter((row) => ids.includes(row.id));
      },
    );

    const result: any = await h.service.payOrder(1, MULTI_DTO);

    // UI/ticket: el nombre que la tienda eligió.
    expect(result.payments.map((p: any) => p.payment_method)).toEqual([
      'Caja',
      'Nequi del local',
    ]);
    // Contabilidad: la etiqueta del sistema, nunca la renombrada.
    const payloads = h.emitter.emitAsync.mock.calls
      .filter((call: any[]) => call[0] === 'payment.received')
      .map((call: any[]) => call[1]);
    expect(payloads.map((p: any) => p.payment_method)).toEqual([
      'Efectivo',
      'Transferencia',
    ]);
  });

  it('cocina pendiente (modo estricto) → las 2 filas quedan cancelled y la orden vuelve a created', async () => {
    const h = buildHarness({ kitchenPending: true });

    const error = await h.service
      .payOrder(1, MULTI_DTO, { strictKitchenPending: true })
      .catch((failure) => failure);

    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.errorCode).toBe('ORD_FLOW_PAYMENT_FAILED_001');
    // Compensación: TODAS las filas creadas, mismo motivo.
    expect(h.prismaMock.payments.update).toHaveBeenCalledTimes(2);
    expect(h.prismaMock.payments.update).toHaveBeenNthCalledWith(1, {
      where: { id: 101 },
      data: expect.objectContaining({
        state: 'cancelled',
        gateway_response: expect.objectContaining({
          cancellation_reason: 'kitchen_items_pending',
        }),
      }),
    });
    expect(h.prismaMock.payments.update).toHaveBeenNthCalledWith(2, {
      where: { id: 102 },
      data: expect.objectContaining({
        state: 'cancelled',
        gateway_response: expect.objectContaining({
          cancellation_reason: 'kitchen_items_pending',
        }),
      }),
    });
    // Estado previo restaurado (no varada en `processing`).
    expect(h.prismaMock.orders.updateMany).toHaveBeenCalledWith({
      where: { id: 1, state: 'processing' },
      data: expect.objectContaining({ state: 'created' }),
    });
  });

  it("payment_type online + payments[] → 400 PAY_MULTI_TENDER_METHOD_NOT_ALLOWED", async () => {
    const h = buildHarness();

    const error = await h.service
      .payOrder(1, { ...MULTI_DTO, payment_type: PaymentType.ONLINE })
      .catch((failure) => failure);

    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.errorCode).toBe('PAY_MULTI_TENDER_METHOD_NOT_ALLOWED');
    expect(error.getStatus()).toBe(400);
    // La guarda es upfront: ni tramos cargados ni filas creadas.
    expect(h.prismaMock.store_payment_methods.findMany).not.toHaveBeenCalled();
    expect(h.prismaMock.payments.create).not.toHaveBeenCalled();
  });

  it('regresión escalar: 1 fila, respuesta histórica sin payments[] ni findMany', async () => {
    const h = buildHarness();
    h.prismaMock.store_payment_methods.findFirst.mockResolvedValue(
      LEG_METHODS[1],
    );

    const result = await h.service.payOrder(1, {
      store_payment_method_id: TRANSFER_ID,
      payment_type: PaymentType.DIRECT,
    });

    expect(h.prismaMock.payments.create).toHaveBeenCalledTimes(1);
    expect(h.prismaMock.payments.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          store_payment_method_id: TRANSFER_ID,
          amount: 100000,
          state: 'succeeded',
        }),
      }),
    );
    expect(
      h.prismaMock.store_payment_methods.findMany,
    ).not.toHaveBeenCalled();
    expect(h.cashMovement).toHaveBeenCalledTimes(1);
    expect(h.cashMovement).toHaveBeenCalledWith(4, 1, 100000, 'bank_transfer', 101);
    expect(result.payment).toEqual({ transaction_id: 'TXN-1', change: 0 });
    expect(result).not.toHaveProperty('payments');

    // PLAN-pago-multimetodo-pendientes paso 2 — pago escalar: 1 solo emit.
    const paymentReceivedCalls = h.emitter.emitAsync.mock.calls.filter(
      (call: any[]) => call[0] === 'payment.received',
    );
    expect(paymentReceivedCalls).toHaveLength(1);
    expect(paymentReceivedCalls[0][1]).toMatchObject({ amount: 100000 });
  });

  it('transferencia escalar conserva la cuenta bancaria validada antes de registrar el pago', async () => {
    const h = buildHarness();
    h.prismaMock.store_payment_methods.findFirst.mockResolvedValue(LEG_METHODS[1]);
    h.prismaMock.orders.update = jest.fn().mockResolvedValue({});
    const orderWithTip = {
      id: 1,
      state: 'processing',
      delivery_type: 'direct_delivery',
      subtotal_amount: 100000,
      tax_amount: 0,
      grand_total: 110000,
      tip_amount: 10000,
      currency: 'COP',
      store_id: 4,
      customer_id: 44,
      payments: [],
    };
    (h.service as any).getOrder.mockResolvedValueOnce({
      ...orderWithTip,
      grand_total: 100000,
      tip_amount: 0,
    }).mockResolvedValue(orderWithTip);

    await h.service.payOrder(1, {
      store_payment_method_id: TRANSFER_ID,
      payment_type: PaymentType.DIRECT,
      bank_account_id: 7,
      tip_amount: 10000,
    });

    expect(h.prismaMock.orders.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({ tip_amount: 10000, grand_total: 110000 }),
    });
    expect(h.paymentGatewayService.resolveAndValidateBankAccount).toHaveBeenCalledWith(
      7,
      4,
      h.prismaMock,
    );
    expect(h.prismaMock.payments.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          store_payment_method_id: TRANSFER_ID,
          bank_account_id: 7,
          amount: 110000,
          state: 'succeeded',
        }),
      }),
    );
  });

  it('transferencia escalar rechaza una cuenta de otra tienda sin crear pago', async () => {
    const h = buildHarness();
    h.prismaMock.store_payment_methods.findFirst.mockResolvedValue(LEG_METHODS[1]);
    h.paymentGatewayService.resolveAndValidateBankAccount.mockRejectedValue(
      new PaymentError(
        PaymentErrorCodes.VALIDATION_FAILED,
        'La cuenta bancaria no pertenece a esta tienda',
      ),
    );

    const error = await h.service.payOrder(1, {
      store_payment_method_id: TRANSFER_ID,
      payment_type: PaymentType.DIRECT,
      bank_account_id: 7,
    }).catch((failure) => failure);

    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.errorCode).toBe(ErrorCodes.PAY_VALIDATE_001.code);
    expect(error.getStatus()).toBe(400);
    expect(h.paymentGatewayService.resolveAndValidateBankAccount).toHaveBeenCalledWith(
      7,
      4,
      h.prismaMock,
    );
    expect(h.prismaMock.payments.create).not.toHaveBeenCalled();
  });

  it("payment_type online (sin payments[]) → NO emite payment.received (queda pending, la pasarela lo confirma después)", async () => {
    const h = buildHarness();
    h.prismaMock.store_payment_methods.findFirst.mockResolvedValue(
      LEG_METHODS[1],
    );

    const result = await h.service.payOrder(1, {
      store_payment_method_id: TRANSFER_ID,
      payment_type: PaymentType.ONLINE,
    });

    expect(result.payment).toEqual({ transaction_id: 'TXN-1' });
    const paymentReceivedCalls = h.emitter.emitAsync.mock.calls.filter(
      (call: any[]) => call[0] === 'payment.received',
    );
    expect(paymentReceivedCalls).toHaveLength(0);
  });

  it('wallet online reserva el pago y devuelve su id sin ejecutar el procesador', async () => {
    const h = buildHarness();
    h.prismaMock.store_payment_methods.findFirst.mockResolvedValue({
      id: 3,
      system_payment_method: { type: 'wallet', processing_mode: 'DIRECT' },
    });

    const result = await h.service.payOrder(1, {
      store_payment_method_id: 3,
      payment_type: PaymentType.ONLINE,
      payment_reference: 'not-a-gateway-reference',
    });

    expect(result.payment).toEqual({ id: 101, transaction_id: 'TXN-1' });
    expect(h.prismaMock.payments.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        store_payment_method_id: 3,
        state: 'pending',
        gateway_reference: null,
      }),
    });
    expect(h.prismaMock.payments.create).toHaveBeenCalledTimes(1);
    expect(h.paymentGatewayService.resolveAndValidateBankAccount).not.toHaveBeenCalled();
  });

  it('no reserva Wompi sobre un pago online ya pendiente de otro método', async () => {
    const h = buildHarness({ preClaimState: 'pending_payment' });
    h.prismaMock.store_payment_methods.findFirst.mockResolvedValue({
      id: 3,
      system_payment_method: { type: 'wompi', processing_mode: 'ONLINE' },
    });
    (h.service as any).getOrder.mockResolvedValue({
      id: 1,
      state: 'processing',
      delivery_type: 'direct_delivery',
      grand_total: 100000,
      currency: 'COP',
      store_id: 4,
      customer_id: 44,
      payments: [{ id: 80, state: 'pending', store_payment_method: {
        system_payment_method: { type: 'bank_transfer' },
      } }],
    });

    const error = await h.service.payOrder(1, {
      store_payment_method_id: 3,
      payment_type: PaymentType.ONLINE,
    }).catch((failure) => failure);

    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.errorCode).toBe(ErrorCodes.ORD_FLOW_PAYMENT_FAILED_001.code);
    expect(h.prismaMock.payments.create).not.toHaveBeenCalled();
    expect(h.prismaMock.orders.updateMany).toHaveBeenCalledWith({
      where: { id: 1, state: 'processing' },
      data: expect.objectContaining({ state: 'pending_payment' }),
    });
  });

  it('shipped + 2 tramos → 2 filas y restaura shipped', async () => {
    const h = buildHarness({ preClaimState: 'shipped' });

    const result: any = await h.service.payOrder(1, MULTI_DTO);

    expect(h.prismaMock.payments.create).toHaveBeenCalledTimes(2);
    expect(h.prismaMock.payments.update).not.toHaveBeenCalled();
    expect(h.updateOrderState).toHaveBeenCalledWith(
      1,
      'shipped',
      expect.objectContaining({ total_paid: 100000, remaining_balance: 0 }),
      { historyFromState: 'shipped' },
    );
    expect(h.cashMovement).toHaveBeenCalledTimes(2);
    expect(h.project).toHaveBeenCalledWith(1, 101);
    expect(result.payment).toEqual({ transaction_id: 'TXN-1', change: 30000 });
    expect(result.payments).toHaveLength(2);
  });

  it('Σ ≠ total → 400 sin envolver con error_code PAY_MULTI_TENDER_SUM_MISMATCH, orden restaurada y sin filas', async () => {
    const h = buildHarness();

    const error = await h.service
      .payOrder(1, {
        ...MULTI_DTO,
        payments: [
          { store_payment_method_id: CASH_ID, amount: 20000 },
          { store_payment_method_id: TRANSFER_ID, amount: 79999 },
        ],
      })
      .catch((failure) => failure);

    // PLAN-pago-multimetodo-pendientes paso 3 — rechazo de VALIDACIÓN de
    // payload: la superficie es el propio error_code del normalizador
    // (`PAY_MULTI_TENDER_SUM_MISMATCH`, 400), ya NO el 409 genérico
    // `ORD_FLOW_PAYMENT_FAILED_001` envuelto.
    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.errorCode).toBe('PAY_MULTI_TENDER_SUM_MISMATCH');
    expect(error.getStatus()).toBe(400);
    expect(h.prismaMock.payments.create).not.toHaveBeenCalled();
    // El claim ya había movido la orden a `processing`; el rechazo de
    // validación restaura igual que cualquier otro error (el catch externo
    // de payOrder no distingue por código).
    expect(h.prismaMock.orders.updateMany).toHaveBeenCalledWith({
      where: { id: 1, state: 'processing' },
      data: expect.objectContaining({ state: 'created' }),
    });
  });

  // Plan PLAN-pago-multimetodo-fixes paso 1 — objetivo 1: atomicidad. Si el
  // segundo tramo falla, la `$transaction` revierte el primero (0 filas
  // succeeded quedan) y la orden vuelve a su estado previo al claim.
  it('segundo tramo falla → $transaction revierte, cero filas quedan y la orden se restaura', async () => {
    const h = buildHarness();
    h.prismaMock.payments.create
      .mockImplementationOnce(async ({ data }: any) => ({ id: 101, ...data }))
      .mockImplementationOnce(async () => {
        throw new Error('boom: el segundo tramo falla');
      });

    const error = await h.service
      .payOrder(1, MULTI_DTO)
      .catch((failure) => failure);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('boom: el segundo tramo falla');
    // Los dos intentos de create ocurrieron (el segundo es el que revienta),
    // pero la `$transaction` que los envuelve rechazó como un todo: no hay
    // compensación adicional vía `cancelLegPayments` (nunca llegó a
    // `paymentPersisted = true`), y la orden vuelve al estado previo.
    expect(h.prismaMock.payments.create).toHaveBeenCalledTimes(2);
    expect(h.prismaMock.payments.update).not.toHaveBeenCalled();
    expect(h.prismaMock.orders.updateMany).toHaveBeenCalledWith({
      where: { id: 1, state: 'processing' },
      data: expect.objectContaining({ state: 'created' }),
    });
  });

  // PLAN-pago-multimetodo-pendientes paso 3 — una cuenta que no pertenece a
  // la tienda se rechaza ANTES de crear ninguna fila, con el mismo código
  // tipado (`PAY_VALIDATE_001`) que ya usa el gateway del POS, relanzado SIN
  // envolver: la superficie es 400 `PAY_VALIDATE_001` de superficie (rechazo
  // de validación), ya NO el 409 `ORD_FLOW_PAYMENT_FAILED_001` con
  // cause_code.
  it('bank_account_id ajeno a la tienda → 400 sin envolver con error_code PAY_VALIDATE_001 y cero payments.create', async () => {
    const h = buildHarness();
    h.paymentGatewayService.resolveAndValidateBankAccount.mockRejectedValue(
      new PaymentError(
        PaymentErrorCodes.VALIDATION_FAILED,
        'La cuenta bancaria no pertenece a esta tienda',
      ),
    );

    const error = await h.service
      .payOrder(1, MULTI_DTO)
      .catch((failure) => failure);

    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.errorCode).toBe(ErrorCodes.PAY_VALIDATE_001.code);
    expect(error.getStatus()).toBe(400);
    expect(h.prismaMock.payments.create).not.toHaveBeenCalled();
    // El claim ya había movido la orden a `processing`; el rechazo de
    // validación restaura igual que cualquier otro error (el catch externo
    // de payOrder no distingue por código).
    expect(h.prismaMock.orders.updateMany).toHaveBeenCalledWith({
      where: { id: 1, state: 'processing' },
      data: expect.objectContaining({ state: 'created' }),
    });
  });
});

/**
 * B4/B8 follow-up — `payOrder` en `delivered`/`finished` SIN pago liquidado
 * (COD huérfana, o reabierta por `cancelPayment`): registra el pago y
 * PERMANECE en el mismo estado (B1b: cobrar dinero no es lo mismo que
 * finalizar la orden — ver el branch `delivered` de `payOrder`, que a
 * propósito no llama a `emitPosSaleCompletedIfFullyPaid`). Con un pago
 * `succeeded` YA existente, el precheck (ANTES del claim de estado) rechaza
 * con `ORD_FLOW_PAYMENT_FAILED_001` / `reason: 'already_settled'` — una
 * guarda DISTINTA del `ORD_PAY_ALREADY_PAID_001` genérico post-claim, fácil
 * de confundir si sólo se afirma `instanceof VendixHttpException`. Y con
 * `payment_form === '2'` (venta a crédito) rechaza con `ORD_PAY_CREDIT_ORDER_001`
 * sin tocar el estado ni contar pagos liquidados.
 */
describe('OrderFlowService.payOrder — B4/B8 delivered/finished sin pago liquidado', () => {
  const ORDER_ID = 1;
  const DTO: any = { store_payment_method_id: 1, payment_type: PaymentType.DIRECT };

  const buildHarness = (opts: {
    preClaimState: 'delivered' | 'finished';
    settledCount?: number;
    paymentForm?: string | null;
  }) => {
    let paySeq = 500;
    let txnSeq = 0;
    const stateUpdates: Array<{ state: string; metadata: unknown }> = [];
    const prismaMock: any = {
      store_payment_methods: {
        findFirst: jest.fn().mockResolvedValue({
          id: 1,
          system_payment_method: { type: 'cash', processing_mode: 'DIRECT' },
        }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      payments: {
        create: jest.fn().mockImplementation(async ({ data }: any) => ({
          id: ++paySeq,
          ...data,
        })),
        count: jest.fn().mockResolvedValue(opts.settledCount ?? 0),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      orders: {
        findFirst: jest.fn().mockImplementation(async (args: any) => {
          const sel = args?.select;
          if (sel?.state !== undefined && sel?.payment_form !== undefined) {
            // Precheck (`preClaimRow`): estado + forma de pago, ANTES del claim.
            return { state: opts.preClaimState, payment_form: opts.paymentForm ?? null };
          }
          if (sel?.coupon_id !== undefined) {
            // Sonda de `commitCouponUseForOrder` — orden sin cupón.
            return {
              id: ORDER_ID,
              coupon_id: null,
              coupon_code: null,
              discount_amount: null,
              store_id: 4,
            };
          }
          // Sonda del shipping-gate: direct_delivery no requiere despacho.
          return {
            id: ORDER_ID,
            active_financial_split_id: null,
            delivery_type: 'direct_delivery',
            shipping_method_id: null,
            order_items: [],
          };
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({ id: ORDER_ID }),
      },
    };
    // `createLegPayments`/`cancelLegPayments` corren dentro de
    // `this.prisma.$transaction(async (tx) => …)`; el mock resuelve el
    // callback contra el mismo `prismaMock` para que `tx.payments` sea el
    // mock que estos tests ya assertan sobre `prismaMock.payments`.
    prismaMock.$transaction = jest.fn(async (callback: any) => callback(prismaMock));

    const service = new OrderFlowService(
      prismaMock as unknown as StorePrismaService,
      { emit: jest.fn(), emitAsync: jest.fn().mockResolvedValue([]) } as any,
      {} as any, { assertSessionForSales: jest.fn() } as any, {} as any, {} as any, {} as any, {} as any,
      { logCustom: jest.fn().mockResolvedValue(undefined) } as any,
    );

    jest.spyOn(service as any, 'getOrder').mockResolvedValue({
      id: ORDER_ID,
      // Recarga post-claim: el claim ya movió la orden a `processing`.
      state: 'processing',
      delivery_type: 'direct_delivery',
      store_id: 4,
      customer_id: 44,
      currency: 'COP',
      subtotal_amount: 50,
      tax_amount: 9.5,
      grand_total: 59.5,
      payments: [],
    });
    jest
      .spyOn(service as any, 'generateTransactionId')
      .mockImplementation(async () => `TXN-${++txnSeq}`);
    const cashMovement = jest
      .spyOn(service as any, 'recordPayOrderCashMovement')
      .mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'emitPosSaleCompletedIfFullyPaid')
      .mockResolvedValue(undefined);
    const project = jest
      .spyOn(service as any, 'projectPaidOrderToTable')
      .mockResolvedValue(undefined);
    const updateOrderState = jest
      .spyOn(service as any, 'updateOrderState')
      .mockImplementation(async (_id: number, next: string, metadata: unknown = {}) => {
        stateUpdates.push({ state: next, metadata: metadata as object });
        return { id: ORDER_ID, state: next, ...(metadata as object) };
      });

    return { service, prismaMock, stateUpdates, cashMovement, project, updateOrderState };
  };

  it('delivered sin pago liquidado → registra el pago y permanece en delivered (no finaliza la orden)', async () => {
    const h = buildHarness({ preClaimState: 'delivered' });

    const result: any = await h.service.payOrder(ORDER_ID, DTO);

    expect(h.prismaMock.orders.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          state: expect.objectContaining({
            in: expect.arrayContaining(['delivered', 'finished']),
          }),
        }),
        data: expect.objectContaining({ state: 'processing' }),
      }),
    );
    expect(h.prismaMock.payments.create).toHaveBeenCalledTimes(1);
    expect(h.prismaMock.payments.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ amount: 59.5, state: 'succeeded' }),
      }),
    );
    expect(h.updateOrderState).toHaveBeenCalledWith(
      ORDER_ID,
      'delivered',
      expect.objectContaining({ total_paid: 59.5, remaining_balance: 0 }),
      { historyFromState: 'delivered' },
    );
    expect(h.stateUpdates).toEqual([
      { state: 'delivered', metadata: expect.objectContaining({ total_paid: 59.5, remaining_balance: 0 }) },
    ]);
    expect(result.order).toEqual(expect.objectContaining({ state: 'delivered' }));
  });

  it('finished sin pago liquidado → registra el pago y permanece en finished', async () => {
    const h = buildHarness({ preClaimState: 'finished' });

    const result: any = await h.service.payOrder(ORDER_ID, DTO);

    expect(h.prismaMock.payments.create).toHaveBeenCalledTimes(1);
    expect(h.updateOrderState).toHaveBeenCalledWith(
      ORDER_ID,
      'finished',
      expect.objectContaining({ total_paid: 59.5, remaining_balance: 0 }),
      { historyFromState: 'finished' },
    );
    expect(result.order).toEqual(expect.objectContaining({ state: 'finished' }));
  });

  it('finished con un pago succeeded ya existente → rechazo tipado ANTES del claim (no ORD_PAY_ALREADY_PAID_001)', async () => {
    const h = buildHarness({ preClaimState: 'finished', settledCount: 1 });

    const error: any = await h.service.payOrder(ORDER_ID, DTO).catch((failure: any) => failure);

    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.errorCode).toBe('ORD_FLOW_PAYMENT_FAILED_001');
    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toEqual(
      expect.objectContaining({
        details: expect.objectContaining({
          stage: 'state_not_payable',
          reason: 'already_settled',
        }),
      }),
    );
    expect(h.prismaMock.orders.updateMany).not.toHaveBeenCalled();
    expect(h.prismaMock.payments.create).not.toHaveBeenCalled();
  });

  it('delivered con payment_form "2" (crédito) → 409 ORD_PAY_CREDIT_ORDER_001, sin claim de estado ni conteo de liquidados', async () => {
    const h = buildHarness({ preClaimState: 'delivered', paymentForm: '2' });

    const error: any = await h.service.payOrder(ORDER_ID, DTO).catch((failure: any) => failure);

    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.errorCode).toBe('ORD_PAY_CREDIT_ORDER_001');
    expect(error.getStatus()).toBe(409);
    expect(h.prismaMock.orders.updateMany).not.toHaveBeenCalled();
    expect(h.prismaMock.payments.count).not.toHaveBeenCalled();
    expect(h.prismaMock.payments.create).not.toHaveBeenCalled();
  });
});

// Task B — fast track amplía la exención de método de envío a
// `SHIPPING_METHOD_EXEMPT_DELIVERY_TYPES` (pickup/direct_delivery/dine_in),
// pero SOLO dentro del camino de fast track: `shipOrder`'s guard normal (sin
// `allowExemptDeliveryTypes`) y el auto-finish de `payOrder` quedan intactos.
describe('OrderFlowService.shipOrder — allowExemptDeliveryTypes (Task B, solo fast track)', () => {
  const buildService = (order: Record<string, unknown>) => {
    const prismaMock: any = {
      orders: {
        findFirst: jest.fn(async () => ({ id: 1, store_id: 4, stores: { organization_id: null } })),
      },
      order_items: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new OrderFlowService(
      prismaMock, { emit: jest.fn(), emitAsync: jest.fn().mockResolvedValue([]) } as any, {} as any, {} as any, {} as any, {} as any,
      {} as any, {} as any, {} as any,
    );
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(order);
    jest.spyOn(service as any, 'updateOrderState').mockImplementation(
      async (_id: number, nextState: string, metadata: Record<string, unknown> = {}) => ({
        id: 1, state: nextState, ...metadata,
      }),
    );
    return { service, prismaMock };
  };

  const baseOrder = (delivery_type: string) => ({
    id: 1, state: 'processing', delivery_type, shipping_method_id: null,
    shipping_cost: 0, grand_total: 100, payments: [],
  });

  it('sin flag: pickup sin método sigue rechazando ORD_SHIP_REQUIRED_001 — comportamiento normal intacto', async () => {
    const { service } = buildService(baseOrder('pickup'));
    const error: any = await service.shipOrder(1, {} as any).catch((e) => e);
    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.errorCode).toBe('ORD_SHIP_REQUIRED_001');
  });

  it('con allowExemptDeliveryTypes: pickup sin método SÍ despacha', async () => {
    const { service } = buildService(baseOrder('pickup'));
    const result: any = await service.shipOrder(1, {} as any, false, { allowExemptDeliveryTypes: true });
    expect(result.state).toBe('shipped');
  });

  it('con allowExemptDeliveryTypes: dine_in sin método SÍ despacha', async () => {
    const { service } = buildService(baseOrder('dine_in'));
    const result: any = await service.shipOrder(1, {} as any, false, { allowExemptDeliveryTypes: true });
    expect(result.state).toBe('shipped');
  });

  it('con allowExemptDeliveryTypes: home_delivery sin método SIGUE rechazando — fuera del exempt set', async () => {
    const { service } = buildService(baseOrder('home_delivery'));
    const error: any = await service
      .shipOrder(1, {} as any, false, { allowExemptDeliveryTypes: true })
      .catch((e) => e);
    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.errorCode).toBe('ORD_SHIP_REQUIRED_001');
  });

  // checkout-whatsapp-location-fallback (Paso 2): 'other' es el delivery_type
  // de las órdenes con pending_shipping_assignment (envío por asignar). No
  // está en SHIPPING_METHOD_EXEMPT_DELIVERY_TYPES a propósito — sin método
  // asignado, sigue sin poder despacharse, con o sin allowExemptDeliveryTypes.
  it("'other' sin método sigue rechazando ORD_SHIP_REQUIRED_001 (delivery_type del flujo pending_shipping_assignment)", async () => {
    const { service } = buildService(baseOrder('other'));
    const error: any = await service.shipOrder(1, {} as any).catch((e) => e);
    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.errorCode).toBe('ORD_SHIP_REQUIRED_001');
  });

  it("con allowExemptDeliveryTypes: 'other' sin método SIGUE rechazando — fuera del exempt set", async () => {
    const { service } = buildService(baseOrder('other'));
    const error: any = await service
      .shipOrder(1, {} as any, false, { allowExemptDeliveryTypes: true })
      .catch((e) => e);
    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.errorCode).toBe('ORD_SHIP_REQUIRED_001');
  });
});

describe('OrderFlowService.fastTrackOrder — pickup/dine_in sin método de envío (Task B)', () => {
  const buildService = () => {
    const prismaMock: any = {
      orders: { findFirst: jest.fn(async () => ({ id: 1, state: 'finished' })) },
    };
    const service = new OrderFlowService(
      prismaMock, { emit: jest.fn(), emitAsync: jest.fn().mockResolvedValue([]) } as any, {} as any, {} as any, {} as any, {} as any,
      {} as any, {} as any, {} as any,
    );
    return { service };
  };

  const orderRow = (delivery_type: string, state: string) => ({
    id: 1, state, store_id: 4, order_number: 'O-1',
    delivery_type, shipping_method_id: null, payments: [] as Array<{ state: string }>,
  });

  // Simula la cadena pay→ship→deliver→finish reemplazando cada paso por un
  // stub que sólo avanza el estado — el propósito de este test es el
  // precheck y la llamada a shipOrder que SÍ cambian en esta tarea, no
  // re-probar payOrder/deliverOrder/confirmDelivery (ya cubiertos aparte).
  const stubChain = (service: any, delivery_type: string) => {
    let state = 'created';
    jest.spyOn(service, 'getOrder').mockImplementation(async () => orderRow(delivery_type, state));
    const payOrder = jest.spyOn(service, 'payOrder').mockImplementation(async () => { state = 'processing'; return {} as any; });
    const shipOrder = jest.spyOn(service, 'shipOrder').mockImplementation(async () => { state = 'shipped'; return {} as any; });
    const deliverOrder = jest.spyOn(service, 'deliverOrder').mockImplementation(async () => { state = 'delivered'; return {} as any; });
    const confirmDelivery = jest.spyOn(service, 'confirmDelivery').mockImplementation(async () => { state = 'finished'; return {} as any; });
    return { payOrder, shipOrder, deliverOrder, confirmDelivery, getState: () => state };
  };

  it('pickup sin shipping_method_id: el precheck ampliado pasa y la cadena llega a finished', async () => {
    const { service } = buildService();
    const chain = stubChain(service, 'pickup');
    await service.fastTrackOrder(1, {
      payment: { store_payment_method_id: 1, payment_type: PaymentType.DIRECT },
    } as any);
    expect(chain.payOrder).toHaveBeenCalledTimes(1);
    expect(chain.shipOrder).toHaveBeenCalledWith(1, {}, false, { allowExemptDeliveryTypes: true });
    expect(chain.deliverOrder).toHaveBeenCalledTimes(1);
    expect(chain.confirmDelivery).toHaveBeenCalledTimes(1);
    expect(chain.getState()).toBe('finished');
  });

  it('dine_in sin shipping_method_id: el precheck ampliado pasa y la cadena llega a finished', async () => {
    const { service } = buildService();
    const chain = stubChain(service, 'dine_in');
    await service.fastTrackOrder(1, {
      payment: { store_payment_method_id: 1, payment_type: PaymentType.DIRECT },
    } as any);
    expect(chain.shipOrder).toHaveBeenCalledWith(1, {}, false, { allowExemptDeliveryTypes: true });
    expect(chain.getState()).toBe('finished');
  });

  it('home_delivery sin shipping_method_id: sigue rechazando con el mismo error de siempre, antes de pagar', async () => {
    const { service } = buildService();
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(orderRow('home_delivery', 'created'));
    const payOrder = jest.spyOn(service as any, 'payOrder').mockResolvedValue(undefined);
    const error: any = await service.fastTrackOrder(1, {} as any).catch((e) => e);
    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.errorCode).toBe('ORD_SHIP_REQUIRED_FOR_FLOW_001');
    expect(payOrder).not.toHaveBeenCalled();
  });
});

describe('OrderFlowService.settleFinancialSplitSource — guardia de stock (docs/plans/no-overselling-stock-guard-plan.md paso 9)', () => {
  const ORDER_ID = 501;
  const STORE_ID = 4;

  // Cuenta financiera POS de entrega directa, pagada por completo, sin mesa
  // abierta — la única forma que este método llega a la rama de commit de
  // stock (línea :2247 en order-flow.service.ts).
  const baseOrder = (overrides: Record<string, unknown> = {}) => ({
    id: ORDER_ID,
    store_id: STORE_ID,
    state: 'created',
    active_financial_split_id: 77,
    grand_total: 100,
    payments: [{ state: 'succeeded', amount: 100 }],
    ...overrides,
  });

  const build = () => {
    const prismaMock: any = {
      table_sessions: { findFirst: jest.fn().mockResolvedValue(null) },
      orders: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn().mockResolvedValue({
          id: ORDER_ID,
          channel: 'pos',
          delivery_type: 'direct_delivery',
          order_items: [{ products: { requires_serial_numbers: false } }],
        }),
      },
    };
    const orderStockCommit = { commitOrderDelivery: jest.fn() };
    const stockValidator = { resolveInventoryPolicy: jest.fn() };

    const service = new OrderFlowService(
      prismaMock as unknown as StorePrismaService,
      { emit: jest.fn() } as any,
      {} as any, {} as any, {} as any, {} as any, {} as any,
      orderStockCommit as any,
      { logCustom: jest.fn().mockResolvedValue(undefined) } as any,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      stockValidator as any,
    );

    jest.spyOn(service as any, 'getOrder').mockResolvedValue(baseOrder());

    return { service, prismaMock, orderStockCommit, stockValidator };
  };

  afterEach(() => jest.restoreAllMocks());

  it('línea de producto en 0 con allowOversell=false: propaga el errorCode real del commit (INV_STOCK_002) y pide bloqueo', async () => {
    const { service, orderStockCommit, stockValidator } = build();
    stockValidator.resolveInventoryPolicy.mockResolvedValue({
      allowOversell: false,
      allowIngredientOveruse: true,
    });
    // `commitOrderDelivery` con `blockOnInsufficient:true` lanza
    // `INV_STOCK_002` cuando la disponibilidad total no cubre la línea
    // (order-stock-commit.service.ts:756-770) — NO `INV_STOCK_INSUFFICIENT_LINES`
    // (ese código es del guard de `assertLinesAvailable`, otro punto de entrada).
    orderStockCommit.commitOrderDelivery.mockRejectedValue(
      new VendixHttpException(
        ErrorCodes.INV_STOCK_002,
        'No se puede entregar: stock insuficiente para MODELO (disponible 0, requerido 2)',
        { product_id: 701, requested: 2, available: 0 },
      ),
    );

    const error: any = await service
      .settleFinancialSplitSource(ORDER_ID)
      .catch((e) => e);

    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.errorCode).toBe(ErrorCodes.INV_STOCK_002.code);
    expect(stockValidator.resolveInventoryPolicy).toHaveBeenCalledWith(STORE_ID);
    expect(orderStockCommit.commitOrderDelivery).toHaveBeenCalledWith(
      ORDER_ID,
      expect.objectContaining({
        blockOnInsufficient: true,
        allowNegativeOnShortfall: false,
      }),
    );
  });

  it('allowOversell=true: no bloquea y el commit recibe la opción de negativo permitido', async () => {
    const { service, orderStockCommit, stockValidator } = build();
    stockValidator.resolveInventoryPolicy.mockResolvedValue({
      allowOversell: true,
      allowIngredientOveruse: true,
    });
    orderStockCommit.commitOrderDelivery.mockResolvedValue({
      totalCost: 0,
      committedItemCount: 1,
    });

    await expect(
      service.settleFinancialSplitSource(ORDER_ID),
    ).resolves.toBeUndefined();

    expect(orderStockCommit.commitOrderDelivery).toHaveBeenCalledWith(
      ORDER_ID,
      expect.objectContaining({
        blockOnInsufficient: false,
        allowNegativeOnShortfall: true,
      }),
    );
  });
});

// PR #858 hallazgo 4 — la base de reteIVA (`ivaAmount`) que `flow/pay` le
// pasa a `resolveSufferedByOperation` es el IVA de la línea, no Σ de todos
// sus impuestos: un INC no entra. `tax_type` nulo = IVA (fila legada).
describe('OrderFlowService.emitLegPaymentReceivedEvents — base de reteIVA', () => {
  it('ivaAmount suma sólo IVA (y filas sin tipar); INC queda fuera', async () => {
    const prismaMock: any = {
      order_items: {
        findMany: jest.fn().mockResolvedValue([
          {
            total_price: 100000,
            quantity: 1,
            tax_amount_item: 27000,
            weight: null,
            price_unit_quantity: null,
            item_type: 'product',
            order_item_taxes: [
              { tax_type: 'iva', tax_amount: 19000, tax_rate: 0.19 },
              { tax_type: 'inc', tax_amount: 8000, tax_rate: 0.08 },
            ],
          },
          {
            total_price: 50000,
            quantity: 1,
            tax_amount_item: 9500,
            weight: null,
            price_unit_quantity: null,
            item_type: 'product',
            order_item_taxes: [
              { tax_type: null, tax_amount: 9500, tax_rate: 0.19 },
            ],
          },
          {
            total_price: 20000,
            quantity: 1,
            tax_amount_item: 1600,
            weight: null,
            price_unit_quantity: null,
            item_type: 'product',
            order_item_taxes: [
              { tax_type: 'inc', tax_amount: 1600, tax_rate: 0.08 },
            ],
          },
        ]),
      },
    };
    const withholdingFlow: any = {
      resolveSufferedByOperation: jest.fn().mockResolvedValue({
        lines: [],
        uvt_value_used: 0,
        counterparty_type: null,
      }),
      persistWithholdingLines: jest.fn().mockResolvedValue(undefined),
    };
    const emitter = { emit: jest.fn(), emitAsync: jest.fn().mockResolvedValue([]) };
    const service = new OrderFlowService(
      prismaMock as unknown as StorePrismaService,
      emitter as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { logCustom: jest.fn().mockResolvedValue(undefined) } as any,
      undefined, // kitchenFireService
      undefined, // shippingTaxService
      undefined, // moduleRef
      undefined, // refundFlowService
      undefined, // autoEntryService
      undefined, // orderSse
      undefined, // orderHistoryService
      undefined, // stockValidator
      undefined, // sellableStockAllocator
      undefined, // paymentGatewayService
      undefined, // shippingCalculatorService
      withholdingFlow,
    );

    await (service as any).emitLegPaymentReceivedEvents(
      1,
      {
        id: 1,
        order_number: 'ORD-1',
        store_id: 4,
        customer_id: 44,
        stores: { organization_id: 2 },
        subtotal_amount: 170000,
        tip_amount: 0,
        currency: 'COP',
      },
      [
        {
          payment: { id: 900, currency: 'COP' },
          leg: { amount: 208100, accounting_method: 'Efectivo' },
        },
      ],
    );

    expect(withholdingFlow.resolveSufferedByOperation).toHaveBeenCalledTimes(1);
    const { items } = withholdingFlow.resolveSufferedByOperation.mock.calls[0][0];
    expect(items.map((item: any) => item.ivaAmount)).toEqual([19000, 9500, 0]);
    // La base de retefuente/reteICA sigue siendo el subtotal de la línea.
    expect(items.map((item: any) => item.base)).toEqual([100000, 50000, 20000]);
    // Y el evento sí salió (el filtro no rompió la emisión).
    const payloads = emitter.emitAsync.mock.calls.filter(
      (call: any[]) => call[0] === 'payment.received',
    );
    expect(payloads).toHaveLength(1);
    expect(payloads[0][1].payment_method).toBe('Efectivo');
  });
});

// PR #858 hallazgos 2, 3 y 5 — `flow/pay` con abono previo: la retención de
// la orden se prorratea a la porción de este cobro, se PERSISTE (con
// `order_id`) ANTES de emitir `payment.received`, y el evento lleva sólo lo
// persistido. Si la persistencia falla, el evento sale sin retención.
describe('OrderFlowService.emitLegPaymentReceivedEvents — prorrateo y persistir antes de emitir', () => {
  const line = {
    withholding_type: 'retefuente',
    concept_code: 'RF-COMPRAS',
    concept_id: 5,
    rate: 0.025,
    base: 100000,
    amount: 2500,
    role: 'suffered',
    account_role: 'withholding.suffered.retefuente_receivable',
  };
  const order = {
    id: 1,
    order_number: 'ORD-1',
    store_id: 4,
    customer_id: 44,
    stores: { organization_id: 2 },
    subtotal_amount: 100000,
    tip_amount: 0,
    grand_total: 119000,
    currency: 'COP',
  };

  const build = (persistImpl?: () => Promise<unknown>) => {
    const calls: string[] = [];
    const prismaMock: any = {
      order_items: {
        findMany: jest.fn().mockResolvedValue([
          {
            total_price: 100000,
            quantity: 1,
            tax_amount_item: 19000,
            weight: null,
            price_unit_quantity: null,
            item_type: 'product',
            order_item_taxes: [{ tax_type: 'iva', tax_amount: 19000, tax_rate: 0.19 }],
          },
        ]),
      },
    };
    const withholdingFlow: any = {
      resolveSufferedByOperation: jest.fn().mockResolvedValue({
        lines: [line],
        uvt_value_used: 49799,
        counterparty_type: 'juridica',
      }),
      persistWithholdingLines: jest.fn().mockImplementation(async () => {
        calls.push('persist');
        if (persistImpl) return persistImpl();
        return undefined;
      }),
    };
    const emitter = {
      emit: jest.fn(),
      emitAsync: jest.fn().mockImplementation(async () => {
        calls.push('emit');
        return [];
      }),
    };
    const service = new OrderFlowService(
      prismaMock as unknown as StorePrismaService,
      emitter as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { logCustom: jest.fn().mockResolvedValue(undefined) } as any,
      undefined, // kitchenFireService
      undefined, // shippingTaxService
      undefined, // moduleRef
      undefined, // refundFlowService
      undefined, // autoEntryService
      undefined, // orderSse
      undefined, // orderHistoryService
      undefined, // stockValidator
      undefined, // sellableStockAllocator
      undefined, // paymentGatewayService
      undefined, // shippingCalculatorService
      withholdingFlow,
    );
    return { service, withholdingFlow, emitter, calls };
  };

  const pay = (service: any, amount: number) =>
    service.emitLegPaymentReceivedEvents(1, order, [
      {
        payment: { id: 900, currency: 'COP' },
        leg: { amount, accounting_method: 'Efectivo' },
      },
    ]);

  it('abono del 40 %: persiste y emite la porción prorrateada, persistiendo primero', async () => {
    const { service, withholdingFlow, emitter, calls } = build();

    await pay(service, 47600);

    expect(calls).toEqual(['persist', 'emit']);
    const ctx = withholdingFlow.persistWithholdingLines.mock.calls[0][0];
    expect(ctx).toMatchObject({ order_id: 1, invoice_id: null, role: 'suffered', customer_id: 44 });
    expect(ctx.lines).toEqual([{ ...line, base: 40000, amount: 1000 }]);
    const payload = emitter.emitAsync.mock.calls[0][1];
    expect(payload.withholding_breakdown).toEqual(ctx.lines);
  });

  it('cobro por el total: las líneas pasan intactas (factor 1)', async () => {
    const { service, withholdingFlow, emitter } = build();

    await pay(service, 119000);

    const ctx = withholdingFlow.persistWithholdingLines.mock.calls[0][0];
    expect(ctx.lines).toEqual([line]);
    expect(emitter.emitAsync.mock.calls[0][1].withholding_breakdown).toEqual([line]);
  });

  it('orden ya facturada: no resuelve ni persiste, emite con withholding_breakdown []', async () => {
    const { service, withholdingFlow, emitter } = build();
    const prisma = (service as any).prisma;
    prisma.invoices = { findFirst: jest.fn().mockResolvedValue({ id: 300 }) };
    prisma.withoutScope = () => ({
      accounting_entries: { findFirst: jest.fn().mockResolvedValue(null) },
    });

    await pay(service, 71400);

    // Mismo criterio que la rama «con factura» de `onPaymentReceived`.
    expect(prisma.invoices.findFirst).toHaveBeenCalledWith({
      where: { order_id: 1, status: { notIn: ['cancelled', 'voided'] } },
      select: { id: true },
    });
    expect(withholdingFlow.resolveSufferedByOperation).not.toHaveBeenCalled();
    expect(withholdingFlow.persistWithholdingLines).not.toHaveBeenCalled();
    expect(emitter.emitAsync).toHaveBeenCalledTimes(1);
    expect(emitter.emitAsync.mock.calls[0][1].withholding_breakdown).toEqual([]);
  });

  it('orden sin factura: sigue reteniendo (control del corte)', async () => {
    const { service, withholdingFlow } = build();
    const prisma = (service as any).prisma;
    prisma.invoices = { findFirst: jest.fn().mockResolvedValue(null) };
    prisma.withoutScope = () => ({
      accounting_entries: { findFirst: jest.fn().mockResolvedValue(null) },
    });

    await pay(service, 119000);

    expect(withholdingFlow.persistWithholdingLines).toHaveBeenCalledTimes(1);
  });

  it('si la persistencia falla, emite sin retención y deja log.error', async () => {
    const { service, emitter } = build(() => Promise.reject(new Error('db down')));
    const errorSpy = jest.spyOn((service as any).logger, 'error');

    await pay(service, 119000);

    expect(emitter.emitAsync).toHaveBeenCalledTimes(1);
    const payload = emitter.emitAsync.mock.calls[0][1];
    expect(payload.withholding_breakdown ?? []).toEqual([]);
    expect(
      errorSpy.mock.calls.some((call) => String(call[0]).includes('withholding persist failed')),
    ).toBe(true);
  });
});

describe('isManualConfirmationPending — pago pending de confirmación manual (Fase 2 paso 5)', () => {
  const pending = (type: string | null, processing_mode: string | null, state = 'pending') => ({
    state,
    store_payment_method:
      type == null && processing_mode == null
        ? null
        : { system_payment_method: { type, processing_mode } },
  });

  it.each([
    ['bank_transfer', 'ONLINE'],
    ['voucher', 'ONLINE'],
    ['card', 'DIRECT'],
    ['cash', 'DIRECT'],
  ])('pending %s/%s → manual', (type, mode) => {
    expect(isManualConfirmationPending(pending(type, mode) as any)).toBe(true);
  });

  it.each([
    ['wompi pendiente', pending('wompi', 'ONLINE')],
    ['wallet pendiente', pending('wallet', 'DIRECT')],
    ['contra entrega pendiente', pending('cash_on_delivery', 'ON_DELIVERY')],
    ['bank_transfer ya succeeded', pending('bank_transfer', 'ONLINE', 'succeeded')],
    ['pending sin método resoluble (fail-closed)', { state: 'pending', store_payment_method: null }],
    ['pago nulo', null],
  ])('%s → no manual', (_label, payment) => {
    expect(isManualConfirmationPending(payment as any)).toBe(false);
  });
});

describe('OrderFlowService.payOrder — registrar pago online manual (Fase 2 paso 5)', () => {
  const CASH_ID = 1;
  const TRANSFER_ID = 2;
  const GRAND = 100000;
  const RECEIPT_AT = new Date('2026-09-27T10:00:00.000Z');

  const LEG_METHODS = [
    {
      id: CASH_ID,
      display_name: 'Efectivo',
      system_payment_method: {
        type: 'cash',
        processing_mode: 'DIRECT',
        display_name: 'Efectivo',
      },
    },
    {
      id: TRANSFER_ID,
      display_name: 'Transferencia',
      system_payment_method: {
        type: 'bank_transfer',
        processing_mode: 'DIRECT',
        display_name: 'Transferencia',
      },
    },
  ];

  // Marcador `pending` que deja el checkout online (bank_transfer con
  // comprobante), como lo entrega `getOrder` (escalares + método).
  const manualMarker = (overrides: any = {}) => ({
    id: 51,
    state: 'pending',
    amount: GRAND,
    currency: 'COP',
    store_payment_method_id: TRANSFER_ID,
    transaction_id: 'TXN-ONLINE-51',
    gateway_reference: null,
    gateway_response: { payment_type: 'online' },
    receipt_s3_key: 'receipts/51.png',
    receipt_uploaded_at: RECEIPT_AT,
    bank_account_id: 7,
    store_payment_method: {
      system_payment_method: { type: 'bank_transfer', processing_mode: 'ONLINE' },
    },
    ...overrides,
  });

  const buildHarness = (opts?: {
    preClaimState?: string;
    payments?: any[];
    deliveryType?: string;
  }) => {
    mockRequestContext({ store_id: 4, organization_id: 1, user_id: 42 });
    const preClaimState = opts?.preClaimState ?? 'pending_payment';
    const orderPayments = opts?.payments ?? [manualMarker()];
    const deliveryType = opts?.deliveryType ?? 'home_delivery';
    let paySeq = 100;
    let txnSeq = 0;
    const createdPayments: any[] = [];
    const confirmedInPlace: any[] = [];
    const stateUpdates: Array<{ state: string; metadata: unknown }> = [];
    const prismaMock: any = {
      store_payment_methods: {
        findFirst: jest.fn().mockImplementation(async ({ where }: any) =>
          LEG_METHODS.find((row) => row.id === where?.id) ?? LEG_METHODS[0],
        ),
        findMany: jest.fn().mockImplementation(async ({ where }: any) => {
          const ids: number[] = where?.id?.in ?? [];
          return LEG_METHODS.filter((row) => ids.includes(row.id));
        }),
      },
      payments: {
        create: jest.fn().mockImplementation(async ({ data }: any) => {
          const row = { id: ++paySeq, ...data };
          createdPayments.push(row);
          return row;
        }),
        update: jest.fn().mockResolvedValue({}),
        // Guardia de la confirmación en sitio (`id` + `state: 'pending'`) y
        // anulación de marcadores (`id: { in }`).
        updateMany: jest.fn().mockImplementation(async ({ where, data }: any) => {
          if (typeof where?.id === 'number') {
            const marker = orderPayments.find((row) => row.id === where.id);
            if (!marker || marker.state !== where.state) return { count: 0 };
            confirmedInPlace.push({ ...marker, ...data, id: marker.id });
          }
          return { count: 1 };
        }),
        findFirst: jest.fn().mockImplementation(async ({ where }: any) =>
          confirmedInPlace.find((row) => row.id === where?.id) ?? null,
        ),
        // `resolvePaymentReceivedSaleFields`: tramos ya creados del mismo cobro.
        findMany: jest.fn().mockImplementation(async ({ where }: any) =>
          [...confirmedInPlace, ...createdPayments]
            .filter((row) => row.id !== where?.id?.not)
            .map((row) => ({ amount: row.amount })),
        ),
      },
      orders: {
        findUnique: jest.fn().mockResolvedValue({
          subtotal_amount: GRAND,
          discount_amount: 0,
          tax_amount: 0,
          shipping_cost: 0,
          shipping_tax_amount: 0,
          tip_amount: 0,
          grand_total: GRAND,
          order_items: [],
        }),
        findFirst: jest.fn().mockImplementation(async (args: any) => {
          if (args?.select?.state) return { state: preClaimState };
          return {
            id: 1,
            state: preClaimState,
            active_financial_split_id: null,
            delivery_type: deliveryType,
            shipping_method_id: 7,
            order_items: [{ products: { product_type: 'product' } }],
            coupon_id: null,
          };
        }),
        update: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 1, ...data })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      store_settings: {
        findFirst: jest.fn().mockResolvedValue({
          settings: { pos: { allow_anonymous_sales: true } },
        }),
      },
      coupon_uses: { findFirst: jest.fn().mockResolvedValue(null) },
      coupons: { findFirst: jest.fn().mockResolvedValue(null) },
      order_items: { findMany: jest.fn().mockResolvedValue([]) },
    };
    prismaMock.$transaction = jest.fn(async (callback: any) => callback(prismaMock));

    const emitter = { emit: jest.fn(), emitAsync: jest.fn().mockResolvedValue([]) };
    const service = new OrderFlowService(
      prismaMock as unknown as StorePrismaService,
      emitter as any,
      {} as any,
      { assertSessionForSales: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { logCustom: jest.fn().mockResolvedValue(undefined) } as any,
    );

    jest.spyOn(service as any, 'getOrder').mockResolvedValue({
      id: 1,
      state: 'processing',
      order_number: 'ORD-1',
      delivery_type: deliveryType,
      grand_total: GRAND,
      subtotal_amount: GRAND,
      tax_amount: 0,
      currency: 'COP',
      store_id: 4,
      customer_id: 44,
      stores: { organization_id: 1 },
      payments: orderPayments,
    });
    jest
      .spyOn(service as any, 'generateTransactionId')
      .mockImplementation(async () => `TXN-${++txnSeq}`);
    jest.spyOn(service as any, 'hasPendingKitchenItems').mockResolvedValue(false);
    jest.spyOn(service as any, 'validateTransition').mockReturnValue(undefined);
    const commitCoupon = jest
      .spyOn(service as any, 'commitCouponUseForOrder')
      .mockResolvedValue(undefined);
    const cashMovement = jest
      .spyOn(service as any, 'recordPayOrderCashMovement')
      .mockResolvedValue(undefined);
    jest.spyOn(service as any, 'computeAndPersistEta').mockResolvedValue(undefined);
    const emitPosSale = jest
      .spyOn(service as any, 'emitPosSaleCompletedIfFullyPaid')
      .mockResolvedValue(undefined);
    const project = jest
      .spyOn(service as any, 'projectPaidOrderToTable')
      .mockResolvedValue(undefined);
    const updateOrderState = jest
      .spyOn(service as any, 'updateOrderState')
      .mockImplementation(async (_id: number, next: string, metadata: unknown = {}) => {
        stateUpdates.push({ state: next, metadata });
        return { id: 1, state: next };
      });

    return {
      service,
      prismaMock,
      emitter,
      stateUpdates,
      cashMovement,
      project,
      emitPosSale,
      updateOrderState,
      commitCoupon,
      createdPayments,
      confirmedInPlace,
    };
  };

  // Confirmación en sitio: el primer tramo confirma la MISMA fila pending.
  const expectConfirmedInPlace = (h: any, data: Record<string, unknown>) => {
    expect(h.prismaMock.payments.updateMany).toHaveBeenCalledWith({
      where: { id: 51, state: 'pending' },
      data: expect.objectContaining({ state: 'succeeded', ...data }),
    });
  };
  const expectNoVoidOf51 = (h: any) => {
    const voided = h.prismaMock.payments.updateMany.mock.calls.filter(
      ([args]: any[]) => args?.data?.state === 'cancelled',
    );
    expect(voided).toHaveLength(0);
  };

  it('transferencia pendiente + mismo método → confirma la fila 51 en sitio (cuenta, comprobante, sin crear ni anular)', async () => {
    const h = buildHarness();

    const result: any = await h.service.payOrder(1, {
      store_payment_method_id: TRANSFER_ID,
      payment_type: PaymentType.DIRECT,
      amount: GRAND,
      payment_reference: 'REF-99',
    });

    expect(h.prismaMock.payments.create).not.toHaveBeenCalled();
    expectConfirmedInPlace(h, {
      store_payment_method_id: TRANSFER_ID,
      amount: GRAND,
      bank_account_id: 7,
      transaction_id: 'TXN-ONLINE-51',
      gateway_reference: 'REF-99',
      gateway_response: expect.objectContaining({
        payment_type: 'direct',
        change: 0,
        metadata: expect.objectContaining({
          payment_origin: 'manual_confirmation',
          confirmed_in_place: true,
          original_pending_payment_ids: [51],
          original_store_payment_method_id: TRANSFER_ID,
          receipt_s3_key: 'receipts/51.png',
          receipt_uploaded_at: RECEIPT_AT,
          bank_account_id: 7,
        }),
      }),
    });
    // El comprobante vive en las columnas de la fila: no se tocan.
    const data = h.prismaMock.payments.updateMany.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('receipt_s3_key');
    expect(data).not.toHaveProperty('receipt_uploaded_at');
    expectNoVoidOf51(h);
    expect(h.updateOrderState).toHaveBeenCalledWith(
      1,
      'processing',
      expect.objectContaining({ total_paid: GRAND, remaining_balance: 0 }),
      expect.anything(),
    );
    expect(h.cashMovement).toHaveBeenCalledTimes(1);
    expect(h.cashMovement).toHaveBeenCalledWith(4, 1, GRAND, 'bank_transfer', 51);
    expect(h.emitter.emitAsync).toHaveBeenCalledTimes(1);
    expect(h.emitter.emitAsync).toHaveBeenCalledWith(
      'payment.received',
      expect.objectContaining({ payment_id: 51 }),
    );
    expect(result.payment).toEqual({ transaction_id: 'TXN-ONLINE-51', change: 0 });
  });

  it('manual pendiente + cajero cambia a efectivo → la misma fila 51 cambia de método (sin la cuenta online), una sola fila', async () => {
    const h = buildHarness();

    const result: any = await h.service.payOrder(1, {
      store_payment_method_id: CASH_ID,
      payment_type: PaymentType.DIRECT,
      amount: GRAND,
    });

    expect(h.prismaMock.payments.create).not.toHaveBeenCalled();
    expectConfirmedInPlace(h, {
      store_payment_method_id: CASH_ID,
      amount: GRAND,
      bank_account_id: null,
    });
    expectNoVoidOf51(h);
    expect(h.cashMovement).toHaveBeenCalledWith(4, 1, GRAND, 'cash', 51);
    expect(h.emitter.emitAsync).toHaveBeenCalledWith(
      'payment.received',
      expect.objectContaining({ payment_id: 51 }),
    );
    expect(result.payment).toEqual({ transaction_id: 'TXN-ONLINE-51', change: 0 });
  });

  it('manual pendiente sin amount → confirma en sitio por el saldo', async () => {
    const h = buildHarness();

    await h.service.payOrder(1, {
      store_payment_method_id: TRANSFER_ID,
      payment_type: PaymentType.DIRECT,
    });

    expect(h.prismaMock.payments.create).not.toHaveBeenCalled();
    expectConfirmedInPlace(h, { amount: GRAND });
    expectNoVoidOf51(h);
    expect(h.updateOrderState).toHaveBeenCalledWith(
      1,
      'processing',
      expect.objectContaining({ total_paid: GRAND, remaining_balance: 0 }),
      expect.anything(),
    );
  });

  it('parcial → la fila 51 queda succeeded por el parcial, la orden permanece pending_payment con saldo', async () => {
    const h = buildHarness();

    const result: any = await h.service.payOrder(1, {
      store_payment_method_id: TRANSFER_ID,
      payment_type: PaymentType.DIRECT,
      amount: 60000,
    });

    expect(h.prismaMock.payments.create).not.toHaveBeenCalled();
    expectConfirmedInPlace(h, { amount: 60000 });
    expectNoVoidOf51(h);
    // Saldos por columna directa, SIN transición de estado.
    expect(h.prismaMock.orders.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({ total_paid: 60000, remaining_balance: 40000 }),
    });
    expect(h.updateOrderState).not.toHaveBeenCalled();
    // El claim `processing` vuelve a `pending_payment`.
    expect(h.prismaMock.orders.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ state: 'processing' }),
        data: expect.objectContaining({ state: 'pending_payment' }),
      }),
    );
    expect(h.cashMovement).toHaveBeenCalledWith(4, 1, 60000, 'bank_transfer', 51);
    expect(h.emitter.emitAsync).toHaveBeenCalledWith(
      'payment.received',
      expect.objectContaining({ payment_id: 51 }),
    );
    expect(h.emitPosSale).not.toHaveBeenCalled();
    expect(h.project).not.toHaveBeenCalled();
    expect(h.commitCoupon).not.toHaveBeenCalled();
    expect(result.payment).toEqual({ transaction_id: 'TXN-ONLINE-51', change: 0 });
  });

  it('multitramo → el primer tramo confirma la fila 51, el segundo se crea', async () => {
    const h = buildHarness();

    const result: any = await h.service.payOrder(1, {
      store_payment_method_id: TRANSFER_ID,
      payment_type: PaymentType.DIRECT,
      amount: 60000,
      payments: [
        { store_payment_method_id: TRANSFER_ID, amount: 40000, payment_reference: 'TRX-P' },
        { store_payment_method_id: CASH_ID, amount: 20000, amount_received: 25000 },
      ],
    });

    expectConfirmedInPlace(h, {
      store_payment_method_id: TRANSFER_ID,
      amount: 40000,
      gateway_reference: 'TRX-P',
    });
    expectNoVoidOf51(h);
    expect(h.prismaMock.payments.create).toHaveBeenCalledTimes(1);
    expect(h.prismaMock.payments.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          store_payment_method_id: CASH_ID,
          amount: 20000,
          state: 'succeeded',
        }),
      }),
    );
    expect(result.payment).toEqual({ transaction_id: 'TXN-ONLINE-51', change: 5000 });
    expect(result.payments).toHaveLength(2);
    expect(result.payments[0]).toEqual(expect.objectContaining({ id: 51 }));
    expect(h.cashMovement).toHaveBeenCalledTimes(2);
    expect(h.cashMovement).toHaveBeenNthCalledWith(1, 4, 1, 40000, 'bank_transfer', 51);
    expect(h.cashMovement).toHaveBeenNthCalledWith(2, 4, 1, 20000, 'cash', 101);
    const received = h.emitter.emitAsync.mock.calls
      .filter(([name]: any[]) => name === 'payment.received')
      .map(([, payload]: any[]) => payload.payment_id);
    expect(received).toEqual([51, 101]);
    expect(h.prismaMock.orders.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({ total_paid: 60000, remaining_balance: 40000 }),
    });
    expect(h.updateOrderState).not.toHaveBeenCalled();
  });

  it('fila manual ya no pending (carrera) → rechaza sin crear pagos', async () => {
    const h = buildHarness();
    h.prismaMock.payments.updateMany.mockImplementation(async () => ({ count: 0 }));

    const error: any = await h.service
      .payOrder(1, {
        store_payment_method_id: TRANSFER_ID,
        payment_type: PaymentType.DIRECT,
        amount: GRAND,
      })
      .catch((failure: any) => failure);

    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.getResponse()).toMatchObject({
      details: { stage: 'manual_payment_not_pending', payment_id: 51 },
    });
    expect(h.prismaMock.payments.create).not.toHaveBeenCalled();
    expect(h.cashMovement).not.toHaveBeenCalled();
    expect(h.emitter.emitAsync).not.toHaveBeenCalled();
  });

  it('contra entrega pendiente → conserva anular + crear (no confirma en sitio)', async () => {
    const h = buildHarness({
      payments: [
        {
          id: 53,
          state: 'pending',
          amount: GRAND,
          store_payment_method_id: 9,
          transaction_id: 'TXN-COD-53',
          store_payment_method: {
            system_payment_method: { type: 'cash', processing_mode: 'ON_DELIVERY' },
          },
        },
      ],
    });

    await h.service.payOrder(1, {
      store_payment_method_id: CASH_ID,
      payment_type: PaymentType.DIRECT,
    });

    expect(h.prismaMock.payments.create).toHaveBeenCalledTimes(1);
    expect(h.prismaMock.payments.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: 'succeeded',
          gateway_response: expect.objectContaining({
            metadata: expect.objectContaining({
              payment_origin: 'cash_on_delivery',
              original_pending_payment_ids: [53],
            }),
          }),
        }),
      }),
    );
    expect(h.prismaMock.payments.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [53] }, state: 'pending' },
      data: expect.objectContaining({ state: 'cancelled' }),
    });
    expect(h.prismaMock.payments.findFirst).not.toHaveBeenCalled();
    expect(h.cashMovement).toHaveBeenCalledWith(4, 1, GRAND, 'cash', 101);
  });

  it('WhatsApp/contra entrega en pending_payment con remaining_balance > 0 → el parcial se respeta', async () => {
    const h = buildHarness({ payments: [] });
    (h.service as any).getOrder.mockResolvedValue({
      id: 1,
      state: 'processing',
      order_number: 'ORD-1',
      delivery_type: 'home_delivery',
      grand_total: GRAND,
      subtotal_amount: GRAND,
      tax_amount: 0,
      remaining_balance: GRAND,
      currency: 'COP',
      store_id: 4,
      customer_id: 44,
      stores: { organization_id: 1 },
      payments: [],
    });

    await h.service.payOrder(1, {
      store_payment_method_id: CASH_ID,
      payment_type: PaymentType.DIRECT,
      amount: 30000,
    });

    expect(h.prismaMock.payments.create).toHaveBeenCalledTimes(1);
    expect(h.prismaMock.payments.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ amount: 30000, state: 'succeeded' }),
      }),
    );
    expect(h.prismaMock.orders.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({ total_paid: 30000, remaining_balance: 70000 }),
    });
    expect(h.updateOrderState).not.toHaveBeenCalled();
    expect(h.cashMovement).toHaveBeenCalledWith(4, 1, 30000, 'cash', 101);
  });

  it('finish bloqueado tras confirmar en sitio → la fila 51 vuelve a pending intacta (no se anula)', async () => {
    const h = buildHarness({ deliveryType: 'direct_delivery' });
    h.updateOrderState.mockImplementation(async () => {
      throw new VendixHttpException(ErrorCodes.INV_STOCK_002);
    });

    const error: any = await h.service
      .payOrder(1, {
        store_payment_method_id: TRANSFER_ID,
        payment_type: PaymentType.DIRECT,
        amount: GRAND,
      })
      .catch((failure: any) => failure);

    expect(error).toBeInstanceOf(VendixHttpException);
    expect(h.prismaMock.payments.update).toHaveBeenCalledTimes(1);
    expect(h.prismaMock.payments.update).toHaveBeenCalledWith({
      where: { id: 51 },
      data: expect.objectContaining({
        state: 'pending',
        store_payment_method_id: TRANSFER_ID,
        bank_account_id: 7,
        amount: GRAND,
        transaction_id: 'TXN-ONLINE-51',
        gateway_response: { payment_type: 'online' },
      }),
    });
    expect(h.cashMovement).not.toHaveBeenCalled();
    expect(h.emitter.emitAsync).not.toHaveBeenCalled();
  });

  it('segundo parcial (marcador ya anulado) → sigue siendo carril por pending_payment + abonos', async () => {
    const h = buildHarness({
      payments: [
        {
          id: 60,
          state: 'succeeded',
          amount: 60000,
          store_payment_method: {
            system_payment_method: { type: 'cash', processing_mode: 'DIRECT' },
          },
        },
      ],
    });

    await h.service.payOrder(1, {
      store_payment_method_id: CASH_ID,
      payment_type: PaymentType.DIRECT,
      amount: 20000,
    });

    expect(h.prismaMock.payments.create).toHaveBeenCalledTimes(1);
    expect(h.prismaMock.orders.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({ total_paid: 80000, remaining_balance: 20000 }),
    });
    expect(h.updateOrderState).not.toHaveBeenCalled();
    // Sin marcadores pendientes no hay nada que anular.
    expect(h.prismaMock.payments.updateMany).not.toHaveBeenCalled();
  });

  it('efectivo de más → change correcto y movimiento neto de vuelto', async () => {
    const h = buildHarness();

    const result: any = await h.service.payOrder(1, {
      store_payment_method_id: CASH_ID,
      payment_type: PaymentType.DIRECT,
      amount: GRAND,
      amount_received: 120000,
    });

    expect(result.payment).toEqual({ transaction_id: 'TXN-ONLINE-51', change: 20000 });
    expect(h.prismaMock.payments.create).not.toHaveBeenCalled();
    expect(h.prismaMock.payments.updateMany).toHaveBeenCalledWith({
      where: { id: 51, state: 'pending' },
      data: expect.objectContaining({
        amount: GRAND,
        gateway_response: expect.objectContaining({
          change: 20000,
          metadata: expect.objectContaining({ amount_received: 120000 }),
        }),
      }),
    });
    // En caja entra lo cobrado (100000), no lo recibido (120000).
    expect(h.cashMovement).toHaveBeenCalledWith(4, 1, GRAND, 'cash', 51);
    expect(h.updateOrderState).toHaveBeenCalledWith(
      1,
      'processing',
      expect.objectContaining({ total_paid: GRAND, remaining_balance: 0 }),
      expect.anything(),
    );
  });

  it('wompi pendiente → sigue digital_payment_pending (el carril manual no lo toca)', async () => {
    const h = buildHarness({
      payments: [
        {
          id: 52,
          state: 'pending',
          amount: GRAND,
          store_payment_method: {
            system_payment_method: { type: 'wompi', processing_mode: 'ONLINE' },
          },
        },
      ],
    });

    const error: any = await h.service
      .payOrder(1, {
        store_payment_method_id: CASH_ID,
        payment_type: PaymentType.DIRECT,
      })
      .catch((failure: any) => failure);

    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.errorCode).toBe('ORD_FLOW_PAYMENT_FAILED_001');
    expect(error.getResponse()).toMatchObject({
      details: { stage: 'digital_payment_pending', order_id: 1, payment_id: 52 },
    });
    expect(h.prismaMock.payments.create).not.toHaveBeenCalled();
    expect(h.prismaMock.payments.updateMany).not.toHaveBeenCalled();
  });

  it('amount mayor al saldo → PAY_INVALID_AMOUNT_001 sin crear pagos', async () => {
    const h = buildHarness();

    const error: any = await h.service
      .payOrder(1, {
        store_payment_method_id: TRANSFER_ID,
        payment_type: PaymentType.DIRECT,
        amount: 120000,
      })
      .catch((failure: any) => failure);

    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.errorCode).toBe('PAY_INVALID_AMOUNT_001');
    expect(error.getStatus()).toBe(400);
    expect(h.prismaMock.payments.create).not.toHaveBeenCalled();
    expect(h.prismaMock.payments.updateMany).not.toHaveBeenCalled();
  });

  it('parcial fuera de pending_payment → PAY_PARTIAL_NOT_ALLOWED_001', async () => {
    const h = buildHarness({ preClaimState: 'shipped' });

    const error: any = await h.service
      .payOrder(1, {
        store_payment_method_id: CASH_ID,
        payment_type: PaymentType.DIRECT,
        amount: 60000,
      })
      .catch((failure: any) => failure);

    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.errorCode).toBe('PAY_PARTIAL_NOT_ALLOWED_001');
    expect(error.getStatus()).toBe(400);
    expect(h.prismaMock.payments.create).not.toHaveBeenCalled();
    expect(h.updateOrderState).not.toHaveBeenCalled();
  });
});

describe('OrderFlowService.confirmPayment — rechaza al personal sobre pago manual (Fase 2 paso 6)', () => {
  const ORDER_ID = 9001;
  let service: OrderFlowService;
  let prismaMock: PrismaMock;
  let emitter: { emit: jest.Mock; emitAsync: jest.Mock };

  // Harness espejo del bloque B8: `getOrder` mockeado, claim y escrituras de
  // balance resueltas; solo cambia el método del pago pendiente (manual).
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequestContext({ store_id: 100, organization_id: 1, user_id: 7 });

    prismaMock = createPrismaMock({
      orders: ['update', 'updateMany', 'findFirst', 'findUnique'],
      payments: ['update', 'updateMany', 'findMany'],
      store_payment_methods: ['findFirst'],
      order_items: ['findMany'],
    });
    prismaMock.$queryRaw = jest.fn().mockResolvedValue([{ id: ORDER_ID, state: 'pending_payment' }]);
    prismaMock.orders.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.orders.update.mockResolvedValue({ id: ORDER_ID, state: 'processing' });
    prismaMock.orders.findFirst.mockResolvedValue({ id: ORDER_ID, state: 'processing', payments: [] });
    prismaMock.order_items.findMany.mockResolvedValue([]);
    prismaMock.orders.findUnique.mockResolvedValue({
      subtotal_amount: 50,
      discount_amount: 0,
      tax_amount: 9.5,
      shipping_cost: 0,
      shipping_tax_amount: 0,
      tip_amount: 0,
      grand_total: 59.5,
      shipping_tax_type: null,
      shipping_tax_rate: null,
      order_items: [],
    });
    prismaMock.payments.findMany.mockResolvedValue([]);
    prismaMock.store_payment_methods.findFirst.mockResolvedValue({
      display_name: 'Transferencia',
      system_payment_method: { display_name: 'Transferencia' },
    });
    prismaMock.payments.update.mockResolvedValue({});
    prismaMock.payments.updateMany.mockResolvedValue({ count: 1 });

    emitter = { emit: jest.fn(), emitAsync: jest.fn().mockResolvedValue([]) };

    service = new OrderFlowService(
      prismaMock as unknown as StorePrismaService,
      emitter as any,
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
      { log: jest.fn().mockResolvedValue(undefined), logCustom: jest.fn().mockResolvedValue(undefined) } as any,
      undefined, undefined, undefined, undefined,
    );
    jest.spyOn(service as any, 'commitCouponUseForOrder').mockResolvedValue(undefined);
  });

  const manualPendingOrder = () => {
    const grandTotal = new Prisma.Decimal('59.50');
    return buildOrder({
      id: ORDER_ID,
      state: 'pending_payment',
      grand_total: grandTotal,
      total_paid: new Prisma.Decimal('0'),
      remaining_balance: grandTotal,
      payments: [{
        ...buildPayment({ id: 5010, state: 'pending', amount: grandTotal }),
        store_payment_method: { system_payment_method: { type: 'bank_transfer', processing_mode: 'ONLINE' } },
      }],
    });
  };

  it('personal + pago manual pendiente → 409 ORD_MANUAL_PAYMENT_REQUIRES_REGISTER_001, sin voltear el pago', async () => {
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(manualPendingOrder());

    const error: any = await service.confirmPayment(ORDER_ID).catch((failure: any) => failure);

    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.errorCode).toBe('ORD_MANUAL_PAYMENT_REQUIRES_REGISTER_001');
    expect(error.getStatus()).toBe(409);
    expect(prismaMock.payments.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.orders.updateMany).not.toHaveBeenCalled();
  });

  it('webhook (source: "webhook") + pago manual pendiente → confirma sin cambios', async () => {
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(manualPendingOrder());

    const result: any = await service.confirmPayment(ORDER_ID, { source: 'webhook' });

    expect(result.payment_confirmation_applied).toBe(true);
    const flip = prismaMock.payments.updateMany.mock.calls.find(
      (call: any[]) => call[0]?.data?.state === 'succeeded',
    );
    expect(flip).toBeDefined();
    expect(flip[0].where).toMatchObject({ id: 5010, state: 'pending' });
  });

  // Incidente orden 9117: pending_payment, 0 pagos, "Confirmar Pago" la movía a
  // processing sin asentar dinero.
  const unpaidOrder = (overrides: Record<string, unknown> = {}) => {
    const grandTotal = new Prisma.Decimal('66000');
    return buildOrder({
      id: ORDER_ID,
      state: 'pending_payment',
      grand_total: grandTotal,
      total_paid: new Prisma.Decimal('0'),
      remaining_balance: grandTotal,
      payments: [],
      ...overrides,
    });
  };

  it('personal + sin pago pending y saldo abierto → 409 ORD_CONFIRM_PAYMENT_NO_PAYMENT_001, sin escribir', async () => {
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(unpaidOrder());

    const error: any = await service.confirmPayment(ORDER_ID).catch((failure: any) => failure);

    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.errorCode).toBe('ORD_CONFIRM_PAYMENT_NO_PAYMENT_001');
    expect(error.getStatus()).toBe(409);
    expect(prismaMock.payments.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.orders.updateMany).not.toHaveBeenCalled();
  });

  it('personal + pago succeeded parcial y sin pending → mismo 409', async () => {
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(unpaidOrder({
      payments: [buildPayment({ id: 5011, state: 'succeeded', amount: new Prisma.Decimal('1000') })],
    }));

    const error: any = await service.confirmPayment(ORDER_ID).catch((failure: any) => failure);

    expect(error.errorCode).toBe('ORD_CONFIRM_PAYMENT_NO_PAYMENT_001');
    expect(prismaMock.orders.updateMany).not.toHaveBeenCalled();
  });

  it('personal + orden ya saldada (succeeded = total) → confirma y pasa a processing', async () => {
    const paid = unpaidOrder({
      payments: [buildPayment({ id: 5012, state: 'succeeded', amount: new Prisma.Decimal('66000') })],
    });
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(paid);

    const result: any = await service.confirmPayment(ORDER_ID);

    expect(result.payment_confirmation_applied).toBe(true);
    const claim = prismaMock.orders.updateMany.mock.calls.find(
      (call: any[]) => call[0]?.data?.state === 'processing',
    );
    expect(claim).toBeDefined();
  });

  it('personal + venta a crédito (payment_form 2) sin pagos → no se bloquea', async () => {
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(unpaidOrder({ payment_form: '2' }));

    const result: any = await service.confirmPayment(ORDER_ID);

    expect(result.payment_confirmation_applied).toBe(true);
  });

  it('webhook + sin pago pending → no aplica la puerta de pago', async () => {
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(unpaidOrder());

    const result: any = await service.confirmPayment(ORDER_ID, { source: 'webhook' });

    expect(result.payment_confirmation_applied).toBe(true);
  });
});

/**
 * Guard único de saldo (docs/plans/cierre-caja-impuestos-cod-plan.md paso 4):
 * `updateOrderState('finished')` rechaza con ORD_FINISH_UNPAID_BALANCE_001
 * cuando queda saldo por cobrar (salvo crédito, `payment_form === '2'`).
 */
describe('OrderFlowService — ORD_FINISH_UNPAID_BALANCE_001 (guard único de saldo)', () => {
  const CODE = 'ORD_FINISH_UNPAID_BALANCE_001';

  const codPending = {
    state: 'delivered',
    store_id: 4,
    order_number: 'ORD-1',
    grand_total: 100,
    remaining_balance: 100,
    payment_form: '1',
    payments: [{ state: 'pending', amount: 100 }],
    stores: { organization_id: 1 },
  };

  const build = (previous: any, orderOverrides: any = {}) => {
    const emit = jest.fn();
    const prisma: any = {
      orders: {
        findUnique: jest.fn().mockResolvedValue(previous),
        findMany: jest.fn(),
      },
    };
    prisma.$transaction = jest.fn().mockResolvedValue({
      updated_order: { id: 1, store_id: 4, stores: { organization_id: 1 }, ...orderOverrides },
      commit: { totalCost: 0 },
    });
    const service = new OrderFlowService(
      prisma, { emit } as any, {} as any, {} as any, {} as any,
      {} as any, {} as any, {} as any, {} as any,
    );
    jest.spyOn(service as any, 'findLineAwaitingKitchenDelivery').mockResolvedValue(null);
    return { service, prisma };
  };

  it('(a) forceOrderState/PATCH a finished con COD pendiente → ORD_FINISH_UNPAID_BALANCE_001', async () => {
    const { service, prisma } = build(codPending);
    await expect(
      (service as any).updateOrderState(1, 'finished', {}, { source: 'forced' }),
    ).rejects.toMatchObject({
      errorCode: CODE,
      response: expect.objectContaining({
        details: { order_id: 1, remaining_balance: 100 },
      }),
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('(a2) legacy: remaining_balance 0 por default y pago pending → usa grand_total', async () => {
    const { service } = build({ ...codPending, remaining_balance: 0 });
    await expect((service as any).updateOrderState(1, 'finished', {})).rejects.toMatchObject({
      errorCode: CODE,
    });
  });

  it('(a3) sin ningún pago → bloquea', async () => {
    const { service } = build({ ...codPending, payments: [], remaining_balance: 0 });
    await expect((service as any).updateOrderState(1, 'finished', {})).rejects.toMatchObject({
      errorCode: CODE,
    });
  });

  it('(b) confirmDelivery con saldo → mismo error (propaga desde updateOrderState)', async () => {
    const { service } = build(codPending);
    jest.spyOn(service as any, 'getOrder').mockResolvedValue({ id: 1, state: 'delivered' });
    jest.spyOn(service as any, 'hasPendingKitchenItems').mockResolvedValue(false);
    (service as any).prisma.kitchen_ticket_items = { findMany: jest.fn().mockResolvedValue([]) };
    (service as any).prisma.order_items = { findMany: jest.fn().mockResolvedValue([]) };
    await expect(service.confirmDelivery(1)).rejects.toMatchObject({ errorCode: CODE });
  });

  it('(c) venta a crédito con saldo → finaliza', async () => {
    const { service, prisma } = build({ ...codPending, payment_form: '2', payments: [] });
    await expect((service as any).updateOrderState(1, 'finished', {})).resolves.toBeDefined();
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('(d) orden pagada → finaliza', async () => {
    const { service, prisma } = build({
      ...codPending,
      remaining_balance: 0,
      payments: [{ state: 'succeeded', amount: 100 }],
    });
    await expect((service as any).updateOrderState(1, 'finished', {})).resolves.toBeDefined();
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('(d2) orden con total 0 (cupón 100 %) → finaliza', async () => {
    const { service } = build({ ...codPending, grand_total: 0, remaining_balance: 0, payments: [] });
    await expect((service as any).updateOrderState(1, 'finished', {})).resolves.toBeDefined();
  });

  it('(f) payOrder rama finished/COD: saldo liquidado en la MISMA escritura (metadata) → no dispara el guard', async () => {
    const { service, prisma } = build(codPending);
    // Mismo payload que `settledBalanceMetadata` de payOrder.
    await expect(
      (service as any).updateOrderState(
        1,
        'finished',
        { paid_at: new Date(), finished_at: new Date(), total_paid: 100, remaining_balance: 0 },
        { historyFromState: 'finished' },
      ),
    ).resolves.toBeDefined();
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('(g) venta POS directa (pago succeeded creado antes + metadata saldo 0) paga y finaliza', async () => {
    const { service, prisma } = build({
      ...codPending,
      state: 'processing',
      remaining_balance: 0,
      payments: [{ state: 'succeeded', amount: 100 }],
    });
    await expect(
      (service as any).updateOrderState(1, 'finished', {
        paid_at: new Date(),
        finished_at: new Date(),
        total_paid: 100,
        remaining_balance: 0,
      }),
    ).resolves.toBeDefined();
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  describe('(e) autoFinishDeliveredOrders', () => {
    it('omite la orden con saldo sin lanzar y finaliza la pagada', async () => {
      const { service, prisma } = build(codPending);
      prisma.orders.findMany = jest
        .fn()
        .mockResolvedValueOnce([{ id: 1 }, { id: 2 }]) // pase 1
        .mockResolvedValueOnce([]) // pase 2
        .mockResolvedValueOnce([
          { id: 1, grand_total: 100, remaining_balance: 100, payment_form: '1', payments: [{ state: 'pending', amount: 100 }] },
          { id: 2, grand_total: 50, remaining_balance: 0, payment_form: '1', payments: [{ state: 'succeeded', amount: 50 }] },
        ]);
      jest.spyOn(service as any, 'hasPendingKitchenItems').mockResolvedValue(false);
      const update = jest.spyOn(service as any, 'updateOrderState').mockResolvedValue({});
      await expect(service.autoFinishDeliveredOrders()).resolves.toBe(1);
      expect(update).toHaveBeenCalledTimes(1);
      expect(update).toHaveBeenCalledWith(2, 'finished', expect.anything(), { source: 'job' });
    });
  });
});

describe('getAvailableActions / canConfirmDelivery — saldo pendiente', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { canConfirmDelivery, getUnpaidBalanceForFinish } = require('./order-action-policy.util');

  it('COD delivered con saldo → confirm_delivery deshabilitado con el código', () => {
    const snap = {
      state: 'delivered',
      grand_total: 100,
      remaining_balance: 100,
      payment_form: '1',
      payments: [{ state: 'pending', amount: 100 }],
    };
    expect(canConfirmDelivery(snap)).toEqual({
      enabled: false,
      reason: 'ORD_FINISH_UNPAID_BALANCE_001',
    });
  });

  it('crédito y pagada siguen habilitadas; snapshot sin grand_total es permisivo', () => {
    expect(
      canConfirmDelivery({ state: 'delivered', grand_total: 100, remaining_balance: 100, payment_form: '2', payments: [] }),
    ).toEqual({ enabled: true });
    expect(
      canConfirmDelivery({
        state: 'delivered', grand_total: 100, remaining_balance: 0,
        payments: [{ state: 'succeeded', amount: 100 }],
      }),
    ).toEqual({ enabled: true });
    expect(canConfirmDelivery({ state: 'delivered' })).toEqual({ enabled: true });
  });

  it('el saldo resultante (override) manda sobre el previo', () => {
    const order = { grand_total: 100, remaining_balance: 100, payment_form: '1', payments: [] as any[] };
    expect(getUnpaidBalanceForFinish(order)).toBe(100);
    expect(getUnpaidBalanceForFinish(order, 0)).toBe(0);
  });
});
