import { resolve } from 'node:path';
import { loadCorpus } from './runner';
import { RequestContextService } from '../../src/common/context/request-context.service';
import { AgentObjectiveRepository } from '../../src/ai-engine/tasks/agent-objective.repository';
import { AgentTaskContextService } from '../../src/ai-engine/tasks/agent-task-context.service';
import { AgentDurableSessionService } from '../../src/ai-engine/tasks/agent-durable-session.service';
import { ObjectiveMemoryDatabase } from '../../src/ai-engine/tasks/testing/objective-memory-db';
import { normalizeToolResult } from '../../src/ai-engine/tools/tool-result.normalizer';
import { VexiPlanStateService } from '../../src/domains/store/vexi/vexi-plan-state.service';

const ctx = {
  store_id: 1,
  organization_id: 2,
  user_id: 3,
  permissions: ['write'],
  roles: ['owner'],
  is_super_admin: false,
  is_owner: true,
};
function wiring(scope = ctx) {
  const db = new ObjectiveMemoryDatabase();
  db.seedConversation(7, scope);
  const repo = new AgentObjectiveRepository(db.prisma);
  const contexts = new AgentTaskContextService(repo);
  const sessions = new AgentDurableSessionService(repo, contexts);
  const plans = new VexiPlanStateService(db.prisma, repo);
  return { db, repo, contexts, sessions, plans };
}
const partial = {
  success: true,
  content: 'Falta verificar.',
  iterations: 1,
  total_tokens: 0,
  tools_used: [],
};
beforeEach(() => (process.env.AI_DURABLE_OBJECTIVES_ENABLED = 'true'));
afterEach(() => {
  delete process.env.AI_DURABLE_OBJECTIVES_ENABLED;
  jest.restoreAllMocks();
});

it('rejected proposal already has a durable tombstone, so even an unconsumed old token cannot dispatch', async () => {
  await RequestContextService.runIsolated(ctx, async () => {
    const w = wiring();
    const session = (await w.sessions.open(7, 'vexi', 'Crear producto'))!;
    await session.proposeWrite('create_product', { name: 'Sintético' });
    await session.checkpointTool(
      'c1',
      'create_product',
      { name: 'Sintético' },
      normalizeToolResult({ requires_confirmation: true }, { write: true }),
    );
    const progress = await session.finish({
      ...partial,
      pending_confirmation: {
        tool: 'create_product',
        arguments: { name: 'Sintético' },
        confirmation_token: 'never-persist',
      },
    });
    await w.repo.rejectProposal(session.objective_id, progress.version);
    const dispatch = jest.fn().mockResolvedValue('{"applied":true,"id":42}');
    await expect(
      w.plans.applyDurableEffect(
        {
          conversationId: 7,
          tool: 'create_product',
          args: { name: 'Sintético' },
        },
        dispatch,
      ),
    ).rejects.toThrow();
    expect(dispatch).not.toHaveBeenCalled();
    expect([...w.db.effects.values()][0].status).toBe('failed');
    expect(JSON.stringify([...w.db.effects.values()])).not.toContain(
      'never-persist',
    );
  });
});
it('cut after a domain write with lost response blocks replay, without fabricated exactly-once or completion', async () => {
  await RequestContextService.runIsolated(ctx, async () => {
    const w = wiring();
    const session = (await w.sessions.open(7, 'vexi', 'Crear producto'))!;
    await session.close();
    let domainCreates = 0;
    const dispatch = jest.fn(async () => {
      domainCreates++;
      throw Object.assign(new Error('transport'), { code: 'ETIMEDOUT' });
    });
    const result = await w.plans.applyDurableEffect(
      {
        conversationId: 7,
        tool: 'create_product',
        args: { name: 'Sintético' },
      },
      dispatch,
    );
    expect(result.result?.status).toBe('unknown_effect');
    await expect(
      w.plans.applyDurableEffect(
        {
          conversationId: 7,
          tool: 'create_product',
          args: { name: 'Sintético' },
        },
        dispatch,
      ),
    ).rejects.toThrow();
    await expect(
      w.sessions.open(7, 'vexi', 'Sigue', { continuation: true }),
    ).rejects.toThrow();
    expect(domainCreates).toBe(1);
    expect([...w.db.effects.values()][0].status).toBe('unknown');
    expect((await w.repo.getForConversation(7))?.semantic_status).toBe(
      'unknown_effect',
    );
  });
});
it('cut after an applied domain receipt before result checkpoint recovers its ID from ledger and never recreates it', async () => {
  await RequestContextService.runIsolated(ctx, async () => {
    const w = wiring();
    const session = (await w.sessions.open(7, 'vexi', 'Crear producto'))!;
    await session.proposeWrite('create_product', { name: 'Sintético' });
    await session.checkpointTool(
      'pending-call',
      'create_product',
      { name: 'Sintético' },
      normalizeToolResult({ requires_confirmation: true }, { write: true }),
    );
    await session.finish({
      ...partial,
      pending_confirmation: {
        tool: 'create_product',
        arguments: { name: 'Sintético' },
        confirmation_token: 'ephemeral',
      },
    });
    const dispatch = jest.fn().mockResolvedValue(
      JSON.stringify({
        applied: true,
        id: 77,
        resource_ids: { product_id: 77 },
      }),
    );
    const append = jest
      .spyOn(w.repo, 'appendToolResult')
      .mockRejectedValueOnce(new Error('process cut before checkpoint'));
    await expect(
      w.plans.applyDurableEffect(
        {
          conversationId: 7,
          tool: 'create_product',
          args: { name: 'Sintético' },
        },
        dispatch,
      ),
    ).rejects.toThrow('process cut');
    append.mockRestore();
    const objective = (await w.repo.getForConversation(7))!;
    const facts = await w.contexts.build(objective.id);
    expect(facts.context).toContain('77');
    expect(facts.context).toContain('applied');
    const restarted = await w.sessions.open(7, 'vexi', 'Sigue', {
      continuation: true,
    });
    expect(restarted?.objective.semantic_status).toBe('partial');
    expect(restarted?.context).toContain('77');
    await restarted?.close();
    await expect(
      w.plans.applyDurableEffect(
        {
          conversationId: 7,
          tool: 'create_product',
          args: { name: 'Sintético' },
        },
        dispatch,
      ),
    ).rejects.toThrow();
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(objective.semantic_status).not.toBe('completed_verified');
  });
});

