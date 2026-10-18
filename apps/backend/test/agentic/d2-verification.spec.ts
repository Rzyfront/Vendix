import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RequestContextService } from '../../src/common/context/request-context.service';
import { AgentObjectiveRepository } from '../../src/ai-engine/tasks/agent-objective.repository';
import { AgentTaskContextService } from '../../src/ai-engine/tasks/agent-task-context.service';
import { AgentDurableSessionService } from '../../src/ai-engine/tasks/agent-durable-session.service';
import { ObjectiveMemoryDatabase } from '../../src/ai-engine/tasks/testing/objective-memory-db';
import { AgentVerifierService } from '../../src/ai-engine/tasks/agent-verifier.service';
import { VexiPlanStateService } from '../../src/domains/store/vexi/vexi-plan-state.service';
import { AIToolRegistry } from '../../src/ai-engine/tools/ai-tool-registry';
import { createPlanningTools } from '../../src/ai-engine/tools/domains/planning.tools';
import { parsePlaybookMarkdown } from '../../src/ai-engine/playbooks/playbook-validator';
import { AIAgentService } from '../../src/ai-engine/ai-agent.service';
import {
  agentVerificationContractsHash,
  issueAgentVerification,
} from '../../src/ai-engine/tasks/agent-verification-capability';

const document = parsePlaybookMarkdown(
  readFileSync(
    join(__dirname, '../../src/ai-engine/playbooks/content/cerrar-caja.md'),
    'utf8',
  ),
  'cerrar-caja.md',
);
const scope = { store_id: 1, organization_id: 2, user_id: 3 };
const context = {
  ...scope,
  permissions: document.metadata.required_permissions,
  roles: ['owner'],
  is_owner: true,
  is_super_admin: false,
};
const contract = {
  workflow_key: 'cerrar-caja',
  step_id: 'cash-close',
  inputs: { session_id: 900020, actual_closing_amount: 105, currency: 'COP' },
};
const args = { session_id: 900020, actual_closing_amount: 105 };
const planArgs = (count = 3) => ({
  goal: 'Cerrar caja',
  deliverables: [
    {
      description: 'Sesión cerrada y diferencia reproducible',
      verification: contract,
    },
  ],
  steps: Array.from({ length: count }, (_, i) => ({
    title: `Paso ${i + 1}`,
    kind: i === 1 ? 'cambio' : 'verificacion',
    done_when: 'Resultado comprobable',
    depends_on: i ? [i] : [],
    expected_input: 'Sesión indicada',
    expected_output: 'Estado leído',
    candidate_tools: [i === 1 ? 'close_cash_session' : 'call_endpoint'],
    approval: i === 1 ? 'individual' : 'none',
    verifier: 'cerrar-caja:v1',
  })),
});
const partial = {
  content: 'Pendiente de verificación',
  success: true,
  iterations: 1,
  total_tokens: 0,
  tools_used: [],
};
function harness() {
  const db = new ObjectiveMemoryDatabase();
  db.seedConversation(7, scope);
  const repo = new AgentObjectiveRepository(db.prisma);
  const sessions = new AgentDurableSessionService(
    repo,
    new AgentTaskContextService(repo),
  );
  const confirmations = { redeem: jest.fn().mockResolvedValue('ok') };
  const registry = new AIToolRegistry(confirmations as never);
  registry.registerMany(createPlanningTools());
  let cash: Record<string, unknown> = {
    id: 900020,
    status: 'closed',
    actual_closing_amount: 105,
    expected_closing_amount: 100,
    difference: 5,
  };
  const write = jest.fn(async () =>
    JSON.stringify({
      applied: true,
      resource_ids: { session_id: 900020 },
      ...cash,
    }),
  );
  registry.register({
    name: 'close_cash_session',
    version: '1',
    domain: 'cash',
    description: 'close',
    parameters: { type: 'object' },
    requiredPermissions: document.metadata.required_permissions,
    requiresConfirmation: true,
    handler: write,
  });
  const read = jest.fn(async () => JSON.stringify(cash));
  registry.register({
    name: 'call_endpoint',
    version: '1',
    domain: 'api',
    description: 'read',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
    readOnly: true,
    requiredPermissions: document.metadata.required_permissions,
    handler: read,
  });
  registry.register({
    name: 'get_active_cash_session',
    version: '1',
    domain: 'cash',
    description: 'active',
    parameters: { type: 'object' },
    readOnly: true,
    requiredPermissions: document.metadata.required_permissions,
    handler: async () => JSON.stringify({ id: 900020 }),
  });
  const loader = { getPlaybooks: () => [structuredClone(document)] };
  const verifier = new AgentVerifierService(registry, repo, loader as never);
  const plans = new VexiPlanStateService(db.prisma, repo, verifier);
  return {
    db,
    repo,
    sessions,
    registry,
    verifier,
    plans,
    write,
    read,
    setCash: (value: Record<string, unknown>) => {
      cash = value;
    },
  };
}
async function prepared() {
  const w = harness();
  let session = (await w.sessions.open(7, 'vexi', 'Cerrar caja'))!;
  const hook = w.plans.createHook(7, session);
  expect(
    JSON.parse((await hook.execute('propose_plan', planArgs())).result).ok,
  ).toBe(true);
  for (const order of [1, 2, 3])
    expect(
      JSON.parse(
        (
          await hook.execute('update_plan_step', {
            order,
            status: 'done',
            evidence: 'Narrativa no usada para verificar',
          })
        ).result,
      ).ok,
    ).toBe(true);
  await session.close();
  const applied = await w.plans.applyDurableEffect(
    { conversationId: 7, tool: 'close_cash_session', args },
    async () =>
      JSON.stringify(
        await w.registry.executeToolResult('close_cash_session', args, {
          confirmationToken: 'approved-fixture',
        }),
      ),
  );
  expect(applied.result?.effect_status).toBe('applied');
  session = (await w.sessions.open(7, 'vexi', 'Continuar', {
    continuation: true,
  }))!;
  return { ...w, session, hook: w.plans.createHook(7, session) };
}
beforeEach(() => {
  process.env.AI_DURABLE_OBJECTIVES_ENABLED = 'true';
  process.env.AI_AGENT_ROBUST_EXECUTION_ENABLED = 'true';
});
afterEach(() => {
  delete process.env.AI_DURABLE_OBJECTIVES_ENABLED;
  delete process.env.AI_AGENT_ROBUST_EXECUTION_ENABLED;
  jest.restoreAllMocks();
});

