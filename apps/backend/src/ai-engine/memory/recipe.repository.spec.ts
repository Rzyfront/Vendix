import { StorePrismaService } from '../../prisma/services/store-prisma.service';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import { RecipeRepository } from './recipe.repository';
import { RequestContextService } from '../../common/context/request-context.service';
import {
  fixture,
  context,
  objectiveId,
} from '../../../test/agentic/f-recipe.fixtures';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const scoped = <T>(cb: () => T, overrides = {}) =>
  RequestContextService.runIsolated({ ...context, ...overrides }, cb);
function setup() {
  const { recipe } = fixture();
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
    $executeRaw: jest.fn().mockResolvedValue(1),
  };
  const storeClient = {
    $queryRaw: jest.fn().mockResolvedValue([recipe]),
    $executeRaw: jest.fn().mockResolvedValue(1),
  };
  const systemClient = {
    ...tx,
    $transaction: jest.fn((cb) => cb(tx)),
    users: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ state: 'active', locked_until: null }),
    },
    stores: {
      findFirst: jest.fn().mockResolvedValue({ industries: ['retail'] }),
    },
    store_users: { findUnique: jest.fn().mockResolvedValue({ id: 1 }) },
    user_roles: {
      findMany: jest.fn().mockResolvedValue([
        {
          roles: {
            role_permissions: context.permissions.map((name) => ({
              granted: true,
              permissions: { name, status: 'active' },
            })),
          },
        },
      ]),
    },
  };
  // Real service prototypes: mocks live ONLY at the PrismaClient transport seam.
  const store = Object.assign(Object.create(StorePrismaService.prototype), {
    baseClient: storeClient,
  }) as StorePrismaService;
  const system = Object.assign(Object.create(GlobalPrismaService.prototype), {
    baseClient: systemClient,
  }) as GlobalPrismaService;
  return {
    recipe,
    store: storeClient,
    system: systemClient,
    tx,
    repository: new RecipeRepository(store as never, system as never),
  };
}
describe('F repository SQL contracts (mocks, NOT PostgreSQL)', () => {
  it('loaded pins and global retirement traverse real scoped-service delegates', () =>
    scoped(async () => {
      const f = setup();
      f.store.$queryRaw.mockResolvedValue([
        { data: { recipe_id: 41, hash: 'a'.repeat(64) } },
      ]);
      expect(await f.repository.loadedPins(objectiveId)).toEqual([
        { id: 41, hash: 'a'.repeat(64) },
      ]);
      expect(f.store.$queryRaw.mock.calls[0][0].values).toEqual([
        objectiveId,
        7,
        3,
        11,
      ]);
      await f.repository.retire(41, 'a'.repeat(64), 'expired');
      expect(f.system.$executeRaw).toHaveBeenCalledTimes(1);
      expect(f.system.$executeRaw.mock.calls[0][0].values).toContain(11);
    }));
  it('private lookup explicitly binds all dimensions; foreign and unknown identical404', () =>
    scoped(async () => {
      const f = setup();
      await f.repository.privateGet(41);
      const q = f.store.$queryRaw.mock.calls[0][0];
      expect(q.sql).toMatch(
        /knowledge_scope='store'.*store_id=\?.*organization_id=\?.*user_id=\?/s,
      );
      expect(q.values).toEqual([41, 7, 3, 11]);
      f.store.$queryRaw.mockResolvedValue([]);
      await expect(f.repository.privateGet(999)).rejects.toThrow(
        'Recipe not found',
      );
    }));
  it('separates private and curated global queries without sentinel OR business embedding widening', () =>
    scoped(async () => {
      const f = setup();
      await f.repository.available();
      const privateSql = f.store.$queryRaw.mock.calls[0][0].sql;
      const globalSql = f.system.$queryRaw.mock.calls[0][0].sql;
      expect(privateSql).not.toContain('global');
      expect(globalSql).toContain("knowledge_scope='global'");
      expect(globalSql).toContain('store_id IS NULL');
      expect(globalSql).not.toMatch(/store_id=0| OR /);
    }));

  it('candidate INSERT idempotent and never resets status, metrics or provenance on replay', () =>
    scoped(async () => {
      const f = setup();
      await f.repository.candidate(f.recipe.template, {
        objective_id: objectiveId,
        evidence_refs: ['private-result'],
        trace_ids: ['private-trace'],
        script_refs: [],
      });
      const q = f.store.$queryRaw.mock.calls[0][0];
      expect(q.sql).toContain('ON CONFLICT(identity_key) DO NOTHING');
      expect(q.sql).not.toMatch(/UPDATE|approved/);
      expect(q.values).toContain(7);
      expect(q.values).toContain(11);
    }));
  it('rechecks membership active-user and current permissions intersect original ceiling', () =>
    scoped(async () => {
      const f = setup();
      const result = await f.repository.currentOwnerPermissions([
        'customers:read',
        'new:grant',
      ]);
      expect(result.permissions).toEqual(['customers:read']);
      f.system.store_users.findUnique.mockResolvedValue(null);
      await expect(
        f.repository.currentOwnerPermissions(context.permissions),
      ).rejects.toThrow('Recipe not found');
    }));
  it.each(['inactive', 'locked'])('rejects %s principal', (state) =>
    scoped(async () => {
      const f = setup();
      f.system.users.findFirst.mockResolvedValue(
        state === 'locked'
          ? { state: 'active', locked_until: new Date(Date.now() + 100000) }
          : { state: 'inactive', locked_until: null },
      );
      await expect(
        f.repository.currentOwnerPermissions(context.permissions),
      ).rejects.toThrow();
    }),
  );
  it('review CAS keeps append-only review evidence and never revives quarantined versions', () =>
    scoped(async () => {
      const f = setup();
      await f.repository.transition(
        41,
        'a'.repeat(64),
        'candidate',
        'reviewed',
        { expires_at: new Date(Date.now() + 100000).toISOString() } as never,
      );
      const q = f.store.$executeRaw.mock.calls[0][0];
      expect(q.sql).toContain('review_history=review_history ||');
      expect(q.sql).toContain('status=?');
      expect(q.values).toContain('candidate');
      expect(q.values).toContain(11);
      f.store.$executeRaw.mockResolvedValue(0);
      await expect(
        f.repository.transition(41, 'a', 'reviewed', 'approved', {} as never),
      ).rejects.toThrow();
    }));
  it('deduplicates feedback event and aggregate in one transaction; failure is not erased', () =>
    scoped(async () => {
      const f = setup();
      await f.repository.event(
        41,
        'a',
        objectiveId,
        'failure',
        'verifier_failed',
      );
      expect(f.tx.$queryRaw.mock.calls[0][0].sql).toContain(
        'ON CONFLICT(event_key) DO NOTHING',
      );
      expect(f.tx.$executeRaw.mock.calls[0][0].sql).toContain(
        'failure_count=failure_count+',
      );
      f.tx.$queryRaw.mockResolvedValue([]);
      f.tx.$executeRaw.mockClear();
      await f.repository.event(
        41,
        'a',
        objectiveId,
        'failure',
        'verifier_failed',
      );
      expect(f.tx.$executeRaw).not.toHaveBeenCalled();
    }));
  it('global preparation requires explicit non-tenant platform identity and strips ALL source refs/review', async () => {
    const f = setup();
    f.recipe.review = { reviewer_id: 11 } as never;
    await expect(
      scoped(() => f.repository.globalCandidate(f.recipe)),
    ).rejects.toThrow('Explicit platform context');
    await scoped(
      async () => {
        await f.repository.globalCandidate(f.recipe);
        const q = f.system.$queryRaw.mock.calls[0][0];
        expect(q.sql).not.toContain('source_');
        expect(q.values.map(String).join(' ')).not.toContain('private-trace');
        expect(q.sql).not.toContain('review');
      },
      { is_super_admin: true, store_id: undefined, user_id: 12 },
    );
  });
  it('source/script getters cannot return guest source or crypto material', () =>
    scoped(async () => {
      const f = setup();
      await f.repository.scriptRefs(objectiveId);
      const q = f.system.$queryRaw.mock.calls[0][0];
      expect(q.sql).toContain('SELECT id FROM ai_agent_script_runs');
      expect(q.sql).not.toMatch(/source|ciphertext|nonce|tag/);
    }));
  it('migration is additive/idempotent static SQL and constrains global provenance, null scope, status and published quality', () => {
    const sql = readFileSync(
      resolve(
        __dirname,
        '../../../prisma/migrations/20261018130000_ai_agent_recipes/migration.sql',
      ),
      'utf8',
    ).replace(/--[^\n]*/g, '');
    expect(sql).not.toMatch(/\b(DROP|TRUNCATE|DELETE|UPDATE|INSERT|CASCADE)\b/);
    expect(sql.match(/CREATE TABLE IF NOT EXISTS/g)).toHaveLength(2);
    for (const q of sql.match(/CREATE (?:UNIQUE )?INDEX[^;]+/g) ?? [])
      expect(q).toContain('IF NOT EXISTS');
    expect(sql).toContain("source_trace_ids='[]'::jsonb");
    expect(sql).toContain('store_id IS NOT NULL');
    expect(sql).toContain("status<>'approved'");
    expect(sql).toContain('review_history');
  });
});
