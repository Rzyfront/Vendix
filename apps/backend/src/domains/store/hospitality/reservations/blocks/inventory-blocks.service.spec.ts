import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors';
import { LodgingAvailabilityService } from '../lodging-availability.service';
import { LodgingInventoryBlocksService } from './inventory-blocks.service';
import { CreateInventoryBlockDto } from './inventory-block.dto';

const D = (date: string) => new Date(`${date}T00:00:00.000Z`);

/** Doble estándar (type 11): rooms 101 and 102, no overbooking. */
const UNITS = [
  { id: 1, code: '101', unit_type_id: 11, is_active: true, housekeeping_status: 'clean' },
  { id: 2, code: '102', unit_type_id: 11, is_active: true, housekeeping_status: 'clean' },
];

interface Night {
  unit_type_id: number;
  unit_id: number | null;
  night_date: string;
  reservation_number: string;
}

interface Block {
  id: number;
  unit_id: number;
  from_date: Date;
  to_date: Date;
  released_at: Date | null;
}

const inRange = (date: Date, range: { gte?: Date; lt?: Date; lte?: Date }) =>
  (!range.gte || date >= range.gte) &&
  (!range.lt || date < range.lt) &&
  (!range.lte || date <= range.lte);

/** `tx` and the scoped client are the same fake (store 1). */
function createFake(nights: Night[] = [], blocks: Block[] = []) {
  const unitById = (id: number) => UNITS.find((u) => u.id === id);
  const client: any = {
    $executeRaw: jest.fn(async () => 1),
    lodging_units: {
      findFirst: jest.fn(async ({ where }: any) => {
        const unit = unitById(where.id);
        return unit && where.store_id === 1
          ? { ...unit, unit_type: { name: 'Doble estándar', overbooking_allowance: 0 } }
          : null;
      }),
      count: jest.fn(
        async ({ where }: any) =>
          UNITS.filter(
            (u) =>
              u.unit_type_id === where.unit_type_id &&
              !where.housekeeping_status.notIn.includes(u.housekeeping_status),
          ).length,
      ),
    },
    lodging_unit_types: {
      findFirst: jest.fn(async () => ({ overbooking_allowance: 0 })),
    },
    lodging_room_nights: {
      findFirst: jest.fn(async ({ where }: any) => {
        const hit = nights.find(
          (n) => n.unit_id === where.unit_id && inRange(D(n.night_date), where.night_date),
        );
        return hit
          ? {
              night_date: D(hit.night_date),
              reservation_room: { reservation: { reservation_number: hit.reservation_number } },
            }
          : null;
      }),
      groupBy: jest.fn(async ({ where }: any) => {
        const counts = new Map<string, number>();
        for (const n of nights) {
          if (n.unit_type_id !== where.unit_type_id || !inRange(D(n.night_date), where.night_date)) {
            continue;
          }
          counts.set(n.night_date, (counts.get(n.night_date) ?? 0) + 1);
        }
        return [...counts].map(([night, count]) => ({
          night_date: D(night),
          _count: { _all: count },
        }));
      }),
    },
    lodging_allotments: { findMany: jest.fn(async () => []) },
    lodging_inventory_blocks: {
      findFirst: jest.fn(async ({ where }: any) => {
        if (where.id !== undefined) return blocks.find((b) => b.id === where.id) ?? null;
        return (
          blocks.find(
            (b) =>
              b.unit_id === where.unit_id &&
              b.released_at === null &&
              b.from_date < where.from_date.lt &&
              b.to_date > where.to_date.gt,
          ) ?? null
        );
      }),
      findMany: jest.fn(async ({ where }: any) =>
        blocks
          .filter(
            (b) =>
              b.released_at === null &&
              b.from_date <= where.from_date.lte &&
              b.to_date > where.to_date.gt &&
              where.unit.unit_type_id.in.includes(unitById(b.unit_id)!.unit_type_id),
          )
          .map((b) => ({ ...b, unit: { unit_type_id: unitById(b.unit_id)!.unit_type_id } })),
      ),
      create: jest.fn(async ({ data }: any) => ({ id: 99, ...data })),
      updateMany: jest.fn(async ({ where }: any) => {
        const block = blocks.find((b) => b.id === where.id && b.released_at === null);
        if (!block) return { count: 0 };
        block.released_at = new Date();
        return { count: 1 };
      }),
    },
  };
  client.$transaction = jest.fn(async (cb: (tx: any) => unknown) => cb(client));
  const availability = new LodgingAvailabilityService(client);
  return { service: new LodgingInventoryBlocksService(client, availability), availability, client };
}

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(VendixHttpException);
    return (error as VendixHttpException).getResponse() as { error_code: string; message: string };
  }
  throw new Error('expected a rejection');
}

const MAINTENANCE = { unit_id: 2, from_date: '2026-11-10', to_date: '2026-11-13', notes: 'Fuga en el baño' };

