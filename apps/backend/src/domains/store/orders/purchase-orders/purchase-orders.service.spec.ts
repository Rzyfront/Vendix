import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PurchaseOrdersService } from './purchase-orders.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { StockLevelManager } from '../../inventory/shared/services/stock-level-manager.service';
import { CostingService } from '../../inventory/shared/services/costing.service';
import { CostingMethodResolverService } from '../../inventory/shared/services/costing-method-resolver.service';
import { InventorySerialNumbersService } from '../../inventory/serial-numbers/inventory-serial-numbers.service';
import { SerialNumberEnforcementService } from '../../inventory/serial-numbers/serial-number-enforcement.service';
import { AuditService } from '@common/audit/audit.service';
import { S3Service } from '@common/services/s3.service';
import { SettingsService } from '../../settings/settings.service';
import { FiscalScopeService } from '@common/services/fiscal-scope.service';
import { RequestContextService } from '@common/context/request-context.service';
import { AccountsPayableService } from '../../accounts-payable/accounts-payable.service';

/**
 * Step 5 — PurchaseOrdersService.receive() unit tests.
 *
 * Covers the fix from Steps 1-4:
 *   1. `costingService.calculateCostOnReceipt` MUST run BEFORE
 *      `stockLevelManager.updateStock` so weighted-average reads are
 *      pre-receipt (no double-counting).
 *   2. updateStock receives `unit_cost = costResult.new_cost_per_unit` (CPP to
 *      persist) and `movement_unit_cost = receiptUnitCost` (real receipt cost
 *      for the snapshot).
 *   3. The costing method comes from `CostingMethodResolverService` with
 *      (organizationId, storeId), not from store settings.
 *   4. If `calculateCostOnReceipt` throws, the receipt does NOT abort:
 *      updateStock is still called and falls back to the receipt unit cost
 *      both for `unit_cost` and `movement_unit_cost`.
 */
