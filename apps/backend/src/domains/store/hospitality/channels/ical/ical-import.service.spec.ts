import { LodgingIcalImportService } from './ical-import.service';
import { fetchIcalFeed, IcalFetchError } from './ical-fetch';

jest.mock('./ical-fetch', () => ({
  ...jest.requireActual('./ical-fetch'),
  fetchIcalFeed: jest.fn(),
}));

const NOW = new Date('2026-11-02T12:00:00.000Z');
const d = (date: string) => new Date(`${date}T00:00:00.000Z`);
const ROW = { id: 3, store_id: 9, unit_id: 5, name: 'Airbnb', url: 'https://www.airbnb.com/1.ics' };

const feed = (...events: [string, string, string][]) =>
  [
    'BEGIN:VCALENDAR',
    ...events.map(
      ([uid, from, to]) =>
        `BEGIN:VEVENT\r\nUID:${uid}\r\nDTSTART;VALUE=DATE:${from.replace(/-/g, '')}\r\nDTEND;VALUE=DATE:${to.replace(/-/g, '')}\r\nEND:VEVENT`,
    ),
    'END:VCALENDAR',
  ].join('\r\n');

function build(opts: { blocks?: unknown[]; nights?: unknown[]; active?: boolean } = {}) {
  const tx = {
    $executeRaw: jest.fn(),
    lodging_ical_imports: {
      findFirst: jest.fn(async () => (opts.active === false ? null : { id: ROW.id })),
      updateMany: jest.fn(),
    },
    lodging_inventory_blocks: {
      findMany: jest.fn(async () => opts.blocks ?? []),
      updateMany: jest.fn(),
      createMany: jest.fn(),
    },
    lodging_room_nights: { findMany: jest.fn(async () => opts.nights ?? []) },
  };
  const prisma = {
    $transaction: jest.fn(async (cb: (client: typeof tx) => unknown) => cb(tx)),
    lodging_ical_imports: { updateMany: jest.fn() },
  };
  return { service: new LodgingIcalImportService(prisma as any), prisma, tx };
}

describe('LodgingIcalImportService.sync (H6.2)', () => {
  beforeEach(() => jest.mocked(fetchIcalFeed).mockReset());

  it('creates "Airbnb" blocks for new events, moves changed ones and releases cancelled ones', async () => {
    jest
      .mocked(fetchIcalFeed)
      .mockResolvedValue(feed(['new', '2026-11-10', '2026-11-13'], ['moved', '2026-11-20', '2026-11-23']));
    const { service, prisma, tx } = build({
      blocks: [
        { id: 11, external_uid: 'moved', from_date: d('2026-11-20'), to_date: d('2026-11-22') },
        { id: 12, external_uid: 'gone', from_date: d('2026-11-15'), to_date: d('2026-11-16') },
      ],
    });

    await service.sync(ROW, NOW);

    expect(tx.$executeRaw).toHaveBeenCalled();
    expect(tx.lodging_inventory_blocks.updateMany).toHaveBeenCalledWith({
      where: { store_id: 9, id: { in: [12] }, released_at: null },
      data: { released_at: NOW, released_by_user_id: null, updated_at: NOW },
    });
    expect(tx.lodging_inventory_blocks.updateMany).toHaveBeenCalledWith({
      where: { store_id: 9, id: 11 },
      data: { from_date: d('2026-11-20'), to_date: d('2026-11-23'), updated_at: NOW },
    });
    expect(tx.lodging_inventory_blocks.createMany).toHaveBeenCalledWith({
      data: [
        {
          store_id: 9,
          unit_id: 5,
          from_date: d('2026-11-10'),
          to_date: d('2026-11-13'),
          reason: 'ical',
          notes: 'Airbnb',
          ical_import_id: 3,
          external_uid: 'new',
          created_by_user_id: null,
          updated_at: NOW,
        },
      ],
    });
    expect(prisma.lodging_ical_imports.updateMany).toHaveBeenCalledWith({
      where: { id: 3, store_id: 9 },
      data: {
        last_synced_at: NOW,
        last_sync_status: 'ok',
        last_sync_message: '2 reservas próximas bloqueadas',
        last_sync_events: 2,
        updated_at: NOW,
      },
    });
  });

  it('warns of a possible double sale when a Vendix reservation has the same nights', async () => {
    jest.mocked(fetchIcalFeed).mockResolvedValue(feed(['a', '2026-11-10', '2026-11-12']));
    const { service, prisma } = build({
      nights: [
        { night_date: d('2026-11-11'), reservation_room: { reservation: { reservation_number: 'RES-0007' } } },
        { night_date: d('2026-11-12'), reservation_room: { reservation: { reservation_number: 'RES-0007' } } },
      ],
    });

    await service.sync(ROW, NOW);

    const { data } = prisma.lodging_ical_imports.updateMany.mock.calls[0][0];
    expect(data.last_sync_status).toBe('warning');
    expect(data.last_sync_message).toBe(
      'Posible doble venta: Airbnb tiene ocupada la noche del 11-nov y en Vendix está la reserva RES-0007. Muévela a otra habitación.',
    );
  });

  it('a feed that cannot be read changes no block and records the error', async () => {
    jest.mocked(fetchIcalFeed).mockRejectedValue(new IcalFetchError('El canal respondió 404: revisa la URL'));
    const { service, prisma } = build();

    await service.sync(ROW, NOW);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.lodging_ical_imports.updateMany).toHaveBeenCalledWith({
      where: { id: 3, store_id: 9 },
      data: {
        last_synced_at: NOW,
        last_sync_status: 'error',
        last_sync_message: 'El canal respondió 404: revisa la URL',
        updated_at: NOW,
      },
    });
  });

  it('does nothing when the import was removed while the feed downloaded', async () => {
    jest.mocked(fetchIcalFeed).mockResolvedValue(feed(['a', '2026-11-10', '2026-11-12']));
    const { service, prisma, tx } = build({ active: false });

    await service.sync(ROW, NOW);

    expect(tx.lodging_inventory_blocks.createMany).not.toHaveBeenCalled();
    expect(prisma.lodging_ical_imports.updateMany).not.toHaveBeenCalled();
  });
});
