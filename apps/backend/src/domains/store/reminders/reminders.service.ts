import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '../../../common/errors';
import {
  formatStoreDate,
  formatStoreTime,
  localCivil,
  resolveStoreTimezone,
  zonedWallClockToUtc,
} from '../../../common/utils/store-timezone.util';
import {
  CreateReminderDto,
  ReminderDueFilter,
  ReminderLinkType,
  ReminderSource,
  RemindersQueryDto,
  UpdateReminderDto,
} from './dto/reminders.dto';

export const REMINDER_DUE_NOTIFICATION = 'reminder_due';
/** The dashboard opens its "Bitácora" tab with this query param. */
export const REMINDERS_ROUTE = '/admin/dashboard?tab=bitacora';

const DEFAULT_LIMIT = 100;
/** A date without time ("el viernes") reminds at this store-local hour. */
const DATE_ONLY_HOUR = 8;
const MINUTE_MS = 60_000;

/** Epoch millis floored to the minute, or null when there is no date. */
function minuteOf(date: Date | null | undefined): number | null {
  return date ? Math.floor(date.getTime() / MINUTE_MS) * MINUTE_MS : null;
}

/**
 * Owner of every reminder operation. Always taken from the session (HTTP
 * request context) or from the agent's execution context, never from the
 * request body.
 */
export interface ReminderActor {
  store_id: number;
  user_id: number;
}

export type ReminderBucket = 'overdue' | 'today' | 'upcoming' | 'no_date' | 'done';

export interface ReminderLink {
  type: ReminderLinkType;
  id: number | null;
  label: string;
  url: string | null;
}

export interface ReminderView {
  id: number;
  title: string;
  note: string | null;
  remind_at: Date | null;
  /** `dd/mm/yyyy hh:mm a. m.` in the store timezone, for chat answers. */
  remind_at_local: string | null;
  status: 'pending' | 'done';
  bucket: ReminderBucket;
  link: ReminderLink | null;
  source: ReminderSource;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

type ReminderRow = Prisma.user_remindersGetPayload<object>;

interface DayWindow {
  tz: string;
  now: Date;
  todayStart: Date;
  tomorrowStart: Date;
}

const BUCKET_ORDER: Record<ReminderBucket, number> = {
  overdue: 0,
  today: 1,
  upcoming: 2,
  no_date: 3,
  done: 4,
};

const LINK_ROUTES: Record<ReminderLinkType, (id: number | null) => string | null> = {
  product: (id) => (id ? `/admin/products/${id}` : null),
  order: (id) => (id ? `/admin/orders/${id}` : null),
  customer: (id) => (id ? `/admin/customers/${id}` : null),
  supplier: (id) => (id ? `/admin/inventory/suppliers/${id}` : null),
  metric: () => '/admin/dashboard',
};

/**
 * QUI-580 — personal reminders log (bitácora). A reminder belongs to ONE user
 * inside ONE store: `StorePrismaService` scopes every query to the context
 * store and, on top of that, every query here also filters by the actor's
 * `store_id` AND `user_id`. A foreign id answers 404, never 403.
 *
 * "Today" and "overdue" are measured in the store's timezone
 * (skill vendix-date-timezone); the due notification is `UserReminderDueJob`.
 */
@Injectable()
export class RemindersService {
  constructor(private readonly prisma: StorePrismaService) {}

  /** Actor of an HTTP request: the session's store and user. */
  actorFromRequest(): ReminderActor {
    const context = RequestContextService.getContext();
    if (!context?.store_id || !context.user_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    return { store_id: context.store_id, user_id: context.user_id };
  }

  async list(actor: ReminderActor, query: RemindersQueryDto = {}) {
    const window = await this.dayWindow(actor.store_id);
    const status = query.status ?? 'pending';
    const and: Prisma.user_remindersWhereInput[] = [this.owned(actor)];
    if (status !== 'all') and.push({ status });
    if (query.due) and.push(this.dueWhere(query.due, window));

    const rows = await this.prisma.user_reminders.findMany({
      where: { AND: and },
      orderBy: [
        { status: 'asc' },
        { remind_at: { sort: 'asc', nulls: 'last' } },
        { id: 'desc' },
      ],
      take: query.limit ?? DEFAULT_LIMIT,
    });
    const items = rows
      .map((row) => this.toView(row, window))
      .sort((a, b) => BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket]);
    return {
      items,
      timezone: window.tz,
      now_local: `${formatStoreDate(window.now, window.tz)} ${formatStoreTime(window.now, window.tz)}`,
    };
  }

