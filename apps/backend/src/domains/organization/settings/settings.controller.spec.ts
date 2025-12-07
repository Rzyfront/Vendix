import { Test, TestingModule } from '@nestjs/testing';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

describe('SettingsController', () => {
    let controller: SettingsController;
    let service: SettingsService;

    const mockSettingsService = {
        findOne: jest.fn(),
        update: jest.fn(),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [SettingsController],
            providers: [
                {
                    provide: SettingsService,
                    useValue: mockSettingsService,
                },
            ],
        }).compile();

        controller = module.get<SettingsController>(SettingsController);
        service = module.get<SettingsService>(SettingsService);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('findOne', () => {
        it('should return settings', async () => {
            const result = { id: 1, settings: {} };
            mockSettingsService.findOne.mockResolvedValue(result);

            expect(await controller.findOne()).toEqual(result);
            expect(service.findOne).toHaveBeenCalled();
        });
    });

    describe('update', () => {
        it('should update settings', async () => {
            const dto = { settings: { theme: 'dark' } };
            const result = { id: 1, ...dto };
            mockSettingsService.update.mockResolvedValue(result);

            expect(await controller.update(dto)).toEqual(result);
            expect(service.update).toHaveBeenCalledWith(dto);
        });
    });
});
