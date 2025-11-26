import { Test, TestingModule } from '@nestjs/testing';
import { StorePaymentMethodsService } from '../services/store-payment-methods.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('StorePaymentMethodsService', () => {
  let service: StorePaymentMethodsService;
  let prisma: PrismaService;

  const mockStorePaymentMethod = {
    id: 1,
    store_id: 1,
    system_payment_method_id: 1,
    display_name: 'Stripe',
    state: 'enabled',
    display_order: 0,
    created_at: new Date(),
    updated_at: new Date(),
    system_payment_method: {
      id: 1,
      name: 'Stripe',
      type: 'card',
      is_active: true,
    },
  };

  const mockUser = {
    id: 1,
    email: 'admin@example.com',
    roles: ['super_admin'],
  };

  const mockSystemPaymentMethod = {
    id: 1,
    name: 'Stripe',
    type: 'card',
    is_active: true,
  };

  const mockPrismaService = {
    store_payment_methods: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    system_payment_methods: {
      findUnique: jest.fn(),
    },
    store_users: {
      findFirst: jest.fn(),
    },
    // Mock scopedClient getter
    get scopedClient() {
      return {
        store_payment_methods: this.store_payment_methods,
      };
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
        StorePaymentMethodsService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<StorePaymentMethodsService>(
      StorePaymentMethodsService,
    );
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getEnabledForStore', () => {
    it('should return store payment methods', async () => {
      jest
        .spyOn(mockPrismaService.store_payment_methods, 'findMany')
        .mockResolvedValue([mockStorePaymentMethod]);
      jest
        .spyOn(mockPrismaService.store_users, 'findFirst')
        .mockResolvedValue({ id: 1 });

      const result = await service.getEnabledForStore(1, mockUser);

      expect(result).toEqual([mockStorePaymentMethod]);
    });
  });

  describe('enableForStore', () => {
    it('should enable a payment method for a store', async () => {
      const enableDto = {
        display_name: 'Stripe Custom',
      };

      jest
        .spyOn(mockPrismaService.store_users, 'findFirst')
        .mockResolvedValue({ id: 1 });
      jest
        .spyOn(mockPrismaService.system_payment_methods, 'findUnique')
        .mockResolvedValue(mockSystemPaymentMethod);
      jest
        .spyOn(mockPrismaService.store_payment_methods, 'findFirst')
        .mockResolvedValue(null); // Not already enabled
      jest
        .spyOn(mockPrismaService.store_payment_methods, 'create')
        .mockResolvedValue(mockStorePaymentMethod);

      const result = await service.enableForStore(1, 1, enableDto, mockUser);

      expect(result).toEqual(mockStorePaymentMethod);
    });

    it('should throw BadRequestException if system method not found', async () => {
      const enableDto = {};

      jest
        .spyOn(mockPrismaService.store_users, 'findFirst')
        .mockResolvedValue({ id: 1 });
      jest
        .spyOn(mockPrismaService.system_payment_methods, 'findUnique')
        .mockResolvedValue(null);

      try {
        await service.enableForStore(1, 999, enableDto, mockUser);
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
      }
    });

    it('should throw BadRequestException if already enabled', async () => {
      const enableDto = {};

      jest
        .spyOn(mockPrismaService.store_users, 'findFirst')
        .mockResolvedValue({ id: 1 });
      jest
        .spyOn(mockPrismaService.system_payment_methods, 'findUnique')
        .mockResolvedValue(mockSystemPaymentMethod);
      jest
        .spyOn(mockPrismaService.store_payment_methods, 'findFirst')
        .mockResolvedValue(mockStorePaymentMethod);

      try {
        await service.enableForStore(1, 1, enableDto, mockUser);
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
      }
    });
  });

  describe('updateStoreMethod', () => {
    it('should update a store payment method', async () => {
      const updateDto = { display_name: 'Stripe Updated' };
      const updatedMethod = { ...mockStorePaymentMethod, ...updateDto };

      jest
        .spyOn(mockPrismaService.store_users, 'findFirst')
        .mockResolvedValue({ id: 1 });
      jest
        .spyOn(mockPrismaService.store_payment_methods, 'findFirst')
        .mockResolvedValue(mockStorePaymentMethod);
      jest
        .spyOn(mockPrismaService.store_payment_methods, 'update')
        .mockResolvedValue(updatedMethod);

      const result = await service.updateStoreMethod(1, 1, updateDto, mockUser);

      expect(result).toEqual(updatedMethod);
    });
  });

  describe('removeFromStore', () => {
    it('should delete a store payment method', async () => {
      jest
        .spyOn(mockPrismaService.store_users, 'findFirst')
        .mockResolvedValue({ id: 1 });
      jest
        .spyOn(mockPrismaService.store_payment_methods, 'findFirst')
        .mockResolvedValue({
          ...mockStorePaymentMethod,
          _count: { payments: 0 },
        });
      jest
        .spyOn(mockPrismaService.store_payment_methods, 'delete')
        .mockResolvedValue(mockStorePaymentMethod);

      const result = await service.removeFromStore(1, 1, mockUser);

      expect(result).toEqual({
        success: true,
        message: 'Payment method removed from store',
      });
    });
  });
});
