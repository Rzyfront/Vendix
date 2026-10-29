import { RequestContextService } from '@common/context/request-context.service';
import { LodgingSireService } from './sire.service';

jest.mock('@common/utils/store-timezone.util', () => ({
  resolveStoreTimezone: jest.fn(async () => 'America/Bogota'),
}));

/**
 * H4.2 — the SIRE list (foreign guests only, pending first, overdue past the
 * store threshold) and "Marcar reportado" (who and when, only pending rows).
 */
function build(settings: Record<string, unknown> = {}) {
  const raw = {
    store_settings: {
      findFirst: jest.fn(async () => ({ settings: { hospitality: settings } })),
    },
    lodging_guests: {
      findMany: jest.fn(async () => [
        { id: 5, first_name: 'John', last_name: 'Smith', nationality_country_code: 'US' },
        { id: 6, first_name: 'Ana', last_name: 'Pérez', nationality_country_code: 'CO' },
      ]),
      findFirst: jest.fn(),
    },
    lodging_compliance_submissions: {
      createMany: jest.fn(async ({ data }: { data: unknown[] }) => ({ count: data.length })),
    },
  };
  const scoped = {
    lodging_compliance_submissions: {
      findMany: jest.fn(),
      count: jest.fn(async () => 1),
      findFirst: jest.fn(),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
  };
  const prisma = { withoutScope: () => raw, ...scoped };
  const service = new LodgingSireService(prisma as any);
  return { service, raw, scoped };
}

describe('LodgingSireService', () => {
  beforeEach(() => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({ store_id: 3, user_id: 42 } as any);
    jest.useFakeTimers().setSystemTime(new Date('2026-11-11T12:00:00Z'));
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('record', () => {
    it('logs one pending row per foreign guest and event, skipping duplicates', async () => {
      const { service, raw } = build();
      const count = await service.record(3, 1, ['check_in', 'check_out']);
      expect(count).toBe(2);
      expect(raw.lodging_compliance_submissions.createMany).toHaveBeenCalledWith({
        data: [
          { store_id: 3, reservation_id: 1, guest_id: 5, authority: 'sire', event: 'check_in', guest_name: 'John Smith' },
          { store_id: 3, reservation_id: 1, guest_id: 5, authority: 'sire', event: 'check_out', guest_name: 'John Smith' },
        ],
        skipDuplicates: true,
      });
    });

    it('records nothing when the store turned the SIRE off', async () => {
      const { service, raw } = build({ sire_enabled: false });
      expect(await service.record(3, 1, ['check_in'])).toBe(0);
      expect(raw.lodging_compliance_submissions.createMany).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    const row = (id: number, status: string, created_at: string) => ({
      id,
      reservation_id: 1,
      guest_id: 5,
      guest_name: 'John Smith',
      event: 'check_in',
      status,
      sent_at: status === 'manual' ? new Date('2026-11-11T08:00:00Z') : null,
      created_at: new Date(created_at),
      reservation: { reservation_number: 'H-0024' },
      reported_by: status === 'manual' ? { first_name: 'Laura', last_name: 'Ríos' } : null,
    });

    it('returns each movement with its age, overdue past 24 h, pending first', async () => {
      const { service, scoped } = build();
      scoped.lodging_compliance_submissions.findMany.mockResolvedValue([
        row(1, 'pending', '2026-11-10T08:00:00Z'), // 28 h
        row(2, 'pending', '2026-11-11T02:00:00Z'), // 10 h
        row(3, 'manual', '2026-11-10T06:00:00Z'),
      ]);
      const result = await service.list({});
      const args = scoped.lodging_compliance_submissions.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ authority: 'sire' });
      expect(args.orderBy[0]).toEqual({ status: 'desc' });
      expect(result.data.map((r) => [r.id, r.age_hours, r.overdue])).toEqual([
        [1, 28, true],
        [2, 10, false],
        [3, 26, false],
      ]);
      expect(result.data[2].reported_by_name).toBe('Laura Ríos');
      expect(result.data[0].reservation_number).toBe('H-0024');
    });

    it('uses the store threshold for the overdue filter and the flag', async () => {
      const { service, scoped } = build({ sire_overdue_hours: 48 });
      scoped.lodging_compliance_submissions.findMany.mockResolvedValue([row(1, 'pending', '2026-11-10T08:00:00Z')]);
      const result = await service.list({ status: 'overdue' });
      const where = scoped.lodging_compliance_submissions.findMany.mock.calls[0][0].where;
      expect(where).toEqual({
        authority: 'sire',
        status: 'pending',
        created_at: { lt: new Date('2026-11-09T12:00:00Z') },
      });
      expect(result.data[0].overdue).toBe(false);
    });
  });

  describe('markReported', () => {
    it('records the user and the time on pending SIRE rows only', async () => {
      const { service, scoped } = build();
      const result = await service.markReported([7, 8]);
      expect(result).toEqual({ updated: 1 });
      expect(scoped.lodging_compliance_submissions.updateMany).toHaveBeenCalledWith({
        where: { authority: 'sire', id: { in: [7, 8] }, status: 'pending' },
        data: {
          status: 'manual',
          sent_at: new Date('2026-11-11T12:00:00Z'),
          reported_by_user_id: 42,
          updated_at: new Date('2026-11-11T12:00:00Z'),
        },
      });
    });
  });

  describe('sheet', () => {
    it('answers 404 for a row outside the store', async () => {
      const { service, scoped } = build();
      scoped.lodging_compliance_submissions.findFirst.mockResolvedValue(null);
      await expect(service.sheet(99)).rejects.toMatchObject({ errorCode: 'LODGING_SIRE_NOT_FOUND_001' });
    });
  });
});
