/** OFFLINE: real loop/registry/D1 repository+session, synthetic provider/domain/recipe SQL transport.
 * No model quality, PostgreSQL, provider spend or improvement measurement is claimed. */
import { AIAgentService } from '../../src/ai-engine/ai-agent.service';
import { AgentObjectiveRepository } from '../../src/ai-engine/tasks/agent-objective.repository';
import { AgentTaskContextService } from '../../src/ai-engine/tasks/agent-task-context.service';
import { AgentDurableSessionService } from '../../src/ai-engine/tasks/agent-durable-session.service';
import { ObjectiveMemoryDatabase } from '../../src/ai-engine/tasks/testing/objective-memory-db';
import { RequestContextService } from '../../src/common/context/request-context.service';
import { ProceduralMemoryService } from '../../src/ai-engine/memory/procedural-memory.service';
import { createProceduralRecipeTools } from '../../src/ai-engine/tools/domains/recipe.tools';
import { fixture, context } from './f-recipe.fixtures';
import { AgentVerifierService } from '../../src/ai-engine/tasks/agent-verifier.service';

const scoped = <T>(cb: () => T) =>
  RequestContextService.runIsolated(context, cb);
async function integration(
  surface: 'vex' | 'vexi',
  variant = 'new-document-A',
) {
  const f = fixture();
  const db = new ObjectiveMemoryDatabase();
  db.seedConversation(11, context, { agent_key: surface });
  const objectives = new AgentObjectiveRepository(db.prisma);
  const contexts = new AgentTaskContextService(objectives);
  const session = await new AgentDurableSessionService(
    objectives,
    contexts,
  ).open(11, surface, 'Crear cliente nuevo');
  const recipeRepo = {
    available: async () => [f.recipe],
    currentOwnerPermissions: async () => ({
      permissions: context.permissions,
      industries: ['retail'],
    }),
    event: jest.fn(),
    retire: jest.fn(),
    live: async () => f.recipe,
    loadedPins: async () =>
      [...db.results.values()]
        .filter(
          (r) =>
            r.tool_name === 'load_recipe' &&
            r.objective_id === session!.objective_id,
        )
        .flatMap((r) => {
          const d = r.data as { recipe_id: number; hash: string };
          return d?.recipe_id ? [{ id: d.recipe_id, hash: d.hash }] : [];
        }),
  };
  const memory = new ProceduralMemoryService(
    recipeRepo as never,
    f.quality,
    objectives,
    f.registry,
  );
  f.registry.registerMany(createProceduralRecipeTools());
  const reads = jest.fn(async (args) =>
    JSON.stringify({
      id: variant === 'new-document-A' ? 701 : 702,
      documento: args.documento,
      current_price: variant === 'new-document-A' ? 100 : 200,
      current_stock: variant === 'new-document-A' ? 2 : 0,
    }),
  );
  const write = jest.fn();
  f.registry.get('lookup_customer')!.handler = reads;
  f.registry.get('upsert_customer')!.handler = write;
  // Preview is real registry's existing consent choke; transport is synthetic and never redeemed.
  (f.registry as unknown as { confirmations: unknown }).confirmations = {
    issue: jest.fn().mockResolvedValue('SYNTHETIC_NEW_CONFIRMATION'),
  };
  const call = (name: string, args: unknown, n: number) => ({
    success: true,
    content: '',
    usage: { totalTokens: 10 },
    tool_calls: [
      {
        id: `call-${n}`,
        type: 'function',
        function: { name, arguments: JSON.stringify(args) },
      },
    ],
  });
  const chat = jest
    .fn()
    .mockResolvedValueOnce(
      call('search_recipes', { query: 'crear cliente' }, 1),
    )
    .mockResolvedValueOnce(
      call(
        'load_recipe',
        { id: 41, version: f.recipe.version, hash: f.recipe.content_hash },
        2,
      ),
    )
    .mockResolvedValueOnce(call('lookup_customer', { documento: variant }, 3))
    .mockResolvedValueOnce(call('upsert_customer', {}, 4))
    .mockResolvedValue({
      success: true,
      content: 'Revisa esta propuesta; aún no aplicada.',
      usage: { totalTokens: 10 },
    });
  const access = {
    canUseAIFeature: jest.fn().mockResolvedValue({ allowed: true }),
    getAIFeatureConfig: jest
      .fn()
      .mockResolvedValue({ enabled: true, tools_allowed: ['*'] }),
    consumeExtraQuota: jest.fn(),
    checkExtraQuota: jest.fn().mockResolvedValue({ exceeded: false }),
    consumeAIQuota: jest.fn(),
  };
  const agent = new AIAgentService(
    { chat } as never,
    {} as never,
    f.registry,
    { emit: jest.fn() } as never,
    {} as never,
    access as never,
    undefined,
    undefined,
    undefined,
    memory,
  );
  const run = () =>
    agent.runAgent({
      goal: 'Crear cliente nuevo',
      agent_key: surface,
      durable: session!,
      conversation_id: 11,
      max_iterations: 6,
    });
  return {
    ...f,
    db,
    objectives,
    contexts,
    session,
    memory,
    reads,
    write,
    chat,
    access,
    agent,
    run,
    recipeRepo,
  };
}
describe('F miner/recipe integration and fresh-input consent regression', () => {
  beforeEach(() => {
    process.env.AI_RECIPE_REVIEW_KEY = 'ab'.repeat(32);
  });
  afterEach(() => {
    delete process.env.AI_RECIPE_REVIEW_KEY;
  });
  it.each(['vex', 'vexi'] as const)(
    '%s uses reviewed recipe then live data, never old values or recipe approval',
    (surface) =>
      scoped(async () => {
        const f = await integration(surface);
        const result = await f.run();
        expect(f.reads).toHaveBeenCalledTimes(1);
        expect(f.reads.mock.calls[0][0]).toEqual({
          documento: 'new-document-A',
        });
        expect(f.write).not.toHaveBeenCalled();
        if (surface === 'vexi')
          expect(result.pending_confirmation).toBeTruthy();
        else expect(result.pending_plan).toBeTruthy();
        expect(result.execution?.outcome).not.toBe('completed_verified');
        const results = [...f.db.results.values()];
        expect(
          results.find((r) => r.tool_name === 'load_recipe'),
        ).toBeDefined();
        const read = results.find((r) => r.tool_name === 'lookup_customer')!;
        expect(read.data).toMatchObject({
          id: 701,
          current_price: 100,
          current_stock: 2,
        });
        const taskContext = await f.contexts.build(f.session!.objective_id);
        expect(taskContext.context).not.toContain('Lee documento nuevo');
        expect(taskContext.context).toContain('recipe_pin');
        expect(
          f.chat.mock.calls[0][0].some((m: { content: string }) =>
            m.content?.includes('CADA escritura'),
          ),
        ).toBe(true);
      }),
  );
  it('same recipe, new variant rereads changed stock/price and still requires a NEW preview/approval', () =>
    scoped(async () => {
      const first = await integration('vexi');
      await first.run();
      const next = await integration('vexi', 'new-document-B');
      await next.run();
      const read = [...next.db.results.values()].find(
        (r) => r.tool_name === 'lookup_customer',
      )!;
      expect(read.data).toMatchObject({
        id: 702,
        current_price: 200,
        current_stock: 0,
      });
      expect(next.reads.mock.calls[0][0]).toEqual({
        documento: 'new-document-B',
      });
      expect(next.write).not.toHaveBeenCalled();
    }));

  it('D2 server failure observer quarantines through F, while model booleans cannot verify anything', () =>
    scoped(async () => {
      const f = await integration('vexi');
      await f.run();
      const verifier = new AgentVerifierService(
        f.registry,
        f.objectives,
        f.loader,
        f.memory,
      );
      const result = await verifier.verifyMany(
        f.session!,
        [
          {
            step_id: 'd1',
            workflow_key: 'does-not-exist',
            inputs: { verified: true },
          },
        ],
        { assertToolAllowed: () => true },
      );
      expect(result.verified).toBe(false);
      expect(f.recipeRepo.retire).not.toHaveBeenCalled();
      await f.memory.verifierFailed(f.session!.objective_id, [
        'unrelated-workflow',
      ]);
      expect(f.recipeRepo.retire).not.toHaveBeenCalled();
      // Trusted observer accepts ONLY the workflow whose domain predicate failed.
      await f.memory.verifierFailed(f.session!.objective_id, ['crear-cliente']);
      expect(f.recipeRepo.retire).toHaveBeenCalledWith(
        41,
        f.recipe.content_hash,
        'verifier_failed',
      );
    }));
});
