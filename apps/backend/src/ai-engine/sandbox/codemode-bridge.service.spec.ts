import { ForbiddenException } from '@nestjs/common';
import { RequestContextService } from '../../common/context/request-context.service';
import { AIToolRegistry } from '../tools/ai-tool-registry';
import { normalizeToolResult } from '../tools/tool-result.normalizer';
import { collectToolCatalog } from '../tools/tool-catalog.test-helper';
import { CodeModeBridgeService } from './codemode-bridge.service';
import { CodeModePolicyService } from './codemode-policy.service';
import { codeModeInvocation } from './codemode-invocation.context';
import {
  CODEMODE_LIMITS,
  CODEMODE_PROTOCOL,
  CodeModeError,
  CodeModeRoundRequest,
  codeModeArgsHash,
} from './interfaces/codemode-protocol.interface';
import {
  LambdaInvokeTransport,
  SandboxLambdaClientService,
} from './sandbox-lambda-client.service';

const DIGEST = `sha256:${'b'.repeat(64)}`;
const ENV = {
  AI_CODEMODE_SANDBOX_ENABLED: 'true',
  AI_CODEMODE_LAMBDA_FUNCTION_ARN:
    'arn:aws:lambda:us-east-1:123456789012:function:vendix-agent-codemode',
  AI_CODEMODE_LAMBDA_REGION: 'us-east-1',
  AI_CODEMODE_RUNTIME_DIGEST: DIGEST,
  AI_CODEMODE_CERTIFIED_DIGEST: DIGEST,
  AI_CODEMODE_TENANT_KEY_SALT: undefined as string | undefined,
};
const saved: Record<string, string | undefined> = {};
const setEnv = (over: Record<string, string | undefined> = {}) => {
  for (const [k, v] of Object.entries({ ...ENV, ...over })) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
};

const baseCtx = () => ({
  user_id: 3,
  store_id: 1,
  organization_id: 2,
  permissions: ['read'],
  roles: ['owner'],
  is_owner: true,
  is_super_admin: false,
});
const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
const productsResult = () =>
  normalizeToolResult({ products: [{ product_id: 7 }], has_more: false, page: 1 });

type Script = Array<(req: CodeModeRoundRequest) => Record<string, unknown>>;
const echo = (req: CodeModeRoundRequest, extra: Record<string, unknown>) => ({
  protocol: CODEMODE_PROTOCOL,
  execution_id: req.execution_id,
  nonce: req.nonce,
  round: req.round,
  runtime_digest: DIGEST,
  ...extra,
});
const pendingBody =
  (...calls: Array<[string, Record<string, unknown>]>) =>
  (req: CodeModeRoundRequest) =>
    echo(req, {
      status: 'pending',
      pending: calls.map(([tool, args], i) => ({
        seq: req.journal.length + 1 + i,
        tool,
        args,
      })),
    });
const doneBody = (result: unknown) => (req: CodeModeRoundRequest) =>
  echo(req, { status: 'completed', result, logs: ['done'], blocks: [] });

