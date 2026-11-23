import { NotFoundException } from '@nestjs/common';
import { RequestContextService } from '../../common/context/request-context.service';
import type { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import { AgentHistoryService } from '../../domains/store/vex/services/agent-history.service';
import { CodeModeRunsService } from '../../domains/superadmin/ai-engine/codemode-runs.service';
import {
  SANDBOX_SOURCE_HIDDEN_REASON,
  SandboxAuditRepository,
  sandboxSourceHash,
} from './sandbox-audit.repository';

const RUN = '00000000-0000-4000-8000-0000000000a1';
const OWNER = { store_id: 10, organization_id: 20, user_id: 30 };
const key = Buffer.alloc(32, 9);
const SOURCE = "const r = await tools.list_products({});\nreturn r.length;";
const ARGS_HASH = 'd'.repeat(64);
type Query = { sql: string; values: unknown[] };

const as = <T>(
  scope: Partial<typeof OWNER> & { user_id: number },
  fn: () => T,
): T =>
  RequestContextService.runIsolated(
    {
      ...OWNER,
      ...scope,
      is_super_admin: false,
      is_owner: true,
    } as never,
    fn,
  );

describe('Code Mode audit (T67)', () => {
  const priorKey = process.env.AI_SANDBOX_SOURCE_KEY;
  let stored: Record<string, unknown> | undefined;
  let repository: SandboxAuditRepository;
  let selects: Query[];

  beforeEach(async () => {
    process.env.AI_SANDBOX_SOURCE_KEY = key.toString('base64');
    delete process.env.AI_SANDBOX_MAX_RUNNERS;
    selects = [];
    stored = undefined;
    const tx = {
      $queryRaw: jest.fn(async (query: Query) => {
        if (query.sql.includes('AS global_count'))
          return [{ global_count: 0, store_count: 0 }];
        if (query.sql.includes('SELECT id, store_id')) {
          selects.push(query);
          // Behave like the WHERE: id AND store_id AND organization_id.
          const ok =
            stored &&
            query.values.includes(stored.id) &&
            query.values.includes(stored.store_id) &&
            query.values.includes(stored.organization_id);
          return ok ? [stored] : [];
        }
        return [];
      }),
      $executeRaw: jest.fn(async (query: Query) => {
        if (!query.sql.includes('INSERT INTO ai_agent_script_runs')) return 1;
        const v = query.values;
        stored = {
          id: v[0],
          store_id: v[1],
          organization_id: v[2],
          user_id: v[3],
          objective_id: v[4],
          source_hash: v[5],
          source_ciphertext: v[6],
          source_nonce: v[7],
          source_auth_tag: v[8],
          policy_digest: v[10],
          runtime_digest: v[11],
          manifest: ['list_products'],
          calls: [
            { seq: 1, tool: 'list_products', args_hash: ARGS_HASH, status: 'dispatching' },
            {
              seq: 1,
              tool: 'list_products',
              args_hash: ARGS_HASH,
              status: 'ok',
              rows: 12,
              duration_ms: 40,
            },
          ],
          outcome: 'ok',
          lease_until: new Date(Date.now() + 30000),
          expires_at: new Date(Date.now() + 7 * 86400000),
          created_at: new Date('2026-11-22T10:00:00Z'),
          finished_at: new Date('2026-11-22T10:00:02Z'),
          executor: 'lambda-js',
          rounds: 2,
          cut_reason: null,
          expired: false,
        };
        return 1;
      }),
    };
    const prisma = { $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) };
    repository = new SandboxAuditRepository(prisma as unknown as GlobalPrismaService);
    await as(OWNER, () =>
      repository.start({
        id: RUN,
        source: SOURCE,
        source_hash: sandboxSourceHash(SOURCE),
        policy_digest: `sha256:${'a'.repeat(64)}`,
        runtime_digest: `sha256:${'b'.repeat(64)}`,
        limits: { wall_ms: 30000, calls: 20, rounds: 4 },
        manifest: ['list_products'],
        executor: 'lambda-js',
        tenant_hash: 'e'.repeat(64),
      }),
    );
    expect(stored).toBeDefined();
  });

  afterAll(() => {
    if (priorKey === undefined) delete process.env.AI_SANDBOX_SOURCE_KEY;
    else process.env.AI_SANDBOX_SOURCE_KEY = priorKey;
  });

  it('the owner gets the decrypted source and the folded call list', async () => {
    const view = await as(OWNER, () => repository.readOwnerView(RUN));
    expect(view.is_owner).toBe(true);
    expect(view.source).toBe(SOURCE);
    expect(view.source_hidden_reason).toBeNull();
    expect(view.calls).toEqual([
      { seq: 1, tool: 'list_products', status: 'ok', rows: 12, duration_ms: 40 },
    ]);
    expect(view.rounds).toBe(2);
    expect(view.duration_ms).toBe(2000);
    expect(JSON.stringify(view)).not.toContain(ARGS_HASH);
    // The store AND organization are pinned in the query itself.
    expect(selects[0].sql).toContain('store_id =');
    expect(selects[0].sql).toContain('organization_id =');
  });

  it('a colleague of the same store gets metadata with source null and a reason', async () => {
    const view = await as({ ...OWNER, user_id: 31 }, () => repository.readOwnerView(RUN));
    expect(view.is_owner).toBe(false);
    expect(view.source).toBeNull();
    expect(view.source_hidden_reason).toBe(SANDBOX_SOURCE_HIDDEN_REASON.not_owner);
    expect(view.calls).toHaveLength(1);
  });

  it('another store sees the same 404 as a run that does not exist', async () => {
    const other = await as({ store_id: 11, user_id: 30 }, () =>
      repository.readOwnerView(RUN).catch((e) => e),
    );
    const missing = await as(OWNER, () =>
      repository.readOwnerView('00000000-0000-4000-8000-0000000000ff').catch((e) => e),
    );
    expect(other).toBeInstanceOf(NotFoundException);
    expect(missing).toBeInstanceOf(NotFoundException);
    expect(other.message).toBe(missing.message);
    expect(other.getStatus()).toBe(missing.getStatus());
  });

  it('after the 7-day window the owner gets no source', async () => {
    stored!.expired = true;
    stored!.expires_at = new Date(Date.now() - 1000);
    const view = await as(OWNER, () => repository.readOwnerView(RUN));
    expect(view.expired).toBe(true);
    expect(view.source).toBeNull();
    expect(view.source_hidden_reason).toBe(SANDBOX_SOURCE_HIDDEN_REASON.expired);
  });

  it('a tampered ciphertext yields no source instead of garbage', async () => {
    (stored!.source_ciphertext as Buffer)[0] ^= 0xff;
    const view = await as(OWNER, () => repository.readOwnerView(RUN));
    expect(view.source).toBeNull();
    expect(view.source_hidden_reason).toBe(SANDBOX_SOURCE_HIDDEN_REASON.unavailable);
  });

  it('the store service maps any failure to one Spanish 404, with the same message', async () => {
    const service = new AgentHistoryService({} as never, {} as never, repository);
    const a = await as({ store_id: 11, user_id: 30 }, () =>
      service.getScriptRun(RUN).catch((e) => e),
    );
    const b = await as(OWNER, () =>
      service.getScriptRun('00000000-0000-4000-8000-0000000000fe').catch((e) => e),
    );
    expect(a).toBeInstanceOf(NotFoundException);
    expect(a.message).toBe(b.message);
    const ok = await as(OWNER, () => service.getScriptRun(RUN));
    expect(ok.source).toBe(SOURCE);
  });

  describe('super-admin projection', () => {
    it('never selects or returns source, args or results', async () => {
      const row = {
        id: RUN,
        store_id: 10,
        user_id: 30,
        executor: 'lambda-js',
        rounds: 2,
        tenant_hash: 'e'.repeat(64),
        cut_reason: null,
        outcome: 'ok',
        returned_bytes: 100,
        usage: {},
        calls: stored!.calls,
        manifest: ['list_products'],
        created_at: new Date('2026-11-22T10:00:00Z'),
        finished_at: new Date('2026-11-22T10:00:02Z'),
      };
      const findMany = jest.fn(async () => [row]);
      const findFirst = jest.fn(async () => row);
      const prisma = {
        ai_agent_script_runs: { findMany, findFirst, count: jest.fn(async () => 1) },
        stores: { findMany: jest.fn(async () => [{ id: 10, name: 'Tienda Uno' }]) },
        users: { findMany: jest.fn(async () => [{ id: 30, first_name: 'Ana', last_name: 'Ruiz' }]) },
      };
      const service = new CodeModeRunsService(prisma as unknown as GlobalPrismaService);
      const list = await service.list({});
      const detail = await service.get(RUN);

      for (const call of [findMany.mock.calls[0], findFirst.mock.calls[0]] as unknown as Array<
        [{ select: Record<string, boolean> }]
      >) {
        const select = Object.keys(call[0].select);
        expect(select.filter((k) => /source|ciphertext|nonce|auth_tag|key_id/.test(k))).toEqual([]);
      }
      const dump = JSON.stringify({ list, detail });
      expect(dump).not.toMatch(/source|ciphertext|args_hash|result/i);
      expect(dump).not.toContain(ARGS_HASH);
      expect(list.items[0]).toMatchObject({
        store: { id: 10, name: 'Tienda Uno' },
        user: { id: 30, name: 'Ana Ruiz' },
        rounds: 2,
        call_count: 1,
        duration_ms: 2000,
        outcome: 'ok',
      });
      expect(detail.calls).toEqual([
        { seq: 1, tool: 'list_products', status: 'ok', rows: 12, duration_ms: 40 },
      ]);
    });

    it('a malformed id is a 404 before any query', async () => {
      const prisma = { ai_agent_script_runs: { findFirst: jest.fn() } };
      const service = new CodeModeRunsService(prisma as unknown as GlobalPrismaService);
      await expect(service.get('nope')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.ai_agent_script_runs.findFirst).not.toHaveBeenCalled();
    });
  });
});
