import { Test, TestingModule } from '@nestjs/testing';
import { InventoryStatsService } from './inventory-stats.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { InventoryAnalyticsService } from '../../analytics/services/inventory-analytics.service';

describe('InventoryStatsService', () => {
  let service: InventoryStatsService;

  const mockSummary = {
    total_sku_count: 178,
    total_stock_value: 950178.82,
    low_stock_count: 3,
    out_of_stock_count: 174,
    low_stock_percentage: 1.68,
    out_of_stock_percentage: 97.75,
    total_quantity_on_hand: 189,
  };

  const mockAnalytics = {
    getInventorySummary: jest.fn().mockResolvedValue(mockSummary),
  };

  const mockPrisma = {
    purchase_orders: {
      aggregate: jest.fn().mockResolvedValue({
        _count: { _all: 2 },
        _sum: { total_amount: 150000 },
      }),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryStatsService,
        { provide: StorePrismaService, useValue: mockPrisma },
        { provide: InventoryAnalyticsService, useValue: mockAnalytics },
      ],
    }).compile();

    service = module.get<InventoryStatsService>(InventoryStatsService);
  });

  it('reutiliza el resumen de analítica para los KPIs de stock', async () => {
    const result = await service.getStats();

    expect(mockAnalytics.getInventorySummary).toHaveBeenCalledWith({});
    expect(result.total_products).toBe(178);
    expect(result.total_stock_value).toBe(950178.82);
    expect(result.low_stock_items).toBe(3);
    expect(result.out_of_stock_items).toBe(174);
  });

  it('cuenta órdenes aprobadas como pendientes y suma su valor en camino', async () => {
    const result = await service.getStats();

    expect(mockPrisma.purchase_orders.aggregate).toHaveBeenCalledWith({
      where: { status: 'approved' },
      _count: { _all: true },
      _sum: { total_amount: true },
    });
    expect(result.pending_orders).toBe(2);
    expect(result.incoming_stock).toBe(150000);
  });

  it('resuelve incoming_stock en 0 cuando no hay pendientes', async () => {
    mockPrisma.purchase_orders.aggregate.mockResolvedValueOnce({
      _count: { _all: 0 },
      _sum: { total_amount: null },
    });

    const result = await service.getStats();

    expect(result.pending_orders).toBe(0);
    expect(result.incoming_stock).toBe(0);
  });
});
