import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { RefundFlowService } from './refund-flow.service';
import { RefundCalculationService } from './refund-calculation.service';
import { RefundCoverageService } from './refund-coverage.service';
import { StorePrismaService } from 'src/prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { StockLevelManager } from '../../../inventory/shared/services/stock-level-manager.service';
import { SettingsService } from '../../../settings/settings.service';
import { SessionsService } from '../../../cash-registers/sessions/sessions.service';
import { MovementsService } from '../../../cash-registers/movements/movements.service';
import { SerialNumberEnforcementService } from '../../../inventory/serial-numbers/serial-number-enforcement.service';
import { InventorySerialNumbersService } from '../../../inventory/serial-numbers/inventory-serial-numbers.service';
import { WalletService } from '../../../wallet/wallet.service';
import { WalletBalanceService } from '../../../wallet/services/wallet-balance.service';
import { PaymentGatewayService } from '../../../payments/services/payment-gateway.service';
import { ManualRefundDeliveryService } from '../../../accounting/auto-entries/manual-refund-delivery.service';
import {
  getCompletedRefundAmount,
  getSettledOrderAmount,
  isOrderFullyPaid,
} from '../../../payments/services/payment-validator.service';

/**
 * B18 / B25 — atribución del movimiento de caja de un reembolso.
 *  - Sin usuario (job/integración) el movimiento se encola con el actor del sale.
 *  - Un reembolso multi-pago deja un movimiento por pago en efectivo, y si el
 *    monto no cabe en los pagos aborta antes del commit (REFUND_ALLOCATION_MISMATCH).
 */
