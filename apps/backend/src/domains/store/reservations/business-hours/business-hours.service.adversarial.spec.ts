/**
 * Adversarial QA spec for BusinessHoursService and its use as the master
 * calendar in AvailabilityService. Assertions describe the CORRECT business
 * behavior; a failing test is a finding.
 */
import { BadRequestException } from '@nestjs/common';
import { BusinessHoursService } from './business-hours.service';
import { AvailabilityService } from '../availability.service';

function prismaWith(posBusinessHours: Record<string, any>) {
  const prisma: any = {
    store_settings: {
      findUnique: jest.fn().mockResolvedValue({
        settings: { pos: { business_hours: posBusinessHours } },
      }),
      findFirst: jest.fn().mockResolvedValue({ settings: {}, stores: { timezone: 'America/Bogota' } }),
    },
    store_business_hours: { findMany: jest.fn().mockResolvedValue([]) },
    products: {
      findFirst: jest.fn().mockResolvedValue({ id: 10, store_id: 1, booking_mode: 'provider_required' }),
    },
    provider_services: { findFirst: jest.fn().mockResolvedValue({ provider_id: 5 }) },
    provider_schedules: {
      findMany: jest.fn().mockResolvedValue([
        { provider_id: 5, day_of_week: 4, start_time: '08:00', end_time: '18:00', is_active: true },
      ]),
    },
    provider_exceptions: { findFirst: jest.fn().mockResolvedValue(null) },
    bookings: { count: jest.fn().mockResolvedValue(0) },
  };
  prisma.$transaction = jest.fn((fn: any) => fn(prisma));
  return prisma;
}

describe('BusinessHoursService (adversarial)', () => {
  it('rejects end_time == start_time on upsert', async () => {
    const svc = new BusinessHoursService(prismaWith({}));
    await expect(
      svc.upsertAll(1, { items: [{ day_of_week: 1, start_time: '10:00', end_time: '10:00' }] } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects duplicated day_of_week on upsert', async () => {
    const svc = new BusinessHoursService(prismaWith({}));
    await expect(
      svc.upsertAll(1, {
        items: [
          { day_of_week: 1, start_time: '08:00', end_time: '12:00' },
          { day_of_week: 1, start_time: '14:00', end_time: '18:00' },
        ],
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('a slot during the store lunch break (blocks 08-12 / 14-18) is NOT bookable', async () => {
    const prisma = prismaWith({
      thursday: {
        is_active: true,
        blocks: [
          { open: '08:00', close: '12:00' },
          { open: '14:00', close: '18:00' },
        ],
      },
    });
    const availability = new AvailabilityService(prisma, new BusinessHoursService(prisma));
    await expect(
      availability.isSlotAvailable(10, '2026-11-05', '12:30', '13:30', 5),
    ).resolves.toBe(false);
  });

  it('a closed day (is_active=false) offers no availability', async () => {
    const prisma = prismaWith({
      thursday: { is_active: false, open: '08:00', close: '18:00' },
      friday: { is_active: true, open: '08:00', close: '18:00' },
    });
    const availability = new AvailabilityService(prisma, new BusinessHoursService(prisma));
    await expect(
      availability.isSlotAvailable(10, '2026-11-05', '10:00', '11:00', 5),
    ).resolves.toBe(false);
  });
});
