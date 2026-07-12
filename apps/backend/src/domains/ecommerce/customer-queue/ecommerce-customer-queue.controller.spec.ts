import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { EcommerceCustomerQueueController } from './ecommerce-customer-queue.controller';
import { CustomerQueueService } from '../../store/customer-queue/customer-queue.service';
import { ResponseService } from '@common/responses/response.service';
import { RequestContextService } from '@common/context/request-context.service';
import { SearchQueueEntryDto } from '../../store/customer-queue/dto/search-queue-entry.dto';

describe('EcommerceCustomerQueueController', () => {
  let controller: EcommerceCustomerQueueController;
  let queueService: CustomerQueueService;
  let responseService: ResponseService;

  const mockQueueService = {
    addToQueue: jest.fn(),
    getEntryByToken: jest.fn(),
    findByDocument: jest.fn(),
  };

  const mockResponseService = {
    success: jest.fn(),
    created: jest.fn(),
    error: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [EcommerceCustomerQueueController],
      providers: [
        {
          provide: CustomerQueueService,
          useValue: mockQueueService,
        },
        {
          provide: ResponseService,
          useValue: mockResponseService,
        },
      ],
    }).compile();

    controller = module.get<EcommerceCustomerQueueController>(EcommerceCustomerQueueController);
    queueService = module.get<CustomerQueueService>(CustomerQueueService);
    responseService = module.get<ResponseService>(ResponseService);

    jest.clearAllMocks();

    // Mock RequestContextService to provide store context
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
      store_id: 1,
      organization_id: 1,
    } as any);
  });

  describe('search', () => {
    it('should return found entry with position when document exists in active queue', async () => {
      const dto: SearchQueueEntryDto = {
        document_type: 'CC',
        document_number: '12345678',
      };

      const mockEntry = {
        id: 1,
        store_id: 1,
        document_type: 'CC',
        document_number: '12345678',
        first_name: 'Juan',
        last_name: 'Pérez',
        status: 'waiting',
        position: 3,
        current_position: 3,
        token: 'abc-123',
        created_at: new Date(),
        updated_at: new Date(),
        expires_at: new Date(Date.now() + 3600000),
        email: 'juan@example.com',
        phone: '3001234567',
        selected_by: null,
        consumed_at: null,
        order_id: null,
        customer_id: null,
      };

      const successResponse = {
        success: true as const,
        data: {
          found: true,
          position: 3,
          status: 'waiting',
          first_name: 'Juan',
        },
      };

      mockQueueService.findByDocument.mockResolvedValue(mockEntry);
      mockResponseService.success.mockReturnValue(successResponse);

      const result = await controller.search(dto);

      expect(result).toEqual(successResponse);
      expect(mockQueueService.findByDocument).toHaveBeenCalledWith(1, 'CC', '12345678');
      expect(mockResponseService.success).toHaveBeenCalledWith({
        found: true,
        position: 3,
        status: 'waiting',
        first_name: 'Juan',
      });
    });

    it('should return not found when document does not exist or is expired', async () => {
      const dto: SearchQueueEntryDto = {
        document_type: 'CC',
        document_number: '99999999',
      };

      const notFoundResponse = {
        success: true as const,
        data: {
          found: false,
          message: 'No active queue entry found for this document',
        },
      };

      mockQueueService.findByDocument.mockRejectedValue(
        new Error('QUEUE_ENTRY_NOT_FOUND')
      );
      mockResponseService.success.mockReturnValue(notFoundResponse);

      const result = await controller.search(dto);

      expect(result).toEqual(notFoundResponse);
      expect(mockQueueService.findByDocument).toHaveBeenCalledWith(
        1,
        'CC',
        '99999999'
      );
    });

    it('should throw BadRequestException when store context is missing', async () => {
      const dto: SearchQueueEntryDto = {
        document_type: 'CC',
        document_number: '12345678',
      };

      jest.spyOn(RequestContextService, 'getContext').mockReturnValue(
        { store_id: undefined } as any
      );

      await expect(controller.search(dto)).rejects.toThrow(
        BadRequestException
      );
    });
  });
});
