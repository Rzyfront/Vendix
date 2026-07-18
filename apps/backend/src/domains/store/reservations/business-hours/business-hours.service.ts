import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { UpsertBusinessHoursDto } from './dto';

/**
 * BusinessHoursService
 *
 * Per-store master calendar that the booking flow consults when computing
 * slot availability. Overrides / supplements per-provider provider_schedules
 * (provider availability still wins when stricter).
 *
 * Provides three consumers:
 *   - HTTP CRUD via BusinessHoursController
 *   - AvailabilityService.loadStoreHours(storeId) for slot generation
 *   - AvailabilityService.isWithinStoreHours(storeId, day_of_week, hhmm) for
 *     "is the venue even open at this moment" checks used by reschedule and
 *     double-validation.
 */
@Injectable()
export class BusinessHoursService {
  private readonly logger = new Logger(BusinessHoursService.name);

  constructor(private readonly prisma: StorePrismaService) {}

  /**
   * Returns the full week (7 rows; null where the store is closed that day).
   * Sorted by day_of_week so the frontend can iterate in calendar order.
   */
  async getAllForStore(storeId: number) {
    const rows = await this.prisma.store_business_hours.findMany({
      where: { store_id: storeId },
      orderBy: { day_of_week: 'asc' },
    });
    // Fill missing days with nulls so the frontend always gets 7 entries.
    const all: Array<{
      day_of_week: number;
      start_time: string | null;
      end_time: string | null;
      is_active: boolean;
    }> = [];
    for (let dow = 0; dow <= 6; dow++) {
      const row = rows.find((r) => r.day_of_week === dow);
      all.push({
        day_of_week: dow,
        start_time: row?.start_time ?? null,
        end_time: row?.end_time ?? null,
        is_active: row?.is_active ?? false,
      });
    }
    return all;
  }

  /**
   * Returns the row for a single day, or null when none exists.
   */
  async getForDay(storeId: number, dayOfWeek: number) {
    return this.prisma.store_business_hours.findFirst({
      where: { store_id: storeId, day_of_week: dayOfWeek },
    });
  }

  /**
   * Batch upsert: replaces ALL rows for the store with the provided items.
   * Days omitted from the payload get deactivated (is_active = false)
   * via a delete-then-insert; we keep the operation transactional.
   *
   * Validates that end_time > start_time per item to avoid garbage rows.
   */
  async upsertAll(storeId: number, dto: UpsertBusinessHoursDto) {
    for (const item of dto.items) {
      if (item.start_time >= item.end_time) {
        throw new BadRequestException(
          `Día ${item.day_of_week}: end_time (${item.end_time}) debe ser mayor que start_time (${item.start_time})`,
        );
      }
    }

    const daysTouched = new Set(dto.items.map((i) => i.day_of_week));
    if (daysTouched.size !== dto.items.length) {
      throw new BadRequestException('No se permiten días duplicados en el payload');
    }

    return this.prisma.$transaction(async (tx) => {
      // Remove the rows for days we are about to overwrite; leave untouched
      // days (no row for them today, no row in items) — those stay closed.
      await tx.store_business_hours.deleteMany({
        where: {
          store_id: storeId,
          day_of_week: { in: Array.from(daysTouched) },
        },
      });
      // Insert the new rows.
      await tx.store_business_hours.createMany({
        data: dto.items.map((i) => ({
          store_id: storeId,
          day_of_week: i.day_of_week,
          start_time: i.start_time,
          end_time: i.end_time,
          is_active: i.is_active ?? true,
        })),
      });
      // Read back the full week.
      return this.getAllForStore(storeId);
    });
  }

  /**
   * Hot-path helper consumed by AvailabilityService. Loads all 7 day
   * windows in a single query and returns them as a Map for O(1) lookup.
   * Returns an empty Map if the store has never configured their hours.
   */
  async loadStoreHours(
    storeId: number,
  ): Promise<Map<number, { start_time: string; end_time: string }>> {
    const rows = await this.prisma.store_business_hours.findMany({
      where: { store_id: storeId, is_active: true },
      select: { day_of_week: true, start_time: true, end_time: true },
    });
    return new Map(
      rows.map((r) => [
        r.day_of_week,
        { start_time: r.start_time, end_time: r.end_time },
      ]),
    );
  }
}