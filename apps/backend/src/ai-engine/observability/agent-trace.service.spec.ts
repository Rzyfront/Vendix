import { Logger } from '@nestjs/common';
import {
  AgentTraceService,
  hashTraceValue,
  normalizeRequestId,
  redactTraceAttributes,
} from './agent-trace.service';

const tenant = (store_id = 1) => ({
  kind: 'tenant' as const,
  organization_id: 7,
  store_id,
  user_id: 9,
  surface: 'text',
  agent: 'vexi',
});
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('AgentTraceService (bounded explicit-scope observability)', () => {
  let service: AgentTraceService;
  let upsert: jest.Mock;
  let records: Map<string, Record<string, any>>;

  beforeEach(() => {
    records = new Map();
    upsert = jest.fn(async ({ where, create, update }) => {
      const row = records.has(where.span_id)
        ? { ...records.get(where.span_id), ...update }
        : { ...create };
      records.set(where.span_id, row);
      return row;
    });
    service = new AgentTraceService({
      ai_agent_trace_spans: { upsert },
    } as any);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    await service.onModuleDestroy();
    jest.restoreAllMocks();
  });

  it('rejects incomplete, zero, and mixed system/tenant authority rather than falling back', async () => {
    expect(
      service.startTrace({ kind: 'tenant', organization_id: 7 } as any),
    ).toBeUndefined();
    expect(service.startTrace(tenant(0))).toBeUndefined();
    expect(
      service.startTrace({
        kind: 'system',
        system_purpose: 'evaluation',
        store_id: 8,
      } as any),
    ).toBeUndefined();
    expect(service.startSpan('context')).toBeUndefined();
    await service.flush();
    expect(upsert).not.toHaveBeenCalled();
    expect(Logger.prototype.error).toHaveBeenCalledWith(
      expect.stringContaining('AI_AGENT_TRACE_LOSS'),
    );
  });

  it('copies and freezes authenticated scope without retaining secrets or raw external ids', async () => {
    const scope = {
      ...tenant(),
      request_id: 'external-secret-request',
      turn_id: 'external-turn',
      access_token: 'Bearer secret',
      email: 'person@example.com',
    };
    const root = service.startTrace(scope)!;
    scope.store_id = 42;
    expect(root.scope.store_id).toBe(1);
    expect(Object.isFrozen(root.scope)).toBe(true);
    expect(root.scope).not.toHaveProperty('email');
    expect(root.scope.request_id).toMatch(/^[a-f0-9-]{36}$/);
    expect(root.scope.turn_id).toMatch(/^[a-f0-9-]{36}$/);
    service.finishTrace(root, 'partial');
    await service.flush();
    const row = records.get(root.span_id)!;
    expect(row.attributes.external_request_id_hash).toBe(
      hashTraceValue('external-secret-request'),
    );
    expect(JSON.stringify([...records.values()])).not.toContain(
      'external-secret-request',
    );
    expect(JSON.stringify([...records.values()])).not.toContain(
      'Bearer secret',
    );
  });

  it('runs overlapping tenant scopes in isolated ALS and clears context outside each run', async () => {
    const a = service.startTrace(tenant(1))!;
    const b = service.startTrace(tenant(2))!;
    const contexts = await Promise.all(
      [a, b].map((root) =>
        service.run(root, async () => {
          await tick();
          expect(service.currentSpan()).toBe(root);
          const child = service.startSpan('context')!;
          await service.run(child, async () => {
            await tick();
            expect(service.currentTraceContext()?.trace_id).toBe(root.trace_id);
            expect(service.currentSpan()?.scope.store_id).toBe(
              root.scope.store_id,
            );
          });
          service.endSpan(child);
          return service.currentTraceContext();
        }),
      ),
    );
    expect(contexts[0]?.trace_id).not.toBe(contexts[1]?.trace_id);
    expect(service.currentSpan()).toBeUndefined();
    expect(service.currentTraceContext()).toBeUndefined();
    service.finishTrace(a, 'partial');
    service.finishTrace(b, 'partial');
    await service.flush();
    expect(records.size).toBe(4);
    for (const row of records.values())
      expect(row.store_id).toBe(row.trace_id === a.trace_id ? 1 : 2);
  });

  it('run(undefined) does not inherit the parent and closed spans are not reused', () => {
    const root = service.startTrace(tenant())!;
    service.run(root, () => {
      expect(
        service.run(undefined, () => service.currentSpan()),
      ).toBeUndefined();
      service.finishTrace(root, 'partial');
      expect(service.currentSpan()).toBeUndefined();
      expect(service.currentTraceContext()).toBeUndefined();
      expect(service.startSpan('tool', {}, root)).toBeUndefined();
    });
  });

  it('restores ALS for every generator advance and closes a normally consumed root conservatively', async () => {
    const root = service.startTrace(tenant())!;
    const other = service.startTrace(tenant(2))!;
    const generator = service.runGenerator(root, async function* () {
      expect(service.currentSpan()).toBe(root);
      await tick();
      yield 1;
      expect(service.currentSpan()).toBe(root);
      yield 2;
    });
    await service.run(other, async () => {
      expect((await generator.next()).value).toBe(1);
      expect(service.currentSpan()).toBe(other);
      expect((await generator.next()).value).toBe(2);
      expect((await generator.next()).done).toBe(true);
      expect(service.currentSpan()).toBe(other);
    });
    await service.flush();
    expect(records.get(root.span_id)?.outcome).toBe('partial');
    expect(records.get(root.span_id)?.status).toBe('ok');
    expect(service.currentSpan()).toBeUndefined();
  });

  it('closes root and unfinished descendants on generator failure without saving exception bodies', async () => {
    const root = service.startTrace(tenant())!;
    const generator = service.runGenerator(root, async function* () {
      service.startSpan('provider_call');
      yield 1;
      throw new Error('Bearer secret, customer invoice body');
    });
    await generator.next();
    await expect(generator.next()).rejects.toThrow('Bearer secret');
    await service.flush();
    expect(records.get(root.span_id)?.outcome).toBe('failed');
    expect([...records.values()].every((row) => row.status === 'error')).toBe(
      true,
    );
    expect(
      [...records.values()].every((row) => row.ended_at instanceof Date),
    ).toBe(true);
    expect(JSON.stringify([...records.values()])).not.toContain(
      'Bearer secret',
    );
    expect(service.getHealth().active_spans).toBe(0);
  });

  it('closes root/children and upstream finally on consumer cancellation', async () => {
    const root = service.startTrace(tenant())!;
    let finalized = false;
    const generator = service.runGenerator(root, async function* () {
      try {
        service.startSpan('ui_wait');
        yield 1;
        yield 2;
      } finally {
        finalized = true;
        expect(service.currentTraceContext()?.trace_id).toBe(root.trace_id);
      }
    });
    await generator.next();
    await generator.return(undefined);
    await service.flush();
    expect(finalized).toBe(true);
    expect(records.get(root.span_id)?.outcome).toBe('cancelled');
    expect(
      [...records.values()].every((row) => row.status === 'cancelled'),
    ).toBe(true);
    expect(service.getHealth().active_spans).toBe(0);
  });

  it('propagates a consumer throw and closes its trace as failed', async () => {
    const root = service.startTrace(tenant())!;
    const generator = service.runGenerator(root, async function* () {
      yield 1;
      yield 2;
    });
    await generator.next();
    await expect(generator.throw(new Error('consumer error'))).rejects.toThrow(
      'consumer error',
    );
    await service.flush();
    expect(records.get(root.span_id)?.outcome).toBe('failed');
  });

  it('forwards consumer throws to source recovery/finally under the same ALS', async () => {
    const root = service.startTrace(tenant())!;
    const injected = new Error('recoverable consumer error');
    let finalized = false;
    const generator = service.runGenerator(root, async function* () {
      try {
        try {
          yield 1;
        } catch (error) {
          expect(error).toBe(injected);
          expect(service.currentSpan()).toBe(root);
          await tick();
          yield 2;
        }
        return 42;
      } finally {
        finalized = true;
        expect(service.currentSpan()).toBe(root);
      }
    });
    expect(await generator.next()).toEqual({ value: 1, done: false });
    expect(await generator.throw(injected)).toEqual({ value: 2, done: false });
    expect(finalized).toBe(false);
    expect(await generator.next()).toEqual({ value: 42, done: true });
    expect(finalized).toBe(true);
    await service.flush();
    expect(records.get(root.span_id)?.outcome).toBe('partial');
    expect(records.get(root.span_id)?.status).toBe('ok');
  });

  it('keeps usage null when unknown and counts cost canonically once per provider attempt', async () => {
    const root = service.startTrace(tenant())!;
    const call = service.startSpan('provider_call', {}, root)!;
    const failed = service.startSpan('provider_attempt', {}, call)!;
    service.endSpan(failed, { status: 'error', error_code: 'AI_REQUEST_001' });
    const retry = service.startSpan(
      'provider_retry',
      { retry_source: 'sdk' },
      call,
    )!;
    service.endSpan(retry);
    const success = service.startSpan('provider_attempt', {}, call)!;
    service.endSpan(success, {
      usage: { prompt_tokens: 12, completion_tokens: 4, cache_read_tokens: 0 },
      cost_usd: 0.001,
    });
    service.endSpan(success, { cost_usd: 42 }); // idempotent close; must not duplicate/change a receipt.
    service.endSpan(call, { cost_usd: 0.001 });
    service.finishTrace(root, 'partial', { cost_usd: 0.001 });
    await service.flush();
    expect(records.get(failed.span_id)?.prompt_tokens).toBeNull();
    expect(records.get(failed.span_id)?.cost_usd).toBeNull();
    expect(records.get(success.span_id)).toMatchObject({
      provider_call_id: call.span_id,
      attempt_id: success.span_id,
      prompt_tokens: 12,
      cache_read_tokens: 0,
      cache_creation_tokens: null,
    });
    expect(
      [...records.values()].reduce((sum, row) => sum + (row.cost_usd ?? 0), 0),
    ).toBe(0.001);
    expect(records.get(root.span_id)?.cost_usd).toBeNull();
    expect(records.get(call.span_id)?.cost_usd).toBeNull();
  });

  it('only an explicit verifier outcome can mark a root completed_verified, not resolved tools', async () => {
    const root = service.startTrace(tenant())!;
    const tool = service.startSpan(
      'tool',
      {
        tool_call_id: 'call_external',
        tool_name_hash: hashTraceValue('list_orders'),
      },
      root,
    )!;
    service.endSpan(tool);
    service.finishTrace(root, 'awaiting_approval');
    await service.flush();
    expect(records.get(root.span_id)?.outcome).toBe('awaiting_approval');
    expect(records.get(tool.span_id)?.tool_call_id).toBe(
      normalizeRequestId('call_external'),
    );
    expect(records.get(tool.span_id)?.attributes.tool_call_id_hash).toBe(
      hashTraceValue('call_external'),
    );
  });

  it('requires an explicit system namespace and never makes it a tenant record', async () => {
    const root = service.startTrace({
      kind: 'system',
      system_purpose: 'evaluation',
      surface: 'eval',
    })!;
    service.finishTrace(root, 'partial');
    await service.flush();
    expect(records.get(root.span_id)).toMatchObject({
      scope_kind: 'system',
      system_purpose: 'evaluation',
      organization_id: null,
      store_id: null,
      user_id: null,
    });
  });

  it('drops unknown keys, free text and invalid numbers from metadata allowlist', () => {
    expect(
      redactTraceAttributes({
        access_token: 'Bearer secret',
        prompt: 'Customer name',
        invoice: {},
        audio: 'base64',
        error_message: 'PII',
        tool_count: 2,
        definition_tokens: null,
        context_tokens: -1,
        catalog_hash: hashTraceValue('catalog'),
        prompt_hash: 'not-hash',
        stop_reason: 'end_turn',
        result_bytes: Infinity,
        billable: 'unknown',
        context_budget_source: 'fallback',
        estimation_method: 'conservative_estimate',
        cost_measurement: 'estimated',
        estimated_cost_microusd: 120,
        context_window_tokens: 32768,
        estimated_output_tokens: 512,
        omitted_messages: 2,
      }),
    ).toEqual({
      tool_count: 2,
      definition_tokens: null,
      catalog_hash: hashTraceValue('catalog'),
      stop_reason: 'end_turn',
      billable: 'unknown',
      context_budget_source: 'fallback',
      estimation_method: 'conservative_estimate',
      cost_measurement: 'estimated',
      estimated_cost_microusd: 120,
      context_window_tokens: 32768,
      estimated_output_tokens: 512,
      omitted_messages: 2,
    });
  });

  it('normalizes synthetic ids deterministically without exposing their original text', () => {
    const valid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    expect(normalizeRequestId(valid)).toBe(valid);
    expect(normalizeRequestId('secret')).toMatch(
      /^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
    );
    expect(normalizeRequestId('secret')).toBe(normalizeRequestId('secret'));
    expect(normalizeRequestId()).not.toBe(normalizeRequestId());
  });

  it('does not await database writes on business paths and bounds outage memory/in-flight writes', async () => {
    let release!: () => void;
    upsert.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const root = service.startTrace(tenant())!;
    await tick();
    for (let i = 0; i < 800; i++) {
      const child = service.startSpan('context', { round: i }, root);
      service.endSpan(child);
    }
    service.finishTrace(root, 'partial');
    expect(service.getHealth().queued_spans).toBeLessThanOrEqual(512);
    expect(service.getHealth().dropped_spans).toBeGreaterThan(0);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(await service.flush(5)).toBe(false);
    release();
    expect(await service.flush()).toBe(true);
    expect(Logger.prototype.error).toHaveBeenCalledWith(
      expect.stringContaining('AI_AGENT_TRACE_LOSS'),
    );
  });

  it('alarms on failed writes without surfacing errors or exposing driver secrets', async () => {
    upsert.mockRejectedValue(new Error('secret database URL and Bearer token'));
    const root = service.startTrace(tenant())!;
    service.finishTrace(root, 'partial');
    await expect(service.flush()).resolves.toBe(true);
    expect(service.getHealth().write_failures).toBeGreaterThan(0);
    expect(Logger.prototype.error).toHaveBeenCalledWith(
      expect.stringContaining('reason=write_failed'),
    );
    expect(
      JSON.stringify((Logger.prototype.error as jest.Mock).mock.calls),
    ).not.toContain('database URL');
  });
});
