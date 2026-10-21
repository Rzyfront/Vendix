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
    hasPendingEffects: jest.fn(async () => false),
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

it('ON refuses static tenant fallback', async () => {
  RequestContextService.run(ctx, () => undefined);
  await expect(setup().service.open(7, 'vexi', 'x')).rejects.toThrow();
});
it('ON shares fenced lease and bounded facts', async () => {
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
])('does not silently resume %s on a continuation', async (status) => {
  const s = setup();
  s.state = { ...s.state, semantic_status: status };
  const error = await RequestContextService.runIsolated(ctx, () =>
    s.service.open(7, 'vexi', 'x', { continuation: true }),
  ).catch((e) => e);
  expect(error.getStatus()).toBe(409);
  expect(error.getResponse()).toMatchObject({
    error_code: 'AI_OBJECTIVE_REQUIRES_RESUME',
    message: expect.any(String),
  });
  expect(s.repo.createOrReplace).not.toHaveBeenCalled();
  expect(s.repo.acquireLease).not.toHaveBeenCalled();
});
it.each(['unknown_effect'])(
  'a new human message never replaces an objective in %s with a pending effect',
  async (status) => {
    const s = setup();
    s.state = { ...s.state, semantic_status: status };
    s.repo.hasPendingEffects.mockResolvedValue(true);
    await expect(
      RequestContextService.runIsolated(ctx, () =>
        s.service.open(7, 'vexi', 'otra cosa'),
      ),
    ).rejects.toThrow();
    expect(s.repo.createOrReplace).not.toHaveBeenCalled();
    expect(s.repo.acquireLease).not.toHaveBeenCalled();
  },
);
describe('a new human message while a card waits for approval', () => {
  it('withdraws the proposal without applying it and runs the message', async () => {
    const s = setup();
    s.state = {
      ...s.state,
      semantic_status: 'awaiting_approval',
      lease_until: null,
    };
    s.repo.rejectProposal = jest.fn(async () => {
      s.state = {
        ...s.state,
        semantic_status: 'active',
        version: s.state.version + 1,
      };
      return s.state;
    });
    const session = await RequestContextService.runIsolated(ctx, () =>
      s.service.open(7, 'vexi', 'no, cancela'),
    );
    expect(s.repo.recoverAppliedReceipt).toHaveBeenCalled();
    expect(s.repo.rejectProposal).toHaveBeenCalledWith(
      s.state.id,
      1,
      'superseded_by_message',
    );
    expect(s.repo.createOrReplace).toHaveBeenCalledWith(
      7,
      null,
      'vexi',
      expect.objectContaining({ goal: 'no, cancela' }),
    );
    expect(session).not.toBeNull();
  });
  it('keeps the 409 when the proposal cannot be withdrawn (dispatch in flight)', async () => {
    const { ConflictException } = await import('@nestjs/common');
    const s = setup();
    s.state = {
      ...s.state,
      semantic_status: 'awaiting_approval',
      lease_until: null,
    };
    s.repo.rejectProposal = jest.fn(async () => {
      throw new ConflictException(
        'An uncertain effect requires reconciliation before continuing',
      );
    });
    s.repo.hasPendingEffects.mockResolvedValue(true);
    const error = await RequestContextService.runIsolated(ctx, () =>
      s.service.open(7, 'vexi', 'otra cosa'),
    ).catch((e) => e);
    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toMatchObject({
      error_code: 'AI_OBJECTIVE_REQUIRES_RESUME',
    });
    expect(s.repo.createOrReplace).not.toHaveBeenCalled();
    expect(s.repo.acquireLease).not.toHaveBeenCalled();
  });
  it('a continuation never withdraws the card', async () => {
    const s = setup();
    s.state = {
      ...s.state,
      semantic_status: 'awaiting_approval',
      lease_until: null,
    };
    s.repo.rejectProposal = jest.fn();
    await RequestContextService.runIsolated(ctx, () =>
      s.service.open(7, 'vexi', 'x', { continuation: true }),
    ).catch(() => undefined);
    expect(s.repo.rejectProposal).not.toHaveBeenCalled();
  });
});
it('requests clearing requires_revalidation only for an observed successful read', async () => {
  const s = setup();
  await s.session.checkpointTool(
    'read',
    'get_product',
    {},
    normalizeToolResult(JSON.stringify({ id: 1 })),
  );
  expect(
    s.repo.appendToolResult.mock.calls[0][2].checkpoint.requires_revalidation,
  ).toBe(false);
  await s.session.checkpointTool(
    'write',
    'update_product',
    {},
    {
      ...normalizeToolResult(JSON.stringify({ id: 1 })),
      effect_status: 'applied',
    },
  );
  expect(
    s.repo.appendToolResult.mock.calls[1][2].checkpoint,
  ).not.toHaveProperty('requires_revalidation');
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

// Regression B2: real repository/session, deterministic SQL transport (not PostgreSQL).
describe('completed objective does not terminate its conversation', () => {
  async function completed() {
    const { AgentObjectiveRepository } =
      await import('./agent-objective.repository');
    const { ObjectiveMemoryDatabase } =
      await import('./testing/objective-memory-db');
    const db = new ObjectiveMemoryDatabase();
    db.seedConversation(7, ctx);
    const repository = new AgentObjectiveRepository(db.prisma);
    const old = await repository.createOrReplace(7, null, 'vexi', {
      goal: 'consulta anterior',
    });
    // Model an independently verified terminal row at the SQL transport seam.
    db.objectives.set(old.id, {
      ...old,
      semantic_status: 'completed_verified',
      lease_until: null,
    });
    const service = new AgentDurableSessionService(repository, {
      build: async () => ({ context: '', playbook_pins: [] }),
    } as never);
    return { db, repository, old, service };
  }
  it('starts a new human goal, preserves terminal evidence and fences concurrent replacement', () =>
    RequestContextService.runIsolated(ctx, async () => {
      const { service, old, repository, db } = await completed();
      const session = await service.open(7, 'vexi', 'otra consulta');
      expect(session?.objective_id).not.toBe(old.id);
      expect((await repository.get(old.id)).semantic_status).toBe(
        'completed_verified',
      );
      expect((await repository.getForConversation(7))?.id).toBe(
        session?.objective_id,
      );
      const { ObjectiveLeaseBusyException } =
        await import('./agent-objective.repository');
      await expect(
        repository.acquireLease(session!.objective_id, session!.lease.version),
      ).rejects.toBeInstanceOf(ObjectiveLeaseBusyException);

      await expect(
        repository.createOrReplace(7, null, 'vexi', {
          goal: 'concurrente',
          completed_objective_id: old.id,
        }),
      ).rejects.toThrow('Conversation objective changed');
      expect(db.objectives.size).toBe(2);
      await session?.close();
    }));
  it.each([{ continuation: true }, { objectiveId: row().id }])(
    'never creates a replacement for automatic/explicit continuation %j',
    (options) =>
      RequestContextService.runIsolated(ctx, async () => {
        const { service, old, db } = await completed();
        await expect(
          service.open(7, 'vexi', 'continuar', {
            ...options,
            ...(options.objectiveId ? { objectiveId: old.id } : {}),
          }),
        ).rejects.toThrow();
        expect(db.objectives.size).toBe(1);
        expect(db.objectives.get(old.id)?.semantic_status).toBe(
          'completed_verified',
        );
      }),
  );
});

// Hotfix P0-9/P0-11/P0-12/P0-13: one clean objective per human question, on the
// real repository/session and the deterministic SQL transport (not PostgreSQL).
describe('clean objective per human question', () => {
  async function harness(metadata: unknown = null) {
    const { AgentObjectiveRepository } =
      await import('./agent-objective.repository');
    const { ObjectiveMemoryDatabase } =
      await import('./testing/objective-memory-db');
    const db = new ObjectiveMemoryDatabase();
    db.seedConversation(7, ctx, metadata);
    const repository = new AgentObjectiveRepository(db.prisma);
    const service = new AgentDurableSessionService(repository, {
      build: async () => ({ context: '', playbook_pins: [] }),
    } as never);
    return { db, repository, service };
  }
  const ask = async (
    service: AgentDurableSessionService,
    goal: string,
    options: Parameters<AgentDurableSessionService['open']>[3] = {},
  ) => {
    const session = await service.open(7, 'vexi', goal, options);
    await session!.close();
    return session!;
  };

  it('(a) two different questions open two objectives; budget restarts', () =>
    RequestContextService.runIsolated(ctx, async () => {
      const { service, repository, db } = await harness();
      const first = await service.open(7, 'vexi', '¿cómo van las ventas?');
      await first!.addBudget({ tools: 7, expansions: 2 });
      await first!.finish({
        success: true,
        content: 'ok',
        iterations: 1,
        tools_used: [],
        total_tokens: 0,
      });
      const second = await ask(service, 'analiza el cierre de caja');
      expect(second.objective_id).not.toBe(first!.objective_id);
      expect(second.objective.goal).toBe('analiza el cierre de caja');
      expect(second.objective.budget.tools).toBe(0);
      expect(second.objective.budget.expansions).toBe(0);
      expect(second.objective.requires_revalidation).toBe(false);
      expect(db.objectives.get(first!.objective_id)?.semantic_status).toBe(
        'superseded',
      );
      expect((await repository.getForConversation(7))?.id).toBe(
        second.objective_id,
      );
    }));
  it('a continuation keeps the same objective', () =>
    RequestContextService.runIsolated(ctx, async () => {
      const { service } = await harness();
      const first = await ask(service, 'pregunta');
      const next = await ask(service, 'continuar', { continuation: true });
      expect(next.objective_id).toBe(first.objective_id);
    }));
  it('(b) an expired objective does not trap the next message', () =>
    RequestContextService.runIsolated(ctx, async () => {
      const { service, db } = await harness();
      const first = await ask(service, 'ayer');
      db.objectives.set(first.objective_id, {
        ...db.objectives.get(first.objective_id)!,
        expires_at: new Date(Date.now() - 1000),
      });
      const next = await ask(service, 'hoy');
      expect(next.objective_id).not.toBe(first.objective_id);
      // An automatic continuation on the expired one still requires resume.
      db.objectives.set(next.objective_id, {
        ...db.objectives.get(next.objective_id)!,
        expires_at: new Date(Date.now() - 1000),
      });
      const error = await service
        .open(7, 'vexi', 'seguir', { continuation: true })
        .catch((e) => e);
      expect(error.getStatus()).toBe(409);
      expect(error.getResponse().error_code).toBe(
        'AI_OBJECTIVE_REQUIRES_RESUME',
      );
    }));
  it('(c) a blocked read (NOT_ALLOWED) does not trap the next message', () =>
    RequestContextService.runIsolated(ctx, async () => {
      const { service } = await harness();
      const first = await service.open(7, 'vexi', 'lee algo prohibido');
      await first!.checkpointTool(
        'c1',
        'get_secret',
        {},
        {
          ...normalizeToolResult(JSON.stringify({})),
          status: 'blocked',
          error_code: 'AI_AGENT_TOOL_NOT_ALLOWED',
        },
      );
      expect(first!.objective.semantic_status).toBe('blocked');
      await first!.close();
      const next = await ask(service, 'otra pregunta');
      expect(next.objective_id).not.toBe(first!.objective_id);
      expect(next.objective.semantic_status).toBe('active');
    }));
  it('(d) a legacy done plan is imported without the plan', () =>
    RequestContextService.runIsolated(ctx, async () => {
      const legacy = {
        id: 'legacy-plan',
        goal: 'plan viejo',
        status: 'done',
        steps: [{ order: 1, title: 'x', kind: 'consulta', status: 'done' }],
        deliverables: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const { service, db } = await harness({ agent_plan: legacy });
      const session = await ask(service, 'pregunta nueva');
      expect(session.objective.plan).toBeNull();
      expect(session.objective.goal).toBe('pregunta nueva');
      expect(session.objective.semantic_status).toBe('active');
      expect(db.objectives.size).toBe(1);
      const metadata = db.conversations.get(7)!.metadata as Record<
        string,
        unknown
      >;
      expect(metadata.agent_plan).toBeNull();
      expect(metadata.agent_plan_legacy_history).toEqual(legacy);
    }));
  it('(e) an unknown effect answers 409 AI_OBJECTIVE_REQUIRES_RESUME and keeps the objective', () =>
    RequestContextService.runIsolated(ctx, async () => {
      const { service, db } = await harness();
      const first = await ask(service, 'crea un producto');
      const now = new Date();
      // The ledger holds the uncertain write: that is what traps the chat.
      db.effects.set('e1', {
        id: 'e1',
        ...ctx,
        objective_id: first.objective_id,
        operation_id: 'op1',
        proposal_hash: 'h',
        step_id: 's',
        status: 'unknown',
        created_at: now,
        updated_at: now,
      } as never);
      db.objectives.set(first.objective_id, {
        ...db.objectives.get(first.objective_id)!,
        semantic_status: 'unknown_effect',
      });
      const error = await service.open(7, 'vexi', 'otra').catch((e) => e);
      expect(error.getStatus()).toBe(409);
      expect(error.getResponse()).toMatchObject({
        error_code: 'AI_OBJECTIVE_REQUIRES_RESUME',
        message: expect.stringContaining('cambio'),
      });
      expect(JSON.stringify(error.getResponse())).not.toContain('next_step');
      expect(db.objectives.size).toBe(1);
    }));
  it('an unanswered UI command (unknown_effect without a ledger effect) does not trap the next message', () =>
    RequestContextService.runIsolated(ctx, async () => {
      const { service, db } = await harness();
      const first = await ask(service, 'llévame a ventas');
      db.objectives.set(first.objective_id, {
        ...db.objectives.get(first.objective_id)!,
        semantic_status: 'unknown_effect',
      });
      const next = await ask(service, 'muéstrame el cierre de caja');
      expect(next.objective_id).not.toBe(first.objective_id);
    }));
  it('an applied write not yet re-read keeps the objective (no reset)', () =>
    RequestContextService.runIsolated(ctx, async () => {
      const { service, db } = await harness();
      const first = await ask(service, 'cambia el precio');
      const now = new Date();
      db.effects.set('e1', {
        id: 'e1',
        ...ctx,
        objective_id: first.objective_id,
        operation_id: 'op1',
        proposal_hash: 'h',
        step_id: 's',
        status: 'applied',
        created_at: now,
        updated_at: now,
      } as never);
      db.objectives.set(first.objective_id, {
        ...db.objectives.get(first.objective_id)!,
        requires_revalidation: true,
      });
      const next = await ask(service, 'otra cosa');
      expect(next.objective_id).toBe(first.objective_id);
      // An observed read after the write clears the obligation...
      const again = await service.open(7, 'vexi', 'x', { continuation: true });
      await again!.checkpointTool(
        'r1',
        'get_product',
        {},
        normalizeToolResult(JSON.stringify({ id: 1 })),
      );
      expect(again!.objective.requires_revalidation).toBe(false);
      await again!.close();
      // ...and the next human question starts clean.
      const fresh = await ask(service, 'pregunta distinta');
      expect(fresh.objective_id).not.toBe(first.objective_id);
    }));
  it('a live lease answers 409 AI_OBJECTIVE_LEASE_BUSY with a human message', () =>
    RequestContextService.runIsolated(ctx, async () => {
      const { service } = await harness();
      const running = await service.open(7, 'vexi', 'primera');
      const error = await service.open(7, 'vexi', 'segunda').catch((e) => e);
      expect(error.getStatus()).toBe(409);
      expect(error.getResponse()).toMatchObject({
        error_code: 'AI_OBJECTIVE_LEASE_BUSY',
        message: expect.stringContaining('Espera'),
      });
      await running!.close();
    }));
});
