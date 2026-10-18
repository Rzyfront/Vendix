import { NotFoundException } from '@nestjs/common';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import {
  RequestContextService,
  type RequestContext,
} from '../../common/context/request-context.service';
import {
  canonicalJson,
  type VexiConfirmationService,
} from '../../domains/store/vexi/vexi-confirmation.service';
import { parsePlaybookMarkdown } from '../playbooks/playbook-validator';
import type { PlaybookLoaderService } from '../playbooks/playbook-loader.service';
import { AIToolRegistry } from '../tools/ai-tool-registry';
import { toolReceipt } from '../tools/tool-result.normalizer';
import type { ToolExecutionResult } from '../tools/interfaces/tool.interface';
import {
  AgentDurableSession,
  objectiveArgsHash,
} from './agent-durable-session.service';
import type { AgentObjectiveRepository } from './agent-objective.repository';
import { AgentDeadline, agentDeadlineContext } from './agent-deadline';
import {
  AgentVerifierService,
  type AgentVerificationRequest,
} from './agent-verifier.service';
import {
  agentVerificationContractsHash,
  consumeAgentVerification,
  issueAgentVerification,
  type AgentVerificationBinding,
} from './agent-verification-capability';
import {
  emptyObjectiveBudget,
  type AgentEffect,
  type AgentObjective,
  type AgentToolResult,
  type AppendToolResultInput,
  type ObjectiveLease,
} from './interfaces/agent-objective.interface';

type Data = Record<string, unknown>;
const scope = { store_id: 10, organization_id: 20, user_id: 30 };
const context: RequestContext = {
  ...scope,
  permissions: ['read', 'write'],
  roles: ['owner'],
  is_owner: true,
  is_super_admin: false,
};
const ID = '00000000-0000-4000-8000-000000000001';
const directory = join(__dirname, '../playbooks/content');
const documents = readdirSync(directory)
  .filter((f) => f.endsWith('.md'))
  .sort()
  .map((f) =>
    parsePlaybookMarkdown(readFileSync(join(directory, f), 'utf8'), f),
  );
const hash = (tool: string, args: Data) =>
  createHash('sha256')
    .update(`${tool}|${canonicalJson(args)}`)
    .digest('hex');
const run = <T>(
  callback: () => T,
  ctx: RequestContext = structuredClone(context),
): T => RequestContextService.runIsolated(ctx, callback);

function receipt(
  data: unknown,
  ids: Record<string, string | number> = {},
  write = false,
): ToolExecutionResult {
  return {
    schema_version: '1',
    status: 'ok',
    error_code: null,
    retryable: false,
    next_action: null,
    evidence_refs: [],
    resource_ids: ids,
    pagination: null,
    freshness: 'observed',
    effect_status: write ? 'applied' : 'not_applicable',
    data,
  };
}

/** Real registry, real durable session, real release contracts and pure domain predicates.
 * Only domain handlers and repository transport are fixtures; no DB/provider/DIAN claim. */