describe('PurchaseOrdersService.receive()', () => {
  let service: PurchaseOrdersService;
  let prismaService: jest.Mocked<StorePrismaService>;
  let stockLevelManager: jest.Mocked<StockLevelManager>;
  let costingService: jest.Mocked<CostingService>;
  let costingMethodResolver: jest.Mocked<CostingMethodResolverService>;
  let auditService: jest.Mocked<AuditService>;
  let eventEmitter: jest.Mocked<EventEmitter2>;

  const ORG_ID = 1;
  const STORE_ID = 10;
  const USER_ID = 7;
  const PO_ID = 42;
  const PO_ITEM_ID = 100;
  const PRODUCT_ID = 555;
  const LOCATION_ID = 999;

  const mockOrderItem = {
    id: PO_ITEM_ID,
    product_id: PRODUCT_ID,
    product_variant_id: null,
    unit_cost: 2000, // receipt cost
    quantity_ordered: 10,
    quantity_received: 0,
    batch_number: null,
    manufacturing_date: null,
    expiration_date: null,
  };

  const mockPurchaseOrder = {
    id: PO_ID,
    organization_id: ORG_ID,
    location_id: LOCATION_ID,
    // `pending` no existe en purchase_order_status_enum (draft | approved |
    // partial | received | cancelled). Se recibe desde `approved`.
    status: 'approved',
    order_number: 'PO-TEST-0001',
    total_amount: 20000,
    location: { id: LOCATION_ID, store_id: STORE_ID },
    purchase_order_items: [mockOrderItem],
  };

  // Default DTO: receive full quantity (10 units).
  const baseDto = {
    items: [{ id: PO_ITEM_ID, quantity_received: 10 }],
    notes: 'Test receipt',
  } as any;

  beforeEach(async () => {
    // Mocked tx object that the $transaction callback receives — it carries
    // every Prisma model the receive() flow touches.
    const buildTxMock = () => ({
      purchase_order_receptions: { create: jest.fn().mockResolvedValue({ id: 1 }) },
      purchase_order_reception_items: { create: jest.fn().mockResolvedValue({}) },
      purchase_order_items: {
        update: jest.fn().mockResolvedValue({}),
        // FASE 0/FASE 2 — receive() now calls findMany for the over-receipt guard
        // (purchase-orders.service.ts:1420). Pre-existing mock missed this; the
        // guard validates each line belongs to this order and stays within the
        // (ordered - already_received) envelope.
        findMany: jest.fn().mockResolvedValue([
          {
            id: mockOrderItem.id,
            quantity_ordered: mockOrderItem.quantity_ordered,
            quantity_received: 0,
            // QUI-486 — el guard de línea base los lee de esta misma consulta.
            product_id: PRODUCT_ID,
            product_variant_id: null,
          },
        ]),
      },
      // QUI-486 — producto de control SIN variantes: el guard consulta y no
      // encuentra ninguna, así que la recepción base sigue siendo válida.
      product_variants: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      // Pre-existing dependencies this spec never mocked:
      // - findFirst: Fase 2 UoM conversion (resolveUoMConversion).
      //   is_ingredient=false preserves the exact retail behaviour the
      //   existing assertions expect (factor=1, no quantity/cost scaling).
      // - findUnique/update: QUI-425 (D2) cost-anchor pricing rule that runs
      //   unconditionally after stock update for variant-less items.
      products: {
        findFirst: jest.fn().mockResolvedValue({
          id: PRODUCT_ID,
          is_ingredient: false,
          purchase_to_stock_factor: null,
          stock_uom_id: null,
          purchase_uom_id: null,
        }),
        findUnique: jest.fn().mockResolvedValue({
          base_price: 3000,
          profit_margin: 20,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      purchase_orders: {
        findUnique: jest.fn().mockResolvedValue(mockPurchaseOrder),
        update: jest.fn().mockResolvedValue({
          ...mockPurchaseOrder,
          status: 'received',
          suppliers: null,
          location: mockPurchaseOrder.location,
          purchase_order_items: [
            { ...mockOrderItem, products: null, product_variants: null },
          ],
        }),
      },
    });

    const mockPrismaService = {
      $transaction: jest.fn().mockImplementation(async (callback: any) => {
        return callback(buildTxMock());
      }),
      // D2: used OUTSIDE the transaction, only on the reception that fully
      // completes the order, to compute the remainder against what
      // accounting already posted for this order's prior receptions.
      purchase_order_receptions: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      accounting_entries: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    const mockStockLevelManager = {
      updateStock: jest.fn().mockResolvedValue({
        stock_level: { id: 1 },
        transaction: { id: 1 },
        previous_quantity: 0,
      }),
    };

    const mockCostingService = {
      calculateCostOnReceipt: jest.fn().mockResolvedValue({
        new_cost_per_unit: 1500, // resolver-computed CPP
        previous_cost_per_unit: 1000,
      }),
    };

    const mockCostingMethodResolver = {
      resolveCostingMethod: jest.fn().mockResolvedValue('weighted_average'),
    };

    const mockAuditService = {
      logCustom: jest.fn().mockResolvedValue(undefined),
    };

    const mockS3Service = {} as any;
    const mockSettingsService = {} as any;
    // Step 10 dep: receive() resolves the fiscal accounting entity once for the
    // accounting emit (wrapped in try/catch — only `entity?.id` is consumed).
    const mockFiscalScopeService = {
      resolveAccountingEntityForFiscal: jest.fn().mockResolvedValue({ id: 1 }),
    };

    // Pre-existing constructor deps (QUI-431 serial numbers) that this spec
    // never mocked — required for Test.createTestingModule to compile the
    // module at all, independent of the D2 accounting changes below.
    const mockSerialNumbersService = {
      populatePoolOnReceipt: jest.fn().mockResolvedValue(undefined),
    };
    const mockSerialEnforcement = {
      isSerialized: jest.fn().mockResolvedValue(false),
      assertParityForLocation: jest.fn().mockResolvedValue(undefined),
    };

    const mockEventEmitter = {
      emit: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchaseOrdersService,
        { provide: StorePrismaService, useValue: mockPrismaService },
        { provide: StockLevelManager, useValue: mockStockLevelManager },
        { provide: CostingService, useValue: mockCostingService },
        {
          provide: CostingMethodResolverService,
          useValue: mockCostingMethodResolver,
        },
        {
          provide: InventorySerialNumbersService,
          useValue: mockSerialNumbersService,
        },
        {
          provide: SerialNumberEnforcementService,
          useValue: mockSerialEnforcement,
        },
        { provide: AuditService, useValue: mockAuditService },
        { provide: S3Service, useValue: mockS3Service },
        { provide: SettingsService, useValue: mockSettingsService },
        { provide: FiscalScopeService, useValue: mockFiscalScopeService },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        // FASE 3 — mock de AccountsPayableService (no-op). El PO service ahora
        // lo inyecta para el puente PO→AP y backfill. Cada test que active el
        // camino de pago con CxP puede sobreescribir este mock si necesita.
        {
          provide: AccountsPayableService,
          useValue: {
            mirrorPoPaymentToAp: jest.fn().mockResolvedValue({ ap_payment_id: 0 }),
            mirrorApPaymentToPo: jest.fn().mockResolvedValue({ purchase_order_payment_id: 0 }),
            backfillAdvancePayments: jest.fn().mockResolvedValue(0),
            findPayableForPurchaseOrder: jest.fn().mockResolvedValue(null),
            applyPoPaymentToApBalance: jest.fn().mockResolvedValue({ applied: false }),
            createFromEvent: jest.fn(),
            upsertPayableForReception: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(PurchaseOrdersService);
    prismaService = module.get(StorePrismaService);
    stockLevelManager = module.get(StockLevelManager);
    costingService = module.get(CostingService);
    costingMethodResolver = module.get(CostingMethodResolverService);
    auditService = module.get(AuditService);
    eventEmitter = module.get(EventEmitter2);

    jest
      .spyOn(RequestContextService, 'getOrganizationId')
      .mockReturnValue(ORG_ID);
    jest
      .spyOn(RequestContextService, 'getStoreId')
      .mockReturnValue(STORE_ID);
    jest
      .spyOn(RequestContextService, 'getUserId')
      .mockReturnValue(USER_ID);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('invokes costing BEFORE updateStock (call order)', async () => {
    await service.receive(PO_ID, baseDto);

    expect(costingService.calculateCostOnReceipt).toHaveBeenCalledTimes(1);
    expect(stockLevelManager.updateStock).toHaveBeenCalledTimes(1);

    const costingOrder =
      costingService.calculateCostOnReceipt.mock.invocationCallOrder[0];
    const updateStockOrder =
      stockLevelManager.updateStock.mock.invocationCallOrder[0];

    // Strictly less-than: costing must run first so weighted-average reads
    // see PRE-receipt stock — this is the whole point of Step 3.
    expect(costingOrder).toBeLessThan(updateStockOrder);
  });

  it('passes unit_cost = new_cost_per_unit and movement_unit_cost = receipt cost to updateStock', async () => {
    // costing returns new_cost_per_unit=1500; receipt unit_cost=2000.
    await service.receive(PO_ID, baseDto);

    expect(stockLevelManager.updateStock).toHaveBeenCalledWith(
      expect.objectContaining({
        product_id: PRODUCT_ID,
        location_id: LOCATION_ID,
        quantity_change: 10,
        movement_type: 'stock_in',
        unit_cost: 1500, // costResult.new_cost_per_unit
        movement_unit_cost: 2000, // receipt cost (orderItem.unit_cost)
        source_module: 'pop_purchase',
        create_movement: true,
      }),
      expect.anything(),
    );
  });

  it('resolves the costing method via CostingMethodResolverService with (org, store)', async () => {
    await service.receive(PO_ID, baseDto);

    expect(costingMethodResolver.resolveCostingMethod).toHaveBeenCalledWith(
      ORG_ID,
      STORE_ID,
    );

    // The resolved method is forwarded to costing.
    expect(costingService.calculateCostOnReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ costing_method: 'weighted_average' }),
      expect.anything(),
    );
  });

  it('does not abort receipt when costing throws; updateStock still runs with receipt cost as fallback', async () => {
    costingService.calculateCostOnReceipt.mockRejectedValueOnce(
      new Error('boom'),
    );

    await expect(service.receive(PO_ID, baseDto)).resolves.toBeDefined();

    expect(stockLevelManager.updateStock).toHaveBeenCalledTimes(1);
    expect(stockLevelManager.updateStock).toHaveBeenCalledWith(
      expect.objectContaining({
        unit_cost: 2000, // fallback to receiptUnitCost
        movement_unit_cost: 2000, // also receiptUnitCost
      }),
      expect.anything(),
    );
  });

  /**
   * QUI-486 — un producto con variantes solo se compra por variante.
   *
   * Sin el guard la recepción NO falla — es peor: `getOrCreateStockLevel`
   * recrea la fila base que `enforceStockLevelsMode` había borrado, y
   * `syncProductStock` la excluye del agregado (`product_variant_id: { not:
   * null }` cuando hay variantes). Las unidades se pagan y quedan en una fila
   * que nadie lee: invisibles en catálogo e invendibles.
   *
   * El control de no-regresión vive en los 4 tests de arriba: `mockOrderItem`
   * usa `product_variant_id: null` sobre un producto SIN variantes y debe
   * seguir recibiendo exactamente igual.
   */
  describe('QUI-486: línea base sobre producto con variantes', () => {
    const VARIANT_PRODUCT_NAME = 'Smart TV LG 50" NanoCell';

    /**
     * Reemplaza el `$transaction` del arnés por uno cuyo `product_variants`
     * SÍ devuelve variantes para `PRODUCT_ID`. Solo se mockean los modelos que
     * el guard toca: revienta antes de llegar al resto del flujo.
     */
    const mockTxWithVariantProduct = () => {
      (prismaService.$transaction as jest.Mock).mockImplementation(
        async (callback: any) =>
          callback({
            purchase_order_items: {
              findMany: jest.fn().mockResolvedValue([
                {
                  id: PO_ITEM_ID,
                  quantity_ordered: 10,
                  quantity_received: 0,
                  product_id: PRODUCT_ID,
                  product_variant_id: null,
                },
              ]),
            },
            product_variants: {
              findMany: jest
                .fn()
                .mockResolvedValue([{ product_id: PRODUCT_ID }]),
            },
            products: {
              findMany: jest
                .fn()
                .mockResolvedValue([
                  { id: PRODUCT_ID, name: VARIANT_PRODUCT_NAME },
                ]),
            },
            purchase_orders: {
              // `status` es obligatorio: receive() valida la transición de
              // estado antes de mirar las líneas, así que sin él la orden se
              // rechazaría por PO_STATUS_001 y nunca llegaría al guard de
              // variantes que este bloque ejercita.
              findUnique: jest.fn().mockResolvedValue({
                id: PO_ID,
                status: 'approved',
                order_number: 'PO-20260706-216',
              }),
            },
            purchase_order_receptions: { create: jest.fn() },
            purchase_order_reception_items: { create: jest.fn() },
          }),
      );
    };

    it('receive() rechaza con PO_VARIANT_001 y no crea la recepción', async () => {
      mockTxWithVariantProduct();

      await expect(service.receive(PO_ID, baseDto)).rejects.toMatchObject({
        errorCode: 'PO_VARIANT_001',
      });

      // Nada se movió: ni stock, ni costeo, ni recepción.
      expect(stockLevelManager.updateStock).not.toHaveBeenCalled();
      expect(costingService.calculateCostOnReceipt).not.toHaveBeenCalled();
    });

    it('receive() nombra la orden y la salida en el mensaje de error', async () => {
      mockTxWithVariantProduct();

      await expect(service.receive(PO_ID, baseDto)).rejects.toMatchObject({
        response: {
          error_code: 'PO_VARIANT_001',
          message: expect.stringContaining('PO-20260706-216'),
        },
      });
    });

    it('create() rechaza la línea base antes de persistir la orden', async () => {
      const createTx = {
        product_variants: {
          findMany: jest.fn().mockResolvedValue([{ product_id: PRODUCT_ID }]),
        },
        products: {
          findMany: jest
            .fn()
            .mockResolvedValue([{ id: PRODUCT_ID, name: VARIANT_PRODUCT_NAME }]),
        },
        purchase_orders: { create: jest.fn() },
      };
      (prismaService.$transaction as jest.Mock).mockImplementation(
        async (callback: any) => callback(createTx),
      );

      await expect(
        service.create({
          location_id: LOCATION_ID,
          items: [{ product_id: PRODUCT_ID, quantity: 6, unit_cost: 230000 }],
        } as any),
      ).rejects.toMatchObject({ errorCode: 'PO_VARIANT_001' });

      expect(createTx.purchase_orders.create).not.toHaveBeenCalled();
    });

    it('create() deja pasar la línea base cuando el producto NO tiene variantes', async () => {
      const productVariantsFindMany = jest.fn().mockResolvedValue([]);
      (prismaService.$transaction as jest.Mock).mockImplementation(
        async (callback: any) => {
          // El guard consulta y no encuentra variantes; el flujo continúa y
          // falla más adelante por mocks ausentes — eso basta para probar que
          // el guard NO fue el que cortó.
          await callback({
            product_variants: { findMany: productVariantsFindMany },
          }).catch(() => undefined);
        },
      );

      await service
        .create({
          location_id: LOCATION_ID,
          items: [{ product_id: PRODUCT_ID, quantity: 6, unit_cost: 230000 }],
        } as any)
        .catch(() => undefined);

      expect(productVariantsFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { product_id: { in: [PRODUCT_ID] } },
        }),
      );
    });
  });

  /**
   * Ciclo de vida de la orden de compra.
   *
   * `approve()` y `cancel()` eran `prisma.update()` ciegos que jamás leían el
   * estado actual: se podía aprobar una orden ya recibida, o cancelarla dejando
   * la mercancía dentro y la recepción viva. `remove()` borraba físicamente una
   * orden recibida. Cada transición ilegal declarada en `VALID_TRANSITIONS`
   * tiene aquí una prueba que la bloquea.
   */
  describe('ciclo de vida: VALID_TRANSITIONS es la fuente de la verdad', () => {
    /** Monta una transacción cuyo findUnique devuelve la orden en `status`. */
    const mockOrderInStatus = (status: string) => {
      const tx = {
        purchase_orders: {
          findUnique: jest.fn().mockResolvedValue({
            id: PO_ID,
            status,
            order_number: 'PO-TEST-LIFECYCLE',
          }),
          update: jest.fn().mockResolvedValue({ id: PO_ID, status }),
          delete: jest.fn().mockResolvedValue({ id: PO_ID }),
        },
        purchase_order_items: {
          findMany: jest.fn().mockResolvedValue([]),
          deleteMany: jest.fn(),
          create: jest.fn(),
        },
        product_variants: { findMany: jest.fn().mockResolvedValue([]) },
      };
      (prismaService.$transaction as jest.Mock).mockImplementation(
        async (callback: any) => callback(tx),
      );
      return tx;
    };

    it('cancel() sobre una orden RECIBIDA responde PO_CANCEL_RECEIVED_001 y no la toca', async () => {
      const tx = mockOrderInStatus('received');

      await expect(service.cancel(PO_ID)).rejects.toMatchObject({
        errorCode: 'PO_CANCEL_RECEIVED_001',
      });

      expect(tx.purchase_orders.update).not.toHaveBeenCalled();
    });

    it('cancel() sobre una orden PARCIAL también se bloquea: ya hay mercancía dentro', async () => {
      const tx = mockOrderInStatus('partial');

      await expect(service.cancel(PO_ID)).rejects.toMatchObject({
        errorCode: 'PO_CANCEL_RECEIVED_001',
      });

      expect(tx.purchase_orders.update).not.toHaveBeenCalled();
    });

    it('el mensaje de cancelación bloqueada nombra la devolución a proveedor', async () => {
      mockOrderInStatus('received');

      await expect(service.cancel(PO_ID)).rejects.toMatchObject({
        response: {
          message: expect.stringContaining('devolución a proveedor'),
        },
      });
    });

    it('cancel() sobre un BORRADOR sí procede', async () => {
      const tx = mockOrderInStatus('draft');

      await service.cancel(PO_ID);

      expect(tx.purchase_orders.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'cancelled' }),
        }),
      );
    });

    it('approve() sobre una orden ya RECIBIDA responde PO_STATUS_001', async () => {
      const tx = mockOrderInStatus('received');

      await expect(service.approve(PO_ID)).rejects.toMatchObject({
        errorCode: 'PO_STATUS_001',
      });

      expect(tx.purchase_orders.update).not.toHaveBeenCalled();
    });

    it('approve() sobre una orden CANCELADA responde PO_STATUS_001', async () => {
      const tx = mockOrderInStatus('cancelled');

      await expect(service.approve(PO_ID)).rejects.toMatchObject({
        errorCode: 'PO_STATUS_001',
      });

      expect(tx.purchase_orders.update).not.toHaveBeenCalled();
    });

    it('approve() sobre un BORRADOR sí procede', async () => {
      const tx = mockOrderInStatus('draft');

      await service.approve(PO_ID);

      expect(tx.purchase_orders.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'approved' }),
        }),
      );
    });

    it('update() sobre una orden APROBADA responde PO_STATUS_002 y no reescribe líneas', async () => {
      const tx = mockOrderInStatus('approved');

      await expect(
        service.update(PO_ID, { notes: 'nuevo' } as any),
      ).rejects.toMatchObject({ errorCode: 'PO_STATUS_002' });

      expect(tx.purchase_orders.update).not.toHaveBeenCalled();
      expect(tx.purchase_order_items.deleteMany).not.toHaveBeenCalled();
    });

    it('update() de un BORRADOR persiste las líneas de verdad', async () => {
      const tx = mockOrderInStatus('draft');

      await service.update(PO_ID, {
        items: [{ product_id: PRODUCT_ID, quantity: 12, unit_price: 2000 }],
      } as any);

      // El bug original: `items` viajaba dentro de `data` y Prisma abortaba con
      // "Unknown argument `items`" en TODA llamada a update().
      expect(tx.purchase_order_items.deleteMany).toHaveBeenCalledWith({
        where: { purchase_order_id: PO_ID },
      });
      expect(tx.purchase_order_items.create).toHaveBeenCalledTimes(1);
      const dataArg = (tx.purchase_orders.update as jest.Mock).mock.calls[0][0]
        .data;
      expect(dataArg).not.toHaveProperty('items');
      expect(dataArg.subtotal_amount).toBe(24000);
    });

    it('remove() sobre una orden RECIBIDA responde PO_STATUS_002 y no borra nada', async () => {
      const tx = mockOrderInStatus('received');

      await expect(service.remove(PO_ID)).rejects.toMatchObject({
        errorCode: 'PO_STATUS_002',
      });

      expect(tx.purchase_orders.delete).not.toHaveBeenCalled();
    });

    it('remove() sobre un BORRADOR sí borra', async () => {
      const tx = mockOrderInStatus('draft');

      await service.remove(PO_ID);

      expect(tx.purchase_orders.delete).toHaveBeenCalledWith({
        where: { id: PO_ID },
      });
    });

    it('receive() sobre una orden CANCELADA responde PO_STATUS_001', async () => {
      const tx = mockOrderInStatus('cancelled');

      await expect(service.receive(PO_ID, baseDto)).rejects.toMatchObject({
        errorCode: 'PO_STATUS_001',
      });

      expect(stockLevelManager.updateStock).not.toHaveBeenCalled();
    });

    it('receive() sobre una orden inexistente responde PO_FIND_001, no un error de líneas', async () => {
      (prismaService.$transaction as jest.Mock).mockImplementation(
        async (callback: any) =>
          callback({
            purchase_orders: { findUnique: jest.fn().mockResolvedValue(null) },
            purchase_order_items: { findMany: jest.fn() },
          }),
      );

      await expect(service.receive(999999, baseDto)).rejects.toMatchObject({
        errorCode: 'PO_FIND_001',
      });
    });
  });

  /**
   * D2 — partial receptions must post proportional accounting entries with
   * a distinct `reception_id` as `source_id` each time (see
   * vendix-auto-entries skill: "Purchase order receptions are the special
   * case"), and the FINAL reception must post the exact remainder
   * (`total_amount - alreadyPosted`), not another independently-computed
   * proportion, so the sum across all receptions matches `total_amount`
   * with no drift.
   */
  describe('D2: proportional accounting entries for partial receptions', () => {
    // Order: 10 units @ unit_cost=170 => order_subtotal = 1700.
    // total_amount intentionally left equal to subtotal (no header-level
    // discount/tax/shipping) so the proration math is easy to assert.
    const PARTIAL_PO_ITEM = {
      id: PO_ITEM_ID,
      product_id: PRODUCT_ID,
      product_variant_id: null,
      unit_cost: 170,
      quantity_ordered: 10,
      quantity_received: 0,
      batch_number: null,
      manufacturing_date: null,
      expiration_date: null,
    };

    const PARTIAL_PO_TOTAL = 1700;

    /**
     * Rebuilds the service with a tx mock whose `purchase_orders.findUnique`
     * / `.update` reflect the order's cumulative `quantity_received` BEFORE
     * and AFTER a given reception, and whose `purchase_order_receptions.create`
     * returns a distinct id per call. `priorTotalDebit` simulates what
     * accounting already posted for earlier receptions of this same order
     * (read via `this.prisma.accounting_entries.findMany`, OUTSIDE the tx).
     */
    function buildServiceForReception(opts: {
      receptionId: number;
      quantityReceivedBefore: number;
      quantityReceivedNow: number;
      priorReceptionIds: number[];
      priorTotalDebit: number;
    }) {
      const {
        receptionId,
        quantityReceivedBefore,
        quantityReceivedNow,
        priorReceptionIds,
        priorTotalDebit,
      } = opts;

      const quantityReceivedAfter =
        quantityReceivedBefore + quantityReceivedNow;
      const allItemsReceived =
        quantityReceivedAfter >= PARTIAL_PO_ITEM.quantity_ordered;

      // NOTE: the real service reads `tx.purchase_orders.findUnique` AFTER
      // `tx.purchase_order_items.update({ quantity_received: { increment } })`
      // has already run (see receive() around line 1026-1042), so the
      // `quantity_received` this mock returns must already reflect THIS
      // reception's contribution (quantityReceivedAfter), not the
      // pre-reception value — otherwise `all_items_received` and the
      // received-batch-subtotal proration would be computed one reception
      // behind.
      const orderFetchedInsideTx = {
        id: PO_ID,
        organization_id: ORG_ID,
        location_id: LOCATION_ID,
        status: quantityReceivedBefore > 0 ? 'partial' : 'approved',
        order_number: 'PO-TEST-0002',
        total_amount: PARTIAL_PO_TOTAL,
        location: { id: LOCATION_ID, store_id: STORE_ID },
        purchase_order_items: [
          { ...PARTIAL_PO_ITEM, quantity_received: quantityReceivedAfter },
        ],
      };

      const buildTxMock = () => ({
        purchase_order_receptions: {
          create: jest.fn().mockResolvedValue({ id: receptionId }),
        },
        purchase_order_reception_items: {
          create: jest.fn().mockResolvedValue({}),
        },
        purchase_order_items: {
          update: jest.fn().mockResolvedValue({}),
          // FASE 0/FASE 2 — over-receipt guard (receive() :1420).
          findMany: jest.fn().mockResolvedValue([
            {
              id: mockOrderItem.id,
              quantity_ordered: mockOrderItem.quantity_ordered,
              quantity_received: 0,
              product_id: PRODUCT_ID,
              product_variant_id: null,
            },
          ]),
        },
        // QUI-486 — producto de control SIN variantes.
        product_variants: {
          findMany: jest.fn().mockResolvedValue([]),
        },
        products: {
          findFirst: jest.fn().mockResolvedValue({
            id: PRODUCT_ID,
            is_ingredient: false,
            purchase_to_stock_factor: null,
            stock_uom_id: null,
            purchase_uom_id: null,
          }),
          findUnique: jest.fn().mockResolvedValue({
            base_price: 3000,
            profit_margin: 20,
          }),
          update: jest.fn().mockResolvedValue({}),
        },
        purchase_orders: {
          findUnique: jest.fn().mockResolvedValue(orderFetchedInsideTx),
          update: jest.fn().mockResolvedValue({
            id: PO_ID,
            organization_id: ORG_ID,
            total_amount: PARTIAL_PO_TOTAL,
            status: allItemsReceived ? 'received' : 'partial',
            suppliers: null,
            location: orderFetchedInsideTx.location,
            purchase_order_items: [
              {
                ...PARTIAL_PO_ITEM,
                quantity_received: quantityReceivedAfter,
                products: null,
                product_variants: null,
              },
            ],
          }),
        },
      });

      const mockPrismaService = {
        $transaction: jest.fn().mockImplementation(async (callback: any) => {
          return callback(buildTxMock());
        }),
        purchase_order_receptions: {
          findMany: jest.fn().mockResolvedValue(
            priorReceptionIds.map((prId) => ({ id: prId })),
          ),
        },
        accounting_entries: {
          findMany: jest.fn().mockResolvedValue(
            priorReceptionIds.length > 0
              ? [{ total_debit: priorTotalDebit }]
              : [],
          ),
        },
      };

      return mockPrismaService;
    }

    async function createServiceWithPrisma(mockPrismaService: any) {
      const mockStockLevelManager = {
        updateStock: jest.fn().mockResolvedValue({
          stock_level: { id: 1 },
          transaction: { id: 1 },
          previous_quantity: 0,
        }),
      };
      const mockCostingService = {
        calculateCostOnReceipt: jest.fn().mockResolvedValue({
          new_cost_per_unit: 170,
          previous_cost_per_unit: 170,
        }),
      };
      const mockCostingMethodResolver = {
        resolveCostingMethod: jest.fn().mockResolvedValue('weighted_average'),
      };
      const mockAuditService = { logCustom: jest.fn().mockResolvedValue(undefined) };
      const mockSerialNumbersService = {
        populatePoolOnReceipt: jest.fn().mockResolvedValue(undefined),
      };
      const mockSerialEnforcement = {
        isSerialized: jest.fn().mockResolvedValue(false),
        assertParityForLocation: jest.fn().mockResolvedValue(undefined),
      };
      const mockEventEmitter = { emit: jest.fn() };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          PurchaseOrdersService,
          { provide: StorePrismaService, useValue: mockPrismaService },
          { provide: StockLevelManager, useValue: mockStockLevelManager },
          { provide: CostingService, useValue: mockCostingService },
          {
            provide: CostingMethodResolverService,
            useValue: mockCostingMethodResolver,
          },
          {
            provide: InventorySerialNumbersService,
            useValue: mockSerialNumbersService,
          },
          {
            provide: SerialNumberEnforcementService,
            useValue: mockSerialEnforcement,
          },
          { provide: AuditService, useValue: mockAuditService },
          { provide: S3Service, useValue: {} as any },
          { provide: SettingsService, useValue: {} as any },
          {
            provide: FiscalScopeService,
            useValue: {
              resolveAccountingEntityForFiscal: jest
                .fn()
                .mockResolvedValue({ id: 1 }),
            },
          },
          { provide: EventEmitter2, useValue: mockEventEmitter },
          {
            provide: AccountsPayableService,
            useValue: {
              mirrorPoPaymentToAp: jest.fn().mockResolvedValue({ ap_payment_id: 0 }),
              mirrorApPaymentToPo: jest.fn().mockResolvedValue({ purchase_order_payment_id: 0 }),
              backfillAdvancePayments: jest.fn().mockResolvedValue(0),
              findPayableForPurchaseOrder: jest.fn().mockResolvedValue(null),
              applyPoPaymentToApBalance: jest.fn().mockResolvedValue({ applied: false }),
              createFromEvent: jest.fn(),
              upsertPayableForReception: jest.fn(),
            },
          },
        ],
      }).compile();

      return {
        service: module.get<PurchaseOrdersService>(PurchaseOrdersService),
        eventEmitter: module.get(EventEmitter2) as jest.Mocked<EventEmitter2>,
      };
    }

    it('posts a proportional entry for a partial reception, then the exact remainder on the final reception, with distinct reception ids and no drift', async () => {
      // ---- Reception 1: partial, 4 of 10 units received ----
      const prisma1 = buildServiceForReception({
        receptionId: 101,
        quantityReceivedBefore: 0,
        quantityReceivedNow: 4,
        priorReceptionIds: [],
        priorTotalDebit: 0,
      });
      const { service: service1, eventEmitter: emitter1 } =
        await createServiceWithPrisma(prisma1);

      jest.spyOn(RequestContextService, 'getOrganizationId').mockReturnValue(ORG_ID);
      jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(STORE_ID);
      jest.spyOn(RequestContextService, 'getUserId').mockReturnValue(USER_ID);

      await service1.receive(PO_ID, {
        items: [{ id: PO_ITEM_ID, quantity_received: 4 }],
        notes: 'Partial receipt 1/2',
      } as any);

      expect(emitter1.emit).toHaveBeenCalledTimes(1);
      const [event1Name, event1Payload] = emitter1.emit.mock.calls[0];
      expect(event1Name).toBe('purchase_order.received');
      expect(event1Payload.reception_id).toBe(101);
      // Proportional share: 4/10 of 1700 = 680.
      expect(event1Payload.total_amount).toBeCloseTo(680, 2);

      // ---- Reception 2: final, remaining 6 of 10 units ----
      // Accounting already posted 680 for reception #101.
      const prisma2 = buildServiceForReception({
        receptionId: 102,
        quantityReceivedBefore: 4,
        quantityReceivedNow: 6,
        priorReceptionIds: [101],
        priorTotalDebit: event1Payload.total_amount,
      });
      const { service: service2, eventEmitter: emitter2 } =
        await createServiceWithPrisma(prisma2);

      await service2.receive(PO_ID, {
        items: [{ id: PO_ITEM_ID, quantity_received: 6 }],
        notes: 'Partial receipt 2/2 (final)',
      } as any);

      expect(emitter2.emit).toHaveBeenCalledTimes(1);
      const [event2Name, event2Payload] = emitter2.emit.mock.calls[0];
      expect(event2Name).toBe('purchase_order.received');
      expect(event2Payload.reception_id).toBe(102);

      // Distinct source_id (reception_id) between the two receptions — this
      // is what keeps createAutoEntry's (source_type, source_id) duplicate
      // guard from treating reception #2 as a repeat of reception #1.
      expect(event2Payload.reception_id).not.toBe(event1Payload.reception_id);

      // Final reception posts the exact remainder (total - alreadyPosted),
      // NOT an independently-computed 6/10 proportion.
      const expectedRemainder =
        PARTIAL_PO_TOTAL - event1Payload.total_amount;
      expect(event2Payload.total_amount).toBeCloseTo(expectedRemainder, 2);

      // No drift: the sum of both emitted amounts equals total_amount
      // exactly (to the cent).
      const sum = event1Payload.total_amount + event2Payload.total_amount;
      expect(sum).toBeCloseTo(PARTIAL_PO_TOTAL, 2);
    });

    it('does not lose cents across 3 uneven partial receptions (rounding drift)', async () => {
      // Order total 1699.99 split across three receptions of 3/4/3 units
      // (10 total) so 1699.99/10 does not divide evenly per-unit — forces
      // rounding at each proration step.
      const ROUNDING_PO_TOTAL = 1699.99;

      function buildRoundingServiceForReception(opts: {
        receptionId: number;
        quantityReceivedBefore: number;
        quantityReceivedNow: number;
        priorReceptionIds: number[];
        priorTotalDebit: number;
      }) {
        const {
          receptionId,
          quantityReceivedBefore,
          quantityReceivedNow,
          priorReceptionIds,
          priorTotalDebit,
        } = opts;
        const quantityReceivedAfter =
          quantityReceivedBefore + quantityReceivedNow;
        const allItemsReceived = quantityReceivedAfter >= 10;

        const roundingPoItem = {
          id: PO_ITEM_ID,
          product_id: PRODUCT_ID,
          product_variant_id: null,
          unit_cost: 169.999, // 10 units => subtotal 1699.99
          quantity_ordered: 10,
          quantity_received: 0,
          batch_number: null,
          manufacturing_date: null,
          expiration_date: null,
        };

        // Same note as buildServiceForReception above: the real service reads
        // this AFTER incrementing quantity_received for THIS reception, so
        // it must already carry quantityReceivedAfter.
        const orderFetchedInsideTx = {
          id: PO_ID,
          organization_id: ORG_ID,
          location_id: LOCATION_ID,
          status: quantityReceivedBefore > 0 ? 'partial' : 'approved',
          order_number: 'PO-TEST-0003',
          total_amount: ROUNDING_PO_TOTAL,
          location: { id: LOCATION_ID, store_id: STORE_ID },
          purchase_order_items: [
            { ...roundingPoItem, quantity_received: quantityReceivedAfter },
          ],
        };

        const buildTxMock = () => ({
          purchase_order_receptions: {
            create: jest.fn().mockResolvedValue({ id: receptionId }),
          },
          purchase_order_reception_items: {
            create: jest.fn().mockResolvedValue({}),
          },
          purchase_order_items: {
            update: jest.fn().mockResolvedValue({}),
            // FASE 0/FASE 2 — over-receipt guard (receive() :1420).
            findMany: jest.fn().mockResolvedValue([
              {
                id: mockOrderItem.id,
                quantity_ordered: mockOrderItem.quantity_ordered,
                quantity_received: 0,
                product_id: PRODUCT_ID,
                product_variant_id: null,
              },
            ]),
          },
          // QUI-486 — producto de control SIN variantes.
          product_variants: {
            findMany: jest.fn().mockResolvedValue([]),
          },
          products: {
            findFirst: jest.fn().mockResolvedValue({
              id: PRODUCT_ID,
              is_ingredient: false,
              purchase_to_stock_factor: null,
              stock_uom_id: null,
              purchase_uom_id: null,
            }),
            findUnique: jest.fn().mockResolvedValue({
              base_price: 3000,
              profit_margin: 20,
            }),
            update: jest.fn().mockResolvedValue({}),
          },
          purchase_orders: {
            findUnique: jest.fn().mockResolvedValue(orderFetchedInsideTx),
            update: jest.fn().mockResolvedValue({
              id: PO_ID,
              organization_id: ORG_ID,
              total_amount: ROUNDING_PO_TOTAL,
              status: allItemsReceived ? 'received' : 'partial',
              suppliers: null,
              location: orderFetchedInsideTx.location,
              purchase_order_items: [
                {
                  ...roundingPoItem,
                  quantity_received: quantityReceivedAfter,
                  products: null,
                  product_variants: null,
                },
              ],
            }),
          },
        });

        return {
          $transaction: jest.fn().mockImplementation(async (callback: any) => {
            return callback(buildTxMock());
          }),
          purchase_order_receptions: {
            findMany: jest.fn().mockResolvedValue(
              priorReceptionIds.map((prId) => ({ id: prId })),
            ),
          },
          accounting_entries: {
            findMany: jest.fn().mockResolvedValue(
              priorReceptionIds.length > 0
                ? [{ total_debit: priorTotalDebit }]
                : [],
            ),
          },
        };
      }

      const emittedAmounts: number[] = [];
      let alreadyPosted = 0;
      const receptionIds: number[] = [];
      const batches = [
        { receptionId: 201, before: 0, now: 3 },
        { receptionId: 202, before: 3, now: 4 },
        { receptionId: 203, before: 7, now: 3 },
      ];

      for (const batch of batches) {
        const mockPrismaService = buildRoundingServiceForReception({
          receptionId: batch.receptionId,
          quantityReceivedBefore: batch.before,
          quantityReceivedNow: batch.now,
          priorReceptionIds: [...receptionIds],
          priorTotalDebit: alreadyPosted,
        });
        const { service, eventEmitter: emitter } =
          await createServiceWithPrisma(mockPrismaService);

        jest.spyOn(RequestContextService, 'getOrganizationId').mockReturnValue(ORG_ID);
        jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(STORE_ID);
        jest.spyOn(RequestContextService, 'getUserId').mockReturnValue(USER_ID);

        await service.receive(PO_ID, {
          items: [{ id: PO_ITEM_ID, quantity_received: batch.now }],
          notes: `Partial receipt (reception ${batch.receptionId})`,
        } as any);

        expect(emitter.emit).toHaveBeenCalledTimes(1);
        const [, payload] = emitter.emit.mock.calls[0];
        expect(payload.reception_id).toBe(batch.receptionId);

        emittedAmounts.push(payload.total_amount);
        alreadyPosted += payload.total_amount;
        receptionIds.push(batch.receptionId);
      }

      // All three reception ids must be distinct source_ids.
      expect(new Set(receptionIds).size).toBe(3);

      // The sum of all emitted amounts must equal total_amount exactly —
      // no cents lost or duplicated to rounding across partial receptions.
      const total = emittedAmounts.reduce((a, b) => a + b, 0);
      expect(total).toBeCloseTo(ROUNDING_PO_TOTAL, 2);
    });
  });
});

