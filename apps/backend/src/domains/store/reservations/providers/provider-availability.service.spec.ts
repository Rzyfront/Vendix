import { ProviderAvailabilityService } from './provider-availability.service';
import { BusinessHoursService } from '../business-hours/business-hours.service';

describe('ProviderAvailabilityService.getOverview', () => {
  function build(schedules: Array<{
    provider_id: number;
    day_of_week: number;
    start_time: string;
    end_time: string;
  }>) {
    const prisma: any = {
      service_providers: {
        findMany: jest.fn().mockResolvedValue([
          { id: 1, display_name: 'Ana', avatar_url: null },
        ]),
      },
      provider_exceptions: { findMany: jest.fn().mockResolvedValue([]) },
      bookings: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const businessHours = {
      loadProviderBlocks: jest.fn().mockResolvedValue(
        schedules.map((s, idx) => ({
          ...s,
          block_order: idx,
          is_active: true,
          inherited: true,
        })),
      ),
    } as unknown as BusinessHoursService;
    return new ProviderAvailabilityService(prisma, businessHours);
  }

  // 2026-11-13 is Friday (day_of_week = 5).
  const FRIDAY = '2026-11-13';

  it('counts 24 h blocks (00:00-00:00) using windowSpan', async () => {
    const service = build([
      { provider_id: 1, day_of_week: 5, start_time: '00:00', end_time: '00:00' },
    ]);
    const overview = await service.getOverview({
      date_from: FRIDAY,
      date_to: FRIDAY,
      slot_minutes: 60,
    });
    expect(overview.providers[0].days[0].total_slots).toBe(24);
    expect(overview.totals.total_slots).toBe(24);
  });

  it('counts overnight blocks (17:00-04:00) using windowSpan', async () => {
    const service = build([
      { provider_id: 1, day_of_week: 5, start_time: '17:00', end_time: '04:00' },
    ]);
    const overview = await service.getOverview({
      date_from: FRIDAY,
      date_to: FRIDAY,
      slot_minutes: 60,
    });
    // 17:00 -> 04:00 = 11 hours = 11 slots of 60 min.
    expect(overview.providers[0].days[0].total_slots).toBe(11);
  });

  it('keeps daytime slot counting unchanged', async () => {
    const service = build([
      { provider_id: 1, day_of_week: 5, start_time: '09:00', end_time: '17:00' },
    ]);
    const overview = await service.getOverview({
      date_from: FRIDAY,
      date_to: FRIDAY,
      slot_minutes: 30,
    });
    expect(overview.providers[0].days[0].total_slots).toBe(16);
  });
});
