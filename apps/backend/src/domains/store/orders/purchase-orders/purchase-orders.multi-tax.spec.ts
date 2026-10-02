import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PurchaseVatContributionService } from './purchase-vat-contribution.service';
import { validateFreightAndTaxHeader } from './dto/create-purchase-order.dto';
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

/**
 * QUI-855 (paso 4) — backend de órdenes de compra sobre el kernel multi-impuesto
 * `resolvePurchaseLineTaxes`: create (filas hijas + columnas legacy), receive
 * O-48 (INC capitalizado, IVA descontable), emit_total y buildPurchaseTaxGroups.
 */
describe('PurchaseOrdersService — multi-impuesto de compra (QUI-855)', () => {
  const ORG_ID = 1;
  const STORE_ID = 10;
  const USER_ID = 7;
  const LOCATION_ID = 999;
  const SUPPLIER_ID = 77;
  const PRODUCT_ID = 555;
  const PO_ID = 42;
  const PO_ITEM_ID = 100;

  let service: PurchaseOrdersService;
  let prismaService: any;
  let eventEmitter: { emit: jest.Mock };
  let purchaseVatContribution: { reserve: jest.Mock };
  let costingService: { calculateCostOnReceipt: jest.Mock };
  let stockLevelManager: { updateStock: jest.Mock };

  beforeEach(async () => {
    prismaService = {
      $transaction: jest.fn(),
      invoices: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(async ({ data }: any) => {
          return { id: 881, ...data };
        }),
      },
      purchase_order_receptions: { findMany: jest.fn().mockResolvedValue([]) },
      accounting_entries: { findMany: jest.fn().mockResolvedValue([]) },
    };
    eventEmitter = { emit: jest.fn() };
    purchaseVatContribution = { reserve: jest.fn().mockResolvedValue({ id: 880 }) };
    costingService = {
      calculateCostOnReceipt: jest.fn().mockResolvedValue({
        new_cost_per_unit: 1080,
        previous_cost_per_unit: 0,
      }),
    };
    stockLevelManager = {
      updateStock: jest.fn().mockResolvedValue({
        stock_level: { id: 1 },
        transaction: { id: 1 },
        previous_quantity: 0,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchaseOrdersService,
        { provide: PurchaseVatContributionService, useValue: purchaseVatContribution },
        { provide: StorePrismaService, useValue: prismaService },
        { provide: StockLevelManager, useValue: stockLevelManager },
        { provide: CostingService, useValue: costingService },
        {
          provide: CostingMethodResolverService,
          useValue: {
            resolveCostingMethod: jest.fn().mockResolvedValue('fifo'),
          },
        },
        {
          provide: InventorySerialNumbersService,
          useValue: { populatePoolOnReceipt: jest.fn() },
        },
        {
          provide: SerialNumberEnforcementService,
          useValue: {
            isSerialized: jest.fn().mockResolvedValue(false),
            assertParityForLocation: jest.fn(),
          },
        },
        {
          provide: AuditService,
          useValue: {
            log: jest.fn().mockResolvedValue(undefined),
            logCustom: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: S3Service, useValue: {} as any },
        {
          provide: SettingsService,
          useValue: {
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
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: AccountsPayableService, useValue: {} as any },
        VatResponsibilityService,
      ],
    }).compile();

    service = module.get(PurchaseOrdersService);
    jest
      .spyOn(RequestContextService, 'getOrganizationId')
      .mockReturnValue(ORG_ID);
    jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(STORE_ID);
    jest.spyOn(RequestContextService, 'getUserId').mockReturnValue(USER_ID);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  // ---------------------------------------------------------------- create
  function mockCreateTx() {
    return {
      product_variants: { findMany: jest.fn().mockResolvedValue([]) },
      products: { findMany: jest.fn().mockResolvedValue([]) },
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
            organization_id: ORG_ID,
            location: { store_id: STORE_ID },
            status: data.status,
          }),
        ),
      },
      purchase_order_payment_schedules: { create: jest.fn() },
    };
  }

  const runCreate = async (items: any[], extra: any = {}) => {
    const tx = mockCreateTx();
    prismaService.$transaction.mockImplementation((cb: any) => cb(tx));
    await service.create({
      supplier_id: SUPPLIER_ID,
      location_id: LOCATION_ID,
      items,
      ...extra,
    } as any);
    return tx.purchase_orders.create.mock.calls[0][0].data;
  };

  const IVA = { tax_type: 'iva', tax_rate: 19, tax_name: 'IVA 19%' };
  const INC = { tax_type: 'inc', tax_rate: 8, tax_name: 'INC 8%' };
  const line = (taxes: any[]) => ({
    product_id: PRODUCT_ID,
    quantity: 5,
    unit_price: 1270,
    prices_include_tax: true,
    taxes,
  });

  it('create: IVA 19 % + INC 8 % incluidos, 5 u × $1.270 → línea y 2 filas hijas', async () => {
    const data = await runCreate([line([INC, IVA])]);
    const created = data.purchase_order_items.create[0];

    expect(created.unit_cost).toBe(1000);
    expect(created.unit_price_net).toBe(1000);
    expect(created.tax_rate).toBe(19);
    expect(created.tax_type).toBe('iva');
    expect(created.tax_amount).toBe(1350);

    const rows = created.purchase_order_item_taxes.create;
    expect(rows).toHaveLength(2);
    const iva = rows.find((r: any) => r.tax_type === 'iva');
    const inc = rows.find((r: any) => r.tax_type === 'inc');
    expect(iva).toMatchObject({
      tax_rate: 19,
      taxable_amount: 5000,
      tax_amount: 950,
      add_to_cost: false,
      is_inclusive: true,
      calc_mode: 'percent',
    });
    expect(inc).toMatchObject({
      tax_rate: 8,
      taxable_amount: 5000,
      tax_amount: 400,
      add_to_cost: true,
    });
    // total = neto 5000 + impuestos 1350
    expect(data.subtotal_amount).toBe(5000);
    expect(data.tax_amount).toBe(1350);
    expect(data.total_amount).toBe(6350);
  });

  it('create: el orden de `taxes` en el request no cambia las filas resueltas', async () => {
    const a = await runCreate([line([INC, IVA])]);
    const b = await runCreate([line([IVA, INC])]);
    expect(a.purchase_order_items.create[0].purchase_order_item_taxes).toEqual(
      b.purchase_order_items.create[0].purchase_order_item_taxes,
    );
    expect(b.purchase_order_items.create[0].tax_type).toBe('iva');
    expect(b.purchase_order_items.create[0].tax_rate).toBe(19);
  });

  it('create: sin IVA pero con INC ⇒ tax_type del primero en cálculo y tax_rate 0', async () => {
    const data = await runCreate([line([INC])]);
    const created = data.purchase_order_items.create[0];
    expect(created.tax_type).toBe('inc');
    expect(created.tax_rate).toBe(0);
    expect(created.purchase_order_item_taxes.create).toHaveLength(1);
  });

  it('create: línea legacy (sin taxes) IVA 19 % exclusivo ⇒ neto = precio, IVA 19 %', async () => {
    const data = await runCreate([
      { product_id: PRODUCT_ID, quantity: 2, unit_price: 1000, tax_rate: 19 },
    ]);
    const created = data.purchase_order_items.create[0];
    expect(created.unit_cost).toBe(1000);
    expect(created.tax_amount).toBe(380);
    expect(created.tax_rate).toBe(19);
    expect(created.tax_type).toBe('iva');
    const rows = created.purchase_order_item_taxes.create;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tax_type: 'iva',
      tax_rate: 19,
      taxable_amount: 2000,
      tax_amount: 380,
      is_inclusive: false,
    });
    expect(data.total_amount).toBe(2380);
  });

  it('create: dos impuestos del mismo tipo en una línea se rechazan', async () => {
    const tx = mockCreateTx();
    prismaService.$transaction.mockImplementation((cb: any) => cb(tx));
    await expect(
      service.create({
        supplier_id: SUPPLIER_ID,
        location_id: LOCATION_ID,
        items: [line([IVA, { ...IVA, tax_rate: 5 }])],
      } as any),
    ).rejects.toThrow(/un solo impuesto/i);
  });

  it('create: impuesto porcentual sin tax_rate se rechaza', async () => {
    const tx = mockCreateTx();
    prismaService.$transaction.mockImplementation((cb: any) => cb(tx));
    await expect(
      service.create({
        supplier_id: SUPPLIER_ID,
        location_id: LOCATION_ID,
        items: [line([{ tax_type: 'iva' }])],
      } as any),
    ).rejects.toThrow(/tax_rate/);
  });

  // --------------------------------------------------------------- receive
  describe('receive() O-48 con IVA 19 % + INC 8 % incluidos', () => {
    const orderItem = {
      id: PO_ITEM_ID,
      product_id: PRODUCT_ID,
      product_variant_id: null,
      unit_cost: 1000,
      quantity_ordered: 5,
      quantity_received: 5,
      tax_rate: 19,
      tax_type: 'iva',
      tax_amount: 1350,
      deductible_tax_amount: null,
      capitalized_tax_amount: null,
      batch_number: null,
      manufacturing_date: null,
      expiration_date: null,
      purchase_order_item_taxes: [
        { tax_type: 'iva', taxable_amount: 5000, tax_amount: 950, add_to_cost: false },
        { tax_type: 'inc', taxable_amount: 5000, tax_amount: 400, add_to_cost: true },
      ],
    };
    const purchaseOrder = {
      id: PO_ID,
      organization_id: ORG_ID,
      location_id: LOCATION_ID,
      status: 'approved',
      order_number: 'PO-MT-1',
      total_amount: 6350,
      location: { id: LOCATION_ID, store_id: STORE_ID },
      purchase_order_items: [orderItem],
    };

    function mockReceiveTx(sealed: { itemUpdates: any[] }) {
      return {
        purchase_order_receptions: { create: jest.fn().mockResolvedValue({ id: 1 }) },
        purchase_order_reception_items: { create: jest.fn().mockResolvedValue({}) },
        purchase_order_items: {
          update: jest.fn().mockImplementation((args: any) => {
            sealed.itemUpdates.push(args);
            return Promise.resolve({});
          }),
          findMany: jest.fn().mockResolvedValue([
            {
              id: PO_ITEM_ID,
              quantity_ordered: 5,
              quantity_received: 0,
              product_id: PRODUCT_ID,
              product_variant_id: null,
            },
          ]),
        },
        product_variants: { findMany: jest.fn().mockResolvedValue([]) },
        products: {
          findFirst: jest.fn().mockResolvedValue({
            id: PRODUCT_ID,
            is_ingredient: false,
            purchase_to_stock_factor: null,
            stock_uom_id: null,
            purchase_uom_id: null,
          }),
          findUnique: jest
            .fn()
            .mockResolvedValue({ base_price: 3000, profit_margin: 20 }),
          update: jest.fn().mockResolvedValue({}),
        },
        purchase_orders: {
          findUnique: jest.fn().mockResolvedValue(purchaseOrder),
          update: jest.fn().mockResolvedValue({
            ...purchaseOrder,
            status: 'received',
            suppliers: null,
            purchase_order_items: [
              {
                ...orderItem,
                deductible_tax_amount: 950,
                capitalized_tax_amount: 400,
                products: null,
                product_variants: null,
              },
            ],
          }),
        },
      };
    }

    it('costUnit FIFO 1080, deducible 950, capitalizado 400, emit 5400 y subledger 6350', async () => {
      const sealed = { itemUpdates: [] as any[] };
      const tx = mockReceiveTx(sealed);
      prismaService.$transaction.mockImplementation((cb: any) => cb(tx));

      await service.receive(PO_ID, {
        items: [{ id: PO_ITEM_ID, quantity_received: 5 }],
      } as any);

      // Costo FIFO por unidad = neto 1000 + INC capitalizado 400/5.
      expect(costingService.calculateCostOnReceipt).toHaveBeenCalledWith(
        expect.objectContaining({ unit_cost: 1080, quantity_received: 5 }),
        expect.anything(),
      );
      const sealedArgs = sealed.itemUpdates.find(
        (u) => u.data.deductible_tax_amount !== undefined,
      );
      expect(sealedArgs.data.deductible_tax_amount).toBe(950);
      expect(sealedArgs.data.capitalized_tax_amount).toBe(400);

      const received = eventEmitter.emit.mock.calls.find(
        (c) => c[0] === 'purchase_order.received',
      );
      expect(received).toBeDefined();
      expect(received![1].total_amount).toBe(5400);
      expect(received![1].gross_reception_share).toBe(6350);
    });

    it('reserves deductible VAT before legacy document projection and event emission', async () => {
      const sealed = { itemUpdates: [] as any[] };
      const tx = mockReceiveTx(sealed);
      tx.purchase_orders.update.mockResolvedValue({
        ...purchaseOrder,
        status: 'received',
        supplier_id: SUPPLIER_ID,
        supplier_invoice_number: null,
        supplier_invoice_date: null,
        suppliers: { id: SUPPLIER_ID, name: 'Supplier 77', tax_id: '900111222' },
        purchase_order_items: [{
          ...orderItem,
          deductible_tax_amount: 950,
          capitalized_tax_amount: 400,
          products: null,
          product_variants: null,
        }],
      });
      prismaService.$transaction.mockImplementation((cb: any) => cb(tx));
      const order: string[] = [];
      purchaseVatContribution.reserve.mockImplementation(async (input: any) => {
        order.push('reserve');
        expect(input).toMatchObject({
          organization_id: ORG_ID,
          accounting_entity_id: 1,
          store_id: STORE_ID,
          purchase_order_id: PO_ID,
          reception_id: 1,
          supplier_id: SUPPLIER_ID,
          supplier_tax_id_snapshot: '900111222',
          invoice_number_snapshot: null,
          invoice_issue_date_snapshot: null,
          currency: 'COP',
          net_amount: 5000,
          iva_amount: 950,
          tax_groups: [{ tax_rate: 19, tax_type: 'iva', taxable_amount: 5000, tax_amount: 950 }],
        });
        return { id: 880 };
      });
      prismaService.invoices.findFirst.mockImplementation(async () => {
        order.push('projection-check');
        return null;
      });
      prismaService.invoices.create.mockImplementation(async () => {
        order.push('projection');
        return { id: 881 };
      });
      eventEmitter.emit.mockImplementation((eventName) => {
        if (eventName === 'purchase.vat_recognized') order.push('vat-event');
      });

      await service.receive(PO_ID, {
        items: [{ id: PO_ITEM_ID, quantity_received: 5 }],
      } as any);

      expect(order).toEqual(['reserve', 'projection-check', 'projection', 'vat-event']);
      expect(eventEmitter.emit).toHaveBeenCalledWith('purchase.vat_recognized', expect.objectContaining({
        invoice_id: 881,
        contribution_id: 880,
      }));
    });

    it('does not project or emit recognized VAT when reservation fails', async () => {
      const sealed = { itemUpdates: [] as any[] };
      const tx = mockReceiveTx(sealed);
      tx.purchase_orders.update.mockResolvedValue({
        ...purchaseOrder,
        status: 'received',
        supplier_id: SUPPLIER_ID,
        suppliers: { id: SUPPLIER_ID, name: 'Supplier 77', tax_id: '900111222' },
        purchase_order_items: [{
          ...orderItem,
          deductible_tax_amount: 950,
          capitalized_tax_amount: 400,
          products: null,
          product_variants: null,
        }],
      });
      prismaService.$transaction.mockImplementation((cb: any) => cb(tx));
      purchaseVatContribution.reserve.mockRejectedValueOnce(new Error('reservation unavailable'));

      await service.receive(PO_ID, {
        items: [{ id: PO_ITEM_ID, quantity_received: 5 }],
      } as any);

      expect(prismaService.invoices.findFirst).not.toHaveBeenCalled();
      expect(prismaService.invoices.create).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalledWith('purchase.vat_recognized', expect.anything());
    });

    it('línea legacy sin filas hijas con tax_type inc ⇒ todo el impuesto se capitaliza', async () => {
      const sealed = { itemUpdates: [] as any[] };
      const tx = mockReceiveTx(sealed);
      const legacyItem = {
        ...orderItem,
        tax_rate: 8,
        tax_type: 'inc',
        tax_amount: 400,
        purchase_order_item_taxes: [],
      };
      tx.purchase_orders.findUnique = jest.fn().mockResolvedValue({
        ...purchaseOrder,
        purchase_order_items: [legacyItem],
      });
      prismaService.$transaction.mockImplementation((cb: any) => cb(tx));

      await service.receive(PO_ID, {
        items: [{ id: PO_ITEM_ID, quantity_received: 5 }],
      } as any);

      expect(costingService.calculateCostOnReceipt).toHaveBeenCalledWith(
        expect.objectContaining({ unit_cost: 1080 }),
        expect.anything(),
      );
      const sealedArgs = sealed.itemUpdates.find(
        (u) => u.data.deductible_tax_amount !== undefined,
      );
      expect(sealedArgs.data.deductible_tax_amount).toBe(0);
      expect(sealedArgs.data.capitalized_tax_amount).toBe(400);
    });

    // QUI-855 — recepción parcial: DR 1435 del lote == capa FIFO del lote.
    async function receivePartial(opts: {
      qty: number;
      prevReceived: number;
      prevCap: number;
      cumulativeCap: number;
      allReceived: boolean;
      priorPosted?: number;
    }) {
      const sealed = { itemUpdates: [] as any[] };
      const tx = mockReceiveTx(sealed);
      const po = {
        ...purchaseOrder,
        purchase_order_items: [
          {
            ...orderItem,
            quantity_received: opts.allReceived ? 5 : opts.prevReceived + opts.qty,
            capitalized_tax_amount: opts.prevCap,
            deductible_tax_amount: 0,
          },
        ],
      };
      tx.purchase_orders.findUnique = jest.fn().mockResolvedValue(po);
      tx.purchase_orders.update = jest.fn().mockResolvedValue({
        ...po,
        suppliers: null,
        purchase_order_items: [
          {
            ...po.purchase_order_items[0],
            capitalized_tax_amount: opts.cumulativeCap,
            deductible_tax_amount: 0,
            products: null,
            product_variants: null,
          },
        ],
      });
      prismaService.$transaction.mockImplementation((cb: any) => cb(tx));
      if (opts.priorPosted) {
        prismaService.purchase_order_receptions.findMany.mockResolvedValue([
          { id: 1 },
        ]);
        prismaService.accounting_entries.findMany.mockResolvedValue([
          { total_debit: opts.priorPosted },
        ]);
      }
      await service.receive(PO_ID, {
        items: [{ id: PO_ITEM_ID, quantity_received: opts.qty }],
      } as any);
      const ev = eventEmitter.emit.mock.calls.filter(
        (c) => c[0] === 'purchase_order.received',
      );
      return ev[ev.length - 1][1];
    }

    it('parcial 2/5 ⇒ lote 2160 (= 2 × 1080 FIFO) y luego 3/5 ⇒ 3240; suma 5400', async () => {
      const first = await receivePartial({
        qty: 2,
        prevReceived: 0,
        prevCap: 0,
        cumulativeCap: 160,
        allReceived: false,
      });
      expect(first.total_amount).toBe(2160);

      eventEmitter.emit.mockClear();
      const second = await receivePartial({
        qty: 3,
        prevReceived: 2,
        prevCap: 160,
        cumulativeCap: 400,
        allReceived: true,
        priorPosted: first.total_amount,
      });
      expect(second.total_amount).toBe(3240);
      expect(first.total_amount + second.total_amount).toBe(5400);
    });
  });

  // ------------------------------------------------- buildPurchaseTaxGroups
  describe('buildPurchaseTaxGroups', () => {
    const build = (items: any[]) =>
      (service as any).buildPurchaseTaxGroups(items);

    it('una línea INC-only no lanza y no se incluye', () => {
      const groups = build([
        {
          tax_rate: 0,
          tax_type: 'inc',
          quantity_ordered: 5,
          unit_cost: 1000,
          deductible_tax_amount: 0,
          purchase_order_item_taxes: [
            { tax_type: 'inc', taxable_amount: 5000 },
          ],
        },
      ]);
      expect(groups).toEqual([]);
    });

    it('línea IVA+INC usa la base de la fila hija IVA', () => {
      const groups = build([
        {
          tax_rate: 19,
          tax_type: 'iva',
          quantity_ordered: 5,
          unit_cost: 1000,
          deductible_tax_amount: 950,
          purchase_order_item_taxes: [
            { tax_type: 'inc', taxable_amount: 5000 },
            { tax_type: 'iva', taxable_amount: 5400 },
          ],
        },
      ]);
      expect(groups).toEqual([
        { tax_rate: 19, tax_type: 'iva', taxable_amount: 5400, tax_amount: 950 },
      ]);
    });

    it('sigue lanzando F-214 para una línea IVA sin tax_rate', () => {
      expect(() =>
        build([
          {
            tax_rate: null,
            tax_type: 'iva',
            quantity_ordered: 1,
            unit_cost: 100,
            deductible_tax_amount: 19,
          },
        ]),
      ).toThrow(/F-214/);
    });
  });

  // ----------------------------------------------------------------- remove
  it('remove(): borra las filas de impuestos antes de la orden', async () => {
    const order: string[] = [];
    const tx = {
      purchase_orders: {
        findUnique: jest.fn().mockResolvedValue({
          id: PO_ID,
          status: 'draft',
          order_number: 'PO-X',
        }),
        delete: jest.fn().mockImplementation(() => {
          order.push('order');
          return Promise.resolve({ id: PO_ID });
        }),
      },
      purchase_order_item_taxes: {
        deleteMany: jest.fn().mockImplementation(() => {
          order.push('taxes');
          return Promise.resolve({ count: 2 });
        }),
      },
    };
    prismaService.$transaction.mockImplementation((cb: any) => cb(tx));
    await service.remove(PO_ID);
    expect(order).toEqual(['taxes', 'order']);
  });

  // -------------------------------------------------- QUI-855 auditoría
  it('remove(): el where de las filas de impuestos usa la relación purchase_order_items', async () => {
    const tx = {
      purchase_orders: {
        findUnique: jest.fn().mockResolvedValue({
          id: PO_ID,
          status: 'draft',
          order_number: 'PO-X',
        }),
        delete: jest.fn().mockResolvedValue({ id: PO_ID }),
      },
      purchase_order_item_taxes: {
        deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
    };
    prismaService.$transaction.mockImplementation((cb: any) => cb(tx));
    await service.remove(PO_ID);
    expect(tx.purchase_order_item_taxes.deleteMany).toHaveBeenCalledWith({
      where: { purchase_order_items: { purchase_order_id: PO_ID } },
    });
  });

  it('update() con items: el where de las filas de impuestos usa la relación purchase_order_items', async () => {
    const tx = {
      purchase_orders: {
        findUnique: jest.fn().mockResolvedValue({
          id: PO_ID,
          status: 'draft',
          order_number: 'PO-X',
          shipping_cost: 0,
          shipping_cost_allocation: null,
          subtotal_amount: 0,
          tax_amount: 0,
        }),
        update: jest.fn().mockResolvedValue({ id: PO_ID }),
      },
      purchase_order_item_taxes: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      purchase_order_items: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    jest
      .spyOn(service as any, 'assertNoBaseLineOnVariantProduct')
      .mockResolvedValue(undefined);
    jest.spyOn(service as any, 'linkScanAttachment').mockResolvedValue(undefined);
    prismaService.$transaction.mockImplementation((cb: any) => cb(tx));
    await service.update(PO_ID, {
      items: [{ product_id: PRODUCT_ID, quantity: 2, unit_price: 1000, tax_rate: 19 }],
    } as any);
    expect(tx.purchase_order_item_taxes.deleteMany).toHaveBeenCalledWith({
      where: { purchase_order_items: { purchase_order_id: PO_ID } },
    });
  });

  describe('resolveLineTaxes — descuento y legacy', () => {
    const resolve = (item: any) =>
      (service as any).resolveLineTaxes(item, { prices_include_tax: false });

    it('999 × 0,315 con descuento 400 ⇒ no lanza, neto 0 e impuestos 0', () => {
      const r = resolve({
        unit_price: 0.315,
        quantity: 999,
        discount_amount: 400,
        tax_rate: 19,
      });
      expect(r.net_total).toBe(0);
      expect(r.tax_amount).toBe(0);
    });

    it('descuento 100 % con cantidad 0,315 ⇒ no lanza', () => {
      const r = resolve({
        unit_price: 999,
        quantity: 0.315,
        discount_percentage: 100,
        tax_rate: 19,
      });
      expect(r.net_total).toBe(0);
      expect(r.tax_amount).toBe(0);
    });

    it('legacy con tax_type fuera de lista (ica) ⇒ se trata como IVA', () => {
      const r = resolve({
        unit_price: 1000,
        quantity: 2,
        tax_rate: 10,
        tax_type: 'ica',
      });
      expect(r.tax_amount).toBe(200);
      expect(r.taxes).toHaveLength(1);
      expect(r.taxes[0].tax_type).toBe('iva');
    });

    it('taxes[] explícito con tipo no soportado sigue lanzando 400', () => {
      expect(() =>
        resolve({
          unit_price: 1000,
          quantity: 2,
          taxes: [{ tax_type: 'ica', tax_rate: 10 }],
        }),
      ).toThrow(/no soportado/i);
    });
  });

  describe('validateFreightAndTaxHeader — impuesto sólo en taxes[]', () => {
    it('prices_include_tax con línea INC sólo en taxes[] es válida', () => {
      expect(
        validateFreightAndTaxHeader({
          prices_include_tax: true,
          items: [{ taxes: [{ tax_rate: 8 }] }],
        }),
      ).toBeNull();
      expect(
        validateFreightAndTaxHeader({
          prices_include_tax: true,
          items: [{ taxes: [{ tax_rate: null, fixed_amount_per_unit: 35 }] }],
        }),
      ).toBeNull();
    });

    it('sin tasa en ninguna línea ni fila sigue siendo 400', () => {
      expect(
        validateFreightAndTaxHeader({
          prices_include_tax: true,
          items: [{ tax_rate: 0, taxes: [{ tax_rate: 0 }] }],
        }),
      ).toEqual(expect.stringContaining('impuesto incluido'));
    });
  });
});
