import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { PaymentEncryptionService } from '../../../payments/services/payment-encryption.service';
import { mergeStoreSettingsWithDefaults } from '../../../settings/defaults/default-store-settings';
import { TraEvent, TraRecord, buildTraRecord, missingTraFields } from './tra-record';
import { TRA_MESSAGES, TRA_PROVIDER, TraFailureCode, TraProvider, TraResult } from './tra.provider';
import { TraListQueryDto } from './tra.dto';

export const TRA_QUEUE = 'lodging-tra';
export const TRA_AUTHORITY = 'tra';

export type TraStatus = 'pending' | 'sent' | 'manual' | 'failed';

export interface TraJob {
  submission_id: number;
}

/** Thrown inside the job so BullMQ backs off and tries again later. */
export class TraRetryableError extends Error {}

const DONE: TraStatus[] = ['sent', 'manual'];
const OPEN: TraStatus[] = ['pending', 'failed'];

/**
 * Hospitality Suite (H4.1) — reports each guest's check-in and check-out to
 * the TRA. One log row per guest and event (unique), a BullMQ job per row
 * (jobId = row) and a conditional final update, so a record is never sent
 * twice. Nothing here throws back to the desk (D14): a missing token, RNT or
 * guest data leaves the row "Pendiente" with the reason and "Reintentar".
 */
@Injectable()
export class LodgingTraService {
  private readonly logger = new Logger(LodgingTraService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly encryption: PaymentEncryptionService,
    @Inject(TRA_PROVIDER) private readonly provider: TraProvider,
    @InjectQueue(TRA_QUEUE) private readonly queue: Queue,
  ) {}

  // ── Recording (after check-in / check-out commits) ─────────────────────

  /**
   * Logs one row per guest and event and enqueues them. Idempotent: the
   * unique (guest, authority, event) skips rows that already exist. A
   * check-out also logs the check-in of a guest registered during the stay.
   */
  async record(store_id: number, reservation_id: number, events: TraEvent[]): Promise<number> {
    const client = this.prisma.withoutScope();
    if (!(await this.isEnabled(store_id))) return 0;
    const guests = await client.lodging_guests.findMany({
      where: { store_id, reservation_id },
      select: { id: true, first_name: true, last_name: true },
      orderBy: [{ is_primary: 'desc' }, { id: 'asc' }],
    });
    if (guests.length === 0) return 0;
    await client.lodging_compliance_submissions.createMany({
      data: events.flatMap((event) =>
        guests.map((guest) => ({
          store_id,
          reservation_id,
          guest_id: guest.id,
          authority: TRA_AUTHORITY,
          event,
          guest_name: `${guest.first_name} ${guest.last_name}`.trim().slice(0, 200),
        })),
      ),
      skipDuplicates: true,
    });
    const rows = await client.lodging_compliance_submissions.findMany({
      where: { store_id, reservation_id, authority: TRA_AUTHORITY, status: 'pending', event: { in: events } },
      select: { id: true },
    });
    await this.enqueue(rows.map((row) => row.id));
    return rows.length;
  }

  /** One job per row; the jobId keeps a row from being queued twice at once. */
  async enqueue(ids: number[]): Promise<void> {
    for (const id of ids) {
      await this.queue.add('send', { submission_id: id } as TraJob, {
        jobId: `tra-${id}`,
        attempts: 5,
        backoff: { type: 'exponential', delay: 60_000 },
        removeOnComplete: true,
        removeOnFail: true,
      });
    }
  }

  // ── Delivery (BullMQ worker) ───────────────────────────────────────────

