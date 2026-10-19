import { ForbiddenException } from '@nestjs/common';
import {
  RequestContext,
  RequestContextService,
} from '../../common/context/request-context.service';
import { buildActiveUserRolesWhere } from '../../common/utils/role-scope.util';
import { AIToolRegistry } from '../tools/ai-tool-registry';
import { createProductTools } from '../tools/domains/products.tools';
import {
  RegisteredTool,
  ToolExecutionResult,
} from '../tools/interfaces/tool.interface';
import { normalizeToolResult } from '../tools/tool-result.normalizer';
import {
  SandboxPolicyService,
  SANDBOX_READONLY_ALLOWLIST,
} from './sandbox-policy.service';

describe('SandboxPolicyService: release audit and fresh tenant authority', () => {
  const snapshot: RequestContext = {
    user_id: 7,
    organization_id: 3,
    store_id: 5,
    permissions: ['store:products:read', 'new:permission'],
    roles: ['owner'],
    is_owner: true,
    is_super_admin: false,
    access_token: 'host-only-synthetic-bearer',
  };
  const product = (patch: Record<string, unknown> = {}) => ({
    product_id: 12,
    name: 'Producto QA',
    sku: 'QA',
    brand: null,
    state: 'active',
    product_type: 'physical',
    net_price: 12.34,
    unit_price: 14.68,
    inventory_tracked: true,
    available_stock: 3,
    has_variants: false,
    variant_count: 0,
    requires_variant_selection: false,
    ...patch,
  });
  const page = (patch: Record<string, unknown> = {}) => ({
    currency: 'COP',
    page: 1,
    limit: 10,
    returned: 1,
    total: 1,
    total_pages: 1,
    has_more: false,
    products: [product()],
    ...patch,
  });
  const request = (patch: Record<string, unknown> = {}) => ({
    source: 'return await tools.list_products({});',
    language: 'javascript',
    tools: ['list_products'],
    purpose: 'pagination',
    ...patch,
  });
  let registry: AIToolRegistry;
  let service: SandboxPolicyService;
  let tool: RegisteredTool;
  let prisma: Record<string, { findUnique?: jest.Mock; findMany?: jest.Mock }>;
  let access: { canUseAIFeature: jest.Mock; getAIFeatureConfig: jest.Mock };
  let products: { findAll: jest.Mock };
  let currentUser: Record<string, unknown>;
  let currentStore: Record<string, unknown>;
  let currentAgent: Record<string, unknown>;
  let settings: Record<string, unknown>;
  let permissionRows: Array<{ permissions: { name: string; status: string } }>;
  let currentRoles: Array<Record<string, unknown>>;

  beforeEach(() => {
    registry = new AIToolRegistry({} as never);
    products = {
      findAll: jest
        .fn()
        .mockResolvedValue({ data: [], meta: { total: 0, totalPages: 0 } }),
    };
    tool = createProductTools({
      productsService: products as never,
      priceResolver: {} as never,
      settingsService: {
        getStoreCurrency: jest.fn().mockResolvedValue('COP'),
      } as never,
    }).find((candidate) => candidate.name === 'list_products')!;
    registry.register(tool);
    currentUser = {
      id: 7,
      organization_id: 3,
      state: 'active',
      locked_until: null,
    };
    currentStore = { id: 5, organization_id: 3, is_active: true };
    currentAgent = {
      is_active: true,
      allowed_tools: ['products'],
      denied_tools: [],
    };
    settings = {
      settings: { vexi: { enabled: true }, vex: { enabled: true } },
    };
    permissionRows = [
      { permissions: { name: 'store:products:read', status: 'active' } },
      { permissions: { name: 'only:current', status: 'active' } },
    ];
    currentRoles = [
      {
        user_id: 7,
        store_id: null,
        roles: {
          name: 'owner',
          organization_id: null,
          store_id: null,
          is_system_role: true,
          role_permissions: permissionRows,
        },
      },
    ];
    prisma = {
      users: { findUnique: jest.fn(async () => currentUser) },
      stores: { findUnique: jest.fn(async () => currentStore) },
      user_roles: { findMany: jest.fn(async () => currentRoles) },
      ai_agents: { findUnique: jest.fn(async () => currentAgent) },
      store_settings: { findUnique: jest.fn(async () => settings) },
    };
    access = {
      canUseAIFeature: jest
        .fn()
        .mockResolvedValue({ allowed: true, mode: 'allow' }),
      getAIFeatureConfig: jest
        .fn()
        .mockResolvedValue({ enabled: true, tools_allowed: ['products'] }),
    };
    service = new SandboxPolicyService(
      prisma as never,
      access as never,
      registry,
    );
  });

  const authorize = <T>(
    callback: (context: RequestContext, names: string[]) => Promise<T>,
    initial = ['list_products'],
    objective = ['store:products:read'],
  ) => service.authorize(snapshot, 'vexi', initial, objective, callback);
  const denyAuthorization = async () => {
    const callback = jest.fn();
    await expect(authorize(callback)).rejects.toThrow('SANDBOX_DENIED');
    expect(callback).not.toHaveBeenCalled();
    expect(products.findAll).not.toHaveBeenCalled();
  };
  const filter = (data: unknown) =>
    service.filterResult('list_products', normalizeToolResult(data));

  it('accepts single-tool pagination, normalizes CRLF and NFC and copies the manifest', () => {
    const raw = request({
      source: '// Cafe\u0301\r\nreturn tools.list_products({});',
    });
    const parsed = service.validateRequest(raw);
    expect(parsed.source).toBe('// Café\nreturn tools.list_products({});');
    expect(parsed.tools).not.toBe(raw.tools);
    expect(parsed.purpose).toBe('pagination');
  });

  it.each([
    null,
    request({ source: '' }),
    request({ language: 'python' }),
    request({ purpose: 'sum' }),
    request({ purpose: undefined }),
    request({ tools: [] }),
    request({ tools: ['list_products', 'list_products'] }),
    request({ tools: Array(21).fill('list_products') }),
    request({ tools: ['get_low_stock_alerts'] }),
    request({ tools: ['call_endpoint'] }),
    request({ tools: ['ui_navigate'] }),
    request({ tools: ['run_readonly_script'] }),
    request({ context: { store_id: 99 } }),
    request({ source: 'a'.repeat(32769) }),
    request({ source: 'é'.repeat(16385) }),
    request({ source: 'import x from "npm:secret"' }),
    request({ source: 'return import("file:///host")' }),
  ])('rejects unsupported/malicious request %# before admission', (raw) => {
    expect(() => service.validateRequest(raw)).toThrow(ForbiddenException);
  });

  it('pins the real factory v1 parameter and permission contract, not readOnly alone', () => {
    expect(service.eligible(tool)).toBe(true);
    expect(SANDBOX_READONLY_ALLOWLIST).toEqual(['list_products']);
    expect(Object.isFrozen(SANDBOX_READONLY_ALLOWLIST)).toBe(true);
    expect(service.eligible({ ...tool, description: 'Prose may change' })).toBe(
      true,
    );
    for (const patch of [
      { name: 'check_stock_availability' },
      { version: '2' },
      { readOnly: false },
      { clientSide: true },
      { requiresConfirmation: true },
      { handler: undefined },
      { domain: 'inventory' },
      { requiredPermissions: [] },
      { parameters: { ...tool.parameters, additionalProperties: true } },
      {
        parameters: {
          ...tool.parameters,
          properties: {
            ...tool.parameters.properties,
            store_id: { type: 'number' },
          },
        },
      },
    ])
      expect(service.eligible({ ...tool, ...patch })).toBe(false);
    expect(service.eligible(tool, true)).toBe(false);
    expect(
      service.eligible(
        {
          ...tool,
          scheduling: {
            parallelSafe: true,
            idempotent_read: true,
            resource_keys: ['products'],
            max_result_bytes: 65536,
          },
        },
        true,
      ),
    ).toBe(true);
  });

  it('accepts bounded real-schema arguments without coercion', () => {
    const args = {
      category_id: 1,
      brand_id: 2,
      page: 1,
      limit: 25,
      product_type: 'physical',
      state: 'active',
      include_variants: false,
      track_inventory: true,
      is_sellable: false,
      search: 'QA',
    };
    service.assertArgs('list_products', args);
    expect(args.page).toBe(1);
    service.assertArgs('list_products', {});
  });

  it.each([
    null,
    [],
    { page: '1' },
    { page: 0 },
    { page: -1 },
    { page: 1.1 },
    { page: Number.MAX_SAFE_INTEGER },
    { page: Infinity },
    { limit: 26 },
    { limit: 0 },
    { category_id: Number.MAX_SAFE_INTEGER + 1 },
    { category_id: NaN },
    { category_id: null },
    { include_variants: true },
    { search: 'x'.repeat(513) },
    { search: { authorization: 'secret' } },
    { track_inventory: 'true' },
    { product_type: 'unknown' },
    { state: 'deleted' },
    { context: { user_id: 3 } },
    { store_id: 6 },
    { organization_id: 3 },
    { access_token: 'secret' },
    JSON.parse('{"__proto__":{"store_id":6}}'),
    Object.create({ page: 1 }),
  ])('rejects invalid/forged args %# before handler', (args) => {
    expect(() => service.assertArgs('list_products', args)).toThrow(
      'SANDBOX_DENIED',
    );
    expect(products.findAll).not.toHaveBeenCalled();
  });

  it('rejects accessors and cyclic/non-JSON argument transport', () => {
    const getter = jest.fn(() => 1);
    const args = Object.defineProperty({}, 'page', {
      enumerable: true,
      get: getter,
    });
    expect(() => service.assertArgs('list_products', args)).toThrow(
      'SANDBOX_DENIED',
    );
    expect(getter).not.toHaveBeenCalled();
    const cyclic: Record<string, unknown> = {};
    cyclic.context = cyclic;
    expect(() => service.assertArgs('list_products', cyclic)).toThrow(
      'SANDBOX_DENIED',
    );
    expect(() => service.assertArgs('call_endpoint', {})).toThrow(
      'SANDBOX_DENIED',
    );
  });

  it('projects safe fields only and sanitizes credentials/signed URLs while preserving receipts', () => {
    const result = normalizeToolResult(
      page({
        password: 'top-secret',
        context: { store_id: 999 },
        products: [
          product({
            name: 'Bearer synthetic-secret',
            sku: 'https://s3.qa/object?X-Amz-Signature=secret',
            password: 'secret',
            access_token: 'secret',
            variants: [{ secret: 'secret' }],
            supplier: { email: 'private@qa' },
            organization_id: 777,
          }),
        ],
      }),
    );
    result.evidence_refs = ['observation:qa'];
    result.resource_ids = { product_id: 12 };
    const safe = service.filterResult('list_products', result);
    expect(safe.evidence_refs).toEqual(result.evidence_refs);
    expect(safe.resource_ids).toEqual(result.resource_ids);
    expect(safe.effect_status).toBe(result.effect_status);
    expect(safe.pagination).toEqual({
      has_more: false,
      next_cursor: null,
      complete: true,
    });
    expect(JSON.stringify(safe)).not.toContain('synthetic-secret');
    expect(JSON.stringify(safe)).not.toContain('private@qa');
    expect(JSON.stringify(safe)).not.toContain('X-Amz-Signature');
    expect(
      (safe.data as { products: Record<string, unknown>[] }).products[0],
    ).not.toHaveProperty('variants');
    expect(safe.data).not.toHaveProperty('context');
  });

  it('derives pagination from domain metadata and never marks omitted variants complete', () => {
    const later = filter(page({ total: 11, total_pages: 2, has_more: true }));
    expect(later.pagination).toEqual({
      has_more: true,
      next_cursor: 2,
      complete: false,
    });
    const lastPage = filter(
      page({ page: 2, total: 11, total_pages: 2, has_more: false }),
    );
    expect(lastPage.pagination?.complete).toBe(false); // Last page is not the full dataset.
    const variants = filter(
      page({
        products: [
          product({
            has_variants: true,
            requires_variant_selection: true,
            variant_count: 2000,
          }),
        ],
      }),
    );
    expect(variants.pagination?.complete).toBe(false);
    expect((variants.data as Record<string, unknown>).variants_omitted).toBe(
      true,
    );
    const truncated = normalizeToolResult(page());
    truncated.freshness = 'truncated';
    expect(
      service.filterResult('list_products', truncated).pagination?.complete,
    ).toBe(false);
  });

  it('retains error semantics and does not send raw error payload to guest', () => {
    const failed = normalizeToolResult({
      error: 'private connection secret',
      next_step: 'retry',
      error_code: 'DENIED',
    });
    const safe = service.filterResult('list_products', failed);
    expect(safe.status).not.toBe('ok');
    expect(safe.data).toBeNull();
    expect(JSON.stringify(safe)).not.toContain('private connection secret');
    const forged = {
      ...normalizeToolResult(page()),
      data: { ...page(), error: 'failed' },
    };
    expect(() => service.filterResult('list_products', forged)).toThrow(
      'SANDBOX_DENIED',
    );
  });

  it.each([
    { products: undefined },
    { products: Array(26).fill(product()) },
    { page: 0 },
    { limit: 26 },
    { total: undefined },
    { returned: 0 },
    { has_more: true },
    { total_pages: 7 },
    { total: -1 },
    { products: [product({ product_id: 0 })] },
    { products: [product({ variant_count: 1 })] },
    { products: [product({ net_price: '12.34' })] },
  ])('fails closed for malformed domain success %#', (patch) => {
    expect(() => filter(page(patch))).toThrow('SANDBOX_DENIED');
  });

  it('accepts truthful empty pagination', () => {
    const safe = filter(
      page({ products: [], returned: 0, total: 0, total_pages: 0 }),
    );
    expect(safe.status).toBe('ok');
    expect(safe.pagination?.complete).toBe(true);
  });

  it('fresh permission intersection spans entire awaited callback with no fallback and restores ALS', async () => {
    await RequestContextService.runIsolated(snapshot, async () => {
      await authorize(async (context, names) => {
        await Promise.resolve();
        expect(context.permissions).toEqual(['store:products:read']);
        expect(context.roles).toEqual([]);
        expect(context.is_owner).toBe(false);
        expect(context.is_super_admin).toBe(false);
        expect(context.access_token).toBe('host-only-synthetic-bearer');
        expect(RequestContextService.asyncLocalStorage.getStore()).toBe(
          context,
        );
        expect(names).toEqual(['list_products']);
        const result = await registry.executeToolResult('list_products', {});
        expect(result.status).toBe('ok');
      });
      expect(RequestContextService.asyncLocalStorage.getStore()).toBe(snapshot);
    });
    expect(prisma.user_roles.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: buildActiveUserRolesWhere(7, 5),
      }),
    );
    expect(access.canUseAIFeature).toHaveBeenCalledWith(5, 'tool_agents');
    expect(products.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 1,
        limit: 10,
        include_variants: true,
        include_stock: true,
      }),
    );
  });

  it('explicit host identity works without ALS/static fallback, never adopts ambient foreign tenant', async () => {
    const foreign = { ...snapshot, store_id: 999 };
    await RequestContextService.runIsolated(foreign, () =>
      authorize(async (context) => {
        expect(context.store_id).toBe(5);
        expect(
          RequestContextService.asyncLocalStorage.getStore()?.store_id,
        ).toBe(5);
      }),
    );
    await authorize(async (context) => expect(context.store_id).toBe(5));
  });

  it('re-reads revocations on each RPC authorization before any handler', async () => {
    await authorize(async () => undefined);
    permissionRows[0].permissions.status = 'inactive';
    await denyAuthorization();
    expect(prisma.user_roles.findMany).toHaveBeenCalledTimes(2);
  });

  it('does not elevate owner, current-only or snapshot-only permission', async () => {
    permissionRows[0].permissions.name = 'only:current';
    await denyAuthorization();
    permissionRows[0].permissions.name = 'store:products:read';
    const callback = jest.fn();
    await expect(authorize(callback, ['list_products'], [])).rejects.toThrow(
      'SANDBOX_DENIED',
    );
    expect(callback).not.toHaveBeenCalled();
  });

  it('does not erase the kitchen monetary restriction when clearing roles', async () => {
    (currentRoles[0].roles as Record<string, unknown>).name = 'kitchen';
    await denyAuthorization();
    (currentRoles[0].roles as Record<string, unknown>).name = 'owner';
    const callback = jest.fn();
    await expect(
      service.authorize(
        { ...snapshot, roles: ['kitchen'] },
        'vexi',
        ['list_products'],
        ['store:products:read'],
        callback,
      ),
    ).rejects.toThrow('SANDBOX_DENIED');
    expect(callback).not.toHaveBeenCalled();
  });

  it.each([
    'user',
    'store',
    'agent',
    'settings',
    'gate',
    'config',
    'plan-list',
    'deny',
    'allow',
    'locked',
    'inactive',
    'user-org',
    'store-org',
    'store-inactive',
    'roles',
    'role-store',
    'role-org',
  ])('rejects current authority drift: %s', async (reason) => {
    switch (reason) {
      case 'user':
        currentUser = null as never;
        break;
      case 'store':
        currentStore = null as never;
        break;
      case 'agent':
        currentAgent.is_active = false;
        break;
      case 'settings':
        settings = { settings: { vexi: { enabled: false } } };
        break;
      case 'gate':
        access.canUseAIFeature.mockResolvedValue({
          allowed: false,
          mode: 'block',
        });
        break;
      case 'config':
        access.getAIFeatureConfig.mockResolvedValue(null);
        break;
      case 'plan-list':
        access.getAIFeatureConfig.mockResolvedValue({
          enabled: true,
          tools_allowed: [],
        });
        break;
      case 'deny':
        currentAgent.denied_tools = ['products'];
        break;
      case 'allow':
        currentAgent.allowed_tools = ['orders'];
        break;
      case 'locked':
        currentUser.locked_until = new Date(Date.now() + 30000);
        break;
      case 'inactive':
        currentUser.state = 'suspended';
        break;
      case 'user-org':
        currentUser.organization_id = 4;
        break;
      case 'store-org':
        currentStore.organization_id = 4;
        break;
      case 'store-inactive':
        currentStore.is_active = false;
        break;
      case 'roles':
        currentRoles = [];
        break;
      case 'role-store':
        currentRoles[0].store_id = 8;
        break;
      case 'role-org':
        (currentRoles[0].roles as Record<string, unknown>).organization_id = 4;
        break;
    }
    await denyAuthorization();
  });

  it('honors exact plan name, domain and wildcard but never widens initial manifest', async () => {
    for (const tools_allowed of [['list_products'], ['products'], ['*']]) {
      access.getAIFeatureConfig.mockResolvedValue({
        enabled: true,
        tools_allowed,
      });
      await authorize(async (_, names) =>
        expect(names).toEqual(['list_products']),
      );
    }
    const callback = jest.fn();
    await expect(authorize(callback, ['call_endpoint'])).rejects.toThrow(
      'SANDBOX_DENIED',
    );
    expect(callback).not.toHaveBeenCalled();
  });

  it('uses vex_agent gate for Vex and denies missing effective plan list', async () => {
    await service.authorize(
      snapshot,
      'vex',
      ['list_products'],
      ['store:products:read'],
      async () => undefined,
    );
    expect(access.canUseAIFeature).toHaveBeenCalledWith(5, 'vex_agent');
    access.getAIFeatureConfig.mockResolvedValue({ enabled: true });
    await denyAuthorization();
  });

  it('collapses backend errors to generic denial before callbacks', async () => {
    prisma.users.findUnique!.mockRejectedValue(
      new Error('Bearer secret database host'),
    );
    await denyAuthorization();
  });

  it('no user/store/org or objective permission snapshot cannot borrow owner roles', async () => {
    for (const patch of [
      { user_id: undefined },
      { store_id: undefined },
      { organization_id: undefined },
      { permissions: undefined },
      { permissions: [] },
    ]) {
      const callback = jest.fn();
      await expect(
        service.authorize(
          { ...snapshot, ...patch },
          'vexi',
          ['list_products'],
          ['store:products:read'],
          callback,
        ),
      ).rejects.toThrow('SANDBOX_DENIED');
      expect(callback).not.toHaveBeenCalled();
    }
  });
});
