import { ApiKeyFailureLimiter } from '../store/integrations/api-keys/api-key-failure-limiter';
import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, from } from 'rxjs';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { RequestContextInterceptor } from '../../common/interceptors/request-context.interceptor';
import { VendixHttpException } from '../../common/errors';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PERMISSIONS_KEY } from '../auth/decorators/permissions.decorator';
import { ApiKeyGuard } from '../store/integrations/api-keys/api-key.guard';
import { ApiKeyThrottlerGuard } from '../store/integrations/api-keys/api-key-throttler.guard';
import { effectivePermissions } from '../store/integrations/api-keys/api-key.util';
import { ApiV1WorkflowsController } from './api-v1-workflows.controller';
import { IndustryModuleGuard } from '../../common/guards/industry-module.guard';
import { INDUSTRY_MODULE_KEY } from '../../common/decorators/industry-module.decorator';
import {
  buildWorkflowKit,
  purchaseDefinition,
  seedDefinition,
  seedPeople,
} from '../../testing/workflows/workflow-test-kit';

const R = 'store:workflows:read';
const S = 'store:workflows:start';
const T = 'store:workflows:task';
const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];

describe('ApiV1WorkflowsController (metadata)', () => {
  const proto = ApiV1WorkflowsController.prototype as any;

  it('lives under v1/workflows, is @Public (JWT steps aside) and is guarded in order', () => {
    expect(Reflect.getMetadata('path', ApiV1WorkflowsController)).toBe(
      'v1/workflows',
    );
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, ApiV1WorkflowsController)).toBe(
      true,
    );
    expect(Reflect.getMetadata('__guards__', ApiV1WorkflowsController)).toEqual(
      [
        ApiKeyGuard,
        ApiKeyThrottlerGuard,
        PermissionsGuard,
        IndustryModuleGuard,
      ],
    );
  });

  it('carries the same flows industry lock as /api/store/workflows', () => {
    expect(
      Reflect.getMetadata(INDUSTRY_MODULE_KEY, ApiV1WorkflowsController),
    ).toBe('flows');
  });

  it('declares a per-key throttle of 120/min', () => {
    expect(
      Reflect.getMetadata('THROTTLER:LIMITdefault', ApiV1WorkflowsController),
    ).toBe(120);
    expect(
      Reflect.getMetadata('THROTTLER:TTLdefault', ApiV1WorkflowsController),
    ).toBe(60_000);
  });

  const EXPECTED: Array<[string, string[], string, string]> = [
    ['listDefinitions', [R, S], 'GET', 'definitions'],
    ['listInstances', [R, S, T], 'GET', 'instances'],
    ['getInstance', [R, S, T], 'GET', 'instances/:id'],
    ['start', [S], 'POST', 'instances'],
    ['listInbox', [T], 'GET', 'inbox'],
    ['completeTask', [T], 'POST', 'tasks/:id/complete'],
  ];

  it.each(EXPECTED)(
    '%s requires %p and is %s %s',
    (handler, perms, method, path) => {
      const fn = proto[handler];
      expect(Reflect.getMetadata(PERMISSIONS_KEY, fn)).toEqual(perms);
      expect(METHODS[Reflect.getMetadata('method', fn)]).toBe(method);
      expect(Reflect.getMetadata('path', fn)).toBe(path);
    },
  );

  it('exposes exactly those six routes (no design/manage/publish/claim over API keys)', () => {
    const routes = Object.getOwnPropertyNames(proto).filter(
      (n) =>
        n !== 'constructor' &&
        Reflect.getMetadata('path', proto[n]) !== undefined,
    );
    expect(routes.sort()).toEqual(EXPECTED.map((e) => e[0]).sort());
    const all = routes.flatMap((n) =>
      Reflect.getMetadata(PERMISSIONS_KEY, proto[n]),
    );
    expect(all.filter((p: string) => /design|manage|api_keys/.test(p))).toEqual(
      [],
    );
  });

  it('definitions lists active flows only, ignoring a caller-supplied status', async () => {
    const definitions: any = {
      list: jest.fn(async () => ({ data: [], total: 0, page: 1, limit: 10 })),
    };
    const ctrl = new ApiV1WorkflowsController(
      definitions,
      {} as any,
      {} as any,
      {} as any,
      {
        paginated: (d: any) => d,
      } as any,
    );
    await ctrl.listDefinitions({ status: 'draft', search: 'x' } as any);
    expect(definitions.list).toHaveBeenCalledWith({
      status: 'active',
      search: 'x',
    });
  });

  it.each([
    ['start', [{ definition_key: 'purchase' }]],
    ['completeTask', [1, { outcome: 'approve', expected_row_version: 0 }]],
  ])('%s requires the Idempotency-Key header', async (handler, args) => {
    const engine: any = { start: jest.fn(), completeTask: jest.fn() };
    const ctrl: any = new ApiV1WorkflowsController(
      {} as any,
      {} as any,
      {} as any,
      engine,
      {} as any,
    );
    for (const header of [undefined, '', '   ', 'x'.repeat(81)]) {
      await expect(ctrl[handler](...args, header)).rejects.toMatchObject({
        errorCode: 'WORKFLOW_IDEMPOTENCY_KEY_REQUIRED',
      });
    }
    expect(engine.start).not.toHaveBeenCalled();
    expect(engine.completeTask).not.toHaveBeenCalled();
  });
});

