import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createDecipheriv } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { RequestContextService } from '../../common/context/request-context.service';
import type { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import {
  normalizeSandboxSource,
  SandboxAuditCall,
  SandboxAuditRecord,
  SandboxAuditRepository,
  SandboxAuditStart,
  sandboxSourceHash,
} from './sandbox-audit.repository';

const ID = '00000000-0000-4000-8000-000000000001';
const OBJECTIVE = '00000000-0000-4000-8000-000000000002';
const RESULT = '00000000-0000-4000-8000-000000000003';
const ctx = {
  store_id: 10,
  organization_id: 20,
  user_id: 30,
  is_super_admin: false,
  is_owner: true,
};
const key = Buffer.alloc(32, 7);
const source =
  "const buyer = 'synthetic@example.invalid';\r\nreturn 'cafe\u0301';";
const input = (patch: Partial<SandboxAuditStart> = {}): SandboxAuditStart => ({
  id: ID,
  objective_id: OBJECTIVE,
  source,
  source_hash: sandboxSourceHash(source),
  policy_digest: `sha256:${'a'.repeat(64)}`,
  runtime_digest: `sha256:${'b'.repeat(64)}`,
  limits: {
    wall_ms: 30000,
    cpu_ms: 2000,
    memory_mb: 256,
    calls: 20,
    concurrency: 1,
    pages: 10,
    rows: 5000,
    input_bytes: 2097152,
    output_bytes: 65536,
    source_bytes: 32768,
  },
  manifest: ['read_products'],
  ...patch,
});
const call = (patch: Partial<SandboxAuditCall> = {}): SandboxAuditCall => ({
  seq: 1,
  tool: 'read_products',
  args_hash: 'c'.repeat(64),
  status: 'dispatching',
  ...patch,
});
const row = (patch: Partial<SandboxAuditRecord> = {}): SandboxAuditRecord => ({
  id: ID,
  ...ctx,
  objective_id: OBJECTIVE,
  source_hash: sandboxSourceHash(source),
  policy_digest: input().policy_digest,
  runtime_digest: input().runtime_digest,
  limits: input().limits,
  manifest: ['read_products'],
  calls: [],
  outcome: 'running',
  usage: {},
  lease_until: new Date(Date.now() + 30000),
  expires_at: new Date(Date.now() + 7 * 86400000),
  created_at: new Date(),
  finished_at: null,
  ...patch,
});
const scoped = <T>(fn: () => T): T =>
  RequestContextService.runIsolated(ctx, fn);
type Query = { sql: string; values: unknown[] };
const inserts = (tx: { $executeRaw: jest.Mock }): Query[] =>
  tx.$executeRaw.mock.calls
    .map(([query]: [Query]) => query)
    .filter((query) => query.sql.includes('INSERT INTO ai_agent_script_runs'));

describe('SandboxAuditRepository phase E', () => {
  let tx: { $queryRaw: jest.Mock; $executeRaw: jest.Mock };
  let prisma: { $transaction: jest.Mock };
  let repository: SandboxAuditRepository;
  const priorKey = process.env.AI_SANDBOX_SOURCE_KEY;
  const priorMax = process.env.AI_SANDBOX_MAX_RUNNERS;

  beforeEach(() => {
    process.env.AI_SANDBOX_SOURCE_KEY = key.toString('base64');
    delete process.env.AI_SANDBOX_MAX_RUNNERS;
    tx = {
      $queryRaw: jest.fn().mockImplementation(async (query: Query) => {
        if (query.sql.includes('FROM ai_agent_objectives'))
          return [{ id: OBJECTIVE }];
        if (query.sql.includes('AS global_count'))
          return [{ global_count: 0, store_count: 0 }];
        if (query.sql.includes('AS attempt_count'))
          return [{ attempt_count: 0 }];
        if (query.sql.includes('UPDATE ai_agent_script_runs'))
          return [{ id: ID }];
        if (query.sql.includes('FROM ai_agent_script_runs')) return [row()];
        return [];
      }),
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    prisma = {
      $transaction: jest.fn(
        async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
      ),
    };
    repository = new SandboxAuditRepository(
      prisma as unknown as GlobalPrismaService,
    );
  });

  afterAll(() => {
    if (priorKey === undefined) delete process.env.AI_SANDBOX_SOURCE_KEY;
    else process.env.AI_SANDBOX_SOURCE_KEY = priorKey;
    if (priorMax === undefined) delete process.env.AI_SANDBOX_MAX_RUNNERS;
    else process.env.AI_SANDBOX_MAX_RUNNERS = priorMax;
  });

  it('normalizes source exactly once for execution/fingerprint (LF and NFC)', () => {
    expect(normalizeSandboxSource(source)).toBe(
      "const buyer = 'synthetic@example.invalid';\nreturn 'caf\u00e9';",
    );
    expect(sandboxSourceHash(source)).toBe(
      sandboxSourceHash(normalizeSandboxSource(source)),
    );
  });

  it('rejects missing ALS despite legacy static context, before any SQL', async () => {
    RequestContextService.run(ctx, () => undefined);
    expect(RequestContextService.getContext()?.user_id).toBe(30);
    await expect(repository.start(input())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(repository.appendCall(ID, call())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(repository.finish(ID, 'ok', {})).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(repository.get(ID)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each(['store_id', 'organization_id', 'user_id'] as const)(
    'does not let superadmin bypass missing %s',
    async (field) => {
      await expect(
        RequestContextService.runIsolated(
          { ...ctx, is_super_admin: true, [field]: undefined },
          () => repository.start(input()),
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );

  it.each([
    undefined,
    '',
    'invalid',
    Buffer.alloc(31).toString('base64'),
    `${key.toString('base64')}\n`,
  ])(
    'fails closed for absent/noncanonical/incorrect encryption key',
    async (invalid) => {
      if (invalid === undefined) delete process.env.AI_SANDBOX_SOURCE_KEY;
      else process.env.AI_SANDBOX_SOURCE_KEY = invalid;
      await expect(
        scoped(() => repository.start(input())),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );

  it('rejects mismatched source/hash, oversized UTF8, malformed digest and unredacted limits', async () => {
    for (const patch of [
      { source_hash: 'd'.repeat(64) },
      {
        source: 'ñ'.repeat(17000),
        source_hash: sandboxSourceHash('ñ'.repeat(17000)),
      },
      { runtime_digest: 'runtime-latest' },
      { limits: { customer_name: 5 } },
      { limits: { wall_ms: Infinity } },
      { manifest: ['read_products', 'read_products'] },
      { manifest: ['read_products;process.exit()'] },
    ]) {
      await expect(
        scoped(() => repository.start(input(patch))),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('encrypts normalized source with AES256-GCM, random nonce and identity-bound AAD; never stores plaintext/key', async () => {
    const request = input();
    await scoped(() => repository.start(request));
    const query = inserts(tx)[0];
    const ciphertext = query.values[6] as Buffer;
    const nonce = query.values[7] as Buffer;
    const tag = query.values[8] as Buffer;
    expect(query.values.slice(0, 6)).toEqual([
      ID,
      10,
      20,
      30,
      OBJECTIVE,
      sandboxSourceHash(source),
    ]);
    expect(Buffer.isBuffer(ciphertext)).toBe(true);
    expect(ciphertext.equals(Buffer.from(normalizeSandboxSource(source)))).toBe(
      false,
    );
    expect(nonce).toHaveLength(12);
    expect(tag).toHaveLength(16);
    expect(query.values[9]).toMatch(/^[a-f0-9]{16}$/);
    const decrypt = (owner = 30, digest = request.runtime_digest): string => {
      const decipher = createDecipheriv('aes-256-gcm', key, nonce);
      decipher.setAAD(
        Buffer.from(
          JSON.stringify([
            'vendix-sandbox-source-v1',
            ID,
            OBJECTIVE,
            20,
            10,
            owner,
            request.source_hash,
            request.policy_digest,
            digest,
          ]),
        ),
      );
      decipher.setAuthTag(tag);
      return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString('utf8');
    };
    expect(decrypt()).toBe(normalizeSandboxSource(source));
    expect(() => decrypt(31)).toThrow();
    expect(() => decrypt(30, `sha256:${'e'.repeat(64)}`)).toThrow();
    expect(
      JSON.stringify([
        ...tx.$queryRaw.mock.calls,
        ...tx.$executeRaw.mock.calls,
      ]),
    ).not.toContain(source);
    expect(JSON.stringify(query.values)).not.toContain(key.toString('base64'));
    await scoped(() => repository.start(input({ id: RESULT })));
    expect(inserts(tx)[1].values[7]).not.toEqual(nonce);
  });

  it('checks scoped live objective and capacity under a distributed transaction advisory lock before insert', async () => {
    await scoped(() => repository.start(input()));
    const statements = tx.$queryRaw.mock.calls.map(([query]: [Query]) => query);
    expect(statements[0].sql).toContain(
      "set_config('lock_timeout', '1000ms', true)",
    );
    expect(tx.$executeRaw.mock.calls[0][0].sql).toContain(
      'pg_advisory_xact_lock',
    );
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.$queryRaw.mock.invocationCallOrder[1],
    );
    expect(statements[1].sql).toContain('FROM ai_agent_objectives');
    expect(statements[1].sql).toContain('FOR KEY SHARE');
    expect(statements[1].values).toEqual([OBJECTIVE, 10, 20, 30]);
    expect(statements[1].sql).toContain('expires_at > CURRENT_TIMESTAMP');
    expect(statements[2].sql).toContain('AS attempt_count');
    expect(statements[2].values).toEqual([OBJECTIVE, 10, 20, 30]);
    expect(statements[2].sql).not.toMatch(
      /lease_until|expires_at|source_hash|outcome/,
    );
    // Finished/cancelled rows remain capacity tombstones until original30s lease.
    expect(statements[3].sql).not.toContain('outcome =');
    expect(statements[3].sql).toContain('lease_until > CURRENT_TIMESTAMP');
    expect(statements[3].sql).toContain('COUNT(*) FILTER (WHERE store_id =');
    expect(inserts(tx)[0].sql).toContain("INTERVAL '30 seconds'");
    expect(inserts(tx)[0].sql).toContain("INTERVAL '7 days'");
    expect(prisma.$transaction.mock.calls[0][1]).toEqual({
      timeout: 5000,
      maxWait: 1000,
      isolationLevel: 'ReadCommitted',
    });
  });

  it('refuses absent/foreign/expired/cancelled objective without inserting an audit run', async () => {
    const original = tx.$queryRaw.getMockImplementation()!;
    tx.$queryRaw.mockImplementation((query: Query) =>
      query.sql.includes('FROM ai_agent_objectives') ? [] : original(query),
    );
    await expect(
      scoped(() => repository.start(input())),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(inserts(tx)).toHaveLength(0);
  });

  it.each([
    { global_count: 1, store_count: 1 },
    { global_count: 2, store_count: 0 },
    { global_count: -1, store_count: 0 },
    { global_count: NaN, store_count: 0 },
  ])(
    'refuses per-store/global capacity or malformed admission result',
    async (counts) => {
      const original = tx.$queryRaw.getMockImplementation()!;
      tx.$queryRaw.mockImplementation((query: Query) =>
        query.sql.includes('AS global_count') ? [counts] : original(query),
      );
      await expect(
        scoped(() => repository.start(input())),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(inserts(tx)).toHaveLength(0);
    },
  );

  it('honors configured global cap and rejects invalid caps before SQL', async () => {
    process.env.AI_SANDBOX_MAX_RUNNERS = '1';
    const original = tx.$queryRaw.getMockImplementation()!;
    tx.$queryRaw.mockImplementation((query: Query) =>
      query.sql.includes('AS global_count')
        ? [{ global_count: 1, store_count: 0 }]
        : original(query),
    );
    await expect(
      scoped(() => repository.start(input())),
    ).rejects.toBeInstanceOf(ConflictException);
    prisma.$transaction.mockClear();
    for (const invalid of ['0', 'NaN', '3.5', '33', '', '02']) {
      process.env.AI_SANDBOX_MAX_RUNNERS = invalid;
      await expect(
        scoped(() => repository.start(input())),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    }
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([2, 3, -1, NaN])(
    'fails closed for exhausted or malformed per-objective attempts %s',
    async (count) => {
      const original = tx.$queryRaw.getMockImplementation()!;
      tx.$queryRaw.mockImplementation((query: Query) =>
        query.sql.includes('AS attempt_count')
          ? [{ attempt_count: count }]
          : original(query),
      );
      await expect(
        scoped(() => repository.start(input())),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(inserts(tx)).toHaveLength(0);
      expect(
        tx.$queryRaw.mock.calls.some(([query]: [Query]) =>
          query.sql.includes('AS global_count'),
        ),
      ).toBe(false);
    },
  );

  it('fails closed when per-objective attempts cannot be observed', async () => {
    const original = tx.$queryRaw.getMockImplementation()!;
    tx.$queryRaw.mockImplementation((query: Query) =>
      query.sql.includes('AS attempt_count') ? [] : original(query),
    );
    await expect(
      scoped(() => repository.start(input())),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(inserts(tx)).toHaveLength(0);
  });

  it('allows exactly one repair with a changed source but refuses another turn after both leases expired', async () => {
    const runs = [
      {
        ...ctx,
        objective_id: OBJECTIVE,
        source_hash: 'd'.repeat(64),
        outcome: 'timeout',
        lease_until: new Date(1),
      },
    ];
    const original = tx.$queryRaw.getMockImplementation()!;
    tx.$queryRaw.mockImplementation((query: Query) => {
      if (!query.sql.includes('AS attempt_count')) return original(query);
      const [objective, store, organization, user] = query.values;
      return [
        {
          attempt_count: runs.filter(
            (run) =>
              run.objective_id === objective &&
              run.store_id === store &&
              run.organization_id === organization &&
              run.user_id === user,
          ).length,
        },
      ];
    });
    tx.$executeRaw.mockImplementation((query: Query) => {
      if (query.sql.includes('INSERT INTO ai_agent_script_runs'))
        runs.push({
          ...ctx,
          objective_id: String(query.values[4]),
          source_hash: String(query.values[5]),
          outcome: 'failed',
          lease_until: new Date(1),
        });
      return 1;
    });
    const repaired = "return 'synthetic repaired source';";
    await scoped(() =>
      repository.start(
        input({ source: repaired, source_hash: sandboxSourceHash(repaired) }),
      ),
    );
    expect(runs).toHaveLength(2);
    const third = "return 'third source on a new model turn';";
    await expect(
      scoped(() =>
        repository.start(
          input({
            id: RESULT,
            source: third,
            source_hash: sandboxSourceHash(third),
          }),
        ),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(inserts(tx)).toHaveLength(1);
    const attemptQueries = tx.$queryRaw.mock.calls
      .map(([query]: [Query]) => query)
      .filter((query) => query.sql.includes('AS attempt_count'));
    expect(attemptQueries).toHaveLength(2);
    expect(
      attemptQueries.every(
        (query) => query.values.join(',') === [OBJECTIVE, 10, 20, 30].join(','),
      ),
    ).toBe(true);
  });

  it('keeps attempt ceilings objective/owner/store/org scoped rather than inheriting another principal history', async () => {
    const history = [
      { ...ctx, objective_id: OBJECTIVE, user_id: 31 },
      { ...ctx, objective_id: OBJECTIVE, store_id: 11 },
      { ...ctx, objective_id: OBJECTIVE, organization_id: 21 },
      { ...ctx, objective_id: RESULT },
    ];
    const original = tx.$queryRaw.getMockImplementation()!;
    tx.$queryRaw.mockImplementation((query: Query) => {
      if (!query.sql.includes('AS attempt_count')) return original(query);
      const [objective, store, organization, user] = query.values;
      return [
        {
          attempt_count: history.filter(
            (run) =>
              run.objective_id === objective &&
              run.store_id === store &&
              run.organization_id === organization &&
              run.user_id === user,
          ).length,
        },
      ];
    });
    await scoped(() => repository.start(input()));
    expect(inserts(tx)).toHaveLength(1);
  });

  it('serial admission protocol allows one run per store and two globally across API instances (SQL mock, not PG certification)', async () => {
    const active: Array<{ store_id: number }> = [];
    let tail: Promise<unknown> = Promise.resolve();
    prisma.$transaction.mockImplementation(
      (fn: (client: typeof tx) => Promise<unknown>) => {
        const next = tail.then(() => fn(tx));
        tail = next.catch(() => undefined);
        return next;
      },
    );
    const original = tx.$queryRaw.getMockImplementation()!;
    tx.$queryRaw.mockImplementation((query: Query) =>
      query.sql.includes('AS global_count')
        ? [
            {
              global_count: active.length,
              store_count: active.filter(
                (run) => run.store_id === query.values[0],
              ).length,
            },
          ]
        : original(query),
    );
    tx.$executeRaw.mockImplementation((query: Query) => {
      if (query.sql.includes('INSERT INTO ai_agent_script_runs'))
        active.push({ store_id: Number(query.values[1]) });
      return 1;
    });
    const second = new SandboxAuditRepository(
      prisma as unknown as GlobalPrismaService,
    );
    const sameStore = await Promise.allSettled([
      scoped(() => repository.start(input())),
      scoped(() => second.start(input({ id: RESULT }))),
    ]);
    expect(sameStore.map((value) => value.status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);
    await RequestContextService.runIsolated({ ...ctx, store_id: 11 }, () =>
      second.start(input({ id: RESULT })),
    );
    await expect(
      RequestContextService.runIsolated({ ...ctx, store_id: 12 }, () =>
        second.start(input({ id: OBJECTIVE })),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(active).toEqual([{ store_id: 10 }, { store_id: 11 }]);
  });

  it('snapshots caller metadata before waiting on admission; concurrent mutation cannot change source binding', async () => {
    let release: () => void = () => undefined;
    const wait = new Promise<void>((resolveWait) => {
      release = resolveWait;
    });
    tx.$executeRaw.mockImplementation(async (query: Query) => {
      if (query.sql.includes('pg_advisory_xact_lock')) await wait;
      return 1;
    });
    const request = input();
    const pending = scoped(() => repository.start(request));
    request.id = RESULT;
    request.objective_id = RESULT;
    request.manifest.push('foreign_tool');
    request.source_hash = 'e'.repeat(64);
    release();
    await pending;
    const insert = inserts(tx)[0];
    expect(insert.values[0]).toBe(ID);
    expect(insert.values[4]).toBe(OBJECTIVE);
    expect(insert.values[5]).toBe(sandboxSourceHash(source));
    expect(insert.values[13]).toBe('["read_products"]');
  });

  it('records redacted intent then final events, bounded by20seq/40events, lease, owner and manifest', async () => {
    await scoped(() =>
      repository.appendCall(
        ID,
        call({
          // Extra caller properties can never reach SQL.
          ...({
            args: { email: 'synthetic@example.invalid' },
            result: 'private',
          } as object),
        }),
      ),
    );
    await scoped(() =>
      repository.appendCall(
        ID,
        call({ status: 'ok', result_ref: `agent-result:${RESULT}` }),
      ),
    );
    const intent = tx.$queryRaw.mock.calls[0][0] as Query;
    expect(JSON.parse(String(intent.values[0]))).toEqual([call()]);
    expect(intent.values.slice(1, 5)).toEqual([ID, 10, 20, 30]);
    expect(intent.sql).toContain('lease_until > CURRENT_TIMESTAMP');
    expect(intent.sql).toContain('expires_at > CURRENT_TIMESTAMP');
    expect(intent.values).toContain(40);
    expect(intent.sql).toContain("call->>'status' <> 'dispatching'");
    expect(intent.sql).toContain("call->>'args_hash' =");
    expect(intent.sql).toContain('manifest ?');
    const terminal = tx.$queryRaw.mock.calls[1][0] as Query;
    expect(terminal.sql).toContain('FROM ai_agent_tool_results result');
    expect(terminal.sql).toContain(
      'result.objective_id = ai_agent_script_runs.objective_id',
    );
    expect(terminal.sql).toContain('result.organization_id =');
    expect(terminal.sql).toContain('result.store_id =');
    expect(terminal.sql).toContain('result.user_id =');
    expect(terminal.sql).toContain('result.tool_name =');
    expect(terminal.values).toContain(RESULT);
    expect(JSON.stringify(intent.values)).not.toContain(
      'synthetic@example.invalid',
    );
  });

  it('can record rejected foreign-tool attempts without invoking or adding their args/results', async () => {
    await scoped(() =>
      repository.appendCall(
        ID,
        call({
          tool: 'forbidden_tool',
          status: 'denied',
          denial: 'SANDBOX_DENIED',
        }),
      ),
    );
    const query = tx.$queryRaw.mock.calls[0][0] as Query;
    expect(JSON.parse(String(query.values[0]))[0]).toEqual(
      call({
        tool: 'forbidden_tool',
        status: 'denied',
        denial: 'SANDBOX_DENIED',
      }),
    );
    expect(query.values).toContain(true);
  });

  it.each([
    { seq: 0 },
    { seq: 21 },
    { seq: 1.5 },
    { args_hash: 'raw args' },
    { tool: 'name@customer.invalid' },
    { status: 'secret exception message' },
    { denial: 'raw PII error' },
    { result_ref: 'https://example.invalid/signed-secret' },
  ])('rejects invalid/unredacted call metadata before SQL', async (patch) => {
    await expect(
      scoped(() => repository.appendCall(ID, call(patch))),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('fails closed for stale/foreign run, duplicate seq, unaudited intent or foreign result reference', async () => {
    tx.$queryRaw.mockResolvedValue([]);
    await expect(
      scoped(() => repository.appendCall(ID, call({ status: 'ok' }))),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('finishes under all owner predicates, preserves admission cooldown and stores only observed numeric usage with verified=false', async () => {
    await scoped(() =>
      repository.finish(ID, 'ok', {
        calls: 2,
        pages: 3,
        rows: 5,
        wall_ms: 80,
        cpu_ms: 5,
        input_bytes: 200,
        output_bytes: 100,
        memory_mb: 64,
        cost_usd: null,
        verified: true,
        denials: 0,
        source,
        token: 'secret',
        args: { customer: 'synthetic' },
        result: 'private',
      }),
    );
    const query = tx.$queryRaw.mock.calls[0][0] as Query;
    expect(query.values.slice(2)).toEqual([ID, 10, 20, 30]);
    expect(JSON.parse(String(query.values[1]))).toEqual({
      verified: false,
      cost_usd: null,
      calls: 2,
      pages: 3,
      rows: 5,
      input_bytes: 200,
      output_bytes: 100,
      wall_ms: 80,
      cpu_ms: 5,
      memory_mb: 64,
      denials: 0,
    });
    expect(query.sql).not.toContain('lease_until =');
    expect(query.sql).toContain("AND outcome = 'running'");
  });

  it('keeps unknown/invalid usage absent, preserves observed cost and never invents zero', async () => {
    await scoped(() =>
      repository.finish(ID, 'failed', {
        calls: NaN,
        pages: -1,
        rows: '5',
        cost_usd: 0.001,
      }),
    );
    expect(JSON.parse(tx.$queryRaw.mock.calls[0][0].values[1])).toEqual({
      verified: false,
      cost_usd: 0.001,
    });
  });

  it('lets a same-outcome finish retry observe existing result without rewriting terminal evidence', async () => {
    tx.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ outcome: 'timeout' }]);
    await scoped(() => repository.finish(ID, 'timeout', { wall_ms: 30000 }));
    expect(tx.$queryRaw.mock.calls[1][0].values).toEqual([ID, 10, 20, 30]);
    expect(tx.$queryRaw.mock.calls[1][0].sql).toContain('SELECT outcome');
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('cannot overwrite a different terminal state or foreign run', async () => {
    tx.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ outcome: 'ok' }]);
    await expect(
      scoped(() => repository.finish(ID, 'failed', {})),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('never accepts running/arbitrary outcome as a terminal result', async () => {
    for (const outcome of ['running', source, 'completed_verified']) {
      await expect(
        scoped(() => repository.finish(ID, outcome, {})),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('get has explicit owner+retention ACL and a crypto-free fixed projection even if a mock returns excess columns', async () => {
    tx.$queryRaw.mockResolvedValue([
      {
        ...row(),
        source,
        source_ciphertext: Buffer.from('private'),
        source_nonce: Buffer.alloc(12),
        source_auth_tag: Buffer.alloc(16),
        source_key_id: 'never-return',
      },
    ]);
    const result = await scoped(() => repository.get(ID));
    expect(result).not.toHaveProperty('source');
    expect(result).not.toHaveProperty('source_ciphertext');
    expect(result).not.toHaveProperty('source_nonce');
    expect(result).not.toHaveProperty('source_auth_tag');
    expect(result).not.toHaveProperty('source_key_id');
    const query = tx.$queryRaw.mock.calls[0][0] as Query;
    expect(query.values).toEqual([ID, 10, 20, 30]);
    expect(query.sql).toContain('expires_at > CURRENT_TIMESTAMP');
    expect(query.sql).not.toContain('SELECT *');
    expect(query.sql).not.toContain('source_ciphertext');
    expect(query.sql).not.toContain('source_nonce');
    expect(query.sql).not.toContain('source_auth_tag');
  });

  it('projects a killed/stale running lease as timeout without mass cleanup or writes', async () => {
    tx.$queryRaw.mockResolvedValue([row({ lease_until: new Date(1) })]);
    expect((await scoped(() => repository.get(ID))).outcome).toBe('timeout');
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it.each([
    { ...ctx, user_id: 31 },
    { ...ctx, store_id: 11 },
    { ...ctx, organization_id: 21 },
  ])('does not return another owner/store/org run', async (foreign) => {
    tx.$queryRaw.mockResolvedValue([]);
    await expect(
      RequestContextService.runIsolated(foreign, () => repository.get(ID)),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.$queryRaw.mock.calls[0][0].values).toEqual([
      ID,
      foreign.store_id,
      foreign.organization_id,
      foreign.user_id,
    ]);
  });

  it('migration is additive/idempotent, includes bounded crypto/retention constraints and no business cascades or mutations', () => {
    const migration = readFileSync(
      resolve(
        __dirname,
        '../../../prisma/migrations/20261018120000_ai_agent_script_runs/migration.sql',
      ),
      'utf8',
    );
    const sql = migration
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
    expect(migration).toContain('-- DATA IMPACT:');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "ai_agent_script_runs"');
    expect(sql.match(/CREATE INDEX IF NOT EXISTS/g)).toHaveLength(5);
    expect(sql).toContain('octet_length("source_nonce") = 12');
    expect(sql).toContain('octet_length("source_auth_tag") = 16');
    expect(sql).toContain('jsonb_array_length("calls") <= 40');
    expect(sql).toContain("INTERVAL '30 seconds'");
    expect(sql).toContain("INTERVAL '7 days'");
    expect(sql).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE|UPDATE|CASCADE)\b/i);
    expect(sql).not.toContain('"source" TEXT');
  });
});