  /** Sends one row. Throws `TraRetryableError` only when the portal is down. */
  async deliver(submission_id: number): Promise<TraStatus | 'skipped'> {
    const client = this.prisma.withoutScope();
    const row = await client.lodging_compliance_submissions.findUnique({
      where: { id: submission_id },
      select: { id: true, store_id: true, status: true, event: true, guest_id: true, reservation_id: true },
    });
    if (!row || DONE.includes(row.status as TraStatus)) return 'skipped';
    if (!(await this.isEnabled(row.store_id))) return 'skipped';

    const credential = await client.lodging_compliance_credentials.findUnique({
      where: { store_id_authority: { store_id: row.store_id, authority: TRA_AUTHORITY } },
      select: { secret_encrypted: true },
    });
    if (!credential) return this.settle(row.id, this.failure('token_missing'));

    const record = await this.buildRecord(row.store_id, row.reservation_id, row.guest_id, row.event as TraEvent);
    if (!record) return this.settle(row.id, this.failure('missing_data', 'El huésped ya no está en la reserva.'));
    const missing = missingTraFields(record);
    if (missing.length > 0) {
      return this.settle(row.id, this.failure('missing_data', `Faltan datos para la TRA: ${missing.join(', ')}.`), record);
    }

    let token: string;
    try {
      token = this.encryption.decrypt(credential.secret_encrypted);
    } catch {
      return this.settle(row.id, this.failure('token_missing'));
    }
    const result = await this.provider.send(token, record);
    const status = await this.settle(row.id, result, record);
    if (!result.ok && result.code === 'unavailable') {
      throw new TraRetryableError(result.message);
    }
    return status;
  }

  /**
   * Writes the outcome unless the row was sent or reported meanwhile.
   * A rejection is `failed`; every other problem stays `pending`.
   */
  private async settle(id: number, result: TraResult, record?: TraRecord): Promise<TraStatus | 'skipped'> {
    const client = this.prisma.withoutScope();
    const now = new Date();
    // Personal data is kept only as evidence of what the TRA accepted.
    const payload = result.ok && record ? (record as unknown as Prisma.InputJsonValue) : undefined;
    const raw = 'raw' in result && result.raw !== undefined ? (result.raw as Prisma.InputJsonValue) : undefined;
    const status: TraStatus = result.ok ? 'sent' : result.code === 'rejected' ? 'failed' : 'pending';
    const updated = await client.lodging_compliance_submissions.updateMany({
      where: { id, status: { in: OPEN } },
      data: {
        status,
        attempts: { increment: 1 },
        error_code: result.ok ? null : result.code,
        last_error: result.ok ? null : result.message.slice(0, 300),
        sent_at: result.ok ? now : undefined,
        payload,
        response: result.ok ? ({ reference: result.reference ?? null, raw: raw ?? null } as Prisma.InputJsonValue) : raw,
        updated_at: now,
      },
    });
    return updated.count === 1 ? status : 'skipped';
  }

  private failure(code: TraFailureCode, message = TRA_MESSAGES[code]): TraResult {
    return { ok: false, code, message };
  }

  /** The TRA record of a guest, read live (edits before sending are included). */
  async buildRecord(
    store_id: number,
    reservation_id: number,
    guest_id: number | null,
    event: TraEvent,
    rnt_number?: string,
  ): Promise<TraRecord | null> {
    if (!guest_id) return null;
    const client = this.prisma.withoutScope();
    const guest = await client.lodging_guests.findFirst({
      where: { id: guest_id, store_id, reservation_id },
      select: {
        is_primary: true,
        document_type: true,
        document_number: true,
        first_name: true,
        last_name: true,
        nationality_country_code: true,
        residence_city: true,
        origin_city: true,
        travel_purpose: true,
        reservation_room_id: true,
      },
    });
    if (!guest) return null;
    const rooms = await client.lodging_reservation_rooms.findMany({
      where: { reservation_id, store_id, cancelled_at: null },
      select: {
        id: true,
        total_amount: true,
        arrival_date: true,
        departure_date: true,
        unit_type: { select: { name: true } },
        unit: { select: { code: true } },
      },
      orderBy: { id: 'asc' },
    });
    const room = rooms.find((r) => r.id === guest.reservation_room_id) ?? rooms[0] ?? null;
    return buildTraRecord({
      event,
      rnt_number: rnt_number ?? (await this.rntNumber(store_id)),
      guest: { ...guest, document_type: String(guest.document_type) },
      room: room
        ? {
            unit_type_name: room.unit_type?.name,
            unit_code: room.unit?.code,
            amount: room.total_amount.toString(),
            arrival_date: room.arrival_date,
            departure_date: room.departure_date,
          }
        : null,
    });
  }