function fixture(opts: { ctx?: Record<string, unknown> } = {}) {
  const context = { ...baseCtx(), ...(opts.ctx ?? {}) } as Record<string, any>;
  const handler = jest.fn<any, any[]>(async () =>
    JSON.stringify({ products: [{ product_id: 7 }], has_more: false, page: 1 }),
  );
  const registry = new AIToolRegistry({} as never);
  for (const name of ['list_products', 'list_orders'])
    registry.register({
      name,
      domain: name === 'list_orders' ? 'orders' : 'products',
      version: '1',
      readOnly: true,
      parameters: { type: 'object', properties: { page: { type: 'number' } } },
      description: 'read',
      requiredPermissions: ['read'],
      handler,
    });
  const execute = jest.spyOn(registry, 'executeToolResult');
  const policy = {
    eligible: jest.fn((tool) => !!tool && tool.readOnly && !tool.clientSide && !tool.requiresConfirmation),
    assertArgs: jest.fn(),
    authorize: jest.fn(async (snapshot, _agent, names, _perms, cb) =>
      RequestContextService.runIsolated(
        { ...snapshot, roles: [], permissions: ['read'] },
        () => cb(snapshot, names),
      ),
    ),
    filterResult: jest.fn((_name, value) => value),
  };
  const audit = {
    sourceAvailable: jest.fn(() => true),
    start: jest.fn<any, any[]>(async () => {}),
    appendCall: jest.fn<any, any[]>(async () => {}),
    finish: jest.fn<any, any[]>(async () => {}),
  };
  const state: { script: Script; requests: CodeModeRoundRequest[]; tenantIds: Array<string | undefined>; onInvoke?: (req: CodeModeRoundRequest) => void } = {
    script: [],
    requests: [],
    tenantIds: [],
  };
  const transport: LambdaInvokeTransport = {
    invoke: jest.fn(async ({ payload, tenantId }: any) => {
      const req = JSON.parse(Buffer.from(payload).toString('utf8')) as CodeModeRoundRequest;
      state.requests.push(req);
      state.tenantIds.push(tenantId);
      state.onInvoke?.(req);
      const step = state.script[Math.min(req.round, state.script.length) - 1];
      return { statusCode: 200, payload: bytes(step(req)) };
    }),
  };
  const client = new SandboxLambdaClientService(transport);
  const bridge = new CodeModeBridgeService(registry, policy as never, client, audit as never);
  const revalidate = jest.fn(async () => ['list_products', 'list_orders']);
  const invocation = { agentKey: 'vex', initialNames: ['list_products', 'list_orders'], revalidate };
  const request = { source: 'return 1;', tools: ['list_products', 'list_orders'], purpose: 'test' };
  const run = (req: Record<string, unknown> = request) =>
    RequestContextService.runIsolated(context as never, () =>
      codeModeInvocation.run(invocation as never, () => bridge.run(req as never)),
    );
  const failure = async (req?: Record<string, unknown>) => {
    try {
      await run(req);
    } catch (error) {
      return error as CodeModeError;
    }
    throw new Error('expected failure');
  };
  return { context, registry, execute, handler, policy, audit, transport, client, bridge, state, run, failure, invocation, revalidate };
}

