import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { RequestContextService } from '../../common/context/request-context.service';
import type { StorePrismaService } from '../../prisma/services/store-prisma.service';
import type { AgentPlan } from '../interfaces/agent-plan.interface';
import type { ToolExecutionReceipt } from '../tools/interfaces/tool.interface';
import {
  addObjectiveBudget,
  AgentObjectiveRepository,
  requireObjectiveScope,
} from './agent-objective.repository';
import { ObjectiveMemoryDatabase } from './testing/objective-memory-db';
import { safeObjectiveArtifact } from './agent-artifact-safety';
import {
  AgentEffect,
  AgentObjective,
  AgentToolResult,
  emptyObjectiveBudget,
} from './interfaces/agent-objective.interface';

const ID = '00000000-0000-4000-8000-000000000001';
const RESULT = '00000000-0000-4000-8000-000000000002';
const ctx = {
  store_id: 10,
  organization_id: 20,
  user_id: 30,
  permissions: ['products:read'],
  is_super_admin: false,
  is_owner: true,
};
const plan: AgentPlan = {
  id: 'plan-a',
  goal: 'Consultar producto',
  status: 'active',
  steps: [],
  deliverables: [],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};
const receipt: ToolExecutionReceipt = {
  schema_version: '1',
  status: 'ok',
  error_code: null,
  retryable: false,
  next_action: null,
  evidence_refs: [],
  resource_ids: { product_id: 55 },
  pagination: { complete: true, has_more: false },
  freshness: 'observed',
  effect_status: 'not_applicable',
};
const row = (patch: Partial<AgentObjective> = {}): AgentObjective => ({
  id: ID,
  ...ctx,
  conversation_id: 5,
  agent_id: 'vexi',
  legacy_plan_id: 'plan-a',
  goal: plan.goal,
  plan,
  entities: [],
  step_hashes: null,
  next_step: null,
  semantic_status: 'active',
  version: 3,
  lease_generation: 2,
  lease_until: new Date(Date.now() + 60000),
  budget: emptyObjectiveBudget(),
  authority_snapshot: ['products:read'],
  requires_revalidation: true,
  expires_at: new Date(Date.now() + 86400000),
  created_at: new Date(),
  updated_at: new Date(),
  ...patch,
});
const result = (patch: Partial<AgentToolResult> = {}): AgentToolResult => ({
  id: RESULT,
  ...ctx,
  objective_id: ID,
  task_id: null,
  tool_call_id: 'call-a',
  tool_name: 'read_product',
  tool_version: '1',
  args_hash: 'a'.repeat(64),
  receipt,
  data: { id: 55 },
  pagination: receipt.pagination,
  freshness: 'observed',
  resource_ids: receipt.resource_ids,
  evidence_refs: [],
  lease_generation: 2,
  stale_lease: false,
  created_at: new Date(),
  ...patch,
});
const scoped = <T>(callback: () => T): T =>
  RequestContextService.runIsolated(ctx, callback);
const statement = (call: unknown[]): string => (call[0] as { sql: string }).sql;

