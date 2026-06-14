import { Test, TestingModule } from '@nestjs/testing';
import { MenuAvailabilityService } from './menu-availability.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from 'src/common/errors';

const STORE_ID = 5;

describe('MenuAvailabilityService — window validation', () => {
  let service: MenuAvailabilityService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      menus: {
        findFirst: jest.fn().mockResolvedValue({ id: 1 }),
      },
      menu_sections: {
        findFirst: jest.fn().mockResolvedValue({ id: 99 }),
      },
      menu_availability_windows: {
        findFirst: jest.fn().mockResolvedValue({
          id: 1,
          store_id: STORE_ID,
          menu_id: 1,
          menu_section_id: null,
          day_of_week: 1,
          start_time: '08:00',
          end_time: '12:00',
        }),
        create: jest.fn().mockImplementation(({ data }: any) => ({
          id: 50,
          ...data,
        })),
        update: jest.fn().mockImplementation(({ where, data }: any) => ({
          id: where.id,
          ...data,
        })),
        delete: jest.fn().mockResolvedValue({ id: 1 }),
      },
    };
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: STORE_ID } as any);
    service = new MenuAvailabilityService(prisma as any);
  });

  it('rejects windows where end_time <= start_time', async () => {
    await expect(
      service.create(1, {
        day_of_week: 1,
        start_time: '12:00',
        end_time: '11:00',
      } as any),
    ).rejects.toBeInstanceOf(VendixHttpException);
  });

  it('rejects windows with malformed HH:mm', async () => {
    await expect(
      service.create(1, {
        day_of_week: 1,
        start_time: '8am',
        end_time: '11:00',
      } as any),
    ).rejects.toBeInstanceOf(VendixHttpException);
  });

  it('creates a valid window', async () => {
    const result = await service.create(1, {
      day_of_week: 1,
      start_time: '08:00',
      end_time: '12:00',
    } as any);
    expect(result).toMatchObject({
      store_id: STORE_ID,
      menu_id: 1,
      day_of_week: 1,
    });
    expect(prisma.menu_availability_windows.create).toHaveBeenCalled();
  });
});
