import { RequestContextService } from '@common/context/request-context.service';
import { seedPermissionsAndRoles } from '../../../prisma/seeds/permissions-roles.seed';
import { ErrorCodes } from '../../common/errors';
import { AIToolRegistry, toolAccessProblem } from './ai-tool-registry';
import { createApiBridgeTools } from './bridge/api-bridge.tools';
import { createAiToolboxTools } from './domains/ai-toolbox.tools';
import { uiTools } from './domains/ui.tools';
import type { RegisteredTool } from './interfaces/tool.interface';
import { collectToolCatalog, inertDeps } from './tool-catalog.test-helper';

/**
 * T13 (N4) — the user's role is the only limit on Vex's tools.
 *
 *  - Every tool the backend registers declares an access rule: the
 *    permissions it needs, or `access: 'public'` with a written reason.
 *    `register()` refuses anything else, so the backend cannot boot with an
 *    open tool, and the registry fails closed if one slips in anyway.
 *  - The owner is never locked out by the seed: every permission a tool asks
 *    for exists in `permissions-roles.seed.ts` and the owner and admin roles
 *    receive it.
 *  - The API bridge, workers without permissions and the execute path all
 *    fail closed; there is no super_admin shortcut at the AI layer.
 */

/**
 * Reviewed list: a tool joins it only with a written `accessReason` saying
 * why no role can be denied it (agent scaffolding, data already scoped to the
 * caller). A business-data tool must declare permissions instead.
 */
const PUBLIC_TOOLS = [
  // api-bridge: per-route permission check + the caller's own token
  'list_endpoints',
  'call_endpoint',
  'write_endpoint',
  // capability catalog metadata
  'list_capabilities',
  'explain_capability',
  // ai-toolbox over the caller's chat content
  'ai_extract_document',
  // checks the read permission of each table it matches, section by section
  'validate_extraction',
  'ai_summarize',
  'ai_write_copy',
  'ai_generate_image',
  'list_attachments',
  // business identity every store member sees
  'get_store_profile',
  // sandbox re-derives live permissions
  'run_readonly_script',
  // agent scaffolding
  'search_tools',
  'suggest_followup',
  'propose_plan',
  'update_plan_step',
  'verify_deliverables',
  'ask_user',
  'revise_plan',
  'pause_plan',
  'resume_plan',
  'search_playbooks',
  'load_playbook',
  'search_recipes',
  'load_recipe',
  'queue_task',
  'bulk_prepare',
  'vex_render_table',
  'vex_render_chart',
  'vex_render_kpi',
  'vex_render_timeline',
  'vex_render_list',
  'vex_render_image',
  'vex_render_file',
  'vex_block_read',
  'vex_block_transform',
  // pure decimal arithmetic over the arguments: reads no business table
  'compute',
  // the caller's own reminders
  'list_reminders',
  'create_reminder',
  'update_reminder',
  'complete_reminder',
  'delete_reminder',
  // mirrors of auth-only subscription reads (banner/paywall)
  'get_subscription_access',
  'get_ai_usage',
  // help center: published, platform-wide content; no store data
  'search_help',
  'get_help_article',
  // published learning paths; the progress it shows is the caller's own
  'get_learning_path',
  // writes only the caller's own progress, and only on a published video
  'mark_learning_progress',
  // published how-to guides, read-only; load_skill filters by agent_keys (H7)
  'search_skills',
  'load_skill',
  // client-side UI commands: the browser dispatcher applies the panel's
  // visibility chain; the server never executes them
  ...uiTools.map((t) => t.name),
].sort();

const confirmations = { issue: jest.fn(), redeem: jest.fn() };
const params = { type: 'object', properties: {}, required: [] };

function tool(over: Partial<RegisteredTool> = {}): RegisteredTool {
  return {
    name: 'probe_tool',
    domain: 'orders',
    description: 'Probe tool for the role gate.',
    parameters: params,
    readOnly: true,
    handler: jest.fn().mockResolvedValue('{"ok":true}'),
    ...over,
  };
}

function inContext<T>(
  ctx: Record<string, unknown> | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  if (!ctx) return fn();
  return RequestContextService.asyncLocalStorage.run(ctx as any, fn);
}

const OWNER_CTX = {
  user_id: 1,
  store_id: 10,
  organization_id: 100,
  roles: ['owner'],
  permissions: ['store:orders:read', 'store:orders:cancel'],
};

