import {
  WORKFLOW_SCHEMA_V1,
  isHumanStage,
  stageFormKeys,
  stageOutcomes,
  validateFormValues,
  validateWorkflowDefinition,
} from './index';

const role = { kind: 'role', role_key: 'admin' };

/** start (form) → ai stage under test → fin. */
const flow = (ai: Record<string, unknown>, stageExtra: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): any => ({
  schema: WORKFLOW_SCHEMA_V1,
  key: 'pqr',
  name: 'PQR',
  fields: [
    { key: 'asunto', type: 'text', label: 'Asunto' },
    { key: 'detalle', type: 'textarea', label: 'Detalle' },
    { key: 'adjunto', type: 'file', label: 'Adjunto' },
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
    { key: 'doble', type: 'number', label: 'Doble', compute: 'confianza * 2' },
  ],
  stages: [
    {
      key: 'inicio',
      name: 'Inicio',
      type: 'form',
      start: true,
      assignee: role,
      form: { fields: ['asunto', 'detalle'] },
      transitions: [{ to: 'ia', on: 'submit' }],
    },
    {
      key: 'ia',
      name: 'Clasificar',
      type: 'ai',
      ai: { task: 'classify', instructions: 'Clasifica la PQR.', inputs: ['asunto', 'detalle'], outputs: ['tipo'], ...ai },
      transitions: [{ to: 'fin', on: 'auto' }],
      ...stageExtra,
    },
    { key: 'fin', name: 'Fin', type: 'end', outcome: 'completed' },
  ],
  ...extra,
});
const codes = (d: any) => validateWorkflowDefinition(d).errors.map((e) => e.code);
const messages = (d: any) => validateWorkflowDefinition(d).errors.map((e) => e.message);
const review = { review: true };
const reviewStage = {
  assignee: role,
  transitions: [{ to: 'fin', on: 'approve' }, { to: 'inicio', on: 'reject' }],
};

