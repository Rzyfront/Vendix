import { FiscalCloseService } from './fiscal-close.service';

describe('FiscalCloseService runChecks', () => {
  const context = {
    organization_id: 1,
    store_id: 2,
    accounting_entity_id: 77,
  } as any;

  it('preserves audited manual overrides when a regenerated blocking check still fails', async () => {
    const session = {
      id: 10,
      organization_id: 1,
      store_id: 2,
      accounting_entity_id: 77,
      status: 'blocked',
      period_year: 2026,
      period_month: 3,
      period_start: new Date('2026-03-01T00:00:00.000Z'),
      period_end: new Date('2026-03-31T00:00:00.000Z'),
      checks: [],
    };
    const tx = {
      fiscal_close_checks: {
        upsert: jest.fn(),
      },
      fiscal_close_sessions: {
        update: jest.fn().mockResolvedValue({ ...session, status: 'ready' }),
      },
    };
    const prisma = {
      fiscal_close_sessions: {
        findFirst: jest.fn().mockResolvedValue(session),
      },
      fiscal_close_checks: {
        findMany: jest.fn().mockResolvedValue([
          {
            check_key: 'dian_invoices_all_accepted',
            status: 'manually_overridden',
            metadata: { evidence_id: 55 },
          },
        ]),
      },
      $transaction: jest.fn((callback) => callback(tx)),
    };
    const service = new FiscalCloseService(
      prisma as any,
      { emit: jest.fn() } as any,
      { logForResource: jest.fn() } as any,
    );
    (service as any).evaluateChecks = jest.fn().mockResolvedValue([
      {
        check_key: 'dian_invoices_all_accepted',
        title: 'Facturación DIAN aceptada',
        description: 'No pendientes',
        blocking: true,
        status: 'failed',
        result_summary: 'Revisión pendiente: 1',
        metadata: { count: 1 },
      },
    ]);

    await service.runChecks([context], 10);

    expect(tx.fiscal_close_checks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          status: 'manually_overridden',
          metadata: expect.objectContaining({
            evidence_id: 55,
            latest_check_result: expect.objectContaining({
              status: 'failed',
              metadata: { count: 1 },
            }),
          }),
        }),
      }),
    );
    expect(tx.fiscal_close_sessions.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'ready',
          summary: expect.objectContaining({
            failures: 0,
            overrides: 1,
          }),
        }),
      }),
    );
  });
});