const corpus = loadCorpus(resolve(__dirname, 'requests.es.jsonl'));
describe('D1 50-case corpus storage/ownership smoke, NOT provider execution or business adjudication', () => {
  it.each(corpus.map((c) => [c.id, c] as const))(
    'case %s preserves scoped facts without claiming verified outcome',
    async (_id, c) => {
      const scope = {
        ...ctx,
        store_id: c.scope.storeId,
        organization_id: c.scope.organizationId,
        user_id: c.scope.userId,
      };
      const w = wiring(scope);
      await RequestContextService.runIsolated(scope, async () => {
        const session = (await w.sessions.open(7, c.agent, c.request))!;
        await session.checkpointTool(
          `fixture-${c.id}`,
          'synthetic_read',
          {},
          normalizeToolResult({ data: c.expectedFacts }),
        );
        const progress = await session.finish(partial);
        expect(progress.semantic_status).not.toBe('completed_verified');
        const row = await w.repo.get(progress.id);
        expect(row.budget.tools).toBe(1);
        await RequestContextService.runIsolated(
          { ...scope, user_id: scope.user_id + 1 },
          async () => {
            await expect(w.repo.get(progress.id)).rejects.toMatchObject({
              status: 404,
            });
          },
        );
      });
    },
  );
});

it('continuation fixture removes >=80% redundant ID lookups after 25-message eviction (not a model benchmark)', async () => {
  await RequestContextService.runIsolated(ctx, async () => {
    const w = wiring();
    const initial = (await w.sessions.open(7, 'vexi', 'Consultar producto'))!;
    await initial.checkpointTool(
      'initial-id',
      'find_product',
      {},
      normalizeToolResult({
        id: 42,
        resource_ids: { product_id: 42 },
        quantity: 3,
      }),
    );
    await initial.finish(partial);
    const last25Messages = Array.from(
      { length: 25 },
      (_, n) => `Mensaje reciente ${n}`,
    ).join(' ');
    let baselineRedundant = 0;
    let durableRedundant = 0;
    for (let n = 0; n < 5; n++) {
      // Deterministic fixture policy: look up again only when the structured ID is absent.
      if (!last25Messages.includes('product_id')) baselineRedundant++;
      const restarted = await w.sessions.open(7, 'vexi', 'Continúa', {
        continuation: true,
      });
      if (!restarted!.context.includes('"product_id":42')) durableRedundant++;
      await restarted!.finish(partial);
    }
    expect(baselineRedundant).toBe(5);
    expect(durableRedundant).toBe(0);
    expect(
      (baselineRedundant - durableRedundant) / baselineRedundant,
    ).toBeGreaterThanOrEqual(0.8);
    expect((await w.repo.getForConversation(7))!.budget.tools).toBe(1);
  });
});

it('provider call IDs may repeat in another turn without colliding or overwriting old results', async () => {
  await RequestContextService.runIsolated(ctx, async () => {
    const w = wiring();
    const a = (await w.sessions.open(7, 'vexi', 'Consultar'))!;
    await a.checkpointTool(
      'call_0',
      'read',
      {},
      normalizeToolResult({ id: 1 }),
    );
    await a.finish(partial);
    const b = (await w.sessions.open(7, 'vexi', 'Continúa', {
      continuation: true,
    }))!;
    await b.checkpointTool(
      'call_0',
      'read',
      {},
      normalizeToolResult({ id: 2 }),
    );
    await b.finish(partial);
    const page = await w.repo.listResults(b.objective_id);
    expect(page.items).toHaveLength(2);
    expect(new Set(page.items.map((r) => r.tool_call_id)).size).toBe(2);
    expect(page.items.every((r) => r.tool_call_id.endsWith(':call_0'))).toBe(
      true,
    );
  });
});
