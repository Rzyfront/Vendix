import { Test, TestingModule } from '@nestjs/testing';
import { OrganizationsService } from './organizations.service';
import { GlobalPrismaService as PrismaService } from '../../../prisma/services/global-prisma.service';

describe('OrganizationsService', () => {
  let service: OrganizationsService;
  let prisma: PrismaService;

  const mockPrismaService = {
    organizations: {
      findFirst: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    stores: {
      count: jest.fn(),
      findMany: jest.fn(),
      groupBy: jest.fn(),
    },
    users: {
      count: jest.fn(),
      groupBy: jest.fn(),
    },
    user_sessions: {
      count: jest.fn(),
    },
    orders: {
      count: jest.fn(),
      aggregate: jest.fn(),
    },
    order_items: {
      aggregate: jest.fn(),
    },
    audit_logs: {
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrganizationsService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<OrganizationsService>(OrganizationsService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getDashboard', () => {
    it('should return dashboard stats correctly', async () => {
      const orgId = 1;
      const query = {};

      // Mock return values
      // 1. Total Stores & New this month
      mockPrismaService.stores.count
        .mockResolvedValueOnce(24) // Total
        .mockResolvedValueOnce(3); // New this month

      // 2. Active Users & Online now
      mockPrismaService.users.count.mockResolvedValueOnce(1428); // Active users
      mockPrismaService.user_sessions.count.mockResolvedValueOnce(142); // Online users

      // 3. Monthly Orders & Orders today
      mockPrismaService.orders.count
        .mockResolvedValueOnce(8642) // Monthly
        .mockResolvedValueOnce(284); // Today

      // 4. Profit (Current Month) & Last Month - Revenue and costs
      mockPrismaService.orders.aggregate
        .mockResolvedValueOnce({
          _sum: { grand_total: 124580, shipping_cost: 5000 },
        }) // Current revenue
        .mockResolvedValueOnce({
          _sum: { grand_total: 96160, shipping_cost: 4000 },
        }); // Last revenue
      mockPrismaService.order_items.aggregate
        .mockResolvedValueOnce({ _sum: { total_cost: 80000 } }) // Current COGS
        .mockResolvedValueOnce({ _sum: { total_cost: 60000 } }); // Last COGS

      // Lists
      mockPrismaService.stores.findMany.mockResolvedValueOnce([]);
      mockPrismaService.users.groupBy.mockResolvedValueOnce([]);
      mockPrismaService.audit_logs.findMany.mockResolvedValueOnce([]);

      // Profit Trend (6 months) - Revenue and costs for each month
      for (let i = 0; i < 6; i++) {
        mockPrismaService.orders.aggregate.mockResolvedValueOnce({
          _sum: { grand_total: 10000, shipping_cost: 500 },
        });
        mockPrismaService.order_items.aggregate.mockResolvedValueOnce({
          _sum: { total_cost: 6000 },
        });
      }

      // Store Distribution by sales types
      mockPrismaService.stores.findMany.mockResolvedValueOnce([
        { store_type: 'physical' },
        { store_type: 'physical' },
        { store_type: 'online' },
        { store_type: 'online' },
        { store_type: 'hybrid' },
      ]);

      const result = await service.getDashboard(orgId, query);

      expect(result.organization_id).toBe(orgId);

      // Verify Stats Object
      expect(result.stats.total_stores.value).toBe(24);
      expect(result.stats.total_stores.sub_value).toBe(3);

      expect(result.stats.active_users.value).toBe(1428);
      expect(result.stats.active_users.sub_value).toBe(142);

      expect(result.stats.monthly_orders.value).toBe(8642);
      expect(result.stats.monthly_orders.sub_value).toBe(284);

      expect(result.stats.revenue.value).toBe(124580 - 5000 - 80000); // 39580
      expect(result.stats.revenue.sub_value).toBe(
        124580 - 5000 - 80000 - (96160 - 4000 - 60000),
      ); // 7420

      // Verify New Fields
      expect(result.profit_trend.length).toBe(6);
      expect(result.profit_trend[0].amount).toBe(10000 - 500 - 6000); // 3500

      expect(result.store_distribution.length).toBe(2);
      expect(
        result.store_distribution.find((s) => s.type === 'physical')
          ?.order_count,
      ).toBe(3);
      expect(
        result.store_distribution.find((s) => s.type === 'online')?.order_count,
      ).toBe(2);
    });
  });
});
