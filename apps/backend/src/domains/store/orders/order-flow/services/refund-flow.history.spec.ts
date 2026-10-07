import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RefundFlowService } from './refund-flow.service';
import { RefundPayoutChannel } from '../dto/resolve-refund.dto';
import { RefundCalculationService } from './refund-calculation.service';
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
import { OrderHistoryService } from '../../order-history/order-history.service';
import { Prisma } from '@prisma/client';

/**
 * Plan order-truth-and-invoice-tz — paso 6 verificación. `OrderHistoryService
 * .record` fue cableado en `createRefund` y `manuallyResolveRefund`
 * (486ccab81) pero ningún spec afirmaba las llamadas. Archivo NUEVO — no
 * toca `refund-flow.service.spec.ts` (1480+ líneas). Reusa el mismo provider
 * set de ese spec y sólo agrega `OrderHistoryService` para poder inspeccionar
 * los argumentos de `record`.
 *
 * `RequestContextService` se deja SIN mockear (igual que el spec existente):
 * `RefundFlowService` invoca `RequestContextService.getUserId()` como
 * llamada ESTÁTICA — un provider inyectado por DI es inerte para ella. Sin
 * un `RequestContextService.run(...)` activo, `getUserId()` resuelve
 * `undefined`, lo que en `createRefund` desactiva a propósito la rama de
 * movimiento de caja (`if (userId && movesCash)`), evitando mockear
 * `SettingsService.getSettings()` (no expuesto por este provider set).
 */
