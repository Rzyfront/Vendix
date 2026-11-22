/* eslint-disable @typescript-eslint/no-explicit-any --
 * Test doubles: the Prisma/service fakes and the scripted Lambda bodies are
 * deliberately loosely typed; every assertion below is on observable behaviour. */
import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { RequestContextService } from '../../common/context/request-context.service';
import { AIToolRegistry } from '../tools/ai-tool-registry';
import { createCustomerTools } from '../tools/domains/customers.tools';
import { createOrdersTools } from '../tools/domains/orders.tools';
import { createProductTools } from '../tools/domains/products.tools';
import { collectToolCatalog, inertDeps } from '../tools/tool-catalog.test-helper';
import { CodeModeBridgeService } from './codemode-bridge.service';
import { codeModeInvocation } from './codemode-invocation.context';
import { CodeModePolicyService } from './codemode-policy.service';
import {
  CODEMODE_PROTOCOL,
  CodeModeError,
  CodeModeRoundRequest,
} from './interfaces/codemode-protocol.interface';
import { SandboxPolicyService } from './sandbox-policy.service';
import {
  codeModeTenantId,
  LambdaInvokeTransport,
  SandboxLambdaClientService,
} from './sandbox-lambda-client.service';

/**
 * F10 / T68: cross-tenant ATTACK SUITE for Code Mode (spec S14: "debe haber una
 * suite de ataque que intente cruzar tiendas desde el script y falle siempre").
 * One describe per case (1)-(8) of the plan; case (9), residue between Lambda
 * invocations, lives Lambda-side in infra/agent-sandbox/js/handler.test.cjs.
 *
 * REAL in every case:
 *  - CodeModeBridgeService (rounds, server-side journal, assertTenant per
 *    round/call, TENANT_KEYS rejection, response validation),
 *  - CodeModePolicyService with the GENERATED allowlist and the live-definition
 *    drift check,
 *  - SandboxPolicyService.authorize (authority re-derived from the "database"
 *    on every call; subscription gate, agent row, role scoping),
 *  - SandboxLambdaClientService (request build, TenantId derivation, reply
 *    parsing) and codeModeResponseValidator,
 *  - AIToolRegistry + the REAL declarations and handlers of get_order,
 *    get_customer_history and get_product (createOrdersTools /
 *    createCustomerTools / createProductTools), normalizeToolResult, and the
 *    per-call dispatch pipeline (dispatchSandboxTool),
 *  - RequestContextService (AsyncLocalStorage).
 * FAKED:
 *  - the Lambda transport (scripted, hostile bodies: forged journals, wrong
 *    nonce / execution_id / seq, tool outside the manifest ...),
 *  - GlobalPrismaService (two stores' users/roles/stores/settings/agents rows;
 *    user_roles honours the same `buildActiveUserRolesWhere` filter the real
 *    one gets) and SubscriptionAccessService,
 *  - the ordersService / customersService / productsService behind the real
 *    tool handlers: in-memory rows of two stores whose `findOne` enforces the
 *    same store scoping the scoped Prisma services enforce (store taken from
 *    the AsyncLocalStorage context, NotFoundException otherwise),
 *  - SandboxAuditRepository (rows captured so they can be scanned for leaks),
 *  - handlers of tools outside the allowlist / write tools (spies: they must
 *    never run).
 */

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
const savedEnv: Record<string, string | undefined> = {};

const PERMS = [
  'store:orders:read',
  'store:customers:read',
  'store:products:read',
];
const SECRET_A = /SECRET-A/;
const SECRET_B = /SECRET-B/;

type Side = 'A' | 'B';
const SIDES: Record<Side, { store: number; org: number; user: number }> = {
  A: { store: 1, org: 10, user: 31 },
  B: { store: 2, org: 20, user: 32 },
};

/* ------------------------------------------------------------------ world */

function makeWorld() {
  const role = (side: Side, permissions: string[]) => ({
    id: side === 'A' ? 1 : 2,
    name: 'store_admin',
    organization_id: SIDES[side].org,
    store_id: SIDES[side].store,
    is_system_role: false,
    role_permissions: permissions.map((name) => ({
      permissions: { name, status: 'active' },
    })),
  });
  const assignments: Array<{
    user_id: number;
    store_id: number | null;
    roles: ReturnType<typeof role>;
  }> = [
    { user_id: 31, store_id: 1, roles: role('A', PERMS) },
    { user_id: 32, store_id: 2, roles: role('B', PERMS) },
  ];
  const w = {
    assignments,
    users: new Map<number, any>([
      [31, { id: 31, organization_id: 10, state: 'active', locked_until: null }],
      [32, { id: 32, organization_id: 20, state: 'active', locked_until: null }],
    ]),
    stores: new Map<number, any>([
      [1, { id: 1, organization_id: 10, is_active: true }],
      [2, { id: 2, organization_id: 20, is_active: true }],
    ]),
    gate: { allowed: true, mode: 'allow' } as Record<string, unknown>,
    orders: [
      { id: 100, store_id: 1, order_number: 'SECRET-A-100', note: 'SECRET-A-order' },
      { id: 200, store_id: 2, order_number: 'SECRET-B-200', note: 'SECRET-B-order' },
    ],
    customers: [
      { id: 500, store_id: 1, first_name: 'SECRET-A-cliente', last_name: 'Uno' },
      { id: 600, store_id: 2, first_name: 'SECRET-B-cliente', last_name: 'Dos' },
    ],
    products: [
      { id: 700, store_id: 1, name: 'SECRET-A-producto' },
      { id: 800, store_id: 2, name: 'SECRET-B-producto' },
    ],
  };
  const prisma = {
    users: { findUnique: jest.fn(async ({ where }: any) => w.users.get(where.id) ?? null) },
    user_roles: {
      findMany: jest.fn(async ({ where }: any) =>
        w.assignments.filter(
          (a) =>
            a.user_id === where.user_id &&
            where.OR.some((o: any) => o.store_id === a.store_id),
        ),
      ),
    },
    stores: { findUnique: jest.fn(async ({ where }: any) => w.stores.get(where.id) ?? null) },
    store_settings: {
      findUnique: jest.fn(async () => ({ settings: { vex: { enabled: true } } })),
    },
    ai_agents: {
      findUnique: jest.fn(async () => ({ is_active: true, allowed_tools: [], denied_tools: [] })),
    },
  };
  const access = {
    canUseAIFeature: jest.fn(async () => w.gate),
    getAIFeatureConfig: jest.fn(async () => ({ enabled: true })),
  };
  return { ...w, prisma, access };
}

