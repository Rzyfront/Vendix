import { Test, TestingModule } from '@nestjs/testing';
import { AddressesController } from './addresses.controller';
import { AddressesService } from './addresses.service';
import { ResponseService } from '@common/responses/response.service';

describe('AddressesController', () => {
    let controller: AddressesController;
    let service: AddressesService;
    let responseService: ResponseService;

    const mockAddressesService = {
        create: jest.fn(),
        findAll: jest.fn(),
        findOne: jest.fn(),
        findByStore: jest.fn(),
        update: jest.fn(),
        remove: jest.fn(),
    };

    const mockResponseService = {
        created: jest.fn(),
        success: jest.fn(),
        paginated: jest.fn(),
        updated: jest.fn(),
        deleted: jest.fn(),
        error: jest.fn(),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [AddressesController],
            providers: [
                {
                    provide: AddressesService,
                    useValue: mockAddressesService,
                },
                {
                    provide: ResponseService,
                    useValue: mockResponseService,
                },
            ],
        }).compile();

        controller = module.get<AddressesController>(AddressesController);
        service = module.get<AddressesService>(AddressesService);
        responseService = module.get<ResponseService>(ResponseService);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('create', () => {
        it('should create an address', async () => {
            const dto = { address_line_1: '123 St' } as any;
            const req = { user: { id: 1 } } as any;
            const result = { id: 1 };

            mockAddressesService.create.mockResolvedValue(result);

            await controller.create(dto, req);

            expect(service.create).toHaveBeenCalledWith(dto, req.user);
            expect(responseService.created).toHaveBeenCalled();
        });
    });

    describe('findAll', () => {
        it('should return all addresses', async () => {
            const query = { limit: 10 } as any;
            const req = { user: { id: 1 } } as any;
            const result = { data: [], meta: { total: 0 } };

            mockAddressesService.findAll.mockResolvedValue(result);

            await controller.findAll(query, req);

            expect(service.findAll).toHaveBeenCalledWith(query, req.user);
            expect(responseService.paginated).toHaveBeenCalled();
        });
    });

    describe('findOne', () => {
        it('should return one address', async () => {
            const id = 1;
            const req = { user: { id: 1 } } as any;
            const result = { id: 1 };

            mockAddressesService.findOne.mockResolvedValue(result);

            await controller.findOne(id, req);

            expect(service.findOne).toHaveBeenCalledWith(id, req.user);
            expect(responseService.success).toHaveBeenCalled();
        });
    });

    describe('update', () => {
        it('should update an address', async () => {
            const id = 1;
            const dto = { address_line_1: 'New St' } as any;
            const req = { user: { id: 1 } } as any;
            const result = { id: 1 };

            mockAddressesService.update.mockResolvedValue(result);

            await controller.update(id, dto, req);

            expect(service.update).toHaveBeenCalledWith(id, dto, req.user);
            expect(responseService.updated).toHaveBeenCalled();
        });
    });

    describe('remove', () => {
        it('should remove an address', async () => {
            const id = 1;
            const req = { user: { id: 1 } } as any;

            mockAddressesService.remove.mockResolvedValue({ message: 'Deleted' });

            await controller.remove(id, req);

            expect(service.remove).toHaveBeenCalledWith(id, req.user);
            expect(responseService.deleted).toHaveBeenCalled();
        });
    });
});
