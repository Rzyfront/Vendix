import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from 'src/common/errors';
import { LodgingGuestsService } from './guests.service';
import { LodgingGuestDto } from './guest.dto';

const HOLDER: LodgingGuestDto = {
  document_type: 'CC',
  document_number: '1020304050',
  first_name: 'Ana',
  last_name: 'Pérez',
  residence_city: 'Bogotá',
  origin_city: 'Medellín',
  travel_purpose: 'vacation',
  data_consent: true,
};

const COMPANION: LodgingGuestDto = {
  document_type: 'PA',
  document_number: 'X1234567',
  first_name: 'John',
  last_name: 'Smith',
  nationality_country_code: 'US',
  birth_date: '1990-05-01',
  residence_city: 'Miami',
  origin_city: 'Miami',
  travel_purpose: 'vacation',
  is_non_resident: true,
  data_consent: true,
};

/** H3.1 — reservation H-0001 with `rooms` (101 and, optionally, 102). */
function build(options: { status?: string; rooms?: { id: number; cancelled_at: Date | null }[]; guests?: number } = {}) {
  const tx = {
    lodging_guests: {
      updateMany: jest.fn(async () => ({ count: 1 })),
      create: jest.fn(async ({ data }: any) => ({ id: 7, ...data })),
      update: jest.fn(async ({ where, data }: any) => ({ id: where.id, reservation_id: 1, ...data })),
    },
  };
  const prisma = {
    lodging_reservations: {
      findFirst: jest.fn(async ({ where }: any) =>
        where.id === 1
          ? {
              id: 1,
              status: options.status ?? 'confirmed',
              rooms: options.rooms ?? [{ id: 11, cancelled_at: null }],
            }
          : null,
      ),
    },
    lodging_guests: {
      count: jest.fn(async () => options.guests ?? 0),
      findMany: jest.fn(async () => []),
      findFirst: jest.fn(async ({ where }: any) =>
        where.id === 7 ? { id: 7, is_primary: false } : null,
      ),
      delete: jest.fn(async () => ({ id: 7 })),
    },
    users: {
      findFirst: jest.fn(async ({ where }: any) => (where.id === 90 ? { id: 90 } : null)),
    },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  const events = { emit: jest.fn() };
  const service = new LodgingGuestsService(prisma as any, events as any);
  return { service, prisma, tx, events };
}

async function errorOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as VendixHttpException;
  }
  throw new Error('expected an error');
}

describe('LodgingGuestsService (H3.1)', () => {
  beforeEach(() => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({ store_id: 5 } as any);
  });

  afterEach(() => jest.restoreAllMocks());

  it('registers the first guest as holder in the only room, with CO nationality and consent', async () => {
    const { service, tx } = build();
    const guest = await service.create(1, HOLDER);
    const data = tx.lodging_guests.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      store_id: 5,
      reservation_id: 1,
      reservation_room_id: 11,
      is_primary: true,
      nationality_country_code: 'CO',
    });
    expect(data.data_consent_at).toBeInstanceOf(Date);
    expect(tx.lodging_guests.updateMany).toHaveBeenCalled();
    expect(guest.reports_sire).toBe(false);
    expect(guest.travel_purpose_label).toBe('Vacaciones, recreo y ocio');
  });

  it('announces the arrival of a companion added with the stay in house, never before check-in', async () => {
    const inHouse = build({ status: 'checked_in', guests: 1 });
    await inHouse.service.create(1, COMPANION);
    expect(inHouse.events.emit).toHaveBeenCalledWith('lodging.reservation.checked_in', {
      store_id: 5,
      reservation_id: 1,
    });

    const confirmed = build({ guests: 1 });
    await confirmed.service.create(1, COMPANION);
    expect(confirmed.events.emit).not.toHaveBeenCalled();
  });

  it('adds a US passport companion flagged "Reporta SIRE"', async () => {
    const { service, tx } = build({ guests: 1 });
    const guest = await service.create(1, COMPANION);
    expect(tx.lodging_guests.create.mock.calls[0][0].data).toMatchObject({
      is_primary: false,
      nationality_country_code: 'US',
      is_non_resident: true,
    });
    expect(guest.birth_date).toBe('1990-05-01');
    expect(guest.reports_sire).toBe(true);
    expect(tx.lodging_guests.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a passport without nationality and saves nothing', async () => {
    const { service, tx } = build();
    const error = await errorOf(
      service.create(1, { ...COMPANION, nationality_country_code: undefined }),
    );
    expect(error.getStatus()).toBe(400);
    expect((error.getResponse() as any).message).toBe('El pasaporte exige nacionalidad');
    expect(tx.lodging_guests.create).not.toHaveBeenCalled();
  });

  it('says "Falta ciudad de residencia" when the TRA field is missing', async () => {
    const { service } = build();
    const error = await errorOf(service.create(1, { ...HOLDER, residence_city: '' }));
    expect((error.getResponse() as any).message).toBe('Falta ciudad de residencia');
    expect((error.getResponse() as any).details).toEqual({
      missing: ['Falta ciudad de residencia'],
    });
  });

  it('asks for the room when the reservation has several active rooms', async () => {
    const rooms = [
      { id: 11, cancelled_at: null },
      { id: 12, cancelled_at: null },
      { id: 13, cancelled_at: new Date() },
    ];
    const { service, tx } = build({ rooms });
    await expect(service.create(1, HOLDER)).rejects.toMatchObject({
      errorCode: 'LODGING_GUEST_ROOM_001',
    });
    await expect(service.create(1, { ...HOLDER, reservation_room_id: 13 })).rejects.toMatchObject({
      errorCode: 'LODGING_GUEST_ROOM_001',
    });
    await service.create(1, { ...HOLDER, reservation_room_id: 12 });
    expect(tx.lodging_guests.create.mock.calls[0][0].data.reservation_room_id).toBe(12);
  });

  it('only registers guests of active or in-house reservations', async () => {
    const { service } = build({ status: 'cancelled' });
    await expect(service.create(1, HOLDER)).rejects.toMatchObject({
      errorCode: 'LODGING_GUEST_STATUS_001',
    });
  });

  it('rejects a reservation or customer of another store', async () => {
    const { service } = build();
    await expect(service.create(2, HOLDER)).rejects.toMatchObject({
      errorCode: 'LODGING_RESERVATION_FIND_001',
    });
    await expect(service.create(1, { ...HOLDER, customer_id: 91 })).rejects.toMatchObject({
      errorCode: 'LODGING_GUEST_CUSTOMER_001',
    });
  });

  it('turns a repeated document into a readable conflict', async () => {
    const { service, tx } = build();
    tx.lodging_guests.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
    );
    await expect(service.create(1, HOLDER)).rejects.toMatchObject({
      errorCode: 'LODGING_GUEST_DUP_001',
    });
  });

  it('makes an edited guest the holder and clears the previous one', async () => {
    const { service, tx } = build({ guests: 2 });
    await service.update(1, 7, { ...COMPANION, is_primary: true });
    expect(tx.lodging_guests.updateMany).toHaveBeenCalledWith({
      where: { reservation_id: 1, is_primary: true, id: { not: 7 } },
      data: { is_primary: false },
    });
    expect(tx.lodging_guests.update.mock.calls[0][0].data.is_primary).toBe(true);
  });

  it('removes a guest of the reservation only', async () => {
    const { service, prisma } = build();
    await expect(service.remove(1, 8)).rejects.toMatchObject({
      errorCode: 'LODGING_GUEST_FIND_001',
    });
    await service.remove(1, 7);
    expect(prisma.lodging_guests.delete).toHaveBeenCalledWith({ where: { id: 7 } });
  });
});