/* -------------------------------------------------------------------- rig */

type Step = (req: CodeModeRoundRequest, tenantId?: string) => Record<string, unknown>;
const echo = (req: CodeModeRoundRequest, extra: Record<string, unknown>) => ({
  protocol: CODEMODE_PROTOCOL,
  execution_id: req.execution_id,
  nonce: req.nonce,
  round: req.round,
  runtime_digest: DIGEST,
  ...extra,
});
const pending =
  (...calls: Array<[string, Record<string, unknown>]>): Step =>
  (req) =>
    echo(req, {
      status: 'pending',
      pending: calls.map(([tool, args], i) => ({
        seq: req.journal.length + 1 + i,
        tool,
        args,
      })),
    });
/** Honest "guest": returns exactly what the host journal handed it. */
const finishWithJournal: Step = (req) =>
  echo(req, { status: 'completed', result: { journal: req.journal }, logs: ['ok'], blocks: [] });
const finishWith =
  (result: unknown): Step =>
  (req) =>
    echo(req, { status: 'completed', result, logs: [], blocks: [] });

function rig() {
  const world = makeWorld();
  const seen = {
    orders: [] as Array<{ store?: number; id: number }>,
    customers: [] as Array<{ store?: number; id: number }>,
    products: [] as Array<{ store?: number; id: number }>,
  };
  const currentStore = () => RequestContextService.asyncLocalStorage.getStore()?.store_id;
  // Same contract as the scoped Prisma services: the store comes from the
  // AsyncLocalStorage context, never from an argument; no row -> NotFound.
  const scoped = <T extends { id: number; store_id: number }>(
    rows: T[],
    log: Array<{ store?: number; id: number }>,
    id: number,
    hook?: () => void,
  ): T => {
    const store = currentStore();
    log.push({ store, id });
    hook?.();
    const row = rows.find((r) => r.id === id && r.store_id === store);
    if (!row) throw new NotFoundException('not found');
    return row;
  };
  const hooks: { afterRead?: () => void } = {};
  const ordersService = {
    findOne: jest.fn(async (id: number) => {
      const row = scoped(world.orders, seen.orders, id);
      hooks.afterRead?.();
      return { ...row, order_items: [], payments: [], users: null };
    }),
  };
  const customersService = {
    findOne: jest.fn(async (_storeArg: number, id: number) => {
      const row = scoped(world.customers, seen.customers, id);
      hooks.afterRead?.();
      return { ...row, addresses: [] };
    }),
    getRecentOrdersForAgent: jest.fn(async () => []),
    getFinishedAggregateForAgent: jest.fn(async () => ({ _count: { _all: 0 }, _sum: {}, _min: {}, _max: {} })),
    getOpenBalanceForAgent: jest.fn(async () => ({ _count: { _all: 0 }, _sum: {} })),
    getBookingsCountForAgent: jest.fn(async () => 0),
    getTopProductsForAgent: jest.fn(async () => []),
    resolveCurrencyFromOrdersForAgent: jest.fn(async () => 'COP'),
  };
  const productsService = {
    findOne: jest.fn(async (id: number) => {
      const row = scoped(world.products, seen.products, id);
      hooks.afterRead?.();
      return { ...row, product_variants: [], stock_levels: [], base_price: 1 };
    }),
    getEffectiveTaxRate: jest.fn(() => 0),
  };
  const withInert = (real: object) =>
    new Proxy(real, { get: (t, p) => (p in t ? (t as any)[p] : inertDeps()) });

  const catalog = collectToolCatalog().map((e) => e.tool);
  const registry = new AIToolRegistry({} as never);
  const real = [
    ...createOrdersTools(withInert({ ordersService }) as never),
    ...createCustomerTools(withInert({ customersService }) as never),
    ...createProductTools(withInert({ productsService, settingsService: { getStoreCurrency: async () => 'COP' } }) as never),
  ];
  for (const name of ['get_order', 'get_customer_history', 'get_product'])
    registry.register(real.find((t) => t.name === name)!);

  // Tools that must never run: spy handlers on REAL declarations.
  const spyHandler = jest.fn<any, any[]>(async () => JSON.stringify({ rows: ['SHOULD-NOT-RUN'] }));
  const def = (name: string) => catalog.find((t) => t.name === name)!;
  const writeTool = catalog.find(
    (t) => t.requiresConfirmation === true && !t.clientSide,
  )!;
  const unlisted = catalog.find(
    (t) =>
      t.readOnly === true &&
      !t.clientSide &&
      !t.requiresConfirmation &&
      t.access !== 'public' &&
      !CodeModePolicyService.allowlistedNames().includes(t.name) &&
      !!t.requiredPermissions?.length &&
      t.requiredPermissions.every((p) => PERMS.includes(p)),
  );
  // The write tool is registered with a permission the role HOLDS, so the only
  // reason left to refuse it is that it writes.
  registry.register({ ...writeTool, access: undefined, requiredPermissions: ['store:orders:read'], handler: spyHandler });
  for (const tool of [def('run_analysis'), def('get_consolidation_status'), ...(unlisted ? [unlisted] : [])])
    registry.register({ ...tool, handler: spyHandler });

  const base = new SandboxPolicyService(world.prisma as never, world.access as never, registry);
  const policy = new CodeModePolicyService(registry, base);
  const rows: unknown[] = [];
  const audit = {
    sourceAvailable: jest.fn(() => true),
    start: jest.fn(async (a: unknown) => void rows.push(['start', a])),
    appendCall: jest.fn(async (id: unknown, a: unknown) => void rows.push(['call', id, a])),
    finish: jest.fn(async (...a: unknown[]) => void rows.push(['finish', ...a])),
  };
  const state: {
    steps: Step[];
    requests: CodeModeRoundRequest[];
    tenantIds: Array<string | undefined>;
    byTenant: Map<string | undefined, CodeModeRoundRequest[]>;
    onInvoke?: (req: CodeModeRoundRequest, tenantId?: string) => void | Promise<void>;
    respond?: Step;
  } = { steps: [], requests: [], tenantIds: [], byTenant: new Map() };
  const transport: LambdaInvokeTransport = {
    invoke: jest.fn(async ({ payload, tenantId }: any) => {
      const req = JSON.parse(Buffer.from(payload).toString('utf8')) as CodeModeRoundRequest;
      state.requests.push(req);
      state.tenantIds.push(tenantId);
      state.byTenant.set(tenantId, [...(state.byTenant.get(tenantId) ?? []), req]);
      await state.onInvoke?.(req, tenantId);
      const step = state.respond ?? state.steps[Math.min(req.round, state.steps.length) - 1];
      return { statusCode: 200, payload: new TextEncoder().encode(JSON.stringify(step(req, tenantId))) };
    }),
  };
  const client = new SandboxLambdaClientService(transport);
  const bridge = new CodeModeBridgeService(registry, policy, client, audit as never);

  const session = (side: Side, over: Record<string, unknown> = {}) => ({
    user_id: SIDES[side].user,
    store_id: SIDES[side].store,
    organization_id: SIDES[side].org,
    permissions: [...PERMS],
    roles: ['store_admin'],
    is_owner: false,
    is_super_admin: false,
    app_type: 'STORE_ADMIN',
    ...over,
  });
  const run = (
    ctx: Record<string, any>,
    tools: string[],
    inv: { revalidate?: () => Promise<string[]> } = {},
    source = 'return 1;',
  ) =>
    RequestContextService.runIsolated(ctx as never, () =>
      codeModeInvocation.run(
        { agentKey: 'vex', initialNames: tools, revalidate: inv.revalidate ?? (async () => tools) } as never,
        () => bridge.run({ source, tools, purpose: 'attack' } as never),
      ),
    );
  const failure = async (...args: Parameters<typeof run>) => {
    try {
      await run(...args);
    } catch (error) {
      return error as CodeModeError;
    }
    throw new Error('expected the run to fail');
  };
  const logs: string[] = [];
  return {
    world, seen, registry, spyHandler, writeTool, unlisted, audit, rows, state, transport, bridge,
    session, run, failure, hooks, logs, ordersService, customersService, productsService,
  };
}
type Rig = ReturnType<typeof rig>;