/**
 * F3 — getCostPreview() ↔ receive() cost parity.
 *
 * The POP preview modal must show the SAME per-stock-unit cost that receive()
 * persists to stock_levels.cost_per_unit. The preview historically computed
 * with the NET cost and mixed purchase/stock units, so for a non-IVA-responsible
 * tenant (O-49) with a UoM factor the modal's new_cost_per_unit diverged from
 * the recorded cost by (among other things) the IVA factor — the observed 1.19.
 *
 * These tests lock the two alignment rules getCostPreview now mirrors from
 * receive():
 *   1. IVA capitalization — O-48 responsible → NET; O-49 non-responsible →
 *      capitalize the per-unit IVA into the cost.
 *   2. UoM conversion — convert the incoming purchase-unit quantity + cost to
 *      minimum stock units via purchase_to_stock_factor, then compute CPP in
 *      stock units (globalStock/globalCostPerUnit are already in stock units).
 */
describe('PurchaseOrdersService.getCostPreview()', () => {
  const ORG_ID = 1;
  const STORE_ID = 10;
  const LOCATION_ID = 999;
  const PRODUCT_ID = 555;

  async function buildPreviewService(opts: {
    taxResponsibilities: string[];
    isIngredient: boolean;
    purchaseToStockFactor: number | null;
    scopedAggregate: { quantity: number; cost_per_unit: number };
    costingMethod?: string;
  }) {
    const {
      taxResponsibilities,
      isIngredient,
      purchaseToStockFactor,
      scopedAggregate,
      costingMethod = 'weighted_average',
    } = opts;

    const mockPrismaService = {
      inventory_locations: {
        findUnique: jest.fn().mockResolvedValue({ store_id: STORE_ID }),
      },
      stock_levels: {
        // Per-location display snapshot only — does NOT feed the CPP (that
        // comes from getScopedStockAggregate below).
        findFirst: jest.fn().mockResolvedValue({
          quantity_on_hand: scopedAggregate.quantity,
          cost_per_unit: scopedAggregate.cost_per_unit,
        }),
      },
      products: {
        // resolveUoMConversion reads this (is_ingredient + factor).
        findFirst: jest.fn().mockResolvedValue({
          id: PRODUCT_ID,
          is_ingredient: isIngredient,
          purchase_to_stock_factor: purchaseToStockFactor,
          stock_uom_id: null,
          purchase_uom_id: null,
        }),
        // name + pricing snapshot for the margin UX.
        findUnique: jest.fn().mockResolvedValue({
          name: 'Insumo Test',
          base_price: 3000,
          profit_margin: 20,
        }),
      },
      product_variants: { findUnique: jest.fn() },
    };

    const mockCostingService = {
      getScopedStockAggregate: jest.fn().mockResolvedValue(scopedAggregate),
    };
    const mockCostingMethodResolver = {
      resolveCostingMethod: jest.fn().mockResolvedValue(costingMethod),
    };
    const mockSettingsService = {
      // isVatResponsible reads tax_responsibilities from here (RUT casilla 53).
      getFiscalData: jest.fn().mockResolvedValue({
        tax_responsibilities: taxResponsibilities,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchaseOrdersService,
        { provide: StorePrismaService, useValue: mockPrismaService },
        { provide: StockLevelManager, useValue: {} as any },
        { provide: CostingService, useValue: mockCostingService },
        {
          provide: CostingMethodResolverService,
          useValue: mockCostingMethodResolver,
        },
        { provide: InventorySerialNumbersService, useValue: {} as any },
        { provide: SerialNumberEnforcementService, useValue: {} as any },
        { provide: AuditService, useValue: {} as any },
        { provide: S3Service, useValue: {} as any },
        { provide: SettingsService, useValue: mockSettingsService },
        {
          provide: FiscalScopeService,
          useValue: {
            resolveAccountingEntityForFiscal: jest
              .fn()
              .mockResolvedValue({ id: 1 }),
          },
        },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        {
          provide: AccountsPayableService,
          useValue: {
            mirrorPoPaymentToAp: jest.fn().mockResolvedValue({ ap_payment_id: 0 }),
            mirrorApPaymentToPo: jest.fn().mockResolvedValue({ purchase_order_payment_id: 0 }),
            backfillAdvancePayments: jest.fn().mockResolvedValue(0),
            findPayableForPurchaseOrder: jest.fn().mockResolvedValue(null),
            applyPoPaymentToApBalance: jest.fn().mockResolvedValue({ applied: false }),
            createFromEvent: jest.fn(),
            upsertPayableForReception: jest.fn(),
          },
        },
      ],
    }).compile();

    jest
      .spyOn(RequestContextService, 'getOrganizationId')
      .mockReturnValue(ORG_ID);
    jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(STORE_ID);

    return module.get<PurchaseOrdersService>(PurchaseOrdersService);
  }

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('O-49 + IVA 19% + purchase_to_stock_factor 2: new_cost_per_unit equals what receive() persists (no 1.19 drift)', async () => {
    // Operator buys 10 bottles @ 1000 net (IVA added on top, 19%).
    //   deriveLineTax → net/u = 1000, tax/u = 190.
    // O-49 non-responsible → costUnit = 1000 + 190 = 1190 (capitalized).
    // UoM factor 2 (1 bottle = 2 stock units) →
    //   stockQty = 10 × 2 = 20, stockUnitCost = 1190 / 2 = 595.
    // Existing scoped stock 20 units @ 595 (same basis) →
    //   CPP = (20×595 + 20×595) / 40 = 595.
    //
    // This is EXACTLY what receive() seals: orderItem.unit_cost = 1000 (net),
    // tax_amount = 190×10, qty_ordered = 10 → ivaPerUnit = 190 → costUnit =
    // 1190 → receiptUnitCost = 595 → calculateCostOnReceipt(20 @ 595) = 595.
    //
    // The pre-fix preview used the NET cost AND mixed purchase/stock units:
    //   (20×595 + 10×1000) / (20 + 10) = 730 — the divergent value the modal
    //   showed. Parity target is 595.
    const service = await buildPreviewService({
      taxResponsibilities: ['O-13'], // non-empty, no O-48 ⇒ O-49
      isIngredient: true,
      purchaseToStockFactor: 2,
      scopedAggregate: { quantity: 20, cost_per_unit: 595 },
    });

    const result = await service.getCostPreview({
      location_id: LOCATION_ID,
      prices_include_tax: false,
      items: [
        { product_id: PRODUCT_ID, quantity: 10, unit_cost: 1000, tax_rate: 19 },
      ],
    } as any);

    expect(result.items).toHaveLength(1);
    // Parity: matches the cost_per_unit receive() would persist (595), NOT the
    // pre-fix 730.
    expect(result.items[0].new_cost_per_unit).toBe(595);
  });

  it('capitalizes IVA for O-49 but excludes it for O-48 — the exact 1.19 divergence disappears', async () => {
    // Retail product (factor 1), stock at zero (reactivation) so the CPP is the
    // incoming stock-unit cost directly, isolating the IVA treatment.
    // unit_cost = 1000 net, IVA 19%.
    const previewFor = (taxResponsibilities: string[]) =>
      buildPreviewService({
        taxResponsibilities,
        isIngredient: false,
        purchaseToStockFactor: null,
        scopedAggregate: { quantity: 0, cost_per_unit: 0 },
      });

    const item = {
      product_id: PRODUCT_ID,
      quantity: 5,
      unit_cost: 1000,
      tax_rate: 19,
    };

    const nonResponsible = await previewFor(['O-13']); // O-49
    const nonRespResult = await nonResponsible.getCostPreview({
      location_id: LOCATION_ID,
      prices_include_tax: false,
      items: [item],
    } as any);

    const responsible = await previewFor(['O-48']); // O-48
    const respResult = await responsible.getCostPreview({
      location_id: LOCATION_ID,
      prices_include_tax: false,
      items: [item],
    } as any);

    const o49 = nonRespResult.items[0].new_cost_per_unit;
    const o48 = respResult.items[0].new_cost_per_unit;

    // O-49 capitalizes the 19% IVA into cost; O-48 keeps it net.
    expect(o49).toBe(1190);
    expect(o48).toBe(1000);
    // The whole point of F3: the divergence is EXACTLY the IVA factor, and it
    // now lives on the correct (persist) side, not as a preview-vs-persist gap.
    expect(o49 / o48).toBeCloseTo(1.19, 5);
  });

  /**
   * QUI-648 — el margen del preview se mide contra el costo llevado a la escala
   * del precio. `new_cost_per_unit` es el costo de la unidad MÍNIMA de stock;
   * `current_base_price` cubre `price_unit_quantity` de esas unidades.
   */
  describe('QUI-648: resulting_margin respeta price_unit_quantity', () => {
    /**
     * Igual que `buildPreviewService` pero con control sobre el snapshot de
     * precio del producto (incluida su escala de publicación).
     */
    async function buildScaledPreviewService(pricing: {
      base_price: number;
      profit_margin: number;
      price_unit_quantity: number | null;
    }) {
      const mockPrismaService = {
        inventory_locations: {
          findUnique: jest.fn().mockResolvedValue({ store_id: STORE_ID }),
        },
        stock_levels: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
        products: {
          findFirst: jest.fn().mockResolvedValue({
            id: PRODUCT_ID,
            is_ingredient: false,
            purchase_to_stock_factor: null,
            stock_uom_id: null,
            purchase_uom_id: null,
          }),
          findUnique: jest.fn().mockResolvedValue({
            name: 'Cable de cobre',
            ...pricing,
          }),
        },
        product_variants: { findUnique: jest.fn() },
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          PurchaseOrdersService,
          { provide: StorePrismaService, useValue: mockPrismaService },
          { provide: StockLevelManager, useValue: {} as any },
          {
            provide: CostingService,
            useValue: {
              // Stock en cero ⇒ reactivación ⇒ el CPP es el costo entrante
              // directo, lo que aísla la aritmética del margen.
              getScopedStockAggregate: jest
                .fn()
                .mockResolvedValue({ quantity: 0, cost_per_unit: 0 }),
            },
          },
          {
            provide: CostingMethodResolverService,
            useValue: {
              resolveCostingMethod: jest
                .fn()
                .mockResolvedValue('weighted_average'),
            },
          },
          { provide: InventorySerialNumbersService, useValue: {} as any },
          { provide: SerialNumberEnforcementService, useValue: {} as any },
          { provide: AuditService, useValue: {} as any },
          { provide: S3Service, useValue: {} as any },
          {
            provide: SettingsService,
            useValue: {
              // O-48 responsable ⇒ el costo queda NETO y no se capitaliza IVA.
              getFiscalData: jest
                .fn()
                .mockResolvedValue({ tax_responsibilities: ['O-48'] }),
            },
          },
          {
            provide: FiscalScopeService,
            useValue: {
              resolveAccountingEntityForFiscal: jest
                .fn()
                .mockResolvedValue({ id: 1 }),
            },
          },
          { provide: EventEmitter2, useValue: { emit: jest.fn() } },
          {
            provide: AccountsPayableService,
            useValue: {
              findPayableForPurchaseOrder: jest.fn().mockResolvedValue(null),
            },
          },
        ],
      }).compile();

      jest
        .spyOn(RequestContextService, 'getOrganizationId')
        .mockReturnValue(ORG_ID);
      jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(STORE_ID);

      return module.get<PurchaseOrdersService>(PurchaseOrdersService);
    }

    const previewFor = async (service: PurchaseOrdersService, cost: number) =>
      (
        await service.getCostPreview({
          location_id: LOCATION_ID,
          prices_include_tax: false,
          items: [{ product_id: PRODUCT_ID, quantity: 100, unit_cost: cost }],
        } as any)
      ).items[0];

    it('escala 1: el margen sale del cociente histórico (no-regresión)', async () => {
      // base 3000, costo 2000 ⇒ (3000-2000)/2000 = 50%.
      const service = await buildScaledPreviewService({
        base_price: 3000,
        profit_margin: 20,
        price_unit_quantity: 1,
      });

      const item = await previewFor(service, 2000);

      expect(item.new_cost_per_unit).toBe(2000);
      expect(item.resulting_margin).toBe(50);
      expect(item.price_unit_quantity).toBe(1);
    });

    it('price_unit_quantity nulo se comporta igual que escala 1 (no-regresión)', async () => {
      const service = await buildScaledPreviewService({
        base_price: 3000,
        profit_margin: 20,
        price_unit_quantity: null,
      });

      const item = await previewFor(service, 2000);

      expect(item.resulting_margin).toBe(50);
      expect(item.price_unit_quantity).toBe(1);
    });

    it('escala 1000: mide el precio del metro contra el costo del metro', async () => {
      // Cable publicado a $5.000 el metro (1.000 mm), costo $3,50 el milímetro
      // ⇒ costo del metro = $3.500 ⇒ margen = (5000-3500)/3500 = 42,86%.
      // Sin la escala el cociente daba (5000-3,5)/3,5 = 142.757,14%.
      const service = await buildScaledPreviewService({
        base_price: 5000,
        profit_margin: 40,
        price_unit_quantity: 1000,
      });

      const item = await previewFor(service, 3.5);

      // El costo mostrado sigue siendo el de la unidad mínima: es el que la
      // recepción sella en stock_levels (paridad preview↔persist de F3).
      expect(item.new_cost_per_unit).toBe(3.5);
      expect(item.price_unit_quantity).toBe(1000);
      expect(item.resulting_margin).toBeCloseTo(42.86, 2);
      // Y sobre todo: NO el número de la mezcla de escalas.
      expect(item.resulting_margin).not.toBeCloseTo(142757.14, 2);
    });
  });
});

