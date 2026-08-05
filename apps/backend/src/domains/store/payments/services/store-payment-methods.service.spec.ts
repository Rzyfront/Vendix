import { Test, TestingModule } from '@nestjs/testing';
import { StorePaymentMethodsService } from '../services/store-payment-methods.service';
import { PaymentEncryptionService } from './payment-encryption.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RequestContextService } from '../../../../common/context/request-context.service';

describe('StorePaymentMethodsService', () => {
  let service: StorePaymentMethodsService;
  let prisma: StorePrismaService;

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
    // enableForStore checks for an existing row through `withoutScope()`: the
    // store filter would hide a row belonging to the very store being enabled
    // when the ALS context has not been established yet. The mock exposes the
    // same model doubles so the tests' spies still govern that read.
    withoutScope() {
      return {
        store_payment_methods: this.store_payment_methods,
        system_payment_methods: this.system_payment_methods,
      };
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
          provide: StorePrismaService,
          useValue: mockPrismaService,
        },
        // encryptConfig/decryptConfig are identity here: these tests assert the
        // CRUD contract, not the cipher (EncryptionService owns that, with its
        // own key-cascade tests). maskConfig returns the config untouched so a
        // response assertion can still see the fields it expects.
        {
          provide: PaymentEncryptionService,
          useValue: {
            encryptConfig: jest.fn((cfg) => cfg),
            decryptConfig: jest.fn((cfg) => cfg),
            maskConfig: jest.fn((cfg) => cfg),
          },
        },
      ],
    }).compile();

    service = module.get<StorePaymentMethodsService>(
      StorePaymentMethodsService,
    );
    prisma = module.get<StorePrismaService>(StorePrismaService);
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

      const result = await service.getEnabledForStore();

      expect(result).toEqual([mockStorePaymentMethod]);
    });
  });

  describe('enableForStore', () => {
    // enableForStore is a WRITE: it takes the tenant from the ALS context rather
    // than a parameter, so without a context it throws Forbidden before any
    // business rule runs. Each case here asserts a rule, so the context is
    // established first.
    beforeEach(() => {
      jest
        .spyOn(RequestContextService, 'getContext')
        .mockReturnValue({ store_id: 1 } as any);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

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

      const result = await service.enableForStore(1, enableDto);

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
        await service.enableForStore(999, enableDto);
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
        await service.enableForStore(1, enableDto);
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

      const result = await service.updateStoreMethod(1, updateDto);

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

      const result = await service.removeFromStore(1);

      expect(result).toEqual({
        success: true,
        message: 'Payment method removed from store',
      });
    });
  });
});
