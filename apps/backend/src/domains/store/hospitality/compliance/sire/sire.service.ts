import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { resolveStoreTimezone } from '@common/utils/store-timezone.util';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { mergeStoreSettingsWithDefaults } from '../../../settings/defaults/default-store-settings';
import {
  SIRE_AUTHORITY,
  SireEvent,
  SireRecord,
  ageHours,
  buildSireRecord,
  isOverdue,
  isSireGuest,
  missingSireFields,
  overdueHours,
} from './sire-record';
import { SireListQueryDto } from './sire.dto';

const ROW_SELECT = {
  id: true,
  reservation_id: true,
  guest_id: true,
  guest_name: true,
  event: true,
  status: true,
  sent_at: true,
  created_at: true,
  reservation: { select: { reservation_number: true } },
  reported_by: { select: { first_name: true, last_name: true } },
} satisfies Prisma.lodging_compliance_submissionsSelect;

type SireRow = Prisma.lodging_compliance_submissionsGetPayload<{ select: typeof ROW_SELECT }>;

/**
 * Hospitality Suite (H4.2) — assisted SIRE (Migración Colombia). Each entry
 * and exit of a foreign guest is logged as "Pendiente" (one row per guest and
 * event, unique); the desk copies the sheet or downloads the file, reports it
 * in the SIRE portal and marks it, which records who and when. Pending rows
 * older than the store threshold (24 h by default) are "Atrasado". Nothing
 * here throws back to the desk (D14) and nothing is sent automatically.
 */
@Injectable()
export class LodgingSireService {
  constructor(private readonly prisma: StorePrismaService) {}

  // ── Recording (after check-in / check-out commits) ─────────────────────

  /** Logs one pending row per foreign guest and event; existing rows are kept. */
  async record(store_id: number, reservation_id: number, events: SireEvent[]): Promise<number> {
    const client = this.prisma.withoutScope();
    if (!(await this.settings(store_id)).enabled) return 0;
    const guests = await client.lodging_guests.findMany({
      where: { store_id, reservation_id },
      select: { id: true, first_name: true, last_name: true, nationality_country_code: true },
      orderBy: [{ is_primary: 'desc' }, { id: 'asc' }],
    });
    const foreign = guests.filter((guest) => isSireGuest(guest.nationality_country_code));
    if (foreign.length === 0) return 0;
    const result = await client.lodging_compliance_submissions.createMany({
      data: events.flatMap((event) =>
        foreign.map((guest) => ({
          store_id,
          reservation_id,
          guest_id: guest.id,
          authority: SIRE_AUTHORITY,
          event,
          guest_name: `${guest.first_name} ${guest.last_name}`.trim().slice(0, 200),
        })),
      ),
      skipDuplicates: true,
    });
    return result.count;
  }

  // ── Desk screen (store-scoped) ─────────────────────────────────────────

  async summary() {
    const store_id = this.storeId();
    const { enabled, threshold } = await this.settings(store_id);
    const cutoff = new Date(Date.now() - threshold * 3_600_000);
    const [pending, overdue, manual] = await Promise.all([
      this.prisma.lodging_compliance_submissions.count({ where: { authority: SIRE_AUTHORITY, status: 'pending' } }),
      this.prisma.lodging_compliance_submissions.count({
        where: { authority: SIRE_AUTHORITY, status: 'pending', created_at: { lt: cutoff } },
      }),
      this.prisma.lodging_compliance_submissions.count({ where: { authority: SIRE_AUTHORITY, status: 'manual' } }),
    ]);
    return {
      enabled,
      overdue_hours: threshold,
      stats: { pending, overdue, manual, total: pending + manual },
    };
  }