  async findOne(actor: ReminderActor, id: number): Promise<ReminderView> {
    const row = await this.findOwned(actor, id);
    return this.toView(row, await this.dayWindow(actor.store_id));
  }

  async create(
    actor: ReminderActor,
    dto: CreateReminderDto,
    source: ReminderSource = 'manual',
  ): Promise<ReminderView> {
    const window = await this.dayWindow(actor.store_id);
    const link = await this.resolveLink(
      dto.link_type ?? null,
      dto.link_id ?? null,
      dto.link_label ?? null,
    );
    const row = await this.prisma.user_reminders.create({
      data: {
        store_id: actor.store_id,
        user_id: actor.user_id,
        title: dto.title.trim(),
        note: dto.note?.trim() || null,
        remind_at: this.parseRemindAt(dto.remind_at, window.tz),
        source,
        link_type: link?.type ?? null,
        link_id: link?.id ?? null,
        link_label: link?.label ?? null,
      },
    });
    return this.toView(row, window);
  }

  async update(
    actor: ReminderActor,
    id: number,
    dto: UpdateReminderDto,
  ): Promise<ReminderView> {
    const current = await this.findOwned(actor, id);
    const window = await this.dayWindow(actor.store_id);
    const data: Prisma.user_remindersUncheckedUpdateManyInput = {};

    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.note !== undefined) data.note = dto.note?.trim() || null;
    if (dto.remind_at !== undefined) {
      const remindAt = this.parseRemindAt(dto.remind_at, window.tz);
      // Minute precision on both sides: re-sending the same minute (the
      // modal always sends `YYYY-MM-DDTHH:mm`) must not re-arm a sent notice.
      if (minuteOf(remindAt) !== minuteOf(current.remind_at)) {
        data.remind_at = remindAt;
        // A new date re-arms the one-time due notification.
        data.notified_at = null;
      }
    }
    if (dto.status !== undefined && dto.status !== current.status) {
      data.status = dto.status;
      data.completed_at = dto.status === 'done' ? new Date() : null;
    }
    if (dto.link_type === null) {
      data.link_type = null;
      data.link_id = null;
      data.link_label = null;
    } else if (dto.link_type !== undefined) {
      const link = await this.resolveLink(
        dto.link_type,
        dto.link_id ?? null,
        dto.link_label ?? null,
      );
      data.link_type = link?.type ?? null;
      data.link_id = link?.id ?? null;
      data.link_label = link?.label ?? null;
    } else if (dto.link_label && current.link_type) {
      data.link_label = dto.link_label;
    }

    if (Object.keys(data).length) {
      const result = await this.prisma.user_reminders.updateMany({
        where: { id, ...this.owned(actor) },
        data,
      });
      if (!result.count) throw new VendixHttpException(ErrorCodes.REMINDER_001);
    }
    return this.toView(await this.findOwned(actor, id), window);
  }

  async remove(
    actor: ReminderActor,
    id: number,
  ): Promise<{ id: number; title: string }> {
    const current = await this.findOwned(actor, id);
    const result = await this.prisma.user_reminders.deleteMany({
      where: { id, ...this.owned(actor) },
    });
    if (!result.count) throw new VendixHttpException(ErrorCodes.REMINDER_001);
    return { id: current.id, title: current.title };
  }

  /** Ownership filter applied to EVERY query: store AND user of the actor. */
  private owned(actor: ReminderActor) {
    return { store_id: actor.store_id, user_id: actor.user_id };
  }

  private async findOwned(actor: ReminderActor, id: number): Promise<ReminderRow> {
    const row = await this.prisma.user_reminders.findFirst({
      where: { id, ...this.owned(actor) },
    });
    if (!row) throw new VendixHttpException(ErrorCodes.REMINDER_001);
    return row;
  }

  private dueWhere(
    due: ReminderDueFilter,
    window: DayWindow,
  ): Prisma.user_remindersWhereInput {
    switch (due) {
      case 'overdue':
        return { status: 'pending', remind_at: { lt: window.now } };
      case 'today':
        return {
          status: 'pending',
          remind_at: { gte: window.now, lt: window.tomorrowStart },
        };
      case 'upcoming':
        return { status: 'pending', remind_at: { gte: window.tomorrowStart } };
      case 'no_date':
        return { status: 'pending', remind_at: null };
    }
  }