/**
 * Runs the real permission seed against an in-memory client (with the
 * `(path, method)` unique the table enforces) until the admin role is synced,
 * and returns the permission names created and those owner/admin received.
 */
async function seededPermissions(): Promise<{
  created: Set<string>;
  owner: Set<string>;
  admin: Set<string>;
}> {
  const STOP = new Error('stop-after-admin');
  const perms: Array<{ id: number; name: string; path: string; method: string }> = [];
  const roles: Array<{ id: number; name: string }> = [];
  const grants = new Map<number, Set<number>>();
  const roleId = (name: string) => roles.find((r) => r.name === name)?.id;
  const names = (ids: Set<number> | undefined) =>
    new Set([...(ids ?? [])].map((id) => perms.find((p) => p.id === id)!.name));
  const client = {
    permissions: {
      findUnique: async ({ where }: any) =>
        perms.find((p) => p.name === where.name) ?? null,
      create: async ({ data }: any) => {
        if (perms.some((p) => p.path === data.path && p.method === data.method)) {
          throw Object.assign(new Error('unique (path, method)'), { code: 'P2002' });
        }
        const row = { id: perms.length + 1, ...data };
        perms.push(row);
        return row;
      },
      findMany: async () => perms,
    },
    roles: {
      findFirst: async () => null,
      create: async ({ data }: any) => {
        const row = { id: roles.length + 1, ...data };
        roles.push(row);
        return row;
      },
    },
    role_permissions: {
      createMany: async ({ data }: any) => {
        for (const { role_id, permission_id } of data) {
          if (!grants.has(role_id)) grants.set(role_id, new Set());
          grants.get(role_id)!.add(permission_id);
        }
        if (data[0]?.role_id === roleId('admin')) throw STOP;
        return { count: data.length };
      },
      deleteMany: async () => ({ count: 0 }),
    },
  };
  const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  try {
    await expect(seedPermissionsAndRoles(client as any)).rejects.toBe(STOP);
  } finally {
    log.mockRestore();
  }
  return {
    created: new Set(perms.map((p) => p.name)),
    owner: names(grants.get(roleId('owner')!)),
    admin: names(grants.get(roleId('admin')!)),
  };
}

describe('T13 role gate — the whole tool catalog', () => {
  const catalog = collectToolCatalog();

  it('collects the backend catalog from every tool factory', () => {
    expect(catalog.length).toBeGreaterThan(300);
    const names = new Set(catalog.map((c) => c.tool.name));
    for (const name of [
      'list_endpoints',
      'semantic_search',
      'get_report',
      'create_reminder',
      'vex_render_table',
      'get_store_profile',
      'get_subscription_access',
      'ui_navigate',
    ]) {
      expect(names).toContain(name);
    }
  });

  it('every tool declares an access rule (permissions, or public with a reason)', () => {
    const problems = catalog
      .map(({ tool: t, source }) => ({ name: t.name, source, problem: toolAccessProblem(t) }))
      .filter((r) => r.problem !== null);
    expect(problems).toEqual([]);
  });

  it('public tools are exactly the reviewed list; everything else needs a permission', () => {
    const publicNames = [
      ...new Set(catalog.filter((c) => c.tool.access === 'public').map((c) => c.tool.name)),
    ].sort();
    expect(publicNames).toEqual(PUBLIC_TOOLS);
  });

  it('the whole catalog registers, so the backend boots', () => {
    const registry = new AIToolRegistry(confirmations as any);
    expect(() => registry.registerMany(catalog.map((c) => c.tool))).not.toThrow();
  });

  it('a user without permissions only sees public tools; the owner sees every tool', () => {
    const registry = new AIToolRegistry(confirmations as any);
    registry.registerMany(catalog.map((c) => c.tool));
    const visible = registry.getAvailableDefinitions([]).map((d) => d.function.name).sort();
    expect(visible).toEqual(PUBLIC_TOOLS);
    const every = [...new Set(catalog.flatMap((c) => c.tool.requiredPermissions ?? []))];
    expect(registry.getAvailableDefinitions(every)).toHaveLength(registry.getAll().length);
    expect(registry.getDeniedPermissions(every)).toEqual([]);
  });

  it('every permission a tool asks for exists in the seed, and the owner and admin roles hold it', async () => {
    const { created, owner, admin } = await seededPermissions();
    expect(created.size).toBeGreaterThan(100);
    const required = new Map<string, string[]>();
    for (const { tool: t } of catalog) {
      for (const p of t.requiredPermissions ?? []) {
        required.set(p, [...(required.get(p) ?? []), t.name]);
      }
    }
    const report = (held: Set<string>) =>
      [...required.entries()]
        .filter(([p]) => !held.has(p))
        .map(([p, tools]) => `${p} ← ${tools.join(', ')}`);
    expect({ missingFromSeed: report(created) }).toEqual({ missingFromSeed: [] });
    expect({ missingFromOwner: report(owner) }).toEqual({ missingFromOwner: [] });
    expect({ missingFromAdmin: report(admin) }).toEqual({ missingFromAdmin: [] });
  });
});

