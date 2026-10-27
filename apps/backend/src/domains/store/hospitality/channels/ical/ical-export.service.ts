import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { GlobalPrismaService } from '../../../../../prisma/services/global-prisma.service';
import { UNSELLABLE_HOUSEKEEPING_STATUSES } from '../../housekeeping/housekeeping-status';
import { buildIcalFeed, nightsOfRange } from './ical-feed';
import { allocateUnassignedNights } from './ical-occupancy';

/** Shape of a feed token: 32 url-safe chars (24 random bytes). */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/;

const DAY_MS = 86_400_000;

const toDateOnly = (date: Date) => date.toISOString().slice(0, 10);

/** Text of every exported event: dates only, never guest data. */
export const ICAL_EVENT_SUMMARY = 'No disponible';

/**
 * Hospitality Suite (H6.1) — per-room iCal export.
 *
 * Each room may publish one feed whose URL carries a secret token. The
 * manager creates it, copies it into Airbnb/Booking and can rotate or revoke
 * it, which kills the URL already pasted. The feed lists the nights the room
 * cannot be sold: assigned reservation nights, active blocks and the nights
 * an unassigned reservation of its type needs this room (see
 * `allocateUnassignedNights`; every sale is born without a room). Blocks that
 * came from an iCal import (`reason=ical`, H6.2) are left out so a channel
 * does not receive its own dates back.
 */
@Injectable()
export class LodgingIcalExportService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly globalPrisma: GlobalPrismaService,
  ) {}

  /** Rooms of the store with their feed token (null = not published). */
  async list() {
    return this.prisma.lodging_units.findMany({
      select: {
        id: true,
        code: true,
        floor: true,
        is_active: true,
        ical_export_token: true,
        unit_type: { select: { id: true, name: true } },
      },
      orderBy: [{ code: 'asc' }],
    });
  }

  /** Creates the feed, or replaces its token (the previous URL stops working). */
  async rotate(unit_id: number) {
    await this.assertUnit(unit_id);
    return this.prisma.lodging_units.update({
      where: { id: unit_id },
      data: { ical_export_token: randomBytes(24).toString('base64url'), updated_at: new Date() },
      select: { id: true, code: true, ical_export_token: true },
    });
  }

  /** Stops publishing the feed: the pasted URL answers 404. */
  async revoke(unit_id: number) {
    await this.assertUnit(unit_id);
    return this.prisma.lodging_units.update({
      where: { id: unit_id },
      data: { ical_export_token: null, updated_at: new Date() },
      select: { id: true, code: true, ical_export_token: true },
    });
  }

  /**
   * Public feed by token (no session, no store context). Nights from
   * yesterday on: the importer only needs the dates still to come.
   */
  async renderFeed(token: string, now = new Date()): Promise<string> {
    if (!TOKEN_PATTERN.test(token)) {
      throw new VendixHttpException(ErrorCodes.LODGING_ICAL_FEED_001);
    }
    const unit = await this.globalPrisma.lodging_units.findUnique({
      where: { ical_export_token: token },
      select: {
        id: true,
        store_id: true,
        code: true,
        unit_type_id: true,
        unit_type: { select: { name: true } },
      },
    });
    if (!unit) {
      throw new VendixHttpException(ErrorCodes.LODGING_ICAL_FEED_001);
    }

    const from = toDateOnly(new Date(now.getTime() - DAY_MS));
    const fromDb = new Date(`${from}T00:00:00.000Z`);
    // The whole room type: unassigned nights take a free room of the type.
    const [units, nights, blocks] = await Promise.all([
      this.globalPrisma.lodging_units.findMany({
        where: {
          store_id: unit.store_id,
          unit_type_id: unit.unit_type_id,
          is_active: true,
          housekeeping_status: { notIn: [...UNSELLABLE_HOUSEKEEPING_STATUSES] },
        },
        select: { id: true },
        orderBy: [{ code: 'asc' }, { id: 'asc' }],
      }),
      this.globalPrisma.lodging_room_nights.findMany({
        where: {
          store_id: unit.store_id,
          unit_type_id: unit.unit_type_id,
          is_active: true,
          night_date: { gte: fromDb },
        },
        select: { night_date: true, unit_id: true },
      }),
      this.globalPrisma.lodging_inventory_blocks.findMany({
        where: {
          store_id: unit.store_id,
          released_at: null,
          to_date: { gt: fromDb },
          unit: { unit_type_id: unit.unit_type_id },
        },
        select: { unit_id: true, from_date: true, to_date: true, reason: true },
      }),
    ]);

    const blockNights = blocks.flatMap((b) =>
      nightsOfRange(toDateOnly(b.from_date), toDateOnly(b.to_date), from).map(
        (night) => ({ night, unit_id: b.unit_id, reason: b.reason }),
      ),
    );
    const allocation = allocateUnassignedNights({
      unit_ids: units.map((u) => u.id),
      nights: nights.map((n) => ({ night: toDateOnly(n.night_date), unit_id: n.unit_id })),
      blocked: blockNights,
    });

    return buildIcalFeed({
      unit_id: unit.id,
      calendar_name: `Habitación ${unit.code} · ${unit.unit_type.name}`,
      summary: ICAL_EVENT_SUMMARY,
      now,
      nights: [
        ...nights.filter((n) => n.unit_id === unit.id).map((n) => toDateOnly(n.night_date)),
        ...blockNights
          .filter((b) => b.unit_id === unit.id && b.reason !== 'ical')
          .map((b) => b.night),
        ...[...allocation]
          .filter(([, occupancy]) => occupancy.taken.includes(unit.id))
          .map(([night]) => night),
      ],
    });
  }

  private async assertUnit(unit_id: number) {
    const unit = await this.prisma.lodging_units.findFirst({
      where: { id: unit_id },
      select: { id: true },
    });
    if (!unit) {
      throw new VendixHttpException(ErrorCodes.LODGING_UNIT_FIND_001);
    }
  }
}
