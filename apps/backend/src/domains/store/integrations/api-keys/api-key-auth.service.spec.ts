import { VendixHttpException } from '../../../../common/errors';
import { ApiKeyAuthService } from './api-key-auth.service';
import { generateApiKey } from './api-key.util';

const NOW = new Date('2026-11-05T12:00:00Z');

function perm(name: string, status = 'active') {
  return { name, status };
}

function build(
  over: {
    row?: any | null;
    store?: any | null;
    user?: any | null;
    userRoles?: any[];
  } = {},
) {
  const k = generateApiKey();
  const row =
    over.row === null
      ? null
      : {
          id: 7,
          organization_id: 1,
          store_id: 10,
          key_hash: k.key_hash,
          scopes: ['workflows:write'],
          acting_user_id: 5,
          last_used_at: null,
          expires_at: null,
          revoked_at: null,
          ...over.row,
        };
  const prisma: any = {
    store_api_keys: {
      findUnique: jest.fn(async ({ where }: any) =>
        row && where.key_hash === row.key_hash ? row : null,
      ),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    stores: {
      findUnique: jest.fn(async () =>
        over.store === null
          ? null
          : {
              id: 10,
              is_active: true,
              organization_id: 1,
              industries: ['administration'],
              ...over.store,
            },
      ),
    },
    users: {
      findUnique: jest.fn(async () =>
        over.user === null
          ? null
          : {
              id: 5,
              state: 'active',
              locked_until: null,
              organization_id: 1,
              ...over.user,
            },
      ),
    },
    user_roles: {
      findMany: jest.fn(
        async () =>
          over.userRoles ?? [
            {
              roles: {
                role_permissions: [
                  { permissions: perm('store:workflows:read') },
                  { permissions: perm('store:workflows:start') },
                  { permissions: perm('store:workflows:task') },
                  { permissions: perm('store:workflows:manage') },
                  { permissions: perm('store:workflows:design', 'inactive') },
                ],
              },
            },
          ],
      ),
    },
  };
  return { svc: new ApiKeyAuthService(prisma), prisma, secret: k.secret, row };
}

async function failure(p: Promise<unknown>): Promise<VendixHttpException> {
  try {
    await p;
  } catch (e) {
    return e as VendixHttpException;
  }
  throw new Error('expected a rejection');
}

describe('ApiKeyAuthService', () => {
  it('resolves a valid key to the acting user with effective permissions', async () => {
    const { svc, secret, prisma } = build();
    const p = await svc.authenticate(secret, '1.2.3.4', NOW);
    expect(p).toMatchObject({
      api_key_id: 7,
      store_id: 10,
      organization_id: 1,
      user_id: 5,
      scopes: ['workflows:write'],
    });
    expect(p.permissions.sort()).toEqual([
      'store:workflows:start',
      'store:workflows:task',
    ]);
    // roles are resolved for THIS store (store-specific or org-wide), like the JWT strategy
    expect(prisma.user_roles.findMany.mock.calls[0][0].where).toEqual({
      user_id: 5,
      OR: [{ store_id: null }, { store_id: 10 }],
    });
  });

  it('resolves the permissions of the key creator (acting user = creator)', async () => {
    const { svc, secret, prisma } = build({
      row: { created_by_user_id: 5, acting_user_id: 5 },
    });
    const p = await svc.authenticate(secret, 'ip', NOW);
    expect(p.user_id).toBe(5);
    expect(prisma.user_roles.findMany.mock.calls[0][0].where.user_id).toBe(5);
    expect(prisma.users.findUnique.mock.calls[0][0].where).toEqual({ id: 5 });
  });

  it('looks the key up by its sha256 and never by the plain secret', async () => {
    const { svc, secret, prisma, row } = build();
    await svc.authenticate(secret, 'ip', NOW);
    const arg = prisma.store_api_keys.findUnique.mock.calls[0][0];
    expect(arg.where.key_hash).toBe(row.key_hash);
    expect(JSON.stringify(arg)).not.toContain(secret);
  });

  describe('unusable keys all fail with the same 401 body (no oracle)', () => {
    const cases: Array<[string, Parameters<typeof build>[0], string?]> = [
      ['unknown', { row: null }],
      ['revoked', { row: { revoked_at: new Date('2026-11-01') } }],
      ['expired', { row: { expires_at: new Date('2026-11-04') } }],
      ['expiring right now', { row: { expires_at: NOW } }],
      ['inactive store', { store: { is_active: false } }],
      ['missing store', { store: null }],
      ['store of another organization', { store: { organization_id: 2 } }],
      ['acting user inactive', { user: { state: 'inactive' } }],
      ['acting user missing', { user: null }],
      [
        'acting user locked',
        { user: { locked_until: new Date('2026-11-06') } },
      ],
      ['acting user of another organization', { user: { organization_id: 2 } }],
    ];
    it.each(cases)('%s', async (_name, over) => {
      const { svc, secret } = build(over);
      const e = await failure(svc.authenticate(secret, 'ip', NOW));
      expect(e.getStatus()).toBe(401);
      expect(e.getResponse()).toEqual({
        error_code: 'API_KEY_INVALID',
        message: 'API key inválida o expirada.',
      });
    });

    it('a different (wrong) secret gets the same body as a revoked one', async () => {
      const a = await failure(
        build({ row: { revoked_at: new Date('2026-11-01') } }).svc.authenticate(
          'vdx_live_x_y',
          'ip',
          NOW,
        ),
      );
      const b = await failure(
        build().svc.authenticate('vdx_live_other_secret', 'ip', NOW),
      );
      expect(a.getResponse()).toEqual(b.getResponse());
      expect(a.getStatus()).toBe(b.getStatus());
    });
  });

  it('store without the administration industry: 403 MODULE_INDUSTRY_001 (key was valid)', async () => {
    const { svc, secret } = build({ store: { industries: ['retail'] } });
    const e = await failure(svc.authenticate(secret, 'ip', NOW));
    expect(e.getStatus()).toBe(403);
    expect((e.getResponse() as any).error_code).toBe('MODULE_INDUSTRY_001');
  });

  it('a read-only key of a user that lacks read has no permissions', async () => {
    const { svc, secret } = build({
      row: { scopes: ['workflows:read'] },
      userRoles: [
        {
          roles: {
            role_permissions: [{ permissions: perm('store:workflows:task') }],
          },
        },
      ],
    });
    const p = await svc.authenticate(secret, 'ip', NOW);
    expect(p.permissions).toEqual([]);
  });

  describe('last_used bookkeeping (at most once per minute)', () => {
    it('writes when never used', async () => {
      const { svc, secret, prisma } = build();
      await svc.authenticate(secret, '9.9.9.9', NOW);
      expect(prisma.store_api_keys.updateMany).toHaveBeenCalledTimes(1);
      const arg = prisma.store_api_keys.updateMany.mock.calls[0][0];
      expect(arg.data).toEqual({ last_used_at: NOW, last_used_ip: '9.9.9.9' });
      // atomic conditional update: a concurrent request cannot double-write
      expect(arg.where).toEqual({
        id: 7,
        OR: [
          { last_used_at: null },
          { last_used_at: { lte: new Date(NOW.getTime() - 60_000) } },
        ],
      });
    });
    it('skips when used less than a minute ago', async () => {
      const { svc, secret, prisma } = build({
        row: { last_used_at: new Date(NOW.getTime() - 30_000) },
      });
      await svc.authenticate(secret, 'ip', NOW);
      expect(prisma.store_api_keys.updateMany).not.toHaveBeenCalled();
    });
    it('writes again after a minute', async () => {
      const { svc, secret, prisma } = build({
        row: { last_used_at: new Date(NOW.getTime() - 61_000) },
      });
      await svc.authenticate(secret, 'ip', NOW);
      expect(prisma.store_api_keys.updateMany).toHaveBeenCalledTimes(1);
    });
    it('a failing bookkeeping write never fails the request', async () => {
      const { svc, secret, prisma } = build();
      prisma.store_api_keys.updateMany.mockRejectedValue(new Error('db down'));
      await expect(svc.authenticate(secret, 'ip', NOW)).resolves.toMatchObject({
        user_id: 5,
      });
    });
    it('stores at most 64 chars of the ip', async () => {
      const { svc, secret, prisma } = build();
      await svc.authenticate(secret, 'x'.repeat(200), NOW);
      expect(
        prisma.store_api_keys.updateMany.mock.calls[0][0].data.last_used_ip,
      ).toHaveLength(64);
    });
  });
});