  // ── Desk screen (store-scoped) ─────────────────────────────────────────

  async summary() {
    const store_id = this.storeId();
    const grouped = await this.prisma.lodging_compliance_submissions.groupBy({
      by: ['status'],
      where: { authority: TRA_AUTHORITY },
      _count: { _all: true },
    });
    const count = (status: TraStatus) => grouped.find((g) => g.status === status)?._count._all ?? 0;
    const credential = await this.prisma.lodging_compliance_credentials.findFirst({
      where: { authority: TRA_AUTHORITY },
      select: { secret_hint: true, tested_at: true, test_ok: true, test_message: true, updated_at: true },
    });
    // The newest open problem that applies to the whole hotel (banner).
    const blocking = await this.prisma.lodging_compliance_submissions.findFirst({
      where: {
        authority: TRA_AUTHORITY,
        status: 'pending',
        error_code: { in: ['token_expired', 'token_missing', 'not_configured'] },
      },
      orderBy: { updated_at: 'desc' },
      select: { error_code: true, last_error: true },
    });
    return {
      enabled: await this.isEnabled(store_id),
      automatic: this.provider.automatic,
      rnt_number: await this.rntNumber(store_id),
      stats: {
        sent: count('sent'),
        pending: count('pending'),
        failed: count('failed'),
        manual: count('manual'),
      },
      credential: credential
        ? {
            hint: credential.secret_hint,
            tested_at: credential.tested_at,
            test_ok: credential.test_ok,
            test_message: credential.test_message,
            updated_at: credential.updated_at,
          }
        : null,
      notice: blocking ? { code: blocking.error_code, message: blocking.last_error } : null,
    };
  }

