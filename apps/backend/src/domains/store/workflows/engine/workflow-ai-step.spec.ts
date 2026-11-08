import {
  WORKFLOW_SCHEMA_V1,
  WorkflowDefinitionV1,
  WorkflowStageDef,
  stageFormKeys,
} from '@common/workflows/contract';
import {
  buildWorkflowKit,
  seedDefinition,
  seedPeople,
} from '../../../../testing/workflows/workflow-test-kit';
import {
  AI_STEP_FAILURE_REASONS,
  buildAiStepMessages,
  failureOfRun,
  validateAiStepAnswer,
} from './workflow-ai-step.logic';

const user = (user_id: number) => ({ kind: 'user' as const, user_id });
const manager = { kind: 'role' as const, role_key: 'manager' };

const FIELDS: WorkflowDefinitionV1['fields'] = [
  { key: 'asunto', type: 'text', label: 'Asunto' },
  { key: 'detalle', type: 'textarea', label: 'Detalle' },
  {
    key: 'tipo',
    type: 'select',
    label: 'Tipo',
    options: [
      { value: 'peticion', label: 'Petición' },
      { value: 'queja', label: 'Queja' },
    ],
  },
  { key: 'respuesta', type: 'textarea', label: 'Respuesta' },
  { key: 'confianza', type: 'number', label: 'Confianza' },
  { key: 'resumen', type: 'text', label: 'Resumen' },
];

const aiStage = (ai: Record<string, unknown>, extra: Partial<WorkflowStageDef> = {}): WorkflowStageDef =>
  ({
    key: 'ia',
    name: 'Clasificar con IA',
    type: 'ai',
    ai: {
      task: 'classify',
      instructions: 'Clasifica la PQR.',
      inputs: ['asunto', 'detalle'],
      outputs: ['tipo'],
      ...ai,
    },
    transitions: [{ to: 'fin', on: 'auto' }],
    ...extra,
  }) as WorkflowStageDef;

const flow = (stage: WorkflowStageDef, extra: Partial<WorkflowDefinitionV1> = {}): WorkflowDefinitionV1 => ({
  schema: WORKFLOW_SCHEMA_V1,
  key: 'pqr',
  name: 'PQR',
  fields: FIELDS,
  stages: [
    {
      key: 'inicio',
      name: 'Inicio',
      type: 'form',
      start: true,
      assignee: user(1),
      form: { fields: ['asunto', 'detalle'] },
      transitions: [{ to: 'ia', on: 'submit' }],
    },
    stage,
    { key: 'fin', name: 'Fin', type: 'end', outcome: 'completed' },
    { key: 'error', name: 'Error', type: 'end', outcome: 'rejected' },
  ],
  ...extra,
});

const reviewStage = (ai: Record<string, unknown> = {}) =>
  aiStage(
    { review: true, ...ai },
    {
      assignee: manager,
      due: { hours: 72 },
      transitions: [
        { to: 'fin', on: 'approve' },
        { to: 'inicio', on: 'reject' },
      ],
    },
  );

const answer = (values: Record<string, unknown>, confidence: number | null = 0.9) => ({
  status: 'success' as const,
  content: '{}',
  json: { values, confidence, reason: 'Es una queja.' },
  model: 'modelo-x',
  tokens: { prompt: 10, completion: 5, total: 15 },
});

