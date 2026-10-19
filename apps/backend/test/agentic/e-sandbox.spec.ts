/** Offline real loop/registry/policy/D1 seam. The runner/provider/domain are SYNTHETIC. */
import { RequestContextService } from '../../src/common/context/request-context.service';
import { AIAgentService } from '../../src/ai-engine/ai-agent.service';
import { AIToolRegistry } from '../../src/ai-engine/tools/ai-tool-registry';
import { createProductTools } from '../../src/ai-engine/tools/domains/products.tools';
import { createCodeExecutionTools } from '../../src/ai-engine/tools/domains/code-execution.tools';
import { SandboxBrokerService } from '../../src/ai-engine/sandbox/sandbox-broker.service';
import { SandboxPolicyService } from '../../src/ai-engine/sandbox/sandbox-policy.service';
import { AgentObjectiveRepository } from '../../src/ai-engine/tasks/agent-objective.repository';
import { AgentTaskContextService } from '../../src/ai-engine/tasks/agent-task-context.service';
import { AgentDurableSessionService } from '../../src/ai-engine/tasks/agent-durable-session.service';
import { ObjectiveMemoryDatabase } from '../../src/ai-engine/tasks/testing/objective-memory-db';
import { publicSandboxArgs } from '../../src/ai-engine/sandbox/sandbox-invocation.context';

const context = {
  user_id: 7,
  organization_id: 3,
  store_id: 5,
  is_owner: true,
  is_super_admin: false,
  roles: ['owner'],
  permissions: ['store:products:read'],
};
const request = {
  language: 'javascript',
  purpose: 'pagination',
  tools: ['list_products'],
  source:
    'const p = await tools.list_products({page:1,limit:1}); return {total:p.data.total}; // synthetic-source-marker',
};
const run = <T>(work: () => T) =>
  RequestContextService.runIsolated(context, work);

async function fixture(key: 'vex' | 'vexi' = 'vexi') {
  const registry = new AIToolRegistry({} as never);
  const domain = {
    findAll: jest.fn(async () => {
      const ctx = RequestContextService.asyncLocalStorage.getStore()!;
      expect(ctx.store_id).toBe(5);
      expect(ctx.roles).toEqual([]);
      return {
        data: [
          {
            id: 12,
            name: 'QA',
            sku: null,
            base_price: '0.10',
            final_price: '0.30',
            state: 'active',
            product_type: 'physical',
            track_inventory: false,
            product_variants: [],
          },
        ],
        meta: { total: 1, totalPages: 1 },
      };
    }),
  };
  registry.register(
    createProductTools({
      productsService: domain as never,
      priceResolver: {} as never,
      settingsService: {
        getStoreCurrency: jest.fn(async () => 'COP'),
      } as never,
    }).find((t) => t.name === 'list_products')!,
  );
  const db = {
    users: {
      findUnique: jest.fn(async () => ({
        id: 7,
        organization_id: 3,
        state: 'active',
        locked_until: null,
      })),
    },
    stores: {
      findUnique: jest.fn(async () => ({
        id: 5,
        organization_id: 3,
        is_active: true,
      })),
    },
    user_roles: {
      findMany: jest.fn(async () => [
        {
          user_id: 7,
          store_id: null,
          roles: {
            name: 'owner',
            organization_id: null,
            store_id: null,
            is_system_role: true,
            role_permissions: [
              {
                permissions: { name: 'store:products:read', status: 'active' },
              },
            ],
          },
        },
      ]),
    },
    ai_agents: {
      findUnique: jest.fn(async () => ({
        is_active: true,
        allowed_tools: [],
        denied_tools: [],
      })),
    },
    store_settings: {
      findUnique: jest.fn(async () => ({
        settings: { vex: { enabled: true }, vexi: { enabled: true } },
      })),
    },
  };
  const access = {
    canUseAIFeature: jest.fn(async () => ({ allowed: true, mode: 'allow' })),
    getAIFeatureConfig: jest.fn(async () => ({
      enabled: true,
      tools_allowed: ['*'],
    })),
    consumeAIQuota: jest.fn(async () => {}),
    checkExtraQuota: jest.fn(async () => ({ exceeded: false })),
    consumeExtraQuota: jest.fn(async () => {}),
  };
  const policy = new SandboxPolicyService(
    db as never,
    access as never,
    registry,
  );
  const audit = {
    sourceAvailable: jest.fn(() => true),
    start: jest.fn(async () => {}),
    appendCall: jest.fn(async () => {}),
    finish: jest.fn(async () => {}),
  };
  const client = {
    configuration: () => ({
      policy_digest: `sha256:${'a'.repeat(64)}`,
      runtime_digest: `sha256:${'b'.repeat(64)}`,
    }),
    run: jest.fn(async (start, call) => {
      const reply = await call({
        type: 'call',
        execution_id: start.execution_id,
        nonce: start.nonce,
        seq: 1,
        tool: 'list_products',
        args: { page: 1, limit: 1 },
      });
      return {
        total: reply.result.data.total,
        unit_price: reply.result.data.products[0].unit_price,
      };
    }),
  };
  const broker = new SandboxBrokerService(
    registry,
    policy,
    client as never,
    audit as never,
  );
  registry.registerMany(createCodeExecutionTools(broker));
  const memory = new ObjectiveMemoryDatabase();
  memory.seedConversation(11, context, { agent_key: key });
  const repo = new AgentObjectiveRepository(memory.prisma);
  const contexts = new AgentTaskContextService(repo);
  const session = await new AgentDurableSessionService(repo, contexts).open(
    11,
    key,
    'Analizar catálogo paginado',
  );
  const chat = jest
    .fn()
    .mockResolvedValueOnce({
      success: true,
      content: '',
      usage: { totalTokens: 10 },
      tool_calls: [
        {
          id: 'script-call',
          type: 'function',
          function: {
            name: 'run_readonly_script',
            arguments: JSON.stringify(request),
          },
        },
      ],
    })
    .mockResolvedValue({
      success: true,
      content: 'Resultado de cálculo no verificado.',
      usage: { totalTokens: 10 },
    });
  const agent = new AIAgentService(
    { chat } as never,
    {} as never,
    registry,
    { emit: jest.fn() } as never,
    {} as never,
    access as never,
  );
  return {
    agent,
    repo,
    session,
    registry,
    domain,
    db,
    access,
    audit,
    client,
    contexts,
  };
}