/** Everything an observer outside the tenant could read: Lambda requests, audit rows, logs, results. */
const observable = (r: Rig, ...extra: unknown[]) =>
  JSON.stringify([r.state.requests, r.rows, r.logs, extra]);
const noToolRan = (r: Rig) => {
  expect(r.ordersService.findOne).not.toHaveBeenCalled();
  expect(r.customersService.findOne).not.toHaveBeenCalled();
  expect(r.productsService.findOne).not.toHaveBeenCalled();
  expect(r.spyHandler).not.toHaveBeenCalled();
};
/** Every tool handler that DID run did so under this store only. */
const onlyStore = (r: Rig, store: number) => {
  for (const log of [r.seen.orders, r.seen.customers, r.seen.products])
    for (const entry of log) expect(entry.store).toBe(store);
};
const finishOutcome = (r: Rig) =>
  (r.audit.finish.mock.calls[0] as unknown[])[1];

beforeEach(() => {
  for (const k of Object.keys(ENV)) savedEnv[k] = process.env[k];
  for (const [k, v] of Object.entries(ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});
afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  jest.restoreAllMocks();
});

/** Capture every Nest log line a run emits so the leak scan covers logs too. */
function captureLogs(r: Rig) {
  for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const)
    jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
      r.logs.push(args.map(String).join(' '));
    });
}

/* ----------------------------------------------------------- positive control */

describe('control: an honest script reads its OWN store through the same pipeline', () => {
  it('returns store A rows for store A ids (so the 404s below are not vacuous)', async () => {
    const r = rig();
    r.state.steps = [
      pending(['get_order', { order_id: 100 }], ['get_customer_history', { customer_id: 500 }], ['get_product', { product_id: 700 }]),
      finishWithJournal,
    ];
    const result = await r.run(r.session('A'), ['get_order', 'get_customer_history', 'get_product']);
    expect(JSON.stringify(result.result)).toMatch(SECRET_A);
    expect(result.calls.map((c) => c.status)).toEqual(['ok', 'ok', 'ok']);
    onlyStore(r, 1);
    expect(r.seen.orders).toEqual([{ store: 1, id: 100 }]);
  });
});

/* ------------------------------------------------------------------ case 1 */

describe('(1) store_id / organization_id in the arguments', () => {
  const keys: Array<Record<string, unknown>> = [
    { order_id: 200, store_id: 2 },
    { order_id: 200, organization_id: 20 },
    { order_id: 200, storeId: 2 },
    { order_id: 200, OrganizationId: 20 },
    { order_id: 200, 'tenant-id': 2 },
    { order_id: 200, org_id: 20 },
    { order_id: 200, filter: { deep: [{ nested: { STORE_ID: 2 } }] } },
    JSON.parse('{"order_id":200,"x":{"store_id":2}}'),
  ];

  it.each(keys.map((k) => [JSON.stringify(k), k] as const))(
    'denies %s: the tool never runs, the script sees an error outcome, nothing of store B leaks',
    async (_label, args) => {
      const r = rig();
      captureLogs(r);
      r.state.steps = [pending(['get_order', args]), finishWithJournal];
      const result = await r.run(r.session('A'), ['get_order']);
      expect(result.calls).toMatchObject([{ seq: 1, tool: 'get_order', status: 'denied', rows: 0 }]);
      expect(r.state.requests[1].journal[0].outcome).toMatchObject({ ok: false });
      noToolRan(r);
      expect(r.rows).toContainEqual(['call', expect.any(String), expect.objectContaining({ status: 'denied', denial: 'SANDBOX_DENIED' })]);
      expect(observable(r, result)).not.toMatch(SECRET_B);
      expect(finishOutcome(r)).toBe('partial');
    },
  );

  it('a hostile Lambda that smuggles a tenant key on the pending frame itself is a protocol error (nothing runs)', async () => {
    const r = rig();
    r.state.steps = [
      (req) => ({
        ...pending(['get_order', { order_id: 200 }])(req),
        store_id: 2,
      }),
    ];
    expect((await r.failure(r.session('A'), ['get_order'])).code).toBe('CODEMODE_PROTOCOL');
    const s = rig();
    s.state.steps = [
      (req) =>
        echo(req, { status: 'pending', pending: [{ seq: 1, tool: 'get_order', args: { order_id: 200 }, store_id: 2 }] }),
    ];
    expect((await s.failure(s.session('A'), ['get_order'])).code).toBe('CODEMODE_PROTOCOL');
    noToolRan(r);
    noToolRan(s);
  });

  it('the run request cannot name a tenant: extra fields are ignored and the Lambda only ever sees the opaque A tenant', async () => {
    const r = rig();
    r.state.steps = [finishWith(1)];
    await RequestContextService.runIsolated(r.session('A') as never, () =>
      codeModeInvocation.run(
        { agentKey: 'vex', initialNames: ['get_order'], revalidate: async () => ['get_order'] } as never,
        () => r.bridge.run({ source: 'return 1;', tools: ['get_order'], purpose: 'p', store_id: 2, organization_id: 20 } as never),
      ),
    );
    expect(r.state.tenantIds).toEqual([codeModeTenantId(1)]);
    const sent = JSON.stringify(r.state.requests);
    expect(sent).not.toMatch(/store_id|organization_id|"store"|tenant_id/i);
    expect(
      (r.audit.start.mock.calls[0][0] as { tenant_hash: string }).tenant_hash,
    ).toBe(codeModeTenantId(1));
  });
});