describe('Paso de IA — motor (P6.1)', () => {
  let kit: ReturnType<typeof buildWorkflowKit>;
  const instance = (id: number) => kit.db.table('workflow_instances').find((i) => i.id === id)!;
  const events = (id: number) => kit.db.table('workflow_instance_events').filter((e) => e.instance_id === id);
  const eventTypes = (id: number) => events(id).map((e) => e.type);
  const outbox = (kind: string) => kit.db.table('workflow_outbox').filter((r) => r.kind === kind);
  const openTasks = (id: number) =>
    kit.db.table('workflow_tasks').filter((t) => t.instance_id === id && ['open', 'claimed'].includes(t.status));

  /** Starts the flow and submits the first form: the request lands on the AI stage. */
  async function toAiStage(def: WorkflowDefinitionV1) {
    seedDefinition(kit.db, def);
    kit.as({ user_id: 1 });
    const started = await kit.engine.start({ definitionKey: def.key });
    const task = openTasks(started.instance.id)[0];
    await kit.engine.completeTask({
      taskId: task.id,
      outcome: 'submit',
      values: { asunto: 'Cobro doble', detalle: 'Me cobraron dos veces la factura de octubre.' },
      expectedRowVersion: started.instance.row_version,
    });
    return started.instance.id as number;
  }
  const aiRow = () => outbox('ai_step')[0];
  const runStep = (row = aiRow()) => kit.aiStep.execute({ ...row, payload: row.payload });
  const advance = async (id: number) => {
    const row = outbox('advance').find((r) => r.status === 'pending' && r.payload.instance_id === id)!;
    row.status = 'done';
    await kit.engine.tick(id, { expectStageEntrySeq: row.payload.stage_entry_seq });
  };

  beforeEach(() => {
    kit = buildWorkflowKit();
    seedPeople(kit.db);
  });
  afterEach(() => jest.restoreAllMocks());

  describe('al entrar', () => {
    it('encola una fila ai_step por entrada, sin llamar a la IA ni abrir tarea', async () => {
      const id = await toAiStage(flow(aiStage({})));
      expect(outbox('ai_step')).toHaveLength(1);
      expect(aiRow().payload).toMatchObject({
        instance_id: id,
        stage_key: 'ia',
        stage_entry_seq: instance(id).stage_entry_seq,
        max_attempts: 6,
      });
      expect(openTasks(id)).toHaveLength(0);
      expect(kit.aiGateway.run).not.toHaveBeenCalled();
      expect(instance(id)).toMatchObject({ current_stage_key: 'ia', stage_due_at: null });
    });

    it('max_attempts sigue a on_error.retries (reintentos + 1)', async () => {
      await toAiStage(flow(aiStage({ on_error: { retries: 1 } })));
      expect(aiRow().payload.max_attempts).toBe(2);
    });

    it('una etapa automática sigue encolando solo advance (sin ai_step)', async () => {
      const def = flow({ key: 'ia', name: 'Auto', type: 'automatic', transitions: [{ to: 'fin', on: 'auto' }] });
      await toAiStage(def);
      expect(outbox('ai_step')).toHaveLength(0);
      expect(outbox('advance')).toHaveLength(1);
    });
  });

  describe('respuesta válida', () => {
    it('sin revisión: escribe campos y confianza, deja el evento y avanza con auto', async () => {
      const id = await toAiStage(flow(aiStage({ confidence_field: 'confianza' })));
      kit.aiGateway.run.mockResolvedValue(answer({ tipo: 'queja' }, 0.92));
      await runStep();

      expect(kit.aiGateway.run).toHaveBeenCalledWith(
        expect.objectContaining({ appKey: 'workflow_ai_step', purpose: 'ai_step', definitionId: 1, instanceId: id, stageKey: 'ia' }),
      );
      expect(instance(id).data).toMatchObject({ tipo: 'queja', confianza: 0.92 });
      expect(events(id).find((e) => e.type === 'ai_step_completed')?.payload).toEqual({
        task: 'classify',
        output_keys: ['tipo'],
        confidence: 0.92,
        reason: 'Es una queja.',
        model: 'modelo-x',
        tokens: 15,
      });
      expect(instance(id).current_stage_key).toBe('ia');
      await advance(id);
      expect(instance(id)).toMatchObject({ current_stage_key: 'fin', status: 'completed' });
    });

    it('con revisión: abre una tarea review para el responsable con vencimiento desde ahora', async () => {
      const id = await toAiStage(flow(reviewStage({ task: 'draft', outputs: ['respuesta'] })));
      kit.aiGateway.run.mockResolvedValue(answer({ respuesta: 'Estimado cliente, revisaremos el cobro.' }));
      await runStep();

      const tasks = openTasks(id);
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({ kind: 'review', stage_key: 'ia', assignee_role_id: 2 });
      expect(tasks[0].due_at).toEqual(instance(id).stage_due_at);
      expect(instance(id).stage_due_at.getTime()).toBeGreaterThan(Date.now() + 71 * 3_600_000);
      expect(outbox('advance').filter((r) => r.payload.stage_key === 'ia')).toHaveLength(0);
      expect(instance(id).data.respuesta).toBe('Estimado cliente, revisaremos el cobro.');
    });

    it('el revisor edita la salida al aprobar y la solicitud sigue con su valor', async () => {
      const id = await toAiStage(flow(reviewStage({ task: 'draft', outputs: ['respuesta'] })));
      kit.aiGateway.run.mockResolvedValue(answer({ respuesta: 'Borrador de la IA' }));
      await runStep();
      kit.as({ user_id: 2 });
      const task = openTasks(id)[0];
      const done = await kit.engine.completeTask({
        taskId: task.id,
        outcome: 'approve',
        values: { respuesta: 'Respuesta corregida por la persona' },
        expectedRowVersion: instance(id).row_version,
      });
      expect(done.advanced).toBe(true);
      expect(instance(id)).toMatchObject({ current_stage_key: 'fin' });
      expect(instance(id).data.respuesta).toBe('Respuesta corregida por la persona');
    });

    it('el revisor no puede escribir campos que no son salida del paso ni usar auto', async () => {
      const id = await toAiStage(flow(reviewStage({ task: 'draft', outputs: ['respuesta'] })));
      kit.aiGateway.run.mockResolvedValue(answer({ respuesta: 'x' }));
      await runStep();
      kit.as({ user_id: 2 });
      const task = openTasks(id)[0];
      await expect(
        kit.engine.completeTask({ taskId: task.id, outcome: 'approve', values: { asunto: 'otro' }, expectedRowVersion: instance(id).row_version }),
      ).rejects.toMatchObject({ errorCode: 'WORKFLOW_FORM_INVALID' });
      await expect(
        kit.engine.completeTask({ taskId: task.id, outcome: 'auto', expectedRowVersion: instance(id).row_version }),
      ).rejects.toMatchObject({ errorCode: 'WORKFLOW_OUTCOME_INVALID' });
      const rejected = await kit.engine.completeTask({ taskId: task.id, outcome: 'reject', expectedRowVersion: instance(id).row_version });
      expect(rejected.to_stage_key).toBe('inicio');
    });

    it('decide: la rama sale del campo que escribió la IA', async () => {
      const decide = aiStage(
        { task: 'decide', outputs: ['tipo'] },
        {
          transitions: [
            { to: 'error', on: 'auto', when: { all: [{ field: 'tipo', op: 'eq', value: 'queja' }] } },
            { to: 'fin', on: 'auto' },
          ],
        },
      );
      const id = await toAiStage(flow(decide));
      kit.aiGateway.run.mockResolvedValue(answer({ tipo: 'queja' }));
      await runStep();
      await advance(id);
      expect(instance(id).current_stage_key).toBe('error');
    });

    it('extract: null deja el campo sin tocar y escribe los demás', async () => {
      const def = flow(aiStage({ task: 'extract', inputs: ['detalle'], outputs: ['resumen', 'tipo'] }));
      const id = await toAiStage(def);
      kit.aiGateway.run.mockResolvedValue(answer({ resumen: 'Cobro doble', tipo: null }));
      await runStep();
      expect(instance(id).data).toMatchObject({ resumen: 'Cobro doble' });
      expect(instance(id).data.tipo).toBeUndefined();
    });
  });

  describe('fallos: la solicitud nunca se traba', () => {
    const failedEvent = (id: number) => events(id).find((e) => e.type === 'ai_step_failed')?.payload;

    it.each([
      ['sin cupo', { status: 'skipped_quota', quota: { state: 'blocked' } }, 'quota', 'La IA no se ejecutó: el plan no tiene cupo de IA'],
      [
        'sin IA en el plan',
        { status: 'failed', error: 'x', code: 'SUBSCRIPTION_005', retryable: false },
        'not_included',
        'La IA no se ejecutó: el plan no incluye IA',
      ],
      [
        'proveedor no reintentable',
        { status: 'failed', error: 'x', code: 'AI_APP_001', retryable: false },
        'provider_error',
        'La IA no respondió tras varios intentos',
      ],
    ])('%s: ai_step_failed al instante y sigue por la política (continue)', async (_n, result, code, reason) => {
      const id = await toAiStage(flow(aiStage({})));
      kit.aiGateway.run.mockResolvedValue(result);
      await runStep();
      expect(failedEvent(id)).toMatchObject({ reason_code: code, reason });
      expect(eventTypes(id)).not.toContain('ai_step_completed');
      await advance(id);
      expect(instance(id).current_stage_key).toBe('fin');
    });

    it('alerta al dueño del flujo', async () => {
      const id = await toAiStage(flow(aiStage({})));
      kit.aiGateway.run.mockResolvedValue({ status: 'skipped_quota', quota: {} });
      await runStep();
      const alert = outbox('notify').find((r) => Array.isArray(r.payload.user_ids) && r.instance_id === id);
      expect(alert?.payload.user_ids).toEqual([1]);
      expect(alert?.payload.message).toContain('La IA no se ejecutó: el plan no tiene cupo de IA');
    });

    it('con revisión: abre la tarea para llenarlo a mano', async () => {
      const id = await toAiStage(flow(reviewStage({ task: 'draft', outputs: ['respuesta'] })));
      kit.aiGateway.run.mockResolvedValue({ status: 'skipped_quota', quota: {} });
      await runStep();
      expect(openTasks(id)).toHaveLength(1);
      kit.as({ user_id: 2 });
      const done = await kit.engine.completeTask({
        taskId: openTasks(id)[0].id,
        outcome: 'approve',
        values: { respuesta: 'Escrita a mano' },
        expectedRowVersion: instance(id).row_version,
      });
      expect(done.advanced).toBe(true);
      expect(instance(id).data.respuesta).toBe('Escrita a mano');
    });

    it('on_error.then = route: va a la etapa de error; fail: termina fallida', async () => {
      const routed = await toAiStage(flow(aiStage({ on_error: { then: 'route', route_to: 'error' } })));
      kit.aiGateway.run.mockResolvedValue({ status: 'skipped_quota', quota: {} });
      await runStep();
      expect(instance(routed)).toMatchObject({ current_stage_key: 'error' });
      expect(eventTypes(routed)).toContain('error_routed');

      kit = buildWorkflowKit();
      seedPeople(kit.db);
      const failed = await toAiStage(flow(aiStage({ on_error: { then: 'fail' } })));
      kit.aiGateway.run.mockResolvedValue({ status: 'skipped_quota', quota: {} });
      await runStep();
      expect(instance(failed).status).toBe('failed');
    });

    it('respuesta inválida: opción inexistente, clave extra o texto largo → invalid_output', async () => {
      for (const bad of [
        { tipo: 'sugerencia' },
        { tipo: 'queja', extra: 'x' },
        {},
        { tipo: 5 },
      ]) {
        kit = buildWorkflowKit();
        seedPeople(kit.db);
        const id = await toAiStage(flow(aiStage({})));
        kit.aiGateway.run.mockResolvedValue(answer(bad));
        await runStep();
        expect(failedEvent(id)).toMatchObject({
          reason_code: 'invalid_output',
          reason: 'La respuesta de la IA no fue válida',
        });
        expect(instance(id).data.tipo).toBeUndefined();
      }
      kit = buildWorkflowKit();
      seedPeople(kit.db);
      const long = await toAiStage(flow(aiStage({ task: 'summarize', outputs: ['resumen'] })));
      kit.aiGateway.run.mockResolvedValue(answer({ resumen: 'x'.repeat(301) }));
      await runStep();
      expect(failedEvent(long)).toMatchObject({ reason_code: 'invalid_output' });
    });

    it('fallo reintentable: lanza para que el outbox reintente con backoff y no escribe nada', async () => {
      const id = await toAiStage(flow(aiStage({})));
      kit.aiGateway.run.mockResolvedValue({ status: 'failed', error: 'timeout', code: null, retryable: true });
      await expect(runStep()).rejects.toThrow('timeout');
      expect(eventTypes(id)).not.toContain('ai_step_failed');
      expect(instance(id).current_stage_key).toBe('ia');
    });

    it('al agotar los intentos (onDead) degrada con provider_error, una sola vez', async () => {
      const id = await toAiStage(flow(aiStage({})));
      const row = aiRow();
      await kit.aiStep.onDead({ ...row, payload: row.payload });
      await kit.aiStep.onDead({ ...row, payload: row.payload });
      expect(events(id).filter((e) => e.type === 'ai_step_failed')).toHaveLength(1);
      expect(failedEvent(id)).toMatchObject({ reason_code: 'provider_error' });
      expect(outbox('advance').filter((r) => r.payload.stage_key === 'ia')).toHaveLength(1);
    });
  });

  describe('idempotencia y aislamiento', () => {
    it('una entrega repetida no vuelve a llamar a la IA ni duplica el resultado', async () => {
      const id = await toAiStage(flow(aiStage({})));
      kit.aiGateway.run.mockResolvedValue(answer({ tipo: 'queja' }));
      await runStep();
      await runStep();
      expect(kit.aiGateway.run).toHaveBeenCalledTimes(1);
      expect(events(id).filter((e) => e.type === 'ai_step_completed')).toHaveLength(1);
      expect(outbox('advance').filter((r) => r.payload.stage_key === 'ia')).toHaveLength(1);
    });

    it('si la solicitud ya salió de esa entrada del paso no llama a la IA', async () => {
      const id = await toAiStage(flow(aiStage({})));
      const row = aiRow();
      instance(id).stage_entry_seq += 1;
      await kit.aiStep.execute({ ...row, payload: row.payload });
      kit.aiGateway.run.mockClear();
      instance(id).status = 'cancelled';
      await kit.aiStep.execute({ ...row, payload: { ...row.payload, stage_entry_seq: instance(id).stage_entry_seq } });
      expect(kit.aiGateway.run).not.toHaveBeenCalled();
    });

    it('una fila de otra tienda no toca la solicitud ajena', async () => {
      const id = await toAiStage(flow(aiStage({})));
      kit.as({ store_id: 2, organization_id: 1 });
      await kit.aiStep.execute({ ...aiRow(), store_id: 2, payload: aiRow().payload });
      expect(kit.aiGateway.run).not.toHaveBeenCalled();
      expect(eventTypes(id)).not.toContain('ai_step_completed');
    });
  });
});

