import { Injectable } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { LodgingAvailabilityService } from '../lodging-availability.service';
import { dateOnlyToDb, formatShortDate, stayNights } from '../stay-dates';
import { isSellableHousekeeping } from '../../housekeeping/housekeeping-status';
import { CreateInventoryBlockDto } from './inventory-block.dto';

/** Same queue and limits as a sale: a block waits on the store's sale lock. */
const BLOCK_TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 };

const toDateOnly = (date: Date) => date.toISOString().slice(0, 10);

/**
 * Hospitality Suite (H5.3) — maintenance and owner-use blocks.
 *
 * A block takes one room out of sale for the nights `[from_date, to_date)`
 * while it is active (`released_at` null): availability, the rack and room
 * assignment read it. It runs under the store's sale lock, so a sale or room
 * move cannot slip into the nights being blocked. A room with a reservation
 * assigned on those nights is moved first; a block that would leave the
 * type's unassigned reservations without a room is refused.
 */
@Injectable()
export class LodgingInventoryBlocksService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly availability: LodgingAvailabilityService,
  ) {}

  async create(dto: CreateInventoryBlockDto) {
    const store_id = this.requireStoreId();
    const user_id = RequestContextService.getContext()?.user_id ?? null;
    const nights = stayNights(dto.from_date, dto.to_date);
    const range = { gte: dateOnlyToDb(dto.from_date), lt: dateOnlyToDb(dto.to_date) };

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`lodging_reservations:${store_id}`}))`;
      // Inside `$transaction` the client is not store-scoped: name the store.
      const unit = await tx.lodging_units.findFirst({
        where: { id: dto.unit_id, store_id },
        select: {
          id: true,
          code: true,
          unit_type_id: true,
          is_active: true,
          housekeeping_status: true,
          unit_type: { select: { name: true, overbooking_allowance: true } },
        },
      });
      if (!unit) throw new VendixHttpException(ErrorCodes.LODGING_UNIT_FIND_001);

      const reserved = await tx.lodging_room_nights.findFirst({
        where: { store_id, unit_id: unit.id, is_active: true, night_date: range },
        select: {
          night_date: true,
          reservation_room: { select: { reservation: { select: { reservation_number: true } } } },
        },
        orderBy: { night_date: 'asc' },
      });
      if (reserved) {
        throw new VendixHttpException(
          ErrorCodes.LODGING_BLOCK_RESERVED_001,
          `La ${unit.code} tiene la reserva ${reserved.reservation_room.reservation.reservation_number} el ${formatShortDate(toDateOnly(reserved.night_date))}. Muévela antes de bloquearla.`,
        );
      }

      const overlap = await tx.lodging_inventory_blocks.findFirst({
        where: {
          store_id,
          unit_id: unit.id,
          released_at: null,
          from_date: { lt: range.lt },
          to_date: { gt: range.gte },
        },
        select: { id: true },
      });
      if (overlap) throw new VendixHttpException(ErrorCodes.LODGING_BLOCK_OVERLAP_001);

      // A sellable room leaving the sale must still fit the type's sold nights
      // (its unassigned reservations need a room each).
      if (unit.is_active && isSellableHousekeeping(unit.housekeeping_status)) {
        const inventory = await this.availability.getInventory(
          unit.unit_type_id,
          dto.from_date,
          dto.to_date,
          tx,
        );
        const sold = await tx.lodging_room_nights.groupBy({
          by: ['night_date'],
          where: { store_id, unit_type_id: unit.unit_type_id, is_active: true, night_date: range },
          _count: { _all: true },
        });
        const blocked = (
          await this.availability.blockedByType([unit.unit_type_id], nights, tx)
        ).get(unit.unit_type_id);
        const soldOn = new Map<string, number>(
          sold.map((s) => [toDateOnly(s.night_date), s._count._all]),
        );
        const capacity = inventory.units + inventory.overbooking_allowance;
        const short = nights.find(
          (night, i) => (soldOn.get(night) ?? 0) + (blocked?.[i] ?? 0) + 1 > capacity,
        );
        if (short) {
          throw new VendixHttpException(
            ErrorCodes.LODGING_BLOCK_OVERSOLD_001,
            `Bloquear la ${unit.code} deja sin habitación a reservas de ${unit.unit_type.name} el ${formatShortDate(short)}. Asígnalas o muévelas antes.`,
          );
        }
      }

      const now = new Date();
      return tx.lodging_inventory_blocks.create({
        data: {
          store_id,
          unit_id: unit.id,
          from_date: range.gte,
          to_date: range.lt,
          reason: dto.reason ?? 'maintenance',
          notes: dto.notes || null,
          created_by_user_id: user_id,
          updated_at: now,
        },
      });
    }, BLOCK_TX_OPTIONS);
  }

  /** Closes the ticket: the room goes back to sale for the remaining nights. */
  async release(id: number) {
    const user_id = RequestContextService.getContext()?.user_id ?? null;
    const now = new Date();
    // Conditional on still being active: a double click releases once.
    const updated = await this.prisma.lodging_inventory_blocks.updateMany({
      where: { id, released_at: null },
      data: { released_at: now, released_by_user_id: user_id, updated_at: now },
    });
    const block = await this.prisma.lodging_inventory_blocks.findFirst({ where: { id } });
    if (!block) throw new VendixHttpException(ErrorCodes.LODGING_BLOCK_FIND_001);
    if (updated.count !== 1) throw new VendixHttpException(ErrorCodes.LODGING_BLOCK_RELEASED_001);
    return block;
  }

  private requireStoreId(): number {
    const store_id = RequestContextService.getContext()?.store_id;
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    return store_id;
  }
}
