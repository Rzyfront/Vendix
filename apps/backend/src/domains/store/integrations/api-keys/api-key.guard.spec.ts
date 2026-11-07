import { VendixHttpException } from '../../../../common/errors';
import { ApiKeyGuard } from './api-key.guard';

const KEY = 'vdx_live_abc123_secretsecretsecret';
const PRINCIPAL = {
  api_key_id: 7,
  store_id: 10,
  organization_id: 1,
  user_id: 5,
  scopes: ['workflows:write'],
  permissions: ['store:workflows:start', 'store:workflows:task'],
};

function build(
  opts: { principal?: any; reject?: any; access?: any; enforce?: boolean } = {},
) {
  const auth: any = {
    authenticate: jest.fn(async () => {
      if (opts.reject) throw opts.reject;
      return opts.principal ?? PRINCIPAL;
    }),
  };
  const access: any = {
    canUseModule: jest.fn(
      async () => opts.access ?? { allowed: true, mode: 'allow' },
    ),
  };
  const gate: any = { isEnforce: () => opts.enforce ?? true };
  return { guard: new ApiKeyGuard(auth, access, gate), auth, access };
}

function ctx(req: any, res: any = { setHeader: jest.fn() }) {
  return {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as any;
}

async function code(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return {
      status: (e as VendixHttpException).getStatus(),
      body: (e as VendixHttpException).getResponse(),
    };
  }
  throw new Error('expected rejection');
}

describe('ApiKeyGuard', () => {
  it('missing, garbage and JWT-only credentials share one 401 body and never reach the database', async () => {
    const { guard, auth } = build();
    const attempts = [
      {},
      { authorization: 'Bearer ' },
      { authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOjF9.sig' }, // a valid-looking JWT alone
      { authorization: 'Basic abc' },
      { 'x-api-key': 'not-a-key' },
      { 'x-api-key': `vdx_live_${'a'.repeat(300)}` },
    ];
    const bodies: unknown[] = [];
    for (const headers of attempts) {
      const r = await code(guard.canActivate(ctx({ method: 'GET', headers })));
      expect(r.status).toBe(401);
      bodies.push(r.body);
    }
    expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
    expect(auth.authenticate).not.toHaveBeenCalled();
  });

  it('a rejection from the resolver (unknown/revoked/expired) is passed through untouched', async () => {
    const { guard } = build({
      reject: new VendixHttpException({
        code: 'API_KEY_INVALID',
        httpStatus: 401,
        devMessage: 'x',
      }),
    });
    const r = await code(
      guard.canActivate(ctx({ method: 'GET', headers: { 'x-api-key': KEY } })),
    );
    expect(r.status).toBe(401);
  });

  it('propagates the industry 403 from the resolver', async () => {
    const { guard } = build({
      reject: new VendixHttpException({
        code: 'MODULE_INDUSTRY_001',
        httpStatus: 403,
        devMessage: 'x',
      }),
    });
    const r = await code(
      guard.canActivate(
        ctx({ method: 'GET', headers: { authorization: `Bearer ${KEY}` } }),
      ),
    );
    expect(r.status).toBe(403);
  });

  it('sets req.user as the acting user with ONLY the effective permissions and no ownership', async () => {
    const { guard } = build();
    const req: any = {
      method: 'GET',
      headers: { authorization: `Bearer ${KEY}` },
    };
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
    expect(req.apiKey).toEqual(PRINCIPAL);
    expect(req.user).toMatchObject({
      id: 5,
      user_id: 5,
      organization_id: 1,
      store_id: 10,
      roles: [],
      is_owner: false,
      is_super_admin: false,
      auth_source: 'api_key',
      api_key_id: 7,
    });
    expect(req.user.permissions).toEqual([
      { name: 'store:workflows:start', path: '', method: '', status: 'active' },
      { name: 'store:workflows:task', path: '', method: '', status: 'active' },
    ]);
  });

  it('discards a user injected before the guard', async () => {
    const { guard } = build({
      reject: new VendixHttpException({
        code: 'API_KEY_INVALID',
        httpStatus: 401,
        devMessage: 'x',
      }),
    });
    const req: any = {
      method: 'GET',
      headers: {},
      user: { is_super_admin: true, store_id: 99 },
    };
    await code(guard.canActivate(ctx(req)));
    expect(req.user).toBeUndefined();
  });

  it('accepts X-Api-Key', async () => {
    const { guard, auth } = build();
    await guard.canActivate(
      ctx({ method: 'GET', headers: { 'x-api-key': KEY }, ip: '1.1.1.1' }),
    );
    expect(auth.authenticate).toHaveBeenCalledWith(KEY, expect.any(String));
  });

  describe('write operations keep the subscription rule of StoreOperationsGuard', () => {
    const post = () => ({ method: 'POST', headers: { 'x-api-key': KEY } });

    it('does not check subscriptions on reads', async () => {
      const { guard, access } = build({
        access: { mode: 'block', reason: 'SUBSCRIPTION_004' },
      });
      await expect(
        guard.canActivate(
          ctx({ method: 'GET', headers: { 'x-api-key': KEY } }),
        ),
      ).resolves.toBe(true);
      expect(access.canUseModule).not.toHaveBeenCalled();
    });

    it('blocks a POST when the store has no active subscription (enforce)', async () => {
      const { guard, access } = build({
        access: {
          mode: 'block',
          reason: 'SUBSCRIPTION_004',
          subscription_state: 'expired',
        },
      });
      const r = await code(guard.canActivate(ctx(post())));
      expect(access.canUseModule).toHaveBeenCalledWith(10, 'store-operations');
      expect((r.body as any).error_code).toBe('SUBSCRIPTION_004');
      expect(r.status).toBeGreaterThanOrEqual(400);
    });

    it('lets the POST through (log only) when the gate is not enforced', async () => {
      const { guard } = build({
        enforce: false,
        access: { mode: 'block', reason: 'SUBSCRIPTION_004' },
      });
      await expect(guard.canActivate(ctx(post()))).resolves.toBe(true);
    });

    it('grace window: passes and sets the warning header', async () => {
      const { guard } = build({
        access: { mode: 'warn', subscription_state: 'grace_soft' },
      });
      const res = { setHeader: jest.fn() };
      await expect(guard.canActivate(ctx(post(), res))).resolves.toBe(true);
      expect(res.setHeader).toHaveBeenCalledWith(
        'X-Subscription-Warning',
        'grace_soft',
      );
    });
  });
});