/**
 * QUI-648 — `resolvePricingAfterReceipt` es la función pura que decide qué
 * `base_price` / `profit_margin` deja escrito una recepción de mercancía.
 *
 * El defecto que estas pruebas clavan: `costPrice` llega en unidad MÍNIMA de
 * stock (lo escribe `CostingService` como valor / quantity_on_hand) y
 * `base_price` vale por `price_unit_quantity` de esas unidades. Compararlos
 * derecho no solo publicaba un margen falso — con un margen pinneado derivaba
 * el precio DESDE el costo del milímetro y dejaba el cable a $4,90 el metro.
 */
describe('PurchaseOrdersService.resolvePricingAfterReceipt()', () => {
  const resolve = PurchaseOrdersService.resolvePricingAfterReceipt;

  describe('no-regresión: escala ausente / 1 / 0 / no numérica', () => {
    it('sin priceUnitQuantity: cost-anchor da el cociente de siempre', () => {
      // (3000 - 2000) / 2000 = 50%.
      expect(resolve({ costPrice: 2000, existingBasePrice: 3000 })).toEqual({
        basePrice: 3000,
        profitMargin: 50,
      });
    });

    it('priceUnitQuantity = 1: margen pinneado deriva el precio como siempre', () => {
      expect(
        resolve({
          costPrice: 2000,
          existingBasePrice: 3000,
          newProfitMargin: 25,
          priceUnitQuantity: 1,
        }),
      ).toEqual({ basePrice: 2500, profitMargin: 25 });
    });

    it('priceUnitQuantity = 0, null o NaN colapsan a la aritmética histórica', () => {
      const historic = resolve({ costPrice: 2000, existingBasePrice: 3000 });
      for (const scale of [0, null, undefined, NaN as unknown as number]) {
        expect(
          resolve({
            costPrice: 2000,
            existingBasePrice: 3000,
            priceUnitQuantity: scale,
          }),
        ).toEqual(historic);
      }
    });

    it('costo 0 sigue devolviendo margen 0 sin dividir por cero', () => {
      expect(
        resolve({
          costPrice: 0,
          existingBasePrice: 3000,
          priceUnitQuantity: 1000,
        }),
      ).toEqual({ basePrice: 3000, profitMargin: 0 });
    });
  });

  describe('escala 1000: el cable vendido por metro', () => {
    // Costo $3,50 por milímetro ⇒ $3.500 por metro. Precio $5.000 el metro.
    const COST_PER_MM = 3.5;
    const SCALE = 1000;

    it('cost-anchor: conserva el precio y publica el margen del metro', () => {
      const result = resolve({
        costPrice: COST_PER_MM,
        existingBasePrice: 5000,
        priceUnitQuantity: SCALE,
      });

      // (5000 - 3500) / 3500 = 42,857…% → 42.86.
      expect(result.basePrice).toBe(5000);
      expect(result.profitMargin).toBeCloseTo(42.86, 2);
      // El número que publicaba el bug.
      expect(result.profitMargin).not.toBeCloseTo(142757.14, 2);
    });

    it('margen pinneado: el precio derivado es el del METRO, no el del milímetro', () => {
      const result = resolve({
        costPrice: COST_PER_MM,
        existingBasePrice: 5000,
        newProfitMargin: 40,
        priceUnitQuantity: SCALE,
      });

      // 3500 × 1,40 = 4900 — el precio del metro.
      expect(result).toEqual({ basePrice: 4900, profitMargin: 40 });
      // Antes del fix: 3,5 × 1,40 = 4,90. Recibir mercancía regalaba el cable.
      expect(result.basePrice).not.toBe(4.9);
    });

    it('precio explícito gana y el margen se deriva de él (cost-anchor QUI-425)', () => {
      const result = resolve({
        costPrice: COST_PER_MM,
        existingBasePrice: 5000,
        newBasePrice: 7000,
        // El margen enviado se ignora a propósito: el precio explícito manda.
        newProfitMargin: 999,
        priceUnitQuantity: SCALE,
      });

      // (7000 - 3500) / 3500 = 100%.
      expect(result).toEqual({ basePrice: 7000, profitMargin: 100 });
    });

    it('precio explícito con escala 1 conserva el comportamiento histórico', () => {
      expect(
        resolve({
          costPrice: 3500,
          existingBasePrice: 5000,
          newBasePrice: 7000,
          priceUnitQuantity: 1,
        }),
      ).toEqual({ basePrice: 7000, profitMargin: 100 });
    });
  });
});