describe('LodgingInventoryBlocksService (H5.3)', () => {
  beforeEach(() => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 1, user_id: 7 } as any);
  });
  afterEach(() => jest.restoreAllMocks());

  describe('collision with reservations', () => {
    it('refuses a room with a reservation assigned on those nights, naming it and the night', async () => {
      const { service, client } = createFake([
        { unit_type_id: 11, unit_id: 2, night_date: '2026-11-12', reservation_number: 'H-0004' },
      ]);
      const error = await rejection(service.create(MAINTENANCE));
      expect(error.error_code).toBe('LODGING_BLOCK_RESERVED_001');
      expect(error.message).toBe(
        'La 102 tiene la reserva H-0004 el 12-nov. Muévela antes de bloquearla.',
      );
      expect(client.lodging_inventory_blocks.create).not.toHaveBeenCalled();
    });

    it('a stay leaving on the first blocked day (or arriving on the return day) does not collide', async () => {
      const { service, client } = createFake([
        { unit_type_id: 11, unit_id: 2, night_date: '2026-11-09', reservation_number: 'H-0001' },
        { unit_type_id: 11, unit_id: 2, night_date: '2026-11-13', reservation_number: 'H-0002' },
      ]);
      await expect(service.create(MAINTENANCE)).resolves.toMatchObject({ id: 99 });
      expect(client.lodging_inventory_blocks.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          store_id: 1,
          unit_id: 2,
          from_date: D('2026-11-10'),
          to_date: D('2026-11-13'),
          reason: 'maintenance',
          notes: 'Fuga en el baño',
          created_by_user_id: 7,
        }),
      });
    });

    it('refuses when the unassigned reservations of the type would be left without a room', async () => {
      // 101 is sold and 102 would be blocked while another Doble is unassigned.
      const { service, client } = createFake([
        { unit_type_id: 11, unit_id: 1, night_date: '2026-11-11', reservation_number: 'H-0001' },
        { unit_type_id: 11, unit_id: null, night_date: '2026-11-11', reservation_number: 'H-0002' },
      ]);
      const error = await rejection(service.create(MAINTENANCE));
      expect(error.error_code).toBe('LODGING_BLOCK_OVERSOLD_001');
      expect(error.message).toBe(
        'Bloquear la 102 deja sin habitación a reservas de Doble estándar el 11-nov. Asígnalas o muévelas antes.',
      );
      expect(client.lodging_inventory_blocks.create).not.toHaveBeenCalled();
    });

    it('refuses a second block overlapping an active one of the same room', async () => {
      const { service } = createFake([], [
        { id: 5, unit_id: 2, from_date: D('2026-11-12'), to_date: D('2026-11-15'), released_at: null },
      ]);
      const error = await rejection(service.create(MAINTENANCE));
      expect(error.error_code).toBe('LODGING_BLOCK_OVERLAP_001');
    });

    it('runs under the store sale lock', async () => {
      const { service, client } = createFake();
      await service.create(MAINTENANCE);
      expect(client.$executeRaw).toHaveBeenCalledTimes(1);
      expect(client.$executeRaw.mock.calls[0][1]).toBe('lodging_reservations:1');
    });
  });

  it('an active block lowers the availability of its type on its nights only', async () => {
    const blocks: Block[] = [
      { id: 5, unit_id: 2, from_date: D('2026-11-10'), to_date: D('2026-11-13'), released_at: null },
    ];
    const { availability } = createFake([], blocks);
    await expect(availability.countAvailable(11, '2026-11-11', '2026-11-12')).resolves.toBe(1);
    await expect(availability.countAvailable(11, '2026-11-13', '2026-11-15')).resolves.toBe(2);
    const inventory = await availability.getInventory(11, '2026-11-12', '2026-11-14');
    expect(inventory.blocked).toBe(1);
    expect(inventory.available).toBe(1);
  });

  it('releasing the block frees the room once; a second release is refused', async () => {
    const blocks: Block[] = [
      { id: 5, unit_id: 2, from_date: D('2026-11-10'), to_date: D('2026-11-13'), released_at: null },
    ];
    const { service, availability, client } = createFake([], blocks);
    await service.release(5);
    expect(client.lodging_inventory_blocks.updateMany).toHaveBeenCalledWith({
      where: { id: 5, released_at: null },
      data: expect.objectContaining({ released_by_user_id: 7 }),
    });
    await expect(availability.countAvailable(11, '2026-11-11', '2026-11-12')).resolves.toBe(2);

    const again = await rejection(service.release(5));
    expect(again.error_code).toBe('LODGING_BLOCK_RELEASED_001');
    const missing = await rejection(service.release(404));
    expect(missing.error_code).toBe('LODGING_BLOCK_FIND_001');
  });

  it('the DTO accepts only manual reasons (iCal blocks come from the import)', async () => {
    const dto = plainToInstance(CreateInventoryBlockDto, { ...MAINTENANCE, reason: 'ical' });
    expect((await validate(dto)).map((e) => e.property)).toEqual(['reason']);
    const ok = plainToInstance(CreateInventoryBlockDto, { ...MAINTENANCE, reason: 'owner_use' });
    expect(await validate(ok)).toEqual([]);
  });
});
