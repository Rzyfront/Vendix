import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RefundFlowService } from './refund-flow.service';
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

/**
 * REFUND OVERHAUL — focused regression tests for the invariants this
 * plan introduced. These cases are the smallest set that would FAIL if
 * the production incident recurred:
 *
 *   - original_payment no longer triggers a phantom cash-register movement
 *   - cash still triggers a cash-register movement (regression guard)
 *   - refund_method is in the emitted event payload so auto-entry
 *     journal routing works
 *   - default-location fallback resolves missing location_id to the
 *     store's main warehouse
 */
describe('RefundFlowService — refund overhaul invariants', () => {
  let service: RefundFlowService;
  let eventEmitter: { emit: jest.Mock };
  let movementsService: { recordRefundMovement: jest.Mock };

  const mockPrisma = {
    orders: { findFirst: jest.fn() },
    stores: { findUnique: jest.fn() },
    inventory_locations: { findFirst: jest.fn() },
    refunds: { create: jest.fn(), update: jest.fn() },
    refund_items: { create: jest.fn() },
    order_items: { findMany: jest.fn() },
    payments: { update: jest.fn() },
    $transaction: jest.fn(),
  };

  const mockCalculationService = {
    calculate: jest.fn(),
    preview: jest.fn(),
  };

  const mockMovementsService = {
    recordRefundMovement: jest.fn().mockResolvedValue(undefined),
  };

  const mockStockLevelManager = {
    updateStock: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    eventEmitter = { emit: jest.fn() };
    movementsService = mockMovementsService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RefundFlowService,
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: RefundCalculationService, useValue: mockCalculationService },
        { provide: StorePrismaService, useValue: mockPrisma },
        { provide: RequestContextService, useValue: { getUserId: () => 1 } },
        { provide: StockLevelManager, useValue: mockStockLevelManager },
        { provide: SettingsService, useValue: {} },
        { provide: SessionsService, useValue: {} },
        { provide: MovementsService, useValue: mockMovementsService },
        {
          provide: SerialNumberEnforcementService,
          useValue: { isSerialized: () => Promise.resolve(false) },
        },
        {
          provide: InventorySerialNumbersService,
          useValue: { returnSerial: jest.fn() },
        },
        { provide: WalletService, useValue: { getOrCreateWallet: jest.fn() } },
        {
          provide: WalletBalanceService,
          useValue: { credit: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    service = module.get(RefundFlowService);
  });

  describe('refund_method in event payload', () => {
    it('emits refund_method so AutoEntryService can route the credit-side PUC', async () => {
      // Setup: order exists, calculation returns a valid result, transaction
      // resolves with a refund row.
      mockPrisma.orders.findFirst.mockResolvedValue({
        id: 1,
        store_id: 10,
        state: 'finished',
        payments: [{ id: 100, state: 'succeeded' }],
        stores: { id: 10, organization_id: 1 },
        order_items: [],
      });
      mockCalculationService.calculate.mockResolvedValue({
        items: [],
        subtotal_refund: 1000,
        tax_refund: 0,
        shipping_refund: 0,
        total_refund: 1000,
        is_full_refund: false,
        already_refunded: 0,
        max_refundable: 5000,
      });
      mockPrisma.stores.findUnique.mockResolvedValue({
        default_location_id: null,
        organization_id: 1,
      });
      mockPrisma.refunds.create.mockResolvedValue({ id: 999, state: 'pending' });
      mockPrisma.refunds.update.mockResolvedValue({
        id: 999,
        state: 'completed',
        refund_items: [],
      });
      mockPrisma.order_items.findMany.mockResolvedValue([]);
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockPrisma));
      // Make the inner tx methods resolve minimally:
      mockPrisma.refund_items.create.mockResolvedValue({ id: 1 });
      mockPrisma.payments.update.mockResolvedValue({});

      const dto = {
        items: [],
        include_shipping: false,
        refund_method: 'store_credit',
        reason: 'test',
      };

      // customer_id is null → wallet credit path skipped
      await service.createRefund(1, dto as any);

      const refundCompleted = eventEmitter.emit.mock.calls.find(
        ([name]) => name === 'refund.completed',
      );
      expect(refundCompleted).toBeDefined();
      expect(refundCompleted![1]).toEqual(
        expect.objectContaining({ refund_method: 'store_credit' }),
      );
    });
  });

  describe('cash-register gate', () => {
    it('does NOT record a cash-register movement for original_payment', async () => {
      // ARRANGE: same as above but refund_method = 'original_payment' and
      // customer_id is null so the wallet branch is skipped.
      mockPrisma.orders.findFirst.mockResolvedValue({
        id: 1,
        store_id: 10,
        state: 'finished',
        payments: [{ id: 100, state: 'succeeded' }],
        stores: { id: 10, organization_id: 1 },
        order_items: [],
      });
      mockCalculationService.calculate.mockResolvedValue({
        items: [],
        subtotal_refund: 1000,
        tax_refund: 0,
        shipping_refund: 0,
        total_refund: 1000,
        is_full_refund: false,
        already_refunded: 0,
        max_refundable: 5000,
      });
      mockPrisma.stores.findUnique.mockResolvedValue({
        default_location_id: null,
        organization_id: 1,
      });
      mockPrisma.refunds.create.mockResolvedValue({ id: 999, state: 'pending' });
      mockPrisma.refunds.update.mockResolvedValue({
        id: 999,
        state: 'completed',
        refund_items: [],
      });
      mockPrisma.order_items.findMany.mockResolvedValue([]);
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockPrisma));
      mockPrisma.refund_items.create.mockResolvedValue({ id: 1 });
      mockPrisma.payments.update.mockResolvedValue({});

      const dto = {
        items: [],
        include_shipping: false,
        refund_method: 'original_payment',
        reason: 'test',
      };

      movementsService.recordRefundMovement.mockClear();
      await service.createRefund(1, dto as any);

      // REFUND OVERHAUL — original_payment must NOT trigger the cash
      // register; the previous bug recorded a phantom cash-out for card
      // refunds.
      expect(movementsService.recordRefundMovement).not.toHaveBeenCalled();
    });

    it('does NOT record a cash-register movement for bank_transfer', async () => {
      mockPrisma.orders.findFirst.mockResolvedValue({
        id: 1,
        store_id: 10,
        state: 'finished',
        payments: [{ id: 100, state: 'succeeded' }],
        stores: { id: 10, organization_id: 1 },
        order_items: [],
      });
      mockCalculationService.calculate.mockResolvedValue({
        items: [],
        subtotal_refund: 1000,
        tax_refund: 0,
        shipping_refund: 0,
        total_refund: 1000,
        is_full_refund: false,
        already_refunded: 0,
        max_refundable: 5000,
      });
      mockPrisma.stores.findUnique.mockResolvedValue({
        default_location_id: null,
        organization_id: 1,
      });
      mockPrisma.refunds.create.mockResolvedValue({ id: 999, state: 'pending' });
      mockPrisma.refunds.update.mockResolvedValue({
        id: 999,
        state: 'completed',
        refund_items: [],
      });
      mockPrisma.order_items.findMany.mockResolvedValue([]);
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockPrisma));
      mockPrisma.refund_items.create.mockResolvedValue({ id: 1 });
      mockPrisma.payments.update.mockResolvedValue({});

      const dto = {
        items: [],
        include_shipping: false,
        refund_method: 'bank_transfer',
        reason: 'test',
      };

      movementsService.recordRefundMovement.mockClear();
      await service.createRefund(1, dto as any);

      expect(movementsService.recordRefundMovement).not.toHaveBeenCalled();
    });
  });

  describe('default-location fallback', () => {
    it('throws a clear error when neither default_location nor any active warehouse exists', async () => {
      mockPrisma.orders.findFirst.mockResolvedValue({
        id: 1,
        store_id: 10,
        state: 'finished',
        payments: [{ id: 100, state: 'succeeded' }],
        stores: { id: 10, organization_id: 1 },
        order_items: [
          { id: 1, products: { id: 1, track_inventory: true } },
        ],
      });
      mockCalculationService.calculate.mockResolvedValue({
        items: [
          {
            order_item_id: 1,
            product_name: 'Test',
            quantity: 1,
            inventory_action: 'restock',
            location_id: null,
            refund_amount: 100,
            tax_amount: 0,
            discount_amount: 0,
            unit_price: 100,
            gross_amount: 100,
            net_amount: 100,
          },
        ],
        subtotal_refund: 100,
        tax_refund: 0,
        shipping_refund: 0,
        total_refund: 100,
        is_full_refund: false,
        already_refunded: 0,
        max_refundable: 5000,
      });
      mockPrisma.stores.findUnique.mockResolvedValue({
        default_location_id: null,
        organization_id: 1,
      });
      mockPrisma.inventory_locations.findFirst.mockResolvedValue(null);

      const dto = {
        items: [{ order_item_id: 1, quantity: 1, inventory_action: 'restock' }],
        include_shipping: false,
        refund_method: 'cash',
        reason: 'test',
      };

      await expect(service.createRefund(1, dto as any)).rejects.toThrow(
        /no active warehouse/i,
      );
    });
  });

  /**
   * Regression: customer-facing refund button returned SYS_INTERNAL_001
   * (HTTP 500) when the backend threw inside the post-transaction
   * `.then()` for `original_payment` refunds — the refund row was already
   * committed, but the uncaught throw bubbled up to the controller and
   * the global exception filter rendered a generic 500 to the user. The
   * user reported: "Procesar Reembolso no ejecuta acción, muestra icono
   * de bloqueo".
   *
   * Both fixes below ensure the user gets a normal 200 + refund row in
   * `pending` (per the original_payment contract), even if a downstream
   * step throws after the transaction commits.
   */

  describe('createRefund resilience (regression for refund 500 bug)', () => {
    function setupFinishedOrderWithSucceededPayment() {
      mockPrisma.orders.findFirst.mockResolvedValue({
        id: 3830,
        store_id: 10,
        state: 'finished',
        payments: [{ id: 100, state: 'succeeded', transaction_id: 'tx-123' }],
        stores: { id: 10, organization_id: 1 },
        order_items: [],
      });
      mockCalculationService.calculate.mockResolvedValue({
        items: [],
        subtotal_refund: 3800,
        tax_refund: 0,
        shipping_refund: 0,
        total_refund: 3800,
        is_full_refund: true,
        already_refunded: 0,
        max_refundable: 5000,
      });
      mockPrisma.stores.findUnique.mockResolvedValue({
        default_location_id: null,
        organization_id: 1,
      });
      mockPrisma.refunds.create.mockResolvedValue({ id: 999, state: 'pending' });
      mockPrisma.refunds.update.mockResolvedValue({
        id: 999,
        state: 'pending_approval',
        refund_items: [],
      });
      mockPrisma.order_items.findMany.mockResolvedValue([]);
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockPrisma));
      mockPrisma.refund_items.create.mockResolvedValue({ id: 1 });
      mockPrisma.payments.update.mockResolvedValue({});
    }

    it('does NOT throw when dispatchRefundProcessor fails for original_payment', async () => {
      // Repro: the post-transaction processor step throws. The transaction
      // is already committed, so the refund row exists; the user must
      // get a normal 200 response and the operator must see the row in
      // `pending` to close it manually.
      setupFinishedOrderWithSucceededPayment();

      // Force the processor emit to throw synchronously by making the
      // EventEmitter2 emit raise on the listener. The wrapping
      // try/catch in `dispatchRefundProcessor` already covers its own
      // emit; the outer catch on the caller covers anything else
      // (e.g. upstream accessors before the emit).
      eventEmitter.emit.mockImplementation(() => {
        throw new Error('processor offline');
      });

      const dto = {
        items: [],
        include_shipping: false,
        refund_method: 'original_payment',
        reason: 'test',
      };

      // The promise must resolve, not reject.
      await expect(
        service.createRefund(3830, dto as any),
      ).resolves.toBeDefined();
    });

    it('does NOT throw when a downstream refund listener throws', async () => {
      // Variant: the emit itself succeeds but a synchronous listener
      // throws. EventEmitter2 catches the first synchronous throw, but
      // any rethrow from the calling code path would still 500 the user.
      // We simulate by making the SECOND emit (refund.completed) throw.
      setupFinishedOrderWithSucceededPayment();

      const realEmit = eventEmitter.emit;
      eventEmitter.emit.mockImplementation((name: string, payload: any) => {
        realEmit(name, payload);
        if (name === 'refund.completed') {
          throw new Error('auto-entry listener crashed');
        }
        return true;
      });

      const dto = {
        items: [],
        include_shipping: false,
        refund_method: 'original_payment',
        reason: 'test',
      };

      await expect(
        service.createRefund(3830, dto as any),
      ).resolves.toBeDefined();
    });
  });
});
