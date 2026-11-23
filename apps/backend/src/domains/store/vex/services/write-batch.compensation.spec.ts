import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { RequestContextService } from '../../../../common/context/request-context.service';
import {
  AI_WRITE_BATCH_STEP_UNDONE,
  WriteBatchCompensationService,
} from './write-batch-compensation.service';
import { WRITE_BATCH_UNDO_WINDOW_MS } from './write-batch.types';

describe('WriteBatchCompensationService (T36 · Deshacer)', () => {
  const USER = 11;
  const STORE = 7;

  function makeStep(over: Record<string, unknown> = {}) {
    return {
      step_id: 's1',
      order: 1,
      tool: 'update_product_price',
      arguments: { product_id: 5, new_price: 120 },
      label: 'Subir precio',
      status: 'applied',
      compensable: true,
      compensation_snapshot: { previous: 100 },
      compensation_output: '{"summary":"ok"}',
      result_summary: 'Precio 100 → 120.',
      ...over,
    };
  }

  function makeRow(over: Record<string, unknown> = {}, steps?: unknown[]) {
    return {
      id: 'b1',
      store_id: STORE,
      organization_id: 3,
      user_id: USER,
      status: 'applied',
      version: 4,
      finished_at: new Date(Date.now() - 60_000),
      steps: steps ?? [makeStep(), makeStep({ step_id: 's2', order: 2 })],
      ...over,
    };
  }

  function build(opts: {
    row?: Record<string, any>;
    claimCount?: number;
    alwaysLose?: boolean;
    undo?: jest.Mock;
    assertPermitted?: jest.Mock;
    loadOwned?: jest.Mock;
    auditLog?: jest.Mock;
  } = {}) {
    const row = opts.row ?? makeRow();
    const undo =
      opts.undo ?? jest.fn().mockResolvedValue('Precio restaurado a 100.');
    const updateMany = jest
      .fn()
      .mockResolvedValueOnce({ count: opts.claimCount ?? 1 })
      .mockResolvedValue({ count: opts.alwaysLose ? 0 : 1 });
    const prisma = { ai_agent_write_batches: { updateMany } } as any;
    const view = { id: 'b1', steps: [] };
    const batches = {
      loadOwned: opts.loadOwned ?? jest.fn().mockResolvedValue(row),
      getView: jest.fn().mockResolvedValue(view),
    } as any;
    const registry = {
      assertPermitted: opts.assertPermitted ?? jest.fn(),
      canonicalName: (n: string) => n,
      get: jest.fn().mockReturnValue({
        name: 'update_product_price',
        compensate: { label: 'Restaurar el precio anterior', undo },
      }),
    } as any;
    const audit = { log: opts.auditLog ?? jest.fn().mockResolvedValue(undefined) } as any;
    const service = new WriteBatchCompensationService(
      prisma,
      batches,
      registry,
      audit,
    );
    return { service, updateMany, undo, batches, registry, audit, view };
  }

  const run = <T>(fn: () => Promise<T>) =>
    RequestContextService.run(
      {
        organization_id: 3,
        store_id: STORE,
        user_id: USER,
        roles: ['owner'],
      } as any,
      fn,
    ) as Promise<T>;

  const input = { batchId: 'b1', stepId: 's1', userId: USER };

  /** Step `s1` as written by the last updateMany call. */
  const lastStep = (updateMany: jest.Mock, stepId = 's1') => {
    const calls = updateMany.mock.calls;
    const data = calls[calls.length - 1][0].data;
    return data.steps.find((s: any) => s.step_id === stepId);
  };

  it('happy path: claims, undoes once, marks compensated and audits', async () => {
    const { service, updateMany, undo, audit, view } = build();
    const result = await run(() => service.undoStep(input));

    expect(result).toBe(view);
    expect(undo).toHaveBeenCalledTimes(1);
    expect(undo).toHaveBeenCalledWith(
      expect.objectContaining({
        args: { product_id: 5, new_price: 120 },
        snapshot: { previous: 100 },
        handlerOutput: '{"summary":"ok"}',
        context: expect.objectContaining({ store_id: STORE, user_id: USER }),
      }),
    );

    // Claim: ONE conditional update on the row version, step → compensating.
    const claim = updateMany.mock.calls[0][0];
    expect(claim.where).toEqual({ id: 'b1', store_id: STORE, version: 4 });
    expect(claim.data.version).toEqual({ increment: 1 });
    expect(
      claim.data.steps.find((s: any) => s.step_id === 's1').status,
    ).toBe('compensating');
    expect(
      claim.data.steps.find((s: any) => s.step_id === 's2').status,
    ).toBe('applied');

    const final = lastStep(updateMany);
    expect(final.status).toBe('compensated');
    expect(final.result_summary).toBe('Precio restaurado a 100.');
    expect(typeof final.compensated_at).toBe('string');
    // The other step is untouched.
    expect(lastStep(updateMany, 's2').status).toBe('applied');

    expect(audit.log).toHaveBeenCalledTimes(1);
    const entry = audit.log.mock.calls[0][0];
    expect(entry.action).toBe(AI_WRITE_BATCH_STEP_UNDONE);
    expect(entry.resource).toBe('ai_agent_write_batches');
    expect(entry.metadata).toEqual({
      source: 'ai_agent',
      agent_key: 'vex',
      batch_id: 'b1',
      step_id: 's1',
      tool: 'update_product_price',
      outcome: 'compensated',
    });
  });

  it('double undo: the loser of the claim runs nothing and returns the view', async () => {
    const first = build();
    await run(() => first.service.undoStep(input));
    expect(first.undo).toHaveBeenCalledTimes(1);

    const second = build({ claimCount: 0, alwaysLose: true });
    const result = await run(() => second.service.undoStep(input));
    expect(second.undo).not.toHaveBeenCalled();
    expect(second.updateMany).toHaveBeenCalledTimes(2); // claim + one retry, both lost
    expect(second.audit.log).not.toHaveBeenCalled();
    expect(result).toBe(second.view);
  });

  it('window closed: refuses with 409 and never claims or undoes', async () => {
    const { service, updateMany, undo } = build({
      row: makeRow({
        finished_at: new Date(Date.now() - WRITE_BATCH_UNDO_WINDOW_MS - 1000),
      }),
    });
    const error = await run(() => service.undoStep(input)).catch((e) => e);
    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.errorCode).toBe(ErrorCodes.SYS_CONFLICT_001.code);
    expect(undo).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('non-compensable step: refuses with 409', async () => {
    const { service, updateMany, undo } = build({
      row: makeRow({}, [makeStep({ compensable: false })]),
    });
    const error = await run(() => service.undoStep(input)).catch((e) => e);
    expect(error.errorCode).toBe(ErrorCodes.SYS_CONFLICT_001.code);
    expect(error.getResponse().message).toBe(
      'Este cambio ya no se puede deshacer desde Vex.',
    );
    expect(undo).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('step already compensated or without snapshot: refuses', async () => {
    for (const over of [
      { status: 'compensated' },
      { compensation_snapshot: undefined },
    ]) {
      const { service, undo } = build({ row: makeRow({}, [makeStep(over)]) });
      const error = await run(() => service.undoStep(input)).catch((e) => e);
      expect(error.errorCode).toBe(ErrorCodes.SYS_CONFLICT_001.code);
      expect(undo).not.toHaveBeenCalled();
    }
  });

  it('batch not finished (executing): refuses', async () => {
    const { service, undo } = build({ row: makeRow({ status: 'executing' }) });
    const error = await run(() => service.undoStep(input)).catch((e) => e);
    expect(error.errorCode).toBe(ErrorCodes.SYS_CONFLICT_001.code);
    expect(undo).not.toHaveBeenCalled();
  });

  it('role lost: assertPermitted throws, nothing is claimed or undone', async () => {
    const { service, updateMany, undo } = build({
      assertPermitted: jest.fn(() => {
        throw new VendixHttpException(ErrorCodes.AI_AGENT_004);
      }),
    });
    const error = await run(() => service.undoStep(input)).catch((e) => e);
    expect(error.errorCode).toBe(ErrorCodes.AI_AGENT_004.code);
    expect(updateMany).not.toHaveBeenCalled();
    expect(undo).not.toHaveBeenCalled();
  });

  it('undo throws: step is compensation_failed with a human line, change stays applied', async () => {
    const undo = jest
      .fn()
      .mockRejectedValue(
        new VendixHttpException(
          ErrorCodes.SYS_CONFLICT_001,
          'El valor cambió después del lote; no lo revertí.',
        ),
      );
    const { service, updateMany, audit } = build({ undo });
    await run(() => service.undoStep(input));

    const final = lastStep(updateMany);
    expect(final.status).toBe('compensation_failed');
    expect(final.error).toContain(
      'El valor cambió después del lote; no lo revertí.',
    );
    expect(final.error).toContain('El cambio sigue aplicado.');
    expect(final.compensated_at).toBeUndefined();
    expect(audit.log.mock.calls[0][0].metadata.outcome).toBe(
      'compensation_failed',
    );
  });

  it('undo throws a raw error: the card gets the generic line, never the message', async () => {
    const undo = jest
      .fn()
      .mockRejectedValue(new Error('P2028 transaction already closed'));
    const { service, updateMany } = build({ undo });
    await run(() => service.undoStep(input));
    const final = lastStep(updateMany);
    expect(final.status).toBe('compensation_failed');
    expect(final.error).not.toContain('P2028');
    expect(final.error).toBe(
      'No se pudo deshacer este cambio. El cambio sigue aplicado.',
    );
  });

  it('audit failure does not hide the result', async () => {
    const { service, updateMany } = build({
      auditLog: jest.fn().mockRejectedValue(new Error('db down')),
    });
    const result = await run(() => service.undoStep(input));
    expect(result).toBeDefined();
    expect(lastStep(updateMany).status).toBe('compensated');
  });

  it('another user: loadOwned 403 propagates, nothing runs', async () => {
    const loadOwned = jest
      .fn()
      .mockRejectedValue(new VendixHttpException(ErrorCodes.SYS_FORBIDDEN_001));
    const { service, updateMany, undo } = build({ loadOwned });
    const error = await run(() => service.undoStep(input)).catch((e) => e);
    expect(error.errorCode).toBe(ErrorCodes.SYS_FORBIDDEN_001.code);
    expect(updateMany).not.toHaveBeenCalled();
    expect(undo).not.toHaveBeenCalled();
  });

  it('unknown step id: 404', async () => {
    const { service, undo } = build();
    const error = await run(() =>
      service.undoStep({ ...input, stepId: 's9' }),
    ).catch((e) => e);
    expect(error.errorCode).toBe(ErrorCodes.SYS_NOT_FOUND_001.code);
    expect(undo).not.toHaveBeenCalled();
  });

  it('persist race: a concurrent undo of another step bumped the version; this step is still finalized and the other change kept', async () => {
    const row = makeRow();
    const newer = makeRow(
      { version: 6 },
      [
        makeStep(), // still `applied` in the stale read of the other writer
        makeStep({ step_id: 's2', order: 2, status: 'compensated' }),
      ],
    );
    const loadOwned = jest
      .fn()
      .mockResolvedValueOnce(row) // undoStep entry
      .mockResolvedValueOnce(row) // persist attempt 1 (stale)
      .mockResolvedValue(newer); // persist attempt 2 (fresh)
    const { service, updateMany, undo } = build({ row, loadOwned });
    updateMany.mockReset();
    updateMany
      .mockResolvedValueOnce({ count: 1 }) // claim
      .mockResolvedValueOnce({ count: 0 }) // persist lost the race
      .mockResolvedValue({ count: 1 });
    await run(() => service.undoStep(input));

    expect(undo).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledTimes(3);
    const retry = updateMany.mock.calls[2][0];
    expect(retry.where.version).toBe(6);
    expect(
      retry.data.steps.find((s: any) => s.step_id === 's1').status,
    ).toBe('compensated');
    expect(
      retry.data.steps.find((s: any) => s.step_id === 's2').status,
    ).toBe('compensated');
  });

  it('claim race on ANOTHER step: re-reads and retries the claim, undo runs once', async () => {
    const row = makeRow();
    const newer = makeRow({ version: 5 });
    const loadOwned = jest
      .fn()
      .mockResolvedValueOnce(row)
      .mockResolvedValue(newer);
    const { service, updateMany, undo } = build({ row, loadOwned });
    updateMany.mockReset();
    updateMany
      .mockResolvedValueOnce({ count: 0 }) // first claim lost
      .mockResolvedValue({ count: 1 });
    await run(() => service.undoStep(input));
    expect(updateMany.mock.calls[1][0].where.version).toBe(5);
    expect(undo).toHaveBeenCalledTimes(1);
  });
});
