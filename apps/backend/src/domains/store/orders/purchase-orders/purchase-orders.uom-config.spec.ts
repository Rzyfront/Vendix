import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PurchaseVatContributionService } from './purchase-vat-contribution.service';
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
import { VatResponsibilityService } from '@common/helpers/vat-responsibility.helper';

import { VendixHttpException } from '@common/errors/vendix-http.exception';
import { ErrorCodes } from '@common/errors/error-codes';

/**
 * S13d (product-sale-unit-consolidation) — las órdenes de compra del POP
 * configuran las unidades del producto con las MISMAS reglas del editor.
 */
describe('PurchaseOrdersService — configuración de unidades desde el POP (S13d)', () => {
  const STORE_ID = 10;
  const LOCATION_ID = 999;
  const SUPPLIER_ID = 77;
  const PRODUCT_ID = 555;

  const G = { id: 1, code: 'g', name: 'Gramo', dimension: 'mass', factor_to_base: 1, is_active: true, is_stock_eligible: true };
  const KG = { id: 2, code: 'kg', name: 'Kilogramo', dimension: 'mass', factor_to_base: 1000, is_active: true, is_stock_eligible: true };
  const LB = { id: 3, code: 'lb', name: 'Libra', dimension: 'mass', factor_to_base: 500, is_active: true, is_stock_eligible: true };
  const CATALOG = [G, KG, LB];

  let service: PurchaseOrdersService;
  let prismaService: any;
  let stockLevelManager: { updateStock: jest.Mock; convertStockUom: jest.Mock };

  beforeEach(async () => {
    prismaService = { $transaction: jest.fn() };
    stockLevelManager = {
      updateStock: jest.fn(),
      convertStockUom: jest.fn().mockResolvedValue({ factor: 1000 }),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchaseOrdersService,
        { provide: PurchaseVatContributionService, useValue: { reserve: jest.fn() } },
        { provide: StorePrismaService, useValue: prismaService },
        { provide: StockLevelManager, useValue: stockLevelManager },
        { provide: CostingService, useValue: {} },
        { provide: CostingMethodResolverService, useValue: {} },
        { provide: InventorySerialNumbersService, useValue: {} },
        { provide: SerialNumberEnforcementService, useValue: {} },
        { provide: AuditService, useValue: { log: jest.fn(), logCustom: jest.fn() } },
        { provide: S3Service, useValue: {} as any },
        { provide: SettingsService, useValue: { getFiscalData: jest.fn().mockResolvedValue({ tax_responsibilities: ['O-48'] }) } },
        { provide: FiscalScopeService, useValue: {} },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: AccountsPayableService, useValue: {} as any },
        VatResponsibilityService,
      ],
    }).compile();

    service = module.get(PurchaseOrdersService);
    jest.spyOn(RequestContextService, 'getOrganizationId').mockReturnValue(1);
    jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(STORE_ID);
    jest.spyOn(RequestContextService, 'getUserId').mockReturnValue(7);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  /** tx con catálogo de unidades y un producto existente configurable. */
  function mockTx(
    product: Record<string, unknown> | null = {
      id: PRODUCT_ID,
      stock_uom_id: null,
      purchase_uom_id: null,
      pricing_type: 'unit',
    },
    counts: { levels?: number } = {},
  ) {
    return {
      product_variants: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
      products: {
        findMany: jest.fn().mockResolvedValue([]),
        // Por SKU / código de barras no hay nada (producto nuevo); por id sí.
        findFirst: jest.fn().mockImplementation(async ({ where }: any) =>
          where?.id ? product : null,
        ),
        create: jest.fn().mockResolvedValue({ id: PRODUCT_ID }),
        update: jest.fn().mockResolvedValue({}),
      },
      units_of_measure: {
        findMany: jest.fn().mockImplementation(async ({ where }: any) =>
          CATALOG.filter((u) => where.id.in.includes(u.id)),
        ),
        findFirst: jest.fn().mockImplementation(async ({ where }: any) =>
          CATALOG.find((u) => u.id === where.id) ?? null,
        ),
      },
      product_sale_uoms: {
        deleteMany: jest.fn().mockResolvedValue({}),
        createMany: jest.fn().mockResolvedValue({}),
      },
      stock_levels: { count: jest.fn().mockResolvedValue(counts.levels ?? 0) },
      inventory_cost_layers: { count: jest.fn().mockResolvedValue(0) },
      inventory_batches: { count: jest.fn().mockResolvedValue(0) },
      recipe_items: { count: jest.fn().mockResolvedValue(0) },
      inventory_locations: {
        findFirst: jest.fn().mockResolvedValue({ id: LOCATION_ID }),
        findUnique: jest.fn().mockResolvedValue({ store_id: STORE_ID }),
      },
      suppliers: { findFirst: jest.fn().mockResolvedValue({ id: SUPPLIER_ID }) },
      purchase_orders: {
        create: jest.fn().mockImplementation(({ data }: any) =>
          Promise.resolve({
            id: 4242,
            order_number: data.order_number,
            organization_id: 1,
            location: { store_id: STORE_ID },
            status: data.status,
          }),
        ),
      },
      purchase_order_payment_schedules: { create: jest.fn() },
    };
  }

  const runCreate = async (tx: any, itemExtra: Record<string, unknown>, newProduct = false) => {
    prismaService.$transaction.mockImplementation((cb: any) => cb(tx));
    const item = newProduct
      ? { product_name: 'Lomo ahumado', sku: 'LOMO-1', quantity: 10, unit_price: 24000 }
      : { product_id: PRODUCT_ID, quantity: 10, unit_price: 24000 };
    return service.create({
      supplier_id: SUPPLIER_ID,
      location_id: LOCATION_ID,
      items: [{ ...item, ...itemExtra }],
    } as any);
  };

  const KG_PRINCIPAL = [
    { uom_id: KG.id, is_principal: true },
    { uom_id: G.id },
    { uom_id: LB.id },
  ];

  const expectViolation = async (promise: Promise<unknown>, violationCode: string, message: RegExp) => {
    const error: any = await promise.then(
      () => null,
      (e) => e,
    );
    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.errorCode).toBe(ErrorCodes.PROD_VALIDATE_001.code);
    expect(error.getResponse().details?.violation_code).toBe(violationCode);
    expect(error.message).toMatch(message);
  };

  it('(a) producto NUEVO con sale_uoms [kg principal, g, lb], stock g y peso → escala 1000 y filas sincronizadas', async () => {
    const tx = mockTx();
    await runCreate(
      tx,
      {
        pricing_type: 'weight',
        stock_uom_id: G.id,
        purchase_uom_id: KG.id,
        sale_uoms: KG_PRINCIPAL,
        scale_code: 77,
      },
      true,
    );

    expect(tx.products.create).toHaveBeenCalledTimes(1);
    const update = tx.products.update.mock.calls.find(
      ([args]: any) => args.data.price_unit_quantity !== undefined,
    )![0];
    expect(update.where).toEqual({ id: PRODUCT_ID });
    expect(update.data).toMatchObject({
      stock_uom_id: G.id,
      purchase_uom_id: KG.id,
      pricing_type: 'weight',
      price_unit_quantity: 1000,
      scale_code: 77,
      purchase_to_stock_factor: 1000,
    });
    expect(tx.product_sale_uoms.deleteMany).toHaveBeenCalledWith({ where: { product_id: PRODUCT_ID } });
    expect(tx.product_sale_uoms.createMany.mock.calls[0][0].data).toEqual([
      { product_id: PRODUCT_ID, uom_id: KG.id, is_principal: true },
      { product_id: PRODUCT_ID, uom_id: G.id, is_principal: false },
      { product_id: PRODUCT_ID, uom_id: LB.id, is_principal: false },
    ]);
  });

  it('(b) stock en kg con principal kg → rechaza MEASURED_STOCK_NOT_BASE «el stock debe contarse en g»', async () => {
    const tx = mockTx();
    await expectViolation(
      runCreate(tx, { pricing_type: 'weight', stock_uom_id: KG.id, sale_uoms: [{ uom_id: KG.id, is_principal: true }] }),
      'MEASURED_STOCK_NOT_BASE',
      /el stock debe contarse en g/,
    );
    expect(tx.product_sale_uoms.createMany).not.toHaveBeenCalled();
  });

  it('(c) pricing_type unit con principal kg → rechaza PRICING_TYPE_MISMATCH «debe venderse por peso»', async () => {
    const tx = mockTx();
    await expectViolation(
      runCreate(tx, { pricing_type: 'unit', stock_uom_id: G.id, sale_uoms: KG_PRINCIPAL }),
      'PRICING_TYPE_MISMATCH',
      /debe venderse por peso/,
    );
    expect(tx.product_sale_uoms.createMany).not.toHaveBeenCalled();
  });

  it('(d) existente con datos que cambia la unidad de stock: sin convert → PROD_UOM_CONVERSION_REQUIRED con details', async () => {
    const tx = mockTx(
      { id: PRODUCT_ID, stock_uom_id: KG.id, purchase_uom_id: KG.id, pricing_type: 'weight' },
      { levels: 3 },
    );
    const error: any = await runCreate(tx, {
      pricing_type: 'weight',
      stock_uom_id: G.id,
      sale_uoms: KG_PRINCIPAL,
    }).then(
      () => null,
      (e) => e,
    );
    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.errorCode).toBe(ErrorCodes.PROD_UOM_CONVERSION_REQUIRED.code);
    expect(error.getResponse().details).toMatchObject({
      from_uom_code: 'kg',
      to_uom_code: 'g',
      factor: 1000,
      stock_levels: 3,
      cost_layers: 0,
      batches: 0,
      recipe_items: 0,
    });
    expect(stockLevelManager.convertStockUom).not.toHaveBeenCalled();
  });

  it("(d) con stock_uom_conversion 'convert' llama convertStockUom en la misma transacción", async () => {
    const tx = mockTx(
      { id: PRODUCT_ID, stock_uom_id: KG.id, purchase_uom_id: KG.id, pricing_type: 'weight' },
      { levels: 3 },
    );
    await runCreate(tx, {
      pricing_type: 'weight',
      stock_uom_id: G.id,
      sale_uoms: KG_PRINCIPAL,
      stock_uom_conversion: 'convert',
    });
    expect(stockLevelManager.convertStockUom).toHaveBeenCalledWith({
      product_id: PRODUCT_ID,
      from_uom_id: KG.id,
      to_uom_id: G.id,
      user_id: 7,
      tx,
    });
  });

  it('(e) línea SIN sale_uoms: no valida ni escribe unidades (comportamiento histórico)', async () => {
    const tx = mockTx();
    await runCreate(tx, { pricing_type: 'unit', stock_uom_id: KG.id });
    expect(tx.product_sale_uoms.deleteMany).not.toHaveBeenCalled();
    expect(tx.product_sale_uoms.createMany).not.toHaveBeenCalled();
    expect(tx.units_of_measure.findMany).not.toHaveBeenCalled();
    expect(tx.products.update).not.toHaveBeenCalled();
    expect(stockLevelManager.convertStockUom).not.toHaveBeenCalled();
    expect(tx.purchase_orders.create).toHaveBeenCalledTimes(1);
  });

  it('(e) sale_uoms [] (pieza simple) limpia las filas y deja el producto simple como el editor', async () => {
    const tx = mockTx();
    // Mismo payload que el editor envía al elegir «Pieza / unidad».
    await runCreate(tx, {
      pricing_type: 'unit',
      stock_uom_id: null,
      purchase_uom_id: null,
      sale_uoms: [],
    });
    expect(tx.product_sale_uoms.deleteMany).toHaveBeenCalledWith({ where: { product_id: PRODUCT_ID } });
    expect(tx.product_sale_uoms.createMany).not.toHaveBeenCalled();
    const write = tx.products.update.mock.calls
      .map(([a]: any) => a.data)
      .find((d: any) => d.price_unit_quantity !== undefined);
    // Un producto que venía por kg (escala 1000) no puede quedar cobrando por
    // 1000 unidades al pasar a pieza.
    expect(write).toEqual(
      expect.objectContaining({
        price_unit_quantity: 1,
        stock_uom_id: null,
        purchase_uom_id: null,
        pricing_type: 'unit',
      }),
    );
  });

  it('(f) recibir 10 kg con stock en g entra como 10000 unidades de stock', async () => {
    const tx = mockTx();
    await runCreate(tx, {
      pricing_type: 'weight',
      stock_uom_id: G.id,
      purchase_uom_id: KG.id,
      sale_uoms: KG_PRINCIPAL,
    });
    const persistedFactor = tx.products.update.mock.calls
      .map(([a]: any) => a.data.purchase_to_stock_factor)
      .find((f: unknown) => f !== undefined);
    expect(persistedFactor).toBe(1000);

    const { stockQuantity, stockUnitCost } = (PurchaseOrdersService as any).applyUoMConversion(
      { is_ingredient: false, purchase_to_stock_factor: persistedFactor, stock_uom_id: G.id, purchase_uom_id: KG.id },
      10,
      24000,
    );
    expect(stockQuantity).toBe(10000);
    expect(stockUnitCost).toBe(24);
  });
});
