import { RequestContextService } from '../../../common/context/request-context.service';
import {
  VexiPlanStateService,
  renderPlanForModel,
  PLAN_TTL_MS,
} from './vexi-plan-state.service';

function makeService(initial: any = { agent_key: 'vexi' }) {
  const row = { metadata: initial as any };
  const prisma: any = {
    ai_conversations: {
      findFirst: jest.fn(async () => ({ metadata: row.metadata })),
      updateMany: jest.fn(async ({ data }: any) => {
        row.metadata = data.metadata;
        return { count: 1 };
      }),
    },
  };
  return { svc: new VexiPlanStateService(prisma), row, prisma };
}

const propose = {
  goal: 'Crear Juan con rol',
  deliverables: [
    { description: 'Juan existe' },
    { description: 'Juan es admin' },
  ],
  steps: [
    { title: 'Buscar Juan', kind: 'verificacion', done_when: 'sé si existe' },
    { title: 'Crear Juan', kind: 'cambio', done_when: 'user id leído' },
    { title: 'Asignar rol', kind: 'cambio', done_when: 'rol leído' },
  ],
};

const run = async (svc: VexiPlanStateService, name: any, args: any) =>
  JSON.parse((await svc.createHook(1).execute(name, args)).result);

describe('VexiPlanStateService', () => {
  it('crea el plan con ids, pending y attempts 0, y preserva agent_key', async () => {
    const { svc, row } = makeService();
    const r = await run(svc, 'propose_plan', propose);
    expect(r.ok).toBe(true);
    expect(row.metadata.agent_key).toBe('vexi');
    const plan = row.metadata.agent_plan;
    expect(plan.status).toBe('active');
    expect(plan.deliverables).toEqual([
      { id: 'd1', description: 'Juan existe', verified: false },
      { id: 'd2', description: 'Juan es admin', verified: false },
    ]);
    expect(plan.steps.map((s: any) => [s.order, s.status, s.attempts])).toEqual(
      [
        [1, 'pending', 0],
        [2, 'pending', 0],
        [3, 'pending', 0],
      ],
    );
  });

  it('un plan nuevo reemplaza al activo previo (solo queda el nuevo)', async () => {
    const { svc, row } = makeService();
    await run(svc, 'propose_plan', propose);
    const firstId = row.metadata.agent_plan.id;
    const r = await run(svc, 'propose_plan', { ...propose, goal: 'Otro' });
    expect(r.superseded_previous).toBe(true);
    expect(row.metadata.agent_plan.goal).toBe('Otro');
    expect(row.metadata.agent_plan.id).not.toBe(firstId);
  });

  it('rechaza propose sin deliverables y cambio sin done_when', async () => {
    const { svc, row } = makeService();
    const a = await run(svc, 'propose_plan', { ...propose, deliverables: [] });
    expect(a.ok).toBe(false);
    const b = await run(svc, 'propose_plan', {
      ...propose,
      steps: [{ title: 'x', kind: 'cambio', done_when: '' }],
    });
    expect(b.ok).toBe(false);
    expect(b.error).toBe(
      'el paso 1 es un cambio y necesita done_when (criterio verificable)',
    );
    expect(row.metadata.agent_plan).toBeUndefined();
  });

  it('sin plan activo, tools distintas de propose/resume rechazan', async () => {
    const { svc } = makeService();
    expect(
      await run(svc, 'update_plan_step', { order: 1, status: 'done' }),
    ).toEqual({
      ok: false,
      error: 'no hay plan activo',
    });
  });

  it('rechaza done en cambio sin evidence; con evidence lo acepta', async () => {
    const { svc, row } = makeService();
    await run(svc, 'propose_plan', propose);
    const bad = await run(svc, 'update_plan_step', {
      order: 2,
      status: 'done',
    });
    expect(bad.ok).toBe(false);
    expect(row.metadata.agent_plan.steps[1].status).toBe('pending');
    const good = await run(svc, 'update_plan_step', {
      order: 2,
      status: 'done',
      evidence: 'user 55',
    });
    expect(good.ok).toBe(true);
    expect(row.metadata.agent_plan.steps[1].evidence).toBe('user 55');
  });

  it('failed incrementa attempts y al 2do incluye instrucción de ask_user', async () => {
    const { svc, row } = makeService();
    await run(svc, 'propose_plan', propose);
    const first = await run(svc, 'update_plan_step', {
      order: 1,
      status: 'failed',
    });
    expect(first.instruccion).toBeUndefined();
    const second = await run(svc, 'update_plan_step', {
      order: 1,
      status: 'failed',
    });
    expect(second.instruccion).toBe(
      'explícale a la persona qué pasó y pregúntale cómo seguir con ask_user',
    );
    expect(row.metadata.agent_plan.steps[0].attempts).toBe(2);
  });

  it('paso inexistente se rechaza', async () => {
    const { svc } = makeService();
    await run(svc, 'propose_plan', propose);
    const r = await run(svc, 'update_plan_step', { order: 9, status: 'done' });
    expect(r).toEqual({ ok: false, error: 'el paso 9 no existe' });
  });

  it('ask_user pone waiting_user y devuelve endTurn con la pregunta', async () => {
    const { svc, row } = makeService();
    await run(svc, 'propose_plan', propose);
    const out = await svc
      .createHook(1)
      .execute('ask_user', { question: '¿Qué rol?' });
    expect(out.endTurn).toEqual({ text: '¿Qué rol?' });
    expect(row.metadata.agent_plan.steps[0].status).toBe('waiting_user');
    expect(row.metadata.agent_plan.steps[0].question).toBe('¿Qué rol?');
  });

  it('revise_plan no toca pasos done, renumera y respeta el máximo', async () => {
    const { svc, row } = makeService();
    await run(svc, 'propose_plan', propose);
    await run(svc, 'update_plan_step', { order: 1, status: 'done' });
    const bad = await run(svc, 'revise_plan', { remove_orders: [1] });
    expect(bad).toEqual({
      ok: false,
      error: 'el paso 1 ya está hecho: no se modifica ni se elimina',
    });
    const ok = await run(svc, 'revise_plan', {
      remove_orders: [3],
      add_steps: [
        {
          title: 'Nuevo',
          kind: 'verificacion',
          done_when: 'x',
          after_order: 1,
        },
      ],
    });
    expect(ok.ok).toBe(true);
    expect(
      row.metadata.agent_plan.steps.map((s: any) => [s.order, s.title]),
    ).toEqual([
      [1, 'Buscar Juan'],
      [2, 'Nuevo'],
      [3, 'Crear Juan'],
    ]);
    const many = await run(svc, 'revise_plan', {
      add_steps: Array.from({ length: 10 }, () => ({
        title: 't',
        kind: 'verificacion',
        done_when: '',
      })),
    });
    expect(many.ok).toBe(false);
    expect(many.error).toBe('el plan quedaría con 13 pasos y el máximo es 12');
  });

  it('verify_deliverables exige evidence y cierra el plan al completar todo', async () => {
    const { svc, row } = makeService();
    await run(svc, 'propose_plan', propose);
    for (const o of [1, 2, 3]) {
      await run(svc, 'update_plan_step', {
        order: o,
        status: 'done',
        evidence: 'ev',
      });
    }
    const bad = await run(svc, 'verify_deliverables', {
      deliverables: [{ id: 'd1', verified: true }],
    });
    expect(bad.ok).toBe(false);
    const good = await run(svc, 'verify_deliverables', {
      deliverables: [
        { id: 'd1', verified: true, evidence: 'user 55' },
        { id: 'd2', verified: true, evidence: 'rol admin' },
      ],
    });
    expect(row.metadata.agent_plan.status).toBe('done');
    expect(good.instruccion).toContain(
      'sin mencionar plan, pasos, tareas ni entregables',
    );
    expect(row.metadata.agent_key).toBe('vexi');
  });

  it('pause/resume cambian el status', async () => {
    const { svc, row } = makeService();
    await run(svc, 'propose_plan', propose);
    await run(svc, 'pause_plan', { reason: 'cambió de tema' });
    expect(row.metadata.agent_plan.status).toBe('paused');
    expect(await svc.getActive(1)).toBeNull();
    await run(svc, 'resume_plan', {});
    expect(row.metadata.agent_plan.status).toBe('active');
  });

  it('un plan activo con más de 24 h se marca abandoned', async () => {
    const old = new Date(Date.now() - PLAN_TTL_MS - 1000).toISOString();
    const { svc, row } = makeService({
      agent_key: 'vexi',
      agent_plan: {
        id: 'p',
        status: 'active',
        goal: 'g',
        deliverables: [],
        steps: [],
        created_at: old,
        updated_at: old,
      },
    });
    expect(await svc.getActive(1)).toBeNull();
    expect(row.metadata.agent_plan.status).toBe('abandoned');
    expect((await svc.get(1))!.status).toBe('abandoned');
    expect(row.metadata.agent_key).toBe('vexi');
  });

  it('markCurrentChangeStep marca el cambio in_progress o el primer cambio pending', async () => {
    const { svc, row } = makeService();
    await run(svc, 'propose_plan', propose);
    await svc.markCurrentChangeStep(1, 'done', 'user 55');
    expect(row.metadata.agent_plan.steps[1]).toMatchObject({
      status: 'done',
      evidence: 'user 55',
    });
    await run(svc, 'update_plan_step', { order: 3, status: 'in_progress' });
    await svc.markCurrentChangeStep(1, 'rejected');
    expect(row.metadata.agent_plan.steps[2].status).toBe('rejected');
  });

  it('setStatus persiste el status', async () => {
    const { svc, row } = makeService();
    await run(svc, 'propose_plan', propose);
    await svc.setStatus(1, 'abandoned');
    expect(row.metadata.agent_plan.status).toBe('abandoned');
  });

  it('los hashes de escritura persisten sin plan interno (E2E-1 Vex)', async () => {
    // Un turno Vex propone escrituras sin lista interna de tareas (el loop
    // ni recibe `params.plan`): los hashes son el binding de aprobación y
    // deben persistir/leerse sin gate de `agent_plan`.
    const { svc, row } = makeService({ agent_key: 'vex' });
    expect(row.metadata.agent_plan).toBeUndefined();
    const written = await svc.setStepHashes(1, [
      { order: 1, tool: 'create_product', args: { name: 'E2EA' } },
      { order: 2, tool: 'archive_product', args: { product_id: 2510 } },
    ]);
    expect(written).toHaveLength(2);
    // Contrato R3: se guarda `{plan_id, created_at, steps}`, no un arreglo plano.
    expect(row.metadata.agent_plan_step_hashes.steps).toHaveLength(2);
    expect(row.metadata.agent_plan_step_hashes).toHaveProperty('plan_id');
    expect(typeof row.metadata.agent_plan_step_hashes.created_at).toBe(
      'string',
    );
    const read = await svc.getStepHashes(1);
    expect(read).toEqual(written);
    expect(read[0]).toMatchObject({ order: 1, tool: 'create_product' });
    expect(typeof read[0].args_hash).toBe('string');
  });
});

