import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { UpsertBusinessHoursDto } from './dto';
import {
  ClockWindow,
  isClockTime,
  isFullDay,
  isOvernight,
  toMinutes,
  validateWeeklyBlocks,
  windowSpan,
} from '../../../../common/utils/schedule-window.util';
import { getPersistableDefaultStoreSettings } from '../../settings/defaults/default-store-settings';

/** `pos.business_hours` keys indexed by day_of_week (0 = Sunday). */
const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

interface PosDayHours {
  open: string;
  close: string;
  is_active?: boolean;
  blocks?: Array<{ open: string; close: string }>;
}

export interface BusinessHoursDayView {
  day_of_week: number;
  start_time: string | null;
  end_time: string | null;
  is_active: boolean;
  is_24h: boolean;
  blocks: ClockWindow[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const minutesToClock = (min: number) => {
  const m = min % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/**
 * BusinessHoursService
 *
 * Per-store master calendar that the booking flow consults when computing
 * slot availability. ONE source (M1): `store_settings.settings.pos.business_hours`,
 * shared by the Agenda "Horario" screen and Settings → Sales. Overrides / supplements per-provider provider_schedules
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
   * Returns the full week (7 rows) of the store's ONE schedule (M1): the same
   * windows the booking flow reads (`settings.pos.business_hours`, or the
   * legacy `store_business_hours` table only when the JSON does not exist).
   * `blocks` keeps every block of the day; `start_time`/`end_time` are the
   * first open and the last close; `is_24h` marks the explicit 00:00-00:00.
   */
  async getAllForStore(storeId: number): Promise<BusinessHoursDayView[]> {
    const windows = await this.loadStoreWindows(storeId);
    const all: BusinessHoursDayView[] = [];
    for (let dow = 0; dow <= 6; dow++) all.push(this.dayView(dow, windows.get(dow) ?? []));
    return all;
  }

  /**
   * Returns the schedule of a single day, or null when the store is closed.
   */
  async getForDay(storeId: number, dayOfWeek: number): Promise<BusinessHoursDayView | null> {
    const windows = await this.loadStoreWindows(storeId);
    const list = windows.get(dayOfWeek) ?? [];
    return list.length ? this.dayView(dayOfWeek, list) : null;
  }

  private dayView(dow: number, list: ClockWindow[]): BusinessHoursDayView {
    return {
      day_of_week: dow,
      start_time: list[0]?.start_time ?? null,
      end_time: list[list.length - 1]?.end_time ?? null,
      is_active: list.length > 0,
      is_24h: list.length === 1 && isFullDay(list[0]),
      blocks: list.map((w) => ({ start_time: w.start_time, end_time: w.end_time })),
    };
  }

  /**
   * Batch upsert of the store's ONE schedule (M1): writes the days in the
   * payload into `settings.pos.business_hours` — the key the booking flow,
   * the agenda, "open now" and Settings → Sales already read — and keeps the
   * rest of the settings JSON and the days not sent untouched. The legacy
   * `store_business_hours` table is never written nor deleted (read fallback).
   *
   * end_time <= start_time is valid and means the block ends the next day
   * (S21); `00:00-00:00` is 24 h; any other zero-length block is rejected.
   */
  async upsertAll(storeId: number, dto: UpsertBusinessHoursDto) {
    const daysTouched = new Set(dto.items.map((i) => i.day_of_week));
    if (daysTouched.size !== dto.items.length) {
      throw new BadRequestException('No se permiten días duplicados en el payload');
    }

    const blocksOf = (i: UpsertBusinessHoursDto['items'][number]): ClockWindow[] =>
      i.blocks?.length
        ? i.blocks.map((b) => ({ start_time: b.start_time, end_time: b.end_time }))
        : [{ start_time: i.start_time, end_time: i.end_time }];
    const active = dto.items.filter((i) => i.is_active !== false);

    // S21: end <= start means the block ends the next day (00:00-00:00 = 24 h).
    // Blocks must keep the HH:MM format and must not overlap, including the
    // previous day's overnight spill.
    const invalid = validateWeeklyBlocks(
      active.flatMap((i) =>
        blocksOf(i).map((b) => ({ day: i.day_of_week, start_time: b.start_time, end_time: b.end_time })),
      ),
      { rejectZeroLength: true },
    );
    if (invalid) {
      throw new BadRequestException(
        invalid.reason === 'overlap'
          ? `Día ${invalid.day}: el horario se cruza con otro bloque (incluido el que termina de madrugada del día anterior)`
          : invalid.reason === 'zero'
            ? `Día ${invalid.day}: la apertura y el cierre son la misma hora; usa 00:00 a 00:00 para abrir las 24 horas`
            : `Día ${invalid.day}: las horas deben tener formato HH:mm`,
      );
    }

    const row = await this.prisma.store_settings.findUnique({
      where: { store_id: storeId },
      select: { settings: true },
    });
    const rawSettings: unknown = row?.settings;
    const settings = isRecord(rawSettings) ? (rawSettings as Record<string, any>) : null;
    const pos: Record<string, any> = isRecord(settings?.pos) ? { ...settings.pos } : {};

    // Days not in the payload keep what the booking reads today; a store that
    // only had the legacy table gets its days copied so none is lost.
    const hours: Record<string, PosDayHours> = isRecord(pos.business_hours)
      ? { ...(pos.business_hours as Record<string, PosDayHours>) }
      : this.posHoursFromWindows(await this.loadStoreWindows(storeId));

    const custom =
      pos.schedule_mode === 'custom' || active.some((i) => blocksOf(i).length > 1);
    if (custom && pos.schedule_mode !== 'custom') {
      // Switching to custom: every day needs `blocks` (an empty list = closed).
      for (const key of DAY_KEYS) {
        const day = hours[key];
        if (!day || day.blocks?.length) continue;
        hours[key] =
          isClockTime(day.open) && isClockTime(day.close)
            ? { ...day, blocks: [{ open: day.open, close: day.close }] }
            : { open: 'closed', close: 'closed', blocks: [] };
      }
    }

    for (const item of dto.items) {
      const key = DAY_KEYS[item.day_of_week];
      if (item.is_active === false) {
        hours[key] = custom ? { open: 'closed', close: 'closed', blocks: [] } : { open: 'closed', close: 'closed' };
        continue;
      }
      const blocks = [...blocksOf(item)].sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time));
      const open = blocks[0].start_time;
      const close = blocks[blocks.length - 1].end_time;
      hours[key] = custom
        ? { open, close, blocks: blocks.map((b) => ({ open: b.start_time, close: b.end_time })) }
        : { open, close };
    }

    const nextPos = { ...pos, business_hours: hours, schedule_mode: custom ? 'custom' : (pos.schedule_mode ?? 'continuous') };
    if (row) {
      await this.prisma.store_settings.update({
        where: { store_id: storeId },
        data: { settings: { ...(settings ?? {}), pos: nextPos } as any, updated_at: new Date() },
      });
    } else {
      const defaults = getPersistableDefaultStoreSettings() as unknown as Record<string, any>;
      await this.prisma.store_settings.create({
        data: { store_id: storeId, settings: { ...defaults, pos: { ...defaults.pos, ...nextPos } } as any },
      });
    }
    this.logger.log(`[BusinessHours] store ${storeId}: pos.business_hours updated (${dto.items.length} days)`);
    return this.getAllForStore(storeId);
  }

  /** Windows per weekday → `pos.business_hours` shape (closed when empty). */
  private posHoursFromWindows(windows: Map<number, ClockWindow[]>): Record<string, PosDayHours> {
    const out: Record<string, PosDayHours> = {};
    DAY_KEYS.forEach((key, dow) => {
      const list = windows.get(dow) ?? [];
      out[key] = list.length
        ? list.length === 1
          ? { open: list[0].start_time, close: list[0].end_time }
          : {
              open: list[0].start_time,
              close: list[list.length - 1].end_time,
              blocks: list.map((w) => ({ open: w.start_time, close: w.end_time })),
            }
        : { open: 'closed', close: 'closed' };
    });
    return out;
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