describe('E offline integration: same agent+registry+D1 for both text surfaces', () => {
  beforeEach(() => {});
  afterEach(() => {});
  it.each(['vex', 'vexi'] as const)(
    '%s persists read evidence before guest and omits source from public calls/transcript',
    async (key) =>
      run(async () => {
        const f = await fixture(key);
        const chunks: any[] = [];
        const generator = f.agent.runAgentStream({
          goal: 'Analizar catálogo',
          agent_key: key,
          conversation_id: 11,
          durable: f.session!,
          max_iterations: 3,
        });
        let item = await generator.next();
        while (!item.done) {
          chunks.push(item.value);
          item = await generator.next();
        }
        expect(f.domain.findAll).toHaveBeenCalledTimes(1);
        expect(f.audit.start).toHaveBeenCalledTimes(1);
        expect(f.audit.finish).toHaveBeenCalledWith(
          expect.any(String),
          'ok',
          expect.objectContaining({ calls: 1, cost_usd: null }),
        );
        const page = await f.repo.listResults(f.session!.objective_id, {
          limit: 20,
        });
        const read = page.items.find((r) => r.tool_name === 'list_products')!;
        expect(read).toBeDefined();
        const full = await f.repo.getResult(f.session!.objective_id, read.id);
        expect(full.data).toMatchObject({
          products: [{ product_id: 12, unit_price: 0.3 }],
        });
        expect(
          page.items.some((r) => r.tool_name === 'run_readonly_script'),
        ).toBe(true);
        expect(JSON.stringify(chunks)).not.toContain('synthetic-source-marker');
        expect(JSON.stringify(item.value)).not.toContain(
          'synthetic-source-marker',
        );
        const script = item.value.tools_used.find(
          (t) => t.name === 'run_readonly_script',
        )!;
        expect(script.args.source_omitted).toBe(true);
        // One observed underlying read = one commercial tool unit, not wrapper+read.
        expect(f.access.consumeAIQuota).toHaveBeenCalledTimes(1);
        const final = await f.repo.get(f.session!.objective_id);
        expect(final.semantic_status).not.toBe('completed_verified');
        const facts = await f.contexts.build(final.id);
        expect(facts.context).toContain('list_products');
      }),
  );
  it('gates current permission revocation before domain dispatch', async () =>
    run(async () => {
      const f = await fixture();
      f.db.user_roles.findMany.mockResolvedValue([]);
      const response = await f.agent.runAgent({
        goal: 'Analizar',
        agent_key: 'vexi',
        conversation_id: 11,
        durable: f.session!,
        max_iterations: 2,
      });
      expect(f.domain.findAll).not.toHaveBeenCalled();
      expect(f.client.run).not.toHaveBeenCalled();
      expect(response.tools_used[0].execution?.status).not.toBe('ok');
    }));
  it('never attaches source or credentials to public arguments', () => {
    expect(publicSandboxArgs('run_readonly_script', request)).toMatchObject({
      source_omitted: true,
    });
    expect(publicSandboxArgs('list_products', { page: 1 })).toEqual({
      page: 1,
    });
  });
});
