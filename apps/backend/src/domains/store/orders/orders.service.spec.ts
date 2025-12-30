import { Test, TestingModule } from '@nestjs/testing';
import { OrdersService } from './orders.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { CreateOrderDto, UpdateOrderDto, OrderQueryDto } from './dto';
import {
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { order_state_enum, Prisma } from '@prisma/client';

describe('OrdersService', () => {
  let service: OrdersService;
  let prismaService: StorePrismaService;

  const mockPrismaService = {
    orders: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
    },
    users: {
      findUnique: jest.fn(),
    },
    stores: {
      findFirst: jest.fn(),
    },
    withoutScope: jest.fn(),
    $transaction: jest.fn((callback) => callback(mockPrismaService)),
  };

  const mockRequestContextService = {
    getContext: jest.fn(),
  };

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-12-01T12:00:00Z'));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        {
          provide: StorePrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: RequestContextService,
          useValue: mockRequestContextService,
        },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
    prismaService = module.get<StorePrismaService>(StorePrismaService);

    // Reset all mocks
    // jest.clearAllMocks();

    // Mock withoutScope to return the same prisma service
    mockPrismaService.withoutScope.mockReturnValue(mockPrismaService);

    // Default context
    mockRequestContextService.getContext.mockReturnValue({
      store_id: 1,
      organization_id: 1,
      is_super_admin: false,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('create', () => {
    it('should create an order successfully', async () => {
      const createOrderDto: CreateOrderDto = {
        store_id: 1,
        customer_id: 1,
        order_number: 'ORD202412010001',
        state: order_state_enum.created,
        subtotal: 100.0,
        tax_amount: 10.0,
        shipping_cost: 5.0,
        discount_amount: 0.0,
        total_amount: 115.0,
        currency: 'USD',
        billing_address_id: 1,
        shipping_address_id: 2,
        internal_notes: 'Test order',
        items: [
          {
            product_id: 1,
            product_variant_id: 1,
            product_name: 'Test Product',
            variant_sku: 'TP001',
            variant_attributes: JSON.stringify({ color: 'red', size: 'M' }),
            quantity: 2,
            unit_price: 50.0,
            total_price: 100.0,
            tax_rate: 0.1,
            tax_amount_item: 10.0,
          },
        ],
      };

      const user = { id: 1, organization_id: 1 };
      const expectedOrder = {
        id: 1,
        customer_id: 1,
        store_id: 1,
        order_number: 'ORD202412010001',
        state: order_state_enum.created,
        subtotal_amount: 100.0,
        tax_amount: 10.0,
        shipping_cost: 5.0,
        discount_amount: 0.0,
        grand_total: 115.0,
        currency: 'USD',
        billing_address_id: 1,
        shipping_address_id: 2,
        internal_notes: 'Test order',
        stores: { id: 1, name: 'Test Store', store_code: 'TS001' },
        order_items: [
          {
            id: 1,
            product_id: 1,
            product_variant_id: 1,
            product_name: 'Test Product',
            variant_sku: 'TP001',
            variant_attributes: JSON.stringify({ color: 'red', size: 'M' }),
            quantity: 2,
            unit_price: 50.0,
            total_price: 100.0,
            tax_rate: 0.1,
            tax_amount_item: 10.0,
            products: { id: 1, name: 'Test Product' },
            product_variants: { id: 1, sku: 'TP001' },
          },
        ],
      };

      mockRequestContextService.getContext.mockReturnValue({
        store_id: 1,
        organization_id: 1,
        is_super_admin: false,
      });

      mockPrismaService.users.findUnique.mockResolvedValue({
        id: 1,
        name: 'Test Customer',
      });

      mockPrismaService.stores.findFirst.mockResolvedValue({
        id: 1,
        name: 'Test Store',
        organization_id: 1,
      });

      mockPrismaService.orders.create.mockResolvedValue(expectedOrder);

      const result = await service.create(createOrderDto, user);

      expect(result).toEqual(expectedOrder);
      expect(mockPrismaService.orders.create).toHaveBeenCalledWith({
        data: {
          customer_id: 1,
          store_id: 1,
          order_number: 'ORD202412010001',
          state: order_state_enum.created,
          subtotal_amount: 100.0,
          tax_amount: 10.0,
          shipping_cost: 5.0,
          discount_amount: 0.0,
          grand_total: 115.0,
          currency: 'USD',
          billing_address_id: 1,
          shipping_address_id: 2,
          internal_notes: 'Test order',
          updated_at: new Date('2024-12-01T12:00:00Z'),
          order_items: {
            create: [
              {
                product_id: 1,
                product_variant_id: 1,
                product_name: 'Test Product',
                variant_sku: 'TP001',
                variant_attributes: JSON.stringify({ color: 'red', size: 'M' }),
                quantity: 2,
                unit_price: 50.0,
                total_price: 100.0,
                tax_rate: 0.1,
                tax_amount_item: 10.0,
                updated_at: new Date('2024-12-01T12:00:00Z'),
              },
            ],
          },
        },
        include: {
          stores: { select: { id: true, name: true, store_code: true } },
          order_items: { include: { products: true, product_variants: true } },
        },
      });
    });

    it('should generate order number when not provided', async () => {
      const createOrderDto: CreateOrderDto = {
        store_id: 1,
        customer_id: 1,
        subtotal: 100.0,
        total_amount: 100.0,
        items: [
          {
            product_id: 1,
            product_name: 'Test Product',
            quantity: 1,
            unit_price: 100.0,
            total_price: 100.0,
          },
        ],
      };

      const user = { id: 1, organization_id: 1 };

      mockRequestContextService.getContext.mockReturnValue({
        store_id: 1,
        organization_id: 1,
        is_super_admin: false,
      });

      mockPrismaService.users.findUnique.mockResolvedValue({
        id: 1,
        name: 'Test Customer',
      });

      mockPrismaService.stores.findFirst.mockResolvedValue({
        id: 1,
        name: 'Test Store',
        organization_id: 1,
      });

      mockPrismaService.orders.findFirst.mockResolvedValue(null);

      mockPrismaService.orders.create.mockResolvedValue({
        id: 1,
        order_number: 'ORD2412010001',
      });

      const result = await service.create(createOrderDto, user);

      expect(result.order_number).toBeDefined();
      expect(result.order_number).toMatch(/^ORD\d{8}\d{4}$/);
    });

    it('should retry generation if order number already exists', async () => {
      const createOrderDto: CreateOrderDto = {
        store_id: 1,
        customer_id: 1,
        subtotal: 100.0,
        total_amount: 100.0,
        items: [
          {
            product_id: 1,
            product_name: 'Test Product',
            quantity: 1,
            unit_price: 100.0,
            total_price: 100.0,
          },
        ],
      };

      const user = { id: 1, organization_id: 1 };

      mockRequestContextService.getContext.mockReturnValue({
        store_id: 1,
        organization_id: 1,
        is_super_admin: false,
      });

      mockPrismaService.users.findUnique.mockResolvedValue({
        id: 1,
        name: 'Test Customer',
      });

      mockPrismaService.stores.findFirst.mockResolvedValue({
        id: 1,
        name: 'Test Store',
        organization_id: 1,
      });

      mockPrismaService.orders.findFirst.mockResolvedValue(null);

      // First attempt fails with collision
      mockPrismaService.orders.create.mockRejectedValueOnce({
        code: 'P2002',
        meta: { target: ['order_number'] },
      });

      // Second attempt succeeds
      const expectedOrder = {
        id: 1,
        order_number: 'ORD2412010002',
      };
      mockPrismaService.orders.create.mockResolvedValue(expectedOrder);

      const result = await service.create(createOrderDto, user);

      expect(mockPrismaService.orders.create).toHaveBeenCalledTimes(2);
      expect(result.order_number).toBe('ORD2412010002');
    });

    it('should throw NotFoundException when customer not found', async () => {
      const createOrderDto: CreateOrderDto = {
        store_id: 1,
        customer_id: 999,
        subtotal: 100.0,
        total_amount: 100.0,
        items: [],
      };

      const user = { id: 1, organization_id: 1 };

      mockRequestContextService.getContext.mockReturnValue({
        store_id: 1,
        organization_id: 1,
        is_super_admin: false,
      });

      mockPrismaService.users.findUnique.mockResolvedValue(null);

      try {
        await service.create(createOrderDto, user);
        fail('Should have thrown NotFoundException (User)');
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundException);
        expect(error.message).toContain('not found');
      }
    });

    it('should throw BadRequestException when store context is missing', async () => {
      const createOrderDto: CreateOrderDto = {
        store_id: 1,
        customer_id: 1,
        subtotal: 100.0,
        total_amount: 100.0,
        items: [],
      };

      const user = { id: 1, organization_id: 1 };

      mockRequestContextService.getContext.mockReturnValue({
        store_id: null,
        organization_id: 1,
        is_super_admin: false,
      });

      try {
        await service.create(createOrderDto, user);
        fail('Should have thrown ForbiddenException or BadRequestException');
      } catch (error) {
        expect(error.message).toContain('Store context required');
      }
    });
  });

  describe('findAll', () => {
    it('should return paginated orders with default values', async () => {
      const query: OrderQueryDto = {};
      const orders = [
        {
          id: 1,
          order_number: 'ORD001',
          state: order_state_enum.created,
          stores: { id: 1, name: 'Store 1', store_code: 'S001' },
          order_items: [{ id: 1, product_name: 'Product 1', quantity: 1 }],
        },
        {
          id: 2,
          order_number: 'ORD002',
          state: order_state_enum.delivered,
          stores: { id: 1, name: 'Store 1', store_code: 'S001' },
          order_items: [{ id: 2, product_name: 'Product 2', quantity: 2 }],
        },
      ];

      mockRequestContextService.getContext.mockReturnValue({
        store_id: 1,
        organization_id: 1,
        is_super_admin: false,
      });

      mockPrismaService.orders.findMany.mockResolvedValue(orders);
      mockPrismaService.orders.count.mockResolvedValue(2);

      const result = await service.findAll(query);

      expect(result).toEqual({
        data: orders,
        pagination: { total: 2, page: 1, limit: 10, totalPages: 1 },
      });
      expect(mockPrismaService.orders.findMany).toHaveBeenCalledWith({
        where: {},
        skip: 0,
        take: 10,
        orderBy: { created_at: 'desc' },
        include: {
          stores: { select: { id: true, name: true, store_code: true } },
          order_items: {
            select: { id: true, product_name: true, quantity: true },
          },
        },
      });
    });

    it('should handle search functionality', async () => {
      const query: OrderQueryDto = {
        search: 'ORD001',
      };

      const orders = [
        {
          id: 1,
          order_number: 'ORD001',
          state: order_state_enum.created,
          stores: { id: 1, name: 'Store 1', store_code: 'S001' },
          order_items: [{ id: 1, product_name: 'Product 1', quantity: 1 }],
        },
      ];

      mockRequestContextService.getContext.mockReturnValue({
        store_id: 1,
        organization_id: 1,
        is_super_admin: false,
      });

      mockPrismaService.orders.findMany.mockResolvedValue(orders);
      mockPrismaService.orders.count.mockResolvedValue(1);

      const result = await service.findAll(query);

      expect(result).toEqual({
        data: orders,
        pagination: { total: 1, page: 1, limit: 10, totalPages: 1 },
      });
      expect(mockPrismaService.orders.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ order_number: { contains: 'ORD001', mode: 'insensitive' } }],
        },
        skip: 0,
        take: 10,
        orderBy: { created_at: 'desc' },
        include: {
          stores: { select: { id: true, name: true, store_code: true } },
          order_items: {
            select: { id: true, product_name: true, quantity: true },
          },
        },
      });
    });

    it('should handle status filtering', async () => {
      const query: OrderQueryDto = {
        status: order_state_enum.delivered,
      };

      const orders = [
        {
          id: 1,
          order_number: 'ORD001',
          // replaced completed with delivered
          state: order_state_enum.delivered,
          stores: { id: 1, name: 'Store 1', store_code: 'S001' },
          order_items: [{ id: 1, product_name: 'Product 1', quantity: 1 }],
        },
      ];

      mockRequestContextService.getContext.mockReturnValue({
        store_id: 1,
        organization_id: 1,
        is_super_admin: false,
      });

      mockPrismaService.orders.findMany.mockResolvedValue(orders);
      mockPrismaService.orders.count.mockResolvedValue(1);

      const result = await service.findAll(query);

      expect(result).toEqual({
        data: orders,
        pagination: { total: 1, page: 1, limit: 10, totalPages: 1 },
      });
      expect(mockPrismaService.orders.findMany).toHaveBeenCalledWith({
        where: {
          state: order_state_enum.delivered,
        },
        skip: 0,
        take: 10,
        orderBy: { created_at: 'desc' },
        include: {
          stores: { select: { id: true, name: true, store_code: true } },
          order_items: {
            select: { id: true, product_name: true, quantity: true },
          },
        },
      });
    });

    it('should handle date range filtering', async () => {
      const query: OrderQueryDto = {
        date_from: '2024-01-01',
        date_to: '2024-01-31',
      };

      const orders = [
        {
          id: 1,
          order_number: 'ORD001',
          state: order_state_enum.created,
          stores: { id: 1, name: 'Store 1', store_code: 'S001' },
          order_items: [{ id: 1, product_name: 'Product 1', quantity: 1 }],
        },
      ];

      mockRequestContextService.getContext.mockReturnValue({
        store_id: 1,
        organization_id: 1,
        is_super_admin: false,
      });

      mockPrismaService.orders.findMany.mockResolvedValue(orders);
      mockPrismaService.orders.count.mockResolvedValue(1);

      const result = await service.findAll(query);

      expect(result).toEqual({
        data: orders,
        pagination: { total: 1, page: 1, limit: 10, totalPages: 1 },
      });
      expect(mockPrismaService.orders.findMany).toHaveBeenCalledWith({
        where: {
          created_at: {
            gte: new Date('2024-01-01'),
            lte: new Date('2024-01-31'),
          },
        },
        skip: 0,
        take: 10,
        orderBy: { created_at: 'desc' },
        include: {
          stores: { select: { id: true, name: true, store_code: true } },
          order_items: {
            select: { id: true, product_name: true, quantity: true },
          },
        },
      });
    });
  });

  describe('findOne', () => {
    it('should return order by id', async () => {
      const orderId = 1;
      const expectedOrder = {
        id: 1,
        order_number: 'ORD001',
        state: order_state_enum.created,
        stores: { id: 1, name: 'Store 1', store_code: 'S001' },
        order_items: [
          {
            id: 1,
            product_name: 'Product 1',
            products: { id: 1, name: 'Product 1' },
            product_variants: { id: 1, sku: 'P001' },
          },
        ],
        addresses_orders_billing_address_idToaddresses: {
          id: 1,
          street: '123 Main St',
        },
        addresses_orders_shipping_address_idToaddresses: {
          id: 2,
          street: '456 Oak St',
        },
        // replaced completed with delivered or just string if it was fine?
        // payments might use different enum or string. I'll leave as is if no error on this line.
        // But previously 'completed' was used in `payments`.
        // Let's assume payment status is string or different enum.
        payments: [{ id: 1, amount: 100.0, status: 'completed' }],
      };

      mockRequestContextService.getContext.mockReturnValue({
        store_id: 1,
        organization_id: 1,
        is_super_admin: false,
      });

      mockPrismaService.orders.findFirst.mockResolvedValue(expectedOrder);

      const result = await service.findOne(orderId);

      expect(result).toEqual(expectedOrder);
      expect(mockPrismaService.orders.findFirst).toHaveBeenCalledWith({
        where: {
          id: 1,
        },
        include: {
          stores: { select: { id: true, name: true, store_code: true } },
          order_items: { include: { products: true, product_variants: true } },
          addresses_orders_billing_address_idToaddresses: true,
          addresses_orders_shipping_address_idToaddresses: true,
          payments: true,
        },
      });
    });

    it('should throw NotFoundException when order not found', async () => {
      const orderId = 999;

      mockRequestContextService.getContext.mockReturnValue({
        store_id: 1,
        organization_id: 1,
        is_super_admin: false,
      });

      mockPrismaService.orders.findFirst.mockResolvedValue(null);

      try {
        await service.findOne(orderId);
        fail('Should have thrown NotFoundException');
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundException);
      }
    });
  });

  describe('update', () => {
    it('should update order successfully', async () => {
      const orderId = 1;
      const updateOrderDto: UpdateOrderDto = {
        internal_notes: 'Updated notes',
      };

      const existingOrder = {
        id: 1,
        order_number: 'ORD001',
        state: order_state_enum.created,
      };

      const updatedOrder = {
        ...existingOrder,
        internal_notes: 'Updated notes',
      };

      mockRequestContextService.getContext.mockReturnValue({
        store_id: 1,
        organization_id: 1,
        is_super_admin: false,
      });

      mockPrismaService.orders.findFirst.mockResolvedValue(existingOrder);
      mockPrismaService.orders.update.mockResolvedValue(updatedOrder);

      const result = await service.update(orderId, updateOrderDto);

      expect(result).toEqual(updatedOrder);
      expect(mockPrismaService.orders.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          internal_notes: 'Updated notes',
          updated_at: new Date('2024-12-01T12:00:00Z'),
        },
        include: {
          stores: { select: { id: true, name: true, store_code: true } },
          order_items: { include: { products: true, product_variants: true } },
          addresses_orders_billing_address_idToaddresses: true,
          addresses_orders_shipping_address_idToaddresses: true,
          payments: true,
        },
      });
    });

    it('should throw NotFoundException when order not found for update', async () => {
      const orderId = 999;
      const updateOrderDto: UpdateOrderDto = {
        internal_notes: 'Updated notes',
      };

      mockRequestContextService.getContext.mockReturnValue({
        store_id: 1,
        organization_id: 1,
        is_super_admin: false,
      });

      mockPrismaService.orders.findFirst.mockResolvedValue(null);

      try {
        await service.update(orderId, updateOrderDto);
        fail('Should have thrown NotFoundException');
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundException);
      }
    });
  });

  describe('remove', () => {
    it('should delete order successfully', async () => {
      const orderId = 1;
      const existingOrder = {
        id: 1,
        order_number: 'ORD001',
        state: order_state_enum.created,
      };

      mockRequestContextService.getContext.mockReturnValue({
        store_id: 1,
        organization_id: 1,
        is_super_admin: false,
      });

      mockPrismaService.orders.findFirst.mockResolvedValue(existingOrder);
      mockPrismaService.orders.delete.mockResolvedValue(existingOrder);

      const result = await service.remove(orderId);

      expect(result).toEqual(existingOrder);
      expect(mockPrismaService.orders.delete).toHaveBeenCalledWith({
        where: { id: 1 },
      });
    });

    it('should throw NotFoundException when order not found for deletion', async () => {
      const orderId = 999;

      mockRequestContextService.getContext.mockReturnValue({
        store_id: 1,
        organization_id: 1,
        is_super_admin: false,
      });

      mockPrismaService.orders.findFirst.mockResolvedValue(null);

      try {
        await service.remove(orderId);
        fail('Should have thrown NotFoundException');
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundException);
      }
    });
  });

  describe('generateOrderNumber', () => {
    it('should generate sequential order numbers', async () => {
      // Mock returns proper date from FakeTimers

      const lastOrder = {
        order_number: 'ORD2412010001',
      };

      mockPrismaService.orders.findFirst.mockResolvedValue(lastOrder);

      const orderNumber = await (service as any).generateOrderNumber();

      expect(orderNumber).toBe('ORD2412010002');
      expect(mockPrismaService.orders.findFirst).toHaveBeenCalledWith({
        where: { order_number: { startsWith: 'ORD241201' } },
        orderBy: { order_number: 'desc' },
      });
    });

    it('should generate first order number of the day', async () => {
      mockPrismaService.orders.findFirst.mockResolvedValue(null);

      const orderNumber = await (service as any).generateOrderNumber();

      expect(orderNumber).toBe('ORD2412010001');
    });
  });
});
