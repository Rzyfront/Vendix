import { Test, TestingModule } from '@nestjs/testing';
import { PaymentValidatorService } from './services/payment-validator.service';
import { StorePrismaService } from '../../prisma/services/store-prisma.service';
import { OrderValidationResult } from './interfaces';

describe('PaymentValidatorService', () => {
  let service: PaymentValidatorService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const mockPrismaService = {
      orders: {
        findUnique: jest.fn(),
      },
      store_payment_methods: {
        findFirst: jest.fn(),
      },
      payments: {
        findFirst: jest.fn(),
      },
      stores: {
        findUnique: jest.fn(),
      },
      users: {
        findFirst: jest.fn(),
      },
      store_users: {
        findMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentValidatorService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<PaymentValidatorService>(PaymentValidatorService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('validateOrder', () => {
    it('should validate a valid order', async () => {
      const mockOrder = {
        id: 1,
        state: 'created',
        store_id: 1,
        grand_total: 100.0,
        order_items: [
          {
            product_id: 1,
            product_name: 'Test Product',
            quantity: 1,
            unit_price: 100.0,
            total_price: 100.0,
          },
        ],
        payments: [],
      };

      jest.spyOn(prisma.orders, 'findUnique').mockResolvedValue(mockOrder);

      const result: OrderValidationResult = await service.validateOrder(1, 1);

      expect(result.valid).toBe(true);
      expect(result.order).toEqual(mockOrder);
    });

    it('should reject non-existent order', async () => {
      jest.spyOn(prisma.orders, 'findUnique').mockResolvedValue(null);

      const result = await service.validateOrder(999, 1);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Order not found');
    });

    it('should reject cancelled order', async () => {
      const mockOrder = {
        id: 1,
        state: 'cancelled',
        store_id: 1,
        order_items: [],
        payments: [],
      };

      jest.spyOn(prisma.orders, 'findUnique').mockResolvedValue(mockOrder);

      const result = await service.validateOrder(1, 1);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'Cannot process payment for cancelled order',
      );
    });

    it('should reject order from different store', async () => {
      const mockOrder = {
        id: 1,
        state: 'created',
        store_id: 2, // Different store
        order_items: [],
        payments: [],
      };

      jest.spyOn(prisma.orders, 'findUnique').mockResolvedValue(mockOrder);

      const result = await service.validateOrder(1, 1);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Order does not belong to this store');
    });

    it('should warn about fully paid order', async () => {
      const mockOrder = {
        id: 1,
        state: 'created',
        store_id: 1,
        grand_total: 100.0,
        order_items: [
          {
            product_id: 1,
            product_name: 'Test Product',
            quantity: 1,
            unit_price: 100.0,
            total_price: 100.0,
          },
        ],
        payments: [
          {
            state: 'succeeded',
            amount: 100.0,
          },
        ],
      };

      jest.spyOn(prisma.orders, 'findUnique').mockResolvedValue(mockOrder);

      const result = await service.validateOrder(1, 1);

      expect(result.valid).toBe(true);
      expect(result.warnings).toContain('Order is already fully paid');
    });

    it('should reject order with no items', async () => {
      const mockOrder = {
        id: 1,
        state: 'created',
        store_id: 1,
        order_items: [], // No items
        payments: [],
      };

      jest.spyOn(prisma.orders, 'findUnique').mockResolvedValue(mockOrder);

      const result = await service.validateOrder(1, 1);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Order has no items');
    });
  });

  describe('validatePaymentMethod', () => {
    it('should validate enabled payment method', async () => {
      const mockPaymentMethod = {
        id: 1,
        store_id: 1,
        state: 'enabled',
        system_payment_method: {
          is_active: true,
        },
      };

      jest
        .spyOn(prisma.store_payment_methods, 'findFirst')
        .mockResolvedValue(mockPaymentMethod);

      const result = await service.validatePaymentMethod(1, 1);

      expect(result).toBe(true);
    });

    it('should reject disabled payment method', async () => {
      const mockPaymentMethod = {
        id: 1,
        store_id: 1,
        state: 'disabled',
      };

      jest
        .spyOn(prisma.store_payment_methods, 'findFirst')
        .mockResolvedValue(mockPaymentMethod);

      const result = await service.validatePaymentMethod(1, 1);

      expect(result).toBe(false);
    });

    it('should reject non-existent payment method', async () => {
      jest
        .spyOn(prisma.store_payment_methods, 'findFirst')
        .mockResolvedValue(null);

      const result = await service.validatePaymentMethod(999, 1);

      expect(result).toBe(false);
    });
  });

  describe('validatePaymentAmount', () => {
    it('should validate correct amount', async () => {
      const mockOrder = {
        id: 1,
        grand_total: 100.0,
        payments: [
          {
            state: 'succeeded',
            amount: 50.0,
          },
        ],
      };

      jest.spyOn(prisma.orders, 'findUnique').mockResolvedValue(mockOrder);

      const result = await service.validatePaymentAmount(50.0, 1);

      expect(result).toBe(true);
    });

    it('should reject amount exceeding remaining balance', async () => {
      const mockOrder = {
        id: 1,
        grand_total: 100.0,
        payments: [
          {
            state: 'succeeded',
            amount: 80.0,
          },
        ],
      };

      jest.spyOn(prisma.orders, 'findUnique').mockResolvedValue(mockOrder);

      const result = await service.validatePaymentAmount(30.0, 1); // 80 + 30 > 100

      expect(result).toBe(false);
    });

    it('should reject zero amount', async () => {
      const mockOrder = {
        id: 1,
        grand_total: 100.0,
        payments: [],
      };

      jest.spyOn(prisma.orders, 'findUnique').mockResolvedValue(mockOrder);

      const result = await service.validatePaymentAmount(0, 1);

      expect(result).toBe(false);
    });

    it('should reject negative amount', async () => {
      const mockOrder = {
        id: 1,
        grand_total: 100.0,
        payments: [],
      };

      jest.spyOn(prisma.orders, 'findUnique').mockResolvedValue(mockOrder);

      const result = await service.validatePaymentAmount(-10, 1);

      expect(result).toBe(false);
    });
  });

  describe('validateCurrency', () => {
    it('should validate valid currency', async () => {
      const mockStore = {
        id: 1,
      };

      jest.spyOn(prisma.stores, 'findUnique').mockResolvedValue(mockStore);

      const result = await service.validateCurrency('USD', 1);

      expect(result).toBe(true);
    });

    it('should reject empty currency', async () => {
      const mockStore = {
        id: 1,
      };

      jest.spyOn(prisma.stores, 'findUnique').mockResolvedValue(mockStore);

      const result = await service.validateCurrency('', 1);

      expect(result).toBe(false);
    });

    it('should reject currency that is too long', async () => {
      const mockStore = {
        id: 1,
      };

      jest.spyOn(prisma.stores, 'findUnique').mockResolvedValue(mockStore);

      const result = await service.validateCurrency('VERYLONGCURRENCY', 1);

      expect(result).toBe(false);
    });

    it('should handle non-existent store', async () => {
      jest.spyOn(prisma.stores, 'findUnique').mockResolvedValue(null);

      const result = await service.validateCurrency('USD', 999);

      expect(result).toBe(false);
    });
  });

  describe('validateCustomer', () => {
    it('should validate valid customer', async () => {
      const mockCustomer = {
        id: 1,
        organization_id: 1,
      };

      jest.spyOn(prisma.users, 'findFirst').mockResolvedValue(mockCustomer);

      const result = await service.validateCustomer(1, 1);

      expect(result).toBe(true);
    });

    it('should reject customer from different organization', async () => {
      const mockCustomer = {
        id: 1,
        organization_id: 2, // Different organization
      };

      jest.spyOn(prisma.users, 'findFirst').mockResolvedValue(null);

      const result = await service.validateCustomer(1, 1);

      expect(result).toBe(false);
    });

    it('should reject non-existent customer', async () => {
      jest.spyOn(prisma.users, 'findFirst').mockResolvedValue(null);

      const result = await service.validateCustomer(999, 1);

      expect(result).toBe(false);
    });
  });
});
