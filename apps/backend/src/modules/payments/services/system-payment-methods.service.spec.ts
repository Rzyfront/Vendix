import { Test, TestingModule } from '@nestjs/testing';
import { SystemPaymentMethodsService } from '../services/system-payment-methods.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateSystemPaymentMethodDto } from '../dto/system-payment-method.dto';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { payment_methods_type_enum, fee_type_enum } from '@prisma/client';

describe('SystemPaymentMethodsService', () => {
  let service: SystemPaymentMethodsService;
  let prisma: PrismaService;

  const mockSystemPaymentMethod = {
    id: 1,
    name: 'Stripe',
    display_name: 'Stripe',
    description: 'Credit card payments',
    provider: 'stripe',
    logo_url: 'https://example.com/stripe.png',
    type: 'card' as payment_methods_type_enum,
    is_active: true,
    config_schema: {},
    supported_currencies: ['USD'],
    requires_config: true,
    default_config: {},
    min_amount: null,
    max_amount: null,
    processing_fee_type: 'percentage' as fee_type_enum,
    _count: {
      store_payment_methods: 0,
    },
    processing_fee_value: null,
    created_at: new Date(),
    updated_at: new Date(),
  };

  const mockUser = {
    id: 1,
    email: 'admin@example.com',
    roles: ['super_admin'],
  };

  const mockPrismaService = {
    system_payment_methods: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    // Mock baseClient getter
    get baseClient() {
      return {
        system_payment_methods: this.system_payment_methods,
      };
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SystemPaymentMethodsService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<SystemPaymentMethodsService>(
      SystemPaymentMethodsService,
    );
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a system payment method', async () => {
      const createDto: CreateSystemPaymentMethodDto = {
        name: 'Stripe',
        type: 'card' as payment_methods_type_enum,
        display_name: 'Stripe',
        provider: 'stripe',
        config_schema: {},
        supported_currencies: ['USD'],
      };

      jest
        .spyOn(mockPrismaService.system_payment_methods, 'create')
        .mockResolvedValue(mockSystemPaymentMethod);

      const result = await service.create(createDto, mockUser);

      expect(result).toEqual(mockSystemPaymentMethod);
      expect(
        mockPrismaService.system_payment_methods.create,
      ).toHaveBeenCalledWith({
        data: { ...createDto, is_active: true },
      });
    });
  });

  describe('findAll', () => {
    it('should return an array of system payment methods', async () => {
      jest
        .spyOn(mockPrismaService.system_payment_methods, 'findMany')
        .mockResolvedValue([mockSystemPaymentMethod]);

      const result = await service.findAll(mockUser);

      expect(result).toEqual([mockSystemPaymentMethod]);
    });

    it('should filter by active status', async () => {
      jest
        .spyOn(mockPrismaService.system_payment_methods, 'findMany')
        .mockResolvedValue([mockSystemPaymentMethod]);

      const regularUser = { ...mockUser, roles: ['user'] };
      await service.findAll(regularUser);

      expect(
        mockPrismaService.system_payment_methods.findMany,
      ).toHaveBeenCalledWith({
        where: { is_active: true },
        orderBy: { name: 'asc' },
      });
    });
  });

  describe('findOne', () => {
    it('should return a system payment method by id', async () => {
      jest
        .spyOn(mockPrismaService.system_payment_methods, 'findFirst')
        .mockResolvedValue(mockSystemPaymentMethod);

      const result = await service.findOne(1, mockUser);

      expect(result).toEqual(mockSystemPaymentMethod);
    });

    it('should throw NotFoundException if not found', async () => {
      jest
        .spyOn(mockPrismaService.system_payment_methods, 'findFirst')
        .mockResolvedValue(null);

      try {
        await service.findOne(999, mockUser);
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundException);
      }
    });
  });

  describe('update', () => {
    it('should update a system payment method', async () => {
      const updateDto = {
        display_name: 'Stripe Updated',
      };
      const updatedMethod = {
        ...mockSystemPaymentMethod,
        ...updateDto,
        updated_at: new Date(),
      };

      mockPrismaService.system_payment_methods.findUnique.mockResolvedValue(
        mockSystemPaymentMethod,
      );
      mockPrismaService.system_payment_methods.update.mockResolvedValue(
        updatedMethod,
      );

      const result = await service.update(1, updateDto, mockUser);

      expect(result).toEqual(updatedMethod);
    });
  });

  describe('remove', () => {
    it('should delete a system payment method', async () => {
      mockPrismaService.system_payment_methods.findUnique.mockResolvedValue(
        mockSystemPaymentMethod,
      );
      mockPrismaService.system_payment_methods.delete.mockResolvedValue(
        mockSystemPaymentMethod,
      );

      const result = await service.remove(1, mockUser);

      expect(result).toEqual({
        success: true,
        message: 'System payment method deleted',
      });
    });
  });
});
