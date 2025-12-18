import { Test, TestingModule } from '@nestjs/testing';
import { OrdersService } from './orders.service';
import { StorePrismaService } from '../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { CreateOrderDto, UpdateOrderDto, OrderQueryDto } from './dto';
import {
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { order_state_enum } from '@prisma/client';

describe('OrdersService', () => {
  let service: OrdersService;
  let prismaService: PrismaService;

  const mockPrismaService = {
    orders: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    users: {
      findUnique: jest.fn(),
    },
    stores: {
      findFirst: jest.fn(),
    },
    withoutScope: jest.fn(),
  };

  const mockRequestContextService = {
    getContext: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: RequestContextService,
          useValue: mockRequestContextService,
        },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
    prismaService = module.get<PrismaService>(PrismaService);

    // Reset all mocks
    jest.clearAllMocks();

    // Mock withoutScope to return the same prisma service
    mockPrismaService.withoutScope.mockReturnValue(mockPrismaService);
  });

  describe('create', () => {
    it('should create an order successfully', async () => {
      const createOrderDto: CreateOrderDto = {
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
            variant_attributes: { color: 'red', size: 'M' },
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
            variant_attributes: { color: 'red', size: 'M' },
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
          updated_at: expect.any(Date),
          order_items: {
            create: [
              {
                product_id: 1,
                product_variant_id: 1,
                product_name: 'Test Product',
                variant_sku: 'TP001',
                variant_attributes: { color: 'red', size: 'M' },
                quantity: 2,
                unit_price: 50.0,
                total_price: 100.0,
                tax_rate: 0.1,
                tax_amount_item: 10.0,
                updated_at: expect.any(Date),
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

    it('should throw NotFoundException when customer not found', async () => {
      const createOrderDto: CreateOrderDto = {
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

      await expect(service.create(createOrderDto, user)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.create(createOrderDto, user)).rejects.toThrow(
        'User (customer) not found',
      );
    });

    it('should throw NotFoundException when store not found', async () => {
      const createOrderDto: CreateOrderDto = {
        customer_id: 1,
        subtotal: 100.0,
        total_amount: 100.0,
        items: [],
      };

      const user = { id: 1, organization_id: 1 };

      mockRequestContextService.getContext.mockReturnValue({
        store_id: 999,
        organization_id: 1,
        is_super_admin: false,
      });

      mockPrismaService.users.findUnique.mockResolvedValue({
        id: 1,
        name: 'Test Customer',
      });

      mockPrismaService.stores.findFirst.mockResolvedValue(null);

      await expect(service.create(createOrderDto, user)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.create(createOrderDto, user)).rejects.toThrow(
        'Store not found',
      );
    });

    it('should throw BadRequestException when store context is missing', async () => {
      const createOrderDto: CreateOrderDto = {
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

      await expect(service.create(createOrderDto, user)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.create(createOrderDto, user)).rejects.toThrow(
        'Store context is required',
      );
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
          state: order_state_enum.completed,
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
        where: { store_id: 1 },
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
          store_id: 1,
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
        status: order_state_enum.completed,
      };

      const orders = [
        {
          id: 1,
          order_number: 'ORD001',
          state: order_state_enum.completed,
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
          store_id: 1,
          state: order_state_enum.completed,
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
          store_id: 1,
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
          store_id: 1,
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

      await expect(service.findOne(orderId)).rejects.toThrow(NotFoundException);
      await expect(service.findOne(orderId)).rejects.toThrow('Order not found');
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
          updated_at: expect.any(Date),
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

      await expect(service.update(orderId, updateOrderDto)).rejects.toThrow(
        NotFoundException,
      );
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

      await expect(service.remove(orderId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('generateOrderNumber', () => {
    it('should generate sequential order numbers', async () => {
      const now = new Date('2024-12-01');
      jest.spyOn(global, 'Date').mockImplementation(() => now);

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

      // Restore original Date
      jest.restoreAllMocks();
    });

    it('should generate first order number of the day', async () => {
      const now = new Date('2024-12-01');
      jest.spyOn(global, 'Date').mockImplementation(() => now);

      mockPrismaService.orders.findFirst.mockResolvedValue(null);

      const orderNumber = await (service as any).generateOrderNumber();

      expect(orderNumber).toBe('ORD2412010001');

      // Restore original Date
      jest.restoreAllMocks();
    });
  });
});
