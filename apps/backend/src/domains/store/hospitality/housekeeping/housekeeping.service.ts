import { Injectable } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { localDateString, resolveStoreTimezone } from '@common/utils/store-timezone.util';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { dateOnlyToDb } from '../reservations/stay-dates';
import { LodgingAvailabilityService } from '../reservations/lodging-availability.service';
import { assertUnitCanLeaveSale } from '../reservations/blocks/leave-sale.guard';
import {
  canChangeHousekeeping,
  HOUSEKEEPING_STATUS_LABELS,
  HOUSEKEEPING_STATUS_PERMISSIONS,
  HousekeepingStatus,
  isSellableHousekeeping,
} from './housekeeping-status';

/** Same queue and limits as a sale: leaving the sale waits on its lock. */
const LEAVE_SALE_TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 };

/** Guest situation of a room today, for the housekeeper's priorities. */
export type HousekeepingOccupancy = 'in_house' | 'departs_today' | null;

export interface HousekeepingBoardUnit {
  id: number;
  code: string;
  floor: string | null;
  zone: string | null;
  housekeeping_status: HousekeepingStatus;
  unit_type: { id: number; name: string };
  occupancy: HousekeepingOccupancy;
}

/**
 * Hospitality Suite (H5.1) — room status board. Lists the active rooms with
 * their housekeeping status and whether a guest is in house or leaves today;
 * the screen groups them by floor. Status changes follow
 * `HOUSEKEEPING_TRANSITIONS` and are conditional on the status the user saw,
 * so two people changing the same room never overwrite each other silently.
 * Inspecting and taking a room out of the sale need more than the
 * housekeeper's permission (`HOUSEKEEPING_STATUS_PERMISSIONS`).
 */
@Injectable()
export class HousekeepingService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly availability: LodgingAvailabilityService,
  ) {}

  async board(): Promise<{ business_date: string; units: HousekeepingBoardUnit[] }> {
    const store_id = RequestContextService.getContext()?.store_id;
    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const timezone = await resolveStoreTimezone(this.prisma, store_id);
    const today = localDateString(new Date(), timezone);

    const [units, stays] = await Promise.all([
      this.prisma.lodging_units.findMany({
        where: { is_active: true },
        select: {
          id: true,
          code: true,
          floor: true,
          zone: true,
          housekeeping_status: true,
          unit_type: { select: { id: true, name: true } },
        },
        orderBy: [{ floor: 'asc' }, { code: 'asc' }],
      }),
      this.prisma.lodging_reservation_rooms.findMany({
        where: {
          unit_id: { not: null },
          cancelled_at: null,
          reservation: { status: 'checked_in' },
        },
        select: { unit_id: true, departure_date: true },
      }),
    ]);

    const todayDb = dateOnlyToDb(today).getTime();
    const occupancy = new Map<number, HousekeepingOccupancy>();
    for (const stay of stays) {
      const departs = stay.departure_date.getTime() <= todayDb;
      // A room shared by two stays (a move today) shows the departure first.
      if (departs || !occupancy.has(stay.unit_id as number)) {
        occupancy.set(stay.unit_id as number, departs ? 'departs_today' : 'in_house');
      }
    }

    return {
      business_date: today,
      units: units.map((unit) => ({ ...unit, occupancy: occupancy.get(unit.id) ?? null })),
    };
  }

  async changeStatus(id: number, from: HousekeepingStatus, to: HousekeepingStatus) {
    const store_id = RequestContextService.getContext()?.store_id;
    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    this.assertMayChangeTo(to);
    const unit = await this.prisma.lodging_units.findFirst({
      where: { id },
      select: { id: true, code: true, housekeeping_status: true },
    });
    if (!unit) {
      throw new VendixHttpException(ErrorCodes.LODGING_UNIT_FIND_001);
    }
    if (unit.housekeeping_status !== from) {
      throw new VendixHttpException(
        ErrorCodes.LODGING_HOUSEKEEPING_STALE_001,
        `La ${unit.code} ya está ${HOUSEKEEPING_STATUS_LABELS[unit.housekeeping_status].toLowerCase()}. Actualiza el tablero.`,
      );
    }
    if (!canChangeHousekeeping(from, to)) {
      throw new VendixHttpException(
        ErrorCodes.LODGING_HOUSEKEEPING_TRANSITION_001,
        `La ${unit.code} no puede pasar de ${HOUSEKEEPING_STATUS_LABELS[from].toLowerCase()} a ${HOUSEKEEPING_STATUS_LABELS[to].toLowerCase()}`,
      );
    }

    const leavesSale = isSellableHousekeeping(from) && !isSellableHousekeeping(to);
    const { count } = leavesSale
      ? await this.takeOutOfSale(store_id, id, from, to)
      : await this.prisma.lodging_units.updateMany({
          where: { id, housekeeping_status: from },
          data: { housekeeping_status: to, updated_at: new Date() },
        });
    if (count === 0) {
      throw new VendixHttpException(
        ErrorCodes.LODGING_HOUSEKEEPING_STALE_001,
        `El estado de la ${unit.code} cambió. Actualiza el tablero.`,
      );
    }
    return { id: unit.id, code: unit.code, housekeeping_status: to };
  }

  /**
   * H5.1/H5.3 — a room leaving the sale from the board follows the same
   * rules as a dated block, under the store's sale lock: no reservation
   * assigned from today on, and the type's sold nights must still fit.
   */
  private async takeOutOfSale(
    store_id: number,
    id: number,
    from: HousekeepingStatus,
    to: HousekeepingStatus,
  ): Promise<{ count: number }> {
    const timezone = await resolveStoreTimezone(this.prisma, store_id);
    const today = localDateString(new Date(), timezone);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`lodging_reservations:${store_id}`}))`;
      // Inside `$transaction` the client is not store-scoped: name the store.
      const unit = await tx.lodging_units.findFirst({
        where: { id, store_id },
        select: {
          id: true,
          code: true,
          unit_type_id: true,
          is_active: true,
          housekeeping_status: true,
          unit_type: { select: { name: true, overbooking_allowance: true } },
        },
      });
      if (!unit || unit.housekeeping_status !== from) return { count: 0 };
      await assertUnitCanLeaveSale(
        tx,
        this.availability,
        store_id,
        unit,
        { from: today },
        { verb: 'sacarla de la venta', noun: 'Sacar de la venta' },
      );
      return tx.lodging_units.updateMany({
        where: { id, store_id, housekeeping_status: from },
        data: { housekeeping_status: to, updated_at: new Date() },
      });
    }, LEAVE_SALE_TX_OPTIONS);
  }

  private assertMayChangeTo(to: HousekeepingStatus): void {
    const required = HOUSEKEEPING_STATUS_PERMISSIONS[to];
    const context = RequestContextService.getContext();
    if (!required || context?.is_owner || context?.is_super_admin) return;
    const granted = context?.permissions ?? [];
    if (!required.some((permission) => granted.includes(permission))) {
      throw new VendixHttpException(
        ErrorCodes.AUTH_PERM_001,
        `No tienes permiso para dejar una habitación ${HOUSEKEEPING_STATUS_LABELS[to].toLowerCase()}`,
      );
    }
  }
}