/**
 * The real chain, minus HTTP: ApiKeyGuard → PermissionsGuard →
 * RequestContextInterceptor → controller → real services on the in-memory
 * store (two stores).
 */
describe('/api/v1/workflows request chain', () => {
  let kit: ReturnType<typeof buildWorkflowKit>;
  let ctrl: ApiV1WorkflowsController;
  const reflector = new Reflector();
  const permissionsGuard = new PermissionsGuard(reflector);
  const interceptor = new RequestContextInterceptor();
  /** Industries per store, read by the real IndustryModuleGuard. */
  let industries: Record<number, string[]>;
  const audit = { record: jest.fn() };
  const industryGuard = new IndustryModuleGuard(
    reflector,
    {
      stores: {
        findUnique: jest.fn(async ({ where }: any) =>
          industries[where.id] ? { industries: industries[where.id] } : null,
        ),
      },
    } as any,
    { modeForStore: jest.fn(async () => 'audit') } as any,
    audit as any,
  );

  function principal(over: {
    store_id?: number;
    user_id?: number;
    userPerms: string[];
    scopes: string[];
  }) {
    return {
      api_key_id: 7,
      store_id: over.store_id ?? 1,
      organization_id: 1,
      user_id: over.user_id ?? 1,
      scopes: over.scopes,
      permissions: effectivePermissions(over.userPerms, over.scopes),
    };
  }

  /** Runs one request through the chain and returns the handler's result. */
  async function call(
    handler: keyof ApiV1WorkflowsController,
    p: ReturnType<typeof principal>,
    args: unknown[],
    method = 'GET',
  ) {
    const auth: any = { authenticate: jest.fn(async () => p) };
    const access: any = {
      canUseModule: jest.fn(async () => ({ mode: 'allow' })),
    };
    const guard = new ApiKeyGuard(
      auth,
      access,
      { isEnforce: () => true } as any,
      new ApiKeyFailureLimiter(),
    );
    const req: any = {
      method,
      headers: { 'x-api-key': 'vdx_live_abc123_zzzzzzzz' },
      query: {},
    };
    const res = { setHeader: jest.fn() };
    const http = {
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    };
    await guard.canActivate(http as any);
    const exec = {
      ...http,
      getHandler: () => (ApiV1WorkflowsController.prototype as any)[handler],
      getClass: () => ApiV1WorkflowsController,
    } as any;
    permissionsGuard.canActivate(exec);
    await industryGuard.canActivate(exec);
    return firstValueFrom(
      interceptor.intercept(
        http as any,
        {
          handle: () => from((ctrl as any)[handler](...args)),
        } as any,
      ),
    );
  }

  const ALL = [R, S, T, 'store:workflows:design', 'store:workflows:manage'];

  beforeEach(() => {
    industries = { 1: ['administration'], 2: ['administration'] };
    audit.record.mockClear();
    kit = buildWorkflowKit();
    seedPeople(kit.db);
    seedDefinition(kit.db, purchaseDefinition(), 1);
    seedDefinition(kit.db, purchaseDefinition(), 2);
    ctrl = new ApiV1WorkflowsController(
      { list: jest.fn() } as any,
      kit.instances,
      kit.inbox,
      kit.engine,
      {
        success: (d: any) => d,
        created: (d: any) => d,
        updated: (d: any) => d,
        paginated: (data: any, total: number) => ({ data, total }),
      } as any,
    );
  });
  afterEach(() => jest.restoreAllMocks());

  it('sets the context from the key: acting user, store, organization, effective permissions, not owner', async () => {
    let seen: any;
    jest.spyOn(kit.instances, 'list').mockImplementation(async () => {
      const { RequestContextService } =
        await import('../../common/context/request-context.service');
      seen = RequestContextService.asyncLocalStorage.getStore();
      return { data: [], total: 0, page: 1, limit: 10 } as any;
    });
    await call(
      'listInstances',
      principal({ userPerms: ALL, scopes: ['workflows:read'] }),
      [{}],
    );
    expect(seen).toMatchObject({
      user_id: 1,
      store_id: 1,
      organization_id: 1,
      permissions: [R],
      is_owner: false,
      is_super_admin: false,
      roles: [],
      auth_source: 'api_key',
      api_key_id: 7,
    });
    expect(seen.access_token).toBeUndefined(); // the API key is never exposed as a session token
  });

  it('store isolation: a key of store 1 cannot read an instance of store 2 (404) nor list it', async () => {
    kit.as({ store_id: 2, organization_id: 1, user_id: 7, is_owner: true });
    const other = await kit.engine.start({
      definitionKey: 'purchase',
      idempotencyKey: 'b-1',
    });
    kit.as({ store_id: 1, organization_id: 1, user_id: 1 });
    const p = principal({
      userPerms: ALL,
      scopes: ['workflows:read', 'workflows:write'],
    });
    await expect(
      call('getInstance', p, [other.instance.id]),
    ).rejects.toMatchObject({
      errorCode: 'WORKFLOW_NOT_FOUND',
    });
    const listed: any = await call('listInstances', p, [{}]);
    expect(listed.data.map((r: any) => r.id)).not.toContain(other.instance.id);
    // and the key of store 2 does see it
    const p2 = principal({
      store_id: 2,
      user_id: 7,
      userPerms: ALL,
      scopes: ['workflows:read'],
    });
    await expect(
      call('getInstance', p2, [other.instance.id]),
    ).resolves.toBeDefined();
  });

  it('a write key starts a request and sees it; the same call is idempotent', async () => {
    const p = principal({ userPerms: ALL, scopes: ['workflows:write'] });
    const a: any = await call(
      'start',
      p,
      [{ definition_key: 'purchase' }, 'idem-1'],
      'POST',
    );
    const b: any = await call(
      'start',
      p,
      [{ definition_key: 'purchase' }, 'idem-1'],
      'POST',
    );
    expect(b.instance.id).toBe(a.instance.id);
    await expect(
      call('getInstance', p, [a.instance.id]),
    ).resolves.toBeDefined();
  });

  it('a read-only key cannot start nor complete tasks (403 AUTH_PERM_001)', async () => {
    const p = principal({ userPerms: ALL, scopes: ['workflows:read'] });
    for (const [h, args] of [
      ['start', [{ definition_key: 'purchase' }, 'k']],
      [
        'completeTask',
        [1, { outcome: 'approve', expected_row_version: 0 }, 'k'],
      ],
      ['listInbox', [{}]],
    ] as const) {
      const e = await call(h, p, [...args], 'POST').catch((x) => x);
      expect(e).toBeInstanceOf(VendixHttpException);
      expect(e.errorCode).toBe('AUTH_PERM_001');
      expect(e.getStatus()).toBe(403);
    }
    expect(kit.db.table('workflow_instances')).toHaveLength(0);
  });

  it('a write key of a user WITHOUT start cannot start (scopes never add permissions)', async () => {
    const p = principal({ userPerms: [R, T], scopes: ['workflows:write'] });
    expect(p.permissions).toEqual([T]);
    const e = await call(
      'start',
      p,
      [{ definition_key: 'purchase' }, 'k'],
      'POST',
    ).catch((x) => x);
    expect(e.errorCode).toBe('AUTH_PERM_001');
    expect(kit.db.table('workflow_instances')).toHaveLength(0);
  });

  it('a key without any effective permission is denied everywhere', async () => {
    const p = principal({
      userPerms: [],
      scopes: ['workflows:read', 'workflows:write'],
    });
    for (const h of [
      'listDefinitions',
      'listInstances',
      'getInstance',
      'listInbox',
    ] as const) {
      const e = await call(h, p, [{}]).catch((x) => x);
      expect(e.errorCode).toBe('AUTH_PERM_001');
    }
  });

  it('manage is never effective: a read key of a user with manage only sees what the user took part in', async () => {
    kit.as({ user_id: 4, permissions: [] });
    const mine = await kit.engine.start({
      definitionKey: 'purchase',
      idempotencyKey: 'm-1',
    });
    kit.as({ user_id: 5, permissions: [] });
    await kit.engine.start({
      definitionKey: 'purchase',
      idempotencyKey: 'm-2',
    });
    kit.as({ user_id: 1 });
    const p = principal({
      user_id: 4,
      userPerms: ALL,
      scopes: ['workflows:read'],
    });
    const listed: any = await call('listInstances', p, [{}]);
    expect(listed.data.map((r: any) => r.id)).toEqual([mine.instance.id]);
  });
  describe('flows industry lock (403 MODULE_INDUSTRY_001)', () => {
    const p = () =>
      principal({
        userPerms: ALL,
        scopes: ['workflows:read', 'workflows:write'],
      });

    it.each([
      ['a store that is no longer administration', ['retail']],
      ['a store that lost every industry', []],
    ])(
      '%s: GET and POST are rejected and nothing is written',
      async (_l, inds) => {
        industries[1] = inds;
        const get = await call('listInstances', p(), [{}]).catch((x) => x);
        expect(get).toBeInstanceOf(VendixHttpException);
        expect(get.getStatus()).toBe(403);
        expect(get.errorCode).toBe('MODULE_INDUSTRY_001');
        const post = await call(
          'start',
          p(),
          [{ definition_key: 'purchase' }, 'idem-ind'],
          'POST',
        ).catch((x) => x);
        expect(post).toBeInstanceOf(VendixHttpException);
        expect(post.getStatus()).toBe(403);
        expect(post.errorCode).toBe('MODULE_INDUSTRY_001');
        expect(kit.db.table('workflow_instances')).toHaveLength(0);
        expect(audit.record).toHaveBeenCalledWith(
          expect.objectContaining({
            key: 'flows',
            decision: 'blocked',
            store_id: 1,
          }),
        );
      },
    );

    it('an administration store passes: GET 200 and POST creates', async () => {
      const created: any = await call(
        'start',
        p(),
        [{ definition_key: 'purchase' }, 'idem-ok'],
        'POST',
      );
      expect(created.instance.id).toBeDefined();
      const listed: any = await call('listInstances', p(), [{}]);
      expect(listed.data.map((r: any) => r.id)).toContain(created.instance.id);
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('the lock is per store: store 2 losing administration does not block a key of store 1', async () => {
      industries[2] = ['retail'];
      await expect(call('listInstances', p(), [{}])).resolves.toBeDefined();
    });
  });
});
