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
  deliverables: [{ description: 'Juan existe' }, { description: 'Juan es admin' }],
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
    expect(plan.steps.map((s: any) => [s.order, s.status, s.attempts])).toEqual([
      [1, 'pending', 0],
      [2, 'pending', 0],
      [3, 'pending', 0],
    ]);
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
    expect(b.error).toBe('el paso 1 es un cambio y necesita done_when (criterio verificable)');
    expect(row.metadata.agent_plan).toBeUndefined();
  });

  it('sin plan activo, tools distintas de propose/resume rechazan', async () => {
    const { svc } = makeService();
    expect(await run(svc, 'update_plan_step', { order: 1, status: 'done' })).toEqual({
      ok: false,
      error: 'no hay plan activo',
    });
  });

  it('rechaza done en cambio sin evidence; con evidence lo acepta', async () => {
    const { svc, row } = makeService();
    await run(svc, 'propose_plan', propose);
    const bad = await run(svc, 'update_plan_step', { order: 2, status: 'done' });
    expect(bad.ok).toBe(false);
    expect(row.metadata.agent_plan.steps[1].status).toBe('pending');
    const good = await run(svc, 'update_plan_step', { order: 2, status: 'done', evidence: 'user 55' });
    expect(good.ok).toBe(true);
    expect(row.metadata.agent_plan.steps[1].evidence).toBe('user 55');
  });

  it('failed incrementa attempts y al 2do incluye instrucción de ask_user', async () => {
    const { svc, row } = makeService();
    await run(svc, 'propose_plan', propose);
    const first = await run(svc, 'update_plan_step', { order: 1, status: 'failed' });
    expect(first.instruccion).toBeUndefined();
    const second = await run(svc, 'update_plan_step', { order: 1, status: 'failed' });
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
    const out = await svc.createHook(1).execute('ask_user', { question: '¿Qué rol?' });
    expect(out.endTurn).toEqual({ text: '¿Qué rol?' });
    expect(row.metadata.agent_plan.steps[0].status).toBe('waiting_user');
    expect(row.metadata.agent_plan.steps[0].question).toBe('¿Qué rol?');
  });

  it('revise_plan no toca pasos done, renumera y respeta el máximo', async () => {
    const { svc, row } = makeService();
    await run(svc, 'propose_plan', propose);
    await run(svc, 'update_plan_step', { order: 1, status: 'done' });
    const bad = await run(svc, 'revise_plan', { remove_orders: [1] });
    expect(bad).toEqual({ ok: false, error: 'el paso 1 ya está hecho: no se modifica ni se elimina' });
    const ok = await run(svc, 'revise_plan', {
      remove_orders: [3],
      add_steps: [{ title: 'Nuevo', kind: 'verificacion', done_when: 'x', after_order: 1 }],
    });
    expect(ok.ok).toBe(true);
    expect(row.metadata.agent_plan.steps.map((s: any) => [s.order, s.title])).toEqual([
      [1, 'Buscar Juan'],
      [2, 'Nuevo'],
      [3, 'Crear Juan'],
    ]);
    const many = await run(svc, 'revise_plan', {
      add_steps: Array.from({ length: 10 }, () => ({ title: 't', kind: 'verificacion', done_when: '' })),
    });
    expect(many.ok).toBe(false);
    expect(many.error).toBe('el plan quedaría con 13 pasos y el máximo es 12');
  });

  it('verify_deliverables exige evidence y cierra el plan al completar todo', async () => {
    const { svc, row } = makeService();
    await run(svc, 'propose_plan', propose);
    for (const o of [1, 2, 3]) {
      await run(svc, 'update_plan_step', { order: o, status: 'done', evidence: 'ev' });
    }
    const bad = await run(svc, 'verify_deliverables', { deliverables: [{ id: 'd1', verified: true }] });
    expect(bad.ok).toBe(false);
    const good = await run(svc, 'verify_deliverables', {
      deliverables: [
        { id: 'd1', verified: true, evidence: 'user 55' },
        { id: 'd2', verified: true, evidence: 'rol admin' },
      ],
    });
    expect(row.metadata.agent_plan.status).toBe('done');
    expect(good.instruccion).toContain('sin mencionar plan, pasos, tareas ni entregables');
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
        id: 'p', status: 'active', goal: 'g', deliverables: [], steps: [],
        created_at: old, updated_at: old,
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
    expect(row.metadata.agent_plan.steps[1]).toMatchObject({ status: 'done', evidence: 'user 55' });
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
    expect(typeof row.metadata.agent_plan_step_hashes.created_at).toBe('string');
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
    await run(svc, 'verify_deliverables', { deliverables: [{ id: 'd1', verified: true, evidence: 'u55' }] });
    await svc.createHook(1).execute('ask_user', { question: '¿Qué rol?' });
    const text = renderPlanForModel(row.metadata.agent_plan);
    expect(text).toContain('Objetivo: Crear Juan con rol');
    expect(text).toContain('d1: Juan existe — ✓ (u55)');
    expect(text).toContain('d2: Juan es admin — pendiente');
    expect(text).toContain('1. [waiting_user] (verificacion) Buscar Juan');
    expect(text).toContain('Pregunta pendiente a la persona: ¿Qué rol?');
    expect(text).toContain('Esto es tu guía interna; nunca la menciones a la persona');
  });
});