describe('AgentObjectiveRepository D1', () => {
  let tx: { $queryRaw: jest.Mock; $executeRaw: jest.Mock };
  let repository: AgentObjectiveRepository;

  beforeEach(() => {
    tx = { $queryRaw: jest.fn(), $executeRaw: jest.fn().mockResolvedValue(1) };
    repository = new AgentObjectiveRepository({
      $transaction: async (fn: (client: typeof tx) => Promise<unknown>) =>
        fn(tx),
    } as unknown as StorePrismaService);
  });
  afterAll(() => {});

  it('rejects missing ALS even when the historical static context exists', async () => {
    RequestContextService.run(ctx, () => undefined);
    expect(RequestContextService.getContext()).toEqual(ctx);
    expect(() => requireObjectiveScope()).toThrow(UnauthorizedException);
    await expect(repository.get(ID)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
  it('requires a positive explicit store/org/owner (superadmin is not an ownership bypass)', () => {
    expect(() =>
      RequestContextService.runIsolated(
        { ...ctx, user_id: undefined, is_super_admin: true },
        () => requireObjectiveScope(),
      ),
    ).toThrow(UnauthorizedException);
  });
  it('queries every owner dimension and returns identical absent/foreign 404', async () => {
    tx.$queryRaw.mockResolvedValue([]);
    await expect(scoped(() => repository.get(ID))).rejects.toBeInstanceOf(
      NotFoundException,
    );
    const query = tx.$queryRaw.mock.calls[0][0];
    expect(query.values).toEqual([ID, 10, 20, 30]);
    expect(query.sql).toContain('organization_id =');
    expect(query.sql).toContain('user_id =');
  });
  it('projects expiration without a write or a false completion', async () => {
    tx.$queryRaw.mockResolvedValue([
      row({ expires_at: new Date(1), semantic_status: 'partial' }),
    ]);
    expect((await scoped(() => repository.get(ID))).semantic_status).toBe(
      'expired',
    );
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });
  it('fails closed for a tombstone without a pointer (no legacy resurrection)', async () => {
    tx.$queryRaw.mockResolvedValue([
      {
        id: 5,
        metadata: { agent_objective_authority: 'durable-v1', agent_plan: plan },
      },
    ]);
    await expect(
      scoped(() => repository.importLegacy(5)),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });
  it('locks/re-reads legacy once, preserves pending proposals/hashes and both importers share the objective', async () => {
    let metadata: Record<string, unknown> = {
      agent_plan: plan,
      agent_plan_step_hashes: { steps: [{ order: 1, hash: 'abc' }] },
      pending_proposal: { id: 7 },
      other: 'keep',
    };
    let imported: AgentObjective | undefined;
    let tail: Promise<unknown> = Promise.resolve();
    repository = new AgentObjectiveRepository({
      $transaction: (fn: (client: typeof tx) => Promise<unknown>) => {
        const next = tail.then(() => fn(tx));
        tail = next.catch(() => undefined);
        return next;
      },
    } as unknown as StorePrismaService);
    tx.$queryRaw.mockImplementation(
      async (query: { sql: string; values: unknown[] }) => {
        if (query.sql.includes('FROM ai_conversations'))
          return [{ id: 5, metadata: structuredClone(metadata) }];
        if (query.sql.includes('INSERT INTO ai_agent_objectives')) {
          imported = row({ id: String(query.values[0]), lease_until: null });
          return [imported];
        }
        if (query.sql.includes('FROM ai_agent_objectives')) return [imported];
        throw Error('Unexpected SQL');
      },
    );
    tx.$executeRaw.mockImplementation(
      async (query: { sql: string; values: unknown[] }) => {
        if (query.sql.includes('UPDATE ai_conversations'))
          metadata = JSON.parse(String(query.values[0]));
        return 1;
      },
    );
    const [a, b] = await scoped(() =>
      Promise.all([
        repository.importLegacy(5, 'vexi'),
        repository.importLegacy(5, 'vexi'),
      ]),
    );
    expect(a?.id).toBe(b?.id);
    expect(
      tx.$queryRaw.mock.calls.filter((call) =>
        statement(call).includes('INSERT INTO ai_agent_objectives'),
      ),
    ).toHaveLength(1);
    expect(
      tx.$queryRaw.mock.calls
        .filter((call) => statement(call).includes('FROM ai_conversations'))
        .every((call) => statement(call).includes('FOR UPDATE')),
    ).toBe(true);
    expect(metadata.agent_plan).toBeNull();
    expect(metadata.agent_plan_legacy_history).toEqual(plan);
    expect(metadata.agent_plan_step_hashes).toEqual({
      steps: [{ order: 1, hash: 'abc' }],
    });
    expect(metadata.pending_proposal).toEqual({ id: 7 });
    expect(metadata.other).toBe('keep');
    const insert = tx.$queryRaw.mock.calls.find((call) =>
      statement(call).includes('INSERT INTO ai_agent_objectives'),
    )![0];
    expect(insert.values).toContain(JSON.stringify(['products:read']));
  });
  it('acquires by version, advances generation, refuses a live lease or stale CAS', async () => {
    tx.$queryRaw
      .mockResolvedValueOnce([row()])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    await expect(
      scoped(() => repository.acquireLease(ID, 2)),
    ).rejects.toBeInstanceOf(ConflictException);
    const sql = statement(tx.$queryRaw.mock.calls[2]);
    expect(sql).toContain('lease_generation=lease_generation+1');
    expect(sql).toContain(
      'lease_until IS NULL OR lease_until<=CURRENT_TIMESTAMP',
    );
  });
  it('blocks acquisition after an unacknowledged dispatch instead of recreating product', async () => {
    tx.$queryRaw
      .mockResolvedValueOnce([row({ lease_until: null })])
      .mockResolvedValueOnce([{ id: 'effect-a' }]);
    await expect(scoped(() => repository.acquireLease(ID, 3))).rejects.toThrow(
      'reconciliation',
    );
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
  });
  it('rejects stale checkpoint with no writes', async () => {
    tx.$queryRaw.mockResolvedValue([row({ version: 4 })]);
    expect(
      await scoped(() =>
        repository.checkpoint(
          ID,
          { version: 3, lease_generation: 2 },
          { next_step: 'stale' },
        ),
      ),
    ).toBeNull();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });
  it('keeps own lease generation while saving first/updated plan', async () => {
    tx.$queryRaw
      .mockResolvedValueOnce([row({ plan: null })])
      .mockResolvedValueOnce([row({ version: 4 })]);
    const saved = await scoped(() =>
      repository.savePlan(ID, 3, plan, { version: 3, lease_generation: 2 }),
    );
    expect(saved.version).toBe(4);
    expect(saved.lease_generation).toBe(2);
    expect(tx.$queryRaw.mock.calls[1][0].values).toContain(0);
  });
  it('never accepts model completion as independent verified business outcome', async () => {
    tx.$queryRaw.mockResolvedValue([row()]);
    await expect(
      scoped(() =>
        repository.checkpoint(ID, { version: 3, lease_generation: 2 }, {
          semantic_status: 'completed_verified',
        } as never),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it('audits stale call and budget without advancing the replacement plan', async () => {
    tx.$queryRaw
      .mockResolvedValueOnce([row({ version: 9, lease_generation: 3 })])
      .mockResolvedValueOnce([result({ stale_lease: true })]);
    const saved = await scoped(() =>
      repository.appendToolResult(
        ID,
        { version: 3, lease_generation: 2 },
        {
          tool_call_id: 'call-a',
          tool_name: 'read_product',
          args_hash: 'a'.repeat(64),
          receipt,
          data: { id: 55 },
          budget_delta: { tools: 1 },
          checkpoint: { next_step: 'do not overwrite' },
        },
      ),
    );
    expect(saved.advanced).toBe(false);
    expect(saved.result.stale_lease).toBe(true);
    expect(saved.objective.version).toBe(9);
    expect(saved.objective.budget.tools).toBe(1);
    expect(saved.objective.next_step).toBeNull();
    const write = statement(tx.$executeRaw.mock.calls[0]);
    expect(write).not.toContain('version=');
    expect(write).not.toContain('next_step=');
  });
  it('deduplicates persisted call identity and never charges twice', async () => {
    tx.$queryRaw
      .mockResolvedValueOnce([row()])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([result()]);
    const saved = await scoped(() =>
      repository.appendToolResult(
        ID,
        { version: 3, lease_generation: 2 },
        {
          tool_call_id: 'call-a',
          tool_name: 'read_product',
          args_hash: 'a'.repeat(64),
          receipt,
          data: { id: 55 },
          budget_delta: { tools: 1 },
        },
      ),
    );
    expect(saved.advanced).toBe(false);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });
  it('rejects reuse of a call ID with changed arguments', async () => {
    tx.$queryRaw
      .mockResolvedValueOnce([row()])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([result()]);
    await expect(
      scoped(() =>
        repository.appendToolResult(ID, null, {
          tool_call_id: 'call-a',
          tool_name: 'read_product',
          args_hash: 'b'.repeat(64),
          receipt,
          data: { id: 55 },
        }),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('stores full safe artifact data and derives IDs only from an observed explicit receipt', async () => {
    const saved = row({
      version: 4,
      entities: [
        {
          store_id: 10,
          type: 'product_id',
          id: 55,
          source_call_id: 'call-a',
          observed_at: new Date().toISOString(),
          volatile: false,
        },
      ],
    });
    tx.$queryRaw
      .mockResolvedValueOnce([row()])
      .mockResolvedValueOnce([result()])
      .mockResolvedValueOnce([result()])
      .mockResolvedValueOnce([saved]);
    const output = await scoped(() =>
      repository.appendToolResult(
        ID,
        { version: 3, lease_generation: 2 },
        {
          tool_call_id: 'call-a',
          tool_name: 'read_product',
          args_hash: 'a'.repeat(64),
          receipt,
          data: {
            id: 55,
            quantity: 7,
            confirmation_token: 'never',
            nested: { access_token: 'never' },
            signed: 'https://s3/a?X-Amz-Signature=secret',
          },
        },
      ),
    );
    expect(output.advanced).toBe(true);
    expect(output.objective.entities[0].id).toBe(55);
    const values = tx.$queryRaw.mock.calls[1][0].values.join(' ');
    expect(values).not.toContain('never');
    expect(values).not.toContain('Signature=secret');
    expect(values).toContain('quantity');
  });
  it('rejects forged entity provenance even if the text mentions an existing ID', async () => {
    tx.$queryRaw.mockResolvedValueOnce([row()]).mockResolvedValueOnce([]);
    await expect(
      scoped(() =>
        repository.checkpoint(
          ID,
          { version: 3, lease_generation: 2 },
          {
            entities: [
              {
                store_id: 10,
                type: 'product',
                id: 55,
                source_call_id: 'invented',
                observed_at: new Date().toISOString(),
              },
            ],
          },
        ),
      ),
    ).rejects.toThrow('provenance');
  });
  it('pages artifacts with scope+stable compound order and exposes full-data retrieval separately', async () => {
    tx.$queryRaw
      .mockResolvedValueOnce([row()])
      .mockResolvedValueOnce([
        result(),
        result({ id: '00000000-0000-4000-8000-000000000003' }),
      ]);
    const page = await scoped(() => repository.listResults(ID, { limit: 1 }));
    expect(page.has_more).toBe(true);
    expect(page.next_cursor).toBe(RESULT);
    expect(statement(tx.$queryRaw.mock.calls[1])).toContain(
      'ORDER BY created_at,id',
    );
    expect(statement(tx.$queryRaw.mock.calls[1])).toContain(
      'octet_length(data::text)<=1500',
    );
  });
  it('requires explicit expired selection and never resets accumulated budget', async () => {
    tx.$queryRaw
      .mockResolvedValueOnce([
        row({
          expires_at: new Date(1),
          lease_until: null,
          budget: { ...emptyObjectiveBudget(), tools: 19 },
        }),
      ])
      .mockResolvedValueOnce([]);
    await expect(
      scoped(() =>
        repository.resume(ID, { allow_expired: false, expected_version: 3 }),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
  });
  it('refuses resume of a pending proposal so a new message cannot bypass choice', async () => {
    tx.$queryRaw.mockResolvedValue([
      row({ semantic_status: 'awaiting_approval', lease_until: null }),
    ]);
    await expect(
      scoped(() =>
        repository.resume(ID, { allow_expired: true, expected_version: 3 }),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });
  it('rejects proposal under owner/version lock, cancels unstarted effects and keeps budget', async () => {
    const waiting = row({
      semantic_status: 'awaiting_approval',
      lease_until: null,
      budget: { ...emptyObjectiveBudget(), tools: 19 },
    });
    tx.$queryRaw
      .mockResolvedValueOnce([waiting])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          ...waiting,
          semantic_status: 'active',
          version: 4,
          lease_generation: 3,
        },
      ]);
    const next = await scoped(() => repository.rejectProposal(ID, 3));
    expect(next.semantic_status).toBe('active');
    expect(next.budget.tools).toBe(19);
    expect(statement(tx.$executeRaw.mock.calls[0])).toContain(
      "status IN ('proposed','approved')",
    );
    expect(tx.$executeRaw.mock.calls[0][0].values.join(' ')).toContain(
      'user_rejected',
    );
  });
  it('only meaningful valid plan writes refresh idle24h; leases/budget do not', async () => {
    tx.$queryRaw
      .mockResolvedValueOnce([row()])
      .mockResolvedValueOnce([row({ version: 4 })]);
    await scoped(() =>
      repository.savePlan(ID, 3, plan, { version: 3, lease_generation: 2 }),
    );
    const query = tx.$queryRaw.mock.calls[1][0];
    expect(query.sql).toContain('expires_at=');
    expect(
      query.values.some(
        (value: unknown) =>
          value instanceof Date && value.getTime() > Date.now() + 86300000,
      ),
    ).toBe(true);
  });
  it('audits actual late provider usage under scope without advancing the replacement state or adopting its fence', async () => {
    const current = row({
      version: 9,
      lease_generation: 3,
      budget: {
        ...emptyObjectiveBudget(),
        provider_attempts: 4,
        prompt_tokens: 12,
        completion_tokens: 3,
        cost_usd: 0.5,
        tools: 7,
        recovery: 2,
      },
    });
    tx.$queryRaw.mockResolvedValueOnce([current]);
    await scoped(() =>
      repository.auditBudget(ID, 1, {
        prompt_tokens: 5,
        completion_tokens: 2,
        cost_usd: 0.1,
      }),
    );
    expect(tx.$queryRaw.mock.calls[0][0].values).toEqual([ID, 10, 20, 30]);
    expect(statement(tx.$queryRaw.mock.calls[0])).toContain('FOR UPDATE');
    const write = tx.$executeRaw.mock.calls[0][0];
    expect(JSON.parse(write.values[0])).toMatchObject({
      provider_attempts: 4,
      prompt_tokens: 17,
      completion_tokens: 5,
      cost_usd: 0.6,
      tools: 7,
      recovery: 2,
    });
    const set = write.sql.split(' WHERE ')[0];
    expect(set).toBe('UPDATE ai_agent_objectives SET budget=?::jsonb');
    expect(write.values.slice(1)).toEqual([ID, 10, 20, 30, 1]);
    expect(current).toMatchObject({
      version: 9,
      lease_generation: 3,
      semantic_status: 'active',
    });
  });
  it('rejects future generations even for an empty observed delta', async () => {
    tx.$queryRaw.mockResolvedValueOnce([row({ lease_generation: 3 })]);
    await expect(
      scoped(() => repository.auditBudget(ID, 4, {})),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });
  it.each([0, -1, 1.5, Number.NaN])(
    'rejects non-positive/non-integral audit origin generation %s before SQL',
    async (generation) => {
      await expect(
        scoped(() =>
          repository.auditBudget(ID, generation, { prompt_tokens: 1 }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.$queryRaw).not.toHaveBeenCalled();
    },
  );
  it.each([
    'tools',
    'recovery',
    'provider_attempts',
    'active_runtime_ms',
    'expansions',
  ])('does not use audit usage to grant or rewrite %s units', async (key) => {
    await expect(
      scoped(() => repository.auditBudget(ID, 1, { [key]: 1 })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });
  it('retains owner404 for audited usage and does not borrow the static request fallback', async () => {
    tx.$queryRaw.mockResolvedValueOnce([]);
    await expect(
      scoped(() => repository.auditBudget(ID, 1, { cost_usd: 0.1 })),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    RequestContextService.run(ctx, () => undefined);
    await expect(
      repository.auditBudget(ID, 1, { prompt_tokens: 1 }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('accumulates stale usage on real repository transport, preserves live lease/fence and leaves old fence stale', async () => {
    const db = new ObjectiveMemoryDatabase();
    const real = new AgentObjectiveRepository(db.prisma);
    const current = row({
      version: 9,
      lease_generation: 3,
      budget: { ...emptyObjectiveBudget(), prompt_tokens: 12, cost_usd: 0.5 },
    });
    db.objectives.set(ID, current);
    await scoped(() =>
      real.auditBudget(ID, 1, {
        prompt_tokens: 5,
        completion_tokens: 2,
        cost_usd: 0.1,
      }),
    );
    const audited = db.objectives.get(ID)!;
    expect(audited).toMatchObject({
      version: 9,
      lease_generation: 3,
      budget: { prompt_tokens: 17, completion_tokens: 2, cost_usd: 0.6 },
    });
    expect(audited.lease_until).toEqual(current.lease_until);
    expect(audited.plan).toEqual(current.plan);
    expect(audited.entities).toEqual(current.entities);
    expect(
      await scoped(() =>
        real.checkpoint(
          ID,
          { version: 3, lease_generation: 1 },
          { next_step: 'stale usage cannot revive me' },
        ),
      ),
    ).toBeNull();
    await expect(
      scoped(() => real.auditBudget(ID, 4, { cost_usd: 2 })),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(db.objectives.get(ID)!.budget.cost_usd).toBe(0.6);
  });
  it('recovers known applied receipt after pending checkpoint crash without replay, verification or reset', async () => {
    const waiting = row({
      semantic_status: 'awaiting_approval',
      lease_until: null,
      budget: { ...emptyObjectiveBudget(), tools: 19 },
    });
    const applied = {
      id: 'effect-a',
      domain_reference: '55',
      domain_receipt: { status: 'ok', resource_ids: { product_id: 55 } },
      created_at: new Date(1000),
      updated_at: new Date(2000),
    };
    tx.$queryRaw
      .mockResolvedValueOnce([waiting])
      .mockResolvedValueOnce([applied])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          ...waiting,
          version: 4,
          lease_generation: 3,
          semantic_status: 'partial',
          requires_revalidation: true,
        },
      ]);
    const recovered = await scoped(() =>
      repository.recoverAppliedReceipt(ID, 3),
    );
    expect(recovered).toMatchObject({
      semantic_status: 'partial',
      requires_revalidation: true,
      version: 4,
      lease_generation: 3,
      budget: { tools: 19 },
    });
    expect(statement(tx.$queryRaw.mock.calls[0])).toContain('FOR UPDATE');
    const update = statement(tx.$queryRaw.mock.calls[3]).split(' WHERE ')[0];
    expect(update).not.toContain('budget=');
    expect(update).not.toContain('plan=');
    expect(update).not.toContain('expires_at=');
    expect(update).not.toContain('completed_verified');
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });
  it('does not recover while another executor has a live lease', async () => {
    const waiting = row({ semantic_status: 'awaiting_approval' });
    tx.$queryRaw.mockResolvedValue([waiting]);
    expect(await scoped(() => repository.recoverAppliedReceipt(ID, 3))).toEqual(
      waiting,
    );
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });
  it('recovers only the pending lifecycle and rejects stale recovery CAS', async () => {
    tx.$queryRaw.mockResolvedValueOnce([
      row({ semantic_status: 'partial', lease_until: null }),
    ]);
    expect(
      (await scoped(() => repository.recoverAppliedReceipt(ID, 3)))
        .semantic_status,
    ).toBe('partial');
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    tx.$queryRaw.mockResolvedValueOnce([
      row({
        version: 4,
        semantic_status: 'awaiting_approval',
        lease_until: null,
      }),
    ]);
    await expect(
      scoped(() => repository.recoverAppliedReceipt(ID, 3)),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it.each([
    null,
    {
      domain_reference: '55',
      domain_receipt: { status: 'ok', resource_ids: {} },
    },
    {
      domain_reference: '55',
      domain_receipt: { status: 'ok', resource_ids: { product_id: 99 } },
    },
    {
      domain_reference: '55',
      domain_receipt: {
        status: 'unknown_effect',
        resource_ids: { product_id: 55 },
      },
    },
    {
      domain_reference: '55',
      domain_receipt: {
        status: 'ok',
        resource_ids: { product_id: 55 },
        data: { artifact: true },
      },
    },
  ])(
    'preserves pending when latest applied receipt lacks known live typed identity: %j',
    async (applied) => {
      const waiting = row({
        semantic_status: 'awaiting_approval',
        lease_until: null,
      });
      tx.$queryRaw
        .mockResolvedValueOnce([waiting])
        .mockResolvedValueOnce(applied ? [applied] : []);
      expect(
        await scoped(() => repository.recoverAppliedReceipt(ID, 3)),
      ).toEqual(waiting);
      expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    },
  );
  it.each(['proposed', 'approved', 'applying', 'unknown'])(
    'never bypasses a newer or timestamp-tied %s obligation',
    async (status) => {
      const waiting = row({
        semantic_status: 'awaiting_approval',
        lease_until: null,
      });
      tx.$queryRaw
        .mockResolvedValueOnce([waiting])
        .mockResolvedValueOnce([
          {
            id: 'effect-a',
            domain_reference: '55',
            domain_receipt: { status: 'ok', resource_ids: { product_id: 55 } },
            created_at: new Date(1000),
            updated_at: new Date(2000),
          },
        ])
        .mockResolvedValueOnce([{ id: `new-${status}` }]);
      expect(
        await scoped(() => repository.recoverAppliedReceipt(ID, 3)),
      ).toEqual(waiting);
      expect(tx.$queryRaw).toHaveBeenCalledTimes(3);
      expect(statement(tx.$queryRaw.mock.calls[2])).toContain('created_at>=');
    },
  );
  it('uses identical 404 and explicit store/org/owner scope for crash recovery', async () => {
    tx.$queryRaw.mockResolvedValueOnce([]);
    await expect(
      scoped(() => repository.recoverAppliedReceipt(ID, 3)),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.$queryRaw.mock.calls[0][0].values).toEqual([ID, 10, 20, 30]);
  });
  it('recovers dead lease through real repository transport and preserves a newer pending choice', async () => {
    const db = new ObjectiveMemoryDatabase();
    const real = new AgentObjectiveRepository(db.prisma);
    const waiting = row({
      semantic_status: 'awaiting_approval',
      lease_until: new Date(1),
      budget: { ...emptyObjectiveBudget(), tools: 19 },
    });
    const applied = {
      id: RESULT,
      store_id: 10,
      organization_id: 20,
      user_id: 30,
      objective_id: ID,
      operation_id: 'op-55',
      proposal_hash: 'a'.repeat(64),
      step_id: 'create',
      status: 'applied',
      domain_reference: '55',
      domain_receipt: { status: 'ok', resource_ids: { product_id: 55 } },
      evidence_result_id: null,
      created_at: new Date(1000),
      updated_at: new Date(2000),
    } as AgentEffect;
    db.objectives.set(ID, waiting);
    db.effects.set(RESULT, applied);
    const recovered = await scoped(() => real.recoverAppliedReceipt(ID, 3));
    expect(recovered).toMatchObject({
      semantic_status: 'partial',
      lease_until: null,
      budget: { tools: 19 },
    });
    db.objectives.set(ID, waiting);
    db.effects.set('newer', {
      ...applied,
      id: 'newer',
      operation_id: 'op-new',
      status: 'proposed',
      created_at: new Date(3000),
      updated_at: new Date(3000),
    });
    expect(
      (await scoped(() => real.recoverAppliedReceipt(ID, 3))).semantic_status,
    ).toBe('awaiting_approval');
    db.effects.set('newer', {
      ...applied,
      id: 'newer',
      operation_id: 'op-old',
      status: 'proposed',
      created_at: new Date(500),
      updated_at: new Date(500),
    });
    expect(
      (await scoped(() => real.recoverAppliedReceipt(ID, 3))).semantic_status,
    ).toBe('partial');
  });
  it('requires a lease before dispatch and independent evidence before verified', async () => {
    tx.$queryRaw.mockResolvedValue([row()]);
    await expect(
      scoped(() =>
        repository.transitionEffect(ID, 'operation-a', 'approved', 'applying'),
      ),
    ).rejects.toThrow('lease');
    await expect(
      scoped(() =>
        repository.transitionEffect(ID, 'operation-a', 'applied', 'verified'),
      ),
    ).rejects.toThrow('evidence');
  });
  it('rejects historical artifact reread as verified even with observed envelope and matching IDs', async () => {
    tx.$queryRaw
      .mockResolvedValueOnce([row()])
      .mockResolvedValueOnce([
        {
          domain_reference: '55',
          domain_receipt: { resource_ids: { product_id: 55 } },
          updated_at: new Date(1),
        },
      ])
      .mockResolvedValueOnce([
        result({
          created_at: new Date(2),
          data: { data: { artifact: true, reusable_for_write: false } },
        }),
      ]);
    await expect(
      scoped(() =>
        repository.transitionEffect(ID, 'operation-a', 'applied', 'verified', {
          evidence_result_id: RESULT,
        }),
      ),
    ).rejects.toThrow('observed evidence');
    expect(tx.$queryRaw).toHaveBeenCalledTimes(3);
  });
  it('rejects unrelated domain IDs or pre-write reads as verified', async () => {
    tx.$queryRaw
      .mockResolvedValueOnce([row()])
      .mockResolvedValueOnce([
        {
          domain_reference: '55',
          domain_receipt: { resource_ids: { order_id: 55 } },
          updated_at: new Date(2),
        },
      ])
      .mockResolvedValueOnce([result({ created_at: new Date(1) })]);
    await expect(
      scoped(() =>
        repository.transitionEffect(ID, 'operation-a', 'applied', 'verified', {
          evidence_result_id: RESULT,
        }),
      ),
    ).rejects.toThrow('observed evidence');
  });
  it('retains audit when SQL fence expires after insert without advancing plan', async () => {
    tx.$queryRaw
      .mockResolvedValueOnce([row()])
      .mockResolvedValueOnce([result()])
      .mockResolvedValueOnce([result()])
      .mockResolvedValueOnce([]);
    const output = await scoped(() =>
      repository.appendToolResult(
        ID,
        { version: 3, lease_generation: 2 },
        {
          tool_call_id: 'call-a',
          tool_name: 'read_product',
          args_hash: 'a'.repeat(64),
          receipt,
          data: { id: 55 },
          checkpoint: { next_step: 'must not advance' },
        },
      ),
    );
    expect(output.advanced).toBe(false);
    expect(output.result.stale_lease).toBe(true);
    expect(statement(tx.$executeRaw.mock.calls[0])).toContain(
      'UPDATE ai_agent_tool_results SET stale_lease=true',
    );
  });
  it('does not transition unknown back to applying or manufacture exactly-once', async () => {
    await expect(
      scoped(() =>
        repository.transitionEffect(ID, 'operation-a', 'unknown', 'applying'),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });
  it('retains receipt when status transition has no replacement receipt', async () => {
    tx.$queryRaw
      .mockResolvedValueOnce([row()])
      .mockResolvedValueOnce([{ id: 'effect-a', status: 'approved' }]);
    await scoped(() =>
      repository.transitionEffect(ID, 'operation-a', 'proposed', 'approved'),
    );
    expect(statement(tx.$queryRaw.mock.calls[1])).toContain(
      'domain_receipt=domain_receipt',
    );
  });
});

describe('durable artifact privacy and budget accumulation', () => {
  it('accumulates all units across continuations, never negative/refund resets', () => {
    const initial = { ...emptyObjectiveBudget(), tools: 7, cost_usd: 0.25 };
    const next = addObjectiveBudget(initial, {
      tools: 2,
      provider_attempts: 1,
      prompt_tokens: 10,
      cost_usd: 0.1,
      expansions: 1,
      recovery: 1,
    });
    expect(next).toMatchObject({
      tools: 9,
      provider_attempts: 1,
      prompt_tokens: 10,
      cost_usd: 0.35,
      expansions: 1,
      recovery: 1,
    });
    expect(() => addObjectiveBudget(next, { tools: -1 })).toThrow(
      BadRequestException,
    );
    expect(
      addObjectiveBudget(addObjectiveBudget(next, { cost_usd: null }), {
        cost_usd: 1,
      }).cost_usd,
    ).toBeNull();
  });
  it('redacts nested credentials/reasoning/signed URLs without truncating business facts', () => {
    expect(
      safeObjectiveArtifact({
        quantity: 3,
        date: '2026-10-18',
        children: [
          {
            authorization: 'Bearer secret',
            reasoning: 'private',
            s3_key: 'tenant/a.pdf',
            url: 'https://s3/a?X-Amz-Credential=secret',
          },
        ],
      }),
    ).toEqual({
      quantity: 3,
      date: '2026-10-18',
      children: [
        {
          s3_key: 'tenant/a.pdf',
          url: '[signed-url-redacted-use-storage-key]',
        },
      ],
    });
  });
  it('rejects cyclic data and excessive depth instead of storing misleading string truncations', () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(() => safeObjectiveArtifact(cyclic)).toThrow(BadRequestException);
  });
});
