import { RequestContextService } from '../../../../common/context/request-context.service';
import { VendixHttpException } from '../../../../common/errors';
import { StoreApiKeysService } from './store-api-keys.service';
import { hashApiKey } from './api-key.util';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

const NOW = new Date('2026-11-05T12:00:00Z');

function fakeStore() {
  const rows: any[] = [];
  let seq = 0;
  const matches = (r: any, where: any): boolean =>
    Object.entries(where).every(([k, v]: [string, any]) => {
      if (k === 'OR') return v.some((w: any) => matches(r, w));
      if (v && typeof v === 'object' && !(v instanceof Date)) {
        if ('gt' in v) return r[k] != null && r[k] > v.gt;
        return false;
      }
      return r[k] === v;
    });
  const pick = (r: any, select?: any) => {
    if (!select) return { ...r };
    return Object.fromEntries(Object.keys(select).map((k) => [k, r[k]]));
  };
  const table = {
    count: jest.fn(
      async ({ where }: any) => rows.filter((r) => matches(r, where)).length,
    ),
    findMany: jest.fn(async ({ where, select }: any) =>
      rows.filter((r) => matches(r, where)).map((r) => pick(r, select)),
    ),
    findFirst: jest.fn(async ({ where, select }: any) => {
      const r = rows.find((x) => matches(x, where));
      return r ? pick(r, select) : null;
    }),
    create: jest.fn(async ({ data, select }: any) => {
      const r = {
        id: ++seq,
        last_used_at: null,
        last_used_ip: null,
        revoked_at: null,
        created_at: NOW,
        ...data,
      };
      rows.push(r);
      return pick(r, select);
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const hit = rows.filter((r) => matches(r, where));
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    }),
  };
  const order: string[] = [];
  const prisma: any = { store_api_keys: table };
  prisma.$queryRaw = jest.fn(async (strings: TemplateStringsArray) => {
    order.push(`lock:${strings.join('?')}`);
    return [{ id: 10 }];
  });
  prisma.$transaction = jest.fn(async (fn: any) => {
    order.push('tx:begin');
    const r = await fn(prisma);
    order.push('tx:commit');
    return r;
  });
  table.count.mockImplementation(async ({ where }: any) => {
    order.push('count');
    return rows.filter((r) => matches(r, where)).length;
  });
  table.create.mockImplementation(async ({ data, select }: any) => {
    order.push('insert');
    const r = {
      id: ++seq,
      last_used_at: null,
      last_used_ip: null,
      revoked_at: null,
      created_at: NOW,
      ...data,
    };
    rows.push(r);
    return pick(r, select);
  });
  return { rows, order, prisma };
}

function build() {
  const store = fakeStore();
  const svc = new StoreApiKeysService(store.prisma);
  jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
    store_id: 10,
    organization_id: 1,
    user_id: 3,
    is_super_admin: false,
    is_owner: true,
  } as any);
  return { svc, ...store };
}

async function failure(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return e as VendixHttpException;
  }
  throw new Error('expected rejection');
}

afterEach(() => jest.restoreAllMocks());