describe('T13 role gate — the registry fails closed', () => {
  it('register() refuses a tool without an access rule', () => {
    const registry = new AIToolRegistry(confirmations as any);
    expect(() => registry.register(tool())).toThrow(
      /cannot be registered: it declares neither requiredPermissions nor access: 'public'/,
    );
    expect(() => registry.register(tool({ requiredPermissions: [] }))).toThrow(/neither/);
    expect(() => registry.register(tool({ requiredPermissions: [' '] }))).toThrow(/empty entry/);
    expect(() => registry.register(tool({ access: 'public' }))).toThrow(/needs an accessReason/);
    expect(() =>
      registry.register(tool({ access: 'public', accessReason: '  ' })),
    ).toThrow(/needs an accessReason/);
    expect(() =>
      registry.register(
        tool({ access: 'public', accessReason: 'x', requiredPermissions: ['store:orders:read'] }),
      ),
    ).toThrow(/public and also requires permissions/);
    expect(registry.getAll()).toEqual([]);
  });

  it('a tool that bypasses register() is hidden and denied even to a user holding everything', async () => {
    const registry = new AIToolRegistry(confirmations as any);
    const open = tool({ name: 'sneaky_open_tool' });
    (registry as any).tools.set(open.name, open);
    expect(registry.getAvailableDefinitions(OWNER_CTX.permissions)).toEqual([]);
    await expect(
      inContext(OWNER_CTX, () => registry.executeTool(open.name, {})),
    ).rejects.toMatchObject({ errorCode: ErrorCodes.AI_AGENT_004.code });
    expect(open.handler).not.toHaveBeenCalled();
  });

  it('a permissioned tool is hidden from a role without it and the denied area is reported', async () => {
    const registry = new AIToolRegistry(confirmations as any);
    const cancel = tool({
      name: 'cancel_order_probe',
      requiredPermissions: ['store:orders:cancel'],
    });
    const helper = tool({ name: 'plan_probe', access: 'public', accessReason: 'scaffolding' });
    registry.registerMany([cancel, helper]);
    const adminWithoutCancel = ['store:orders:read'];
    expect(registry.getAvailableDefinitions(adminWithoutCancel).map((d) => d.function.name)).toEqual([
      'plan_probe',
    ]);
    expect(registry.getDeniedPermissions(adminWithoutCancel)).toEqual(['store:orders:cancel']);
    await expect(
      inContext({ ...OWNER_CTX, permissions: adminWithoutCancel }, () =>
        registry.executeTool('cancel_order_probe', {}),
      ),
    ).rejects.toMatchObject({ errorCode: ErrorCodes.AI_AGENT_004.code });
    expect(cancel.handler).not.toHaveBeenCalled();
    // The owner holds it: offered and executed.
    expect(registry.getAvailableDefinitions(OWNER_CTX.permissions)).toHaveLength(2);
    await inContext(OWNER_CTX, () => registry.executeTool('cancel_order_probe', {}));
    expect(cancel.handler).toHaveBeenCalledTimes(1);
  });

  it('a worker or subagent without permissions fails closed (no context, or empty permissions and roles)', async () => {
    const registry = new AIToolRegistry(confirmations as any);
    const read = tool({ name: 'orders_probe', requiredPermissions: ['store:orders:read'] });
    registry.register(read);
    expect(registry.getAvailableDefinitions(undefined)).toEqual([]);
    await expect(registry.executeTool('orders_probe', {})).rejects.toMatchObject({
      errorCode: ErrorCodes.AI_AGENT_004.code,
    });
    await expect(
      inContext({ store_id: 10, user_id: 1, permissions: [], roles: [] }, () =>
        registry.executeTool('orders_probe', {}),
      ),
    ).rejects.toMatchObject({ errorCode: ErrorCodes.AI_AGENT_004.code });
    expect(read.handler).not.toHaveBeenCalled();
  });

  it('a public tool runs with no permissions at all', async () => {
    const registry = new AIToolRegistry(confirmations as any);
    const helper = tool({ name: 'plan_probe', access: 'public', accessReason: 'scaffolding' });
    registry.register(helper);
    await inContext({ store_id: 10, user_id: 1, permissions: [], roles: [] }, () =>
      registry.executeTool('plan_probe', {}),
    );
    expect(helper.handler).toHaveBeenCalledTimes(1);
  });
});

