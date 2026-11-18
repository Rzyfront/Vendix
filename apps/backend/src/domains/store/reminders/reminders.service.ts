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
import {
  ReminderLinkAccess,
  ReminderLinkOption,
  ReminderLinkScope,
  accessFromContext,
  canOpenLink,
  findLinkedRecords,
  linkKey,
  linkRoute,
  linkTypeLabel,
  searchLinkableRecords,
} from './reminder-links';

export const REMINDER_DUE_NOTIFICATION = 'reminder_due';
/** The dashboard opens its "Bitácora" tab with this query param. */
export const REMINDERS_ROUTE = '/admin/dashboard?tab=bitacora';

const DEFAULT_LIMIT = 100;
/** Link search: hits per record type. */
const LINK_SEARCH_PER_TYPE = 5;
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
  /** Readable type, e.g. "Orden de compra". */
  type_label: string;
  id: number | null;
  label: string;
  /**
   * False when the record was deleted (or archived) or the user may not open
   * its module: the UI shows "no disponible" and `url` is null.
   */
  available: boolean;
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
    const items = (await this.toViews(actor, rows, window)).sort(
      (a, b) => BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket],
    );
    return {
      items,
      timezone: window.tz,
      now_local: `${formatStoreDate(window.now, window.tz)} ${formatStoreTime(window.now, window.tz)}`,
    };
  }

  async findOne(actor: ReminderActor, id: number): Promise<ReminderView> {
    const row = await this.findOwned(actor, id);
    return this.toOneView(actor, row, await this.dayWindow(actor.store_id));
  }

  /**
   * Records the actor may link, found by number or name: only the store of
   * the session and only the types whose READ permission the user holds.
   */
  async searchLinks(actor: ReminderActor, q: string): Promise<ReminderLinkOption[]> {
    return searchLinkableRecords(
      this.prisma,
      this.linkScope(actor),
      this.access(),
      q.trim(),
      LINK_SEARCH_PER_TYPE,
    );
  }

  async create(
    actor: ReminderActor,
    dto: CreateReminderDto,
    source: ReminderSource = 'manual',
  ): Promise<ReminderView> {
    const window = await this.dayWindow(actor.store_id);
    const link = await this.resolveLink(
      actor,
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
    return this.toOneView(actor, row, window);
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
        actor,
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
    return this.toOneView(actor, await this.findOwned(actor, id), window);
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

  /** Store (and its organization, for suppliers) the link lookups are bound to. */
  private linkScope(actor: ReminderActor): ReminderLinkScope {
    return {
      store_id: actor.store_id,
      organization_id: RequestContextService.getContext()?.organization_id ?? null,
    };
  }

  /** READ permissions of the session user (HTTP request or Vex context). */
  private access(): ReminderLinkAccess {
    return accessFromContext(RequestContextService.getContext());
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
   * Validates that the linked record exists in the actor's store and that the
   * user may open its module, and fills the readable label when none was
   * given. A record without permission answers exactly like a missing one,
   * so a link by id never reveals a label the user could not read.
   */
  private async resolveLink(
    actor: ReminderActor,
    type: ReminderLinkType | null,
    id: number | null,
    label: string | null,
  ): Promise<{ type: ReminderLinkType; id: number | null; label: string } | null> {
    if (!type) {
      if (id || label) throw new VendixHttpException(ErrorCodes.REMINDER_LINK_001);
      return null;
    }
    if (type === 'metric') {
      if (!label) throw new VendixHttpException(ErrorCodes.REMINDER_LINK_001);
      return { type, id: null, label };
    }
    if (!id || !canOpenLink(type, this.access())) {
      throw new VendixHttpException(ErrorCodes.REMINDER_LINK_001);
    }
    const found = await findLinkedRecords(this.prisma, this.linkScope(actor), [{ type, id }]);
    const current = found.get(linkKey(type, id));
    if (current === undefined) throw new VendixHttpException(ErrorCodes.REMINDER_LINK_001);
    return { type, id, label: label || current };
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

  private async toOneView(
    actor: ReminderActor,
    row: ReminderRow,
    window: DayWindow,
  ): Promise<ReminderView> {
    return (await this.toViews(actor, [row], window))[0];
  }

  /**
   * Views of the rows, with each link checked on read: the record must still
   * exist in the store (one query per linked type) and the user must be
   * allowed to open it; otherwise the link is "no disponible".
   */
  private async toViews(
    actor: ReminderActor,
    rows: ReminderRow[],
    window: DayWindow,
  ): Promise<ReminderView[]> {
    const links = rows.flatMap((row) =>
      row.link_type ? [{ type: row.link_type as ReminderLinkType, id: row.link_id }] : [],
    );
    const existing = links.length
      ? await findLinkedRecords(this.prisma, this.linkScope(actor), links)
      : new Map<string, string>();
    const access = this.access();
    return rows.map((row) => this.toView(row, window, existing, access));
  }

  private toView(
    row: ReminderRow,
    window: DayWindow,
    existing: Map<string, string>,
    access: ReminderLinkAccess,
  ): ReminderView {
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
      link: this.linkView(row, existing, access),
      source: row.source,
      completed_at: row.completed_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  private linkView(
    row: ReminderRow,
    existing: Map<string, string>,
    access: ReminderLinkAccess,
  ): ReminderLink | null {
    const type = row.link_type as ReminderLinkType | null;
    if (!type || !row.link_label) return null;
    const available =
      canOpenLink(type, access) &&
      (type === 'metric' || (!!row.link_id && existing.has(linkKey(type, row.link_id))));
    return {
      type,
      type_label: linkTypeLabel(type),
      id: row.link_id,
      label: row.link_label,
      available,
      url: available ? linkRoute(type, row.link_id) : null,
    };
  }
}
