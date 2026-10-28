import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import {
  localDateString,
  resolveStoreTimezone,
} from '@common/utils/store-timezone.util';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { LodgingAvailabilityService } from '../lodging-availability.service';
import { allotmentReleaseDate } from '../lodging-allotment-holds';
import { addDays } from '../reservation-status';
import { dateOnlyToDb, formatShortDate, stayNights } from '../stay-dates';
import { CreateAllotmentDto, UpdateAllotmentDto } from './allotment.dto';

const toDateOnly = (date: Date) => date.toISOString().slice(0, 10);

const ALLOTMENT_SELECT = {
  id: true,
  customer_id: true,
  unit_type_id: true,
  from_date: true,
  to_date: true,
  rooms: true,
  release_days: true,
  notes: true,
  is_active: true,
  created_at: true,
  customer: {
    select: { id: true, first_name: true, last_name: true, email: true },
  },
  unit_type: { select: { id: true, name: true } },
} satisfies Prisma.lodging_allotmentsSelect;

type AllotmentRow = Prisma.lodging_allotmentsGetPayload<{
  select: typeof ALLOTMENT_SELECT;
}>;

/**
 * Hospitality Suite (H2.5) — allotments: "3 Dobles para Viajes X en
 * diciembre, liberar 7 días antes". The held rooms leave public sale (see
 * LodgingAvailabilityService); the agency's own reservations consume them,
 * and what it has not booked returns to the public `release_days` before
 * each night. Creating or growing an allotment needs those rooms free. A
 * customer has at most one active allotment per room type on a night (edit
 * it to grow it). Allotments are switched off, not deleted.
 */
