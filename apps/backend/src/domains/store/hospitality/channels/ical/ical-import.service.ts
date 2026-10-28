import { Injectable, Logger } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { dateOnlyToDb, formatShortDate } from '../../reservations/stay-dates';
import { CreateIcalImportDto } from './ical-import.dto';
import { fetchIcalFeed, IcalFetchError, normalizeIcalUrl } from './ical-fetch';
import { diffIcalBlocks, IcalImportEvent, parseIcalEvents } from './ical-import-sync';
import { nightsOfRange } from './ical-feed';
import { allocateUnassignedNights } from './ical-occupancy';
import { UNSELLABLE_HOUSEKEEPING_STATUSES } from '../../housekeeping/housekeeping-status';

/** Same queue as a sale: a sync waits on the store's sale lock. */
const SYNC_TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 };

const DAY_MS = 86_400_000;

/** Default minutes between two automatic syncs of a calendar. */
export const DEFAULT_ICAL_IMPORT_INTERVAL_MINUTES = 15;
/** Floor of `hospitality.ical_import_interval_minutes` (the job ticks every 5). */
export const MIN_ICAL_IMPORT_INTERVAL_MINUTES = 5;

const DEFAULT_CHANNEL_NAME = 'Airbnb';

const toDateOnly = (date: Date) => date.toISOString().slice(0, 10);

const IMPORT_SELECT = {
  id: true,
  unit_id: true,
  name: true,
  url: true,
  last_synced_at: true,
  last_sync_status: true,
  last_sync_message: true,
  last_sync_events: true,
  unit: { select: { id: true, code: true, unit_type: { select: { name: true } } } },
} as const;

type ImportRow = { id: number; store_id: number; unit_id: number; name: string; url: string };

/**
 * Hospitality Suite (H6.2) — iCal import.
 *
 * The manager pastes the iCal URL that Airbnb or Booking publishes for a
 * listing into one room. Each sync downloads it and diffs its events, keyed
 * by UID, against the room's blocks from that import (`reason=ical`):
 * new events block the room, moved ones move their block, events gone from
 * the feed release it. A feed that cannot be read changes nothing, so a
 * channel outage never frees nights sold there. iCal brings no price nor
 * guest, and the channel refreshes it every few hours: a night sold on both
 * sides is reported as a possible double sale, never silently resolved.
 */
@Injectable()
export class LodgingIcalImportService {
  private readonly logger = new Logger(LodgingIcalImportService.name);

  constructor(private readonly prisma: StorePrismaService) {}

  async list() {
    return this.prisma.lodging_ical_imports.findMany({
      where: { is_active: true },
      select: IMPORT_SELECT,
      orderBy: [{ unit_id: 'asc' }, { id: 'asc' }],
    });
  }

  /** Saves the calendar and syncs it once, so the manager sees the result. */
  async create(dto: CreateIcalImportDto, now = new Date()) {
    const store_id = this.requireStoreId();
    let url: string;
    try {
      url = normalizeIcalUrl(dto.url).toString();
    } catch (err) {
      throw new VendixHttpException(ErrorCodes.LODGING_ICAL_IMPORT_URL_001, (err as Error).message);
    }
    const unit = await this.prisma.lodging_units.findFirst({
      where: { id: dto.unit_id },
      select: { id: true },
    });
    if (!unit) throw new VendixHttpException(ErrorCodes.LODGING_UNIT_FIND_001);

    const created = await this.prisma.lodging_ical_imports.create({
      data: {
        store_id,
        unit_id: unit.id,
        name: dto.name || DEFAULT_CHANNEL_NAME,
        url,
        created_by_user_id: RequestContextService.getContext()?.user_id ?? null,
        updated_at: now,
      },
      select: { id: true, store_id: true, unit_id: true, name: true, url: true },
    });
    await this.sync(created, now);
    return this.findOne(created.id);
  }

  /** "Sincronizar ahora". */
  async syncNow(id: number, now = new Date()) {
    await this.sync(await this.findActive(id), now);
    return this.findOne(id);
  }