describe('renderPlanForModel', () => {
  it('incluye objetivo, ✓/pendiente, pasos, pregunta y la regla de no mencionar', async () => {
    const { svc, row } = makeService();
    await run(svc, 'propose_plan', propose);
    await run(svc, 'verify_deliverables', {
      deliverables: [{ id: 'd1', verified: true, evidence: 'u55' }],
    });
    await svc.createHook(1).execute('ask_user', { question: '¿Qué rol?' });
    const text = renderPlanForModel(row.metadata.agent_plan);
    expect(text).toContain('Objetivo: Crear Juan con rol');
    expect(text).toContain('d1: Juan existe — ✓ (u55)');
    expect(text).toContain('d2: Juan es admin — pendiente');
    expect(text).toContain('1. [waiting_user] (verificacion) Buscar Juan');
    expect(text).toContain('Pregunta pendiente a la persona: ¿Qué rol?');
    expect(text).toContain(
      'Esto es tu guía interna; nunca la menciones a la persona',
    );
  });
});

// D1 adapter contract: repository-specific SQL/ownership/concurrent import are
// exercised by agent-objective.repository.spec, not reimplemented here.
describe('VexiPlanStateService durable adapter', () => {
  const previousFlag = process.env.AI_DURABLE_OBJECTIVES_ENABLED;
  beforeEach(() => {
    process.env.AI_DURABLE_OBJECTIVES_ENABLED = 'true';
  });
  afterEach(() => {
    if (previousFlag === undefined)
      delete process.env.AI_DURABLE_OBJECTIVES_ENABLED;
    else process.env.AI_DURABLE_OBJECTIVES_ENABLED = previousFlag;
  });

  const scopedIt = (title: string, body: () => Promise<void>) =>
    it(title, () =>
      RequestContextService.runIsolated(
        {
          store_id: 7,
          organization_id: 3,
          user_id: 11,
          is_owner: true,
          is_super_admin: false,
          permissions: ['store:products:read'],
        },
        body,
      ),
    );

  function fixture() {
    const now = new Date().toISOString();
    const plan = {
      id: 'internal-plan',
      goal: propose.goal,
      status: 'active',
      deliverables: [{ id: 'd1', description: 'Juan existe', verified: false }],
      steps: propose.steps.map((step, index) => ({
        ...step,
        order: index + 1,
        status: 'pending',
        attempts: 0,
      })),
      created_at: now,
      updated_at: now,
    };
    let row: any = {
      id: '5c675771-8303-48db-9858-815ae11bc501',
      conversation_id: 1,
      store_id: 7,
      organization_id: 3,
      user_id: 11,
      goal: plan.goal,
      plan,
      version: 2,
      lease_generation: 4,
      lease_until: new Date(Date.now() + 90000),
      expires_at: new Date(Date.now() + PLAN_TTL_MS),
      semantic_status: 'active',
      agent_id: 'vex',
      authority_snapshot: ['store:products:read', 'store:products:create'],
      step_hashes: {
        plan_id: 'write-plan',
        created_at: now,
        steps: [{ order: 2, tool: 'create_customer', args_hash: 'hash' }],
      },
      budget: { provider_attempts: 4, tools: 3 },
    };
    const effects = new Map<string, any>();
    const repo: any = {
      isEnabled: () => true,
      rejectProposal: jest.fn(async (_id, version) => {
        if (
          version !== row.version ||
          row.semantic_status !== 'awaiting_approval'
        )
          throw new Error('proposal changed');
        row = {
          ...row,
          semantic_status: 'active',
          requires_revalidation: true,
          version: row.version + 1,
        };
        return row;
      }),
      importLegacy: jest.fn(async () => row),
      savePlan: jest.fn(async (_id, version, next, lease) => {
        if (
          version !== row.version ||
          (lease && lease.lease_generation !== row.lease_generation)
        )
          throw new Error('stale');
        row = { ...row, plan: next, version: row.version + 1 };
        return row;
      }),
      createOrReplace: jest.fn(async (_conversation, next) => {
        row = {
          ...row,
          id: 'c41ee73b-ea1c-445a-bc85-51a946aaf557',
          plan: next,
          goal: next?.goal,
          version: 1,
          lease_generation: 0,
          lease_until: null,
        };
        return row;
      }),
      acquireLease: jest.fn(async () => {
        row = {
          ...row,
          version: row.version + 1,
          lease_generation: row.lease_generation + 1,
          lease_until: new Date(Date.now() + 90000),
        };
        return row;
      }),
      releaseLease: jest.fn(async () => {
        row = { ...row, version: row.version + 1, lease_until: null };
        return true;
      }),
      updateHashes: jest.fn(async (_id, _version, hashes) => {
        row = { ...row, step_hashes: hashes, version: row.version + 1 };
        return row;
      }),
      appendToolResult: jest.fn(async (_id, _lease, input) => {
        row = {
          ...row,
          semantic_status: input.checkpoint.semantic_status,
          version: row.version + 1,
        };
        return {
          objective: row,
          advanced: true,
          result: { id: 'observed-result' },
        };
      }),
      proposeEffect: jest.fn(async (_id, input) => {
        if (!effects.has(input.operation_id))
          effects.set(input.operation_id, { ...input, status: 'proposed' });
        return effects.get(input.operation_id);
      }),
      transitionEffect: jest.fn(
        async (_id, operation, expected, next, details) => {
          const effect = effects.get(operation);
          if (effect.status !== expected) throw new Error('effect changed');
          const saved = { ...effect, status: next, ...details };
          effects.set(operation, saved);
          return saved;
        },
      ),
    };
    const { prisma } = makeService({
      agent_objective_id: row.id,
      agent_objective_authority: 'durable-v1',
      agent_key: 'vex',
      agent_plan: { id: 'old-historical' },
    });
    const svc = new VexiPlanStateService(prisma, repo);
    const session: any = {
      objective: row,
      lease: { version: row.version, lease_generation: row.lease_generation },
    };
    return {
      svc,
      repo,
      session,
      prisma,
      effects,
      row: () => row,
      replace: (value: any) => {
        row = value;
      },
    };
  }

  scopedIt(
    'loads and revises the SAME durable objective, updating the shared fence without legacy JSON writes',
    async () => {
      const { svc, session, repo, prisma } = fixture();
      const hook = svc.createHook(1, session);
      expect((await hook.snapshot())?.goal).toBe(propose.goal);
      await hook.execute('revise_plan', {
        update_steps: [{ order: 1, title: 'Buscar por documento' }],
      });
      expect(repo.savePlan).toHaveBeenCalledWith(
        session.objective.id,
        2,
        expect.objectContaining({ id: 'internal-plan' }),
        expect.objectContaining({ lease_generation: 4 }),
      );
      expect(session.lease.version).toBe(3);
      expect(session.objective.plan.steps[0].title).toBe(
        'Buscar por documento',
      );
      expect(repo.createOrReplace).not.toHaveBeenCalled();
      expect(prisma.ai_conversations.updateMany).not.toHaveBeenCalled();
    },
  );

  scopedIt(
    'first plan attaches to a planless durable objective rather than creating a second authority',
    async () => {
      const f = fixture();
      f.replace({ ...f.row(), plan: null });
      f.session.objective = f.row();
      const first = f.session.objective.id;
      await f.svc.createHook(1, f.session).execute('propose_plan', propose);
      expect(f.repo.savePlan).toHaveBeenCalled();
      expect(f.session.objective.id).toBe(first);
      expect(f.repo.createOrReplace).not.toHaveBeenCalled();
    },
  );

  scopedIt(
    're-proposing the same goal keeps objective identity and accumulated budget',
    async () => {
      const { svc, session, repo } = fixture();
      const id = session.objective.id;
      await svc.createHook(1, session).execute('propose_plan', propose);
      expect(session.objective.id).toBe(id);
      expect(session.objective.plan.id).toBe('internal-plan');
      expect(session.objective.budget.provider_attempts).toBe(4);
      expect(repo.createOrReplace).not.toHaveBeenCalled();
    },
  );

  scopedIt(
    'automatic continuation cannot replace the goal to reset the accumulated budget',
    async () => {
      const { svc, session, repo } = fixture();
      session.automaticContinuation = true;
      const id = session.objective.id;
      await expect(
        svc
          .createHook(1, session)
          .execute('propose_plan', { ...propose, goal: 'Otro objetivo' }),
      ).rejects.toThrow('continuación automática');
      expect(session.objective.id).toBe(id);
      expect(session.objective.budget.provider_attempts).toBe(4);
      expect(repo.createOrReplace).not.toHaveBeenCalled();
    },
  );

  scopedIt(
    'new goal replaces the objective under its own fence and obtains a fresh lease',
    async () => {
      const { svc, repo, session } = fixture();
      await svc
        .createHook(1, session)
        .execute('propose_plan', { ...propose, goal: 'Otro objetivo' });
      expect(repo.createOrReplace).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ goal: 'Otro objetivo' }),
        'vex',
        expect.objectContaining({
          lease: session.lease,
          authority_snapshot: ['store:products:read'],
        }),
      );
      expect(session.objective.id).toBe('c41ee73b-ea1c-445a-bc85-51a946aaf557');
      expect(repo.acquireLease).toHaveBeenCalledWith(session.objective.id, 1);
    },
  );

  scopedIt(
    'rejects an executor superseded by another lease before mutating the plan',
    async () => {
      const f = fixture();
      const hook = f.svc.createHook(1, f.session);
      f.replace({ ...f.row(), lease_generation: 99 });
      await expect(
        hook.execute('update_plan_step', { order: 1, status: 'done' }),
      ).rejects.toThrow('cambió de ejecutor');
      expect(f.repo.savePlan).not.toHaveBeenCalled();
    },
  );

  scopedIt(
    'expired is neither completed nor resumed implicitly by the plan tool',
    async () => {
      const f = fixture();
      f.replace({ ...f.row(), expires_at: new Date(Date.now() - 1) });
      const hook = f.svc.createHook(1, f.session);
      expect(await hook.snapshot()).toBeNull();
      expect(
        JSON.parse((await hook.execute('resume_plan', {})).result).ok,
      ).toBe(false);
      expect(f.repo.savePlan).not.toHaveBeenCalled();
    },
  );

  scopedIt(
    'preserves pending write hashes in the repository and updates the shared version on proposal',
    async () => {
      const { svc, session, repo, prisma } = fixture();
      expect((await svc.getStepHashRecord(1)).plan_id).toBe('write-plan');
      await svc.setStepHashes(
        1,
        [{ order: 1, tool: 'create_customer', args: { name: 'Juan' } }],
        'next-write-plan',
        session,
      );
      expect(repo.updateHashes).toHaveBeenCalledWith(
        session.objective.id,
        2,
        expect.objectContaining({ plan_id: 'next-write-plan' }),
        session.lease,
      );
      expect(session.lease.version).toBe(3);
      expect(prisma.ai_conversations.updateMany).not.toHaveBeenCalled();
    },
  );

  scopedIt(
    'explicit rejection releases a planless pending objective without resetting accumulated budget',
    async () => {
      const f = fixture();
      f.replace({
        ...f.row(),
        plan: null,
        semantic_status: 'awaiting_approval',
      });
      const result = await f.svc.rejectPendingObjective(1);
      expect(result?.semantic_status).toBe('active');
      expect(result?.budget.provider_attempts).toBe(4);
      expect(f.repo.rejectProposal).toHaveBeenCalledWith(f.row().id, 2);
      expect(await f.svc.rejectPendingObjective(1)).toBeNull();
    },
  );

  scopedIt(
    'flag rollback blocks historical metadata and even an already-issued approval before dispatch',
    async () => {
      const { svc } = fixture();
      process.env.AI_DURABLE_OBJECTIVES_ENABLED = 'false';
      await expect(svc.get(1)).rejects.toThrow('durable');
      const dispatch = jest.fn();
      await expect(
        svc.applyDurableEffect(
          { conversationId: 1, tool: 'create_customer', args: {} },
          dispatch,
        ),
      ).rejects.toThrow('durable');
      expect(dispatch).not.toHaveBeenCalled();
    },
  );

  scopedIt(
    'persists intent and applying BEFORE dispatch and never infers verified from an applied receipt',
    async () => {
      const f = fixture();
      const statuses: string[] = [];
      const dispatch = jest.fn(async () => {
        statuses.push(
          ...Array.from(f.effects.values()).map((effect: any) => effect.status),
        );
        return JSON.stringify({
          applied: true,
          id: 99,
          summary: 'Cliente creado',
        });
      });
      const output = await f.svc.applyDurableEffect(
        {
          conversationId: 1,
          stepId: 's2',
          tool: 'create_customer',
          args: { name: 'Juan' },
        },
        dispatch,
      );
      expect(statuses).toEqual(['applying']);
      expect(output.result?.effect_status).toBe('applied');
      expect(Array.from(f.effects.values())[0].status).toBe('applied');
      expect(f.repo.releaseLease).toHaveBeenCalled();
      expect(f.repo.appendToolResult).toHaveBeenCalledWith(
        f.row().id,
        expect.anything(),
        expect.objectContaining({
          tool_call_id: expect.stringMatching(/^effect:/),
          data: expect.objectContaining({ id: 99 }),
          checkpoint: expect.objectContaining({ semantic_status: 'active' }),
        }),
      );
      expect(JSON.stringify(Array.from(f.effects.values()))).not.toContain(
        'confirmation_token',
      );
    },
  );

  scopedIt(
    'a timeout after dispatch becomes unknown and a later approval cannot replay it',
    async () => {
      const f = fixture();
      const dispatch = jest.fn(async () => {
        throw new Error('socket lost after commit');
      });
      const input = {
        conversationId: 1,
        stepId: 's2',
        tool: 'create_customer',
        args: { name: 'Juan' },
      };
      const output = await f.svc.applyDurableEffect(input, dispatch);
      expect(output.result?.status).toBe('unknown_effect');
      expect(Array.from(f.effects.values())[0].status).toBe('unknown');
      await expect(f.svc.applyDurableEffect(input, dispatch)).rejects.toThrow(
        'incierto',
      );
      expect(dispatch).toHaveBeenCalledTimes(1);
    },
  );

  scopedIt(
    'a lost ledger receipt after a real write blocks replay instead of claiming exactly-once',
    async () => {
      const f = fixture();
      const original = f.repo.transitionEffect.getMockImplementation();
      f.repo.transitionEffect.mockImplementation(async (...args: any[]) => {
        if (args[3] === 'applied') throw new Error('checkpoint unavailable');
        return original(...args);
      });
      const dispatch = jest.fn(async () =>
        JSON.stringify({ applied: true, id: 99 }),
      );
      const input = {
        conversationId: 1,
        stepId: 's2',
        tool: 'create_customer',
        args: { name: 'Juan' },
      };
      await expect(f.svc.applyDurableEffect(input, dispatch)).rejects.toThrow(
        'checkpoint unavailable',
      );
      expect(Array.from(f.effects.values())[0].status).toBe('unknown');
      await expect(f.svc.applyDurableEffect(input, dispatch)).rejects.toThrow(
        'incierto',
      );
      expect(dispatch).toHaveBeenCalledTimes(1);
    },
  );
});