it('real repository/session/hook/verifier commits completion only after fresh cash read, then finish preserves it', () =>
  RequestContextService.runIsolated(context, async () => {
    const w = await prepared();
    const result = await w.hook.execute(
      'verify_deliverables',
      { deliverables: [{ id: 'd1', verified: true, evidence: 'inventado' }] },
      { assertToolAllowed: () => true },
    );
    expect(JSON.parse(result.result).completion_verified).toBe(true);
    expect(w.read).toHaveBeenCalledTimes(1);
    expect(w.write).toHaveBeenCalledTimes(1);
    expect(w.session.objective.semantic_status).toBe('completed_verified');
    const progress = await w.session.finish(partial);
    expect(progress.semantic_status).toBe('completed_verified');
    expect(
      (await w.repo.get(w.session.objective_id)).plan?.deliverables[0]
        .evidence_refs?.length,
    ).toBeGreaterThan(1);
  }));
it('one shared loop publishes completed_verified only from committed opaque server proof', () =>
  RequestContextService.runIsolated(context, async () => {
    const w = await prepared();
    const chat = jest
      .fn()
      .mockResolvedValue({
        success: true,
        content: '',
        tool_calls: [
          {
            id: 'verifycall',
            type: 'function',
            function: {
              name: 'verify_deliverables',
              arguments: JSON.stringify({ deliverables: [{ id: 'd1' }] }),
            },
          },
        ],
      });
    const service = new AIAgentService(
      { chat } as never,
      {} as never,
      w.registry,
      { emit: jest.fn() } as never,
      {} as never,
      {
        canUseAIFeature: jest.fn().mockResolvedValue({ allowed: true }),
        getAIFeatureConfig: jest.fn().mockResolvedValue(null),
        consumeAIQuota: jest.fn(),
      } as never,
    );
    const result = await service.runAgent({
      goal: 'Verifica el cierre',
      durable: w.session,
      plan: w.hook,
      agent_key: 'vexi',
    });
    expect({
      status: result.objective?.semantic_status,
      content: result.content,
      error: result.error,
    }).toEqual({
      status: 'completed_verified',
      content: result.content,
      error: undefined,
    });
    expect(result.execution?.outcome).toBe('completed_verified');
    expect(chat).toHaveBeenCalledTimes(1);
  }));