  /** Stops importing: the room's upcoming blocks from this channel are released. */
  async remove(id: number, now = new Date()) {
    const row = await this.findActive(id);
    const user_id = RequestContextService.getContext()?.user_id ?? null;
    const today = this.syncFrom(now);
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`lodging_reservations:${row.store_id}`}))`;
      await tx.lodging_inventory_blocks.updateMany({
        where: {
          store_id: row.store_id,
          ical_import_id: row.id,
          released_at: null,
          to_date: { gt: dateOnlyToDb(today) },
        },
        data: { released_at: now, released_by_user_id: user_id, updated_at: now },
      });
      await tx.lodging_ical_imports.updateMany({
        where: { id: row.id, store_id: row.store_id },
        data: { is_active: false, updated_at: now },
      });
    }, SYNC_TX_OPTIONS);
    return { id: row.id };
  }

  /**
   * Job entry (inside the store context): syncs the store's calendars whose
   * last sync is older than `hospitality.ical_import_interval_minutes`.
   */
  async syncDue(store_id: number, now = new Date()): Promise<number> {
    const interval = await this.intervalMinutes(store_id);
    const dueBefore = new Date(now.getTime() - interval * 60_000 + 30_000);
    const rows = await this.prisma.lodging_ical_imports.findMany({
      where: {
        is_active: true,
        OR: [{ last_synced_at: null }, { last_synced_at: { lte: dueBefore } }],
      },
      select: { id: true, store_id: true, unit_id: true, name: true, url: true },
      orderBy: { id: 'asc' },
    });
    for (const row of rows) await this.sync(row, now);
    return rows.length;
  }

  /** Downloads one calendar and applies its diff; the outcome is saved on the row. */
  async sync(row: ImportRow, now = new Date()) {
    let events: IcalImportEvent[];
    try {
      events = parseIcalEvents(await fetchIcalFeed(row.url));
    } catch (err) {
      const message =
        err instanceof IcalFetchError ? err.message : 'No se pudo leer el calendario del canal';
      this.logger.warn(`iCal import ${row.id} (store ${row.store_id}) failed: ${message}`);
      await this.saveOutcome(row, now, 'error', message, null);
      return;
    }

    const user_id = RequestContextService.getContext()?.user_id ?? null;
    const today = this.syncFrom(now);
    const conflicts = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`lodging_reservations:${row.store_id}`}))`;
      // Still active? A "Quitar" may have run while the feed downloaded.
      const current = await tx.lodging_ical_imports.findFirst({
        where: { id: row.id, store_id: row.store_id, is_active: true },
        select: { id: true },
      });
      if (!current) return null;

      const existing = await tx.lodging_inventory_blocks.findMany({
        where: { store_id: row.store_id, ical_import_id: row.id, released_at: null },
        select: { id: true, external_uid: true, from_date: true, to_date: true },
        orderBy: { id: 'asc' },
      });
      const diff = diffIcalBlocks(
        events,
        existing.map((b) => ({
          id: b.id,
          external_uid: b.external_uid,
          from: toDateOnly(b.from_date),
          to: toDateOnly(b.to_date),
        })),
        today,
      );

      if (diff.release.length > 0) {
        await tx.lodging_inventory_blocks.updateMany({
          where: { store_id: row.store_id, id: { in: diff.release }, released_at: null },
          data: { released_at: now, released_by_user_id: user_id, updated_at: now },
        });
      }
      for (const move of diff.update) {
        await tx.lodging_inventory_blocks.updateMany({
          where: { store_id: row.store_id, id: move.id },
          data: { from_date: dateOnlyToDb(move.from), to_date: dateOnlyToDb(move.to), updated_at: now },
        });
      }
      if (diff.create.length > 0) {
        await tx.lodging_inventory_blocks.createMany({
          data: diff.create.map((event) => ({
            store_id: row.store_id,
            unit_id: row.unit_id,
            from_date: dateOnlyToDb(event.from),
            to_date: dateOnlyToDb(event.to),
            reason: 'ical' as const,
            notes: row.name,
            ical_import_id: row.id,
            external_uid: event.uid,
            created_by_user_id: user_id,
            updated_at: now,
          })),
        });
      }

      // Nights sold in Vendix that the channel also sold: possible double sale.
      // A night of this room, or an unassigned night of its type left without
      // a free room now that the channel took this one.
      const upcoming = events.filter((e) => e.to > today);
      if (upcoming.length === 0) return [];
      const unit = await tx.lodging_units.findFirst({
        where: { id: row.unit_id, store_id: row.store_id },
        select: { unit_type_id: true },
      });
      if (!unit) return [];
      const [units, sold, blocks] = await Promise.all([
        tx.lodging_units.findMany({
          where: {
            store_id: row.store_id,
            unit_type_id: unit.unit_type_id,
            is_active: true,
            housekeeping_status: { notIn: [...UNSELLABLE_HOUSEKEEPING_STATUSES] },
          },
          select: { id: true },
          orderBy: [{ code: 'asc' }, { id: 'asc' }],
        }),
        tx.lodging_room_nights.findMany({
          where: {
            store_id: row.store_id,
            unit_type_id: unit.unit_type_id,
            is_active: true,
            night_date: { gte: dateOnlyToDb(today) },
          },
          select: {
            night_date: true,
            unit_id: true,
            reservation_room: { select: { reservation: { select: { reservation_number: true } } } },
          },
          orderBy: { night_date: 'asc' },
        }),
        tx.lodging_inventory_blocks.findMany({
          where: {
            store_id: row.store_id,
            released_at: null,
            to_date: { gt: dateOnlyToDb(today) },
            unit: { unit_type_id: unit.unit_type_id },
          },
          select: { unit_id: true, from_date: true, to_date: true },
        }),
      ]);
      const nights = sold.map((n) => ({
        night: toDateOnly(n.night_date),
        unit_id: n.unit_id,
        reservation: n.reservation_room.reservation.reservation_number,
      }));
      const allocation = allocateUnassignedNights({
        unit_ids: units.map((u) => u.id),
        nights,
        blocked: blocks.flatMap((b) =>
          nightsOfRange(toDateOnly(b.from_date), toDateOnly(b.to_date), today).map(
            (night) => ({ night, unit_id: b.unit_id }),
          ),
        ),
      });
      const inChannel = (night: string) =>
        upcoming.some((e) => night >= e.from && night < e.to);
      return [
        ...nights.filter((n) => n.unit_id === row.unit_id),
        ...[...allocation]
          .filter(([, occupancy]) => occupancy.overflow > 0)
          .flatMap(([night, occupancy]) =>
            occupancy.unassigned_reservations.map((reservation) => ({ night, reservation })),
          ),
      ]
        .filter(({ night }) => inChannel(night))
        .sort((x, y) => x.night.localeCompare(y.night));
    }, SYNC_TX_OPTIONS);

    if (conflicts === null) return;
    const count = events.filter((e) => e.to > today).length;
    if (conflicts.length > 0) {
      const first = conflicts[0];
      const reservations = [...new Set(conflicts.map((c) => c.reservation))];
      await this.saveOutcome(
        row,
        now,
        'warning',
        `Posible doble venta: ${row.name} tiene ocupada la noche del ${formatShortDate(first.night)} y en Vendix está la reserva ${reservations.join(', ')}. Muévela a otra habitación.`.slice(0, 500),
        count,
      );
      return;
    }
    await this.saveOutcome(
      row,
      now,
      'ok',
      count === 1 ? '1 reserva próxima bloqueada' : `${count} reservas próximas bloqueadas`,
      count,
    );
  }

  private async saveOutcome(
    row: ImportRow,
    now: Date,
    status: 'ok' | 'warning' | 'error',
    message: string,
    events: number | null,
  ) {
    await this.prisma.lodging_ical_imports.updateMany({
      where: { id: row.id, store_id: row.store_id },
      data: {
        last_synced_at: now,
        last_sync_status: status,
        last_sync_message: message,
        ...(events !== null && { last_sync_events: events }),
        updated_at: now,
      },
    });
  }

  private async intervalMinutes(store_id: number): Promise<number> {
    const row = await this.prisma.store_settings.findFirst({
      where: { store_id },
      select: { settings: true },
    });
    const settings = row?.settings as { hospitality?: { ical_import_interval_minutes?: unknown } } | null;
    const value = Number(settings?.hospitality?.ical_import_interval_minutes);
    return Number.isFinite(value) && value > 0
      ? Math.max(MIN_ICAL_IMPORT_INTERVAL_MINUTES, value)
      : DEFAULT_ICAL_IMPORT_INTERVAL_MINUTES;
  }

  /** Yesterday (UTC), like the export: covers every store time zone. */
  private syncFrom(now: Date): string {
    return toDateOnly(new Date(now.getTime() - DAY_MS));
  }

  private async findActive(id: number): Promise<ImportRow> {
    const row = await this.prisma.lodging_ical_imports.findFirst({
      where: { id, is_active: true },
      select: { id: true, store_id: true, unit_id: true, name: true, url: true },
    });
    if (!row) throw new VendixHttpException(ErrorCodes.LODGING_ICAL_IMPORT_FIND_001);
    return row;
  }

  private async findOne(id: number) {
    const row = await this.prisma.lodging_ical_imports.findFirst({
      where: { id },
      select: IMPORT_SELECT,
    });
    if (!row) throw new VendixHttpException(ErrorCodes.LODGING_ICAL_IMPORT_FIND_001);
    return row;
  }

  private requireStoreId(): number {
    const store_id = RequestContextService.getContext()?.store_id;
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    return store_id;
  }
}
