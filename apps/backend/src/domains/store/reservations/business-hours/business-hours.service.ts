import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { UpsertBusinessHoursDto } from './dto';
import {
  ClockWindow,
  isClockTime,
  isOvernight,
  validateWeeklyBlocks,
  windowSpan,
} from '../../../../common/utils/schedule-window.util';

const minutesToClock = (min: number) => {
  const m = min % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

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
   * end_time <= start_time is valid and means the block ends the next day (S21).
   */
  async upsertAll(storeId: number, dto: UpsertBusinessHoursDto) {
    // S21: end <= start means the block ends the next day (00:00-00:00 = 24 h).
    // Blocks must keep the HH:MM format and must not overlap, including the
    // previous day's overnight spill.
    const invalid = validateWeeklyBlocks(
      dto.items.map((i) => ({
        day: i.day_of_week,
        start_time: i.start_time,
        end_time: i.end_time,
      })),
    );
    if (invalid) {
      throw new BadRequestException(
        invalid.reason === 'overlap'
          ? `Día ${invalid.day}: el horario se cruza con otro bloque (incluido el que termina de madrugada del día anterior)`
          : `Día ${invalid.day}: las horas deben tener formato HH:mm`,
      );
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
   * Hot-path helper consumed by AvailabilityService: the store windows per
   * weekday (0 = Sunday), read from `settings.pos.business_hours` first and
   * from the legacy `store_business_hours` table as a fallback. An empty Map
   * means the store never configured its hours.
   *
   * A day whose blocks all stay inside the day collapses to the outer envelope
   * [earliest open, latest close] — the historical behavior of the slot
   * generator (it ignores lunch gaps). A day with a block that crosses
   * midnight (S21) keeps every block, because an envelope would be ambiguous.
   * Callers that need per-block fidelity use `loadStoreWindows`.
   */
  async loadStoreHours(
    storeId: number,
    prisma: StorePrismaService = this.prisma,
  ): Promise<Map<number, ClockWindow[]>> {
    const windows = await this.loadStoreWindows(storeId, prisma);
    const out = new Map<number, ClockWindow[]>();
    for (const [dow, list] of windows) {
      if (list.some(isOvernight)) {
        out.set(dow, list);
        continue;
      }
      const spans = list.map(windowSpan);
      out.set(dow, [
        {
          start_time: minutesToClock(Math.min(...spans.map((s) => s.startMin))),
          end_time: minutesToClock(Math.max(...spans.map((s) => s.endMin))),
        },
      ]);
    }
    return out;
  }

  /**
   * Returns the FULL set of working windows per day — including any
   * lunch-break / split-shift gaps when the operator configured
   * TIPO DE HORARIO = "Personalizado" with multiple blocks.
   *
   * Shape: Map<day_of_week (0..6), Array<{ start_time, end_time }>>.
   * An empty array for a given day means "store closed". For the
   * continuous mode, each day has exactly one entry [open, close].
   *
   * Previously the slot generator collapsed the per-day array to the
   * OUTER envelope (earliest open, latest close), which silently
   * destroyed lunch breaks and made "horario personalizado" look like
   * "horario continuo". This method exposes the per-block fidelity the
   * availability service needs to skip lunch gaps.
   */
  async loadStoreWindows(
    storeId: number,
    prisma: StorePrismaService = this.prisma,
  ): Promise<Map<number, Array<{ start_time: string; end_time: string }>>> {
    // Try the POS settings JSON first (single source of truth).
    const fromPos = await this.loadStoreWindowsFromPosSettings(storeId, prisma);
    if (fromPos.size > 0) return fromPos;

    // Fallback: legacy store_business_hours table.
    const rows = await prisma.store_business_hours.findMany({
      where: { store_id: storeId, is_active: true },
      select: { day_of_week: true, start_time: true, end_time: true },
      orderBy: [{ day_of_week: 'asc' }, { start_time: 'asc' }],
    });
    const out = new Map<
      number,
      Array<{ start_time: string; end_time: string }>
    >();
    for (const r of rows) {
      const list = out.get(r.day_of_week) ?? [];
      list.push({ start_time: r.start_time, end_time: r.end_time });
      out.set(r.day_of_week, list);
    }
    return out;
  }

  /**
   * POS-settings-backed variant of `loadStoreWindows`. Same JSON shape
   * as the old envelope reader but preserves every block per
   * day instead of collapsing to the outer envelope.
   *
   * For TIPO DE HORARIO = "Continuo" emits a single window per day.
   * For "Personalizado" emits ALL the operator-configured blocks in
   * their `start_time` order, so the slot generator can skip the
   * lunch gap.
   */
  private async loadStoreWindowsFromPosSettings(
    storeId: number,
    prisma: StorePrismaService = this.prisma,
  ): Promise<Map<number, Array<{ start_time: string; end_time: string }>>> {
    const row = await prisma.store_settings.findUnique({
      where: { store_id: storeId },
      select: { settings: true },
    });
    const businessHours = (row?.settings as any)?.pos?.business_hours as
      | Record<
          string,
          | string
          | {
              open?: string;
              close?: string;
              is_active?: boolean;
              blocks?: Array<{ open: string; close: string }>;
            }
        >
      | undefined;
    if (!businessHours) return new Map();

    const out = new Map<
      number,
      Array<{ start_time: string; end_time: string }>
    >();
    const dowMap: Record<string, number> = {
      sunday: 0,
      monday: 1,
      tuesday: 2,
      wednesday: 3,
      thursday: 4,
      friday: 5,
      saturday: 6,
    };
    for (const [dayKey, value] of Object.entries(businessHours)) {
      const dow = dowMap[dayKey.toLowerCase()];
      if (dow === undefined) continue;
      if (typeof value === 'string') continue;
      if (value?.is_active === false) continue;

      const windows: Array<{ start_time: string; end_time: string }> = [];
      const blocks = (value as any).blocks as
        | Array<{ open: string; close: string }>
        | undefined;
      if (Array.isArray(blocks) && blocks.length > 0) {
        for (const b of blocks) {
          const block = this.normalizeBlock(b?.open, b?.close);
          if (block) windows.push(block);
        }
        windows.sort((a, b) =>
          a.start_time < b.start_time ? -1 : a.start_time > b.start_time ? 1 : 0,
        );
      }
      const open = (value as any).open as string | undefined;
      const close = (value as any).close as string | undefined;
      if (!windows.length) {
        const block = this.normalizeBlock(open, close);
        if (block) windows.push(block);
      }
      if (windows.length) out.set(dow, windows);
    }
    return out;
  }

  /**
   * A POS block is valid when both ends are HH:MM. `end <= start` is kept (it
   * ends the next day, S21); `24:00` is read as `00:00`.
   */
  private normalizeBlock(open?: string, close?: string): ClockWindow | null {
    const end = close === '24:00' ? '00:00' : close;
    if (!isClockTime(open) || !isClockTime(end)) return null;
    return { start_time: open, end_time: end };
  }
}
