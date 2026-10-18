import { randomUUID } from 'node:crypto';
import { RequestContextService } from '../../common/context/request-context.service';
import { AIToolRegistry } from '../tools/ai-tool-registry';
import { normalizeToolResult } from '../tools/tool-result.normalizer';
import { SandboxBrokerService } from './sandbox-broker.service';
import { sandboxInvocation } from './sandbox-invocation.context';
import { SandboxError } from './interfaces/sandbox-protocol.interface';
import { AgentDeadline, agentDeadlineContext } from '../tasks/agent-deadline';

const ctx = {
  user_id: 3,
  store_id: 1,
  organization_id: 2,
  permissions: ['read'],
  roles: [],
  is_owner: true,
  is_super_admin: false,
};
const input = {
  source: 'return {};',
  language: 'javascript',
  tools: ['list_products'],
  purpose: 'pagination',
};
const config = {
  policy_digest: `sha256:${'a'.repeat(64)}`,
  runtime_digest: `sha256:${'b'.repeat(64)}`,
};
const result = () =>
  normalizeToolResult({
    products: [{ product_id: 7, price: '0.10' }],
    has_more: false,
    page: 1,
  });

function fixture() {
  const handler = jest.fn<any, any[]>(async () =>
    JSON.stringify({ products: [{ product_id: 7 }], has_more: false, page: 1 }),
  );
  const registry = new AIToolRegistry({} as never);
  registry.register({
    name: 'list_products',
    domain: 'products',
    version: '1',
    readOnly: true,
    parameters: { type: 'object', properties: { page: { type: 'number' } } },
    description: 'read',
    requiredPermissions: ['read'],
    handler,
  });
  const policy = {
    validateRequest: jest.fn((value) => value),
    eligible: jest.fn(
      (tool) =>
        tool?.name === 'list_products' &&
        tool.readOnly &&
        !tool.clientSide &&
        !tool.requiresConfirmation,
    ),
    assertArgs: jest.fn((_name, args) => {
      if (
        !args ||
        typeof args !== 'object' ||
        Object.keys(args).some((k) => k !== 'page')
      )
        throw new SandboxError('SANDBOX_DENIED');
    }),
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
  const client = {
    configuration: jest.fn((): typeof config | null => config),
    run: jest.fn(async (start, call) => {
      const reply = await call(frame(start));
      return { result: reply.result.data };
    }),
  };
  const durable = {
    objective_id: randomUUID(),
    objective: {
      expires_at: new Date(Date.now() + 60000),
      authority_snapshot: ['read'],
      budget: { tools: 0, active_runtime_ms: 0 },
    },
    assertCurrent: jest.fn(async () => {}),
    assertBudget: jest.fn(async () => {}),
  };
  const invocation = {
    agentKey: 'vexi',
    initialNames: ['list_products', 'run_readonly_script'],
    durable,
    revalidate: jest.fn(async () => ['list_products', 'run_readonly_script']),
    record: jest.fn<any, any[]>(async () => randomUUID()),
  };
  const broker = new SandboxBrokerService(
    registry,
    policy as never,
    client as never,
    audit as never,
  );
  const run = (value: unknown = input) =>
    RequestContextService.runIsolated(ctx, () =>
      sandboxInvocation.run(invocation as never, () => broker.run(value)),
    ).then(JSON.parse);
  return {
    registry,
    handler,
    policy,
    client,
    audit,
    durable,
    invocation,
    broker,
    run,
  };
}
function frame(start: any, over: Record<string, unknown> = {}) {
  return {
    type: 'call',
    execution_id: start.execution_id,
    nonce: start.nonce,
    seq: 1,
    tool: 'list_products',
    args: { page: 1 },
    ...over,
  };
}

describe('E sandbox broker (synthetic transport, real registry)', () => {
  beforeEach(() => {});
  afterEach(() => {
    jest.restoreAllMocks();
  });
  it('dispatches through registry in strict isolated scope and persists before any guest bytes', async () => {
    const f = fixture();
    const response = await f.run();
    expect(response.status).toBe('ok');
    expect(response.data.verified).toBe(false);
    expect(f.handler).toHaveBeenCalledTimes(1);
    expect(f.handler.mock.calls[0][1]).toMatchObject({
      user_id: 3,
      store_id: 1,
      organization_id: 2,
      roles: [],
    });
    expect(f.invocation.record).toHaveBeenCalledTimes(1);
    expect(f.audit.appendCall.mock.calls[0][1].status).toBe('dispatching');
    expect(f.audit.appendCall.mock.calls[1][1].result_ref).toMatch(
      /^agent-result:/,
    );
    expect(f.audit.finish).toHaveBeenCalledWith(
      expect.any(String),
      'ok',
      expect.objectContaining({ calls: 1, verified: false, cost_usd: null }),
    );
    expect(f.policy.authorize).toHaveBeenCalledTimes(4);
  });

  it('missing source encryption key is unavailable without audit writes or blocking other tools', async () => {
    const f = fixture();
    f.audit.sourceAvailable.mockReturnValue(false);
    expect(await f.run()).toMatchObject({
      status: 'recoverable_error',
      error_code: 'SANDBOX_UNAVAILABLE',
    });
    expect(f.audit.start).not.toHaveBeenCalled();
    expect(f.client.run).not.toHaveBeenCalled();
  });
  it('rejects fallback context and calls without a host invocation', async () => {
    const f = fixture();
    expect(JSON.parse(await f.broker.run(input)).error_code).toBe(
      'SANDBOX_UNAVAILABLE',
    );
    expect(
      await RequestContextService.runIsolated(ctx, () => f.broker.run(input)),
    ).toContain('SANDBOX_UNAVAILABLE');
  });
  it('degrades safely when Linux/Deno/capsule supervisor is unavailable', async () => {
    const f = fixture();
    f.client.configuration.mockReturnValue(null);
    expect((await f.run()).error_code).toBe('SANDBOX_UNAVAILABLE');
    expect(f.audit.start).not.toHaveBeenCalled();
  });

  it.each([
    { nonce: 'spoof' },
    { execution_id: 'foreign' },
    { seq: 0 },
    { seq: 2 },
    { context: ctx },
    { args: { store_id: 8 } },
    { args: { page: '1' } },
    { tool: 'run_readonly_script' },
    { tool: 'write_endpoint' },
    { tool: 'ui_navigate' },
    { tool: 'call_endpoint' },
    { tool: 'propose_plan' },
    { tool: 'vex_block_transform' },
    { tool: 'list_products', args: null },
  ])(
    'rejects forged/mutating/recursive frame before handler: %j',
    async (over) => {
      const f = fixture();
      // Numeric schema rejects strings too at this boundary; production policy is stricter.
      if ((over.args as { page?: unknown })?.page === '1')
        f.policy.assertArgs.mockImplementation(() => {
          throw new SandboxError('SANDBOX_DENIED');
        });
      f.client.run.mockImplementation(async (s, call) => {
        await call(frame(s, over));
        return {};
      });
      expect((await f.run()).status).toBe('blocked');
      expect(f.handler).not.toHaveBeenCalled();
    },
  );
  it.each([
    { requiresConfirmation: true },
    { clientSide: true },
    { readOnly: false },
  ])('cannot upgrade metadata to write/UI: %j', async (change) => {
    const f = fixture();
    Object.assign(f.registry.get('list_products')!, change);
    expect((await f.run()).status).toBe('blocked');
    expect(f.handler).not.toHaveBeenCalled();
  });
  it('rejects manifest outside initial working set and current authority', async () => {
    const f = fixture();
    f.invocation.initialNames = ['run_readonly_script'];
    expect((await f.run()).status).toBe('blocked');
    expect(f.client.run).not.toHaveBeenCalled();
  });
  it('revalidates each call rather than trusting a previous frame', async () => {
    const f = fixture();
    f.invocation.revalidate
      .mockResolvedValueOnce(['list_products'])
      .mockResolvedValue([]);
    expect((await f.run()).status).toBe('blocked');
    expect(f.handler).not.toHaveBeenCalled();
  });
  it('enforces registry permission revocation with no role fallback', async () => {
    const f = fixture();
    f.policy.authorize.mockImplementation(async (s, _a, names, _p, cb) =>
      RequestContextService.runIsolated(
        { ...s, roles: [], permissions: [] },
        () => cb(s, names),
      ),
    );
    const response = await f.run();
    expect(f.handler).not.toHaveBeenCalled();
    // Registry failure is semantic, never tool success, even when guest returns JSON.
    expect(f.invocation.record.mock.calls[0][3].status).not.toBe('ok');
    expect(response.data.partial).toBe(true);
  });
  it('fails closed before executing on audit outage', async () => {
    const f = fixture();
    f.audit.start.mockRejectedValue(new Error('sensitive database error'));
    const value = await f.run();
    expect(value.status).toBe('blocked');
    expect(JSON.stringify(value)).not.toContain('sensitive');
    expect(f.client.run).not.toHaveBeenCalled();
  });
  it('cannot publish a result when durable persistence fails', async () => {
    const f = fixture();
    f.invocation.record.mockRejectedValue(new Error('private'));
    expect((await f.run()).status).toBe('blocked');
    expect(f.audit.finish.mock.calls[0][1]).toBe('denied');
  });
  it('fences duplicate sequence numbers before second handler', async () => {
    const f = fixture();
    f.client.run.mockImplementation(async (s, cb) => {
      await cb(frame(s));
      await cb(frame(s));
      return {};
    });
    expect((await f.run()).error_code).toBe('SANDBOX_PROTOCOL');
    expect(f.handler).toHaveBeenCalledTimes(1);
  });
  it('requires explicit parallel safety, defaulting to serial', async () => {
    const f = fixture();
    f.handler.mockImplementation(() => new Promise(() => {}));
    f.client.run.mockImplementation(async (s, cb) => {
      const a = cb(frame(s));
      const b = cb(frame(s, { seq: 2 }));
      await Promise.all([a, b]);
      return {};
    });
    expect((await f.run()).status).toBe('blocked');
  });
  it('rejects a result emitted before in-flight RPC completion', async () => {
    const f = fixture();
    f.client.run.mockImplementation(async (s, cb) => {
      void cb(frame(s)).catch(() => {});
      return { forged: true };
    });
    expect((await f.run()).status).toBe('blocked');
  });
  it('caps pages at ten without invoking handler eleven', async () => {
    const f = fixture();
    f.client.run.mockImplementation(async (s, cb) => {
      for (let seq = 1; seq <= 11; seq++)
        await cb(frame(s, { seq, args: { page: seq } }));
      return {};
    });
    expect((await f.run()).error_code).toBe('SANDBOX_LIMIT');
    expect(f.handler).toHaveBeenCalledTimes(10);
  });
  it('caps bytes before returning data or a fake complete set', async () => {
    const f = fixture();
    f.policy.filterResult.mockReturnValue({
      ...result(),
      data: { products: ['x'.repeat(2097153)] },
    });
    expect((await f.run()).error_code).toBe('SANDBOX_LIMIT');
    expect(f.invocation.record).not.toHaveBeenCalled();
  });
  it('uses the smaller objective budget, not a fresh sandbox allowance', async () => {
    const f = fixture();
    f.durable.objective.budget.tools = 999;
    expect((await f.run()).error_code).toBe('SANDBOX_LIMIT');
    expect(f.client.run).not.toHaveBeenCalled();
  });
  it('rechecks revocation after the final RPC, before publishing calculation', async () => {
    const f = fixture();
    f.client.run.mockImplementation(async (s, cb) => {
      await cb(frame(s));
      f.invocation.revalidate.mockResolvedValue([]);
      return { leaked: true };
    });
    const value = await f.run();
    expect(value.status).toBe('blocked');
    expect(JSON.stringify(value)).not.toContain('leaked');
    expect(value.evidence_refs).toHaveLength(1);
  });
  it('refuses a standalone arithmetic script without an audited read', async () => {
    const f = fixture();
    f.client.run.mockImplementation(async () => ({ value: 3 }));
    expect((await f.run()).status).toBe('blocked');
    expect(f.handler).not.toHaveBeenCalled();
  });

  it('fences a non-cooperative late read after parent cancellation', async () => {
    const f = fixture();
    let entered!: () => void;
    let release!: (value: string) => void;
    const entering = new Promise<void>((resolve) => {
      entered = resolve;
    });
    f.handler.mockImplementation(() => {
      entered();
      return new Promise<string>((resolve) => {
        release = resolve;
      });
    });
    const parent = new AgentDeadline({
      wallDeadlineMs: Date.now() + 30000,
      activeBudgetMs: 30000,
      reserveMs: 0,
    });
    const running = agentDeadlineContext.run(parent, () => f.run());
    await entering;
    parent.cancel();
    const value = await running;
    expect(value.status).toBe('blocked');
    expect(value.error_code).toBe('SANDBOX_EXPIRED');
    release(JSON.stringify({ products: [{ name: 'late-sensitive' }] }));
    await new Promise((resolve) => setImmediate(resolve));
    expect(f.invocation.record).not.toHaveBeenCalled();
    expect(JSON.stringify(value)).not.toContain('late-sensitive');
  });
  it('scrubs credentials in output and never claims verified or complete', async () => {
    const f = fixture();
    f.client.run.mockImplementation(async (s, cb) => {
      await cb(frame(s));
      return { access_token: 'secret', good: 'value' };
    });
    const value = await f.run();
    expect(value.data.value).toEqual({ good: 'value' });
    expect(value.data.dataset_complete).toBe(false);
    expect(JSON.stringify(value)).not.toContain('secret');
  });
  it('enforces output size and offers explicit read/report fallback', async () => {
    const f = fixture();
    f.client.run.mockImplementation(async (s, cb) => {
      await cb(frame(s));
      return 'x'.repeat(65537);
    });
    const value = await f.run();
    expect(value.error_code).toBe('SANDBOX_LIMIT');
    expect(value.next_action).toContain('reporte');
  });
});
