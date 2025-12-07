import { Test, TestingModule } from '@nestjs/testing';
import { AddressesService } from './addresses.service';
import { OrganizationPrismaService } from '../../../prisma/services/organization-prisma.service';
import { AccessValidationService } from '@common/services/access-validation.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('AddressesService', () => {
    let service: AddressesService;
    let prismaService: OrganizationPrismaService;
    let accessValidation: AccessValidationService;

    const mockPrismaService = {
        addresses: {
            create: jest.fn(),
            findMany: jest.fn(),
            findFirst: jest.fn(),
            count: jest.fn(),
            update: jest.fn(),
            updateMany: jest.fn(),
            delete: jest.fn(),
        },
        orders: {
            count: jest.fn(),
        },
    };

    const mockAccessValidation = {
        validateStoreAccess: jest.fn(),
        validateOrganizationAccess: jest.fn(),
        validateUserAccess: jest.fn(),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AddressesService,
                {
                    provide: OrganizationPrismaService,
                    useValue: mockPrismaService,
                },
                {
                    provide: AccessValidationService,
                    useValue: mockAccessValidation,
                },
            ],
        }).compile();

        service = module.get<AddressesService>(AddressesService);
        prismaService = module.get<OrganizationPrismaService>(OrganizationPrismaService);
        accessValidation = module.get<AccessValidationService>(AccessValidationService);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('create', () => {
        it('should create an address for an organization', async () => {
            const dto = {
                organization_id: 1,
                address_line_1: '123 Main St',
                city: 'City',
                state: 'State',
                postal_code: '12345',
                country: 'US',
                type: 'BILLING',
                is_primary: true,
            };
            const user = { id: 1, organization_id: 1 };

            mockPrismaService.addresses.create.mockResolvedValue({ id: 1, ...dto });

            await service.create(dto as any, user);

            expect(mockAccessValidation.validateOrganizationAccess).toHaveBeenCalledWith(1, user);
            expect(mockPrismaService.addresses.create).toHaveBeenCalled();
        });

        it('should throw BadRequest if multiple entity types provided', async () => {
            const dto = {
                organization_id: 1,
                store_id: 1,
                address_line_1: '123 Main St',
            };
            const user = { id: 1 };

            await expect(service.create(dto as any, user)).rejects.toThrow(BadRequestException);
        });
    });

    describe('findAll', () => {
        it('should return addresses', async () => {
            const query = { limit: 10, page: 1 };
            const user = { id: 1, organization_id: 1 };
            const addresses = [{ id: 1, address_line1: '123 Main St' }];

            mockPrismaService.addresses.findMany.mockResolvedValue(addresses);
            mockPrismaService.addresses.count.mockResolvedValue(1);

            const result = await service.findAll(query as any, user);

            expect(result.data).toEqual(addresses);
            expect(result.meta.total).toBe(1);
        });
    });

    describe('findOne', () => {
        it('should return an address if allowed', async () => {
            const id = 1;
            const user = { id: 1, organization_id: 1 };
            const address = { id, organization_id: 1, address_line1: '123 Main St' };

            mockPrismaService.addresses.findFirst.mockResolvedValue(address);

            const result = await service.findOne(id, user);

            expect(result).toEqual(address);
        });

        it('should throw NotFoundException if address not found', async () => {
            const id = 1;
            const user = { id: 1 };

            mockPrismaService.addresses.findFirst.mockResolvedValue(null);

            await expect(service.findOne(id, user)).rejects.toThrow(NotFoundException);
        });
    });

    describe('update', () => {
        it('should update an address', async () => {
            const id = 1;
            const dto = { address_line_1: '456 New St' };
            const user = { id: 1 };
            const address = { id, organization_id: 1 };

            mockPrismaService.addresses.findFirst.mockResolvedValue(address);
            mockPrismaService.addresses.update.mockResolvedValue({ ...address, ...dto });

            await service.update(id, dto as any, user);

            expect(mockPrismaService.addresses.update).toHaveBeenCalled();
        });
    });

    describe('remove', () => {
        it('should remove an address if not used in orders', async () => {
            const id = 1;
            const user = { id: 1 };
            const address = { id, organization_id: 1 };

            mockPrismaService.addresses.findFirst.mockResolvedValue(address);
            mockPrismaService.orders.count.mockResolvedValue(0);

            await service.remove(id, user);

            expect(mockPrismaService.addresses.delete).toHaveBeenCalledWith({ where: { id } });
        });

        it('should throw BadRequest if address used in orders', async () => {
            const id = 1;
            const user = { id: 1 };
            const address = { id, organization_id: 1 };

            mockPrismaService.addresses.findFirst.mockResolvedValue(address);
            mockPrismaService.orders.count.mockResolvedValue(1);

            await expect(service.remove(id, user)).rejects.toThrow(BadRequestException);
        });
    });
});
