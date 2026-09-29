import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { RefundFlowService, CANCELLATION_REFUND_TX_PREFIX } from './refund-flow.service';
import { RefundPayoutChannel } from '../dto/resolve-refund.dto';
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
import {
  ManualRefundDeliveryService,
  MANUAL_REFUND_DELIVERY_KEY,
} from '../../../accounting/auto-entries/manual-refund-delivery.service';

/**
 * CP-REFUND-FLOW-REDESIGN paso 10 — gate de resolución manual (paso 5).
 *
 * El resolve manual produce los mismos efectos y el mismo shape de
 * `refund.completed` que el flujo ordinario. El carril contable durable
 * `manual_refund_delivery_v1` se CONSERVA (spec inviolable): el marcador
 * `manual_durable` hace que el listener ordinario no postee un segundo
 * asiento — el carril único anti-doble-reversa refund-vs-NC queda intacto.
 */
describe('RefundFlowService — gate de resolve canónico (paso 5, CP-REFUND-FLOW-REDESIGN)', () => {
  let service: RefundFlowService;
  let eventEmitter: { emit: jest.Mock };
  let mockPrisma: any;
  let manualRefundDelivery: { deliver: jest.Mock; enqueue: jest.Mock };
  let walletService: { creditForRefund: jest.Mock };
  let movementsService: { recordRefundCashMovementDurable: jest.Mock };
  let mockCoverageService: { recomputeLineCache: jest.Mock };

  const orderRow = (over: any = {}) => ({
    id: 1,
    store_id: 10,
    state: 'finished',
    customer_id: null,
    order_number: 'O-1',
    payments: [{ id: 100, state: 'succeeded' }],
    grand_total: new Prisma.Decimal(10000),
    shipping_cost: new Prisma.Decimal(0),
    shipping_tax_amount: new Prisma.Decimal(0),
    shipping_tax_type: null,
    stores: { organization_id: 1 },
    order_items: [],
    refunds: [],
    ...over,
  });

  const refundRow = (over: any = {}) => ({
    id: 55,
    order_id: 1,
    state: 'processing',
    amount: new Prisma.Decimal(10000),
    subtotal_refund: new Prisma.Decimal(10000),
    tax_refund: new Prisma.Decimal(0),
    shipping_refund: new Prisma.Decimal(0),
    payment_id: 100,
    refund_transaction_id: null,
    processed_at: null,
    refund_items: [],
    ...over,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    eventEmitter = { emit: jest.fn() };
    manualRefundDelivery = {
      deliver: jest.fn().mockResolvedValue(undefined),
      enqueue: jest.fn().mockResolvedValue(undefined),
    };
    walletService = { creditForRefund: jest.fn().mockResolvedValue({ wallet_id: 8 }) };
    movementsService = {
      recordRefundCashMovementDurable: jest.fn().mockResolvedValue({ status: 'recorded', movement_id: 9 }),
    };
    mockCoverageService = {
      recomputeLineCache: jest.fn().mockResolvedValue(undefined),
    };
    mockPrisma = {
      orders: {
        findFirst: jest.fn().mockResolvedValue(orderRow()),
        update: jest.fn().mockResolvedValue({}),
      },
      refunds: {
        findFirst: jest.fn().mockResolvedValue(refundRow()),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      payments: { update: jest.fn().mockResolvedValue({}) },
      accounting_entry_failures: { create: jest.fn().mockResolvedValue({ id: 77 }) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn(async (cb: any) => cb(mockPrisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RefundFlowService,
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: RefundCalculationService, useValue: { calculate: jest.fn() } },
        { provide: StorePrismaService, useValue: mockPrisma },
        { provide: RequestContextService, useValue: {} },
        { provide: StockLevelManager, useValue: {} },
        {
          provide: SettingsService,
          useValue: { getSettings: jest.fn().mockResolvedValue({ pos: { cash_register: { enabled: true } } }) },
        },
        {
          provide: SessionsService,
          useValue: { getActiveSession: jest.fn().mockResolvedValue({ id: 3 }) },
        },
        { provide: MovementsService, useValue: movementsService },
        { provide: SerialNumberEnforcementService, useValue: {} },
        { provide: InventorySerialNumbersService, useValue: {} },
        { provide: WalletService, useValue: walletService },
        { provide: WalletBalanceService, useValue: {} },
        { provide: PaymentGatewayService, useValue: {} },
        { provide: ManualRefundDeliveryService, useValue: manualRefundDelivery },
        { provide: RefundCoverageService, useValue: mockCoverageService },
      ],
    }).compile();

    service = module.get(RefundFlowService);
  });

  const completedEmit = () =>
    eventEmitter.emit.mock.calls.find(([n]) => n === 'refund.completed')?.[1];

  describe('shape canónico + side-effects ordinarios', () => {
    it('emite refund.completed canónico (montos, desglose, método, canal efectivo)', async () => {
      await service.manuallyResolveRefund(1, 55, 'completed', 'verificado', 7, 'MAN-001', RefundPayoutChannel.CASH);

      expect(completedEmit()).toMatchObject({
        refund_id: 55,
        order_id: 1,
        organization_id: 1,
        store_id: 10,
        amount: 10000,
        subtotal: 10000,
        tax: 0,
        tax_amount: 0,
        tax_breakdown: expect.any(Array),
        shipping: 0,
        is_full_refund: true,
        user_id: 7,
        refund_method: 'cash',
        effective_channel: 'cash',
        accounting_delivery: 'manual_durable',
      });
    });

    it('cobertura total: promueve pagos a refunded + orden a refunded + status_changed', async () => {
      await service.manuallyResolveRefund(1, 55, 'completed', 'verificado', 7, 'MAN-001', RefundPayoutChannel.CASH);

      expect(mockPrisma.payments.update).toHaveBeenCalledWith({
        where: { id: 100 },
        data: { state: 'refunded', updated_at: expect.any(Date) },
      });
      expect(mockPrisma.orders.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { state: 'refunded', updated_at: expect.any(Date) },
      });
      const changed = eventEmitter.emit.mock.calls.find(([n]) => n === 'order.status_changed')?.[1];
      expect(changed).toMatchObject({ order_id: 1, old_state: 'finished', new_state: 'refunded' });
    });

    it('parcial: marca la pierna vinculada partially_refunded sin tocar la orden', async () => {
      mockPrisma.refunds.findFirst.mockResolvedValue(
        refundRow({ amount: new Prisma.Decimal(3000), subtotal_refund: new Prisma.Decimal(3000) }),
      );

      await service.manuallyResolveRefund(1, 55, 'completed', 'parcial verificado', 7, 'MAN-002', RefundPayoutChannel.CASH);

      expect(mockPrisma.payments.update).toHaveBeenCalledWith({
        where: { id: 100 },
        data: { state: 'partially_refunded', updated_at: expect.any(Date) },
      });
      expect(mockPrisma.orders.update).not.toHaveBeenCalled();
      expect(completedEmit()).toMatchObject({ is_full_refund: false });
    });

    it('orden cancelled conserva su estado (el refunded nunca pisa una cancelación)', async () => {
      mockPrisma.orders.findFirst.mockResolvedValue(orderRow({ state: 'cancelled' }));

      await service.manuallyResolveRefund(1, 55, 'completed', 'verificado', 7, 'MAN-001', RefundPayoutChannel.CASH);

      expect(mockPrisma.orders.update).not.toHaveBeenCalled();
      expect(
        eventEmitter.emit.mock.calls.some(([n]) => n === 'order.status_changed'),
      ).toBe(false);
    });

    it('canal cash: la respuesta lleva el aviso durable de caja igual que createRefund', async () => {
      const result: any = await service.manuallyResolveRefund(
        1, 55, 'completed', 'verificado', 7, 'MAN-001', RefundPayoutChannel.CASH,
      );

      expect(movementsService.recordRefundCashMovementDurable).toHaveBeenCalledWith(
        expect.objectContaining({ refund_id: 55, order_id: 1, payment_id: 100, channel: 'cash', session_id: 3 }),
      );
      expect(result.cash_movement).toEqual({ status: 'recorded', movement_id: 9 });
    });

    it('canal store_credit: acredita vía creditForRefund durable (no vía evento)', async () => {
      mockPrisma.orders.findFirst.mockResolvedValue(orderRow({ customer_id: 21 }));

      await service.manuallyResolveRefund(
        1, 55, 'completed', 'verificado', 7, 'MAN-003', RefundPayoutChannel.STORE_CREDIT,
      );

      expect(walletService.creditForRefund).toHaveBeenCalledWith(21, 10000, {
        refund_id: 55,
        order_id: 1,
        user_id: 7,
      });
      expect(movementsService.recordRefundCashMovementDurable).not.toHaveBeenCalled();
    });
  });

  describe('carril contable manual_refund_delivery_v1 (inviolable)', () => {
    it('el asiento sigue en el carril durable: fila + deliver + marcador manual_durable', async () => {
      await service.manuallyResolveRefund(1, 55, 'completed', 'verificado', 7, 'MAN-001', RefundPayoutChannel.CASH);

      expect(mockPrisma.accounting_entry_failures.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          handler_key: MANUAL_REFUND_DELIVERY_KEY,
          source_id: 55,
        }),
      });
      expect(manualRefundDelivery.deliver).toHaveBeenCalledWith(77);
      expect(completedEmit()).toMatchObject({ accounting_delivery: 'manual_durable' });
    });

    it('si deliver falla, encola reintento sin revertir el refund committed', async () => {
      manualRefundDelivery.deliver.mockRejectedValue(new Error('journal caído'));

      const result: any = await service.manuallyResolveRefund(
        1, 55, 'completed', 'verificado', 7, 'MAN-001', RefundPayoutChannel.CASH,
      );

      expect(manualRefundDelivery.enqueue).toHaveBeenCalledWith(77);
      expect(result.state).toBe('completed');
    });
  });

  describe('guardas de resolución', () => {
    it('notas vacías ⇒ 400 (auditoría obligatoria)', async () => {
      await expect(
        service.manuallyResolveRefund(1, 55, 'completed', '   ', 7, 'MAN-001', RefundPayoutChannel.CASH),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mockPrisma.refunds.updateMany).not.toHaveBeenCalled();
    });

    it('refund ya terminal ⇒ REF_RESOLUTION_CONFLICT_001', async () => {
      mockPrisma.refunds.findFirst.mockResolvedValue(refundRow({ state: 'completed' }));

      await expect(
        service.manuallyResolveRefund(1, 55, 'completed', 'otro intento', 7, 'MAN-009', RefundPayoutChannel.CASH),
      ).rejects.toMatchObject({ errorCode: 'REF_RESOLUTION_CONFLICT_001' });
      expect(mockPrisma.refunds.updateMany).not.toHaveBeenCalled();
    });

    it('claim perdido (doble resolve concurrente) ⇒ REF_RESOLUTION_CONFLICT_001', async () => {
      mockPrisma.refunds.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.manuallyResolveRefund(1, 55, 'completed', 'verificado', 7, 'MAN-001', RefundPayoutChannel.CASH),
      ).rejects.toMatchObject({ errorCode: 'REF_RESOLUTION_CONFLICT_001' });
    });

    it('id de gateway real nunca se sobrescribe con la referencia manual', async () => {
      mockPrisma.refunds.findFirst.mockResolvedValue(
        refundRow({ refund_transaction_id: 'wompi-tx-123' }),
      );

      await expect(
        service.manuallyResolveRefund(1, 55, 'completed', 'verificado', 7, 'MAN-001', RefundPayoutChannel.CASH),
      ).rejects.toMatchObject({ errorCode: 'REF_RESOLUTION_CONFLICT_001' });
    });

    it('placeholder ADR-12 SÍ cede ante la referencia real del payout', async () => {
      mockPrisma.refunds.findFirst.mockResolvedValue(
        refundRow({ refund_transaction_id: `${CANCELLATION_REFUND_TX_PREFIX}o1:p100` }),
      );

      await service.manuallyResolveRefund(1, 55, 'completed', 'verificado', 7, 'MAN-001', RefundPayoutChannel.CASH);

      expect(mockPrisma.refunds.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ id: 55, order_id: 1 }),
        data: expect.objectContaining({ refund_transaction_id: 'MAN-001' }),
      });
    });

    it('target failed: sin delivery, sin refund.completed, sin tocar pagos', async () => {
      const result: any = await service.manuallyResolveRefund(1, 55, 'failed', 'pasarela rechazó', 7);

      expect(result.state).toBe('failed');
      expect(mockPrisma.accounting_entry_failures.create).not.toHaveBeenCalled();
      expect(manualRefundDelivery.deliver).not.toHaveBeenCalled();
      expect(eventEmitter.emit.mock.calls.some(([n]) => n === 'refund.completed')).toBe(false);
      expect(mockPrisma.payments.update).not.toHaveBeenCalled();
      expect(result.cash_movement).toBeUndefined();
    });
  });

  describe('release-853 paso 7: caché tras failed + is_full_refund bajo lock', () => {
    it('rama failed: re-agrega el caché en la misma tx del claim', async () => {
      await service.manuallyResolveRefund(1, 55, 'failed', 'pasarela rechazó', 7);

      expect(mockCoverageService.recomputeLineCache).toHaveBeenCalledWith(mockPrisma, 1);
    });

    it('rama completed: NO re-agrega (el caché ya se escribió en la creación)', async () => {
      await service.manuallyResolveRefund(1, 55, 'completed', 'verificado', 7, 'MAN-001', RefundPayoutChannel.CASH);

      expect(mockCoverageService.recomputeLineCache).not.toHaveBeenCalled();
    });

    it('is_full_refund se recalcula bajo el lock: un completado concurrente que el pre-tx no vio sí promueve', async () => {
      // Pre-tx: sin completados previos y un parcial de 3000 ⇒ parcial.
      mockPrisma.refunds.findFirst.mockResolvedValue(
        refundRow({ amount: new Prisma.Decimal(3000), subtotal_refund: new Prisma.Decimal(3000) }),
      );
      // Bajo el lock: otro parcial de 7000 completó en el medio.
      mockPrisma.refunds.findMany.mockResolvedValue([
        { id: 2, amount: new Prisma.Decimal(7000) },
      ]);

      await service.manuallyResolveRefund(1, 55, 'completed', 'verificado', 7, 'MAN-001', RefundPayoutChannel.CASH);

      // 7000 + 3000 cubre los 10000: promueve con el valor bajo lock.
      expect(mockPrisma.payments.update).toHaveBeenCalledWith({
        where: { id: 100 },
        data: { state: 'refunded', updated_at: expect.any(Date) },
      });
      expect(mockPrisma.orders.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { state: 'refunded', updated_at: expect.any(Date) },
      });
      expect(completedEmit()).toMatchObject({ is_full_refund: true });
    });
  });
});