it.each([true, false])(
  'model verified=%s and invented text cannot complete before an applied ledger effect',
  (verified) =>
    RequestContextService.runIsolated(context, async () => {
      const w = harness();
      const session = (await w.sessions.open(7, 'vexi', 'Cerrar caja'))!;
      const hook = w.plans.createHook(7, session);
      await hook.execute('propose_plan', planArgs());
      for (const order of [1, 2, 3])
        await hook.execute('update_plan_step', {
          order,
          status: 'done',
          evidence: 'inventado',
        });
      const result = await hook.execute(
        'verify_deliverables',
        { deliverables: [{ id: 'd1', verified, evidence: 'ya quedó' }] },
        { assertToolAllowed: () => true },
      );
      expect(JSON.parse(result.result).ok).toBe(false);
      expect((await w.repo.get(session.objective_id)).semantic_status).not.toBe(
        'completed_verified',
      );
      expect(w.write).not.toHaveBeenCalled();
      await session.close();
    }),
);
it.each([2, 8])(
  'rejects a nonshort plan of %s steps without silently dropping work',
  (count) =>
    RequestContextService.runIsolated(context, async () => {
      const w = harness();
      const session = (await w.sessions.open(7, 'vexi', 'Cerrar caja'))!;
      const result = await w.plans
        .createHook(7, session)
        .execute('propose_plan', planArgs(count));
      expect(JSON.parse(result.result).ok).toBe(false);
      expect(session.objective.plan).toBeNull();
      await session.close();
    }),
);
it('DAG refuses unresolved dependencies and changing economic goal', () =>
  RequestContextService.runIsolated(context, async () => {
    const w = harness();
    const session = (await w.sessions.open(7, 'vexi', 'Cerrar caja'))!;
    const hook = w.plans.createHook(7, session);
    await hook.execute('propose_plan', planArgs());
    expect(
      JSON.parse(
        (
          await hook.execute('update_plan_step', {
            order: 3,
            status: 'done',
            evidence: 'x',
          })
        ).result,
      ).ok,
    ).toBe(false);
    expect(
      JSON.parse(
        (await hook.execute('revise_plan', { goal: 'Crear proveedor nuevo' }))
          .result,
      ).ok,
    ).toBe(false);
    expect(session.objective.goal).toBe('Cerrar caja');
    await session.close();
  }));
it('no verifier option or unavailable surface cannot accept model assertions', () =>
  RequestContextService.runIsolated(context, async () => {
    const w = await prepared();
    const result = await w.hook.execute('verify_deliverables', {
      deliverables: [{ id: 'd1', verified: true, evidence: 'fake' }],
    });
    expect(JSON.parse(result.result).ok).toBe(false);
    expect(w.session.objective.semantic_status).not.toBe('completed_verified');
    await w.session.close();
  }));
it.each(['open', 'wrong_difference', 'wrong_id'])(
  'a fresh but incorrect cash domain state (%s) stays partial',
  (kind) =>
    RequestContextService.runIsolated(context, async () => {
      const w = await prepared();
      w.setCash({
        id: kind === 'wrong_id' ? 42 : 900020,
        status: kind === 'open' ? 'open' : 'closed',
        actual_closing_amount: 105,
        expected_closing_amount: 100,
        difference: kind === 'wrong_difference' ? 0 : 5,
      });
      const result = await w.hook.execute(
        'verify_deliverables',
        { deliverables: [{ id: 'd1' }] },
        { assertToolAllowed: () => true },
      );
      expect(JSON.parse(result.result).ok).toBe(false);
      expect(w.session.objective.semantic_status).not.toBe(
        'completed_verified',
      );
      await w.session.close();
    }),
);
it('repository rejects JSON forgery and proof issued for other economic inputs', () =>
  RequestContextService.runIsolated(context, async () => {
    const w = await prepared();
    await expect(
      w.repo.commitVerified(w.session.objective_id, w.session.lease, {
        verified: true,
      }),
    ).rejects.toThrow();
    const rows = await w.repo.listResults(w.session.objective_id);
    const capability = issueAgentVerification({
      ...scope,
      objective_id: w.session.objective_id,
      step_id: 'objective',
      ...w.session.lease,
      evidence_refs: rows.items.map((row) => `agent-result:${row.id}`),
      workflows: ['cerrar-caja'],
      verified_at: new Date().toISOString(),
      contracts_hash: agentVerificationContractsHash([
        {
          ...contract,
          inputs: { ...contract.inputs, actual_closing_amount: 999 },
        },
      ]),
    });
    await expect(
      w.repo.commitVerified(
        w.session.objective_id,
        w.session.lease,
        capability,
      ),
    ).rejects.toThrow();
    expect(w.session.objective.semantic_status).not.toBe('completed_verified');
    await w.session.close();
  }));