describe('P6 validator — ai stage (P6.1)', () => {
  it('accepts classify without review (auto) and with review (approve/reject)', () => {
    expect(codes(flow({}))).toEqual([]);
    expect(codes(flow({ ...review }, reviewStage))).toEqual([]);
    expect(codes(flow({ confidence_field: 'confianza' }))).toEqual([]);
  });

  it('rejects a stage type "ai" without its configuration', () => {
    const d = flow({});
    delete d.stages[1].ai;
    expect(codes(d)).toContain('AI_STEP_INVALID');
  });

  it('rejects ai on a non-ai stage and unknown keys inside ai', () => {
    const d = flow({});
    d.stages[0].ai = { task: 'classify' };
    expect(codes(d)).toContain('SHAPE_INVALID');
    expect(codes(flow({ extra: 1 }))).toContain('SHAPE_INVALID');
  });

  it('checks the task, the instructions and the lists of fields', () => {
    expect(codes(flow({ task: 'translate' }))).toContain('AI_STEP_INVALID');
    expect(codes(flow({ instructions: '  ' }))).toContain('AI_STEP_INVALID');
    expect(codes(flow({ instructions: 'x'.repeat(2001) }))).toContain('AI_STEP_INVALID');
    expect(codes(flow({ inputs: [] }))).toContain('AI_STEP_INVALID');
    expect(codes(flow({ inputs: ['asunto', 'asunto'] }))).toContain('AI_STEP_INVALID');
    expect(codes(flow({ inputs: ['nada'] }))).toContain('FIELD_UNKNOWN');
    expect(codes(flow({ outputs: [] }))).toContain('AI_STEP_INVALID');
    expect(codes(flow({ outputs: ['tipo', 'respuesta'] }))).toContain('AI_STEP_INVALID');
  });

  it('does not let the AI read file or user fields, nor write what it reads or what is calculated', () => {
    expect(codes(flow({ inputs: ['adjunto'] }))).toContain('AI_STEP_INVALID');
    expect(codes(flow({ inputs: ['tipo', 'detalle'] }))).toContain('AI_STEP_INVALID');
    expect(messages(flow({ task: 'extract', outputs: ['doble'] })).join(' ')).toContain('calculado');
  });

  it('limits the output type per task', () => {
    expect(codes(flow({ task: 'classify', outputs: ['respuesta'] }))).toContain('AI_STEP_INVALID');
    expect(codes(flow({ task: 'draft', outputs: ['respuesta'] }))).toEqual([]);
    expect(codes(flow({ task: 'draft', outputs: ['tipo'] }))).toContain('AI_STEP_INVALID');
    expect(codes(flow({ task: 'summarize', outputs: ['respuesta'] }))).toEqual([]);
    expect(codes(flow({ task: 'extract', outputs: ['tipo', 'respuesta'], inputs: ['asunto'] }))).toEqual([]);
    expect(codes(flow({ task: 'extract', outputs: ['adjunto'] }))).toContain('AI_STEP_INVALID');
  });

  it('requires the confidence field to be a number apart from the others', () => {
    expect(codes(flow({ confidence_field: 'asunto' }))).toContain('AI_STEP_INVALID');
    expect(codes(flow({ confidence_field: 'nada' }))).toContain('FIELD_UNKNOWN');
    expect(codes(flow({ confidence_field: 'doble' }))).toContain('AI_STEP_INVALID');
  });

  it('applies the error policy rules of actions to on_error', () => {
    expect(codes(flow({ on_error: { retries: 9 } }))).toContain('ERROR_POLICY_INVALID');
    expect(codes(flow({ on_error: { then: 'route' } }))).toContain('ERROR_POLICY_INVALID');
    expect(codes(flow({ on_error: { retries: 1, then: 'route', route_to: 'fin' } }))).toEqual([]);
  });

  it('without review there is no assignee, due, form, quorum or requirements', () => {
    expect(codes(flow({}, { assignee: role }))).toContain('ASSIGNEE_NOT_ALLOWED');
    expect(codes(flow({}, { due: { hours: 4 } }))).toContain('SHAPE_INVALID');
    expect(codes(flow({}, { form: { fields: ['tipo'] } }))).toContain('SHAPE_INVALID');
    expect(codes(flow({}, { quorum: { required: 2 } }))).toContain('QUORUM_INVALID');
    expect(codes(flow({}, { requirements: [] }))).toContain('SHAPE_INVALID');
  });

  it('with review the assignee is required, due is allowed, form and quorum are not', () => {
    expect(codes(flow({ ...review }, { transitions: reviewStage.transitions }))).toContain('ASSIGNEE_MISSING');
    expect(codes(flow({ ...review }, { ...reviewStage, due: { hours: 72 } }))).toEqual([]);
    expect(codes(flow({ ...review }, { ...reviewStage, form: { fields: ['tipo'] } }))).toContain('SHAPE_INVALID');
    expect(codes(flow({ ...review }, { ...reviewStage, quorum: { required: 2 } }))).toContain('QUORUM_INVALID');
    expect(codes(flow({ ...review }, { ...reviewStage, requirements: [] }))).toContain('SHAPE_INVALID');
  });

  it('only resolves auto without review and approve/reject with review', () => {
    expect(codes(flow({}, { transitions: [{ to: 'fin', on: 'auto' }, { to: 'fin', on: 'approve' }] }))).toContain(
      'OUTCOME_INVALID',
    );
    expect(codes(flow({}, { transitions: [{ to: 'fin', on: 'submit' }] }))).toContain('OUTCOME_INVALID');
    expect(codes(flow({ ...review }, { ...reviewStage, transitions: [{ to: 'fin', on: 'auto' }] }))).toContain(
      'OUTCOME_INVALID',
    );
    expect(codes(flow({}, { transitions: [] }))).toContain('DEFAULT_BRANCH_MISSING');
    expect(codes(flow({ ...review }, { ...reviewStage, transitions: [{ to: 'fin', on: 'reject' }] }))).toContain(
      'DEFAULT_BRANCH_MISSING',
    );
  });

  it('decide needs a branch on its output field plus a default', () => {
    const decide = { task: 'decide', outputs: ['tipo'] };
    expect(codes(flow(decide))).toContain('AI_STEP_INVALID');
    const branched = {
      transitions: [
        { to: 'inicio', on: 'auto', when: { all: [{ field: 'tipo', op: 'eq', value: 'queja' }] } },
        { to: 'fin', on: 'auto' },
      ],
    };
    expect(codes(flow(decide, branched))).toEqual([]);
    const noDefault = { transitions: [branched.transitions[0]] };
    expect(codes(flow(decide, noDefault))).toContain('DEFAULT_BRANCH_MISSING');
    const wrongField = {
      transitions: [
        { to: 'inicio', on: 'auto', when: { all: [{ field: 'asunto', op: 'is_not_empty' }] } },
        { to: 'fin', on: 'auto' },
      ],
    };
    expect(codes(flow(decide, wrongField))).toContain('AI_STEP_INVALID');
    const reviewed = {
      ...reviewStage,
      transitions: [
        { to: 'inicio', on: 'approve', when: { all: [{ field: 'tipo', op: 'eq', value: 'queja' }] } },
        { to: 'fin', on: 'approve' },
        { to: 'inicio', on: 'reject' },
      ],
    };
    expect(codes(flow({ ...decide, ...review }, reviewed))).toEqual([]);
  });

  it('a route target of on_error counts as a graph edge (reachable)', () => {
    const d = flow({ on_error: { then: 'route', route_to: 'extra' } });
    d.stages.push({ key: 'extra', name: 'Extra', type: 'end', outcome: 'rejected' });
    expect(codes(d)).toEqual([]);
  });

  it('a cycle of ai stages without review is an automatic loop; with review it is not', () => {
    const d = flow({});
    d.stages[1].transitions = [{ to: 'ia2', on: 'auto' }];
    d.stages.push({
      key: 'ia2',
      name: 'Otra',
      type: 'ai',
      ai: { task: 'classify', instructions: 'x', inputs: ['asunto'], outputs: ['tipo'] },
      transitions: [{ to: 'ia', on: 'auto' }, { to: 'fin', on: 'auto', when: { all: [{ field: 'tipo', op: 'eq', value: 'queja' }] } }],
    });
    expect(codes(d)).toContain('AUTOMATIC_LOOP');
  });

  it('runtime helpers: outcomes, human flag and form keys follow review', () => {
    const plain: any = { key: 'a', name: 'A', type: 'ai', ai: { task: 'classify', instructions: 'x', inputs: ['asunto'], outputs: ['tipo'] } };
    const reviewed: any = { ...plain, ai: { ...plain.ai, review: true } };
    expect(stageOutcomes(plain)).toEqual(['auto']);
    expect(stageOutcomes(reviewed)).toEqual(['approve', 'reject']);
    expect(isHumanStage(plain)).toBe(false);
    expect(isHumanStage(reviewed)).toBe(true);
    expect(stageFormKeys(plain)).toEqual([]);
    expect(stageFormKeys(reviewed)).toEqual(['tipo']);
    expect(stageOutcomes({ key: 'f', name: 'F', type: 'form' } as any)).toEqual(['submit']);
  });

  it('a reviewer edits only the outputs of the stage, validated like a form', () => {
    const def: any = flow({ ...review }, reviewStage);
    const stage = def.stages[1];
    expect(validateFormValues(def, stage, { tipo: 'queja' })).toMatchObject({ ok: true, values: { tipo: 'queja' } });
    expect(validateFormValues(def, stage, { tipo: 'otra' }).ok).toBe(false);
    expect(validateFormValues(def, stage, { asunto: 'x' }).ok).toBe(false);
  });
});
