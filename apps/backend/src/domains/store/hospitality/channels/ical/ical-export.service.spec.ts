import { VendixHttpException } from 'src/common/errors';
import { LodgingIcalExportService } from './ical-export.service';

const TOKEN = 'a'.repeat(32);
const NOW = new Date('2026-11-01T12:00:00.000Z');
const d = (date: string) => new Date(`${date}T00:00:00.000Z`);

function build() {
  const prisma = {
    lodging_units: {
      findMany: jest.fn(async () => []),
      findFirst: jest.fn(async () => ({ id: 5 })),
      update: jest.fn(async ({ data }: any) => ({ id: 5, code: '101', ...data })),
    },
  };
  const globalPrisma = {
    lodging_units: {
      findUnique: jest.fn(async () => ({
        id: 5,
        store_id: 9,
        code: '101',
        unit_type: { name: 'Doble' },
      })),
    },
    lodging_room_nights: {
      findMany: jest.fn(async () => [
        { night_date: d('2026-11-10') },
        { night_date: d('2026-11-11') },
      ]),
    },
    lodging_inventory_blocks: {
      findMany: jest.fn(async () => [
        // started before the window: only the nights still to come are sent
        { from_date: d('2026-10-20'), to_date: d('2026-11-02') },
        // touches the reservation: one merged event
        { from_date: d('2026-11-12'), to_date: d('2026-11-13') },
      ]),
    },
  };
  const service = new LodgingIcalExportService(prisma as any, globalPrisma as any);
  return { service, prisma, globalPrisma };
}

describe('LodgingIcalExportService (H6.1)', () => {
  it('renders the room nights and active blocks as busy dates', async () => {
    const { service, globalPrisma } = build();
    const feed = await service.renderFeed(TOKEN, NOW);

    expect(globalPrisma.lodging_units.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ical_export_token: TOKEN } }),
    );
    expect(feed).toContain('X-WR-CALNAME:Habitación 101 · Doble');
    expect(feed).toContain('DTSTART;VALUE=DATE:20261031\r\nDTEND;VALUE=DATE:20261102');
    expect(feed).toContain('DTSTART;VALUE=DATE:20261110\r\nDTEND;VALUE=DATE:20261113');
    expect(feed.match(/BEGIN:VEVENT/g)).toHaveLength(2);
  });

  it('reads only this room of its store, active nights and non-iCal blocks', async () => {
    const { service, globalPrisma } = build();
    await service.renderFeed(TOKEN, NOW);

    expect(globalPrisma.lodging_room_nights.findMany).toHaveBeenCalledWith({
      where: {
        store_id: 9,
        unit_id: 5,
        is_active: true,
        night_date: { gte: d('2026-10-31') },
      },
      select: { night_date: true },
    });
    expect(globalPrisma.lodging_inventory_blocks.findMany).toHaveBeenCalledWith({
      where: {
        store_id: 9,
        unit_id: 5,
        released_at: null,
        reason: { not: 'ical' },
        to_date: { gt: d('2026-10-31') },
      },
      select: { from_date: true, to_date: true },
    });
  });

  it('carries no guest or reservation data', async () => {
    const { service } = build();
    const feed = await service.renderFeed(TOKEN, NOW);
    const summaries = feed.split('\r\n').filter((l) => l.startsWith('SUMMARY:'));
    expect(new Set(summaries)).toEqual(new Set(['SUMMARY:No disponible']));
    expect(feed).not.toMatch(/DESCRIPTION|ATTENDEE|ORGANIZER/);
  });

  it('answers LODGING_ICAL_FEED_001 for an unknown or revoked token', async () => {
    const { service, globalPrisma } = build();
    globalPrisma.lodging_units.findUnique.mockResolvedValueOnce(null as any);
    await expect(service.renderFeed(TOKEN, NOW)).rejects.toMatchObject({
      errorCode: 'LODGING_ICAL_FEED_001',
    });
  });

  it('rejects a malformed token without querying', async () => {
    const { service, globalPrisma } = build();
    await expect(service.renderFeed('../../etc', NOW)).rejects.toBeInstanceOf(
      VendixHttpException,
    );
    expect(globalPrisma.lodging_units.findUnique).not.toHaveBeenCalled();
  });

  it('rotate issues a new 32-char token; revoke clears it', async () => {
    const { service, prisma } = build();
    const first = await service.rotate(5);
    const second = await service.rotate(5);
    expect(first.ical_export_token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(second.ical_export_token).not.toBe(first.ical_export_token);

    const revoked = await service.revoke(5);
    expect(revoked.ical_export_token).toBeNull();
    expect(prisma.lodging_units.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { id: 5 }, data: expect.objectContaining({ ical_export_token: null }) }),
    );
  });

  it('rotate refuses a room of another store (not found in the scoped client)', async () => {
    const { service, prisma } = build();
    prisma.lodging_units.findFirst.mockResolvedValueOnce(null as any);
    await expect(service.rotate(99)).rejects.toMatchObject({
      errorCode: 'LODGING_UNIT_FIND_001',
    });
    expect(prisma.lodging_units.update).not.toHaveBeenCalled();
  });
});