  async list(query: SireListQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { threshold } = await this.settings(this.storeId());
    const now = new Date();
    const where = this.listWhere(query, threshold, now);
    const [rows, total] = await Promise.all([
      this.prisma.lodging_compliance_submissions.findMany({
        where,
        // Pending first, the oldest on top: it is the one most at risk.
        orderBy: [{ status: 'desc' }, { created_at: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: ROW_SELECT,
      }),
      this.prisma.lodging_compliance_submissions.count({ where }),
    ]);
    return { data: rows.map((row) => this.toItem(row, threshold, now)), total, page, limit };
  }

  listWhere(
    query: Pick<SireListQueryDto, 'search' | 'status'>,
    threshold: number,
    now: Date,
  ): Prisma.lodging_compliance_submissionsWhereInput {
    const search = query.search?.trim();
    const status =
      query.status === 'overdue'
        ? { status: 'pending', created_at: { lt: new Date(now.getTime() - threshold * 3_600_000) } }
        : query.status
          ? { status: query.status }
          : {};
    return {
      authority: SIRE_AUTHORITY,
      ...status,
      ...(search
        ? {
            OR: [
              { guest_name: { contains: search, mode: 'insensitive' } },
              { reservation: { reservation_number: { contains: search, mode: 'insensitive' } } },
              { guest: { document_number: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
  }

  /** The copyable sheet of one row, with the fields still missing. */
  async sheet(id: number) {
    const store_id = this.storeId();
    const row = await this.prisma.lodging_compliance_submissions.findFirst({
      where: { id, authority: SIRE_AUTHORITY },
      select: ROW_SELECT,
    });
    if (!row) throw new VendixHttpException(ErrorCodes.LODGING_SIRE_NOT_FOUND_001);
    const { threshold } = await this.settings(store_id);
    const tz = await resolveStoreTimezone(this.prisma, store_id);
    const record = await this.buildRecord(store_id, row, tz);
    return {
      ...this.toItem(row, threshold, new Date()),
      record,
      missing: record ? missingSireFields(record) : ['huésped'],
    };
  }

  /** The desk reported these rows in the SIRE portal: records who and when. */
  async markReported(ids: number[]): Promise<{ updated: number }> {
    const user_id = RequestContextService.getContext()?.user_id ?? null;
    const now = new Date();
    const result = await this.prisma.lodging_compliance_submissions.updateMany({
      where: { authority: SIRE_AUTHORITY, id: { in: ids }, status: 'pending' },
      data: { status: 'manual', sent_at: now, reported_by_user_id: user_id, updated_at: now },
    });
    return { updated: result.count };
  }

  /** Rows of the export file: the pending records unless a status is filtered. */
  async exportRows(query: Pick<SireListQueryDto, 'search' | 'status'>) {
    const store_id = this.storeId();
    const { threshold } = await this.settings(store_id);
    const tz = await resolveStoreTimezone(this.prisma, store_id);
    const now = new Date();
    const where = this.listWhere({ ...query, status: query.status ?? 'pending' }, threshold, now);
    const rows = await this.prisma.lodging_compliance_submissions.findMany({
      where,
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
      take: 2000,
      select: ROW_SELECT,
    });
    const out: { item: ReturnType<LodgingSireService['toItem']>; record: SireRecord | null }[] = [];
    for (const row of rows) {
      out.push({ item: this.toItem(row, threshold, now), record: await this.buildRecord(store_id, row, tz) });
    }
    return { rows: out, tz };
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private toItem(row: SireRow, threshold: number, now: Date) {
    const { reservation, reported_by, created_at, ...rest } = row;
    const moved_at = created_at ?? now;
    return {
      ...rest,
      created_at: moved_at,
      reservation_number: reservation.reservation_number,
      reported_by_name: reported_by ? `${reported_by.first_name} ${reported_by.last_name}`.trim() : null,
      age_hours: ageHours(moved_at, row.status === 'manual' && row.sent_at ? row.sent_at : now),
      overdue: isOverdue(row.status, moved_at, now, threshold),
    };
  }

  /** The SIRE record of a guest, read live (edits before reporting are included). */
  private async buildRecord(store_id: number, row: SireRow, time_zone: string): Promise<SireRecord | null> {
    if (!row.guest_id) return null;
    const guest = await this.prisma.withoutScope().lodging_guests.findFirst({
      where: { id: row.guest_id, store_id, reservation_id: row.reservation_id },
      select: {
        document_type: true,
        document_number: true,
        first_name: true,
        last_name: true,
        nationality_country_code: true,
        birth_date: true,
        residence_city: true,
        origin_city: true,
        room: { select: { unit: { select: { code: true } } } },
      },
    });
    if (!guest) return null;
    const { room, ...fields } = guest;
    return buildSireRecord({
      event: row.event as SireEvent,
      moved_at: row.created_at ?? new Date(),
      time_zone,
      guest: { ...fields, document_type: String(fields.document_type) },
      room_code: room?.unit?.code,
    });
  }

  private storeId(): number {
    const store_id = RequestContextService.getContext()?.store_id;
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    return store_id;
  }

  private async settings(store_id: number): Promise<{ enabled: boolean; threshold: number }> {
    const row = await this.prisma.withoutScope().store_settings.findFirst({
      where: { store_id },
      select: { settings: true },
    });
    const hospitality = mergeStoreSettingsWithDefaults(row?.settings).hospitality;
    return {
      enabled: hospitality?.sire_enabled !== false,
      threshold: overdueHours(hospitality?.sire_overdue_hours),
    };
  }
}
