import {
  AgentDurableSession,
  AgentDurableSessionService,
  objectiveArgsHash,
} from './agent-durable-session.service';
import { emptyObjectiveBudget } from './interfaces/agent-objective.interface';
import { RequestContextService } from '../../common/context/request-context.service';
import { normalizeToolResult } from '../tools/tool-result.normalizer';
const ctx = {
  store_id: 1,
  organization_id: 2,
  user_id: 3,
  permissions: ['read'],
  roles: ['owner'],
  is_owner: true,
  is_super_admin: false,
};
const row = () => ({
  id: '00000000-0000-4000-8000-000000000001',
  conversation_id: 7,
  store_id: 1,
  organization_id: 2,
  user_id: 3,
  agent_id: 'vexi',
  goal: 'consulta',
  plan: null,
  version: 1,
  lease_generation: 1,
  lease_until: new Date(Date.now() + 600000),
  expires_at: new Date(Date.now() + 86400000),
  budget: emptyObjectiveBudget(),
  authority_snapshot: ['read'],
  semantic_status: 'active',
  next_step: null,
  requires_revalidation: false,
});
function setup() {
  let state: any = row();
  const update = async (_id: any, _lease: any, delta: any) =>
    (state = {
      ...state,
      version: state.version + 1,
      budget: {
        ...state.budget,
        ...Object.fromEntries(
          Object.entries(delta).map(([k, v]) => [
            k,
            v === null ? null : (state.budget[k] ?? 0) + Number(v),
          ]),
        ),
      },
    });
  const repo: any = {
    get: jest.fn(async () => structuredClone(state)),
    importLegacy: jest.fn(async () => state),
    recoverAppliedReceipt: jest.fn(async () => state),
    getForConversation: jest.fn(async () => state),
    createOrReplace: jest.fn(async () => state),
    acquireLease: jest.fn(async () => state),
    addBudget: jest.fn(update),
    auditBudget: jest.fn(async (_id, _generation, delta) => {
      const version = state.version;
      await update(_id, null, delta);
      state.version = version;
    }),
    appendToolResult: jest.fn(async (_id, lease, input) => ({
      result: { id: 'result1' },
      objective: (state = {
        ...state,
        version: state.version + 1,
        ...input.checkpoint,
      }),
      advanced: lease.version === state.version - 1,
    })),
    checkpoint: jest.fn(
      async (_id, _lease, patch) =>
        (state = { ...state, ...patch, version: state.version + 1 }),
    ),
    releaseLease: jest.fn(async () => {
      state = { ...state, version: state.version + 1, lease_until: null };
      return true;
    }),
  };
  const context: any = {
    build: jest.fn(async () => ({ context: 'durable facts' })),
  };
  return {
    repo,
    context,
    get state() {
      return state;
    },
    set state(v) {
      state = v;
    },
    service: new AgentDurableSessionService(repo, context),
    session: new AgentDurableSession(state, 'facts', repo),
  };
}
afterEach(() => delete process.env.AI_DURABLE_OBJECTIVES_ENABLED);
it('OFF never touches storage', async () => {
  const s = setup();
  expect(await s.service.open(7, 'vexi', 'x')).toBeNull();
  expect(s.repo.get).not.toHaveBeenCalled();
});
it('ON refuses static tenant fallback', async () => {
  process.env.AI_DURABLE_OBJECTIVES_ENABLED = 'true';
  RequestContextService.run(ctx, () => undefined);
  await expect(setup().service.open(7, 'vexi', 'x')).rejects.toThrow();
});
it('ON shares fenced lease and bounded facts', async () => {
  process.env.AI_DURABLE_OBJECTIVES_ENABLED = 'true';
  const s = setup();
  const session = await RequestContextService.runIsolated(ctx, () =>
    s.service.open(7, 'vexi', 'x'),
  );
  expect(session?.context).toBe('durable facts');
  expect(s.repo.acquireLease).toHaveBeenCalledWith(s.state.id, 1, 650000);
});
it.each([
  'expired',
  'paused',
  'unknown_effect',
  'blocked',
  'awaiting_approval',
  'cancelled',
  'superseded',
])('does not silently resume %s', async (status) => {
  process.env.AI_DURABLE_OBJECTIVES_ENABLED = 'true';
  const s = setup();
  s.state = { ...s.state, semantic_status: status };
  await expect(
    RequestContextService.runIsolated(ctx, () =>
      s.service.open(7, 'vexi', 'x'),
    ),
  ).rejects.toThrow();
  expect(s.repo.acquireLease).not.toHaveBeenCalled();
});
it('persists full results with canonical args hash and advances shared lease', async () => {
  const s = setup();
  const normalized = normalizeToolResult(
    JSON.stringify({ id: 42, quantity: 4 }),
  );
  await s.session.checkpointTool(
    'call',
    'get_product',
    { b: 2, a: 1 },
    normalized,
  );
  const input = s.repo.appendToolResult.mock.calls[0][2];
  expect(input.data).toEqual({ id: 42, quantity: 4 });
  expect(input.args_hash).toBe(objectiveArgsHash({ a: 1, b: 2 }));
  expect(s.session.lease.version).toBe(2);
});
it('stale executor preserves audit without advancing', async () => {
  const s = setup();
  s.repo.appendToolResult.mockResolvedValue({
    result: { id: 'audit' },
    objective: s.state,
    advanced: false,
  });
  await expect(
    s.session.checkpointTool('old', 'read', {}, normalizeToolResult('{}')),
  ).rejects.toThrow('STALE_EXECUTOR');
});
it('cumulative exhausted budget blocks new provider spend', async () => {
  const s = setup();
  s.state.budget.provider_attempts = 240;
  const call = jest.fn();
  await expect(s.session.runProvider(call)).rejects.toThrow('BUDGET_EXHAUSTED');
  expect(call).not.toHaveBeenCalled();
});
it('records intent before provider, including failed usage without fabricated cost', async () => {
  const s = setup();
  const response = await s.session.runProvider(async () => ({
    success: false,
    usage: { promptTokens: 8, completionTokens: 2, totalTokens: 10 },
  }));
  expect(response.success).toBe(false);
  expect(s.state.budget.provider_attempts).toBe(1);
  expect(s.state.budget.prompt_tokens).toBe(8);
  expect(s.state.budget.cost_usd).toBeNull();
});
it('release and final version precede public resume snapshot', async () => {
  const s = setup();
  const progress = await s.session.finish({
    success: true,
    content: 'done',
    iterations: 1,
    tools_used: [],
    total_tokens: 0,
  });
  expect(progress.version).toBe(s.state.version);
  expect(progress.semantic_status).toBe('partial');
  await s.session.close();
  expect(s.repo.releaseLease).toHaveBeenCalledTimes(1);
});
it('does not count human wait as active runtime', async () => {
  const s = setup();
  s.session.excludeWait(10000);
  await s.session.accountRuntime();
  expect(s.repo.addBudget).not.toHaveBeenCalled();
});