/* ------------------------------------------------------------------ case 2 */

describe('(2) ids of another store (order, customer, product) are not found, never B data', () => {
  const attacks: Array<[string, string, Record<string, unknown>, RegExp]> = [
    ['order', 'get_order', { order_id: 200 }, /TOOL_BUSINESS_ERROR: Comprueba el identificador/],
    ['customer', 'get_customer_history', { customer_id: 600 }, /TOOL_BUSINESS_ERROR: Usa find_customer/],
    ['product', 'get_product', { product_id: 800 }, /TOOL_BUSINESS_ERROR: Usa find_product/],
  ];

  it.each(attacks)('%s of store B from a store A session yields the not-found shape', async (_k, tool, args, shape) => {
    const r = rig();
    captureLogs(r);
    r.state.steps = [pending([tool, args]), finishWithJournal];
    const result = await r.run(r.session('A'), [tool]);
    const outcome = r.state.requests[1].journal[0].outcome as { ok: boolean; error?: string; value?: unknown };
    // The (real) tool + normalizer turned the scoped NotFound into the not-found shape.
    expect(JSON.stringify(outcome)).toMatch(shape);
    expect(JSON.stringify(outcome)).not.toMatch(SECRET_B);
    expect(observable(r, result)).not.toMatch(SECRET_B);
    // The scoped service DID run, but under store A: B's row is invisible to it.
    onlyStore(r, 1);
    expect(r.seen.orders.length + r.seen.customers.length + r.seen.products.length).toBe(1);
  });

  it('all three at once, plus ids that exist in both stores, stay inside store A', async () => {
    const r = rig();
    r.state.steps = [
      pending(['get_order', { order_id: 200 }], ['get_customer_history', { customer_id: 600 }], ['get_product', { product_id: 800 }], ['get_order', { order_id: 100 }]),
      finishWithJournal,
    ];
    const result = await r.run(r.session('A'), ['get_order', 'get_customer_history', 'get_product']);
    expect(JSON.stringify(result.result)).toMatch(SECRET_A);
    expect(observable(r, result)).not.toMatch(SECRET_B);
    onlyStore(r, 1);
  });

  it('the mirror attack (store B session asking for A ids) is symmetric', async () => {
    const r = rig();
    r.state.steps = [pending(['get_order', { order_id: 100 }], ['get_product', { product_id: 700 }]), finishWithJournal];
    const result = await r.run(r.session('B'), ['get_order', 'get_product']);
    expect(observable(r, result)).not.toMatch(SECRET_A);
    onlyStore(r, 2);
  });
});

/* ------------------------------------------------------------------ case 3 */

