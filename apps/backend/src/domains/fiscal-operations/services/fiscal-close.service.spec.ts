import { BadRequestException } from '@nestjs/common';
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

describe('FiscalCloseService close', () => {
  const context = {
    organization_id: 1,
    store_id: 2,
    accounting_entity_id: 77,
  } as any;

  const baseSession = {
    id: 10,
    organization_id: 1,
    store_id: 2,
    accounting_entity_id: 77,
    fiscal_period_id: 33,
    status: 'approved',
    period_year: 2026,
    period_month: 5,
    period_start: new Date('2026-05-01T00:00:00.000Z'),
    period_end: new Date('2026-05-31T00:00:00.000Z'),
  };

  const passedCheck = {
    id: 1,
    check_key: 'journal_entries_posted',
    title: 'Asientos contabilizados',
    blocking: true,
    status: 'passed',
    metadata: { count: 0 },
  };

  it('re-runs checks before closing and rejects when a blocking check now fails', async () => {
    const staleSession = { ...baseSession, checks: [passedCheck] };
    const blockedSession = {
      ...baseSession,
      status: 'blocked',
      checks: [{ ...passedCheck, status: 'failed' }],
    };
    const tx = {
      fiscal_close_checks: { upsert: jest.fn() },
      fiscal_close_sessions: {
        update: jest.fn().mockResolvedValue(blockedSession),
      },
      fiscal_periods: { update: jest.fn() },
    };
    const prisma = {
      fiscal_close_sessions: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(staleSession) // close() -> findOne
          .mockResolvedValueOnce(staleSession) // runChecks() -> findOne
          .mockResolvedValueOnce(blockedSession), // runChecks() -> findOne final
      },
      fiscal_close_checks: {
        findMany: jest.fn().mockResolvedValue([
          {
            check_key: 'journal_entries_posted',
            status: 'passed',
            metadata: null,
          },
        ]),
      },
      $transaction: jest.fn((callback) => callback(tx)),
    };
    const eventEmitter = { emit: jest.fn() };
    const service = new FiscalCloseService(
      prisma as any,
      eventEmitter as any,
      { logForResource: jest.fn() } as any,
    );
    (service as any).evaluateChecks = jest.fn().mockResolvedValue([
      {
        check_key: 'journal_entries_posted',
        title: 'Asientos contabilizados',
        description: 'Sin borradores en el período',
        blocking: true,
        status: 'failed',
        result_summary: 'Revisión pendiente: 3',
        metadata: { count: 3 },
      },
    ]);

    let caught: any;
    await service.close([context], 10).catch((error) => (caught = error));

    expect(caught).toBeInstanceOf(BadRequestException);
    expect(caught.getResponse()).toMatchObject({
      error_code: 'FISCAL_CLOSE_BLOCKING_CHECKS_FAILED',
      details: { failed_checks: ['journal_entries_posted'] },
    });
    expect((service as any).evaluateChecks).toHaveBeenCalledTimes(1);
    // Solo la transacción de persistencia de runChecks; nunca la de cierre.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.fiscal_periods.update).not.toHaveBeenCalled();
    expect(eventEmitter.emit).not.toHaveBeenCalledWith(
      'fiscal.close.closed',
      expect.anything(),
    );
  });

  it('closes the period when re-validated checks pass', async () => {
    const approvedSession = { ...baseSession, checks: [passedCheck] };
    const readySession = {
      ...baseSession,
      status: 'ready',
      checks: [passedCheck],
    };
    const closedSession = { ...baseSession, status: 'closed' };
    const tx = {
      fiscal_close_checks: { upsert: jest.fn() },
      fiscal_close_sessions: {
        update: jest
          .fn()
          .mockResolvedValueOnce(readySession) // runChecks persistence
          .mockResolvedValueOnce(closedSession), // close transition
      },
      fiscal_periods: { update: jest.fn() },
    };
    const prisma = {
      fiscal_close_sessions: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(approvedSession)
          .mockResolvedValueOnce(approvedSession)
          .mockResolvedValueOnce(readySession),
      },
      fiscal_close_checks: {
        findMany: jest.fn().mockResolvedValue([
          {
            check_key: 'journal_entries_posted',
            status: 'passed',
            metadata: null,
          },
        ]),
      },
      $transaction: jest.fn((callback) => callback(tx)),
    };
    const eventEmitter = { emit: jest.fn() };
    const service = new FiscalCloseService(
      prisma as any,
      eventEmitter as any,
      { logForResource: jest.fn() } as any,
    );
    (service as any).evaluateChecks = jest.fn().mockResolvedValue([
      {
        check_key: 'journal_entries_posted',
        title: 'Asientos contabilizados',
        description: 'Sin borradores en el período',
        blocking: true,
        status: 'passed',
        result_summary: 'Sin hallazgos bloqueantes',
        metadata: { count: 0 },
      },
    ]);

    const result = await service.close([context], 10);

    expect(result.status).toBe('closed');
    expect((service as any).evaluateChecks).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(tx.fiscal_periods.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 33 },
        data: expect.objectContaining({ status: 'closed' }),
      }),
    );
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'fiscal.close.closed',
      expect.objectContaining({ id: 10 }),
    );
  });

  it('does not block close when a still-failing blocking check has an audited manual override', async () => {
    const overriddenCheck = {
      id: 1,
      check_key: 'dian_invoices_all_accepted',
      title: 'Facturación DIAN aceptada',
      blocking: true,
      status: 'manually_overridden',
      metadata: { evidence_id: 55 },
    };
    const approvedSession = { ...baseSession, checks: [overriddenCheck] };
    const readySession = {
      ...baseSession,
      status: 'ready',
      checks: [overriddenCheck],
    };
    const closedSession = { ...baseSession, status: 'closed' };
    const tx = {
      fiscal_close_checks: { upsert: jest.fn() },
      fiscal_close_sessions: {
        update: jest
          .fn()
          .mockResolvedValueOnce(readySession)
          .mockResolvedValueOnce(closedSession),
      },
      fiscal_periods: { update: jest.fn() },
    };
    const prisma = {
      fiscal_close_sessions: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(approvedSession)
          .mockResolvedValueOnce(approvedSession)
          .mockResolvedValueOnce(readySession),
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

    const result = await service.close([context], 10);

    expect(result.status).toBe('closed');
    // El override auditado se preserva al re-persistir el check fallido.
    expect(tx.fiscal_close_checks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ status: 'manually_overridden' }),
      }),
    );
  });
});
