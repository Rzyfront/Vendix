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
});
