import { PurchasesAnalyticsService } from './purchases-analytics.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';

type MockStorePrismaService = {
  store_settings: { findFirst: jest.Mock };
  purchase_orders: { findMany: jest.Mock };
  purchase_order_payments: { findMany: jest.Mock };
  withoutScope: jest.Mock;
} & Partial<StorePrismaService>;

describe('PurchasesAnalyticsService - Payable Aging (QUI-542)', () => {
  let service: PurchasesAnalyticsService;
  let prisma: MockStorePrismaService;

  const mockContext = {
    store_id: 1,
    organization_id: 10,
    is_super_admin: false,
    is_owner: false,
  };

  // Fixed reference date: 2026-09-20 12:00:00Z
  const AS_OF_DATE_STR = '2026-09-20';
  const AS_OF_TIME = new Date('2026-09-20T23:59:59.999Z').getTime();

  // Helper to create dates relative to AS_OF_TIME
  const daysAgo = (days: number): Date => new Date(AS_OF_TIME - days * 86400000);
  const daysAhead = (days: number): Date => new Date(AS_OF_TIME + days * 86400000);

  beforeEach(() => {
    jest.clearAllMocks();

    prisma = {
      store_settings: { findFirst: jest.fn() },
      purchase_orders: { findMany: jest.fn() },
      purchase_order_payments: { findMany: jest.fn() },
      withoutScope: jest.fn(),
    } as MockStorePrismaService;

    prisma.store_settings.findFirst.mockResolvedValue({
      timezone: 'America/Bogota',
      settings: { general: { timezone: 'America/Bogota' } },
    });

    jest.spyOn(RequestContextService, 'getContext').mockReturnValue(mockContext as any);

    service = new PurchasesAnalyticsService(prisma as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('throws STORE_CONTEXT_001 if store context is missing', async () => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue(null as any);
    await expect(service.getPayableAging({})).rejects.toThrow();
  });

  it('correctly aggregates orders by supplier and places balances into aging buckets', async () => {
    const sampleOrders = [
      // Supplier 1: Distribuidora Andina (tax_id + verification_digit)
      // Order 1: Due in 5 days (current) -> total 1000, paid 200 -> balance 800
      {
        id: 101,
        order_number: 'PO-001',
        total_amount: '1000.00',
        order_date: daysAgo(20),
        payment_due_date: daysAhead(5),
        created_at: daysAgo(20),
        supplier_id: 1,
        suppliers: {
          id: 1,
          name: 'Distribuidora Andina',
          code: 'ANDINA',
          tax_id: '900123456',
          verification_digit: '1',
        },
        payments: [{ amount: '200.00', payment_date: daysAgo(5) }],
      },
      // Order 2: Due 15 days ago (1-30 days bucket) -> total 500, paid 0 -> balance 500
      {
        id: 102,
        order_number: 'PO-002',
        total_amount: '500.00',
        order_date: daysAgo(40),
        payment_due_date: daysAgo(15),
        created_at: daysAgo(40),
        supplier_id: 1,
        suppliers: {
          id: 1,
          name: 'Distribuidora Andina',
          code: 'ANDINA',
          tax_id: '900123456',
          verification_digit: '1',
        },
        payments: [],
      },
      // Order 3: Due 45 days ago (31-60 days bucket) -> total 700, paid 100 -> balance 600
      {
        id: 103,
        order_number: 'PO-003',
        total_amount: '700.00',
        order_date: daysAgo(70),
        payment_due_date: daysAgo(45),
        created_at: daysAgo(70),
        supplier_id: 1,
        suppliers: {
          id: 1,
          name: 'Distribuidora Andina',
          code: 'ANDINA',
          tax_id: '900123456',
          verification_digit: '1',
        },
        payments: [{ amount: '100.00', payment_date: daysAgo(10) }],
      },

      // Supplier 2: Importadora Caribe (tax_id only, no verification digit)
      // Order 4: Due 75 days ago (61-90 days bucket) -> total 1200, paid 0 -> balance 1200
      {
        id: 201,
        order_number: 'PO-004',
        total_amount: '1200.00',
        order_date: daysAgo(100),
        payment_due_date: daysAgo(75),
        created_at: daysAgo(100),
        supplier_id: 2,
        suppliers: {
          id: 2,
          name: 'Importadora Caribe',
          code: 'CARIBE',
          tax_id: '800555666',
          verification_digit: null,
        },
        payments: [],
      },
      // Order 5: Due 120 days ago (>90 days bucket) -> total 2000, paid 500 -> balance 1500
      {
        id: 202,
        order_number: 'PO-005',
        total_amount: '2000.00',
        order_date: daysAgo(150),
        payment_due_date: daysAgo(120),
        created_at: daysAgo(150),
        supplier_id: 2,
        suppliers: {
          id: 2,
          name: 'Importadora Caribe',
          code: 'CARIBE',
          tax_id: '800555666',
          verification_digit: null,
        },
        payments: [{ amount: '500.00', payment_date: daysAgo(60) }],
      },

      // Supplier 3: Proveedor Local (no tax_id, fallback to code)
      // Order 6: Fully paid (balance 0) -> should be excluded!
      {
        id: 301,
        order_number: 'PO-006',
        total_amount: '300.00',
        order_date: daysAgo(10),
        payment_due_date: daysAgo(5),
        created_at: daysAgo(10),
        supplier_id: 3,
        suppliers: {
          id: 3,
          name: 'Proveedor Local',
          code: 'LOCAL-01',
          tax_id: null,
          verification_digit: null,
        },
        payments: [{ amount: '300.00', payment_date: daysAgo(1) }],
      },
    ];

    prisma.purchase_orders.findMany.mockResolvedValue(sampleOrders as any);

    // Mock last payments query
    prisma.purchase_order_payments.findMany.mockResolvedValue([
      { payment_date: daysAgo(5), purchase_order: { supplier_id: 1 } },
      { payment_date: daysAgo(10), purchase_order: { supplier_id: 1 } },
      { payment_date: daysAgo(60), purchase_order: { supplier_id: 2 } },
    ] as any);

    const result = await service.getPayableAging({ as_of: AS_OF_DATE_STR, page: 1, limit: 10 });

    expect(result).toBeDefined();
    expect(result.data).toHaveLength(2); // Supplier 3 has 0 balance, excluded

    // Order of rows: sorted by total_outstanding descending
    // Supplier 2 total: 1200 + 1500 = 2700
    // Supplier 1 total: 800 + 500 + 600 = 1900
    const sup2 = result.data[0];
    expect(sup2.supplier_id).toBe(2);
    expect(sup2.supplier_name).toBe('Importadora Caribe');
    expect(sup2.supplier_document).toBe('800555666'); // Tax id without DV
    expect(sup2.total_paid).toBe(500);
    expect(sup2.current).toBe(0);
    expect(sup2.days_1_30).toBe(0);
    expect(sup2.days_31_60).toBe(0);
    expect(sup2.days_61_90).toBe(1200);
    expect(sup2.days_over_90).toBe(1500);
    expect(sup2.total_outstanding).toBe(2700);
    expect(sup2.due_date).toEqual(daysAgo(120));
    expect(sup2.due_in_days).toBe(-120);
    expect(sup2.last_payment_date).toEqual(daysAgo(60));

    const sup1 = result.data[1];
    expect(sup1.supplier_id).toBe(1);
    expect(sup1.supplier_name).toBe('Distribuidora Andina');
    expect(sup1.supplier_document).toBe('900123456-1'); // Formatted tax_id + DV
    expect(sup1.total_paid).toBe(300);
    expect(sup1.current).toBe(800);
    expect(sup1.days_1_30).toBe(500);
    expect(sup1.days_31_60).toBe(600);
    expect(sup1.days_61_90).toBe(0);
    expect(sup1.days_over_90).toBe(0);
    expect(sup1.total_outstanding).toBe(1900);
    expect(sup1.due_date).toEqual(daysAgo(45));
    expect(sup1.due_in_days).toBe(-45);
    expect(sup1.last_payment_date).toEqual(daysAgo(5));

    // Global totals
    expect(result.meta.totals.total_paid).toBe(800);
    expect(result.meta.totals.current).toBe(800);
    expect(result.meta.totals.days_1_30).toBe(500);
    expect(result.meta.totals.days_31_60).toBe(600);
    expect(result.meta.totals.days_61_90).toBe(1200);
    expect(result.meta.totals.days_over_90).toBe(1500);
    expect(result.meta.totals.total_outstanding).toBe(4600);

    // Pagination
    expect(result.meta.pagination.total).toBe(2);
    expect(result.meta.pagination.page).toBe(1);
    expect(result.meta.pagination.limit).toBe(10);
  });

  it('filters results by search string', async () => {
    const sampleOrders = [
      {
        id: 101,
        order_number: 'PO-001',
        total_amount: '1000.00',
        order_date: daysAgo(5),
        payment_due_date: daysAgo(5),
        created_at: daysAgo(5),
        supplier_id: 1,
        suppliers: {
          id: 1,
          name: 'Distribuidora Andina',
          code: 'ANDINA',
          tax_id: '900123456',
          verification_digit: '1',
        },
        payments: [],
      },
      {
        id: 201,
        order_number: 'PO-002',
        total_amount: '2000.00',
        order_date: daysAgo(5),
        payment_due_date: daysAgo(5),
        created_at: daysAgo(5),
        supplier_id: 2,
        suppliers: {
          id: 2,
          name: 'Importadora Caribe',
          code: 'CARIBE',
          tax_id: '800555666',
          verification_digit: null,
        },
        payments: [],
      },
    ];

    prisma.purchase_orders.findMany.mockResolvedValue(sampleOrders as any);
    prisma.purchase_order_payments.findMany.mockResolvedValue([]);

    const result = await service.getPayableAging({
      as_of: AS_OF_DATE_STR,
      search: 'caribe',
    });

    expect(result.data).toHaveLength(1);
    expect(result.data[0].supplier_name).toBe('Importadora Caribe');
    expect(result.meta.totals.total_outstanding).toBe(2000);
  });

  it('returns full unpaginated dataset with getPayableAgingForExport', async () => {
    const sampleOrders = [
      {
        id: 101,
        order_number: 'PO-001',
        total_amount: '1000.00',
        order_date: daysAgo(5),
        payment_due_date: daysAgo(5),
        created_at: daysAgo(5),
        supplier_id: 1,
        suppliers: {
          id: 1,
          name: 'Distribuidora Andina',
          code: 'ANDINA',
          tax_id: '900123456',
          verification_digit: '1',
        },
        payments: [],
      },
    ];

    prisma.purchase_orders.findMany.mockResolvedValue(sampleOrders as any);
    prisma.purchase_order_payments.findMany.mockResolvedValue([]);

    const { rows, totals } = await service.getPayableAgingForExport({
      as_of: AS_OF_DATE_STR,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].supplier_id).toBe(1);
    expect(totals.total_outstanding).toBe(1000);
  });
});
