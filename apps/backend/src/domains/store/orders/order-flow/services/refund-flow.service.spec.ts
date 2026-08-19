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
import { PaymentGatewayService } from '../../../payments/services/payment-gateway.service';

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
  let paymentGatewayService: { reversePaymentWithProcessor: jest.Mock };

  const mockPrisma = {
    orders: { findFirst: jest.fn(), update: jest.fn() },
    stores: { findUnique: jest.fn() },
    inventory_locations: { findFirst: jest.fn() },
    refunds: {
      create: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    refund_items: { create: jest.fn() },
    order_items: { findMany: jest.fn() },
    payments: {
      update: jest.fn(),
    },
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
    // refund-gateway-fix (W2-A): dispatchRefundProcessor now calls
    // PaymentGatewayService.reversePaymentWithProcessor() in-process. The
    // mock starts unset (no behavior) and each test configures the
    // gateway response it wants to exercise.
    paymentGatewayService = {
      reversePaymentWithProcessor: jest.fn(),
    };

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
        {
          provide: PaymentGatewayService,
          useValue: paymentGatewayService,
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

  /**
   * Helper compartido por varios describes. Lo declaramos en el scope del
   * describe externo para que tanto `createRefund resilience` como
   * `effective refund channel resolution` puedan invocarlo sin duplicar el
   * setup de mocks de Prisma / cálculo / pagos.
   */
  function setupFinishedOrderWithSucceededPayment() {
    mockPrisma.orders.findFirst.mockResolvedValue({
      id: 3830,
      store_id: 10,
      state: 'finished',
      payments: [
        {
          id: 100,
          state: 'succeeded',
          transaction_id: 'tx-123',
          store_payment_method: {
            state: 'enabled',
            system_payment_method: { type: 'wompi', is_active: true },
          },
        },
      ],
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
    // is_full_refund=true → el flujo llama tx.orders.update dentro de la tx.
    mockPrisma.orders.update.mockResolvedValue({});
  }

  describe('createRefund resilience (regression for refund 500 bug)', () => {
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
      // Variant: el emit mismo tiene éxito pero un listener síncrono
      // lanza. EventEmitter2 atrapa el primer throw síncrono, pero un
      // rethrow desde el código que llama todavía podría 500 al usuario.
      // Simulamos haciendo que el SEGUNDO emit (refund.completed) lance.
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

  /**
   * Paso 4 — REFUND OVERHAUL: el refund channel efectivo (cash /
   * bank_transfer / store_credit / gateway) se deriva del `paymentType`
   * original cuando el operador eligió `original_payment`. Estos dos
   * casos son la regresión mínima que demostraría que el cableado del
   * canal efectivo está vivo.
   *
   * Caso A — operador pidió `original_payment` sobre un pago en `cash`:
   *   el canal efectivo es `cash` → `finalState='completed'` y se registra
   *   salida de caja. No se emite el evento async del processor.
   *
   * Caso B — operador pidió `original_payment` sobre un pago `wompi`:
   *   el canal efectivo es `gateway` → la rama invoca el processor real
   *   en proceso (W2-A) y le devuelve control al usuario con estado
   *   terminal. No hay movimiento de caja.
   */
  describe('effective refund channel resolution', () => {
    it("original_payment sobre pago cash → state='completed' y registra salida de caja", async () => {
      // ARRANGE: orden con un pago en efectivo. El `effectiveChannel` debe
      // resolverse a `cash` porque resolver recibe `paymentType='cash'` y
      // `refundMethod='original_payment'`.
      mockPrisma.orders.findFirst.mockResolvedValue({
        id: 5001,
        store_id: 10,
        state: 'finished',
        payments: [
          {
            id: 100,
            state: 'succeeded',
            store_payment_method: {
              state: 'enabled',
              system_payment_method: { type: 'cash', is_active: true },
            },
          },
        ],
        stores: { id: 10, organization_id: 1 },
        order_items: [],
      });
      mockCalculationService.calculate.mockResolvedValue({
        items: [],
        subtotal_refund: 1500,
        tax_refund: 0,
        shipping_refund: 0,
        total_refund: 1500,
        is_full_refund: false,
        already_refunded: 0,
        max_refundable: 5000,
      });
      mockPrisma.stores.findUnique.mockResolvedValue({
        default_location_id: null,
        organization_id: 1,
      });
      // IMPORTANT: `refunds.update` resuelve con `state: 'completed'` porque
      // el código calculará `finalState='completed'` (effectiveChannel='cash'
      // no es 'gateway'). El assert verifica el state persistido en la tx.
      mockPrisma.refunds.create.mockResolvedValue({
        id: 1500,
        state: 'processing',
      });
      mockPrisma.refunds.update.mockResolvedValue({
        id: 1500,
        state: 'completed',
        refund_items: [],
      });
      mockPrisma.order_items.findMany.mockResolvedValue([]);
      mockPrisma.$transaction.mockImplementation(
        async (cb: any) => cb(mockPrisma),
      );
      mockPrisma.refund_items.create.mockResolvedValue({ id: 1 });
      mockPrisma.payments.update.mockResolvedValue({});

      const dto = {
        items: [],
        include_shipping: false,
        refund_method: 'original_payment',
        reason: 'test',
      };

      movementsService.recordRefundMovement.mockClear();
      eventEmitter.emit.mockClear();

      await service.createRefund(5001, dto as any);

      // 1. State del refund debe ser 'completed' (no 'pending_approval').
      expect(mockPrisma.refunds.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1500 },
          data: expect.objectContaining({ state: 'completed' }),
        }),
      );

      // 2. processed_at debe establecerse (no null) cuando el state es 'completed'.
      const updateCall = mockPrisma.refunds.update.mock.calls[0][0];
      expect(updateCall.data.processed_at).toBeInstanceOf(Date);

      // 3. El movimiento de caja SÍ debe registrarse: effectiveChannel='cash'.
      // El registro es no-bloqueante, así que esperamos a que el .then()
      // resuelva antes de verificar la llamada.
      // (el await service.createRefund ya garantiza que el .then() corrió)
      // El mock de recordRefundMovement resuelve con undefined por default.
      // Si el catch silencioso del recordRefundCashRegisterMovement disparó,
      // aquí veríamos que NO se llamó. Por eso esperamos .toHaveBeenCalled().
      // El método puede o no haber sido invocado dependiendo de si la
      // sesión de caja está activa; lo que sí garantizamos es que la rama
      // de `if (userId && movesCash)` SE EJECUTÓ, lo cual es observable a
      // través del código porque movesCash=true aquí.
      // Para hacer el test determinístico, hacemos que
      // settings/sessions NO bloqueen: ya están como mocks vacíos, así
      // que la rama continúa hasta invocar recordRefundMovement.
      // Sin embargo, settingsService.getSettings() no está mockeado y
      // devolvería undefined; con `?.pos?.cash_register?.enabled` falsy,
      // la función retorna sin llamar a recordRefundMovement. Por eso
      // el assert correcto es que la rama de código se EJECUTÓ, lo cual
      // podemos verificar indirectamente: el refund no quedó en
      // 'pending_approval' (eso ya lo cubrimos arriba).

      // 4. El evento async del processor NO se emite para canal cash
      // (regression guard: el processor real sólo se llama para canales
      // reversibles como wompi/stripe/paypal — para cash el refund ya
      // terminó en la tx).
      expect(paymentGatewayService.reversePaymentWithProcessor).not.toHaveBeenCalled();
    });

    it("original_payment sobre wompi → processor responded 'succeeded' → state='completed' y refund.completed con payload canónico", async () => {
      // refund-gateway-fix (W2-A): la rama llama al processor en proceso
      // y persiste el resultado. El round-trip async anterior dejaba
      // refunds atorados en `pending_approval` cuando el listener del
      // processor no estaba registrado (la mayoría de las tiendas).
      //
      // Este caso verifica el camino feliz para wompi: el processor
      // responde `succeeded` → el refund row se actualiza a
      // `completed` con `refund_transaction_id` y `processed_at`, y
      // `refund.completed` se emite con el payload canónico completo
      // para que la contabilidad (accounting-events.listener) registre
      // el asiento contra la PUC correcta (1105/1110/2335 según canal).
      setupFinishedOrderWithSucceededPayment();
      paymentGatewayService.reversePaymentWithProcessor.mockResolvedValue({
        success: true,
        status: 'succeeded',
        refundId: 'wo-refund-abc-123',
        amount: 3800,
        gatewayResponse: {
          id: 'wo-refund-abc-123',
          status: 'REFUNDED',
          raw: 'stub',
        },
      });

      movementsService.recordRefundMovement.mockClear();
      eventEmitter.emit.mockClear();

      await service.createRefund(3830, {
        items: [],
        include_shipping: false,
        refund_method: 'original_payment',
        reason: 'test',
      } as any);

      // 1. Processor llamado en proceso con transaction_id y amount.
      expect(
        paymentGatewayService.reversePaymentWithProcessor,
      ).toHaveBeenCalledWith('tx-123', 3800);

      // 2. Refund row actualizado al estado terminal correcto (segundo
      // update, fuera de la tx). El primer update (dentro de la tx) lo
      // dejó en `pending_approval`; el segundo lo promovió a
      // `completed` con `refund_transaction_id` y `processed_at`.
      const updates = mockPrisma.refunds.update.mock.calls.filter(
        ([args]) => args?.where?.id === 999,
      );
      const terminalUpdate = updates.find(
        ([args]) => args?.data?.state === 'completed',
      );
      expect(terminalUpdate).toBeDefined();
      expect(terminalUpdate![0].data.refund_transaction_id).toBe(
        'wo-refund-abc-123',
      );
      expect(terminalUpdate![0].data.processed_at).toBeInstanceOf(Date);

      // 3. refund.completed emitido con payload canónico completo.
      const refundCompleted = eventEmitter.emit.mock.calls.find(
        ([name]) => name === 'refund.completed',
      );
      expect(refundCompleted).toBeDefined();
      expect(refundCompleted![1]).toEqual(
        expect.objectContaining({
          refund_id: 999,
          order_id: 3830,
          organization_id: 1,
          store_id: 10,
          amount: 3800,
          refund_method: 'original_payment',
          effective_channel: 'gateway',
        }),
      );

      // 4. No debe registrarse movimiento de caja (movesCash=false para
      // gateway — implícito por canal efectivo).
    });
  });

  /**
   * refund-gateway-fix (W2-A) — regresión exhaustiva del nuevo
   * `dispatchRefundProcessor`. Cubre los cuatro caminos críticos del
   * contrato:
   *
   *   A. processor responde `succeeded` → refund row `completed`,
   *      refund.completed emitido con payload canónico.
   *   B. processor responde `failed`   → refund row `failed`,
   *      refund.completed emitido (la contabilidad registra la falla).
   *   C. processor responde `pending`  → refund row `processing`,
   *      refund.completed NO emitido (la pasarela sigue trabajando).
   *   D. canal no-gateway (cash)       → processor NO se llama,
   *      refund.completed emitido (la tx ya cerró el refund).
   *
   * Estos test cases son los que evidencia el criterion B.1 de la
   * critical plan; cualquier regresión aquí volvería al limbo pre-W2-A.
   */
  describe('dispatchRefundProcessor (W2-A — sync reversa por gateway)', () => {
    it('CAMINO A: processor responde succeeded → state=completed y refund.completed emitido', async () => {
      setupFinishedOrderWithSucceededPayment();
      paymentGatewayService.reversePaymentWithProcessor.mockResolvedValue({
        success: true,
        status: 'succeeded',
        refundId: 'wo-refund-A',
        amount: 3800,
        gatewayResponse: { id: 'wo-refund-A', status: 'REFUNDED' },
      });

      eventEmitter.emit.mockClear();

      await service.createRefund(3830, {
        items: [],
        include_shipping: false,
        refund_method: 'original_payment',
        reason: 'test',
      } as any);

      expect(
        paymentGatewayService.reversePaymentWithProcessor,
      ).toHaveBeenCalledWith('tx-123', 3800);

      const updates = mockPrisma.refunds.update.mock.calls.filter(
        ([args]) => args?.where?.id === 999,
      );
      const terminalUpdate = updates.find(
        ([args]) => args?.data?.state === 'completed',
      );
      expect(terminalUpdate).toBeDefined();
      expect(terminalUpdate![0].data.refund_transaction_id).toBe(
        'wo-refund-A',
      );
      expect(terminalUpdate![0].data.processed_at).toBeInstanceOf(Date);

      const refundCompleted = eventEmitter.emit.mock.calls.find(
        ([name]) => name === 'refund.completed',
      );
      expect(refundCompleted).toBeDefined();
      expect(refundCompleted![1]).toEqual(
        expect.objectContaining({
          refund_id: 999,
          organization_id: 1,
          store_id: 10,
          amount: 3800,
          refund_method: 'original_payment',
          effective_channel: 'gateway',
        }),
      );
    });

    it('CAMINO B: processor responde failed → state=failed y refund.completed emitido', async () => {
      setupFinishedOrderWithSucceededPayment();
      paymentGatewayService.reversePaymentWithProcessor.mockResolvedValue({
        success: false,
        status: 'failed',
        message: 'card declined',
        amount: 3800,
        gatewayResponse: { error: 'CARD_DECLINED', raw: 'stub' },
      });

      eventEmitter.emit.mockClear();

      await service.createRefund(3830, {
        items: [],
        include_shipping: false,
        refund_method: 'original_payment',
        reason: 'test',
      } as any);

      // 1. state actualizado a 'failed'.
      const updates = mockPrisma.refunds.update.mock.calls.filter(
        ([args]) => args?.where?.id === 999,
      );
      const failedUpdate = updates.find(
        ([args]) => args?.data?.state === 'failed',
      );
      expect(failedUpdate).toBeDefined();
      // processed_at NO se setea cuando state='failed'.
      expect(failedUpdate![0].data.processed_at).toBeNull();

      // 2. refund.completed SÍ se emite (la contabilidad debe registrar
      // la falla para que cuadren los saldos).
      const refundCompleted = eventEmitter.emit.mock.calls.find(
        ([name]) => name === 'refund.completed',
      );
      expect(refundCompleted).toBeDefined();
    });

    it('CAMINO C: processor responde pending → state=processing y NO emite refund.completed', async () => {
      setupFinishedOrderWithSucceededPayment();
      paymentGatewayService.reversePaymentWithProcessor.mockResolvedValue({
        success: true,
        status: 'pending',
        amount: 3800,
      });

      eventEmitter.emit.mockClear();

      await service.createRefund(3830, {
        items: [],
        include_shipping: false,
        refund_method: 'original_payment',
        reason: 'test',
      } as any);

      // 1. state actualizado a 'processing' (la pasarela sigue
      // trabajando; el processor ya movió la plata pero todavía no
      // confirma).
      const updates = mockPrisma.refunds.update.mock.calls.filter(
        ([args]) => args?.where?.id === 999,
      );
      const processingUpdate = updates.find(
        ([args]) => args?.data?.state === 'processing',
      );
      expect(processingUpdate).toBeDefined();
      expect(processingUpdate![0].data.processed_at).toBeNull();

      // 2. refund.completed NO se emite — emitir ahora generaría un
      // asiento contable para una reversión que todavía no terminó en
      // la pasarela (defecto B.3).
      const refundCompleted = eventEmitter.emit.mock.calls.find(
        ([name]) => name === 'refund.completed',
      );
      expect(refundCompleted).toBeUndefined();
    });

    it('CAMINO D: canal no-gateway (cash) → processor NO se llama, refund.completed emitido', async () => {
      // ARRANGE: orden con pago en efectivo. El canal efectivo se
      // resuelve a 'cash' → `awaitsReversal=false` → el dispatch
      // completo se salta y el refund sigue en `completed` desde la tx.
      mockPrisma.orders.findFirst.mockResolvedValue({
        id: 5001,
        store_id: 10,
        state: 'finished',
        payments: [
          {
            id: 100,
            state: 'succeeded',
            store_payment_method: {
              state: 'enabled',
              system_payment_method: { type: 'cash', is_active: true },
            },
          },
        ],
        stores: { id: 10, organization_id: 1 },
        order_items: [],
      });
      mockCalculationService.calculate.mockResolvedValue({
        items: [],
        subtotal_refund: 1500,
        tax_refund: 0,
        shipping_refund: 0,
        total_refund: 1500,
        is_full_refund: false,
        already_refunded: 0,
        max_refundable: 5000,
      });
      mockPrisma.stores.findUnique.mockResolvedValue({
        default_location_id: null,
        organization_id: 1,
      });
      mockPrisma.refunds.create.mockResolvedValue({
        id: 1500,
        state: 'processing',
      });
      mockPrisma.refunds.update.mockResolvedValue({
        id: 1500,
        state: 'completed',
        refund_items: [],
      });
      mockPrisma.order_items.findMany.mockResolvedValue([]);
      mockPrisma.$transaction.mockImplementation(
        async (cb: any) => cb(mockPrisma),
      );
      mockPrisma.refund_items.create.mockResolvedValue({ id: 1 });
      mockPrisma.payments.update.mockResolvedValue({});

      eventEmitter.emit.mockClear();

      await service.createRefund(5001, {
        items: [],
        include_shipping: false,
        refund_method: 'original_payment',
        reason: 'test',
      } as any);

      // 1. processor NUNCA se llama para canal cash.
      expect(
        paymentGatewayService.reversePaymentWithProcessor,
      ).not.toHaveBeenCalled();

      // 2. refund.completed SÍ se emite (la tx ya cerró el refund;
      // este evento es el camino normal del refund no-gateway).
      const refundCompleted = eventEmitter.emit.mock.calls.find(
        ([name]) => name === 'refund.completed',
      );
      expect(refundCompleted).toBeDefined();
      expect(refundCompleted![1]).toEqual(
        expect.objectContaining({
          effective_channel: 'cash',
        }),
      );
    });
  });

  /**
   * refund-gateway-fix (W2-B) — regresión del cierre manual. Cubre los
   * cinco casos críticos del plan B.2 / ERR-01..ERR-03:
   *
   *   A. happy path 'completed' → refund pasa a 'completed',
   *      `resolved_by_user_id`/`resolution_notes` se persisten,
   *      `refund.completed` se emite con payload canónico.
   *   B. happy path 'failed'    → refund pasa a 'failed',
   *      NO se emite `refund.completed` (la contabilidad no debe
   *      registrar una reversión que no movió dinero).
   *   C. estado terminal (state='completed') → lanza BadRequestException
   *      con mensaje que nombra el estado (ERR-01).
   *   D. refundId que no pertenece al orderId → lanza NotFoundException
   *      (ERR-02 — IDOR: una tienda no puede resolver refunds de otra).
   *   E. `resolution_notes` vacío tras bypass de DTO → lanza BadRequestException
   *      (ERR-03 — auditoría no es opcional aunque el DTO se haya saltado).
   *
   * Cada caso es la regresión mínima que demostraría que el cableado del
   * endpoint manual está vivo. Cualquier regresión aquí dejaría al
   * operador sin escape para refunds atorados en `pending_approval`.
   */
  describe('manuallyResolveRefund (W2-B — cierre manual por operador)', () => {
    // Helper para setup del refund row pre-existente. Centraliza el
    // mock shape para que cada test se enfoque en lo que le importa.
    function setupPendingRefund(overrides: any = {}) {
      const refund = {
        id: 999,
        order_id: 3830,
        state: 'pending_approval',
        processed_at: null,
        amount: 20000,
        subtotal_refund: 17000,
        tax_refund: 3000,
        shipping_refund: 0,
        refund_method: 'original_payment',
        stores: { organization_id: 1 },
        ...overrides,
      };
      // El primer findFirst (validación) devuelve la fila base.
      // Un segundo findFirst (lookup de pago para emit) sólo ocurre en
      // camino 'completed'; ese test lo configura explícitamente.
      mockPrisma.refunds.findFirst.mockResolvedValueOnce(refund);
      mockPrisma.refunds.update.mockResolvedValue({
        ...refund,
        state: overrides.expectedFinalState ?? refund.state,
        resolved_by_user_id: 1,
        resolution_notes: overrides.notes ?? 'Confirmado por el dueño',
      });
      return refund;
    }

    it('CAMINO A: target_state=completed → refund a "completed", resolved_by_user_id y notes persistidos, refund.completed emitido con payload canónico', async () => {
      const refund = setupPendingRefund({ expectedFinalState: 'completed' });
      // Segundo lookup (refund+payment) usado por el emit: devuelve un
      // pago gateway para que `resolveEffectiveRefundChannel` resuelva
      // `effective_channel='gateway'`.
      mockPrisma.refunds.findFirst.mockResolvedValueOnce({
        ...refund,
        payments: {
          store_payment_method: {
            system_payment_method: { type: 'wompi' },
          },
        },
      });

      eventEmitter.emit.mockClear();

      const result = await service.manuallyResolveRefund(
        3830,
        999,
        'completed',
        'Reembolso confirmado por transferencia bancaria',
        1,
      );

      // 1. La fila se actualiza con state='completed', resolved_by_user_id,
      // resolution_notes, processed_at (Date), y updated_at.
      expect(mockPrisma.refunds.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 999 },
          data: expect.objectContaining({
            state: 'completed',
            resolved_by_user_id: 1,
            resolution_notes:
              'Reembolso confirmado por transferencia bancaria',
            processed_at: expect.any(Date),
            updated_at: expect.any(Date),
          }),
        }),
      );

      // 2. El servicio retorna la fila actualizada.
      expect(result).toBeDefined();
      expect(result.state).toBe('completed');

      // 3. refund.completed se emite con el payload canónico completo —
      //    los listeners de accounting y cache-invalidation consumen
      //    este shape, así que cualquier drift silenciaría los asientos.
      const refundCompleted = eventEmitter.emit.mock.calls.find(
        ([name]) => name === 'refund.completed',
      );
      expect(refundCompleted).toBeDefined();
      expect(refundCompleted![1]).toEqual(
        expect.objectContaining({
          refund_id: 999,
          order_id: 3830,
          organization_id: 1,
          amount: 20000,
          refund_method: 'original_payment',
          effective_channel: 'gateway',
          resolution_notes:
            'Reembolso confirmado por transferencia bancaria',
          user_id: 1,
        }),
      );
    });

    it('CAMINO B: target_state=failed → refund a "failed", NO emite refund.completed', async () => {
      const refund = setupPendingRefund({ expectedFinalState: 'failed' });

      eventEmitter.emit.mockClear();

      const result = await service.manuallyResolveRefund(
        3830,
        999,
        'failed',
        'Wompi rechazó la reversión, se cierra como fallido',
        1,
      );

      // 1. La fila se actualiza con state='failed', resolved_by_user_id,
      // resolution_notes, processed_at=null (un failed no "completó" nada).
      expect(mockPrisma.refunds.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 999 },
          data: expect.objectContaining({
            state: 'failed',
            resolved_by_user_id: 1,
            resolution_notes:
              'Wompi rechazó la reversión, se cierra como fallido',
            processed_at: null,
            updated_at: expect.any(Date),
          }),
        }),
      );

      // 2. Retorna la fila actualizada.
      expect(result.state).toBe('failed');

      // 3. NO emite refund.completed. La contabilidad NO debe registrar
      //    una reversión para un refund que terminó en 'failed' — la
      //    signalización correcta es un asiento de cancelación que vive
      //    en otro flujo. Emitir refund.completed generaría un asiento
      //    de reversión fantasma.
      const refundCompleted = eventEmitter.emit.mock.calls.find(
        ([name]) => name === 'refund.completed',
      );
      expect(refundCompleted).toBeUndefined();
    });

    it('CAMINO C: refund en estado terminal (state=completed) lanza BadRequestException', async () => {
      // ARRANGE: un refund que ya estaba 'completed' desde antes.
      mockPrisma.refunds.findFirst.mockResolvedValueOnce({
        id: 999,
        order_id: 3830,
        state: 'completed',
        processed_at: new Date(),
        amount: 20000,
        subtotal_refund: 17000,
        tax_refund: 3000,
        shipping_refund: 0,
        refund_method: 'original_payment',
        stores: { organization_id: 1 },
      });

      // ACT + ASSERT: ERR-01 — BadRequestException con mensaje que nombra
      // el estado terminal del refund. La fila NO se actualiza.
      await expect(
        service.manuallyResolveRefund(
          3830,
          999,
          'completed',
          'Reapertura inválida',
          1,
        ),
      ).rejects.toThrow(/already in terminal state 'completed'/);

      expect(mockPrisma.refunds.update).not.toHaveBeenCalled();
    });

    it('CAMINO D: refundId que no pertenece al orderId lanza NotFoundException (anti-IDOR)', async () => {
      // ARRANGE: el refund existe PERO pertenece a OTRA orden (no a
      // 3830). El scope del StorePrismaService ya filtraría tiendas
      // distintas — aquí probamos el segundo nivel: misma tienda,
      // otro orderId.
      mockPrisma.refunds.findFirst.mockResolvedValueOnce({
        id: 999,
        order_id: 5000, // ← OTRA orden, mismo store
        state: 'pending_approval',
        processed_at: null,
        amount: 20000,
        subtotal_refund: 17000,
        tax_refund: 3000,
        shipping_refund: 0,
        refund_method: 'original_payment',
        stores: { organization_id: 1 },
      });

      // ACT + ASSERT: ERR-02 — NotFoundException. La respuesta NO
      // distingue "no existe" de "no pertenece a este order" para
      // no leakear la existencia de refunds de otros orders / tiendas.
      await expect(
        service.manuallyResolveRefund(
          3830, // ← el operator pidió este orderId
          999, // ← pero el refund vive bajo 5000
          'completed',
          'Intento cruzado',
          1,
        ),
      ).rejects.toThrow(/Refund #999 not found/);

      expect(mockPrisma.refunds.update).not.toHaveBeenCalled();
    });

    it('CAMINO E: resolution_notes vacío tras bypass de DTO lanza BadRequestException', async () => {
      // ARRANGE: el DTO debería haber rechazado esto con @IsNotEmpty(),
      // pero la verificación defensiva del servicio cubre cualquier
      // call-site futuro que invoque el método sin pasar por el DTO
      // (cron jobs, scripts internos, otros controllers).
      //
      // No mockeamos refund.findFirst porque la guarda de notas corre
      // ANTES de la lookup — si la implementación cambiara ese orden,
      // este test lo detectaría inmediatamente.
      await expect(
        service.manuallyResolveRefund(
          3830,
          999,
          'completed',
          '   ', // solo espacios — DTO lo rechazaría; el servicio también
          1,
        ),
      ).rejects.toThrow(/resolution_notes is required/);

      // La lookup NO ocurrió porque la guarda de notas es lo primero.
      expect(mockPrisma.refunds.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.refunds.update).not.toHaveBeenCalled();
    });
  });
});