  async list(query: TraListQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = this.listWhere(query);
    const [rows, total] = await Promise.all([
      this.prisma.lodging_compliance_submissions.findMany({
        where,
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          reservation_id: true,
          guest_id: true,
          guest_name: true,
          event: true,
          status: true,
          attempts: true,
          error_code: true,
          last_error: true,
          sent_at: true,
          created_at: true,
          reservation: { select: { reservation_number: true } },
          guest: { select: { is_primary: true } },
          reported_by: { select: { first_name: true, last_name: true } },
        },
      }),
      this.prisma.lodging_compliance_submissions.count({ where }),
    ]);
    const data = rows.map(({ reservation, guest, reported_by, ...row }) => ({
      ...row,
      reservation_number: reservation.reservation_number,
      is_primary: guest?.is_primary ?? false,
      reported_by_name: reported_by ? `${reported_by.first_name} ${reported_by.last_name}`.trim() : null,
    }));
    return { data, total, page, limit };
  }

  listWhere(query: Pick<TraListQueryDto, 'search' | 'status'>): Prisma.lodging_compliance_submissionsWhereInput {
    const search = query.search?.trim();
    return {
      authority: TRA_AUTHORITY,
      ...(query.status ? { status: query.status } : {}),
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

  /** Queues the given open rows again (all open rows when none is given). */
  async retry(ids?: number[]): Promise<{ queued: number }> {
    const rows = await this.prisma.lodging_compliance_submissions.findMany({
      where: { authority: TRA_AUTHORITY, status: { in: OPEN }, ...(ids?.length ? { id: { in: ids } } : {}) },
      select: { id: true },
      take: 500,
    });
    if (rows.length > 0) {
      // A rejected row goes back to the queue as pending.
      await this.prisma.lodging_compliance_submissions.updateMany({
        where: { id: { in: rows.map((r) => r.id) }, status: 'failed' },
        data: { status: 'pending', updated_at: new Date() },
      });
      await this.enqueue(rows.map((r) => r.id));
    }
    return { queued: rows.length };
  }

  /** Assisted path: the desk reported these rows by hand in the TRA portal. */
  async markReported(ids: number[]): Promise<{ updated: number }> {
    const user_id = RequestContextService.getContext()?.user_id ?? null;
    const now = new Date();
    const result = await this.prisma.lodging_compliance_submissions.updateMany({
      where: { authority: TRA_AUTHORITY, id: { in: ids }, status: { in: OPEN } },
      data: { status: 'manual', sent_at: now, reported_by_user_id: user_id, error_code: null, last_error: null, updated_at: now },
    });
    return { updated: result.count };
  }

  /** Rows of the export file: the TRA fields of each open (or filtered) record. */
  async exportRows(query: Pick<TraListQueryDto, 'search' | 'status'>) {
    const store_id = this.storeId();
    const where = query.status ? this.listWhere(query) : { ...this.listWhere(query), status: { in: OPEN } };
    const rows = await this.prisma.lodging_compliance_submissions.findMany({
      where,
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
      take: 2000,
      select: {
        id: true,
        reservation_id: true,
        guest_id: true,
        guest_name: true,
        event: true,
        status: true,
        reservation: { select: { reservation_number: true } },
      },
    });
    const rnt_number = await this.rntNumber(store_id);
    const out: { row: (typeof rows)[number]; record: TraRecord | null }[] = [];
    for (const row of rows) {
      const record = await this.buildRecord(store_id, row.reservation_id, row.guest_id, row.event as TraEvent, rnt_number);
      out.push({ row, record });
    }
    return out;
  }

  // ── Token ──────────────────────────────────────────────────────────────

  async saveToken(token: string) {
    const store_id = this.storeId();
    const clean = token.trim();
    const now = new Date();
    const data = {
      secret_encrypted: this.encryption.encrypt(clean),
      secret_hint: clean.slice(-4),
      tested_at: null,
      test_ok: null,
      test_message: null,
      updated_at: now,
    };
    await this.prisma.withoutScope().lodging_compliance_credentials.upsert({
      where: { store_id_authority: { store_id, authority: TRA_AUTHORITY } },
      create: { store_id, authority: TRA_AUTHORITY, ...data },
      update: data,
    });
    const test = await this.testConnection();
    // A new token unblocks the rows that were waiting for it.
    if (test.ok || test.code === 'not_configured') {
      await this.retryWaitingForToken();
    }
    return test;
  }

  async testConnection(): Promise<{ ok: boolean; code: TraFailureCode | null; message: string; tested_at: Date }> {
    const store_id = this.storeId();
    const client = this.prisma.withoutScope();
    const credential = await client.lodging_compliance_credentials.findUnique({
      where: { store_id_authority: { store_id, authority: TRA_AUTHORITY } },
      select: { secret_encrypted: true },
    });
    if (!credential) {
      throw new VendixHttpException(ErrorCodes.LODGING_TRA_TOKEN_001);
    }
    const result = await this.provider.test(this.encryption.decrypt(credential.secret_encrypted));
    const message = result.ok ? 'Conexión con la TRA correcta' : result.message;
    const now = new Date();
    await client.lodging_compliance_credentials.update({
      where: { store_id_authority: { store_id, authority: TRA_AUTHORITY } },
      data: { tested_at: now, test_ok: result.ok, test_message: message.slice(0, 300), updated_at: now },
    });
    return { ok: result.ok, code: result.ok ? null : result.code, message, tested_at: now };
  }

  private async retryWaitingForToken(): Promise<void> {
    const rows = await this.prisma.lodging_compliance_submissions.findMany({
      where: { authority: TRA_AUTHORITY, status: 'pending', error_code: { in: ['token_missing', 'token_expired'] } },
      select: { id: true },
      take: 500,
    });
    await this.enqueue(rows.map((r) => r.id)).catch((error: unknown) =>
      this.logger.warn(`TRA re-enqueue failed: ${error instanceof Error ? error.message : error}`),
    );
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private storeId(): number {
    const store_id = RequestContextService.getContext()?.store_id;
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    return store_id;
  }

  private async hospitalitySettings(store_id: number) {
    const row = await this.prisma.withoutScope().store_settings.findFirst({
      where: { store_id },
      select: { settings: true },
    });
    return mergeStoreSettingsWithDefaults(row?.settings).hospitality;
  }

  private async isEnabled(store_id: number): Promise<boolean> {
    return (await this.hospitalitySettings(store_id))?.tra_enabled !== false;
  }

  private async rntNumber(store_id: number): Promise<string> {
    return ((await this.hospitalitySettings(store_id))?.rnt_number ?? '').trim();
  }
}