@Injectable()
export class LodgingAllotmentsService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly availability: LodgingAvailabilityService,
  ) {}

  async findAll() {
    const store_id = this.requireStoreId();
    const [rows, timezone] = await Promise.all([
      this.prisma.lodging_allotments.findMany({
        select: ALLOTMENT_SELECT,
        orderBy: [{ is_active: 'desc' }, { from_date: 'asc' }, { id: 'asc' }],
      }),
      resolveStoreTimezone(this.prisma, store_id),
    ]);
    const today = localDateString(new Date(), timezone);
    return rows.map((row) => this.present(row, today));
  }

  async create(dto: CreateAllotmentDto) {
    const store_id = this.requireStoreId();
    const allotment = {
      from_date: dto.from_date,
      to_date: dto.to_date,
      rooms: dto.rooms,
    };
    const nights = this.nightsOf(allotment.from_date, allotment.to_date);
    const unitType = await this.prisma.lodging_unit_types.findFirst({
      where: { id: dto.unit_type_id, is_active: true },
      select: { id: true, name: true },
    });
    if (!unitType) {
      throw new VendixHttpException(ErrorCodes.LODGING_RESERVATION_TYPE_001);
    }
    const customer = await this.prisma.users.findFirst({
      where: { id: dto.customer_id, store_users: { some: { store_id } } },
      select: { id: true },
    });
    if (!customer) {
      throw new VendixHttpException(
        ErrorCodes.LODGING_RESERVATION_CUSTOMER_001,
      );
    }
    const id = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, store_id);
      await this.assertNoOverlap(tx, store_id, {
        ...allotment,
        customer_id: dto.customer_id,
        unit_type_id: unitType.id,
      });
      await this.assertRoomsFree(
        tx,
        unitType,
        dto.customer_id,
        nights,
        allotment.rooms,
      );
      const created = await tx.lodging_allotments.create({
        data: {
          store_id,
          customer_id: dto.customer_id,
          unit_type_id: unitType.id,
          from_date: dateOnlyToDb(allotment.from_date),
          to_date: dateOnlyToDb(allotment.to_date),
          rooms: allotment.rooms,
          release_days: dto.release_days ?? 7,
          notes: dto.notes || null,
          updated_at: new Date(),
        },
      });
      return created.id;
    });
    return this.findOne(id);
  }

  async update(id: number, dto: UpdateAllotmentDto) {
    const store_id = this.requireStoreId();
    const current = await this.findRow(id);
    const next = {
      from_date: dto.from_date ?? toDateOnly(current.from_date),
      to_date: dto.to_date ?? toDateOnly(current.to_date),
      rooms: dto.rooms ?? current.rooms,
      is_active: dto.is_active ?? current.is_active,
    };
    const nights = this.nightsOf(next.from_date, next.to_date);
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, store_id);
      // Switching off or shrinking only frees rooms: no check needed.
      if (next.is_active) {
        await this.assertNoOverlap(tx, store_id, {
          ...next,
          id: current.id,
          customer_id: current.customer_id,
          unit_type_id: current.unit_type_id,
        });
        await this.assertRoomsFree(
          tx,
          current.unit_type,
          current.customer_id,
          nights,
          next.rooms,
        );
      }
      await tx.lodging_allotments.updateMany({
        where: { id: current.id, store_id },
        data: {
          from_date: dateOnlyToDb(next.from_date),
          to_date: dateOnlyToDb(next.to_date),
          rooms: next.rooms,
          ...(dto.release_days !== undefined
            ? { release_days: dto.release_days }
            : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes || null } : {}),
          is_active: next.is_active,
          updated_at: new Date(),
        },
      });
    });
    return this.findOne(id);
  }

  private async findOne(id: number) {
    const store_id = this.requireStoreId();
    const [row, timezone] = await Promise.all([
      this.findRow(id),
      resolveStoreTimezone(this.prisma, store_id),
    ]);
    return this.present(row, localDateString(new Date(), timezone));
  }

  private async findRow(id: number): Promise<AllotmentRow> {
    const row = await this.prisma.lodging_allotments.findFirst({
      where: { id },
      select: ALLOTMENT_SELECT,
    });
    if (!row) {
      throw new VendixHttpException(ErrorCodes.LODGING_ALLOTMENT_FIND_001);
    }
    return row;
  }

  /** Dates as `YYYY-MM-DD` plus when the next held night is released. */
  private present(row: AllotmentRow, today: string) {
    const from_date = toDateOnly(row.from_date);
    const to_date = toDateOnly(row.to_date);
    // First night still held today: the one released after today.
    const firstHeld = [from_date, addDays(today, row.release_days + 1)]
      .sort()
      .pop()!;
    const next_release_date =
      row.is_active && firstHeld <= to_date
        ? allotmentReleaseDate(firstHeld, row.release_days)
        : null;
    return { ...row, from_date, to_date, next_release_date };
  }

  /** Nights of the allotment; dates in order and at most a year long. */
  private nightsOf(from_date: string, to_date: string): string[] {
    if (to_date < from_date) {
      throw new VendixHttpException(ErrorCodes.LODGING_ALLOTMENT_DATES_001);
    }
    return stayNights(from_date, addDays(to_date, 1));
  }

  /**
   * One active allotment per customer × room type on a night, so the rooms a
   * customer booked are consumed from a single allotment.
   */
  private async assertNoOverlap(
    tx: Prisma.TransactionClient,
    store_id: number,
    allotment: {
      id?: number;
      customer_id: number;
      unit_type_id: number;
      from_date: string;
      to_date: string;
    },
  ) {
    const clash = await tx.lodging_allotments.findFirst({
      where: {
        store_id,
        is_active: true,
        customer_id: allotment.customer_id,
        unit_type_id: allotment.unit_type_id,
        from_date: { lte: dateOnlyToDb(allotment.to_date) },
        to_date: { gte: dateOnlyToDb(allotment.from_date) },
        ...(allotment.id ? { id: { not: allotment.id } } : {}),
      },
      select: { from_date: true, to_date: true },
    });
    if (clash) {
      throw new VendixHttpException(
        ErrorCodes.LODGING_ALLOTMENT_OVERLAP_001,
        `Ya tiene un cupo de este tipo del ${formatShortDate(toDateOnly(clash.from_date))} al ${formatShortDate(toDateOnly(clash.to_date))}: edítalo en vez de crear otro`,
      );
    }
  }

  private async assertRoomsFree(
    tx: Prisma.TransactionClient,
    unitType: { id: number; name: string },
    customer_id: number,
    nights: string[],
    rooms: number,
  ) {
    const tightest = await this.availability.allotmentCapacity(
      unitType.id,
      nights,
      customer_id,
      tx,
    );
    if (tightest.free < rooms) {
      throw new VendixHttpException(
        ErrorCodes.LODGING_ALLOTMENT_AVAILABILITY_001,
        `Solo quedan ${Math.max(0, tightest.free)} ${unitType.name} libres el ${formatShortDate(tightest.night)} para el cupo`,
      );
    }
  }

  /** Same lock as a sale, so a cupo and a reservation cannot both take a room. */
  private async lock(tx: Prisma.TransactionClient, store_id: number) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`lodging_reservations:${store_id}`}))`;
  }

  private requireStoreId(): number {
    const store_id = RequestContextService.getContext()?.store_id;
    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    return store_id;
  }
}
