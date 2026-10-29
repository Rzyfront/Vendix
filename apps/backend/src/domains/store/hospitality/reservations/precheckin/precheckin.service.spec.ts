import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from 'src/common/errors';
import { LodgingGuestsService } from '../guests/guests.service';
import { LodgingPrecheckinService } from './precheckin.service';
import { PrecheckinSubmitDto } from './precheckin.dto';
import { newPrecheckinToken, precheckinLinkOpen } from './precheckin-link';

const TOKEN = 'tok_abc';

const HOLDER = {
  document_type: 'CC' as const,
  document_number: '1020304050',
  first_name: 'Ana',
  last_name: 'Pérez',
  residence_city: 'Bogotá',
  origin_city: 'Medellín',
  travel_purpose: 'vacation',
};

const COMPANION = {
  document_type: 'PA' as const,
  document_number: 'X1234567',
  first_name: 'John',
  last_name: 'Smith',
  nationality_country_code: 'US',
  birth_date: '1990-05-01',
  residence_city: 'Miami',
  origin_city: 'Miami',
  travel_purpose: 'vacation',
};

/** Reservation H-0007 of store 5, departure `departure` (store today 2026-11-10). */
function build(
  options: {
    status?: string;
    departure?: string;
    token?: string | null;
    domain?: string | null;
    existing?: { id: number; document_number: string }[];
    holder?: boolean;
  } = {},
) {
  const reservation = {
    id: 1,
    status: options.status ?? 'confirmed',
    reservation_number: 'H-0007',
    arrival_date: new Date('2026-11-12T00:00:00.000Z'),
    departure_date: new Date(`${options.departure ?? '2026-11-14'}T00:00:00.000Z`),
    customer_id: 90,
    precheckin_token: options.token === undefined ? TOKEN : options.token,
    precheckin_completed_at: null,
    rooms: [
      {
        id: 11,
        adults: 2,
        children: 1,
        cancelled_at: null,
        unit_type: { name: 'Doble' },
      },
    ],
  };
  const tx = {
    lodging_guests: {
      count: jest.fn(async () => (options.holder ? 1 : 0)),
      findFirst: jest.fn(async ({ where }: any) => {
        const match = (options.existing ?? []).find(
          (row) => row.document_number.toLowerCase() === where.document_number.equals.toLowerCase(),
        );
        return match ? { id: match.id } : null;
      }),
      create: jest.fn(async ({ data }: any) => ({ id: 70, ...data })),
      update: jest.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
    },
  };
  const prisma = {
    lodging_reservations: {
      findFirst: jest.fn(async ({ where }: any) => {
        if (where.id === 1) return reservation;
        if (where.precheckin_token && where.precheckin_token === reservation.precheckin_token) {
          return reservation;
        }
        return null;
      }),
      update: jest.fn(async ({ data }: any) => ({ ...reservation, ...data })),
    },
    lodging_guests: {
      findMany: jest.fn(async () => [{ first_name: 'Ana', last_name: 'Pérez', is_primary: true }]),
    },
    domain_settings: {
      findFirst: jest.fn(async () =>
        options.domain === null ? null : { hostname: options.domain ?? 'roku.vendix.com' },
      ),
    },
    stores: { findFirst: jest.fn(async () => ({ name: 'Hotel Roku' })) },
    store_settings: {
      findFirst: jest.fn(async () => ({
        settings: {},
        stores: { timezone: 'America/Bogota' },
      })),
    },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  const guests = new LodgingGuestsService(prisma as any);
  const service = new LodgingPrecheckinService(prisma as any, guests);
  return { service, prisma, tx };
}

async function errorOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as VendixHttpException;
  }
  throw new Error('expected an error');
}

const submit = (guests: PrecheckinSubmitDto['guests']): PrecheckinSubmitDto => ({
  guests,
  data_consent: true,
});

describe('Online check-in link (H8.1)', () => {
  it('stays open until the departure day while the stay is ahead or in progress', () => {
    const departure = new Date('2026-11-14T00:00:00.000Z');
    expect(precheckinLinkOpen({ status: 'confirmed', departure_date: departure }, '2026-11-14')).toBe(true);
    expect(precheckinLinkOpen({ status: 'checked_in', departure_date: departure }, '2026-11-13')).toBe(true);
    expect(precheckinLinkOpen({ status: 'confirmed', departure_date: departure }, '2026-11-15')).toBe(false);
  });

  it('expires after check-out, cancellation or no-show', () => {
    const departure = new Date('2026-11-14T00:00:00.000Z');
    for (const status of ['checked_out', 'cancelled', 'no_show']) {
      expect(precheckinLinkOpen({ status, departure_date: departure }, '2026-11-10')).toBe(false);
    }
  });

  it('creates unguessable URL-safe tokens', () => {
    const a = newPrecheckinToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(newPrecheckinToken()).not.toBe(a);
  });
});