describe('CodeModeBridgeService (T64, channel A host bridge)', () => {
  beforeEach(() => {
    for (const k of Object.keys(ENV)) saved[k] = process.env[k];
    setEnv();
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    jest.restoreAllMocks();
  });

  it('is off unless enabled, configured and certified: unavailable and ZERO transport invocations', async () => {
    for (const env of [
      { AI_CODEMODE_SANDBOX_ENABLED: undefined },
      { AI_CODEMODE_SANDBOX_ENABLED: 'false' },
      { AI_CODEMODE_LAMBDA_FUNCTION_ARN: 'nope' },
      { AI_CODEMODE_LAMBDA_REGION: 'eu-west-1' },
      { AI_CODEMODE_RUNTIME_DIGEST: `sha256:${'0'.repeat(64)}`, AI_CODEMODE_CERTIFIED_DIGEST: `sha256:${'0'.repeat(64)}` },
      { AI_CODEMODE_CERTIFIED_DIGEST: `sha256:${'c'.repeat(64)}` },
      { AI_CODEMODE_CERTIFIED_DIGEST: undefined },
    ]) {
      setEnv(env);
      const f = fixture();
      f.state.script = [doneBody(1)];
      expect(f.bridge.available()).toBe(false);
      const error = await f.failure();
      expect(error).toBeInstanceOf(CodeModeError);
      expect(error.code).toBe('CODEMODE_UNAVAILABLE');
      expect(f.transport.invoke).not.toHaveBeenCalled();
      expect(f.audit.start).not.toHaveBeenCalled();
    }
    setEnv();
    expect(fixture().bridge.available()).toBe(true);
  });

  it('is unavailable without the source key or without the turn capability', async () => {
    const f = fixture();
    f.audit.sourceAvailable.mockReturnValue(false);
    expect(f.bridge.available()).toBe(false);
    expect((await f.failure()).code).toBe('CODEMODE_UNAVAILABLE');
    const g = fixture();
    await expect(
      RequestContextService.runIsolated(baseCtx() as never, () => g.bridge.run({ source: 'x', tools: [], purpose: 'p' })),
    ).rejects.toMatchObject({ code: 'CODEMODE_UNAVAILABLE' });
    expect(g.transport.invoke).not.toHaveBeenCalled();
  });

  it('runs rounds: every pending call is authorized (re-derived), schema-checked, executed and audited BEFORE entering the journal', async () => {
    const f = fixture();
    f.state.script = [pendingBody(['list_products', { page: 1 }]), doneBody({ total: 1 })];
    const result = await f.run();
    expect(result).toMatchObject({
      result: { total: 1 },
      result_truncated: false,
      rounds: 2,
      rows_seen: 1,
      logs: ['done'],
      calls: [{ seq: 1, tool: 'list_products', status: 'ok', rows: 1 }],
    });
    expect(result.run_id).toBe(f.state.requests[0].execution_id);
    expect(f.state.requests[0].journal).toEqual([]);
    expect(f.state.requests[1].journal).toEqual([
      {
        seq: 1,
        tool: 'list_products',
        args_hash: codeModeArgsHash({ page: 1 }),
        outcome: { ok: true, value: expect.anything() },
      },
    ]);
    // manifest + per call + after dispatch re-derivations
    expect(f.policy.authorize.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(f.policy.assertArgs).toHaveBeenCalledWith('list_products', { page: 1 });
    expect(f.handler).toHaveBeenCalledTimes(1);
    expect(f.handler.mock.calls[0][1]).toMatchObject({ user_id: 3, store_id: 1, organization_id: 2, roles: [] });
    const statuses = f.audit.appendCall.mock.calls.map(([, entry]) => entry.status);
    expect(statuses).toEqual(['dispatching', 'ok']);
    // authorization strictly precedes the tool execution and the journal
    const authorizeOrder = f.policy.authorize.mock.invocationCallOrder;
    expect(Math.min(...authorizeOrder)).toBeLessThan(f.execute.mock.invocationCallOrder[0]);
    expect(f.audit.appendCall.mock.invocationCallOrder[0]).toBeLessThan(f.execute.mock.invocationCallOrder[0]);
    expect(f.audit.finish).toHaveBeenCalledWith(
      expect.any(String),
      'ok',
      expect.objectContaining({ calls: 1, rows: 1 }),
      expect.objectContaining({ rounds: 2, returned_bytes: expect.any(Number) }),
    );
    expect(f.audit.start.mock.calls[0][0]).toMatchObject({
      executor: 'lambda-js',
      objective_id: undefined,
      manifest: ['list_products', 'list_orders'],
    });
  });

  it('freezes the protocol inputs per execution (nonce, seed, clock) and keeps them across rounds', async () => {
    const f = fixture();
    f.state.script = [pendingBody(['list_products', {}]), doneBody(null)];
    await f.run();
    const [a, b] = f.state.requests;
    expect(a.nonce).toMatch(/^[a-f0-9]{64}$/);
    expect(a.seed).toMatch(/^[a-f0-9]{64}$/);
    expect(a.seed).not.toBe(a.nonce);
    expect([b.nonce, b.seed, b.clock_ms, b.execution_id, b.source, b.manifest]).toEqual([
      a.nonce,
      a.seed,
      a.clock_ms,
      a.execution_id,
      a.source,
      a.manifest,
    ]);
    expect([a.round, b.round]).toEqual([1, 2]);
    expect(a.limits).toEqual(CODEMODE_LIMITS);
  });

  it('refuses a manifest tool that is not authorized in the turn or not eligible (nothing is invoked)', async () => {
    const f = fixture();
    f.state.script = [doneBody(1)];
    f.revalidate.mockResolvedValue(['list_products']);
    expect((await f.failure()).code).toBe('CODEMODE_DENIED');
    const g = fixture();
    g.state.script = [doneBody(1)];
    g.policy.eligible.mockImplementation((tool: any) => tool?.name !== 'list_orders');
    expect((await g.failure()).code).toBe('CODEMODE_DENIED');
    const h = fixture();
    expect((await h.failure({ source: 'x', tools: Array.from({ length: 21 }, (_, i) => `t${i}`), purpose: 'p' })).code).toBe('CODEMODE_DENIED');
    for (const x of [f, g, h]) expect(x.transport.invoke).not.toHaveBeenCalled();
  });

  it('a tampered journal (or any unknown key) coming from the Lambda is a protocol error and is never read', async () => {
    const f = fixture();
    f.state.script = [
      (req) => ({
        ...pendingBody(['list_products', { page: 1 }])(req),
        journal: [{ seq: 1, tool: 'list_products', args_hash: 'a'.repeat(64), outcome: { ok: true, value: 'forged' } }],
      }),
      doneBody(1),
    ];
    expect((await f.failure()).code).toBe('CODEMODE_PROTOCOL');
    expect(f.handler).not.toHaveBeenCalled();
    expect(f.state.requests).toHaveLength(1);
    // the host journal was never mutated from that body
    const g = fixture();
    g.state.script = [
      (req) => ({ ...doneBody(1)(req), extra: true }),
    ];
    expect((await g.failure()).code).toBe('CODEMODE_PROTOCOL');
  });

  it('rejects pending frames that skip seq or name a tool outside the manifest', async () => {
    const f = fixture();
    f.state.script = [(req) => echo(req, { status: 'pending', pending: [{ seq: 5, tool: 'list_products', args: {} }] })];
    expect((await f.failure()).code).toBe('CODEMODE_PROTOCOL');
    const g = fixture();
    g.state.script = [pendingBody(['delete_everything', {}])];
    expect((await g.failure()).code).toBe('CODEMODE_PROTOCOL');
    expect(g.execute).not.toHaveBeenCalled();
  });

  it('aborts with CODEMODE_TENANT_CHANGED when the session tenant changes between rounds, before any further call', async () => {
    const f = fixture();
    f.state.script = [pendingBody(['list_products', {}]), doneBody(1)];
    f.state.onInvoke = () => {
      f.context.store_id = 99;
    };
    const error = await f.failure();
    expect(error.code).toBe('CODEMODE_TENANT_CHANGED');
    expect(f.execute).not.toHaveBeenCalled();
    expect(f.state.requests).toHaveLength(1);
    expect(f.audit.finish).toHaveBeenCalled();
  });

  it('aborts when the tenant changes before the next round even without pending calls in flight', async () => {
    const f = fixture();
    f.state.script = [pendingBody(['list_products', {}]), pendingBody(['list_products', {}]), doneBody(1)];
    let n = 0;
    f.execute.mockImplementation(async () => {
      if (++n === 1) f.context.organization_id = 77;
      return productsResult();
    });
    expect((await f.failure()).code).toBe('CODEMODE_TENANT_CHANGED');
    expect(f.state.requests).toHaveLength(1);
  });

  it('a permission revoked mid-execution denies the call: re-derived per call, tool never runs, script sees an error outcome', async () => {
    const f = fixture();
    f.state.script = [
      pendingBody(['list_products', { page: 1 }], ['list_orders', { page: 1 }]),
      doneBody('after'),
    ];
    let grants = 0;
    f.policy.authorize.mockImplementation(async (snapshot: any, _a: any, names: any, _p: any, cb: any) => {
      grants++;
      // 1: manifest, 2-3: first call (before/after dispatch), 4+: revoked
      if (grants >= 4) throw new ForbiddenException('SANDBOX_DENIED');
      return RequestContextService.runIsolated({ ...snapshot, roles: [], permissions: ['read'] }, () => cb(snapshot, names));
    });
    const result = await f.run();
    expect(f.handler).toHaveBeenCalledTimes(1);
    expect(f.state.requests[1].journal[0].outcome.ok).toBe(true);
    expect(f.state.requests[1].journal[1]).toMatchObject({ seq: 2, tool: 'list_orders', outcome: { ok: false } });
    expect(result.calls.map((c) => c.status)).toEqual(['ok', 'denied']);
    expect(f.audit.appendCall).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ seq: 2, status: 'denied', denial: 'SANDBOX_DENIED' }));
    expect(f.audit.finish.mock.calls[0][1]).toBe('partial');
    expect(f.audit.finish.mock.calls[0][2]).toMatchObject({ denials: 1 });
  });

  it('meters only successful inner calls through the invocation hook, never a denied one', async () => {
    const f = fixture();
    const onToolSuccess = jest.fn(async () => undefined);
    Object.assign(f.invocation, { onToolSuccess });
    f.state.script = [
      pendingBody(['list_products', { page: 1 }], ['list_orders', { page: 1 }]),
      doneBody('after'),
    ];
    let grants = 0;
    f.policy.authorize.mockImplementation(async (snapshot: any, _a: any, names: any, _p: any, cb: any) => {
      grants++;
      if (grants >= 4) throw new ForbiddenException('SANDBOX_DENIED');
      return RequestContextService.runIsolated({ ...snapshot, roles: [], permissions: ['read'] }, () => cb(snapshot, names));
    });
    const result = await f.run();
    expect(result.calls.map((c) => c.status)).toEqual(['ok', 'denied']);
    expect(onToolSuccess.mock.calls).toEqual([[1, 'list_products']]);
  });

  it.each(['store_id', 'organization_id', 'storeId', 'organizationId', 'tenant_id'])(
    'denies a %s key at any depth in the args without executing the tool',
    async (key) => {
      const f = fixture();
      f.state.script = [
        pendingBody(['list_products', { filter: { nested: [{ [key]: 5 }] } }]),
        doneBody('x'),
      ];
      const result = await f.run();
      expect(f.execute).not.toHaveBeenCalled();
      expect(f.state.requests[1].journal[0].outcome).toMatchObject({ ok: false });
      expect(result.calls).toMatchObject([{ seq: 1, status: 'denied' }]);
      expect(f.audit.appendCall).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ status: 'denied' }));
    },
  );

  it('denies a call whose tool stops being eligible or fails the policy argument schema', async () => {
    const f = fixture();
    f.state.script = [pendingBody(['list_products', { page: 'x' }]), doneBody(1)];
    f.policy.assertArgs.mockImplementation(() => {
      throw new ForbiddenException('SANDBOX_DENIED');
    });
    const result = await f.run();
    expect(result.calls[0].status).toBe('denied');
    expect(f.execute).not.toHaveBeenCalled();
  });

  it('cuts at more than `rounds` rounds with a clear Spanish message', async () => {
    const f = fixture();
    f.state.script = [pendingBody(['list_products', {}])];
    const error = await f.failure();
    expect(error.code).toBe('CODEMODE_LIMIT');
    expect(error.detail).toMatch(/rondas/);
    expect(f.state.requests).toHaveLength(CODEMODE_LIMITS.rounds);
    expect(f.audit.finish.mock.calls[0][3]).toMatchObject({ cut_reason: 'CODEMODE_LIMIT', rounds: CODEMODE_LIMITS.rounds });
  });

  it('cuts at more than `calls` calls before executing the overflow', async () => {
    const f = fixture();
    const eight = () => pendingBody(...Array.from({ length: 8 }, () => ['list_products', {}] as [string, Record<string, unknown>]));
    f.state.script = [eight(), eight(), eight()];
    const error = await f.failure();
    expect(error.code).toBe('CODEMODE_LIMIT');
    expect(error.detail).toMatch(/llamadas/);
    expect(f.execute).toHaveBeenCalledTimes(16);
    expect(f.state.requests).toHaveLength(3);
  });

  it('maps guest errors to their code with the bounded detail and finishes the audit', async () => {
    const f = fixture();
    f.state.script = [(req) => echo(req, { status: 'error', error_code: 'CODEMODE_SYNTAX', error_message: 'Unexpected token' })];
    const error = await f.failure();
    expect(error.code).toBe('CODEMODE_SYNTAX');
    expect(error.detail).toBe('Unexpected token');
    expect(f.audit.finish.mock.calls[0][1]).toBe('failed');
  });

  it('expires the whole execution at wall_ms', async () => {
    const f = fixture();
    f.state.script = [pendingBody(['list_products', {}]), doneBody(1)];
    const now = jest.spyOn(Date, 'now');
    const t0 = Date.now();
    now.mockImplementation(() => t0);
    f.state.onInvoke = () => {
      now.mockImplementation(() => t0 + CODEMODE_LIMITS.wall_ms + 1000);
    };
    const error = await f.failure();
    expect(error.code).toBe('CODEMODE_EXPIRED');
  });

  it('sends an opaque per-store TenantId: 64 hex, never the store id, stable per store, different across stores and salts', async () => {
    const ids: string[] = [];
    for (const store_id of [1, 2, 1]) {
      const f = fixture({ ctx: { store_id } });
      f.state.script = [doneBody(1)];
      await f.run();
      ids.push(f.state.tenantIds[0] as string);
    }
    expect(ids[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(ids[0]).toBe(ids[2]);
    expect(ids[0]).not.toBe(ids[1]);
    expect(ids[0]).not.toContain('1'.padStart(2, '0') + '000');
    setEnv({ AI_CODEMODE_TENANT_KEY_SALT: 'x'.repeat(32) });
    const salted = fixture();
    salted.state.script = [doneBody(1)];
    await salted.run();
    expect(salted.state.tenantIds[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(salted.state.tenantIds[0]).not.toBe(ids[0]);
    expect(salted.audit.start.mock.calls[0][0].tenant_hash).toBe(salted.state.tenantIds[0]);
  });

  it('keeps the durable objective optional: passes its id and authority when present', async () => {
    const f = fixture();
    f.state.script = [doneBody(1)];
    const durable = {
      objective_id: '00000000-0000-4000-8000-000000000009',
      objective: { authority_snapshot: ['read'], expires_at: new Date(Date.now() + 60000), budget: { tools: 0, active_runtime_ms: 0 } },
      assertBudget: jest.fn(async () => {}),
      assertCurrent: jest.fn(async () => {}),
    };
    await RequestContextService.runIsolated(baseCtx() as never, () =>
      codeModeInvocation.run({ ...f.invocation, durable } as never, () => f.bridge.run({ source: 'return 1;', tools: ['list_products'], purpose: 'p' })),
    );
    expect(f.audit.start.mock.calls[0][0].objective_id).toBe(durable.objective_id);
    expect(f.policy.authorize.mock.calls[0][3]).toEqual(['read']);
  });
});

describe('CodeModeBridgeService with the real Code Mode policy (T65)', () => {
  const REAL = 'get_stock_levels';
  const real = collectToolCatalog().map((e) => e.tool);
  const def = (name: string) => real.find((t) => t.name === name)!;
  beforeEach(() => {
    for (const k of Object.keys(ENV)) saved[k] = process.env[k];
    setEnv();
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  function withRealPolicy(parameters?: Record<string, any>) {
    const f = fixture();
    const handler = jest.fn<any, any[]>(async () => JSON.stringify({ rows: [{ id: 1 }, { id: 2 }] }));
    const registry = new AIToolRegistry({} as never);
    for (const name of [REAL, 'run_analysis'])
      registry.register({ ...def(name), parameters: parameters ?? def(name).parameters, handler });
    const base = {
      authorize: jest.fn(async (snapshot: any, _a: string, names: string[], _p: string[], cb: any, scope: any) => {
        if (names.some((n) => !scope.allowedName(n))) throw new ForbiddenException('SANDBOX_DENIED');
        return RequestContextService.runIsolated(
          { ...snapshot, roles: [], permissions: def(REAL).requiredPermissions },
          () => cb(snapshot, names),
        );
      }),
    };
    const policy = new CodeModePolicyService(registry, base as never);
    const bridge = new CodeModeBridgeService(registry, policy, f.client, f.audit as never);
    const invocation = { agentKey: 'vex', initialNames: [REAL, 'run_analysis'], revalidate: async () => [REAL, 'run_analysis'] };
    const run = (tools: string[]) =>
      RequestContextService.runIsolated(f.context as never, () =>
        codeModeInvocation.run(invocation as never, () => bridge.run({ source: 'return 1;', tools, purpose: 'p' })),
      );
    return { f, handler, run, base };
  }

  it('executes an allowlisted read through the generated list and counts its rows', async () => {
    const { f, handler, run, base } = withRealPolicy();
    f.state.script = [pendingBody([REAL, {}]), doneBody({ ok: true })];
    const result = await run([REAL]);
    expect(result).toMatchObject({ rows_seen: 2, calls: [{ tool: REAL, status: 'ok', rows: 2 }] });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(base.authorize).toHaveBeenCalled();
  });

  it('denies a script runner in the manifest before any Lambda round', async () => {
    const { f, run } = withRealPolicy();
    f.state.script = [doneBody(1)];
    await expect(run([REAL, 'run_analysis'])).rejects.toMatchObject({ code: 'CODEMODE_DENIED' });
    expect(f.transport.invoke).not.toHaveBeenCalled();
  });

  it('denies a tool whose live parameters drifted from the audited hash', async () => {
    const { f, run } = withRealPolicy({ type: 'object', properties: { sneaky: { type: 'string' } } });
    f.state.script = [doneBody(1)];
    await expect(run([REAL])).rejects.toMatchObject({ code: 'CODEMODE_DENIED' });
    expect(f.transport.invoke).not.toHaveBeenCalled();
  });

  it('refuses a call whose args break the shared schema or name a tenant, without running the tool', async () => {
    const { f, handler, run } = withRealPolicy();
    f.state.script = [pendingBody([REAL, { store_id: 9 }]), doneBody(1)];
    const result = await run([REAL]);
    expect(result.calls[0]).toMatchObject({ status: 'denied' });
    expect(handler).not.toHaveBeenCalled();
  });
});
