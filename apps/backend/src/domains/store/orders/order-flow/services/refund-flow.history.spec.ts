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
    payments: { update: jest.fn() },
    $transaction: jest.fn(),
  };

  const mockCalculationService = {
    calculate: jest.fn(),
    preview: jest.fn(),
    calculateCancellationCashRefund: jest.fn(),
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
        { provide: MovementsService, useValue: { recordRefundMovement: jest.fn() } },
        { provide: SerialNumberEnforcementService, useValue: { isSerialized: () => Promise.resolve(false) } },
        { provide: InventorySerialNumbersService, useValue: { returnSerial: jest.fn() } },
        { provide: WalletService, useValue: { getOrCreateWallet: jest.fn(), creditForRefund: jest.fn() } },
        { provide: WalletBalanceService, useValue: { credit: jest.fn().mockResolvedValue(undefined) } },
        { provide: PaymentGatewayService, useValue: { reversePaymentWithProcessor: jest.fn() } },
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
});
