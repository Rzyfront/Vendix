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
        unit_type_id: 2,
        unit_type: { name: 'Doble' },
      })),
      findMany: jest.fn(async () => [{ id: 5 }]),
    },
    lodging_room_nights: {
      findMany: jest.fn(async (): Promise<{ night_date: Date; unit_id: number | null }[]> => [
        { night_date: d('2026-11-10'), unit_id: 5 },
        { night_date: d('2026-11-11'), unit_id: 5 },
        // another room of the type: not this feed
        { night_date: d('2026-11-15'), unit_id: 6 },
      ]),
    },
    lodging_inventory_blocks: {
      findMany: jest.fn(
        async (): Promise<{ unit_id: number; from_date: Date; to_date: Date; reason: string }[]> => [
          // started before the window: only the nights still to come are sent
          { unit_id: 5, from_date: d('2026-10-20'), to_date: d('2026-11-02'), reason: 'maintenance' },
          // touches the reservation: one merged event
          { unit_id: 5, from_date: d('2026-11-12'), to_date: d('2026-11-13'), reason: 'owner_use' },
          // the channel's own dates are not sent back
          { unit_id: 5, from_date: d('2026-11-20'), to_date: d('2026-11-22'), reason: 'ical' },
        ],
      ),
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

  it('reads the room type of its store: rooms, active nights and active blocks', async () => {
    const { service, globalPrisma } = build();
    await service.renderFeed(TOKEN, NOW);

    expect(globalPrisma.lodging_units.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ store_id: 9, unit_type_id: 2, is_active: true }),
        orderBy: [{ code: 'asc' }, { id: 'asc' }],
      }),
    );
    expect(globalPrisma.lodging_room_nights.findMany).toHaveBeenCalledWith({
      where: {
        store_id: 9,
        unit_type_id: 2,
        is_active: true,
        night_date: { gte: d('2026-10-31') },
      },
      select: { night_date: true, unit_id: true },
    });
    expect(globalPrisma.lodging_inventory_blocks.findMany).toHaveBeenCalledWith({
      where: {
        store_id: 9,
        released_at: null,
        to_date: { gt: d('2026-10-31') },
        unit: { unit_type_id: 2 },
      },
      select: { unit_id: true, from_date: true, to_date: true, reason: true },
    });
  });

  it('blocks the nights of a reservation without a room assigned (every sale is born unassigned)', async () => {
    const { service, globalPrisma } = build();
    globalPrisma.lodging_room_nights.findMany.mockResolvedValueOnce([
      { night_date: d('2026-11-25'), unit_id: null },
      { night_date: d('2026-11-26'), unit_id: null },
    ]);
    globalPrisma.lodging_inventory_blocks.findMany.mockResolvedValueOnce([]);

    const feed = await service.renderFeed(TOKEN, NOW);

    expect(feed).toContain('DTSTART;VALUE=DATE:20261125\r\nDTEND;VALUE=DATE:20261127');
    expect(feed.match(/BEGIN:VEVENT/g)).toHaveLength(1);
  });

  it('an unassigned night takes the first free room of the type, not one already busy', async () => {
    const { service, globalPrisma } = build();
    globalPrisma.lodging_units.findMany.mockResolvedValue([{ id: 5 }, { id: 6 }, { id: 7 }]);
    globalPrisma.lodging_room_nights.findMany.mockResolvedValue([
      { night_date: d('2026-11-25'), unit_id: 5 }, // 101 sold that night
      { night_date: d('2026-11-25'), unit_id: null }, // needs a free room: 102
    ]);
    globalPrisma.lodging_inventory_blocks.findMany.mockResolvedValue([]);
    const feedOf = async (id: number) => {
      globalPrisma.lodging_units.findUnique.mockResolvedValueOnce({
        id,
        store_id: 9,
        code: String(100 + id - 4),
        unit_type_id: 2,
        unit_type: { name: 'Doble' },
      });
      return service.renderFeed(TOKEN, NOW);
    };

    expect((await feedOf(5)).match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(await feedOf(6)).toContain('DTSTART;VALUE=DATE:20261125');
    expect(await feedOf(7)).not.toContain('BEGIN:VEVENT');
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
