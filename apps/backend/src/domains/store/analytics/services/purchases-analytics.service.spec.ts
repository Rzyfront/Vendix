import { PurchasesAnalyticsService } from './purchases-analytics.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from 'src/common/errors';
import { Granularity } from '../dto/analytics-query.dto';

type MockStorePrismaService = {
  purchase_orders: { findMany: jest.Mock };
  store_settings: { findFirst: jest.Mock };
  $queryRaw: jest.Mock;
  withoutScope: jest.Mock;
} & Partial<StorePrismaService>;

describe('PurchasesAnalyticsService - Trends (QUI-547)', () => {
  let service: PurchasesAnalyticsService;
  let prisma: MockStorePrismaService;
  let queryRawMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    queryRawMock = jest.fn();

    prisma = {
      purchase_orders: { findMany: jest.fn() },
      store_settings: { findFirst: jest.fn().mockResolvedValue(null) },
      $queryRaw: queryRawMock,
      withoutScope: jest.fn().mockReturnValue({
        $queryRaw: queryRawMock,
      }),
    } as MockStorePrismaService;

    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
      store_id: 10,
      organization_id: 1,
      is_super_admin: false,
      is_owner: false,
    } as any);

    service = new PurchasesAnalyticsService(prisma as any);
  });

  describe('getPurchaseTrends', () => {
    it('throws VendixHttpException when store context is missing', async () => {
      jest.spyOn(RequestContextService, 'getContext').mockReturnValue(null as any);

      await expect(
        service.getPurchaseTrends({
          date_from: '2026-09-01',
          date_to: '2026-09-18',
        } as any),
      ).rejects.toThrow(VendixHttpException);
    });

    it('aggregates purchase trends by period and supplier with correct totals, averages, and summary', async () => {
      const mockDbRows = [
        {
          period: '2026-09-18',
          supplier_id: 101,
          supplier_name: 'Distribuidora Central',
          purchase_count: 3,
          total_amount: 1500000.5,
          items_received: 45,
        },
        {
          period: '2026-09-18',
          supplier_id: 102,
          supplier_name: 'Alimentos del Valle',
          purchase_count: 2,
          total_amount: 800000,
          items_received: 30,
        },
        {
          period: '2026-09-17',
          supplier_id: 101,
          supplier_name: 'Distribuidora Central',
          purchase_count: 1,
          total_amount: 500000,
          items_received: 15,
        },
      ];

      queryRawMock.mockResolvedValue(mockDbRows);

      const result = await service.getPurchaseTrends({
        date_from: '2026-09-01',
        date_to: '2026-09-18',
        granularity: Granularity.DAY,
        page: 1,
        limit: 20,
      } as any);

      expect(result.data).toHaveLength(3);
      expect(result.meta.pagination).toEqual({
        total: 3,
        page: 1,
        limit: 20,
        totalPages: 1,
      });

      // Verify row 1 mapping and avg_purchase
      expect(result.data[0]).toEqual({
        track_id: '2026-09-18_101',
        id: '2026-09-18_101',
        period: '2026-09-18',
        supplier_id: 101,
        supplier_name: 'Distribuidora Central',
        purchase_count: 3,
        total_amount: 1500000.5,
        avg_purchase: 500000.17, // 1500000.5 / 3 = 500000.1666... -> 500000.17
        items_received: 45,
      });

      // Verify overall summary across all rows
      expect(result.summary).toEqual({
        purchase_count: 6,
        total_amount: 2800000.5,
        avg_purchase: 466666.75, // 2800000.5 / 6 = 466666.75
        items_received: 90,
      });
    });

    it('paginates results correctly while keeping period-wide summary intact', async () => {
      const mockDbRows = [
        {
          period: '2026-09-18',
          supplier_id: 101,
          supplier_name: 'A',
          purchase_count: 1,
          total_amount: 100,
          items_received: 10,
        },
        {
          period: '2026-09-17',
          supplier_id: 102,
          supplier_name: 'B',
          purchase_count: 1,
          total_amount: 200,
          items_received: 20,
        },
      ];

      queryRawMock.mockResolvedValue(mockDbRows);

      const page1 = await service.getPurchaseTrends({
        date_from: '2026-09-01',
        date_to: '2026-09-18',
        page: 1,
        limit: 1,
      } as any);

      expect(page1.data).toHaveLength(1);
      expect(page1.data[0].supplier_name).toBe('A');
      expect(page1.meta.pagination.totalPages).toBe(2);
      expect(page1.summary.total_amount).toBe(300); // whole period sum

      const page2 = await service.getPurchaseTrends({
        date_from: '2026-09-01',
        date_to: '2026-09-18',
        page: 2,
        limit: 1,
      } as any);

      expect(page2.data).toHaveLength(1);
      expect(page2.data[0].supplier_name).toBe('B');
      expect(page2.summary.total_amount).toBe(300);
    });

    it('handles empty datasets safely without division by zero', async () => {
      queryRawMock.mockResolvedValue([]);

      const result = await service.getPurchaseTrends({
        date_from: '2026-09-01',
        date_to: '2026-09-18',
      } as any);

      expect(result.data).toEqual([]);
      expect(result.meta.pagination.total).toBe(0);
      expect(result.summary).toEqual({
        purchase_count: 0,
        total_amount: 0,
        avg_purchase: 0,
        items_received: 0,
      });
    });

    it('supports supplier_id and search filters', async () => {
      queryRawMock.mockResolvedValue([]);

      await service.getPurchaseTrends({
        date_from: '2026-09-01',
        date_to: '2026-09-18',
        supplier_id: 42,
        search: 'Lácteos',
      } as any);

      expect(queryRawMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('getPurchaseTrendsForExport', () => {
    it('returns all rows unpaginated for XLSX generation', async () => {
      const mockDbRows = [
        {
          period: '2026-09-18',
          supplier_id: 101,
          supplier_name: 'Distribuidora Central',
          purchase_count: 2,
          total_amount: 1000000,
          items_received: 20,
        },
      ];

      queryRawMock.mockResolvedValue(mockDbRows);

      const rows = await service.getPurchaseTrendsForExport({
        date_from: '2026-09-01',
        date_to: '2026-09-18',
      } as any);

      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({
        track_id: '2026-09-18_101',
        id: '2026-09-18_101',
        period: '2026-09-18',
        supplier_id: 101,
        supplier_name: 'Distribuidora Central',
        purchase_count: 2,
        total_amount: 1000000,
        avg_purchase: 500000,
        items_received: 20,
      });
    });

    it('getPurchasesTrendsForExport alias calls getPurchaseTrendsForExport', async () => {
      queryRawMock.mockResolvedValue([]);

      const rows = await service.getPurchasesTrendsForExport({
        date_from: '2026-09-01',
        date_to: '2026-09-18',
      } as any);

      expect(rows).toEqual([]);
    });
  });
});