describe('(3) forged journal / seq / nonce / execution_id', () => {
  const forged = [{ seq: 1, tool: 'get_order', args_hash: 'a'.repeat(64), outcome: { ok: true, value: 'SECRET-B-forged' } }];

  it.each([
    ['a journal field next to pending', (req: CodeModeRoundRequest) => ({ ...pending(['get_order', { order_id: 100 }])(req), journal: forged })],
    ['a journal field on completed', (req: CodeModeRoundRequest) => ({ ...finishWith(1)(req), journal: forged })],
    ['a journal-like key (Journal_Entries)', (req: CodeModeRoundRequest) => ({ ...finishWith(1)(req), Journal_Entries: forged })],
    ['an outcome smuggled inside a pending entry', (req: CodeModeRoundRequest) =>
      echo(req, { status: 'pending', pending: [{ seq: 1, tool: 'get_order', args: { order_id: 100 }, outcome: { ok: true, value: 'SECRET-B-forged' } }] })],
    ['a wrong nonce', (req: CodeModeRoundRequest) => ({ ...finishWith(1)(req), nonce: 'f'.repeat(64) })],
    ['a missing nonce', (req: CodeModeRoundRequest) => { const b = finishWith(1)(req) as any; delete b.nonce; return b; }],
    ['a wrong execution_id', (req: CodeModeRoundRequest) => ({ ...finishWith(1)(req), execution_id: '00000000-0000-4000-8000-000000000000' })],
    ['a wrong round number', (req: CodeModeRoundRequest) => ({ ...finishWith(1)(req), round: 2 })],
    ['a wrong runtime digest', (req: CodeModeRoundRequest) => ({ ...finishWith(1)(req), runtime_digest: `sha256:${'0'.repeat(64)}` })],
    ['a seq that skips', (req: CodeModeRoundRequest) => echo(req, { status: 'pending', pending: [{ seq: 5, tool: 'get_order', args: { order_id: 100 } }] })],
    ['a seq of zero', (req: CodeModeRoundRequest) => echo(req, { status: 'pending', pending: [{ seq: 0, tool: 'get_order', args: { order_id: 100 } }] })],
    ['a fractional seq', (req: CodeModeRoundRequest) => echo(req, { status: 'pending', pending: [{ seq: 1.5, tool: 'get_order', args: { order_id: 100 } }] })],
    ['a string seq', (req: CodeModeRoundRequest) => echo(req, { status: 'pending', pending: [{ seq: '1', tool: 'get_order', args: { order_id: 100 } }] })],
    ['a duplicated seq in one frame', (req: CodeModeRoundRequest) => echo(req, { status: 'pending', pending: [{ seq: 1, tool: 'get_order', args: { order_id: 100 } }, { seq: 1, tool: 'get_order', args: { order_id: 100 } }] })],
  ])('%s is a protocol error and no tool runs', async (_label, step) => {
    const r = rig();
    captureLogs(r);
    r.state.steps = [step as Step];
    const error = await r.failure(r.session('A'), ['get_order']);
    expect(error.code).toBe('CODEMODE_PROTOCOL');
    noToolRan(r);
    expect(observable(r, error.detail)).not.toMatch(/SECRET-B-forged/);
    expect(finishOutcome(r)).toBe('denied');
  });

  it('replaying an already journaled seq in a later round is a protocol error: the host journal never accepts it', async () => {
    const r = rig();
    r.state.steps = [
      pending(['get_order', { order_id: 100 }]),
      (req) => echo(req, { status: 'pending', pending: [{ seq: 1, tool: 'get_order', args: { order_id: 100 } }] }),
    ];
    expect((await r.failure(r.session('A'), ['get_order'])).code).toBe('CODEMODE_PROTOCOL');
    expect(r.ordersService.findOne).toHaveBeenCalledTimes(1);
  });

  it('the Lambda receives a COPY of the server journal each round: what it returns never changes it', async () => {
    const r = rig();
    r.state.steps = [
      pending(['get_order', { order_id: 100 }]),
      pending(['get_order', { order_id: 100 }]),
      finishWithJournal,
    ];
    const result = await r.run(r.session('A'), ['get_order']);
    const [a, b, c] = r.state.requests;
    expect(a.journal).toHaveLength(0);
    expect(b.journal).toHaveLength(1);
    expect(c.journal).toHaveLength(2);
    expect(c.journal.map((e) => e.seq)).toEqual([1, 2]);
    expect(result.calls).toHaveLength(2);
  });

  it('a nonce / execution_id captured from ANOTHER run (same or other store) is refused', async () => {
    const r = rig();
    r.state.steps = [finishWith('first')];
    await r.run(r.session('B'), ['get_order']);
    const stolen = r.state.requests[0]; // run of store B
    const victim = rig();
    victim.state.respond = (req) => ({
      ...finishWith('hijacked')(req),
      execution_id: stolen.execution_id,
      nonce: stolen.nonce,
    });
    const error = await victim.failure(victim.session('A'), ['get_order']);
    expect(error.code).toBe('CODEMODE_PROTOCOL');
    // each of the two fields on its own is enough to be refused
    for (const field of ['execution_id', 'nonce'] as const) {
      const v = rig();
      v.state.respond = (req) => ({ ...finishWith('hijacked')(req), [field]: stolen[field] });
      expect((await v.failure(v.session('A'), ['get_order'])).code).toBe('CODEMODE_PROTOCOL');
    }
  });

  it('every execution gets a fresh execution_id, nonce and seed (never reused across runs or stores)', async () => {
    const r = rig();
    r.state.steps = [finishWith(1)];
    await r.run(r.session('A'), ['get_order']);
    await r.run(r.session('A'), ['get_order']);
    await r.run(r.session('B'), ['get_order']);
    const ids = r.state.requests.flatMap((q) => [q.execution_id, q.nonce, q.seed]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('a guest-reported CODEMODE_REPLAY_DIVERGENCE aborts the run with that code and publishes nothing', async () => {
    const r = rig();
    r.state.steps = [
      pending(['get_order', { order_id: 100 }]),
      (req) => echo(req, { status: 'error', error_code: 'CODEMODE_REPLAY_DIVERGENCE', error_message: 'journal mismatch' }),
    ];
    const error = await r.failure(r.session('A'), ['get_order']);
    expect(error.code).toBe('CODEMODE_REPLAY_DIVERGENCE');
    expect(finishOutcome(r)).toBe('failed');
  });

  it('an error code that is not in the guest vocabulary (e.g. one that impersonates a host decision) is a protocol error', async () => {
    for (const code of ['CODEMODE_TENANT_CHANGED', 'CODEMODE_DENIED', 'CODEMODE_UNAVAILABLE', 'SANDBOX_OK']) {
      const r = rig();
      r.state.steps = [(req) => echo(req, { status: 'error', error_code: code })];
      expect((await r.failure(r.session('A'), ['get_order'])).code).toBe('CODEMODE_PROTOCOL');
    }
  });
});

/* ------------------------------------------------------------------ case 4 */

describe('(4) the session store changes between rounds', () => {
  it('store flipped to B while the Lambda round runs: the pending call is never executed', async () => {
    const r = rig();
    const ctx = r.session('A');
    r.state.steps = [pending(['get_order', { order_id: 200 }]), finishWithJournal];
    r.state.onInvoke = () => {
      ctx.store_id = 2;
    };
    expect((await r.failure(ctx, ['get_order'])).code).toBe('CODEMODE_TENANT_CHANGED');
    noToolRan(r);
    expect(finishOutcome(r)).toBe('denied');
  });

  it.each([
    ['store_id', 2],
    ['organization_id', 20],
    ['user_id', 32],
  ])('%s flipped after a call ran: no round 2 is sent, A data never reaches the other tenant', async (field, value) => {
    const r = rig();
    captureLogs(r);
    const ctx = r.session('A');
    r.state.steps = [pending(['get_order', { order_id: 100 }]), pending(['get_order', { order_id: 200 }]), finishWithJournal];
    r.hooks.afterRead = () => {
      (ctx as any)[field] = value;
    };
    expect((await r.failure(ctx, ['get_order'])).code).toBe('CODEMODE_TENANT_CHANGED');
    // the flip happened inside call 1's handler (under A): result never published, no round 2
    expect(r.state.requests).toHaveLength(1);
    expect(r.ordersService.findOne).toHaveBeenCalledTimes(1);
    onlyStore(r, 1);
    expect(new Set(r.state.tenantIds)).toEqual(new Set([codeModeTenantId(1)]));
    expect(JSON.stringify(r.state.requests)).not.toMatch(SECRET_A);
  });

  it('store flipped between two rounds (after round 1 settled): round 2 is refused before it is sent', async () => {
    const r = rig();
    const ctx = r.session('A');
    r.state.steps = [pending(['get_order', { order_id: 100 }]), pending(['get_order', { order_id: 200 }]), finishWithJournal];
    let n = 0;
    r.state.onInvoke = () => {
      if (++n === 2) ctx.store_id = 2; // before the round-2 reply is executed
    };
    expect((await r.failure(ctx, ['get_order'])).code).toBe('CODEMODE_TENANT_CHANGED');
    // call 1 ran under A; call 2 (order 200) never ran
    expect(r.seen.orders).toEqual([{ store: 1, id: 100 }]);
    expect(r.state.requests).toHaveLength(2);
    expect(new Set(r.state.tenantIds)).toEqual(new Set([codeModeTenantId(1)]));
  });

  it('a "completed" reply is not returned if the tenant changed meanwhile', async () => {
    const r = rig();
    const ctx = r.session('A');
    r.state.steps = [finishWith({ leak: 'SECRET-B-result' })];
    r.state.onInvoke = () => {
      ctx.store_id = 2;
    };
    // flip happens before the reply: caught at the next assertTenant (completed branch)
    expect((await r.failure(ctx, ['get_order'])).code).toBe('CODEMODE_TENANT_CHANGED');
  });

  it('a session that disappears (no store at all) is unavailable, not a default store', async () => {
    const r = rig();
    r.state.steps = [finishWith(1)];
    expect((await r.failure(r.session('A', { store_id: undefined }), ['get_order'])).code).toBe('CODEMODE_UNAVAILABLE');
    expect(r.transport.invoke).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ case 5 */

describe('(5) two executions of different stores interleaved', () => {
  async function tick(times = 4) {
    for (let i = 0; i < times; i++) await new Promise((resolve) => setImmediate(resolve));
  }

  it('journals, nonces, tenant ids, tool contexts and results never cross', async () => {
    const r = rig();
    captureLogs(r);
    // Both runs must be inside round 1 together; delays differ so awaits interleave.
    let arrived = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    r.state.onInvoke = async (req, tenantId) => {
      if (req.round === 1 && ++arrived === 2) release();
      if (req.round === 1) await gate;
      await tick(tenantId === codeModeTenantId(1) ? 1 : 5);
    };
    r.state.respond = (req, tenantId) => {
      const own = tenantId === codeModeTenantId(1);
      if (req.round === 1) return pending(['get_order', { order_id: own ? 100 : 200 }], ['get_product', { product_id: own ? 700 : 800 }])(req);
      if (req.round === 2) return pending(['get_customer_history', { customer_id: own ? 500 : 600 }])(req);
      return finishWithJournal(req);
    };
    const tools = ['get_order', 'get_product', 'get_customer_history'];
    const [a, b] = await Promise.all([r.run(r.session('A'), tools), r.run(r.session('B'), tools)]);

    expect(JSON.stringify(a.result)).toMatch(SECRET_A);
    expect(JSON.stringify(a.result)).not.toMatch(SECRET_B);
    expect(JSON.stringify(b.result)).toMatch(SECRET_B);
    expect(JSON.stringify(b.result)).not.toMatch(SECRET_A);
    expect(a.run_id).not.toBe(b.run_id);

    const forA = r.state.byTenant.get(codeModeTenantId(1))!;
    const forB = r.state.byTenant.get(codeModeTenantId(2))!;
    expect(forA).toHaveLength(3);
    expect(forB).toHaveLength(3);
    expect(JSON.stringify(forA)).not.toMatch(SECRET_B);
    expect(JSON.stringify(forB)).not.toMatch(SECRET_A);
    expect(new Set(forA.map((q) => q.execution_id)).size).toBe(1);
    expect(new Set(forA.map((q) => q.nonce)).size).toBe(1);
    expect(forA[0].execution_id).not.toBe(forB[0].execution_id);
    expect(forA[0].nonce).not.toBe(forB[0].nonce);
    expect(forA[0].seed).not.toBe(forB[0].seed);
    // every tool handler ran under the store of ITS execution
    for (const log of [r.seen.orders, r.seen.customers, r.seen.products]) {
      expect(log).toHaveLength(2);
      expect(log.map((e) => e.store).sort()).toEqual([1, 2]);
    }
    // audit rows are keyed per execution and per tenant hash
    const starts = r.rows.filter((x: any) => x[0] === 'start').map((x: any) => x[1]);
    expect(starts.map((s: any) => s.tenant_hash).sort()).toEqual([codeModeTenantId(1), codeModeTenantId(2)].sort());
    const callRows = r.rows.filter((x: any) => x[0] === 'call') as any[];
    for (const [, id, row] of callRows) {
      const ofA = id === a.run_id;
      expect(JSON.stringify(row)).not.toMatch(ofA ? SECRET_B : SECRET_A);
    }
    expect(r.logs.join('\n')).not.toMatch(/SECRET-/);
  });

  it('a Lambda that answers run A with the execution_id/nonce of the concurrent run B is refused; B is unaffected', async () => {
    const r = rig();
    let arrived = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    r.state.onInvoke = async (req) => {
      if (req.round === 1 && ++arrived === 2) release();
      if (req.round === 1) await gate;
    };
    r.state.respond = (req, tenantId) => {
      const own = tenantId === codeModeTenantId(1);
      if (req.round === 1) return pending(['get_order', { order_id: own ? 100 : 200 }])(req);
      if (own) {
        const other = r.state.byTenant.get(codeModeTenantId(2))![0];
        return { ...finishWith('stolen')(req), execution_id: other.execution_id, nonce: other.nonce };
      }
      return finishWithJournal(req);
    };
    const [a, b] = await Promise.allSettled([r.run(r.session('A'), ['get_order']), r.run(r.session('B'), ['get_order'])]);
    expect(a.status).toBe('rejected');
    expect((a as PromiseRejectedResult).reason.code).toBe('CODEMODE_PROTOCOL');
    expect(b.status).toBe('fulfilled');
    expect(JSON.stringify((b as PromiseFulfilledResult<any>).value.result)).toMatch(SECRET_B);
    expect(JSON.stringify((b as PromiseFulfilledResult<any>).value.result)).not.toMatch(SECRET_A);
  });

  it('flipping one run\'s session store does not abort or contaminate the other concurrent run', async () => {
    const r = rig();
    const ctxA = r.session('A');
    let arrived = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    r.state.onInvoke = async (req, tenantId) => {
      if (req.round === 1 && ++arrived === 2) release();
      if (req.round === 1) await gate;
      if (req.round === 1 && tenantId === codeModeTenantId(1)) ctxA.store_id = 2;
    };
    r.state.respond = (req, tenantId) =>
      req.round === 1
        ? pending(['get_order', { order_id: tenantId === codeModeTenantId(1) ? 100 : 200 }])(req)
        : finishWithJournal(req);
    const [a, b] = await Promise.allSettled([r.run(ctxA, ['get_order']), r.run(r.session('B'), ['get_order'])]);
    expect((a as PromiseRejectedResult).reason.code).toBe('CODEMODE_TENANT_CHANGED');
    expect(b.status).toBe('fulfilled');
    expect(JSON.stringify((b as PromiseFulfilledResult<any>).value.result)).not.toMatch(SECRET_A);
    // run A never executed anything; the only tool call is B's, under store 2
    expect(r.seen.orders).toEqual([{ store: 2, id: 200 }]);
  });

  it('the per-store admission lock lives in the audit layer: a second run for the SAME store while one is open is refused as unavailable', async () => {
    const r = rig();
    r.audit.start.mockImplementationOnce(async () => undefined).mockImplementationOnce(async () => {
      throw new ConflictException('busy');
    });
    r.state.steps = [finishWith(1)];
    await r.run(r.session('A'), ['get_order']);
    expect((await r.failure(r.session('A'), ['get_order'])).code).toBe('CODEMODE_UNAVAILABLE');
  });
});

/* ------------------------------------------------------------------ case 6 */

describe('(6) organization-scope tool with a store-level role', () => {
  const ORG_TOOL = 'get_consolidation_status';
  const ORG_PERM = 'store:accounting:consolidation:read';

  it('a session without the organization permission cannot put the tool in the manifest', async () => {
    const r = rig();
    r.state.steps = [finishWith(1)];
    expect((await r.failure(r.session('A'), [ORG_TOOL])).code).toBe('CODEMODE_DENIED');
    expect(r.transport.invoke).not.toHaveBeenCalled();
    expect(r.spyHandler).not.toHaveBeenCalled();
  });

  it('a FORGED session snapshot that claims the permission (and owner/super-admin) is overridden by the roles in the DB', async () => {
    const r = rig();
    r.state.steps = [finishWith(1)];
    const forged = r.session('A', {
      permissions: [...PERMS, ORG_PERM],
      is_owner: true,
      is_super_admin: true,
      roles: ['super_admin', 'owner'],
    });
    // the registry offers the tool to the forged snapshot, so the turn lets it through...
    const error = await r.failure(forged, [ORG_TOOL], { revalidate: async () => [ORG_TOOL] });
    // ...but the re-derived authority (DB roles of store A) does not hold the permission
    expect(error.code).toBe('CODEMODE_DENIED');
    expect(r.transport.invoke).not.toHaveBeenCalled();
    expect(r.spyHandler).not.toHaveBeenCalled();
  });

  it('a role bound to ANOTHER store or ANOTHER organization is ignored even if the user holds it elsewhere', async () => {
    for (const [label, assignment] of [
      ['role of store B', { store_id: 2, org: 20 }],
      ['role of another organization assigned to this store', { store_id: 1, org: 20 }],
    ] as const) {
      const r = rig();
      r.world.assignments.push({
        user_id: 31,
        store_id: assignment.store_id,
        roles: {
          id: 99, name: 'consolidator', organization_id: assignment.org, store_id: assignment.store_id === 1 ? 2 : assignment.store_id,
          is_system_role: false, role_permissions: [{ permissions: { name: ORG_PERM, status: 'active' } }],
        },
      });
      r.state.steps = [finishWith(1)];
      const forged = r.session('A', { permissions: [...PERMS, ORG_PERM] });
      const error = await r.failure(forged, [ORG_TOOL]);
      expect({ label, code: error.code }).toEqual({ label, code: 'CODEMODE_DENIED' });
      expect(r.spyHandler).not.toHaveBeenCalled();
    }
  });

  it('an inactive permission row or a user in another organization is denied', async () => {
    const r = rig();
    r.world.assignments[0].roles.role_permissions.push({ permissions: { name: ORG_PERM, status: 'inactive' } });
    r.state.steps = [finishWith(1)];
    expect((await r.failure(r.session('A', { permissions: [...PERMS, ORG_PERM] }), [ORG_TOOL])).code).toBe('CODEMODE_DENIED');
    const s = rig();
    s.world.users.set(31, { id: 31, organization_id: 99, state: 'active', locked_until: null });
    s.state.steps = [finishWith(1)];
    expect((await s.failure(s.session('A'), ['get_order'])).code).toBe('CODEMODE_DENIED');
    expect(s.transport.invoke).not.toHaveBeenCalled();
  });

  it('a Lambda that asks for the organization tool although the manifest only declared store tools is a protocol error', async () => {
    const r = rig();
    r.state.steps = [pending([ORG_TOOL, {}])];
    expect((await r.failure(r.session('A'), ['get_order'])).code).toBe('CODEMODE_PROTOCOL');
    expect(r.spyHandler).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ case 7 */

describe('(7) tool without permission for the role, or permission revoked mid-execution', () => {
  it('a role without store:orders:read cannot declare get_order: denied before any Lambda round', async () => {
    const r = rig();
    r.world.assignments[0].roles.role_permissions = r.world.assignments[0].roles.role_permissions.filter(
      (p) => p.permissions.name !== 'store:orders:read',
    );
    r.state.steps = [finishWith(1)];
    expect((await r.failure(r.session('A'), ['get_order'])).code).toBe('CODEMODE_DENIED');
    expect(r.transport.invoke).not.toHaveBeenCalled();
    noToolRan(r);
  });

  it('revoked between round 1 and round 2: call 1 ran, call 2 is denied, the tool never runs again, the script sees an error', async () => {
    const r = rig();
    r.state.steps = [pending(['get_order', { order_id: 100 }]), pending(['get_order', { order_id: 100 }]), finishWithJournal];
    let n = 0;
    r.state.onInvoke = () => {
      if (++n === 2)
        r.world.assignments[0].roles.role_permissions = r.world.assignments[0].roles.role_permissions.filter(
          (p) => p.permissions.name !== 'store:orders:read',
        );
    };
    const result = await r.run(r.session('A'), ['get_order']);
    expect(r.ordersService.findOne).toHaveBeenCalledTimes(1);
    expect(result.calls.map((c) => c.status)).toEqual(['ok', 'denied']);
    expect(r.state.requests[2].journal[1].outcome).toMatchObject({ ok: false });
    expect(finishOutcome(r)).toBe('partial');
  });

  it('revoked WHILE the read runs: the result is never published (post-dispatch re-authorization)', async () => {
    const r = rig();
    r.state.steps = [pending(['get_order', { order_id: 100 }]), finishWithJournal];
    r.hooks.afterRead = () => {
      r.world.assignments[0].roles.role_permissions = [];
    };
    const result = await r.run(r.session('A'), ['get_order']);
    expect(result.calls[0].status).toBe('denied');
    expect(JSON.stringify(r.state.requests[1].journal)).not.toMatch(SECRET_A);
    expect(JSON.stringify(result)).not.toMatch(SECRET_A);
  });

  it.each([
    ['the role assignment is removed', (r: Rig) => r.world.assignments.splice(0, 1)],
    ['the user is locked', (r: Rig) => r.world.users.set(31, { id: 31, organization_id: 10, state: 'active', locked_until: new Date(Date.now() + 60_000) })],
    ['the user is deactivated', (r: Rig) => r.world.users.set(31, { id: 31, organization_id: 10, state: 'inactive', locked_until: null })],
    ['the store is deactivated', (r: Rig) => r.world.stores.set(1, { id: 1, organization_id: 10, is_active: false })],
    ['the subscription gate closes', (r: Rig) => Object.assign(r.world.gate, { allowed: false })],
  ])('mid-execution, when %s the next call is denied and its tool never runs', async (_label, revoke) => {
    const r = rig();
    r.state.steps = [pending(['get_order', { order_id: 100 }]), finishWithJournal];
    r.state.onInvoke = () => {
      revoke(r);
    };
    const result = await r.run(r.session('A'), ['get_order']).catch((e) => e);
    // either the call is denied (script sees the error) or the run aborts; the tool must not have run
    expect(r.ordersService.findOne).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(SECRET_A);
  });

  it('the turn stops authorizing the tool (revalidate): the call is denied, not executed', async () => {
    const r = rig();
    r.state.steps = [pending(['get_order', { order_id: 100 }]), finishWithJournal];
    let n = 0;
    const result = await r.run(r.session('A'), ['get_order'], { revalidate: async () => (++n === 1 ? ['get_order'] : []) });
    expect(result.calls[0].status).toBe('denied');
    expect(r.ordersService.findOne).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ case 8 */

describe('(8) tool outside the allowlist or a write tool', () => {
  it('a write tool in the manifest is denied before any round (handler never runs)', async () => {
    const r = rig();
    expect(r.writeTool.requiresConfirmation).toBe(true);
    r.state.steps = [finishWith(1)];
    expect((await r.failure(r.session('A'), [r.writeTool.name])).code).toBe('CODEMODE_DENIED');
    expect(r.transport.invoke).not.toHaveBeenCalled();
    noToolRan(r);
  });

  it('a script-runner / out-of-list tool (run_analysis, and a real read tool that is not allowlisted) is denied', async () => {
    const names = ['run_analysis', ...(rig().unlisted ? [rig().unlisted!.name] : [])];
    for (const name of names) {
      const r = rig();
      r.state.steps = [finishWith(1)];
      expect((await r.failure(r.session('A'), [name])).code).toBe('CODEMODE_DENIED');
      expect(r.transport.invoke).not.toHaveBeenCalled();
      noToolRan(r);
    }
  });

  it('an allowlisted tool whose LIVE definition became a write (drift) is not eligible', async () => {
    const r = rig();
    r.registry.register({ ...r.registry.get('get_order')!, requiresConfirmation: true } as never);
    r.state.steps = [finishWith(1)];
    expect((await r.failure(r.session('A'), ['get_order'])).code).toBe('CODEMODE_DENIED');
    noToolRan(r);
  });

  it('an allowlisted tool whose parameters drifted from the audited hash is not eligible', async () => {
    const r = rig();
    const live = r.registry.get('get_order')!;
    r.registry.register({ ...live, parameters: { type: 'object', properties: { sneaky: { type: 'string' } } } } as never);
    r.state.steps = [finishWith(1)];
    expect((await r.failure(r.session('A'), ['get_order'])).code).toBe('CODEMODE_DENIED');
  });

  it.each(['__proto__', 'constructor', 'toString', 'run_code', 'run_readonly_script', 'GET_ORDER', 'get_order ', '../get_order', 'does_not_exist'])(
    'the name %j is denied in the manifest',
    async (name) => {
      const r = rig();
      r.state.steps = [finishWith(1)];
      expect((await r.failure(r.session('A'), [name])).code).toBe('CODEMODE_DENIED');
      expect(r.transport.invoke).not.toHaveBeenCalled();
    },
  );

  it('a hostile Lambda that calls a write / unlisted tool NOT declared in the manifest is a protocol error and nothing runs', async () => {
    for (const name of [rig().writeTool.name, 'run_analysis', 'get_consolidation_status', 'constructor']) {
      const r = rig();
      r.state.steps = [pending([name, {}])];
      expect((await r.failure(r.session('A'), ['get_order'])).code).toBe('CODEMODE_PROTOCOL');
      noToolRan(r);
    }
  });

  it('declared read tool + schema-breaking or non-plain args from the Lambda: denied per call, tool never runs', async () => {
    const hostile: Array<Record<string, unknown>> = [
      { order_id: 'x; DROP TABLE orders' },
      { order_id: 100, nested: { a: { b: { c: { d: { e: { f: { g: { h: { i: { j: { k: { l: { m: { n: { o: { p: { q: 1 } } } } } } } } } } } } } } } } } },
    ];
    for (const args of hostile) {
      const r = rig();
      r.state.steps = [pending(['get_order', args]), finishWithJournal];
      const result = await r.run(r.session('A'), ['get_order']);
      expect({ args, status: result.calls[0].status }).toEqual({ args, status: 'denied' });
      expect(r.ordersService.findOne).not.toHaveBeenCalled();
    }
  });
});

// Verifier finding A1: with a one-tool manifest, deny() on the empty authorized
// list fires first, so the per-tool checks were never exercised. Two tools, one
// revoked, the other still held.
describe('(7b) multi-tool revocation: the per-tool check denies only the revoked tool', () => {
  it('revoked WHILE the read runs with another tool still held: result never published', async () => {
    const r = rig();
    r.state.steps = [pending(['get_order', { order_id: 100 }]), finishWithJournal];
    r.hooks.afterRead = () => {
      r.world.assignments[0].roles.role_permissions = r.world.assignments[0].roles.role_permissions.filter(
        (p) => p.permissions.name !== 'store:orders:read',
      );
    };
    const result = await r.run(r.session('A'), ['get_order', 'get_product']);
    expect(result.calls[0].status).toBe('denied');
    expect(JSON.stringify(r.state.requests[1].journal)).not.toMatch(SECRET_A);
    expect(JSON.stringify(result)).not.toMatch(SECRET_A);
  });
  it('revoked between rounds with another tool still held: the next call is denied', async () => {
    const r = rig();
    r.state.steps = [pending(['get_product', { product_id: 700 }]), pending(['get_order', { order_id: 100 }]), finishWithJournal];
    let n = 0;
    r.state.onInvoke = () => {
      if (++n === 2)
        r.world.assignments[0].roles.role_permissions = r.world.assignments[0].roles.role_permissions.filter(
          (p) => p.permissions.name !== 'store:orders:read',
        );
    };
    const result = await r.run(r.session('A'), ['get_order', 'get_product']);
    expect(r.ordersService.findOne).not.toHaveBeenCalled();
    expect(result.calls.map((c) => c.status)).toEqual(['ok', 'denied']);
  });
});
