import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from 'src/common/errors';
import { LodgingKeyHandoversService } from './key-handovers.service';

const ROW = {
  id: 30,
  reservation_id: 1,
  reservation_room_id: 11,
  key_label: '101-A',
  guest_name: 'Ana Pérez',
  notes: null,
  delivered_at: new Date('2026-11-10T19:05:00.000Z'),
  returned_at: null as Date | null,
  reservation_room: { unit: { code: '101' } },
  delivered_by: { first_name: 'Laura', last_name: 'Gómez' },
  returned_by: null as { first_name: string; last_name: string } | null,
};

/** H8.4 — reservation H-0001 in house with `rooms` (11 and, optionally, 12). */
function build(
  options: {
    status?: string;
    rooms?: { id: number; cancelled_at: Date | null }[];
    openKey?: boolean;
    current?: { id: number; returned_at: Date | null } | null;
    updated?: number;
  } = {},
) {
  const prisma = {
    lodging_reservations: {
      findFirst: jest.fn(async ({ where }: any) =>
        where.id === 1
          ? {
              id: 1,
              status: options.status ?? 'checked_in',
              rooms: options.rooms ?? [{ id: 11, cancelled_at: null }],
            }
          : null,
      ),
    },
    lodging_key_handovers: {
      findMany: jest.fn(async () => [ROW]),
      findFirst: jest.fn(async ({ where }: any) => {
        if (where.returned_at === null && where.key_label) {
          return options.openKey
            ? {
                key_label: '101-A',
                guest_name: 'Carlos Ruiz',
                reservation: { reservation_number: 'H-0009' },
              }
            : null;
        }
        if (where.reservation_id !== undefined) {
          return options.current === undefined ? { id: 30, returned_at: null } : options.current;
        }
        return {
          ...ROW,
          returned_at: new Date('2026-11-12T15:00:00.000Z'),
          returned_by: { first_name: 'Pedro', last_name: 'Díaz' },
        };
      }),
      create: jest.fn(async ({ data }: any) => ({ ...ROW, ...data })),
      updateMany: jest.fn(async () => ({ count: options.updated ?? 1 })),
    },
  };
  const service = new LodgingKeyHandoversService(prisma as any);
  return { service, prisma };
}

async function errorOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as VendixHttpException;
  }
  throw new Error('expected an error');
}

const codeOf = (error: VendixHttpException) => error.errorCode;

describe('LodgingKeyHandoversService (H8.4, D12)', () => {
  beforeEach(() => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 5, user_id: 42 } as any);
  });

  afterEach(() => jest.restoreAllMocks());

  it('records which key, to which guest, by which staff user, in the only room', async () => {
    const { service, prisma } = build();
    const key = await service.deliver(1, { key_label: '101-A', guest_name: 'Ana Pérez' });

    expect(prisma.lodging_key_handovers.create.mock.calls[0][0].data).toEqual({
      store_id: 5,
      reservation_id: 1,
      reservation_room_id: 11,
      key_label: '101-A',
      guest_name: 'Ana Pérez',
      notes: null,
      delivered_by_user_id: 42,
    });
    expect(key).toMatchObject({
      key_label: '101-A',
      guest_name: 'Ana Pérez',
      room_code: '101',
      delivered_by_name: 'Laura Gómez',
      returned_at: null,
      returned_by_name: null,
    });
  });

  it('only hands keys to a reservation in house', async () => {
    const { service, prisma } = build({ status: 'confirmed' });
    const error = await errorOf(service.deliver(1, { key_label: '101-A', guest_name: 'Ana' }));

    expect(codeOf(error)).toBe('LODGING_KEY_STATUS_001');
    expect(prisma.lodging_key_handovers.create).not.toHaveBeenCalled();
  });

  it('refuses a key another guest still has and says who has it', async () => {
    const { service, prisma } = build({ openKey: true });
    const error = await errorOf(service.deliver(1, { key_label: '101-a', guest_name: 'Ana' }));

    expect(codeOf(error)).toBe('LODGING_KEY_DUP_001');
    expect(error.message).toContain('Carlos Ruiz');
    expect(error.message).toContain('H-0009');
    expect(error.message).toContain('La llave 101-A');
    expect(prisma.lodging_key_handovers.create).not.toHaveBeenCalled();
  });

  it('maps a concurrent duplicate on the open-key index to the desk message', async () => {
    const { service, prisma } = build();
    prisma.lodging_key_handovers.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
    );
    const error = await errorOf(service.deliver(1, { key_label: '101-A', guest_name: 'Ana' }));

    expect(codeOf(error)).toBe('LODGING_KEY_DUP_001');
  });

  it('leaves the room empty with several rooms and rejects a room of another reservation', async () => {
    const rooms = [
      { id: 11, cancelled_at: null },
      { id: 12, cancelled_at: null },
    ];
    const { service, prisma } = build({ rooms });
    await service.deliver(1, { key_label: 'Tarjeta 7', guest_name: 'Ana' });
    expect(prisma.lodging_key_handovers.create.mock.calls[0][0].data.reservation_room_id).toBeNull();

    const error = await errorOf(
      service.deliver(1, { key_label: 'Tarjeta 8', guest_name: 'Ana', reservation_room_id: 99 }),
    );
    expect(codeOf(error)).toBe('LODGING_KEY_ROOM_001');
  });

  it('records the return with who received it and when', async () => {
    const { service, prisma } = build();
    const key = await service.returnKey(1, 30);

    const update = (prisma.lodging_key_handovers.updateMany.mock.calls as any)[0][0];
    expect(update.where).toEqual({ id: 30, returned_at: null });
    expect(update.data.returned_by_user_id).toBe(42);
    expect(update.data.returned_at).toBeInstanceOf(Date);
    expect(key).toMatchObject({ returned_by_name: 'Pedro Díaz' });
    expect(key.returned_at).toBeInstanceOf(Date);
  });

  it('never returns a key twice nor one of another reservation', async () => {
    const returned = build({ current: { id: 30, returned_at: new Date() } });
    expect(codeOf(await errorOf(returned.service.returnKey(1, 30)))).toBe('LODGING_KEY_RETURNED_001');
    expect(returned.prisma.lodging_key_handovers.updateMany).not.toHaveBeenCalled();

    const raced = build({ updated: 0 });
    expect(codeOf(await errorOf(raced.service.returnKey(1, 30)))).toBe('LODGING_KEY_RETURNED_001');

    const missing = build({ current: null });
    expect(codeOf(await errorOf(missing.service.returnKey(1, 31)))).toBe('LODGING_KEY_FIND_001');
  });

  it('lists the keys of the reservation, newest first', async () => {
    const { service, prisma } = build();
    const keys = await service.findAll(1);

    expect((prisma.lodging_key_handovers.findMany.mock.calls as any)[0][0]).toMatchObject({
      where: { reservation_id: 1 },
      orderBy: [{ delivered_at: 'desc' }, { id: 'desc' }],
    });
    expect(keys[0]).toMatchObject({ room_code: '101', delivered_by_name: 'Laura Gómez' });
    expect(codeOf(await errorOf(service.findAll(2)))).toBe('LODGING_RESERVATION_FIND_001');
  });
});
