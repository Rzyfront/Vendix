import { ConflictException } from '@nestjs/common';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '../../../../common/errors';
import { USER_NOTICES } from '../../../../ai-engine/agent-execution.contract';
import {
  WriteBatchExecutorService,
  summarizeWriteBatch,
  writeBatchTerminalStatus,
  writeBatchQuotaRequestId,
  AI_WRITE_BATCH_EXECUTED,
  BATCH_STEP_MESSAGES,
} from './write-batch-executor.service';
import { writeBatchArgsHash } from './write-batch.service';

describe('WriteBatchExecutorService (T35 approve / T38 audit + metering)', () => {
  const USER = 11;
  const STORE = 7;
  const ORG = 3;

  /**
   * - `throw`: the ledger fails BEFORE dispatching (nothing was written).
   * - `landed_then_conflict`: probe A of the audit — the real dispatch runs and
   *   then the ledger's `checkpoint` throws (`vexi-plan-state.service.ts`).
   * - `handler_rethrow`: the handler itself throws; the ledger records it and
   *   rethrows the SAME error (known failure, nothing applied).
   */
  type Behavior =
    | 'ok'
    | 'fail'
    | 'unknown'
    | 'throw'
    | 'landed_then_conflict'
    | 'handler_rethrow';

  const mkStep = (n: number, over: Record<string, unknown> = {}) => {
    const tool = `tool${n}`;
    const args = { id: n };
    return {
      step_id: `s${n}`,
      order: n,
      tool,
      arguments: args,
      label: `Paso ${n}`,
      args_hash: writeBatchArgsHash(tool, args),
      preview_hash: 'p',
      tool_version: '1',
      preview: { status: 'ok', target: 't', changes: [] },
      affected_records: 1,
      compensable: false,
      status: 'pending',
      ...over,
    };
  };

  function build(
    opts: {
      steps?: any[];
      claimCount?: number;
      behaviors?: Record<string, Behavior>;
      compensate?: Record<string, any>;
      persistThrowsOnRunning?: boolean;
      auditThrows?: boolean;
      /** The handler (registry `executeTool`) throws this for the tool. */
      toolErrors?: Record<string, Error>;
    } = {},
  ) {
    const steps = opts.steps ?? [mkStep(1), mkStep(2), mkStep(3)];
    const row = {
      id: 'b1',
      store_id: STORE,
      organization_id: ORG,
      user_id: USER,
      conversation_id: 9,
      goal: 'Subir precios',
      status: 'proposed',
      steps,
    };
    let claimed = false;
    let threw = false;
    const updateMany = jest.fn(async (args: any) => {
      if (args.where.status === 'proposed') {
        const count = opts.claimCount ?? 1;
        claimed = count > 0;
        return { count };
      }
      if (
        opts.persistThrowsOnRunning &&
        !threw &&
        Array.isArray(args.data?.steps) &&
        args.data.steps.some((s: any) => s.status === 'running')
      ) {
        threw = true;
        throw new Error('db down');
      }
      return { count: 1 };
    });
    const prisma = { ai_agent_write_batches: { updateMany } } as any;
    const view = { id: 'b1' };
    const batches = {
      loadOwned: jest.fn().mockResolvedValue(row),
      getView: jest.fn().mockResolvedValue(view),
    } as any;
    const executeTool = jest.fn(async (tool: string) => {
      const error = opts.toolErrors?.[tool];
      if (error) throw error;
      return '{"summary":"Listo"}';
    });
    const registry = {
      canonicalName: (n: string) => n,
      get: jest.fn((n: string) => ({ name: n, compensate: opts.compensate?.[n] })),
      executeTool,
    } as any;
    const confirmations = { issue: jest.fn().mockResolvedValue('tok') } as any;
    const planState = {
      applyDurableEffect: jest.fn(async (input: any, dispatch: () => Promise<string>) => {
        const behavior = opts.behaviors?.[input.tool] ?? 'ok';
        if (behavior === 'throw') throw new Error('ledger exploded');
        if (behavior === 'landed_then_conflict') {
          await dispatch();
          throw new ConflictException(
            'El resultado quedó en auditoría; el ejecutor ya fue reemplazado.',
          );
        }
        if (behavior === 'handler_rethrow') {
          // Mirrors applyDurableEffect: records the failure, rethrows as is.
          await dispatch();
          throw new Error('unreachable: the handler double always throws');
        }
        if (behavior === 'unknown') {
          return { output: '', result: { status: 'unknown_effect', effect_status: 'unknown' } };
        }
        if (behavior === 'fail') {
          return { output: '', result: { status: 'error', effect_status: 'not_applied' } };
        }
        const output = await dispatch();
        return { output, result: { status: 'ok', effect_status: 'applied' } };
      }),
    } as any;
    const activity = {
      recordApplied: jest.fn().mockResolvedValue(undefined),
      recordAppliedNarration: jest.fn().mockResolvedValue(undefined),
    } as any;
    const audit = {
      log: opts.auditThrows
        ? jest.fn().mockRejectedValue(new Error('audit down'))
        : jest.fn().mockResolvedValue(undefined),
    } as any;
    const access = { consumeAIQuota: jest.fn().mockResolvedValue(undefined) } as any;
    const service = new WriteBatchExecutorService(
      prisma,
      batches,
      registry,
      confirmations,
      planState,
      activity,
      audit,
      access,
    );
    return {
      service,
      updateMany,
      batches,
      executeTool,
      confirmations,
      planState,
      activity,
      audit,
      access,
      view,
      isClaimed: () => claimed,
    };
  }

  const run = <T>(fn: () => Promise<T>) =>
    RequestContextService.run(
      { organization_id: ORG, store_id: STORE, user_id: USER, roles: ['owner'] } as any,
      fn,
    ) as Promise<T>;

  const approve = (h: ReturnType<typeof build>, stepIds = ['s1', 's2', 's3']) =>
    run(() => h.service.approve({ batchId: 'b1', userId: USER, stepIds }));

  /** The finalize write: the only update that carries a summary. */
  const finalWrite = (h: ReturnType<typeof build>) => {
    const calls = h.updateMany.mock.calls.filter((c: any[]) => c[0].data?.summary);
    expect(calls).toHaveLength(1);
    return calls[0][0] as { where: any; data: any };
  };
  const statuses = (h: ReturnType<typeof build>) =>
    finalWrite(h).data.steps.map((s: any) => s.status);

  it('approves 3 steps in order and says "Se aplicaron los 3 cambios."', async () => {
    const h = build();
    const res = await approve(h);

    expect(res).toEqual({ batch: h.view, replayed: false });
    // Atomic claim: conditional on proposed + not expired.
    const claim = h.updateMany.mock.calls[0][0];
    expect(claim.where).toMatchObject({ id: 'b1', status: 'proposed' });
    expect(claim.where.expires_at.gt).toBeInstanceOf(Date);
    expect(claim.data).toMatchObject({ status: 'executing', approved_by_user_id: USER });

    expect(h.executeTool.mock.calls.map((c: any[]) => c[0])).toEqual(['tool1', 'tool2', 'tool3']);
    expect(h.executeTool).toHaveBeenCalledWith('tool1', { id: 1 }, { confirmationToken: 'tok' });
    expect(h.confirmations.issue).toHaveBeenCalledTimes(3);
    expect(h.planState.applyDurableEffect).toHaveBeenCalledWith(
      expect.objectContaining({ stepId: 'vex-batch:b1:s1', batchId: 'b1', conversationId: 9 }),
      expect.any(Function),
    );
    const fin = finalWrite(h);
    expect(fin.where).toEqual({ id: 'b1', status: 'executing' });
    expect(fin.data.status).toBe('applied');
    expect(fin.data.summary).toMatchObject({
      applied: 3,
      failed: 0,
      applied_through_order: 3,
      message: 'Se aplicaron los 3 cambios.',
    });
    expect(statuses(h)).toEqual(['applied', 'applied', 'applied']);
    expect(fin.data.steps[0]).toMatchObject({
      operation_id: 'vex-batch:b1:s1',
      result_summary: 'Listo',
    });
  });

  it('step 3 fails: partially_applied, message "Se aplicó hasta el paso 2, el resto se omitió."', async () => {
    const steps = [mkStep(1), mkStep(2), mkStep(3), mkStep(4)];
    const h = build({ steps, behaviors: { tool3: 'fail' } });
    await approve(h, ['s1', 's2', 's3', 's4']);
    const fin = finalWrite(h);
    expect(fin.data.status).toBe('partially_applied');
    expect(statuses(h)).toEqual(['applied', 'applied', 'failed', 'skipped']);
    expect(fin.data.summary.message).toBe('Se aplicó hasta el paso 2, el resto se omitió.');
    expect(fin.data.summary).toMatchObject({ applied: 2, failed: 1, skipped: 1, applied_through_order: 2 });
    // Step 4 never ran.
    expect(h.executeTool.mock.calls.map((c: any[]) => c[0])).toEqual(['tool1', 'tool2']);
    expect(fin.data.steps[2].error).toEqual(expect.any(String));
  });

  it('first step fails: failed, "No se aplicó ningún cambio."', async () => {
    const h = build({ behaviors: { tool1: 'fail' } });
    await approve(h);
    const fin = finalWrite(h);
    expect(fin.data.status).toBe('failed');
    expect(statuses(h)).toEqual(['failed', 'skipped', 'skipped']);
    expect(fin.data.summary.message).toBe('No se aplicó ningún cambio.');
    expect(h.executeTool).not.toHaveBeenCalled();
  });

  it('unknown effect: unknown_effect status, the rest skipped', async () => {
    const h = build({ behaviors: { tool2: 'unknown' } });
    await approve(h);
    const fin = finalWrite(h);
    expect(fin.data.status).toBe('unknown_effect');
    expect(statuses(h)).toEqual(['applied', 'unknown', 'skipped']);
    expect(fin.data.summary.message).toBe(
      'El paso 2 quedó sin verificar; revisa antes de reintentar. El resto se omitió.',
    );
  });

  it('a step whose dispatch throws fails with a human message and stops the batch', async () => {
    const h = build({ behaviors: { tool2: 'throw' } });
    await approve(h);
    const fin = finalWrite(h);
    expect(fin.data.status).toBe('partially_applied');
    expect(statuses(h)).toEqual(['applied', 'failed', 'skipped']);
    expect(fin.data.steps[1].error).toBe(BATCH_STEP_MESSAGES.generic);
  });

  describe('P1-1 — the write landed and the ledger threw afterwards', () => {
    it('first step: unknown, batch unknown_effect, snapshot kept, never "ningún cambio"', async () => {
      const capture = jest.fn().mockResolvedValue({ prev: 100 });
      const h = build({
        behaviors: { tool1: 'landed_then_conflict' },
        compensate: { tool1: { label: 'u', capture, undo: jest.fn() } },
      });
      await approve(h);
      const fin = finalWrite(h);

      // landed = ['tool1']: the business write ran exactly once.
      expect(h.executeTool.mock.calls.map((c: any[]) => c[0])).toEqual(['tool1']);
      expect(statuses(h)).toEqual(['unknown', 'skipped', 'skipped']);
      expect(fin.data.status).toBe('unknown_effect');
      expect(fin.data.steps[0].error).toBe(USER_NOTICES.unknown_effect);
      // The undo snapshot survives for the review (undo itself stays closed:
      // the view only offers it for `applied` steps).
      expect(fin.data.steps[0].compensation_snapshot).toEqual({ prev: 100 });
      expect(fin.data.steps[0].compensation_output).toBe('{"summary":"Listo"}');
      expect(fin.data.summary).toMatchObject({ applied: 0, failed: 0, unknown: 1, skipped: 2 });
      expect(fin.data.summary.message).toBe(
        'El paso 1 quedó sin verificar; revisa antes de reintentar. El resto se omitió.',
      );
      expect(fin.data.summary.message).not.toContain('No se aplicó ningún cambio');
    });

    it('mid-batch: the applied step stays applied, the landed one is unknown', async () => {
      const h = build({ behaviors: { tool2: 'landed_then_conflict' } });
      await approve(h);
      const fin = finalWrite(h);
      expect(h.executeTool.mock.calls.map((c: any[]) => c[0])).toEqual(['tool1', 'tool2']);
      expect(statuses(h)).toEqual(['applied', 'unknown', 'skipped']);
      expect(fin.data.status).toBe('unknown_effect');
      expect(fin.data.summary.message).toBe(
        'El paso 2 quedó sin verificar; revisa antes de reintentar. El resto se omitió.',
      );
    });

    it('a handler that throws a known error and is rethrown as is stays failed (permission lost)', async () => {
      const h = build({
        behaviors: { tool2: 'handler_rethrow' },
        toolErrors: { tool2: new VendixHttpException(ErrorCodes.AI_AGENT_004) },
      });
      await approve(h);
      const fin = finalWrite(h);
      expect(statuses(h)).toEqual(['applied', 'failed', 'skipped']);
      expect(fin.data.steps[1].error).toBe(BATCH_STEP_MESSAGES.permission_lost);
      expect(fin.data.status).toBe('partially_applied');
      expect(fin.data.summary.message).toBe('Se aplicó hasta el paso 1, el resto se omitió.');
    });
  });

  describe('double approval', () => {
    it('losing the claim replays: nothing executes, issues or audits', async () => {
      const h = build({ claimCount: 0 });
      const res = await approve(h);
      expect(res).toEqual({ batch: h.view, replayed: true });
      expect(h.executeTool).not.toHaveBeenCalled();
      expect(h.confirmations.issue).not.toHaveBeenCalled();
      expect(h.planState.applyDurableEffect).not.toHaveBeenCalled();
      expect(h.audit.log).not.toHaveBeenCalled();
      expect(h.access.consumeAIQuota).not.toHaveBeenCalled();
      expect(h.activity.recordApplied).not.toHaveBeenCalled();
      expect(h.updateMany).toHaveBeenCalledTimes(1);
      expect(h.batches.getView).toHaveBeenCalledWith('b1', USER);
    });

    it('two simultaneous approvals with a single winning claim run each step once', async () => {
      const h = build();
      // First claim wins, second loses (like the DB's conditional update).
      let won = false;
      const original = h.updateMany.getMockImplementation()!;
      h.updateMany.mockImplementation(async (args: any) => {
        if (args.where.status === 'proposed') {
          if (won) return { count: 0 };
          won = true;
          return { count: 1 };
        }
        return original(args);
      });
      const [a, b] = await Promise.all([approve(h), approve(h)]);
      expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
      expect(h.executeTool).toHaveBeenCalledTimes(3);
      expect(h.access.consumeAIQuota).toHaveBeenCalledTimes(1);
    });
  });

  it('unticked steps become unselected and never run', async () => {
    const h = build();
    await approve(h, ['s1', 's3']);
    const fin = finalWrite(h);
    expect(statuses(h)).toEqual(['applied', 'unselected', 'applied']);
    expect(h.executeTool.mock.calls.map((c: any[]) => c[0])).toEqual(['tool1', 'tool3']);
    expect(fin.data.summary).toMatchObject({ applied: 2, unselected: 1, message: 'Se aplicaron los 2 cambios.' });
    expect(fin.data.status).toBe('applied');
  });

  it('empty selection: rejected, steps cancelled, nothing runs', async () => {
    const h = build();
    const res = await approve(h, []);
    expect(res.replayed).toBe(false);
    const fin = finalWrite(h);
    expect(fin.data.status).toBe('rejected');
    expect(statuses(h)).toEqual(['cancelled', 'cancelled', 'cancelled']);
    expect(fin.data.summary.message).toBe('No se aplicó ningún cambio.');
    expect(h.executeTool).not.toHaveBeenCalled();
    expect(h.confirmations.issue).not.toHaveBeenCalled();
    expect(h.access.consumeAIQuota).not.toHaveBeenCalled();
    expect(h.audit.log).not.toHaveBeenCalled();
  });

  it('unknown step ids in the selection are ignored (stored steps are the only truth)', async () => {
    const h = build();
    await approve(h, ['s1', 'evil', 's2', 's3']);
    expect(h.executeTool).toHaveBeenCalledTimes(3);
  });

  it('an exception in persistence mid-run leaves no step running or pending', async () => {
    const h = build({ persistThrowsOnRunning: true });
    const res = await approve(h);
    expect(res.replayed).toBe(false);
    const st = statuses(h);
    expect(st).not.toContain('running');
    expect(st).not.toContain('pending');
    expect(st).toEqual(['failed', 'skipped', 'skipped']);
    expect(finalWrite(h).data.status).toBe('failed');
    expect(h.executeTool).not.toHaveBeenCalled();
  });

  it('tampered arguments (args_hash mismatch): step failed, tool not executed', async () => {
    const tampered = mkStep(2, { arguments: { id: 999 } });
    const h = build({ steps: [mkStep(1), tampered, mkStep(3)] });
    await approve(h);
    const fin = finalWrite(h);
    expect(statuses(h)).toEqual(['applied', 'failed', 'skipped']);
    expect(fin.data.steps[1].error).toBe(BATCH_STEP_MESSAGES.args_mismatch);
    expect(fin.data.status).toBe('partially_applied');
    expect(h.executeTool.mock.calls.map((c: any[]) => c[0])).toEqual(['tool1']);
    expect(h.confirmations.issue).toHaveBeenCalledTimes(1);
  });

  it('captures a compensation snapshot only for compensable tools and keeps it server-side', async () => {
    const capture = jest.fn().mockResolvedValue({ prev: 100 });
    const h = build({ compensate: { tool1: { label: 'u', capture, undo: jest.fn() } } });
    await approve(h);
    const fin = finalWrite(h);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(fin.data.steps[0]).toMatchObject({ compensable: true, compensation_snapshot: { prev: 100 } });
    expect(fin.data.steps[1].compensable).toBe(false);
    expect(fin.data.summary.compensable).toBe(1);
  });

  describe('reject', () => {
    it('cancels the steps; a second reject is a replay', async () => {
      const h = build();
      const first = await run(() => h.service.reject({ batchId: 'b1', userId: USER }));
      expect(first.replayed).toBe(false);
      const call = h.updateMany.mock.calls[0][0];
      expect(call.where).toEqual({ id: 'b1', status: 'proposed' });
      expect(call.data.status).toBe('rejected');
      expect(call.data.steps.map((s: any) => s.status)).toEqual(['cancelled', 'cancelled', 'cancelled']);

      h.updateMany.mockResolvedValueOnce({ count: 0 });
      const second = await run(() => h.service.reject({ batchId: 'b1', userId: USER }));
      expect(second.replayed).toBe(true);
      expect(h.executeTool).not.toHaveBeenCalled();
    });
  });

  describe('T38 audit, receipts and metering', () => {
    it('writes one audit row with batch_id, source ai_agent and per-step statuses', async () => {
      const h = build({ behaviors: { tool3: 'fail' } });
      await approve(h);
      expect(h.audit.log).toHaveBeenCalledTimes(1);
      const entry = h.audit.log.mock.calls[0][0];
      expect(entry).toMatchObject({
        userId: USER,
        storeId: STORE,
        organizationId: ORG,
        action: AI_WRITE_BATCH_EXECUTED,
      });
      expect(entry.metadata).toMatchObject({
        batch_id: 'b1',
        source: 'ai_agent',
        agent_key: 'vex',
        status: 'partially_applied',
        applied_count: 2,
      });
      expect(entry.metadata.steps.map((s: any) => [s.order, s.status])).toEqual([
        [1, 'applied'],
        [2, 'applied'],
        [3, 'failed'],
      ]);
    });

    it('records one receipt per APPLIED step attributed to vex', async () => {
      const h = build({ behaviors: { tool3: 'fail' } });
      await approve(h);
      expect(h.activity.recordApplied).toHaveBeenCalledTimes(2);
      expect(h.activity.recordApplied).toHaveBeenCalledWith(
        expect.objectContaining({ tool: 'tool1', args: { id: 1 }, agent_key: 'vex', conversationId: 9 }),
      );
      expect(h.activity.recordApplied).toHaveBeenCalledWith(
        expect.objectContaining({ tool: 'tool2', agent_key: 'vex' }),
      );
      expect(h.activity.recordAppliedNarration).toHaveBeenCalledWith({
        conversationId: 9,
        summary: 'Se aplicó hasta el paso 2, el resto se omitió.',
      });
    });

    it('consumes the vex_agent quota exactly once (1 unit, per-batch request id), no per-step quota', async () => {
      const h = build();
      await approve(h);
      expect(h.access.consumeAIQuota).toHaveBeenCalledTimes(1);
      expect(h.access.consumeAIQuota).toHaveBeenCalledWith(STORE, 'vex_agent', 1, 'vex-batch:b1:turn');
      expect(writeBatchQuotaRequestId('b1')).toBe('vex-batch:b1:turn');
    });

    it('consumes no quota and writes no receipts when nothing applied', async () => {
      const h = build({ behaviors: { tool1: 'fail' } });
      await approve(h);
      expect(h.access.consumeAIQuota).not.toHaveBeenCalled();
      expect(h.activity.recordApplied).not.toHaveBeenCalled();
    });

    it('an audit failure does not throw and the batch still finalizes', async () => {
      const h = build({ auditThrows: true });
      const res = await approve(h);
      expect(res.replayed).toBe(false);
      expect(finalWrite(h).data.status).toBe('applied');
      expect(h.access.consumeAIQuota).toHaveBeenCalledTimes(1);
    });

    it('a metering failure does not throw', async () => {
      const h = build();
      h.access.consumeAIQuota.mockRejectedValue(new Error('redis down'));
      await expect(approve(h)).resolves.toMatchObject({ replayed: false });
      expect(h.audit.log).toHaveBeenCalledTimes(1);
    });
  });

  describe('pure helpers', () => {
    it('writeBatchTerminalStatus', () => {
      const s = (...st: string[]) => st.map((status) => ({ status })) as any;
      expect(writeBatchTerminalStatus(s('applied', 'applied'))).toBe('applied');
      expect(writeBatchTerminalStatus(s('applied', 'failed', 'skipped'))).toBe('partially_applied');
      expect(writeBatchTerminalStatus(s('failed', 'skipped'))).toBe('failed');
      expect(writeBatchTerminalStatus(s('applied', 'unknown', 'failed'))).toBe('unknown_effect');
      expect(writeBatchTerminalStatus(s('unselected', 'unselected'))).toBe('failed');
    });
    it('summarizeWriteBatch single-step wording', () => {
      expect(
        summarizeWriteBatch([{ order: 1, status: 'applied', compensable: false }]).message,
      ).toBe('Se aplicó el cambio.');
    });
  });
});
