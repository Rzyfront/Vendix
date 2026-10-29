import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { LodgingNightAuditService } from './night-audit.service';

interface AuditRow {
  id: number;
  store_id: number;
  business_date: Date;
  status: string;
  summary: unknown;
  closed_by_user_id: number | null;
  closed_at: Date;
  reopened_by_user_id: number | null;
  reopened_at: Date | null;
  reopen_reason: string | null;
}

const day = (d: string) => new Date(`${d}T00:00:00.000Z`);

/**
 * H7.1 — hotel of 5 rooms, business day 10-nov (Bogotá, audit at 02:00):
 * H-0001 in house in 101 (night posted), H-0002 in house in 102 (night not
 * posted yet), H-0003 confirmed arriving today and never came.
 */
function build() {
  const audits: AuditRow[] = [];
  const nights = [
    {
      rate_amount: new Prisma.Decimal(250000),
      unit: { code: '101' },
      unit_type: { name: 'Doble' },
      posted_order_item: { total_price: new Prisma.Decimal(250000), cancelled_at: null as Date | null },
      reservation_room: {
        reservation: { id: 1, reservation_number: 'H-0001', customer: { first_name: 'Ana', last_name: 'Gómez' } },
      },
    },
    {
      rate_amount: new Prisma.Decimal(180000),
      unit: { code: '102' },
      unit_type: { name: 'Sencilla' },
      posted_order_item: null as { total_price: Prisma.Decimal; cancelled_at: Date | null } | null,
      reservation_room: {
        reservation: { id: 2, reservation_number: 'H-0002', customer: { first_name: 'Luis', last_name: null } },
      },
    },
  ];
  const reservations = [
    { id: 3, reservation_number: 'H-0003', status: 'confirmed', arrival_date: day('2026-11-10'), customer: { first_name: 'Juan', last_name: 'Pérez' } },
  ];
  const pick = (r: (typeof reservations)[number]) => ({
    id: r.id,
    reservation_number: r.reservation_number,
    customer: r.customer,
  });
  const prisma = {
    store_settings: {
      findFirst: jest.fn(async () => ({
        settings: { hospitality: { night_audit_time: '02:00' } },
        stores: { timezone: 'America/Bogota' },
      })),
    },
    lodging_units: { count: jest.fn(async () => 5) },
    lodging_room_nights: {
      findMany: jest.fn(async () => nights),
    },
    lodging_reservations: {
      findMany: jest.fn(async ({ where }: any) =>
        reservations
          .filter((r) =>
            where.status === 'no_show'
              ? r.status === 'no_show' && r.arrival_date.getTime() === where.arrival_date.getTime()
              : r.status === 'confirmed' && r.arrival_date <= where.arrival_date.lte,
          )
          .map(pick),
      ),
    },
    lodging_folios: {
      findMany: jest.fn(async () => [
        { id: 70, status: 'open', reservation_id: 1, order_id: 500 },
        { id: 71, status: 'open', reservation_id: 2, order_id: 501 },
      ]),
    },
    lodging_night_audits: {
      findFirst: jest.fn(async ({ where }: any) =>
        audits.find((a) => a.business_date.getTime() === where.business_date.getTime()) ?? null,
      ),
      findMany: jest.fn(async () =>
        audits.filter((a) => a.status === 'closed').map((a) => ({ business_date: a.business_date })),
      ),
      create: jest.fn(async ({ data }: any) => {
        if (audits.some((a) => a.business_date.getTime() === data.business_date.getTime())) {
          throw new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' });
        }
        const row = { id: audits.length + 1, reopened_by_user_id: null, reopened_at: null, reopen_reason: null, ...data };
        audits.push(row);
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const rows = audits.filter(
          (a) =>
            (where.id === undefined || a.id === where.id) &&
            (where.business_date === undefined || a.business_date.getTime() === where.business_date.getTime()) &&
            a.status === where.status,
        );
        rows.forEach((a) => Object.assign(a, data));
        return { count: rows.length };
      }),
    },
    users: { findMany: jest.fn(async () => [{ id: 42, first_name: 'Ana', last_name: 'Ríos' }]) },
  };
  const folios = {
    // U15 — the folio prices what "Cerrar día" will charge: H-0002's night + IVA 19 %.
    previewNightsThrough: jest.fn(async () => ({ nights: 1, amount: 214200 })),
    // "Cargar noche" of H-0002: its night gets its folio line.
    postNightsThrough: jest.fn(async (folio: { id: number }) => {
      if (folio.id !== 71) return 0;
      nights[1].posted_order_item = { total_price: new Prisma.Decimal(180000), cancelled_at: null };
      return 1;
    }),
  };
  const reservationsService = {
    autoNoShow: jest.fn(async () => {
      reservations[0].status = 'no_show';
      return 1;
    }),
  };
  const service = new LodgingNightAuditService(prisma as any, folios as any, reservationsService as any);
  return { service, prisma, audits, nights, folios, reservationsService };
}

