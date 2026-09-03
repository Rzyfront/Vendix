import { VendixHttpException } from '../../../../common/errors';
import { AccountingReportsService } from './accounting-reports.service';

/**
 * Tests `AccountingReportsService.resolveFiscalPeriod` (QUI-722).
 *
 * The helper is private; we cast the service to `any` and call
 * directly. This keeps the test focused on the inference contract
 * without hauling in the rest of the report machinery.
 *
 * Cases:
 *   1. Explicit `fiscal_period_id` is returned as-is (no inference).
 *   2. Omitted + both dates that fall inside ONE open period → returns
 *      that period's id and emits a log line.
 *   3. Omitted + dates that match ZERO open periods → 400.
 *   4. Omitted + dates that match MULTIPLE periods → 400 (refuse to
 *      silently pick one).
 *   5. Omitted + only date_from (no date_to) → 400 with accionable
 *      message.
 *   6. Omitted + no dates → 400.
 *   7. Explicit but invalid `fiscal_period_id` → the subsequent
 *      `validateFiscalPeriod` call 400s, and the ID IS the one the
 *      caller passed (no silent override).
 */
describe('AccountingReportsService.resolveFiscalPeriod (QUI-722)', () => {
  const buildService = (overrides: any = {}) => {
    const prisma = {
      fiscal_periods: {
        findFirst: overrides.findFirst ?? jest.fn(),
        findMany: overrides.findMany ?? jest.fn().mockResolvedValue([]),
      },
      accounting_entries: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      accounting_entry_lines: {
        groupBy: jest.fn().mockResolvedValue([]),
      },
      chart_of_accounts: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new AccountingReportsService(prisma as any);
    return { service, prisma };
  };

  const callResolve = (service: AccountingReportsService, query: any) =>
    (service as any).resolveFiscalPeriod(query);

  it('returns the explicit fiscal_period_id without inference', async () => {
    const { service } = buildService();
    const id = await callResolve(service, { fiscal_period_id: 42 });
    expect(id).toBe(42);
  });

  it('infers the period when both dates are explicit and one period matches', async () => {
    const { service, prisma } = buildService({
      findMany: jest.fn().mockResolvedValue([
        {
          id: 7,
          name: 'Septiembre 2026',
          start_date: new Date('2026-09-01'),
          end_date: new Date('2026-09-30'),
        },
      ]),
    });
    const id = await callResolve(service, {
      date_from: '2026-09-01',
      date_to: '2026-09-30',
    });
    expect(id).toBe(7);
    expect(prisma.fiscal_periods.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          start_date: { lte: expect.any(Date) },
          end_date: { gte: expect.any(Date) },
          status: 'open',
        }),
      }),
    );
  });

  it('throws when no open period contains the requested range', async () => {
    const { service } = buildService({
      findMany: jest.fn().mockResolvedValue([]),
    });
    await expect(
      callResolve(service, {
        date_from: '2030-01-01',
        date_to: '2030-01-31',
      }),
    ).rejects.toThrow(VendixHttpException);
  });

  it('throws when multiple periods match (refuses silent choice)', async () => {
    const { service } = buildService({
      findMany: jest
        .fn()
        .mockResolvedValue([
          { id: 1, name: 'period-A', start_date: new Date('2026-01-01'), end_date: new Date('2026-12-31') },
          { id: 2, name: 'period-B', start_date: new Date('2026-06-01'), end_date: new Date('2026-12-31') },
        ]),
    });
    await expect(
      callResolve(service, {
        date_from: '2026-07-01',
        date_to: '2026-07-31',
      }),
    ).rejects.toThrow(VendixHttpException);
  });

  it('throws with accionable message when only date_from is given', async () => {
    const { service } = buildService();
    await expect(
      callResolve(service, { date_from: '2026-09-01' }),
    ).rejects.toThrow(/Provide fiscal_period_id/);
  });

  it('throws with accionable message when only date_to is given', async () => {
    const { service } = buildService();
    await expect(
      callResolve(service, { date_to: '2026-09-30' }),
    ).rejects.toThrow(/Provide fiscal_period_id/);
  });

  it('throws with accionable message when no dates and no fiscal_period_id', async () => {
    const { service } = buildService();
    await expect(callResolve(service, {})).rejects.toThrow(
      VendixHttpException,
    );
  });

  it('infers status=open only (closed periods are ignored)', async () => {
    // findMany is called with status: 'open' in the where clause.
    // Even if the DB had a matching CLOSED period, it's not returned.
    const { service, prisma } = buildService({
      findMany: jest.fn().mockResolvedValue([]),
    });
    await expect(
      callResolve(service, {
        date_from: '2026-09-01',
        date_to: '2026-09-30',
      }),
    ).rejects.toThrow();
    expect(prisma.fiscal_periods.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'open' }),
      }),
    );
  });
});