describe('StoreApiKeysService', () => {
  it('create returns the secret once and persists only its hash', async () => {
    const { svc, rows } = build();
    const out = await svc.create(
      {
        name: ' Integración ERP ',
        scopes: ['workflows:read'],
        expires_in_days: 30,
      },
      NOW,
    );
    expect(out.secret).toMatch(/^vdx_live_[0-9a-f]{6}_[A-Za-z0-9_-]{43}$/);
    expect(out.prefix).toBe(out.secret.slice(0, 15));
    expect(rows).toHaveLength(1);
    expect(rows[0].key_hash).toBe(hashApiKey(out.secret));
    expect(JSON.stringify(rows[0])).not.toContain(out.secret);
    expect(rows[0]).toMatchObject({
      store_id: 10,
      organization_id: 1,
      name: 'Integración ERP',
      scopes: ['workflows:read'],
      created_by_user_id: 3,
      acting_user_id: 3, // defaults to the creator
      expires_at: new Date(NOW.getTime() + 30 * 86_400_000),
    });
    expect(out).not.toHaveProperty('key_hash');
  });

  it('list never returns the hash nor the secret', async () => {
    const { svc } = build();
    const created = await svc.create(
      { name: 'a', scopes: ['workflows:write'] },
      NOW,
    );
    const list = await svc.list();
    expect(list).toHaveLength(1);
    expect(list[0]).not.toHaveProperty('key_hash');
    expect(list[0]).not.toHaveProperty('secret');
    expect(JSON.stringify(list)).not.toContain(created.secret);
    expect(list[0].prefix).toBe(created.prefix);
  });

  it('rejects empty or unknown scopes', async () => {
    const { svc } = build();
    for (const scopes of [
      [],
      ['documents:read'],
      ['workflows:read', 'admin'],
    ]) {
      const e = await failure(svc.create({ name: 'a', scopes }, NOW));
      expect((e.getResponse() as any).error_code).toBe('API_KEY_SCOPE_INVALID');
    }
  });

  it('caps active keys at 20 per store; revoked and expired ones do not count', async () => {
    const { svc, rows } = build();
    for (let i = 0; i < 20; i++)
      await svc.create({ name: `k${i}`, scopes: ['workflows:read'] }, NOW);
    const e = await failure(
      svc.create({ name: 'k21', scopes: ['workflows:read'] }, NOW),
    );
    expect((e.getResponse() as any).error_code).toBe('API_KEY_LIMIT_REACHED');
    expect(e.getStatus()).toBe(409);
    expect(rows).toHaveLength(20);

    await svc.revoke(rows[0].id, NOW);
    await expect(
      svc.create({ name: 'again', scopes: ['workflows:read'] }, NOW),
    ).resolves.toBeDefined();
    rows[1].expires_at = new Date(NOW.getTime() - 1000);
    await expect(
      svc.create({ name: 'again2', scopes: ['workflows:read'] }, NOW),
    ).resolves.toBeDefined();
  });

  it('counts and inserts in ONE transaction under a lock on the store row', async () => {
    const { svc, order, prisma } = build();
    await svc.create({ name: 'a', scopes: ['workflows:read'] }, NOW);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(order).toEqual([
      'tx:begin',
      expect.stringMatching(
        /^lock:.*FROM stores WHERE id = \? FOR NO KEY UPDATE/s,
      ),
      'count',
      'insert',
      'tx:commit',
    ]);
  });

  it('at the cap nothing is inserted (the refusal happens inside the locked transaction)', async () => {
    const { svc, order, rows } = build();
    for (let i = 0; i < 20; i++)
      await svc.create({ name: `k${i}`, scopes: ['workflows:read'] }, NOW);
    order.length = 0;
    await failure(svc.create({ name: 'x', scopes: ['workflows:read'] }, NOW));
    expect(order).not.toContain('insert');
    expect(rows).toHaveLength(20);
  });

  it('revoke sets revoked_at and is idempotent', async () => {
    const { svc, rows } = build();
    const { id } = await svc.create(
      { name: 'a', scopes: ['workflows:read'] },
      NOW,
    );
    const first = await svc.revoke(id, NOW);
    expect(first!.revoked_at).toEqual(NOW);
    const later = new Date(NOW.getTime() + 60_000);
    const second = await svc.revoke(id, later);
    expect(second!.revoked_at).toEqual(NOW); // original timestamp kept
    expect(rows[0].revoked_at).toEqual(NOW);
    expect(second).not.toHaveProperty('key_hash');
  });

  it('revoke of an unknown id (or one of another store) is a 404', async () => {
    const { svc, rows } = build();
    rows.push({ id: 50, store_id: 99, revoked_at: null });
    for (const id of [404, 50]) {
      const e = await failure(svc.revoke(id, NOW));
      expect(e.getStatus()).toBe(404);
      expect((e.getResponse() as any).error_code).toBe('API_KEY_NOT_FOUND');
    }
    expect(rows[0].revoked_at).toBeNull();
  });

  describe('acting user is always the creator', () => {
    it('is set server-side to the creator', async () => {
      const { svc, rows } = build();
      await svc.create({ name: 'a', scopes: ['workflows:write'] }, NOW);
      expect(rows[0].acting_user_id).toBe(3);
      expect(rows[0].created_by_user_id).toBe(3);
    });
    it('ignores an acting_user_id that slips past validation', async () => {
      const { svc, rows } = build();
      await svc.create(
        { name: 'a', scopes: ['workflows:write'], acting_user_id: 8 } as any,
        NOW,
      );
      expect(rows[0].acting_user_id).toBe(3);
    });
    it('the DTO rejects acting_user_id under the global whitelist', async () => {
      const dto = plainToInstance(CreateApiKeyDto, {
        name: 'a',
        scopes: ['workflows:read'],
        acting_user_id: 8,
      });
      const errs = await validate(dto, {
        whitelist: true,
        forbidNonWhitelisted: true,
      });
      expect(errs.map((e) => e.property)).toEqual(['acting_user_id']);
    });
  });
});
