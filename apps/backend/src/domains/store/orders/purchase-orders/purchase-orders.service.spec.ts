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
    status: 'pending',
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
      purchase_order_items: { update: jest.fn().mockResolvedValue({}) },
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
        status: quantityReceivedBefore > 0 ? 'partial' : 'pending',
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
        purchase_order_items: { update: jest.fn().mockResolvedValue({}) },
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
          status: quantityReceivedBefore > 0 ? 'partial' : 'pending',
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
          purchase_order_items: { update: jest.fn().mockResolvedValue({}) },
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
});