function harness(workflow = 'reponer-inventario') {
  const document = structuredClone(documents.find((d) => d.id === workflow)!);
  const happy = document.contract.examples.find((e) => e.kind === 'happy')!;
  const inputs: Data = { ...happy.input };
  const rows: AgentToolResult[] = [];
  const effects: AgentEffect[] = [];
  let state: AgentObjective = {
    ...scope,
    id: ID,
    conversation_id: 7,
    agent_id: 'vexi',
    legacy_plan_id: 'test',
    goal: workflow,
    plan: null,
    entities: [],
    step_hashes: null,
    next_step: null,
    semantic_status: 'active',
    version: 1,
    lease_generation: 2,
    lease_until: new Date(Date.now() + 60_000),
    budget: emptyObjectiveBudget(),
    authority_snapshot: ['read', 'write'],
    requires_revalidation: false,
    expires_at: new Date(Date.now() + 3_600_000),
    created_at: new Date(),
    updated_at: new Date(),
  };
  const allowed = jest.fn(async () => true);
  const reads = new Map<string, unknown>();
  const dispatched: string[] = [];
  const confirmations = {
    prepare: jest.fn(),
    consume: jest.fn(),
  } as unknown as VexiConfirmationService;
  const registry = new AIToolRegistry(confirmations);
  for (const contract of document.metadata.tool_contracts) {
    const isWrite = document.contract.steps.some(
      (s) => s.tool === contract.name && s.approval === 'individual',
    );
    const observation =
      happy.observations.find(
        (o) => o.tool === contract.name && o.step_id === 'verify',
      ) ?? happy.observations.find((o) => o.tool === contract.name);
    if (observation)
      reads.set(contract.name, structuredClone(observation.data));
    registry.register({
      name: contract.name,
      version: contract.version,
      domain: 'fixture',
      description: contract.name,
      parameters: { type: 'object', properties: {} },
      requiredPermissions: [isWrite ? 'write' : 'read'],
      ...(isWrite ? { requiresConfirmation: true } : { readOnly: true }),
      handler: async () => {
        dispatched.push(contract.name);
        if (isWrite) throw new Error('VERIFIER_MUST_NEVER_EXECUTE_WRITE');
        return JSON.stringify(reads.get(contract.name) ?? {});
      },
    });
  }
  if (workflow === 'reponer-inventario') {
    delete inputs.supplier_query;
    reads.set('get_sourcing_suggestion', {
      cantidad_solicitada: inputs.quantity,
      sugerencia: 'available',
      bodega_principal: { id: 71, quantity_available: 20 },
      otras_bodegas: [],
    });
  }
  const repo = {
    get: jest.fn(async () => structuredClone(state)),
    getResult: jest.fn(async (_id: string, resultId: string) => {
      const found = rows.find((r) => r.id === resultId);
      if (!found) throw new NotFoundException('Objective not found');
      return structuredClone(found);
    }),
    listEffects: jest.fn(async () => structuredClone(effects)),
    listResults: jest.fn(async () => ({
      items: structuredClone(rows),
      has_more: false,
      next_cursor: null,
    })),
    addBudget: jest.fn(
      async (_id: string, lease: ObjectiveLease, delta: Data) => {
        if (lease.version !== state.version) return null;
        state = {
          ...state,
          version: state.version + 1,
          budget: {
            ...state.budget,
            active_runtime_ms:
              state.budget.active_runtime_ms +
              Number(delta.active_runtime_ms ?? 0),
          },
        };
        return structuredClone(state);
      },
    ),
    appendToolResult: jest.fn(
      async (
        _id: string,
        lease: ObjectiveLease,
        input: AppendToolResultInput,
      ) => {
        const advanced =
          state.version === lease.version &&
          state.lease_generation === lease.lease_generation;
        const row: AgentToolResult = {
          ...scope,
          id: randomUUID(),
          objective_id: ID,
          task_id: null,
          tool_call_id: input.tool_call_id,
          tool_name: input.tool_name,
          tool_version: input.tool_version ?? '1',
          args_hash: input.args_hash,
          receipt: input.receipt,
          data: input.data,
          pagination: input.receipt.pagination,
          freshness: input.receipt.freshness,
          resource_ids: input.receipt.resource_ids,
          evidence_refs: input.receipt.evidence_refs,
          lease_generation: lease.lease_generation,
          stale_lease: !advanced,
          created_at: new Date(),
        };
        rows.push(row);
        if (advanced)
          state = { ...state, version: state.version + 1, ...input.checkpoint };
        return { result: row, objective: structuredClone(state), advanced };
      },
    ),
  };
  const loader = { getPlaybooks: jest.fn(() => [document]) };
  const session = new AgentDurableSession(
    structuredClone(state),
    '',
    repo as unknown as AgentObjectiveRepository,
  );
  const recipeMemory = { verifierFailed: jest.fn() };
  const service = new AgentVerifierService(
    registry,
    repo as unknown as AgentObjectiveRepository,
    loader as unknown as PlaybookLoaderService,
    recipeMemory as never,
  );
  function addEffect(
    stepId: string,
    tool: string,
    args: Data,
    ids: Record<string, string | number>,
    order = effects.length,
  ): AgentToolResult {
    const time = Date.now() - 20_000 + order * 200;
    const operation = `op-${stepId}`;
    const body = receipt({ synthetic_receipt: true }, ids, true);
    effects.push({
      ...scope,
      id: randomUUID(),
      objective_id: ID,
      operation_id: operation,
      proposal_hash: hash(tool, args),
      step_id: `plan:1:${order}`,
      status: 'applied',
      domain_receipt: { resource_ids: ids },
      domain_reference: String(Object.values(ids)[0]),
      evidence_result_id: null,
      created_at: new Date(time),
      updated_at: new Date(time + 10),
    });
    const row: AgentToolResult = {
      ...scope,
      id: randomUUID(),
      objective_id: ID,
      task_id: null,
      tool_call_id: `effect:${operation}`,
      tool_name: tool,
      tool_version: '1',
      args_hash: hash(tool, args),
      receipt: toolReceipt(body),
      data: body.data,
      pagination: null,
      freshness: 'observed',
      resource_ids: ids,
      evidence_refs: [],
      lease_generation: 1,
      stale_lease: false,
      created_at: new Date(time + 20),
    };
    rows.push(row);
    return row;
  }
  const request = (): AgentVerificationRequest => ({
    workflow_key: workflow,
    step_id: 'deliverable-1',
    inputs: structuredClone(inputs),
  });
  const binding = (step = 'deliverable-1'): AgentVerificationBinding => ({
    ...scope,
    objective_id: ID,
    step_id: step,
    version: session.lease.version,
    lease_generation: session.lease.lease_generation,
  });
  return {
    service,
    registry,
    repo,
    session,
    document,
    rows,
    effects,
    reads,
    inputs,
    allowed,
    dispatched,
    recipeMemory,
    loader,
    addEffect,
    request,
    binding,
    changeState: (patch: Partial<AgentObjective>) => {
      state = { ...state, ...patch };
    },
  };
}

function cash() {
  const h = harness('cerrar-caja');
  h.addEffect(
    'close',
    'close_cash_session',
    {
      session_id: h.inputs.session_id,
      actual_closing_amount: h.inputs.actual_closing_amount,
    },
    { session_id: Number(h.inputs.session_id) },
  );
  return h;
}