describe('RefundFlowService — caja del reembolso (B18, B25)', () => {
  let service: RefundFlowService;
  let eventEmitter: { emit: jest.Mock };
  let mockPrisma: any;
  let mockCalculationService: any;
  let mockCoverageService: { recomputeLineCache: jest.Mock };
  let mockGateway: { reversePaymentWithProcessor: jest.Mock };
  let movements: {
    recordRefundCashMovementDurable: jest.Mock;
    recordNonCashRefundMovement: jest.Mock;
    resolveSaleActorId: jest.Mock;
  };

  const baseCalculation = {
    items: [],
    subtotal_refund: 1000,
    tax_refund: 0,
    shipping_refund: 0,
    shipping_tax_refund: 0,
    shipping_tax_type: null,
    total_refund: 1000,
    is_full_refund: false,
    already_refunded: 0,
    max_refundable: 9000,
  };

  const baseOrder = (over: any = {}) => ({
    id: 1,
    store_id: 10,
    state: 'finished',
    order_number: 'O-1',
    payments: [{ id: 100, state: 'succeeded' }],
    stores: { id: 10, organization_id: 1 },
    order_items: [],
    ...over,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    eventEmitter = { emit: jest.fn() };
    mockCalculationService = {
      calculate: jest.fn().mockResolvedValue({ ...baseCalculation }),
      preview: jest.fn(),
      calculateCancellationCashRefund: jest.fn(),
    };
    mockCoverageService = {
      recomputeLineCache: jest.fn().mockResolvedValue(undefined),
    };
    mockGateway = { reversePaymentWithProcessor: jest.fn() };
    movements = {
      recordRefundCashMovementDurable: jest.fn().mockResolvedValue({ status: 'recorded', movement_id: 9 }),
      recordNonCashRefundMovement: jest.fn().mockResolvedValue({ status: 'recorded', movement_id: 10 }),
      resolveSaleActorId: jest.fn().mockResolvedValue(null),
    };
    mockPrisma = {
      orders: { findFirst: jest.fn(), update: jest.fn() },
      stores: {
        findUnique: jest.fn().mockResolvedValue({ default_location_id: 5, organization_id: 1 }),
      },
      inventory_locations: { findFirst: jest.fn().mockResolvedValue({ id: 5 }) },
      refunds: {
        create: jest.fn().mockResolvedValue({ id: 999, state: 'processing' }),
        update: jest.fn().mockResolvedValue({ id: 999, state: 'completed', refund_items: [] }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      accounting_entry_failures: { create: jest.fn().mockResolvedValue({ id: 77 }) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      refund_items: { create: jest.fn().mockResolvedValue({ id: 1 }), findMany: jest.fn().mockResolvedValue([]) },
      order_items: { findMany: jest.fn().mockResolvedValue([]) },
      payments: { update: jest.fn().mockResolvedValue({}) },
      cash_register_movements: { groupBy: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
      // Forma de dos args como Prisma real: el rechazo de la tx pasa por el
      // handler (mapeo P2002 → conflicto) en vez de propagarse crudo.
      $transaction: jest.fn(async (cb: any, onReject?: any) => {
        try {
          return await cb(mockPrisma);
        } catch (e) {
          if (onReject) return onReject(e);
          throw e;
        }
      }),
    };
    // Pre-tx usa `include`, el re-read bajo el lock usa `select`.
    mockPrisma.orders.findFirst.mockImplementation((args: any) =>
      args?.select ? { state: 'finished' } : baseOrder(),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RefundFlowService,
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: RefundCalculationService, useValue: mockCalculationService },
        { provide: StorePrismaService, useValue: mockPrisma },
        { provide: RequestContextService, useValue: { getUserId: () => 1 } },
        { provide: StockLevelManager, useValue: { updateStock: jest.fn() } },
        { provide: SettingsService, useValue: { getSettings: jest.fn().mockResolvedValue({ pos: { cash_register: { enabled: true } } }) } },
        { provide: SessionsService, useValue: {} },
        { provide: MovementsService, useValue: movements },
        {
          provide: SerialNumberEnforcementService,
          useValue: { isSerialized: () => Promise.resolve(false) },
        },
        { provide: InventorySerialNumbersService, useValue: { returnSerial: jest.fn() } },
        { provide: WalletService, useValue: { getOrCreateWallet: jest.fn() } },
        { provide: WalletBalanceService, useValue: { credit: jest.fn() } },
        {
          provide: PaymentGatewayService,
          useValue: mockGateway,
        },
        {
          provide: ManualRefundDeliveryService,
          useValue: { deliver: jest.fn(), enqueue: jest.fn() },
        },
        { provide: RefundCoverageService, useValue: mockCoverageService },
      ],
    }).compile();

    service = module.get(RefundFlowService);
  });

  const cashPayment = (id: number, amount: number) => ({
    id,
    state: 'succeeded',
    amount,
    store_payment_method: { system_payment_method: { type: 'cash' } },
  });

  const dto = (over: any = {}) => ({
    items: [],
    include_shipping: false,
    refund_method: 'original_payment',
    reason: 'B18/B25',
    ...over,
  });

  const withOrder = (payments: any[]) =>
    mockPrisma.orders.findFirst.mockImplementation((args: any) =>
      args?.select ? { state: 'finished' } : baseOrder({ payments }),
    );

  afterEach(() => jest.restoreAllMocks());

  it('B18: sin usuario encola en el outbox con el actor del sale (force_outbox), no omite', async () => {
    jest.spyOn(RequestContextService, 'getUserId').mockReturnValue(undefined as any);
    withOrder([cashPayment(100, 5000)]);
    movements.resolveSaleActorId.mockResolvedValue(42);

    await service.createRefund(1, dto() as any);

    // Webhook/job: the lookup is store-filtered (no store context to lean on).
    expect(movements.resolveSaleActorId).toHaveBeenCalledWith({
      store_id: 10,
      order_id: 1,
      payment_ids: [100],
    });
    expect(movements.recordRefundCashMovementDurable).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 42,
        payment_id: 100,
        amount: 1000,
        channel: 'cash',
        force_outbox: true,
      }),
    );
  });

  it('B18: sin usuario ni actor el efectivo igual se encola (user_id null), nunca failure_id null', async () => {
    jest.spyOn(RequestContextService, 'getUserId').mockReturnValue(undefined as any);
    withOrder([cashPayment(100, 5000)]);
    movements.resolveSaleActorId.mockResolvedValue(null);
    movements.recordRefundCashMovementDurable.mockResolvedValue({
      status: 'pending', failure_id: 77, reason: 'no_open_cash_session',
    });

    const result: any = await service.createRefund(1, dto() as any);

    expect(movements.recordRefundCashMovementDurable).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: null, payment_id: 100, force_outbox: true }),
    );
    expect(result.cash_movement).toEqual(
      expect.objectContaining({ status: 'pending', failure_id: 77 }),
    );
  });

  it('B18: si el lookup del actor falla, el refund committed no cae y el efectivo se encola', async () => {
    jest.spyOn(RequestContextService, 'getUserId').mockReturnValue(undefined as any);
    withOrder([cashPayment(100, 5000)]);
    movements.resolveSaleActorId.mockRejectedValue(new Error('Store context required'));

    await service.createRefund(1, dto() as any);

    expect(movements.recordRefundCashMovementDurable).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: null, force_outbox: true }),
    );
  });

  it('B18: con usuario sigue asentando directo (sin force_outbox)', async () => {
    jest.spyOn(RequestContextService, 'getUserId').mockReturnValue(7);
    withOrder([cashPayment(100, 5000)]);

    await service.createRefund(1, dto() as any);

    expect(movements.recordRefundCashMovementDurable).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 7, force_outbox: false }),
    );
  });

  it('B25: dos pagos en efectivo → un movimiento por pago, cada uno con su payment_id', async () => {
    jest.spyOn(RequestContextService, 'getUserId').mockReturnValue(7);
    withOrder([cashPayment(100, 600), cashPayment(101, 900)]);

    await service.createRefund(1, dto() as any);

    const calls = movements.recordRefundCashMovementDurable.mock.calls.map(([i]) => [
      i.payment_id,
      i.amount,
    ]);
    expect(calls).toEqual([
      [100, 600],
      [101, 400],
    ]);
  });

  it('B25: monto que no cabe en los pagos aborta antes del commit con REFUND_ALLOCATION_MISMATCH', async () => {
    jest.spyOn(RequestContextService, 'getUserId').mockReturnValue(7);
    withOrder([cashPayment(100, 300), cashPayment(101, 200)]);

    await expect(service.createRefund(1, dto() as any)).rejects.toMatchObject({
      errorCode: 'REFUND_ALLOCATION_MISMATCH',
    });
    expect(movements.recordRefundCashMovementDurable).not.toHaveBeenCalled();
  });
});