describe('LodgingPrecheckinService (H8.1)', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-11-10T15:00:00.000Z'), doNotFake: ['nextTick'] });
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({ store_id: 5 } as any);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('gives the desk the storefront link and creates the token only once', async () => {
    const { service, prisma } = build({ token: null });
    const link = await service.getLink(1);
    const token = prisma.lodging_reservations.update.mock.calls[0][0].data.precheckin_token;
    expect(link.url).toBe(`https://roku.vendix.com/pre-registro/${token}`);

    const again = build({ token: TOKEN });
    expect((await again.service.getLink(1)).url).toBe(`https://roku.vendix.com/pre-registro/${TOKEN}`);
    expect(again.prisma.lodging_reservations.update).not.toHaveBeenCalled();
  });

  it('asks to turn on the online store when there is no storefront domain', async () => {
    const { service } = build({ domain: null });
    expect((await errorOf(service.getLink(1))).errorCode).toBe('LODGING_PRECHECKIN_DOMAIN_001');
  });

  it('opens the form without login and without the party documents', async () => {
    const { service } = build();
    const data = await service.findByToken(TOKEN);
    expect(data).toMatchObject({
      store_name: 'Hotel Roku',
      reservation_number: 'H-0007',
      arrival_date: '2026-11-12',
      departure_date: '2026-11-14',
      expected_guests: 3,
      rooms: [{ id: 11, name: 'Doble' }],
      registered: [{ name: 'Ana P.', is_primary: true }],
    });
    expect(JSON.stringify(data)).not.toContain('1020304050');
  });

  it('rejects an unknown token', async () => {
    const { service } = build();
    expect((await errorOf(service.findByToken('nope'))).errorCode).toBe('LODGING_PRECHECKIN_FIND_001');
    expect((await errorOf(service.findByToken(''))).errorCode).toBe('LODGING_PRECHECKIN_FIND_001');
  });

  it('rejects the link after check-out and after the departure day', async () => {
    const out = build({ status: 'checked_out' });
    expect((await errorOf(out.service.findByToken(TOKEN))).errorCode).toBe('LODGING_PRECHECKIN_EXPIRED_001');
    const past = build({ departure: '2026-11-09' });
    const error = await errorOf(past.service.submit(TOKEN, submit([HOLDER])));
    expect(error.errorCode).toBe('LODGING_PRECHECKIN_EXPIRED_001');
    expect(past.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('registers the holder and a foreign companion and marks the check-in complete', async () => {
    const { service, prisma, tx } = build();
    const result = await service.submit(TOKEN, submit([HOLDER, COMPANION]));

    expect(result.guests).toBe(2);
    const [holder, companion] = tx.lodging_guests.create.mock.calls.map((call: any) => call[0].data);
    expect(holder).toMatchObject({
      store_id: 5,
      reservation_id: 1,
      reservation_room_id: 11,
      is_primary: true,
      customer_id: 90,
      nationality_country_code: 'CO',
    });
    expect(holder.data_consent_at).toBeInstanceOf(Date);
    expect(companion).toMatchObject({ is_primary: false, customer_id: null, nationality_country_code: 'US' });
    const update = prisma.lodging_reservations.update.mock.calls[0][0];
    expect(update.where).toEqual({ id: 1 });
    expect(update.data.precheckin_completed_at).toBeInstanceOf(Date);
  });

  it('updates a guest the desk already registered without touching desk-only fields', async () => {
    const { service, tx } = build({ holder: true, existing: [{ id: 40, document_number: 'x1234567' }] });
    await service.submit(TOKEN, submit([COMPANION]));

    expect(tx.lodging_guests.create).not.toHaveBeenCalled();
    const data = tx.lodging_guests.update.mock.calls[0][0].data;
    expect(tx.lodging_guests.update.mock.calls[0][0].where).toEqual({ id: 40 });
    expect(data).toMatchObject({ first_name: 'John', birth_date: new Date('1990-05-01T00:00:00.000Z') });
    expect(data).not.toHaveProperty('customer_id');
    expect(data).not.toHaveProperty('entry_permit_type');
    expect(data).not.toHaveProperty('is_non_resident');
    expect(data).not.toHaveProperty('is_primary');
  });

  it('names the guest and the missing TRA field and saves nothing', async () => {
    const { service, prisma } = build();
    const error = await errorOf(
      service.submit(TOKEN, submit([HOLDER, { ...COMPANION, residence_city: '' }])),
    );
    expect(error.errorCode).toBe('LODGING_GUEST_FIELDS_001');
    expect(error.message).toContain('Huésped 2: Falta ciudad de residencia');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.lodging_reservations.update).not.toHaveBeenCalled();
  });

  it('asks the passport holder for nationality (SIRE)', async () => {
    const { service } = build();
    const error = await errorOf(
      service.submit(TOKEN, submit([{ ...COMPANION, nationality_country_code: undefined }])),
    );
    expect(error.message).toContain('Huésped 1: El pasaporte exige nacionalidad');
  });
});
