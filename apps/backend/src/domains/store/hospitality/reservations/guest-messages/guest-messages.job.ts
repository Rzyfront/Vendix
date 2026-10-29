import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { StoreContextRunner } from '@common/context/store-context-runner.service';
import { RequestContextService } from '@common/context/request-context.service';
import { localDateString, resolveStoreTimezone } from '@common/utils/store-timezone.util';
import { EmailService } from '../../../../../email/email.service';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { LodgingPrecheckinService } from '../precheckin/precheckin.service';
import { LodgingStayReviewService } from '../stay-review/stay-review.service';
import { dateOnlyToDb, stayNights } from '../stay-dates';
import {
  GuestMessageKey,
  GuestMessageSettings,
  guestMessageEmail,
  guestMessageSettings,
  preArrivalDue,
} from './guest-messages-text';

const DAY_MS = 86_400_000;
/** A confirmation or check-out older than this is never emailed (no backlog after a pause). */
const RECENT_MS = 2 * DAY_MS;
const CHANNEL = 'email';

const RESERVATION_SELECT = {
  id: true,
  reservation_number: true,
  arrival_date: true,
  departure_date: true,
  precheckin_completed_at: true,
  customer: { select: { email: true, first_name: true, last_name: true } },
  store: { select: { name: true } },
  rooms: {
    where: { cancelled_at: null },
    select: { unit_type: { select: { name: true } } },
    orderBy: { id: 'asc' as const },
  },
} satisfies Prisma.lodging_reservationsSelect;

type Candidate = Prisma.lodging_reservationsGetPayload<{ select: typeof RESERVATION_SELECT }>;

/** H9.4 — a confirmed arrival of a date as the desk sees it before sending the online check-in link. */
export interface PrecheckinArrival {
  reservation_id: number;
  reservation_number: string;
  guest_name: string;
  email: string | null;
  precheckin_done: boolean;
  /** The automatic pre-arrival reminder already went out. */
  reminder_sent: boolean;
}

export interface PrecheckinArrivals {
  /** Store-local today, YYYY-MM-DD. */
  today: string;
  arrival_date: string;
  /** The store has an online domain, so the link can be built. */
  has_link: boolean;
  arrivals: PrecheckinArrival[];
  /** The date has more arrivals than MAX_ARRIVALS; only the first ones are listed. */
  truncated: boolean;
}

/** Arrivals listed and sent per request; a hotel's day stays far below it. */
const MAX_ARRIVALS = 200;
/** Pre check-in emails sent at once by a desk request, so it answers in time. */
const SEND_CONCURRENCY = 5;

const notSent = (key: GuestMessageKey) => ({
  guest_message_logs: { none: { message_key: key, channel: CHANNEL } },
});

/**
 * Hospitality Suite (H8.2) — emails the guest without desk work: the
 * confirmation of a reservation, a reminder with the online check-in link
 * `guest_email_pre_arrival_hours` before arrival and a thank-you after
 * check-out that asks for a private rating of the stay (H8.5). Each one is on/off in Configuración → Hotelería.
 *
 * Idempotent: the `lodging_guest_message_logs` row is claimed (unique per
 * reservation, message and channel) before sending, so overlapping runs never
 * repeat an email; a failed send releases it for the next run. Web bookings
 * already get their paid confirmation from the booking engine and are skipped
 * here. Same shape as the bookings reminders job, one store context at a time.
 */