describe('T13 role gate — API bridge', () => {
  const entry = {
    path: 'store/orders',
    method: 'GET',
    requiredPermissions: ['store:orders:read'],
    queryParams: [],
  };
  const catalogDeps = {
    find: jest.fn().mockReturnValue(entry),
    methodsFor: jest.fn().mockReturnValue([]),
  };
  const callEndpoint = () =>
    createApiBridgeTools({ catalog: catalogDeps as any, attachments: inertDeps() }).find(
      (t) => t.name === 'call_endpoint',
    )!;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response('{"data":[]}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
  });
  afterEach(() => fetchSpy.mockRestore());

  it('refuses before dispatching when the caller lacks the route permission, even as super_admin', async () => {
    const out = await inContext(
      {
        ...OWNER_CTX,
        roles: ['super_admin'],
        is_super_admin: true,
        permissions: ['store:products:read'],
        access_token: 'user-token',
      },
      () => callEndpoint().handler!({ path: 'store/orders' }, {} as any),
    );
    expect(JSON.parse(out as string).error).toMatch(/store:orders:read/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('dispatches with the caller own token, never a service credential', async () => {
    await inContext({ ...OWNER_CTX, access_token: 'user-token' }, () =>
      callEndpoint().handler!({ path: 'store/orders' }, {} as any),
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer user-token');
  });

  it('without the caller credential it does not dispatch at all', async () => {
    const out = await inContext({ ...OWNER_CTX, access_token: undefined }, () =>
      callEndpoint().handler!({ path: 'store/orders' }, {} as any),
    );
    expect(JSON.parse(out as string).error).toMatch(/credencial/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('T13 role gate — validate_extraction reads each table only with its permission', () => {
  const toolbox = {
    matchExtractionSupplier: jest.fn().mockResolvedValue({ matched: true, id: 7 }),
    matchExtractionItems: jest.fn().mockResolvedValue([{ matched: true, id: 3 }]),
    matchExtractionPeople: jest.fn().mockResolvedValue([]),
    listExpenseCategoriesForExtraction: jest.fn().mockResolvedValue([{ id: 1 }]),
  };
  const validate = () =>
    createAiToolboxTools({
      toolbox: toolbox as any,
      attachments: inertDeps(),
      s3: inertDeps(),
    }).find((t) => t.name === 'validate_extraction')!;
  const args = {
    domain: 'gastos',
    supplier_name: 'Proveedor SAS',
    items: [{ description: 'Arriendo' }],
  };
  const ctx = (permissions: string[]) => ({ ...OWNER_CTX, permissions });

  beforeEach(() => jest.clearAllMocks());

  it('a role without supplier and expense reads gets «tu rol no permite» and those tables are never read', async () => {
    const out = JSON.parse(
      (await inContext(ctx(['store:products:read']), () =>
        validate().handler!(args, { store_id: 10, organization_id: 100 } as any),
      )) as string,
    );
    expect(out.denied).toEqual(['proveedores', 'categorías de gasto']);
    expect(out.summary.verdict).toBe(
      'Tu rol no permite consultar proveedores, categorías de gasto.',
    );
    expect(out.next_step).toMatch(/pida al dueño/);
    expect(toolbox.matchExtractionSupplier).not.toHaveBeenCalled();
    expect(toolbox.listExpenseCategoriesForExtraction).not.toHaveBeenCalled();
    expect(toolbox.matchExtractionItems).toHaveBeenCalledTimes(1);
  });

  it('the owner reads every section', async () => {
    const out = JSON.parse(
      (await inContext(
        ctx([
          'store:inventory:suppliers:read',
          'store:products:read',
          'store:customers:read',
          'store:expenses:read',
        ]),
        () => validate().handler!(args, { store_id: 10, organization_id: 100 } as any),
      )) as string,
    );
    expect(out.denied).toBeUndefined();
    expect(out.supplier).toEqual({ matched: true, id: 7 });
    expect(out.expense_categories).toEqual([{ id: 1 }]);
    expect(out.summary.unmatched).toBe(0);
  });
});
