import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { CustomerQueueService } from './customer-queue.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { CustomersService } from '../customers/customers.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

describe('CustomerQueueService', () => {
  let service: CustomerQueueService;
  let prismaService: StorePrismaService;
  let customersService: CustomersService;
  let eventEmitter: EventEmitter2;

  const mockPrismaService = {
    customer_queue: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    store_settings: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockCustomersService = {
    create: jest.fn(),
  };

  const mockEventEmitter = {
    emit: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomerQueueService,
        {
          provide: StorePrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: CustomersService,
          useValue: mockCustomersService,
        },
        {
          provide: EventEmitter2,
          useValue: mockEventEmitter,
        },
      ],
    }).compile();

    service = module.get<CustomerQueueService>(CustomerQueueService);
    prismaService = module.get<StorePrismaService>(StorePrismaService);
    customersService = module.get<CustomersService>(CustomersService);
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);

    jest.clearAllMocks();
  });

  describe('findByDocument', () => {
    it('should return active queue entry by document with current position calculated', async () => {
      const storeId = 1;
      const documentType = 'cc';
      const documentNumber = '12345678';

      const mockEntry = {
        id: 1,
        store_id: storeId,
        token: 'abc-token-123',
        first_name: 'Juan',
        last_name: 'Pérez',
        document_type: 'CC',
        document_number: '12345678',
        email: 'juan@example.com',
        phone: '3001234567',
        status: 'waiting',
        position: 3,
        expires_at: new Date(Date.now() + 3600000),
        created_at: new Date(),
        updated_at: new Date(),
        selected_by: null,
        consumed_at: null,
        order_id: null,
        customer_id: null,
      };

      mockPrismaService.customer_queue.findFirst.mockResolvedValue(mockEntry);
      mockPrismaService.customer_queue.count.mockResolvedValue(3);

      const result = await service.findByDocument(storeId, documentType, documentNumber);

      expect(result).toEqual({
        ...mockEntry,
        current_position: 3,
      });
      expect(mockPrismaService.customer_queue.findFirst).toHaveBeenCalledWith({
        where: {
          store_id: storeId,
          document_type: 'CC',
          document_number: '12345678',
          status: { in: ['waiting', 'selected'] },
          expires_at: { gt: expect.any(Date) },
        },
        orderBy: { created_at: 'desc' },
      });
      expect(mockPrismaService.customer_queue.count).toHaveBeenCalled();
    });

    it('should throw NotFoundException when document entry does not exist', async () => {
      const storeId = 1;
      const documentType = 'cc';
      const documentNumber = '99999999';

      mockPrismaService.customer_queue.findFirst.mockResolvedValue(null);

      await expect(
        service.findByDocument(storeId, documentType, documentNumber)
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.findByDocument(storeId, documentType, documentNumber)
      ).rejects.toThrow('QUEUE_ENTRY_NOT_FOUND');
    });

    it('should throw BadRequestException when document fields are invalid', async () => {
      const storeId = 1;

      await expect(
        service.findByDocument(storeId, '', '12345678')
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.findByDocument(storeId, 'CC', '')
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.findByDocument(storeId, '', '')
      ).rejects.toThrow(BadRequestException);
    });

    it('should normalize document type to uppercase and number (remove separators)', async () => {
      const storeId = 1;
      const documentType = 'cc';
      const documentNumber = '1234-5678';

      const mockEntry = {
        id: 1,
        store_id: storeId,
        token: 'abc-token-123',
        first_name: 'Juan',
        last_name: 'Pérez',
        document_type: 'CC',
        document_number: '12345678',
        email: 'juan@example.com',
        phone: '3001234567',
        status: 'waiting',
        position: 3,
        expires_at: new Date(Date.now() + 3600000),
        created_at: new Date(),
        updated_at: new Date(),
        selected_by: null,
        consumed_at: null,
        order_id: null,
        customer_id: null,
      };

      mockPrismaService.customer_queue.findFirst.mockResolvedValue(mockEntry);
      mockPrismaService.customer_queue.count.mockResolvedValue(1);

      const result = await service.findByDocument(storeId, documentType, documentNumber);

      expect(result).toEqual({
        ...mockEntry,
        current_position: 1,
      });
      expect(mockPrismaService.customer_queue.findFirst).toHaveBeenCalledWith({
        where: {
          store_id: storeId,
          document_type: 'CC',
          document_number: '12345678',
          status: { in: ['waiting', 'selected'] },
          expires_at: { gt: expect.any(Date) },
        },
        orderBy: { created_at: 'desc' },
      });
    });
  });
});
