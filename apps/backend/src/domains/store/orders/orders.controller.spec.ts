import { Test, TestingModule } from '@nestjs/testing';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { ResponseService } from '@common/responses/response.service';
import { CreateOrderDto, UpdateOrderDto, OrderQueryDto } from './dto';
import { order_state_enum } from '@prisma/client';

describe('OrdersController', () => {
  let controller: OrdersController;
  let ordersService: OrdersService;
  let responseService: ResponseService;

  const mockOrdersService = {
    findAll: jest.fn(),
    create: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };

  const mockResponseService = {
    success: jest.fn(),
    created: jest.fn(),
    updated: jest.fn(),
    deleted: jest.fn(),
    error: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrdersController],
      providers: [
        {
          provide: OrdersService,
          useValue: mockOrdersService,
        },
        {
          provide: ResponseService,
          useValue: mockResponseService,
        },
      ],
    }).compile();

    controller = module.get<OrdersController>(OrdersController);
    ordersService = module.get<OrdersService>(OrdersService);
    responseService = module.get<ResponseService>(ResponseService);

    // Reset all mocks
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return paginated orders successfully', async () => {
      const query: OrderQueryDto = { page: 1, limit: 10 };
      const ordersData = {
        data: [
          {
            id: 1,
            order_number: 'ORD001',
            state: order_state_enum.created,
            stores: { id: 1, name: 'Store 1', store_code: 'S001' },
            order_items: [{ id: 1, product_name: 'Product 1', quantity: 1 }],
          },
        ],
        pagination: { total: 1, page: 1, limit: 10, totalPages: 1 },
      };

      const successResponse = {
        success: true as const,
        data: ordersData,
        message: 'Órdenes obtenidas exitosamente',
      };

      mockOrdersService.findAll.mockResolvedValue(ordersData);
      mockResponseService.success.mockReturnValue(successResponse);

      const result = await controller.findAll(query);

      expect(result).toEqual(successResponse);
      expect(mockOrdersService.findAll).toHaveBeenCalledWith(query);
      expect(mockResponseService.success).toHaveBeenCalledWith(
        ordersData,
        'Órdenes obtenidas exitosamente',
      );
    });

    it('should handle errors when fetching orders', async () => {
      const query: OrderQueryDto = {};
      const error = new Error('Database error');

      const errorResponse = {
        success: false as const,
        message: 'Error al obtener las órdenes',
        error: 'Database error',
        statusCode: 400,
        timestamp: '2024-01-01T00:00:00.000Z',
      };

      mockOrdersService.findAll.mockRejectedValue(error);
      mockResponseService.error.mockReturnValue(errorResponse);

      const result = await controller.findAll(query);

      expect(result).toEqual(errorResponse);
      expect(mockOrdersService.findAll).toHaveBeenCalledWith(query);
      expect(mockResponseService.error).toHaveBeenCalledWith(
        'Error al obtener las órdenes',
        'Database error',
        400,
      );
    });
  });

  describe('create', () => {
    it('should create an order successfully', async () => {
      const createOrderDto: CreateOrderDto = {
        customer_id: 1,
        store_id: 1,
        order_number: 'ORD001',
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
            variant_attributes: '{"color": "red", "size": "M"}',
            quantity: 2,
            unit_price: 50.0,
            total_price: 100.0,
            tax_rate: 0.1,
            tax_amount_item: 10.0,
          },
        ],
      };

      const user = { id: 1, organization_id: 1 };
      const createdOrder = {
        id: 1,
        ...createOrderDto,
        shipping_address_snapshot: null,
        billing_address_snapshot: null,
        subtotal_amount: 100.0,
        grand_total: 115.0,
        placed_at: null,
        completed_at: null,
        created_at: new Date('2024-01-01T00:00:00.000Z'),
        updated_at: new Date('2024-01-01T00:00:00.000Z'),
        stores: { id: 1, name: 'Store 1', store_code: 'S001' },
        order_items: [
          {
            id: 1,
            ...createOrderDto.items[0],
            products: { id: 1, name: 'Test Product' },
            product_variants: { id: 1, sku: 'TP001' },
          },
        ],
      };

      const createdResponse = {
        success: true as const,
        data: createdOrder,
        message: 'Orden creada exitosamente',
      };

      mockOrdersService.create.mockResolvedValue(createdOrder);
      mockResponseService.created.mockReturnValue(createdResponse);

      const result = await controller.create(createOrderDto, { user } as any);

      expect(result).toMatchObject(createdResponse);
      expect(mockOrdersService.create).toHaveBeenCalledWith(
        createOrderDto,
        user,
      );
      expect(mockResponseService.created).toHaveBeenCalledWith(
        createdOrder,
        'Orden creada exitosamente',
      );
    });

    it('should handle errors when creating order', async () => {
      const createOrderDto: CreateOrderDto = {
        customer_id: 1,
        store_id: 1,
        subtotal: 100.0,
        total_amount: 100.0,
        items: [],
      };

      const user = { id: 1, organization_id: 1 };
      const error = new Error('Customer not found');

      const errorResponse = {
        success: false as const,
        message: 'Error al crear la orden',
        error: 'Customer not found',
        statusCode: 400,
        timestamp: '2024-01-01T00:00:00.000Z',
      };

      mockOrdersService.create.mockRejectedValue(error);
      mockResponseService.error.mockReturnValue(errorResponse);

      const result = await controller.create(createOrderDto, { user } as any);

      expect(result).toEqual(errorResponse);
      expect(mockOrdersService.create).toHaveBeenCalledWith(
        createOrderDto,
        user,
      );
      expect(mockResponseService.error).toHaveBeenCalledWith(
        'Error al crear la orden',
        'Customer not found',
        400,
      );
    });
  });

  describe('findOne', () => {
    it('should return order by id successfully', async () => {
      const orderId = 1;
      const order = {
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
      };

      const successResponse = {
        success: true as const,
        data: order,
        message: 'Orden obtenida exitosamente',
      };

      mockOrdersService.findOne.mockResolvedValue(order);
      mockResponseService.success.mockReturnValue(successResponse);

      const result = await controller.findOne(orderId);

      expect(result).toEqual(successResponse);
      expect(mockOrdersService.findOne).toHaveBeenCalledWith(orderId);
      expect(mockResponseService.success).toHaveBeenCalledWith(
        order,
        'Orden obtenida exitosamente',
      );
    });

    it('should handle errors when fetching order by id', async () => {
      const orderId = 999;
      const error = new Error('Order not found');

      const errorResponse = {
        success: false as const,
        message: 'Error al obtener la orden',
        error: 'Order not found',
        statusCode: 400,
        timestamp: '2024-01-01T00:00:00.000Z',
      };

      mockOrdersService.findOne.mockRejectedValue(error);
      mockResponseService.error.mockReturnValue(errorResponse);

      const result = await controller.findOne(orderId);

      expect(result).toEqual(errorResponse);
      expect(mockOrdersService.findOne).toHaveBeenCalledWith(orderId);
      expect(mockResponseService.error).toHaveBeenCalledWith(
        'Error al obtener la orden',
        'Order not found',
        400,
      );
    });
  });

  describe('update', () => {
    it('should update order successfully', async () => {
      const orderId = 1;
      const updateOrderDto: UpdateOrderDto = {
        internal_notes: 'Updated notes',
      };

      const updatedOrder = {
        id: 1,
        order_number: 'ORD001',
        state: order_state_enum.created,
        internal_notes: 'Updated notes',
      };

      const updatedResponse = {
        success: true as const,
        data: updatedOrder,
        message: 'Orden actualizada exitosamente',
      };

      mockOrdersService.update.mockResolvedValue(updatedOrder);
      mockResponseService.updated.mockReturnValue(updatedResponse);

      const result = await controller.update(orderId, updateOrderDto);

      expect(result).toEqual(updatedResponse);
      expect(mockOrdersService.update).toHaveBeenCalledWith(
        orderId,
        updateOrderDto,
      );
      expect(mockResponseService.updated).toHaveBeenCalledWith(
        updatedOrder,
        'Orden actualizada exitosamente',
      );
    });

    it('should handle errors when updating order', async () => {
      const orderId = 999;
      const updateOrderDto: UpdateOrderDto = {
        internal_notes: 'Updated notes',
      };

      const error = new Error('Order not found');

      const errorResponse = {
        success: false as const,
        message: 'Error al actualizar la orden',
        error: 'Order not found',
        statusCode: 400,
        timestamp: '2024-01-01T00:00:00.000Z',
      };

      mockOrdersService.update.mockRejectedValue(error);
      mockResponseService.error.mockReturnValue(errorResponse);

      const result = await controller.update(orderId, updateOrderDto);

      expect(result).toEqual(errorResponse);
      expect(mockOrdersService.update).toHaveBeenCalledWith(
        orderId,
        updateOrderDto,
      );
      expect(mockResponseService.error).toHaveBeenCalledWith(
        'Error al actualizar la orden',
        'Order not found',
        400,
      );
    });
  });

  describe('remove', () => {
    it('should delete order successfully', async () => {
      const orderId = 1;

      const deletedResponse = {
        success: true as const,
        data: null,
        message: 'Orden eliminada exitosamente',
      };

      mockOrdersService.remove.mockResolvedValue(undefined);
      mockResponseService.deleted.mockReturnValue(deletedResponse);

      const result = await controller.remove(orderId);

      expect(result).toEqual(deletedResponse);
      expect(mockOrdersService.remove).toHaveBeenCalledWith(orderId);
      expect(mockResponseService.deleted).toHaveBeenCalledWith(
        'Orden eliminada exitosamente',
      );
    });

    it('should handle errors when deleting order', async () => {
      const orderId = 999;
      const error = new Error('Order not found');

      const errorResponse = {
        success: false as const,
        message: 'Error al eliminar la orden',
        error: 'Order not found',
        statusCode: 400,
        timestamp: '2024-01-01T00:00:00.000Z',
      };

      mockOrdersService.remove.mockRejectedValue(error);
      mockResponseService.error.mockReturnValue(errorResponse);

      const result = await controller.remove(orderId);

      expect(result).toEqual(errorResponse);
      expect(mockOrdersService.remove).toHaveBeenCalledWith(orderId);
      expect(mockResponseService.error).toHaveBeenCalledWith(
        'Error al eliminar la orden',
        'Order not found',
        400,
      );
    });
  });
});
