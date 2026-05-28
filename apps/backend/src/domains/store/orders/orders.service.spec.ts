import { Test, TestingModule } from '@nestjs/testing';
import { OrdersService } from './orders.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { S3Service } from '@common/services/s3.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SettingsService } from '../settings/settings.service';
import { ScheduleValidationService } from '../settings/schedule-validation.service';
import { StockLevelManager } from '../inventory/shared/services/stock-level-manager.service';
import { ShippingCalculatorService } from '../shipping/shipping-calculator.service';
import { VendixHttpException } from 'src/common/errors';

describe('OrdersService', () => {
  let service: OrdersService;

  const mockPrismaService = {
    orders: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
    },
    users: { findUnique: jest.fn() },
    stores: { findFirst: jest.fn() },
    payments: { findFirst: jest.fn() },
    audit_logs: { findMany: jest.fn() },
    withoutScope: jest.fn(),
    $transaction: jest.fn((callback) => callback(mockPrismaService)),
  };

  const mockS3Service = {
    signUrl: jest.fn(async (url: string) => url),
    getPresignedUrl: jest.fn(async (key: string) => `signed:${key}`),
  };

  const mockEventEmitter = { emit: jest.fn() };
  const mockSettingsService = {
    getStoreCurrency: jest.fn(async () => 'COP'),
  };
  const mockScheduleValidation = { validateOrThrow: jest.fn() };
  const mockStockLevelManager = {
    reserveStock: jest.fn(),
    releaseReservation: jest.fn(),
    getDefaultLocationForProduct: jest.fn(async () => 1),
  };
  const mockShippingCalculator = { calculateRates: jest.fn() };

  const mockRequestContextService = {
    getContext: jest.fn(),
  };

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-12-01T12:00:00Z'));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: StorePrismaService, useValue: mockPrismaService },
        { provide: RequestContextService, useValue: mockRequestContextService },
        { provide: S3Service, useValue: mockS3Service },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: SettingsService, useValue: mockSettingsService },
        { provide: ScheduleValidationService, useValue: mockScheduleValidation },
        { provide: StockLevelManager, useValue: mockStockLevelManager },
        { provide: ShippingCalculatorService, useValue: mockShippingCalculator },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);

    mockPrismaService.withoutScope.mockReturnValue(mockPrismaService);
    mockRequestContextService.getContext.mockReturnValue({
      store_id: 1,
      organization_id: 1,
      is_super_admin: false,
    });

    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('findOne — discount snapshots', () => {
    it('includes order_promotions and coupon_uses in the detail query', async () => {
      mockPrismaService.orders.findFirst.mockResolvedValue({
        id: 1,
        order_number: 'ORD001',
        order_items: [],
        order_promotions: [],
        coupon_uses: [],
      });

      await service.findOne(1);

      expect(mockPrismaService.orders.findFirst).toHaveBeenCalledTimes(1);
      const args = mockPrismaService.orders.findFirst.mock.calls[0][0];
      expect(args.where).toEqual({ id: 1 });
      expect(args.include).toBeDefined();

      // Discount snapshots must be loaded so the detail view can show
      // exactly what was charged (not a recalculation).
      expect(args.include.order_promotions).toBeDefined();
      expect(args.include.order_promotions.select).toMatchObject({
        id: true,
        promotion_id: true,
        discount_amount: true,
      });
      expect(args.include.order_promotions.select.promotions).toBeDefined();
      expect(args.include.order_promotions.select.promotions.select).toMatchObject({
        id: true,
        name: true,
        code: true,
        type: true,
        scope: true,
      });

      expect(args.include.coupon_uses).toBeDefined();
      expect(args.include.coupon_uses.select).toMatchObject({
        id: true,
        coupon_id: true,
        discount_applied: true,
      });
      expect(args.include.coupon_uses.select.coupon).toBeDefined();
      expect(args.include.coupon_uses.select.coupon.select).toMatchObject({
        id: true,
        code: true,
        name: true,
        discount_type: true,
      });
    });

    it('returns the persisted promotion + coupon snapshots untouched (no recalculation)', async () => {
      const persistedOrder = {
        id: 42,
        order_number: 'ORD2412010042',
        subtotal_amount: '100.00',
        tax_amount: '0.00',
        shipping_cost: '5.00',
        discount_amount: '15.00',
        grand_total: '90.00',
        currency: 'COP',
        order_items: [],
        order_promotions: [
          {
            id: 11,
            promotion_id: 7,
            customer_id: 3,
            discount_amount: '10.00',
            created_at: new Date('2024-12-01T11:00:00Z'),
            promotions: {
              id: 7,
              name: '10% off bebidas',
              code: null,
              type: 'percentage',
              scope: 'category',
              value: '10',
            },
          },
        ],
        coupon_uses: [
          {
            id: 22,
            coupon_id: 5,
            customer_id: 3,
            discount_applied: '5.00',
            used_at: new Date('2024-12-01T11:30:00Z'),
            coupon: {
              id: 5,
              code: 'WELCOME5',
              name: 'Bienvenida',
              discount_type: 'fixed',
              discount_value: '5.00',
            },
          },
        ],
      };

      mockPrismaService.orders.findFirst.mockResolvedValue(persistedOrder);

      const result = await service.findOne(42);

      // Service returns the persisted snapshot as-is.
      expect(result.discount_amount).toBe('15.00');
      expect(result.grand_total).toBe('90.00');
      expect(result.order_promotions).toHaveLength(1);
      expect(result.order_promotions[0]).toMatchObject({
        promotion_id: 7,
        discount_amount: '10.00',
        promotions: { name: '10% off bebidas', scope: 'category' },
      });
      expect(result.coupon_uses).toHaveLength(1);
      expect(result.coupon_uses[0]).toMatchObject({
        coupon_id: 5,
        discount_applied: '5.00',
        coupon: { code: 'WELCOME5', name: 'Bienvenida' },
      });
    });

    it('returns empty snapshot arrays when no discounts were applied', async () => {
      mockPrismaService.orders.findFirst.mockResolvedValue({
        id: 99,
        order_number: 'ORD2412010099',
        subtotal_amount: '50.00',
        discount_amount: '0.00',
        grand_total: '50.00',
        order_items: [],
        order_promotions: [],
        coupon_uses: [],
      });

      const result = await service.findOne(99);

      expect(result.order_promotions).toEqual([]);
      expect(result.coupon_uses).toEqual([]);
      expect(result.discount_amount).toBe('0.00');
    });

    it('throws when order is not found', async () => {
      mockPrismaService.orders.findFirst.mockResolvedValue(null);

      await expect(service.findOne(404)).rejects.toBeInstanceOf(
        VendixHttpException,
      );
    });
  });
});