describe('Paso de IA — mensaje y validación (una sola implementación)', () => {
  const def = flow(aiStage({ confidence_field: 'confianza' }));
  const stage = def.stages[1];

  it('arma el mensaje del prompt sembrado: tarea, instrucciones, entradas con valor y salidas con opciones', () => {
    const [msg] = buildAiStepMessages(def, stage, { asunto: 'Cobro doble', otro: 'no declarado' });
    expect(msg.role).toBe('user');
    expect(JSON.parse(msg.content as string)).toEqual({
      task: 'classify',
      instructions: 'Clasifica la PQR.',
      inputs: {
        asunto: { label: 'Asunto', type: 'text', value: 'Cobro doble' },
        detalle: { label: 'Detalle', type: 'textarea', value: null },
      },
      outputs: { tipo: { label: 'Tipo', type: 'select', options: ['peticion', 'queja'] } },
    });
  });

  it('valida: acota la confianza a 0..1 y recorta el motivo', () => {
    const ok = validateAiStepAnswer(def, stage, { values: { tipo: 'queja' }, confidence: 7, reason: 'r'.repeat(500) });
    expect(ok).toMatchObject({ ok: true, answer: { values: { tipo: 'queja' }, confidence: 1 } });
    expect(ok.ok && ok.answer.reason).toHaveLength(300);
    expect(validateAiStepAnswer(def, stage, { values: { tipo: 'queja' } })).toMatchObject({
      ok: true,
      answer: { confidence: null, reason: null },
    });
  });

  it('rechaza lo que no es objeto, sin values o con tipos no coercibles', () => {
    expect(validateAiStepAnswer(def, stage, null).ok).toBe(false);
    expect(validateAiStepAnswer(def, stage, 'queja').ok).toBe(false);
    expect(validateAiStepAnswer(def, stage, { values: [] }).ok).toBe(false);
    const number = flow(aiStage({ task: 'extract', outputs: ['confianza'], inputs: ['asunto'] }));
    expect(validateAiStepAnswer(number, number.stages[1], { values: { confianza: 'mucho' } }).ok).toBe(false);
    expect(validateAiStepAnswer(number, number.stages[1], { values: { confianza: '0.5' } })).toMatchObject({
      ok: true,
      answer: { values: { confianza: 0.5 } },
    });
  });

  it('traduce el resultado del gateway al motivo en español', () => {
    expect(failureOfRun({ status: 'skipped_quota', quota: {} as any }).reason).toBe(AI_STEP_FAILURE_REASONS.quota);
    expect(failureOfRun({ status: 'failed', error: 'x', code: 'SUBSCRIPTION_005', retryable: false }).reason_code).toBe(
      'not_included',
    );
    expect(failureOfRun({ status: 'failed', error: 'x', code: null, retryable: false }).reason_code).toBe('provider_error');
  });

  it('el paso con revisión edita solo sus salidas; sin revisión no hay formulario', () => {
    expect(stageFormKeys(reviewStage({ outputs: ['respuesta'] }))).toEqual(['respuesta']);
    expect(stageFormKeys(stage)).toEqual([]);
  });
});