function invoice() {
  const h = harness('facturar-venta');
  const ids = { invoice_id: Number(h.inputs.invoice_id) };
  h.addEffect(
    'create',
    'create_invoice_from_order',
    { order_id: h.inputs.order_id },
    { ...ids, order_id: Number(h.inputs.order_id) },
    0,
  );
  h.addEffect('validate', 'validate_invoice', ids, ids, 1);
  const r = receipt({ ...ids, emittable: true });
  h.rows.push({
    ...scope,
    objective_id: ID,
    id: randomUUID(),
    task_id: null,
    tool_call_id: 'preflight-read',
    tool_name: 'get_emit_readiness',
    tool_version: '1',
    args_hash: objectiveArgsHash(ids),
    receipt: toolReceipt(r),
    data: r.data,
    resource_ids: {},
    pagination: null,
    freshness: 'observed',
    evidence_refs: [],
    lease_generation: 1,
    stale_lease: false,
    created_at: new Date(Date.now() - 19_700),
  });
  h.addEffect('emit', 'send_invoice_dian', ids, ids, 2);
  return h;
}

describe('AgentVerifierService server-only D2 evidence', () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.AI_AGENT_ROBUST_EXECUTION_ENABLED = 'true';
    process.env.AI_DURABLE_OBJECTIVES_ENABLED = 'true';
    process.env.AI_AGENT_PLAYBOOKS_ENABLED = 'true';
  });
  afterEach(() => {
    process.env = { ...env };
  });

  it('fresh registry reads, not a model verified:true, issue one scoped proof at the final CAS version', async () => {
    const h = harness();
    const result = await run(() =>
      h.service.verify(
        h.session,
        { ...h.request(), verified: true } as AgentVerificationRequest,
        { assertToolAllowed: h.allowed },
      ),
    );
    expect(result.verified).toBe(true);
    expect(h.dispatched).toEqual([
      'get_stock_levels',
      'get_sourcing_suggestion',
    ]);
    expect(h.repo.appendToolResult).toHaveBeenCalledTimes(2);
    if (!result.verified) throw new Error(result.reasons.join(','));
    expect(consumeAgentVerification(result.capability, h.binding())).toEqual(
      expect.objectContaining({
        objective_id: ID,
        workflows: ['reponer-inventario'],
        evidence_refs: result.evidence_refs,
      }),
    );
    expect(consumeAgentVerification(result.capability, h.binding())).toBeNull();
    expect(
      consumeAgentVerification(
        JSON.parse(JSON.stringify(result.capability)),
        h.binding(),
      ),
    ).toBeNull();
  });

  it.each([
    'AI_AGENT_ROBUST_EXECUTION_ENABLED',
    'AI_DURABLE_OBJECTIVES_ENABLED',
  ])('default OFF kill switch %s dispatches nothing', async (flag) => {
    delete process.env[flag];
    const h = harness();
    expect(
      await run(() =>
        h.service.verify(h.session, h.request(), {
          assertToolAllowed: h.allowed,
        }),
      ),
    ).toEqual({
      verified: false,
      reasons: ['robust_verification_disabled'],
      evidence_refs: [],
    });
    expect(h.dispatched).toEqual([]);
  });

  it('unknown workflows/model-supplied observations cannot choose a verifier or close an objective', async () => {
    const h = harness();
    const response = await run(() =>
      h.service.verify(
        h.session,
        {
          ...h.request(),
          workflow_key: 'inventado',
          observations: h.document.contract.examples[0].observations,
          verified: true,
        } as AgentVerificationRequest,
        { assertToolAllowed: h.allowed },
      ),
    );
    expect(response.verified).toBe(false);
    expect(h.dispatched).toHaveLength(0);
    expect(h.recipeMemory.verifierFailed).not.toHaveBeenCalled();
  });

  it('requires explicit owner ALS; a static fallback never supplies verifier authority', async () => {
    const h = harness();
    RequestContextService.run(structuredClone(context), () => undefined);
    expect(
      (
        await h.service.verify(h.session, h.request(), {
          assertToolAllowed: h.allowed,
        })
      ).verified,
    ).toBe(false);
    expect(h.dispatched).toHaveLength(0);
  });

  it.each(['user_id', 'store_id', 'organization_id'] as const)(
    'foreign objective %s gets identical404 before reads',
    async (key) => {
      const h = harness();
      await expect(
        run(
          () =>
            h.service.verify(h.session, h.request(), {
              assertToolAllowed: h.allowed,
            }),
          { ...context, [key]: 999 },
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(h.dispatched).toEqual([]);
    },
  );

  it('current guard denial and snapshot∩current permissions both fail closed', async () => {
    const h = harness();
    h.allowed.mockResolvedValue(false);
    expect(
      (
        await run(() =>
          h.service.verify(h.session, h.request(), {
            assertToolAllowed: h.allowed,
          }),
        )
      ).verified,
    ).toBe(false);
    h.allowed.mockResolvedValue(true);
    expect(
      (
        await run(
          () =>
            h.service.verify(h.session, h.request(), {
              assertToolAllowed: h.allowed,
            }),
          { ...context, permissions: [] },
        )
      ).verified,
    ).toBe(false);
    h.changeState({ authority_snapshot: [] });
    expect(
      (
        await run(() =>
          h.service.verify(h.session, h.request(), {
            assertToolAllowed: h.allowed,
          }),
        )
      ).verified,
    ).toBe(false);
    expect(h.dispatched).toEqual([]);
  });

  it.each([
    { artifact: true, data: { available: 1 } },
    { data: { artifact: true } },
    { truncated: true, data: 'recortado' },
    { success: false, error: 'no' },
    { status: 'pending_confirmation' },
    { result_unknown: true },
    { hay_mas: true },
    { pagination: { complete: false, has_more: true, next_cursor: 'next' } },
    { next_cursor: 'last-page' },
    { reusable_for_write: false },
    { items_omitidos: 5 },
    { offset: 20 },
    { page: 2 },
    { data: { meta: { total: 50, limit: 10 } } },
  ])(
    'fresh dispatch alone does not prove complete/final domain state: %j',
    async (data) => {
      const h = harness();
      h.reads.set('get_sourcing_suggestion', data);
      const result = await run(() =>
        h.service.verify(h.session, h.request(), {
          assertToolAllowed: h.allowed,
        }),
      );
      expect(result.verified).toBe(false);
      expect('capability' in result).toBe(false);
      expect(h.repo.appendToolResult).toHaveBeenCalled(); // failures remain audit evidence
    },
  );

  it('UI/write/version-drift metadata never becomes a verifier read', async () => {
    for (const change of [
      { readOnly: false },
      { clientSide: true },
      { requiresConfirmation: true },
      { version: '999' },
    ]) {
      const h = harness();
      h.registry.register({
        ...h.registry.get('get_stock_levels')!,
        ...change,
      });
      expect(
        (
          await run(() =>
            h.service.verify(h.session, h.request(), {
              assertToolAllowed: h.allowed,
            }),
          )
        ).verified,
      ).toBe(false);
      expect(h.dispatched).toEqual([]);
    }
  });

  it('supplier not found remains a specific unverified choice, not an invented supplier/write', async () => {
    const h = harness();
    h.inputs.supplier_query = 'Proveedor existente';
    h.reads.set('get_sourcing_suggestion', {
      cantidad_solicitada: h.inputs.quantity,
      sugerencia: 'purchase',
    });
    h.reads.set('find_supplier', { candidatos: [], hay_mas: false });
    expect(
      await run(() =>
        h.service.verify(h.session, h.request(), {
          assertToolAllowed: h.allowed,
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        verified: false,
        reasons: ['supplier_choice_required'],
      }),
    );
    expect(h.dispatched).not.toContain('create_supplier');
  });

  it.each([
    {
      sugerencia: 'available',
      bodega_principal: { id: 71, quantity_available: 1 },
      otras_bodegas: [],
    },
    {
      sugerencia: 'transfer',
      bodega_principal: { id: 71, quantity_available: 1 },
      otras_bodegas: [{ id: 72, quantity_available: 1 }],
    },
    {
      sugerencia: 'available',
      bodega_principal: { id: 71, available: 20 },
      otras_bodegas: [],
    },
    {
      sugerencia: 'available',
      bodega_principal: { id: 71, quantity_available: 20 },
      otras_bodegas: [{ id: 71, quantity_available: 1 }],
    },
  ])(
    'sourcing uses actual location quantities, not an optimistic label: %j',
    async (final) => {
      const h = harness();
      h.reads.set('get_sourcing_suggestion', {
        cantidad_solicitada: h.inputs.quantity,
        ...final,
      });
      expect(
        (
          await run(() =>
            h.service.verify(h.session, h.request(), {
              assertToolAllowed: h.allowed,
            }),
          )
        ).verified,
      ).toBe(false);
    },
  );

  it('internal reads use the caller quota/event observer after persistence, including failed reads', async () => {
    const h = harness();
    h.reads.set('get_sourcing_suggestion', {
      success: false,
      error: 'unavailable',
    });
    const seen: string[] = [];
    const onRead = jest.fn(async (_result, meta) => {
      expect(h.rows.some((r) => r.id === meta.artifact_id)).toBe(true);
      expect(meta.call_id).toMatch(/^verify:/);
      seen.push(meta.tool_name);
    });
    const result = await run(() =>
      h.service.verify(h.session, h.request(), {
        assertToolAllowed: h.allowed,
        onRead,
      }),
    );
    expect(result.verified).toBe(false);
    expect(seen).toEqual(['get_stock_levels', 'get_sourcing_suggestion']);
    expect(onRead.mock.calls[1][0].status).not.toBe('ok');
  });

  it('verifier cannot issue a proof when its caller quota/event observer fails', async () => {
    const h = harness();
    const onRead = jest.fn(async () => {
      throw new Error('quota unavailable');
    });
    expect(
      (
        await run(() =>
          h.service.verify(h.session, h.request(), {
            assertToolAllowed: h.allowed,
            onRead,
          }),
        )
      ).verified,
    ).toBe(false);
    expect(h.repo.appendToolResult).toHaveBeenCalledTimes(1);
  });

  it('cash closure binds applied ledger, arguments, real session detail and reproducible difference', async () => {
    const h = cash();
    const result = await run(() =>
      h.service.verify(h.session, h.request(), {
        assertToolAllowed: h.allowed,
      }),
    );
    expect(result.verified).toBe(true);
    expect(h.dispatched).toEqual(['call_endpoint']);
    expect(h.allowed).toHaveBeenLastCalledWith('call_endpoint', {
      path: `store/cash-registers/sessions/${h.inputs.session_id}`,
    });
  });

  it.each([
    'pending',
    'unknown',
    'stale',
    'artifact',
    'different_args',
    'different_operation',
    'duplicate_operation',
    'wrong_session',
    'wrong_difference',
    'wrong_owner',
    'omitted_data',
  ])('rejects cash evidence %s without replaying its close', async (kind) => {
    const h = cash();
    if (kind === 'pending') h.effects[0].status = 'proposed';
    if (kind === 'unknown') h.effects[0].status = 'unknown';
    if (kind === 'stale') h.rows[0].stale_lease = true;
    if (kind === 'artifact') h.rows[0].data = { artifact: true };
    if (kind === 'different_args') h.inputs.actual_closing_amount = 77;
    if (kind === 'different_operation') h.rows[0].tool_call_id = 'other';
    if (kind === 'duplicate_operation')
      h.effects.push({
        ...h.effects[0],
        id: randomUUID(),
        operation_id: 'duplicate',
      });
    if (kind === 'wrong_session')
      h.reads.set('call_endpoint', {
        ...(h.reads.get('call_endpoint') as Data),
        id: 999,
      });
    if (kind === 'wrong_difference')
      h.reads.set('call_endpoint', {
        ...(h.reads.get('call_endpoint') as Data),
        difference: 99,
      });
    if (kind === 'wrong_owner') h.rows[0].user_id = 999;
    if (kind === 'omitted_data') {
      h.rows[0].data_omitted = true;
      h.repo.getResult.mockImplementationOnce(async () => {
        throw new Error('artifact unavailable');
      });
    }
    if (kind === 'wrong_owner')
      await expect(
        run(() =>
          h.service.verify(h.session, h.request(), {
            assertToolAllowed: h.allowed,
          }),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    else
      expect(
        (
          await run(() =>
            h.service.verify(h.session, h.request(), {
              assertToolAllowed: h.allowed,
            }),
          )
        ).verified,
      ).toBe(false);
    expect(h.dispatched).not.toContain('close_cash_session');
  });

  it('accepts only stored refs; text, forged refs and foreign IDs never become evidence', async () => {
    for (const reference of [
      'ya quedó',
      '55',
      'agent-result:inventado',
      `agent-result:${randomUUID()}`,
    ]) {
      const h = cash();
      const call = run(() =>
        h.service.verify(
          h.session,
          { ...h.request(), evidence_refs: { close: reference } },
          { assertToolAllowed: h.allowed },
        ),
      );
      if (reference.startsWith('agent-result:') && reference.length === 49)
        await expect(call).rejects.toBeInstanceOf(NotFoundException);
      else expect((await call).verified).toBe(false);
    }
  });

  it('a stale executor cannot turn a late read into objective evidence', async () => {
    const h = harness();
    const original = h.registry.get('get_sourcing_suggestion')!;
    h.registry.register({
      ...original,
      handler: async () => {
        h.changeState({ lease_generation: 88 });
        return JSON.stringify(h.reads.get('get_sourcing_suggestion'));
      },
    });
    const result = await run(() =>
      h.service.verify(h.session, h.request(), {
        assertToolAllowed: h.allowed,
      }),
    );
    expect(result.verified).toBe(false);
    expect(h.rows[h.rows.length - 1].stale_lease).toBe(true);
  });

  it.each([false, true])(
    'cancelled non-cooperative read never checkpoints even if the lease %s changes',
    async (changeLease) => {
      const h = harness();
      const deadline = new AgentDeadline({
        wallDeadlineMs: Date.now() + 60_000,
        activeBudgetMs: 60_000,
        reserveMs: 0,
      });
      let enter!: () => void;
      let resolveRead!: (value: string) => void;
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      const pending = new Promise<string>((resolve) => {
        resolveRead = resolve;
      });
      h.registry.register({
        ...h.registry.get('get_stock_levels')!,
        handler: async () => {
          enter();
          return pending;
        },
      });
      const onRead = jest.fn(async () => undefined);
      const audit = jest.spyOn(h.session, 'auditTool');
      const checkpoint = jest.spyOn(h.session, 'checkpointTool');
      try {
        const verification = run(() =>
          agentDeadlineContext.run(deadline, () =>
            h.service.verify(h.session, h.request(), {
              assertToolAllowed: h.allowed,
              onRead,
            }),
          ),
        );
        await entered;
        const version = h.session.lease.version;
        if (changeLease)
          h.changeState({
            lease_generation: h.session.lease.lease_generation + 1,
          });
        deadline.cancel();
        const result = await verification; // cancellation returns BEFORE the handler settles
        expect(result.verified).toBe(false);
        expect('capability' in result).toBe(false);
        expect(checkpoint).not.toHaveBeenCalled();
        expect(h.repo.appendToolResult).not.toHaveBeenCalled();
        resolveRead(JSON.stringify(h.reads.get('get_stock_levels')));
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(checkpoint).not.toHaveBeenCalled();
        expect(onRead).not.toHaveBeenCalled();
        expect(audit).toHaveBeenCalledTimes(1);
        expect(audit.mock.calls[0][0]).toMatch(/^late:verify:/);
        expect(audit.mock.calls[0][5]).toBe(true); // the actual dispatch was not counted earlier
        expect(h.repo.appendToolResult).toHaveBeenCalledTimes(1);
        const [objectiveId, lease, input] =
          h.repo.appendToolResult.mock.calls[0];
        expect(objectiveId).toBe(ID);
        expect(lease.version).toBe(-1);
        expect(input.checkpoint).toBeUndefined();
        expect(input.receipt).toEqual(
          expect.objectContaining({
            freshness: 'unknown',
            effect_status: 'not_applicable',
            evidence_refs: [],
          }),
        );
        expect(h.rows[0].stale_lease).toBe(true);
        expect(h.session.lease.version).toBe(version);
      } finally {
        deadline.dispose();
      }
    },
  );

  it('a DIAN sent/pending response is never accepted; accepted requires post-emission order link', async () => {
    const h = invoice();
    expect(
      (
        await run(() =>
          h.service.verify(h.session, h.request(), {
            assertToolAllowed: h.allowed,
          }),
        )
      ).verified,
    ).toBe(true);
    h.reads.set('get_invoice_status', {
      ...(h.reads.get('get_invoice_status') as Data),
      status: 'sent',
      transmission_status: 'pending',
    });
    expect(
      (
        await run(() =>
          h.service.verify(h.session, h.request(), {
            assertToolAllowed: h.allowed,
          }),
        )
      ).verified,
    ).toBe(false);
    expect(h.dispatched).not.toContain('send_invoice_dian');
  });

  it('old preflight, wrong invoice identity or another order cannot prove DIAN acceptance', async () => {
    for (const kind of [
      'old',
      'wrong_invoice',
      'wrong_order',
      'before_validate',
    ]) {
      const h = invoice();
      const preflight = h.rows.find(
        (r) => r.tool_name === 'get_emit_readiness',
      )!;
      if (kind === 'old') preflight.created_at = new Date(Date.now() - 600_000);
      if (kind === 'before_validate')
        preflight.created_at = new Date(h.effects[0].created_at);
      if (kind === 'wrong_invoice') h.inputs.invoice_id = 999;
      if (kind === 'wrong_order')
        h.reads.set('get_order', {
          orden: { order_id: 999 },
          factura_electronica: { numero: 'x', cufe: 'x' },
        });
      expect(
        (
          await run(() =>
            h.service.verify(h.session, h.request(), {
              assertToolAllowed: h.allowed,
            }),
          )
        ).verified,
      ).toBe(false);
    }
  });

  it('a partially received purchase cannot masquerade as fully received', async () => {
    const h = harness('recibir-compra');
    h.addEffect(
      'receive',
      'approve_receive_purchase_order',
      {
        action: 'receive',
        purchase_order_id: h.inputs.purchase_order_id,
        items: h.inputs.items,
      },
      { purchase_order_id: Number(h.inputs.purchase_order_id) },
    );
    expect(
      await run(() =>
        h.service.verify(h.session, h.request(), {
          assertToolAllowed: h.allowed,
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        verified: false,
        reasons: ['purchase_partially_received'],
      }),
    );
    h.inputs.expected_status = 'partial';
    expect(
      await run(() =>
        h.service.verify(h.session, h.request(), {
          assertToolAllowed: h.allowed,
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        verified: false,
        reasons: ['unsupported_capability:inventory_movement_identity'],
      }),
    );
    const po = (h.reads.get('get_purchase_order') as Data).orden as Data;
    po.status = 'received';
    po.lineas = [{ ordered: 3, received: 3, pending: 0 }];
    h.inputs.expected_status = 'received';
    expect(
      await run(() =>
        h.service.verify(h.session, h.request(), {
          assertToolAllowed: h.allowed,
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        verified: false,
        reasons: ['unsupported_capability:inventory_movement_identity'],
      }),
    );
  });

  it.each(['pagar-proveedor', 'cobrar-cartera'])(
    'payment operation ID is caused by this objective, not selected from any prior payment: %s',
    async (workflow) => {
      const h = harness(workflow);
      const kind =
        workflow === 'pagar-proveedor' ? 'payable_id' : 'receivable_id';
      const tool =
        workflow === 'pagar-proveedor' ? 'pay_payable' : 'collect_receivable';
      h.addEffect(
        workflow === 'pagar-proveedor' ? 'pay' : 'collect',
        tool,
        {
          [kind]: h.inputs[kind],
          amount: h.inputs.amount,
          payment_method: h.inputs.payment_method,
        },
        {
          [kind]: Number(h.inputs[kind]),
          payment_id: Number(h.inputs.payment_id),
        },
      );
      expect(
        (
          await run(() =>
            h.service.verify(h.session, h.request(), {
              assertToolAllowed: h.allowed,
            }),
          )
        ).verified,
      ).toBe(true);
      h.inputs.payment_id = 999;
      expect(
        (
          await run(() =>
            h.service.verify(h.session, h.request(), {
              assertToolAllowed: h.allowed,
            }),
          )
        ).verified,
      ).toBe(false);
    },
  );

  it('a document substring match is not the customer document identity', async () => {
    const h = harness('crear-cliente');
    h.inputs.document_type = 'CC';
    h.inputs.last_name = 'Sintética';
    h.addEffect(
      'upsert',
      'upsert_customer',
      {
        first_name: h.inputs.first_name,
        document_number: h.inputs.documento,
        last_name: h.inputs.last_name,
        document_type: h.inputs.document_type,
      },
      { customer_id: 900070 },
    );
    h.reads.set('lookup_customer', {
      match_count: 1,
      ambiguous: false,
      customers: [{ customer_id: 900070, document: 'CC SIMULADO-sufijo' }],
    });
    expect(
      await run(() =>
        h.service.verify(h.session, h.request(), {
          assertToolAllowed: h.allowed,
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        verified: false,
        reasons: ['customer_document_identity_mismatch'],
      }),
    );
    expect(h.recipeMemory.verifierFailed).toHaveBeenCalledWith(ID, [
      'crear-cliente',
    ]);
  });

  it('purchase lines are reread with exact product/variant quantities, not any nonempty array', async () => {
    const h = harness('compra-proveedor');
    h.inputs.supplier_query = 'Proveedor sintético';
    h.inputs.product_query = 'Producto sintético';
    h.inputs.items = [
      {
        product_id: 900001,
        product_variant_id: 900002,
        quantity: 5,
        unit_price: 20,
      },
    ];
    h.addEffect(
      'draft',
      'manage_purchase_orders',
      {
        action: 'create',
        supplier_id: h.inputs.supplier_id,
        items: h.inputs.items,
        location_id: h.inputs.location_id,
      },
      { purchase_order_id: 900042 },
    );
    const order = (h.reads.get('get_purchase_order') as Data).orden as Data;
    order.lineas = [
      {
        product_id: 900001,
        variant_id: 900002,
        ordered: 5,
        received: 0,
        pending: 5,
      },
    ];
    expect(
      (
        await run(() =>
          h.service.verify(h.session, h.request(), {
            assertToolAllowed: h.allowed,
          }),
        )
      ).verified,
    ).toBe(true);
    order.lineas = [
      {
        product_id: 900001,
        variant_id: 900003,
        ordered: 5,
        received: 0,
        pending: 5,
      },
    ];
    expect(
      await run(() =>
        h.service.verify(h.session, h.request(), {
          assertToolAllowed: h.allowed,
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        verified: false,
        reasons: ['purchase_order_lines_mismatch'],
      }),
    );
    order.lineas = [{ ordered: 5, received: 0, pending: 5 }];
    expect(
      await run(() =>
        h.service.verify(h.session, h.request(), {
          assertToolAllowed: h.allowed,
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        verified: false,
        reasons: ['unsupported_capability:order_lines_identity'],
      }),
    );
  });

  it.each([
    ['devolucion-reembolso', 'refund_operation_identity'],
    ['venta-cobro', 'sale_payment_stock_identity'],
  ])(
    'processed return or zero balance do not fulfill missing causal integral workflow: %s',
    async (workflow, gap) => {
      const h = harness(workflow);
      if (workflow === 'venta-cobro')
        Object.assign(h.inputs, {
          product_id: 900001,
          quantity: 1,
          order_id: 900081,
          store_payment_method_id: 900082,
        });
      expect(
        await run(() =>
          h.service.verify(h.session, h.request(), {
            assertToolAllowed: h.allowed,
          }),
        ),
      ).toEqual(
        expect.objectContaining({
          verified: false,
          reasons: [`unsupported_capability:${gap}`],
        }),
      );
      expect(h.dispatched).toEqual([]);
    },
  );

  it('preparation-only product/restaurant gaps never issue domain-completion authority', async () => {
    for (const workflow of ['crear-producto-inventario', 'mesa-cocina-cobro']) {
      const h = harness(workflow);
      expect(
        (
          await run(() =>
            h.service.verify(h.session, h.request(), {
              assertToolAllowed: h.allowed,
            }),
          )
        ).verified,
      ).toBe(false);
      expect(h.dispatched).toEqual([]);
    }
  });

  it('verifyMany issues one objective-scoped proof AFTER every deliverable read checkpoint', async () => {
    const h = harness();
    const version = h.session.lease.version;
    const result = await run(() =>
      h.service.verifyMany(
        h.session,
        [h.request(), { ...h.request(), step_id: 'deliverable-2' }],
        { assertToolAllowed: h.allowed },
      ),
    );
    expect(result.verified).toBe(true);
    expect(h.dispatched).toHaveLength(4);
    expect(h.session.lease.version).toBeGreaterThan(version + 3);
    if (!result.verified) throw new Error(result.reasons.join(','));
    expect(
      consumeAgentVerification(result.capability, h.binding('objective'))
        ?.evidence_refs,
    ).toHaveLength(4);
  });

  it('one unsatisfied deliverable keeps the entire objective partial', async () => {
    const h = harness();
    const result = await run(() =>
      h.service.verifyMany(
        h.session,
        [
          h.request(),
          {
            ...h.request(),
            workflow_key: 'not-supported',
            step_id: 'deliverable-2',
          },
        ],
        { assertToolAllowed: h.allowed },
      ),
    );
    expect(result.verified).toBe(false);
    expect('capability' in result).toBe(false);
  });

  it('coverage reports typed mappings and explicit generic-route/unsupported gaps, without execution', () => {
    const h = cash();
    h.loader.getPlaybooks.mockReturnValue(documents);
    h.registry.register({
      name: 'not_supported',
      description: 'gap',
      domain: 'inventory',
      readOnly: true,
      parameters: {},
    });
    expect(
      h.service.coverage([
        'close_cash_session',
        'call_endpoint',
        'not_supported',
      ]),
    ).toEqual([
      expect.objectContaining({
        tool_name: 'close_cash_session',
        workflow_keys: ['cerrar-caja'],
        verifier_ids: ['cerrar-caja:v1'],
      }),
      expect.objectContaining({
        tool_name: 'call_endpoint',
        gap: {
          code: 'unsupported_capability',
          module: 'fixture',
          action: 'call_endpoint:unmapped_routes',
        },
      }),
      {
        tool_name: 'not_supported',
        workflow_keys: [],
        verifier_ids: [],
        gap: {
          code: 'unsupported_capability',
          module: 'inventory',
          action: 'not_supported',
        },
      },
    ]);
    expect(h.dispatched).toEqual([]);
  });
});

describe('Agent verification opaque capability replay/expiry/scope fence', () => {
  const binding: AgentVerificationBinding = {
    ...scope,
    objective_id: ID,
    step_id: 'objective',
    version: 9,
    lease_generation: 4,
  };
  const issue = () =>
    issueAgentVerification({
      ...binding,
      evidence_refs: ['agent-result:stored'],
      workflows: ['cerrar-caja'],
      verified_at: new Date().toISOString(),
      contracts_hash: agentVerificationContractsHash([
        {
          workflow_key: 'cerrar-caja',
          step_id: 'cash',
          inputs: { session_id: 1 },
        },
      ]),
    });
  it('binds every fixed step and economic input independently of reference selectors/object key order', () => {
    const contracts = [
      {
        workflow_key: 'cerrar-caja',
        step_id: 'a',
        inputs: { session_id: 1, amount: 2 },
      },
      {
        workflow_key: 'reponer-inventario',
        step_id: 'b',
        inputs: { product_id: 3 },
      },
    ];
    expect(agentVerificationContractsHash(contracts)).toBe(
      agentVerificationContractsHash([...contracts].reverse()),
    );
    expect(agentVerificationContractsHash(contracts)).toBe(
      agentVerificationContractsHash([
        { ...contracts[0], inputs: { amount: 2, session_id: 1 } },
        contracts[1],
      ]),
    );
    expect(agentVerificationContractsHash(contracts)).not.toBe(
      agentVerificationContractsHash([
        { ...contracts[0], inputs: { session_id: 999, amount: 2 } },
        contracts[1],
      ]),
    );
    expect(agentVerificationContractsHash(contracts)).not.toBe(
      agentVerificationContractsHash([
        { ...contracts[0], step_id: 'different' },
        contracts[1],
      ]),
    );
  });
  it.each([
    'objective_id',
    'step_id',
    'store_id',
    'organization_id',
    'user_id',
    'version',
    'lease_generation',
  ] as const)('rejects changed %s and consumes even a stale attempt', (key) => {
    const capability = issue();
    expect(
      consumeAgentVerification(capability, {
        ...binding,
        [key]: typeof binding[key] === 'number' ? 999 : 'foreign',
      }),
    ).toBeNull();
    expect(consumeAgentVerification(capability, binding)).toBeNull();
  });
  it('JSON/prototype copies, verified:true and evidence strings cannot forge authority', () => {
    const capability = issue();
    for (const forged of [
      { verified: true },
      { ...capability },
      JSON.parse(JSON.stringify(capability)),
      Object.create(capability),
      'agent-result:stored',
      null,
    ])
      expect(consumeAgentVerification(forged, binding)).toBeNull();
    expect(consumeAgentVerification(capability, binding)).not.toBeNull();
  });
  it('expires independently of model/reference/plan text and returns defensive copies', () => {
    const now = Date.now();
    const spy = jest.spyOn(Date, 'now').mockReturnValue(now);
    const capability = issue();
    spy.mockReturnValue(now + 30_000);
    expect(consumeAgentVerification(capability, binding)).toBeNull();
    spy.mockRestore();
  });
});