it('new deadlines preserve uncertain write and crash receipt prevents any second dispatch', () =>
  RequestContextService.runIsolated(context, async () => {
    const w = harness();
    const s = (await w.sessions.open(7, 'vexi', 'Cerrar caja'))!;
    await s.close();
    let effects = 0;
    const dispatch = jest.fn(async () => {
      effects++;
      throw Object.assign(new Error('timeout'), {
        name: 'AbortError',
        code: 'AGENT_DEADLINE_EXCEEDED',
      });
    });
    const first = await w.plans.applyDurableEffect(
      { conversationId: 7, tool: 'close_cash_session', args },
      dispatch,
    );
    expect(first.result?.status).toBe('unknown_effect');
    await expect(
      w.plans.applyDurableEffect(
        { conversationId: 7, tool: 'close_cash_session', args },
        dispatch,
      ),
    ).rejects.toThrow();
    expect(effects).toBe(1);
  }));

it('technical insertion remaps dependency identity, and incomplete additions or blank descriptions cannot bypass contract', () =>
  RequestContextService.runIsolated(context, async () => {
    const w = harness();
    const session = (await w.sessions.open(7, 'vexi', 'Cerrar caja'))!;
    const hook = w.plans.createHook(7, session);
    const blank = planArgs();
    blank.deliverables.unshift({ ...blank.deliverables[0], description: '' });
    expect(
      JSON.parse((await hook.execute('propose_plan', blank)).result).ok,
    ).toBe(false);
    await hook.execute('propose_plan', planArgs());
    expect(
      JSON.parse(
        (
          await hook.execute('revise_plan', {
            add_steps: [{ title: 'Sin contrato', kind: 'verificacion' }],
          })
        ).result,
      ).ok,
    ).toBe(false);
    const raw = planArgs().steps[0];
    expect(
      JSON.parse(
        (
          await hook.execute('revise_plan', {
            add_steps: [
              {
                ...raw,
                title: 'Consulta alternativa',
                after_order: 1,
                depends_on: [1],
              },
            ],
          })
        ).result,
      ).ok,
    ).toBe(true);
    expect(session.objective.plan?.steps).toHaveLength(4);
    // Original final step depended on original change2, now order3, NOT inserted order2.
    expect(session.objective.plan?.steps[3].depends_on).toEqual([3]);
    expect(session.objective.plan?.steps[2].depends_on).toEqual([1]);
    await session.close();
  }));
it('an unverified internal plan cannot narrate business completion from model prose', () =>
  RequestContextService.runIsolated(context, async () => {
    const w = await prepared();
    const chat = jest
      .fn()
      .mockResolvedValue({
        success: true,
        content: 'Todo quedó cerrado y verificado.',
      });
    const service = new AIAgentService(
      { chat } as never,
      {} as never,
      w.registry,
      { emit: jest.fn() } as never,
      {} as never,
      {
        canUseAIFeature: jest.fn().mockResolvedValue({ allowed: true }),
        getAIFeatureConfig: jest.fn().mockResolvedValue(null),
      } as never,
    );
    const result = await service.runAgent({
      goal: 'Continúa',
      durable: w.session,
      plan: w.hook,
      agent_key: 'vexi',
      max_iterations: 1,
    });
    expect(result.objective?.semantic_status).not.toBe('completed_verified');
    expect(result.content).not.toContain('Todo quedó cerrado');
  }));
it('approved-effect deadline fits live lease and counts active execution before preserving unknown', async () => {
  jest.useFakeTimers();
  try {
    await RequestContextService.runIsolated(context, async () => {
      const w = harness();
      const session = (await w.sessions.open(7, 'vexi', 'Cerrar caja'))!;
      await session.close();
      const pending = w.plans.applyDurableEffect(
        { conversationId: 7, tool: 'close_cash_session', args },
        () => new Promise<string>(() => {}),
      );
      for (
        let i = 0;
        i < 100 &&
        ![...w.db.effects.values()].some((e) => e.status === 'applying');
        i++
      )
        await Promise.resolve();
      expect([...w.db.effects.values()][0]?.status).toBe('applying');
      await jest.advanceTimersByTimeAsync(88000);
      const result = await pending;
      expect(result.result?.status).toBe('unknown_effect');
      const row = (await w.repo.getForConversation(7))!;
      expect(row.budget.active_runtime_ms).toBeGreaterThanOrEqual(88000);
      expect(row.lease_until).toBeNull();
    });
  } finally {
    jest.useRealTimers();
  }
});
it('D2 OFF keeps legacy twelve-step plan semantics without requiring new contracts', () =>
  RequestContextService.runIsolated(context, async () => {
    delete process.env.AI_AGENT_ROBUST_EXECUTION_ENABLED;
    const w = harness();
    const session = (await w.sessions.open(7, 'vexi', 'Cerrar caja'))!;
    const result = await w.plans
      .createHook(7, session)
      .execute('propose_plan', planArgs(12));
    expect(JSON.parse(result.result).ok).toBe(true);
    expect(session.objective.plan?.steps).toHaveLength(12);
    await session.close();
  }));