async function errorOf(promise: Promise<unknown>): Promise<VendixHttpException> {
  try {
    await promise;
  } catch (error) {
    return error as VendixHttpException;
  }
  throw new Error('expected the night audit operation to fail');
}

describe('LodgingNightAuditService (H7.1)', () => {
  beforeEach(() => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({ store_id: 3, user_id: 42 } as any);
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    // 10-nov 23:00 in Bogotá.
    jest.setSystemTime(new Date('2026-11-11T04:00:00Z'));
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('"Cerrar día" preview', () => {
    it('shows nights charged, pending arrivals and the discrepancy of the day', async () => {
      const { service } = build();

      const view = await service.get();

      expect(view.business_date).toBe('2026-11-10');
      expect(view.status).toBe('open');
      expect(view.summary).toMatchObject({
        rooms_total: 5,
        rooms_occupied: 2,
        nights_posted: 1,
        room_revenue: '250000.00',
        no_shows: [],
        pending_arrivals: [{ id: 3, reservation_number: 'H-0003', guest_name: 'Juan Pérez' }],
        discrepancies: [
          {
            reservation_id: 2,
            reservation_number: 'H-0002',
            guest_name: 'Luis',
            room: '102 · Sencilla',
            rate_amount: '180000.00',
            reason: 'not_posted',
          },
        ],
      });
    });

    it('tells how many nights and what the guests pay when "Cerrar día" charges them (U15)', async () => {
      const { service, folios } = build();

      const view = await service.get('2026-11-10');

      expect(view.close_preview).toEqual({ nights: 1, amount: '214200.00' });
      expect(folios.previewNightsThrough).toHaveBeenCalledWith('2026-11-10');
    });

    it('a day with nothing to charge previews zero nights and zero amount', async () => {
      const { service, folios } = build();
      folios.previewNightsThrough.mockResolvedValueOnce({ nights: 0, amount: 0 });

      expect((await service.get('2026-11-10')).close_preview).toEqual({ nights: 0, amount: '0.00' });
    });

    it('a voided night line is a discrepancy, not revenue', async () => {
      const { service, nights } = build();
      nights[0].posted_order_item!.cancelled_at = new Date();

      const { summary } = await service.get('2026-11-10');

      expect(summary.nights_posted).toBe(0);
      expect(summary.room_revenue).toBe('0.00');
      expect(summary.discrepancies.map((d) => d.reason)).toEqual(['voided', 'not_posted']);
    });

    it('before the audit time the business day is still yesterday', async () => {
      const { service } = build();
      jest.setSystemTime(new Date('2026-11-11T06:30:00Z')); // 11-nov 01:30 Bogotá

      expect((await service.get()).business_date).toBe('2026-11-10');

      jest.setSystemTime(new Date('2026-11-11T07:00:00Z')); // 11-nov 02:00 Bogotá
      expect((await service.get()).business_date).toBe('2026-11-11');
    });
  });

  describe('closing the day', () => {
    it('posts the nights, marks no-shows and freezes the day with its summary', async () => {
      const { service, audits, folios, reservationsService } = build();

      const view = await service.close();

      expect(folios.postNightsThrough).toHaveBeenCalledTimes(2);
      expect(folios.postNightsThrough).toHaveBeenCalledWith(expect.objectContaining({ id: 71 }), '2026-11-10', true);
      expect(reservationsService.autoNoShow).toHaveBeenCalledWith('2026-11-11', 'Cierre del día 2026-11-10', 42);
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({ status: 'closed', closed_by_user_id: 42, business_date: day('2026-11-10') });
      expect(view).toMatchObject({ status: 'closed', closed_by: 'Ana Ríos' });
      expect(view.summary).toMatchObject({
        nights_posted: 2,
        room_revenue: '430000.00',
        no_shows: [{ reservation_number: 'H-0003' }],
        pending_arrivals: [],
        discrepancies: [],
      });
    });

    it('can leave the pending arrivals untouched', async () => {
      const { service, reservationsService } = build();

      const view = await service.close('2026-11-10', false);

      expect(reservationsService.autoNoShow).not.toHaveBeenCalled();
      expect(view.summary.pending_arrivals).toHaveLength(1);
    });

    it('a closed day keeps its snapshot even if the live figures change', async () => {
      const { service, nights } = build();
      await service.close();
      nights[0].posted_order_item = null;

      const view = await service.get('2026-11-10');

      expect(view.summary.nights_posted).toBe(2);
      expect(view.summary.discrepancies).toEqual([]);
      // Nothing left to charge on a frozen day: no preview.
      expect(view.close_preview).toBeNull();
    });

    it('rejects closing the same day twice, also on a concurrent double click', async () => {
      const { service, prisma, audits } = build();
      await service.close();

      const again = await errorOf(service.close('2026-11-10'));
      expect(again.errorCode).toBe(ErrorCodes.LODGING_NIGHT_AUDIT_CLOSED_001.code);

      // The other click read "not closed" before the first one committed.
      prisma.lodging_night_audits.findFirst.mockResolvedValueOnce(null);
      const race = await errorOf(service.close('2026-11-10'));
      expect(race.errorCode).toBe(ErrorCodes.LODGING_NIGHT_AUDIT_CLOSED_001.code);
      expect(audits).toHaveLength(1);
    });

    it('rejects a day that has not come yet', async () => {
      const { service, audits } = build();

      const error = await errorOf(service.close('2026-11-11'));

      expect(error.errorCode).toBe(ErrorCodes.LODGING_NIGHT_AUDIT_DATE_001.code);
      expect(audits).toHaveLength(0);
    });
    it('before the audit time it does not close the new civil day nor no-show its arrivals', async () => {
      // 11-nov 01:00 in Bogotá: the civil date is 11-nov, the business day is still 10-nov.
      jest.setSystemTime(new Date('2026-11-11T06:00:00Z'));
      const { service, audits, reservationsService, folios } = build();

      const error = await errorOf(service.close('2026-11-11'));

      expect(error.errorCode).toBe(ErrorCodes.LODGING_NIGHT_AUDIT_DATE_001.code);
      expect(reservationsService.autoNoShow).not.toHaveBeenCalled();
      expect(folios.postNightsThrough).not.toHaveBeenCalled();
      expect(audits).toHaveLength(0);
      expect((await service.get()).business_date).toBe('2026-11-10');
    });
  });

  describe('reopening the day', () => {
    it('unfreezes a closed day with the reason and who reopened it, and it closes again', async () => {
      const { service, audits } = build();
      await service.close();

      const reopened = await service.reopen('2026-11-10', '  Faltó cargar un minibar  ');

      expect(reopened).toMatchObject({
        status: 'reopened',
        reopened_by: 'Ana Ríos',
        reopen_reason: 'Faltó cargar un minibar',
      });

      const closed = await service.close('2026-11-10');
      expect(closed.status).toBe('closed');
      expect(audits).toHaveLength(1);
    });

    it('only a closed day can be reopened', async () => {
      const { service } = build();

      const error = await errorOf(service.reopen('2026-11-10', 'Sin cierre'));

      expect(error.errorCode).toBe(ErrorCodes.LODGING_NIGHT_AUDIT_REOPEN_001.code);
    });
  });
});