  /**
   * `YYYY-MM-DDTHH:mm[:ss]` without offset is a store-local wall clock;
   * `YYYY-MM-DD` reminds at {@link DATE_ONLY_HOUR} local; anything with `Z` or
   * an offset is an absolute instant. Seconds are accepted but dropped: a
   * reminder has minute precision (the due job runs every minute).
   */
  parseRemindAt(value: string | null | undefined, tz: string): Date | null {
    if (value === undefined || value === null || value.trim() === '') return null;
    const raw = value.trim();
    const local = raw.match(
      /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/,
    );
    if (local) {
      const [, y, mo, d, h, mi, s] = local;
      const parts = [Number(y), Number(mo), Number(d)];
      const hour = h === undefined ? DATE_ONLY_HOUR : Number(h);
      const minute = mi === undefined ? 0 : Number(mi);
      const second = s === undefined ? 0 : Number(s);
      if (
        parts[1] < 1 || parts[1] > 12 || parts[2] < 1 || parts[2] > 31 ||
        hour > 23 || minute > 59 || second > 59
      ) {
        throw new VendixHttpException(ErrorCodes.REMINDER_DATE_001);
      }
      return zonedWallClockToUtc(parts[0], parts[1], parts[2], hour, minute, 0, 0, tz);
    }
    const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(raw);
    const instant = new Date(raw);
    if (!hasZone || Number.isNaN(instant.getTime())) {
      throw new VendixHttpException(ErrorCodes.REMINDER_DATE_001);
    }
    return new Date(minuteOf(instant)!);
  }

  /**
   * Validates that the linked record exists in the CONTEXT store (scoped
   * Prisma) and fills the readable label when none was given.
   */
  private async resolveLink(
    type: ReminderLinkType | null,
    id: number | null,
    label: string | null,
  ): Promise<ReminderLink | null> {
    if (!type) {
      if (id || label) throw new VendixHttpException(ErrorCodes.REMINDER_LINK_001);
      return null;
    }
    if (type === 'metric') {
      if (!label) throw new VendixHttpException(ErrorCodes.REMINDER_LINK_001);
      return { type, id: null, label, url: LINK_ROUTES.metric(null) };
    }
    if (!id) throw new VendixHttpException(ErrorCodes.REMINDER_LINK_001);
    const found = await this.linkedLabel(type, id);
    if (found === null) throw new VendixHttpException(ErrorCodes.REMINDER_LINK_001);
    return { type, id, label: label || found, url: LINK_ROUTES[type](id) };
  }

  private async linkedLabel(
    type: Exclude<ReminderLinkType, 'metric'>,
    id: number,
  ): Promise<string | null> {
    switch (type) {
      case 'product': {
        const row = await this.prisma.products.findFirst({
          where: { id },
          select: { name: true },
        });
        return row ? row.name : null;
      }
      case 'order': {
        const row = await this.prisma.orders.findFirst({
          where: { id },
          select: { order_number: true },
        });
        return row ? `Orden ${row.order_number}` : null;
      }
      case 'customer': {
        const row = await this.prisma.store_users.findFirst({
          where: { user_id: id },
          select: { user: { select: { first_name: true, last_name: true } } },
        });
        if (!row) return null;
        return (
          [row.user?.first_name, row.user?.last_name].filter(Boolean).join(' ') ||
          `Cliente #${id}`
        );
      }
      case 'supplier': {
        const row = await this.prisma.suppliers.findFirst({
          where: { id },
          select: { name: true },
        });
        return row ? row.name : null;
      }
    }
  }

  private async dayWindow(storeId: number): Promise<DayWindow> {
    const tz = await resolveStoreTimezone(this.prisma, storeId);
    const now = new Date();
    const civil = localCivil(now, tz);
    const at = (offsetDays: number) =>
      zonedWallClockToUtc(civil.year, civil.month, civil.day + offsetDays, 0, 0, 0, 0, tz);
    return { tz, now, todayStart: at(0), tomorrowStart: at(1) };
  }

  private bucket(row: ReminderRow, window: DayWindow): ReminderBucket {
    if (row.status === 'done') return 'done';
    if (!row.remind_at) return 'no_date';
    if (row.remind_at < window.now) return 'overdue';
    if (row.remind_at < window.tomorrowStart) return 'today';
    return 'upcoming';
  }

  private toView(row: ReminderRow, window: DayWindow): ReminderView {
    const type = row.link_type as ReminderLinkType | null;
    return {
      id: row.id,
      title: row.title,
      note: row.note,
      remind_at: row.remind_at,
      remind_at_local: row.remind_at
        ? `${formatStoreDate(row.remind_at, window.tz)} ${formatStoreTime(row.remind_at, window.tz)}`
        : null,
      status: row.status,
      bucket: this.bucket(row, window),
      link:
        type && row.link_label
          ? {
              type,
              id: row.link_id,
              label: row.link_label,
              url: LINK_ROUTES[type]?.(row.link_id) ?? null,
            }
          : null,
      source: row.source,
      completed_at: row.completed_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}
