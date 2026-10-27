import { Injectable } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { daysBetweenDateStrings } from '@common/utils/store-timezone.util';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { dateOnlyToDb } from '../reservations/stay-dates';
import { RestrictionQueryDto, SetRestrictionsDto } from './dto';
import { StayRestriction } from './lodging-restriction-validator';

/** Longest range one calendar request reads or writes. */
const MAX_RANGE_DAYS = 366;

const RULE_SELECT = {
  unit_type_id: true,
  date: true,
  min_stay: true,
  max_stay: true,
  closed_to_arrival: true,
  closed_to_departure: true,
  stop_sell: true,
} as const;

const RESTRICTION_SELECT = { id: true, ...RULE_SELECT } as const;

/** Nights from `from` to `to`, both included, as `YYYY-MM-DD`. */
function nightsBetween(from: string, to: string): string[] {
  const count = daysBetweenDateStrings(from, to);
  if (!(count >= 0) || count >= MAX_RANGE_DAYS) {
    throw new VendixHttpException(ErrorCodes.LODGING_RESTRICTION_DATES_001);
  }
  const start = dateOnlyToDb(from).getTime();
  return Array.from({ length: count + 1 }, (_, i) =>
    new Date(start + i * 86_400_000).toISOString().slice(0, 10),
  );
}

/**
 * Restrictions that can touch a stay: from its arrival to its departure
 * (both included, CTD is read on the departure date). The client is the
 * store-scoped one, so only the store's rows come back.
 */
export async function loadStayRestrictions(
  client: Pick<StorePrismaService, 'lodging_restrictions'>,
  arrival_date: string,
  departure_date: string,
): Promise<StayRestriction[]> {
  const rows = await client.lodging_restrictions.findMany({
    where: { date: { gte: dateOnlyToDb(arrival_date), lte: dateOnlyToDb(departure_date) } },
    select: RULE_SELECT,
  });
  return rows.map((row) => ({ ...row, date: row.date.toISOString().slice(0, 10) }));
}

/** H2.3 — permission that lets the desk sell a stay that breaks restrictions. */
export const RESTRICTION_OVERRIDE_PERMISSION = 'store:lodging:rates:write';

/**
 * Forcing a restricted stay is a revenue decision: only owners, super admins
 * or users with `rates:write` do it (booking itself needs `reservations:write`).
 */
export function assertCanOverrideRestrictions(): void {
  const context = RequestContextService.getContext();
  if (
    context?.is_super_admin ||
    context?.is_owner ||
    context?.permissions?.includes(RESTRICTION_OVERRIDE_PERMISSION)
  ) {
    return;
  }
  throw new VendixHttpException(ErrorCodes.LODGING_RESTRICTION_OVERRIDE_001);
}

/**
 * Hospitality Suite (H2.3) — per-night stay restrictions edited from the rates
 * calendar: minimum/maximum stay, closed to arrival/departure and stop-sell,
 * for every room type or one type.
 */
@Injectable()
export class LodgingRestrictionsService {
  constructor(private readonly prisma: StorePrismaService) {}

  async findRange(query: RestrictionQueryDto) {
    nightsBetween(query.from, query.to);
    const rows = await this.prisma.lodging_restrictions.findMany({
      where: { date: { gte: dateOnlyToDb(query.from), lte: dateOnlyToDb(query.to) } },
      select: RESTRICTION_SELECT,
      orderBy: [{ date: 'asc' }, { unit_type_id: 'asc' }],
    });
    return rows.map((row) => ({ ...row, date: row.date.toISOString().slice(0, 10) }));
  }

  /** Replaces the scope's restrictions of each night; all empty clears them. */
  async set(dto: SetRestrictionsDto) {
    const store_id = this.requireStoreId();
    const to_date = dto.to_date ?? dto.from_date;
    const nights = nightsBetween(dto.from_date, to_date);
    const unit_type_id = dto.unit_type_id ?? null;
    if (unit_type_id != null) {
      const type = await this.prisma.lodging_unit_types.findFirst({
        where: { id: unit_type_id },
        select: { id: true },
      });
      if (!type) throw new VendixHttpException(ErrorCodes.LODGING_UNIT_TYPE_FIND_001);
    }
    const values = {
      min_stay: dto.min_stay && dto.min_stay > 1 ? dto.min_stay : null,
      max_stay: dto.max_stay ?? null,
      closed_to_arrival: dto.closed_to_arrival ?? false,
      closed_to_departure: dto.closed_to_departure ?? false,
      stop_sell: dto.stop_sell ?? false,
    };
    if (values.min_stay != null && values.max_stay != null && values.max_stay < values.min_stay) {
      throw new VendixHttpException(ErrorCodes.LODGING_RESTRICTION_RANGE_001);
    }
    const empty =
      values.min_stay == null &&
      values.max_stay == null &&
      !values.closed_to_arrival &&
      !values.closed_to_departure &&
      !values.stop_sell;
    const now = new Date();
    const dates = nights.map(dateOnlyToDb);

    await this.prisma.$transaction(async (tx) => {
      // One writer per store and scope, so the replace never duplicates a night.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`lodging_restrictions:${store_id}`}))`;
      // Inside `$transaction` the client is not store-scoped: name the store.
      await tx.lodging_restrictions.deleteMany({
        where: { store_id, unit_type_id, date: { in: dates } },
      });
      if (!empty) {
        await tx.lodging_restrictions.createMany({
          data: dates.map((date) => ({ store_id, unit_type_id, date, ...values, updated_at: now })),
        });
      }
    });
    return this.findRange({ from: dto.from_date, to: to_date });
  }

  private requireStoreId(): number {
    const store_id = RequestContextService.getContext()?.store_id;
    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    return store_id;
  }
}
