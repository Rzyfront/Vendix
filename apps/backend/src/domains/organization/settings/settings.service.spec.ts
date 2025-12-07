import { Test, TestingModule } from '@nestjs/testing';
import { SettingsService } from './settings.service';
import { OrganizationPrismaService } from '../../../prisma/services/organization-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { NotFoundException } from '@nestjs/common';

describe('SettingsService', () => {
    let service: SettingsService;
    let prismaService: OrganizationPrismaService;

    const mockPrismaService = {
        organization_settings: {
            findFirst: jest.fn(),
            update: jest.fn(),
            create: jest.fn(),
        },
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                SettingsService,
                {
                    provide: OrganizationPrismaService,
                    useValue: mockPrismaService,
                },
            ],
        }).compile();

        service = module.get<SettingsService>(SettingsService);
        prismaService = module.get<OrganizationPrismaService>(OrganizationPrismaService);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('findOne', () => {
        it('should return settings if found', async () => {
            const settings = { id: 1, settings: {} };
            mockPrismaService.organization_settings.findFirst.mockResolvedValue(settings);

            const result = await service.findOne();
            expect(result).toEqual(settings);
        });

        it('should throw NotFoundException if not found', async () => {
            mockPrismaService.organization_settings.findFirst.mockResolvedValue(null);

            await expect(service.findOne()).rejects.toThrow(NotFoundException);
        });
    });

    describe('update', () => {
        it('should update existing settings', async () => {
            const dto = { settings: { theme: 'dark' } };
            const existing = { id: 1 };
            const updated = { id: 1, ...dto };

            mockPrismaService.organization_settings.findFirst.mockResolvedValue(existing);
            mockPrismaService.organization_settings.update.mockResolvedValue(updated);

            const result = await service.update(dto);

            expect(mockPrismaService.organization_settings.update).toHaveBeenCalledWith({
                where: { id: existing.id },
                data: expect.objectContaining({ settings: dto.settings }) as any,
            });
            expect(result).toEqual(updated);
        });

        it('should create settings if not found', async () => {
            const dto = { settings: { theme: 'dark' } };
            const created = { id: 1, ...dto };

            mockPrismaService.organization_settings.findFirst.mockResolvedValue(null);
            mockPrismaService.organization_settings.create.mockResolvedValue(created);

            jest.spyOn(RequestContextService, 'getContext').mockReturnValue({ organization_id: 123 } as any);

            const result = await service.update(dto);

            expect(mockPrismaService.organization_settings.create).toHaveBeenCalledWith({
                data: {
                    settings: dto.settings,
                    organization_id: 123,
                },
            });
            expect(result).toEqual(created);
        });
    });
});