@Injectable()
export class LodgingGuestMessagesJob {
  private readonly logger = new Logger(LodgingGuestMessagesJob.name);
  private isRunning = false;

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly email: EmailService,
    private readonly precheckin: LodgingPrecheckinService,
    private readonly stayReview: LodgingStayReviewService,
    private readonly storeContextRunner: StoreContextRunner,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async run(now: Date = new Date()): Promise<number> {
    if (this.isRunning) return 0;
    this.isRunning = true;
    let total = 0;
    try {
      const recent = new Date(now.getTime() - RECENT_MS);
      // Cross-store discovery (8 days covers the longest reminder, 168 h); each store decides precisely.
      const stores = await this.prisma.withoutScope().lodging_reservations.findMany({
        where: {
          OR: [
            { status: 'confirmed', events: { some: { to_status: 'confirmed', created_at: { gte: recent } } } },
            {
              status: 'confirmed',
              arrival_date: { gte: new Date(now.getTime() - DAY_MS), lte: new Date(now.getTime() + 8 * DAY_MS) },
            },
            { status: 'checked_out', events: { some: { to_status: 'checked_out', created_at: { gte: recent } } } },
          ],
        },
        distinct: ['store_id'],
        select: { store_id: true },
      });
      for (const { store_id } of stores) {
        try {
          total += await this.storeContextRunner.runInStoreContext(store_id, () =>
            this.runStore(store_id, now),
          );
        } catch (err: unknown) {
          this.logger.error(
            `LodgingGuestMessagesJob store ${store_id} failed: ${err instanceof Error ? err.message : err}`,
          );
        }
      }
      if (total > 0) this.logger.log(`LodgingGuestMessagesJob: ${total} guest email(s) sent`);
      return total;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * H9.4 — "mándale el pre check-in a las llegadas de mañana": the confirmed
   * arrivals of a date (tomorrow in the store time zone by default) of the
   * current store, with who already completed it, has no email or already got
   * the automatic reminder. Read-only: Vexi's proposal shows this list.
   */
  async precheckinArrivals(arrival_date?: string): Promise<PrecheckinArrivals> {
    const store_id = this.requireStoreId();
    const timezone = await resolveStoreTimezone(this.prisma, store_id);
    const today = localDateString(new Date(), timezone);
    const date = arrival_date ?? new Date(dateOnlyToDb(today).getTime() + DAY_MS).toISOString().slice(0, 10);
    const rows = await this.prisma.lodging_reservations.findMany({
      where: { status: 'confirmed', arrival_date: dateOnlyToDb(date) },
      select: {
        ...RESERVATION_SELECT,
        guest_message_logs: { where: { message_key: 'pre_arrival', channel: CHANNEL }, select: { id: true } },
      },
      orderBy: { reservation_number: 'asc' },
      take: MAX_ARRIVALS + 1,
    });
    return {
      today,
      arrival_date: date,
      has_link: await this.precheckin.hasGuestDomain(),
      truncated: rows.length > MAX_ARRIVALS,
      arrivals: rows.slice(0, MAX_ARRIVALS).map((r) => ({
        reservation_id: r.id,
        reservation_number: r.reservation_number,
        guest_name: `${r.customer.first_name ?? ''} ${r.customer.last_name ?? ''}`.trim(),
        email: r.customer.email?.trim() || null,
        precheckin_done: !!r.precheckin_completed_at,
        reminder_sent: r.guest_message_logs.length > 0,
      })),
    };
  }

  /**
   * H9.4 — sends now, at the desk's explicit request, the pre-arrival email
   * with the online check-in link (same message as the automatic reminder) to
   * these reservations of the current store. It goes out even if the store
   * turned the automatic reminder off or it was already sent; it is logged as
   * the reminder, so the job does not send it again afterwards. Reservations
   * no longer confirmed, already pre-registered or without email are skipped.
   */
  async sendPrecheckinNow(reservation_ids: number[]): Promise<{ sent: string[]; failed: string[] }> {
    const store_id = this.requireStoreId();
    const settings = await this.loadSettings(store_id);
    const rows = reservation_ids.length
      ? await this.prisma.lodging_reservations.findMany({
          where: { id: { in: reservation_ids.slice(0, MAX_ARRIVALS) }, status: 'confirmed', precheckin_completed_at: null },
          select: RESERVATION_SELECT,
          orderBy: { reservation_number: 'asc' },
        })
      : [];
    const sent: string[] = [];
    const failed: string[] = [];
    const withEmail = rows.filter((r) => r.customer.email?.trim());
    for (let i = 0; i < withEmail.length; i += SEND_CONCURRENCY) {
      const batch = withEmail.slice(i, i + SEND_CONCURRENCY);
      const results = await Promise.all(batch.map((r) => this.send(store_id, 'pre_arrival', r, settings, true)));
      batch.forEach((r, k) => (results[k] ? sent : failed).push(r.reservation_number));
    }
    return { sent, failed };
  }

  private async loadSettings(store_id: number): Promise<GuestMessageSettings> {
    const row = await this.prisma.store_settings.findFirst({
      where: { store_id },
      select: { settings: true },
    });
    return guestMessageSettings(
      (row?.settings as { hospitality?: Record<string, unknown> } | null)?.hospitality,
    );
  }

  private requireStoreId(): number {
    const store_id = RequestContextService.getContext()?.store_id;
    if (!store_id) throw new Error('Store context required');
    return store_id;
  }

  private async runStore(store_id: number, now: Date): Promise<number> {
    const settings = await this.loadSettings(store_id);
    if (!settings.confirmation && !settings.pre_arrival && !settings.post_stay) return 0;

    const timezone = await resolveStoreTimezone(this.prisma, store_id);
    const today = new Date(`${localDateString(now, timezone)}T00:00:00.000Z`);
    const recent = new Date(now.getTime() - RECENT_MS);
    let sent = 0;

    if (settings.confirmation) {
      const rows = await this.prisma.lodging_reservations.findMany({
        where: {
          status: 'confirmed',
          arrival_date: { gte: today },
          online_payments: { none: {} },
          events: { some: { to_status: 'confirmed', created_at: { gte: recent } } },
          ...notSent('confirmation'),
        },
        select: RESERVATION_SELECT,
      });
      for (const r of rows) sent += await this.send(store_id, 'confirmation', r, settings);
    }

    if (settings.pre_arrival) {
      const horizon = new Date(today.getTime() + (Math.ceil(settings.pre_arrival_hours / 24) + 1) * DAY_MS);
      const rows = await this.prisma.lodging_reservations.findMany({
        where: {
          status: 'confirmed',
          arrival_date: { gte: today, lte: horizon },
          ...notSent('pre_arrival'),
        },
        select: RESERVATION_SELECT,
      });
      for (const r of rows) {
        const arrival = r.arrival_date.toISOString().slice(0, 10);
        if (!preArrivalDue(arrival, settings.check_in_time, settings.pre_arrival_hours, now, timezone)) continue;
        sent += await this.send(store_id, 'pre_arrival', r, settings);
      }
    }

    if (settings.post_stay) {
      const rows = await this.prisma.lodging_reservations.findMany({
        where: {
          status: 'checked_out',
          events: { some: { to_status: 'checked_out', created_at: { gte: recent } } },
          ...notSent('post_stay'),
        },
        select: RESERVATION_SELECT,
      });
      for (const r of rows) sent += await this.send(store_id, 'post_stay', r, settings);
    }
    return sent;
  }

  /**
   * Claims the log row, sends, and releases the claim if the email did not go
   * out. Never throws. `manual` (H9.4, the desk asked for it) sends even when
   * the row already exists and requires the online check-in link.
   */
  private async send(
    store_id: number,
    key: GuestMessageKey,
    reservation: Candidate,
    settings: GuestMessageSettings,
    manual = false,
  ): Promise<number> {
    const to = reservation.customer.email?.trim();
    if (!to) return 0;
    let logId: number | null = null;
    try {
      const log = await this.prisma.lodging_guest_message_logs.create({
        data: { store_id, reservation_id: reservation.id, message_key: key, channel: CHANNEL },
        select: { id: true },
      });
      logId = log.id;
    } catch (err: unknown) {
      const duplicate = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
      if (!duplicate) {
        if (manual) return 0;
        throw err;
      }
      if (!manual) return 0;
    }

    try {
      const arrival = reservation.arrival_date.toISOString().slice(0, 10);
      const departure = reservation.departure_date.toISOString().slice(0, 10);
      const precheckin_done = !!reservation.precheckin_completed_at;
      const precheckin_url =
        key === 'pre_arrival' && !precheckin_done ? await this.precheckinUrl(reservation.id) : null;
      if (manual && !precheckin_url) throw new Error('online check-in link unavailable');
      const message = guestMessageEmail(key, {
        guest_name: reservation.customer.first_name?.trim() || 'Hola',
        store_name: reservation.store?.name ?? 'el hotel',
        reservation_number: reservation.reservation_number,
        arrival_date: arrival,
        departure_date: departure,
        nights: stayNights(arrival, departure).length,
        room_type: reservation.rooms.map((room) => room.unit_type.name).join(', '),
        check_in_time: settings.check_in_time,
        check_out_time: settings.check_out_time,
        precheckin_done,
        precheckin_url,
        review_url: key === 'post_stay' && settings.post_stay_review ? await this.reviewUrl(reservation.id) : null,
      });
      const result = await this.email.sendEmail(to, message.subject, message.html, message.text);
      if (result.success) return 1;
      this.logger.error(`Guest ${key} email for reservation ${reservation.id} not sent: ${result.error}`);
    } catch (err: unknown) {
      this.logger.error(
        `Guest ${key} email for reservation ${reservation.id} failed: ${err instanceof Error ? err.message : err}`,
      );
    }
    if (logId !== null) {
      await this.prisma.lodging_guest_message_logs.deleteMany({ where: { id: logId } }).catch(() => undefined);
    }
    return 0;
  }

  /** The H8.1 link; without an online domain the reminder still goes out, without it. */
  private async precheckinUrl(reservation_id: number): Promise<string | null> {
    try {
      return (await this.precheckin.getLink(reservation_id)).url;
    } catch {
      return null;
    }
  }

  /** H8.5 — the stay rating link; without it (no online domain) the thank-you still goes out. */
  private async reviewUrl(reservation_id: number): Promise<string | null> {
    try {
      return await this.stayReview.linkFor(reservation_id);
    } catch {
      return null;
    }
  }
}