describe('RefundFlowService — order_events (plan order-truth-and-invoice-tz)', () => {
  let service: RefundFlowService;
  let orderHistoryService: { record: jest.Mock };
  let eventEmitter: { emit: jest.Mock };
  let manualRefundDelivery: { deliver: jest.Mock; enqueue: jest.Mock };

  const mockPrisma = {
    orders: { findFirst: jest.fn(), update: jest.fn() },
    stores: { findUnique: jest.fn() },
    inventory_locations: { findFirst: jest.fn() },
    refunds: {
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    accounting_entry_failures: { create: jest.fn() },
    $queryRaw: jest.fn(),
    refund_items: { create: jest.fn(), findMany: jest.fn() },
    order_items: { findMany: jest.fn() },
    payments: { update: jest.fn(), findFirst: jest.fn() },
    cash_register_movements: { findFirst: jest.fn() },
    audit_logs: { create: jest.fn() },
    $transaction: jest.fn(),
  };

  const mockMovements = {
    recordRefundMovement: jest.fn(),
    resolveCompensationSessionId: jest.fn(),
  };
  const mockPaymentGateway = { reversePaymentWithProcessor: jest.fn() };
  const mockWallet = { getOrCreateWallet: jest.fn(), creditForRefund: jest.fn() };

  const mockCalculationService = {
    calculate: jest.fn(),
    preview: jest.fn(),
    calculateCancellationCashRefund: jest.fn(),
    calculateCancellationRefund: jest.fn(),
  };

  const mockStockLevelManager = { updateStock: jest.fn().mockResolvedValue(undefined) };

  beforeEach(async () => {
    jest.clearAllMocks();
    eventEmitter = { emit: jest.fn() };
    manualRefundDelivery = {
      deliver: jest.fn().mockResolvedValue(undefined),
      enqueue: jest.fn().mockResolvedValue(undefined),
    };
    orderHistoryService = { record: jest.fn().mockResolvedValue(null) };
    mockPrisma.$transaction.mockImplementation((cb: any) => cb(mockPrisma));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RefundFlowService,
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: RefundCalculationService, useValue: mockCalculationService },
        { provide: StorePrismaService, useValue: mockPrisma },
        { provide: RequestContextService, useValue: { getUserId: () => undefined } },
        { provide: StockLevelManager, useValue: mockStockLevelManager },
        { provide: SettingsService, useValue: {} },
        { provide: SessionsService, useValue: {} },
        { provide: MovementsService, useValue: mockMovements },
        { provide: SerialNumberEnforcementService, useValue: { isSerialized: () => Promise.resolve(false) } },
        { provide: InventorySerialNumbersService, useValue: { returnSerial: jest.fn() } },
        { provide: WalletService, useValue: mockWallet },
        { provide: WalletBalanceService, useValue: { credit: jest.fn().mockResolvedValue(undefined) } },
        { provide: PaymentGatewayService, useValue: mockPaymentGateway },
        { provide: ManualRefundDeliveryService, useValue: manualRefundDelivery },
        { provide: OrderHistoryService, useValue: orderHistoryService },
      ],
    }).compile();

    service = module.get(RefundFlowService);
  });

  describe('createRefund', () => {
    const ORDER_ID = 9001;

    it('reembolso completo en efectivo: registra refund_created y state_changed →refunded', async () => {
      const orderFixture = {
        id: ORDER_ID,
        store_id: 10,
        state: 'delivered',
        order_number: 'ORD-REF-1',
        currency: 'COP',
        customer_id: null,
        stores: { id: 10, organization_id: 9 },
        order_items: [],
        payments: [
          {
            id: 5001,
            state: 'succeeded',
            store_payment_method: { system_payment_method: { type: 'cash' } },
          },
        ],
      };

      mockCalculationService.calculate.mockResolvedValue({
        items: [],
        total_refund: new Prisma.Decimal('59.50'),
        subtotal_refund: new Prisma.Decimal('50.00'),
        tax_refund: new Prisma.Decimal('9.50'),
        shipping_refund: new Prisma.Decimal(0),
        shipping_tax_refund: 0,
        shipping_tax_type: null,
        is_full_refund: true,
        max_refundable: new Prisma.Decimal('59.50'),
      });
      mockPrisma.stores.findUnique.mockResolvedValue({ default_location_id: null, organization_id: 9 });
      mockPrisma.orders.findFirst.mockImplementation(async (args: any) =>
        args?.include ? orderFixture : { state: 'delivered' },
      );
      mockPrisma.refunds.create.mockImplementation(async ({ data }: any) => ({ id: 81, ...data }));
      mockPrisma.refunds.update.mockResolvedValue({ id: 81, payment_id: 5001, state: 'completed' });
      mockPrisma.payments.update.mockResolvedValue({});
      mockPrisma.orders.update.mockResolvedValue({});
      mockPrisma.order_items.findMany.mockResolvedValue([]);
      mockPrisma.$queryRaw.mockResolvedValue(undefined);

      const dto: any = {
        items: [],
        refund_method: 'cash',
        reason: 'Producto dañado',
        include_shipping: false,
      };
      await service.createRefund(ORDER_ID, dto);

      expect(orderHistoryService.record).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({
          orderId: ORDER_ID,
          storeId: 10,
          organizationId: 9,
          type: 'refund_created',
          paymentId: 5001,
          amount: '59.5',
          payload: expect.objectContaining({
            refund_method: 'cash',
            is_full_refund: true,
          }),
        }),
      );
      expect(orderHistoryService.record).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({
          orderId: ORDER_ID,
          type: 'state_changed',
          fromState: 'delivered',
          toState: 'refunded',
        }),
      );
    });

    it('reembolso parcial: registra refund_created y NO un state_changed', async () => {
      const orderFixture = {
        id: ORDER_ID,
        store_id: 10,
        state: 'delivered',
        order_number: 'ORD-REF-3',
        currency: 'COP',
        customer_id: null,
        stores: { id: 10, organization_id: 9 },
        order_items: [],
        payments: [
          {
            id: 5001,
            state: 'succeeded',
            store_payment_method: { system_payment_method: { type: 'cash' } },
          },
        ],
      };

      mockCalculationService.calculate.mockResolvedValue({
        items: [],
        total_refund: new Prisma.Decimal('20.00'),
        subtotal_refund: new Prisma.Decimal('20.00'),
        tax_refund: new Prisma.Decimal(0),
        shipping_refund: new Prisma.Decimal(0),
        shipping_tax_refund: 0,
        shipping_tax_type: null,
        is_full_refund: false,
        max_refundable: new Prisma.Decimal('59.50'),
      });
      mockPrisma.stores.findUnique.mockResolvedValue({ default_location_id: null, organization_id: 9 });
      mockPrisma.orders.findFirst.mockImplementation(async (args: any) =>
        args?.include ? orderFixture : { state: 'delivered' },
      );
      mockPrisma.refunds.create.mockImplementation(async ({ data }: any) => ({ id: 82, ...data }));
      mockPrisma.refunds.update.mockResolvedValue({ id: 82, payment_id: 5001, state: 'completed' });
      mockPrisma.payments.update.mockResolvedValue({});
      mockPrisma.order_items.findMany.mockResolvedValue([]);
      mockPrisma.$queryRaw.mockResolvedValue(undefined);

      const dto: any = {
        items: [],
        refund_method: 'cash',
        reason: 'Un ítem con falla',
        include_shipping: false,
      };
      await service.createRefund(ORDER_ID, dto);

      expect(orderHistoryService.record).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({ type: 'refund_created', paymentId: 5001, amount: '20' }),
      );
      expect(orderHistoryService.record).not.toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({ type: 'state_changed' }),
      );
      expect(mockPrisma.orders.update).not.toHaveBeenCalled();
    });
  });

  describe('manuallyResolveRefund', () => {
    const ORDER_ID = 9002;
    const REFUND_ID = 701;
    const USER_ID = 55;

    it('resuelve a completed y cubre el total: registra refund_resolved y state_changed →refunded', async () => {
      const orderFixture = {
        id: ORDER_ID,
        store_id: 10,
        state: 'delivered',
        customer_id: null,
        order_number: 'ORD-REF-2',
        payments: [{ id: 6001, state: 'succeeded' }],
        grand_total: new Prisma.Decimal('59.50'),
        shipping_cost: new Prisma.Decimal(0),
        shipping_tax_amount: new Prisma.Decimal(0),
        shipping_tax_type: null,
        stores: { organization_id: 9 },
        order_items: [],
        refunds: [],
      };
      const refundFixture = {
        id: REFUND_ID,
        order_id: ORDER_ID,
        state: 'pending_approval',
        amount: new Prisma.Decimal('59.50'),
        payment_id: 6001,
        refund_transaction_id: null,
        refund_items: [],
      };

      mockPrisma.orders.findFirst.mockResolvedValue(orderFixture);
      mockPrisma.refunds.findFirst.mockResolvedValue(refundFixture);
      mockPrisma.refunds.findMany.mockResolvedValue([]); // prior completed refunds
      mockPrisma.refunds.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.accounting_entry_failures.create.mockResolvedValue({ id: 501 });
      mockPrisma.payments.update.mockResolvedValue({});
      mockPrisma.orders.update.mockResolvedValue({});
      mockPrisma.$queryRaw.mockResolvedValue(undefined);

      await service.manuallyResolveRefund(
        ORDER_ID,
        REFUND_ID,
        'completed',
        'Transferencia confirmada por el banco',
        USER_ID,
        'REF-TRX-1',
        RefundPayoutChannel.BANK_TRANSFER,
      );

      expect(orderHistoryService.record).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({
          orderId: ORDER_ID,
          storeId: 10,
          organizationId: 9,
          type: 'refund_resolved',
          paymentId: 6001,
          amount: '59.5',
          actorUserId: USER_ID,
          payload: expect.objectContaining({
            refund_id: REFUND_ID,
            target_state: 'completed',
          }),
        }),
      );
      expect(orderHistoryService.record).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({
          orderId: ORDER_ID,
          type: 'state_changed',
          fromState: 'delivered',
          toState: 'refunded',
        }),
      );
    });

    it('resuelve a failed: registra refund_resolved y NUNCA un state_changed', async () => {
      const orderFixture = {
        id: ORDER_ID,
        store_id: 10,
        state: 'delivered',
        customer_id: null,
        order_number: 'ORD-REF-4',
        payments: [{ id: 6002, state: 'succeeded' }],
        grand_total: new Prisma.Decimal('59.50'),
        shipping_cost: new Prisma.Decimal(0),
        shipping_tax_amount: new Prisma.Decimal(0),
        shipping_tax_type: null,
        stores: { organization_id: 9 },
        order_items: [],
        refunds: [],
      };
      const refundFixture = {
        id: REFUND_ID,
        order_id: ORDER_ID,
        state: 'pending_approval',
        amount: new Prisma.Decimal('59.50'),
        payment_id: 6002,
        refund_transaction_id: null,
        refund_items: [],
      };

      mockPrisma.orders.findFirst.mockResolvedValue(orderFixture);
      mockPrisma.refunds.findFirst.mockResolvedValue(refundFixture);
      mockPrisma.refunds.findMany.mockResolvedValue([]);
      mockPrisma.refunds.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.$queryRaw.mockResolvedValue(undefined);

      await service.manuallyResolveRefund(
        ORDER_ID,
        REFUND_ID,
        'failed',
        'La pasarela rechazó la reversión',
        USER_ID,
      );

      expect(orderHistoryService.record).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({
          type: 'refund_resolved',
          paymentId: 6002,
          payload: expect.objectContaining({ target_state: 'failed' }),
        }),
      );
      expect(orderHistoryService.record).not.toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({ type: 'state_changed' }),
      );
      expect(mockPrisma.orders.update).not.toHaveBeenCalled();
    });
  });
  describe('recordCancellationCashRefund / recordCancellationPendingRefunds', () => {
    const ORDER_ID = 9301;
    const STORE_ID = 55;
    const cancelOrderFixture = {
      id: ORDER_ID,
      store_id: STORE_ID,
      stores: { organization_id: 4 },
      grand_total: new Prisma.Decimal(100000),
      tax_amount: new Prisma.Decimal(0),
      shipping_cost: new Prisma.Decimal(0),
      shipping_tax_amount: new Prisma.Decimal(0),
      shipping_tax_type: null,
      tip_amount: new Prisma.Decimal(0),
      currency: 'COP',
      payments: [{ id: 801, state: 'succeeded' }],
    };
    const breakdownOf = (amount: number) => ({
      amount: new Prisma.Decimal(amount),
      subtotal: new Prisma.Decimal(amount),
      tax: new Prisma.Decimal(0),
      shipping: new Prisma.Decimal(0),
    });

    it('efectivo con un solo pago: refund_created con paymentId, monto y refund_method cash en el tx del llamador', async () => {
      const tx: any = { refunds: { create: jest.fn().mockResolvedValue({ id: 7001 }) } };
      mockCalculationService.calculateCancellationCashRefund.mockResolvedValue(breakdownOf(40000));

      await service.recordCancellationCashRefund(
        tx, cancelOrderFixture as any, [801], new Prisma.Decimal(40000), 'Cliente desistió',
      );

      expect(orderHistoryService.record).toHaveBeenCalledTimes(1);
      expect(orderHistoryService.record).toHaveBeenCalledWith(tx, {
        orderId: ORDER_ID,
        storeId: STORE_ID,
        organizationId: 4,
        type: 'refund_created',
        paymentId: 801,
        amount: '40000',
        payload: { reason: 'Cliente desistió', refund_id: 7001, refund_method: 'cash' },
      });
      // Documental: nunca cambia el estado de la orden.
      expect(orderHistoryService.record.mock.calls.some(([, evt]: any) => evt.type === 'state_changed')).toBe(false);
    });

    it('efectivo con varios pagos: paymentId null', async () => {
      const tx: any = { refunds: { create: jest.fn().mockResolvedValue({ id: 7002 }) } };
      mockCalculationService.calculateCancellationCashRefund.mockResolvedValue(breakdownOf(60000));

      await service.recordCancellationCashRefund(
        tx, cancelOrderFixture as any, [801, 802], new Prisma.Decimal(60000), 'x',
      );

      expect(orderHistoryService.record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({ type: 'refund_created', paymentId: null, amount: '60000' }),
      );
    });

    it('piernas pendientes: un refund_created por pierna (pago y abono CxP), salta cero y duplicados', async () => {
      const tx: any = {
        refunds: {
          findFirst: jest
            .fn()
            .mockResolvedValueOnce(null) // pierna pago 802
            .mockResolvedValueOnce(null) // pierna abono ar 31
            .mockResolvedValueOnce({ id: 1 }), // pierna pago 803 ya existe
          create: jest
            .fn()
            .mockResolvedValueOnce({ id: 7101 })
            .mockResolvedValueOnce({ id: 7102 }),
        },
      };
      mockCalculationService.calculate.mockResolvedValue({ max_refundable: 100000 });
      mockCalculationService.calculateCancellationRefund
        .mockResolvedValueOnce(breakdownOf(30000))
        .mockResolvedValueOnce(breakdownOf(20000));

      await service.recordCancellationPendingRefunds(
        tx,
        cancelOrderFixture as any,
        [
          { payment_id: 802, amount: 30000, method_label: 'pago #802 (card)' },
          { ar_payment_id: 31, amount: 20000, method_label: 'abono #31' },
          { payment_id: 804, amount: 0, method_label: 'pago #804 (card)' },
          { payment_id: 803, amount: 10000, method_label: 'pago #803 (card)' },
        ] as any,
        'Cancelación',
      );

      // ADR-13: las piernas nacen `processing` (estado de libro), nunca `requested`.
      expect(tx.refunds.create).toHaveBeenCalledTimes(2);
      for (const [arg] of tx.refunds.create.mock.calls) {
        expect(arg.data.state).toBe('processing');
      }
      expect(orderHistoryService.record).toHaveBeenCalledTimes(2);
      expect(orderHistoryService.record).toHaveBeenNthCalledWith(1, tx, {
        orderId: ORDER_ID,
        storeId: STORE_ID,
        organizationId: 4,
        type: 'refund_created',
        paymentId: 802,
        amount: '30000',
        payload: { reason: 'Cancelación', refund_id: 7101, refund_method: 'original_payment', ar_payment_id: null },
      });
      expect(orderHistoryService.record).toHaveBeenNthCalledWith(2, tx, {
        orderId: ORDER_ID,
        storeId: STORE_ID,
        organizationId: 4,
        type: 'refund_created',
        paymentId: null,
        amount: '20000',
        payload: { reason: 'Cancelación', refund_id: 7102, refund_method: 'original_payment', ar_payment_id: 31 },
      });
    });

    it('piernas que exceden el techo: lanza antes de crear y no registra', async () => {
      const tx: any = { refunds: { findFirst: jest.fn(), create: jest.fn() } };
      mockCalculationService.calculate.mockResolvedValue({ max_refundable: 50000 });

      await expect(
        service.recordCancellationPendingRefunds(
          tx,
          cancelOrderFixture as any,
          [{ payment_id: 802, amount: 30000, method_label: 'x' }] as any,
          'Cancelación',
          new Prisma.Decimal(40000),
        ),
      ).rejects.toMatchObject({ errorCode: 'REF_VALIDATE_001' });
      expect(tx.refunds.create).not.toHaveBeenCalled();
      expect(orderHistoryService.record).not.toHaveBeenCalled();
    });
  });

  describe('completeCancellationNonCashRefunds (ADR-13)', () => {
    const ORDER_ID = 9401;
    const STORE_ID = 55;
    const order = { id: ORDER_ID, store_id: STORE_ID, grand_total: new Prisma.Decimal(60000) };
    const resultOf = (refundId: number, paymentId: number, method: string) =>
      ({
        refund: { id: refundId, payment_id: paymentId },
        breakdown: {
          amount: new Prisma.Decimal(60000),
          subtotal: new Prisma.Decimal(60000),
          tax: new Prisma.Decimal(0),
          shipping: new Prisma.Decimal(0),
          shippingTax: new Prisma.Decimal(0),
          shippingTaxType: null,
        },
        leg: { payment_id: paymentId, amount: new Prisma.Decimal(60000), method_label: 'x', method_type: method },
      }) as any;
    const paymentOf = (id: number, type: string, transaction_id: string | null = null) => ({
      id,
      state: 'cancelled',
      transaction_id,
      store_payment_method: { system_payment_method: { type } },
    });

    beforeEach(() => {
      jest.spyOn(RequestContextService, 'getUserId').mockReturnValue(7);
      mockPrisma.refunds.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.stores.findUnique.mockResolvedValue({ organization_id: 4 });
      mockPrisma.order_items.findMany.mockResolvedValue([]);
      mockPrisma.orders.findFirst.mockResolvedValue({ customer_id: 31 });
      mockPrisma.cash_register_movements.findFirst
        .mockResolvedValueOnce({ payment_method: 'bank_transfer' }) // sale
        .mockResolvedValueOnce(null); // sin contra-movimiento previo
      mockMovements.resolveCompensationSessionId.mockResolvedValue(88);
    });
    afterEach(() => jest.restoreAllMocks());

    it('transferencia: completed + movimiento bank_transfer order_cancelled + un solo refund.completed', async () => {
      mockPrisma.payments.findFirst.mockResolvedValue(paymentOf(801, 'bank_transfer'));

      await service.completeCancellationNonCashRefunds(order, [resultOf(382, 801, 'bank_transfer')]);

      expect(mockPrisma.refunds.updateMany).toHaveBeenCalledWith({
        where: { id: 382, state: { in: ['processing', 'failed'] } },
        data: expect.objectContaining({ state: 'completed', processed_at: expect.any(Date) }),
      });
      expect(orderHistoryService.record).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({ type: 'refund_resolved', paymentId: 801 }),
      );
      expect(mockMovements.recordRefundMovement).toHaveBeenCalledWith(
        88,
        expect.objectContaining({
          amount: 60000,
          payment_method: 'bank_transfer',
          payment_id: 801,
          reference: 'order_cancelled',
        }),
      );
      const completed = eventEmitter.emit.mock.calls.filter(([name]: any) => name === 'refund.completed');
      expect(completed).toHaveLength(1);
      expect(completed[0][1]).toMatchObject({
        refund_id: 382,
        effective_channel: 'bank_transfer',
        refund_method: 'original_payment',
      });
      expect(mockPaymentGateway.reversePaymentWithProcessor).not.toHaveBeenCalled();
    });

    it('wompi que falla: el reembolso igual queda completed y se audita gateway_reversal_failed', async () => {
      mockPrisma.payments.findFirst.mockResolvedValue(paymentOf(802, 'wompi', 'tx-1'));
      mockPaymentGateway.reversePaymentWithProcessor.mockRejectedValue(new Error('wompi down'));
      mockPrisma.refunds.update.mockResolvedValue({});

      await service.completeCancellationNonCashRefunds(order, [resultOf(383, 802, 'wompi')]);

      expect(mockPaymentGateway.reversePaymentWithProcessor).toHaveBeenCalledWith('tx-1', 60000);
      expect(mockPrisma.audit_logs.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'payment.cancel.cash_reversal_issue',
          metadata: expect.objectContaining({ cause: 'gateway_reversal_failed', refund_id: 383 }),
        }),
      });
      expect(mockPrisma.refunds.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 383, state: { in: ['processing', 'failed'] } },
          data: expect.objectContaining({ state: 'completed' }),
        }),
      );
      const completed = eventEmitter.emit.mock.calls.filter(([name]: any) => name === 'refund.completed');
      expect(completed).toHaveLength(1);
      expect(completed[0][1]).toMatchObject({ effective_channel: 'gateway' });
    });

    it('wompi que reversa con éxito: dispatch ya dejó completed; igual registra historial, movimiento y un solo refund.completed', async () => {
      mockPrisma.payments.findFirst.mockResolvedValue(paymentOf(806, 'wompi', 'tx-2'));
      mockPaymentGateway.reversePaymentWithProcessor.mockResolvedValue({
        status: 'succeeded', refundId: 'wo-refund-1', gatewayResponse: {},
      });
      mockPrisma.refunds.update.mockResolvedValue({});
      // El row ya está `completed`: un claim sobre processing/failed daría 0.
      mockPrisma.refunds.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.cash_register_movements.findFirst.mockReset();
      mockPrisma.cash_register_movements.findFirst
        .mockResolvedValueOnce({ payment_method: 'wompi' })
        .mockResolvedValueOnce(null);

      await service.completeCancellationNonCashRefunds(order, [resultOf(387, 806, 'wompi')]);

      expect(mockPrisma.refunds.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.audit_logs.create).not.toHaveBeenCalled();
      expect(orderHistoryService.record).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({ type: 'refund_resolved', paymentId: 806 }),
      );
      expect(mockMovements.recordRefundMovement).toHaveBeenCalledWith(
        88,
        expect.objectContaining({ payment_method: 'wompi', payment_id: 806, reference: 'order_cancelled' }),
      );
      const completed = eventEmitter.emit.mock.calls.filter(([name]: any) => name === 'refund.completed');
      expect(completed).toHaveLength(1);
      expect(completed[0][1]).toMatchObject({ refund_id: 387, effective_channel: 'gateway' });
    });

    it('voucher/wallet: canal store_credit y crédito a la wallet del cliente', async () => {
      mockPrisma.payments.findFirst.mockResolvedValue(paymentOf(803, 'wallet'));

      await service.completeCancellationNonCashRefunds(order, [resultOf(384, 803, 'wallet')]);

      expect(mockWallet.creditForRefund).toHaveBeenCalledWith(31, 60000, {
        refund_id: 384, order_id: ORDER_ID, user_id: 7,
      });
      const completed = eventEmitter.emit.mock.calls.filter(([name]: any) => name === 'refund.completed');
      expect(completed[0][1]).toMatchObject({ effective_channel: 'store_credit' });
    });

    it('sin sesión abierta: no registra movimiento, audita y aun así cierra y emite', async () => {
      mockPrisma.payments.findFirst.mockResolvedValue(paymentOf(804, 'bank_transfer'));
      mockMovements.resolveCompensationSessionId.mockResolvedValue(null);

      await service.completeCancellationNonCashRefunds(order, [resultOf(385, 804, 'bank_transfer')]);

      expect(mockMovements.recordRefundMovement).not.toHaveBeenCalled();
      expect(mockPrisma.audit_logs.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          metadata: expect.objectContaining({ cause: 'no_open_session_non_cash' }),
        }),
      });
      expect(eventEmitter.emit.mock.calls.filter(([n]: any) => n === 'refund.completed')).toHaveLength(1);
    });

    it('cierre ya hecho (claim 0): no emite ni asienta nada', async () => {
      mockPrisma.payments.findFirst.mockResolvedValue(paymentOf(805, 'bank_transfer'));
      mockPrisma.refunds.updateMany.mockResolvedValue({ count: 0 });

      await service.completeCancellationNonCashRefunds(order, [resultOf(386, 805, 'bank_transfer')]);

      expect(eventEmitter.emit).not.toHaveBeenCalled();
      expect(mockMovements.recordRefundMovement).not.toHaveBeenCalled();
    });
  });
});
