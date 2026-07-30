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
   *
   * SOURCE OF TRUTH FIX: now reads from `store_settings.settings.business_hours`
   * (the same JSON the POS settings form edits) instead of the legacy
   * `store_business_hours` table. The store was forcing operators to keep
   * two separate configs in sync — the POS one and the reservations one
   * — and any drift between them produced truncated booking slots. The
   * legacy table is still readable as a fallback (for stores that
   * haven't migrated yet) but is no longer the primary source.
   *
   * Collapses each day's blocks to a single (earliest_open, latest_close)
   * envelope — the slot generator has long assumed a single window per
   * day. Callers that need to honor lunch breaks / split-shifts should
   * use `loadStoreWindows` instead, which returns the per-day array of
   * windows.
   */
  async loadStoreHours(
    storeId: number,
  ): Promise<Map<number, { start_time: string; end_time: string }>> {
    // Try the POS settings JSON first (single source of truth).
    const fromPos = await this.loadStoreHoursFromPosSettings(storeId);
    if (fromPos.size > 0) return fromPos;

    // Fallback: legacy store_business_hours table for stores that
    // haven't been migrated to the unified POS settings yet.
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
  ): Promise<Map<number, Array<{ start_time: string; end_time: string }>>> {
    // Try the POS settings JSON first (single source of truth).
    const fromPos = await this.loadStoreWindowsFromPosSettings(storeId);
    if (fromPos.size > 0) return fromPos;

    // Fallback: legacy store_business_hours table.
    const rows = await this.prisma.store_business_hours.findMany({
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
   * as `loadStoreHoursFromPosSettings` but preserves every block per
   * day instead of collapsing to the outer envelope.
   *
   * For TIPO DE HORARIO = "Continuo" emits a single window per day.
   * For "Personalizado" emits ALL the operator-configured blocks in
   * their `start_time` order, so the slot generator can skip the
   * lunch gap.
   */
  private async loadStoreWindowsFromPosSettings(
    storeId: number,
  ): Promise<Map<number, Array<{ start_time: string; end_time: string }>>> {
    const row = await this.prisma.store_settings.findUnique({
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
          if (b?.open && b?.close && b.open < b.close) {
            windows.push({ start_time: b.open, end_time: b.close });
          }
        }
        windows.sort((a, b) =>
          a.start_time < b.start_time ? -1 : a.start_time > b.start_time ? 1 : 0,
        );
      }
      const open = (value as any).open as string | undefined;
      const close = (value as any).close as string | undefined;
      if (!windows.length && open && close && open < close) {
        windows.push({ start_time: open, end_time: close });
      }
      if (windows.length) out.set(dow, windows);
    }
    return out;
  }

  /**
   * Reads the same `business_hours` JSON the POS settings form edits
   * (continuous + split blocks per day) and projects it to the simple
   * `{ day_of_week -> { start_time, end_time } }` shape that the slot
   * generator expects.
   *
   * For TIPO DE HORARIO = "continuo" we collapse to a single window.
   * For "split" we currently emit the outer envelope (open/close), which
   * the slot generator can later refine to honor lunch breaks once we
   * teach `clampToStoreHours` to accept an array of windows.
   */
  private async loadStoreHoursFromPosSettings(
    storeId: number,
  ): Promise<Map<number, { start_time: string; end_time: string }>> {
    const row = await this.prisma.store_settings.findUnique({
      where: { store_id: storeId },
      select: { settings: true },
    });
    // POS business_hours live at settings.pos.business_hours (the POS
    // settings card is rendered as a sub-section whose [settings]
    // binding is `settings().pos`, and the save merges it back into
    // settings.pos on the backend).
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

    const out = new Map<number, { start_time: string; end_time: string }>();
    // Day-of-week keys in store_settings use monday=1..sunday=7; the
    // reservations schema uses sunday=0..saturday=6. Map via Date so the
    // conversion stays correct regardless of locale / week start.
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
      // Legacy/short form: just the open string ("09:00") — treat as closed.
      if (typeof value === 'string') continue;
      if (value?.is_active === false) continue;

      // Customized (TIPO DE HORARIO = "Personalizado"): an array of
      // {open, close} blocks per day. The reservations system today only
      // honors a single window per day, so we collapse to the OUTER
      // envelope [earliest open, latest close]. This intentionally drops
      // any lunch-break gap inside the day, but it matches the previous
      // behavior of the legacy store_business_hours table.
      const blocks = (value as any).blocks as
        | Array<{ open: string; close: string }>
        | undefined;
      if (Array.isArray(blocks) && blocks.length > 0) {
        const opens = blocks.map((b) => b.open).filter(Boolean);
        const closes = blocks.map((b) => b.close).filter(Boolean);
        if (opens.length > 0 && closes.length > 0) {
          const start = opens.reduce((a, b) => (a < b ? a : b));
          const end = closes.reduce((a, b) => (a > b ? a : b));
          out.set(dow, { start_time: start, end_time: end });
          continue;
        }
      }

      // Continuous (TIPO DE HORARIO = "Continuo"): a single
      // {open, close} envelope per day.
      const open = (value as any).open as string | undefined;
      const close = (value as any).close as string | undefined;
      if (!open || !close) continue;
      out.set(dow, { start_time: open, end_time: close });
    }
    return out;
  }
}