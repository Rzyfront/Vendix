import { WorkflowAiDef, WorkflowDefinitionV1, WorkflowFieldDef, WorkflowStageDef } from '../../../../../shared/workflows/contract/workflow-contract';
import { validateWorkflowDefinition } from '../../../../../shared/workflows/contract/workflow-validator';
import {
  conditionFieldOptions,
  describeWait,
  STAGE_TYPE_ICON,
  STAGE_TYPE_LABEL,
  retypeStage,
  stageFieldsOf,
  tabForIssue,
  tabsForStage,
  withStagePositions,
} from './workflow-editor.utils';

const fields: WorkflowFieldDef[] = [{ key: 'monto', type: 'money', label: 'Monto' }];

describe('workflow-editor.utils — paso de IA (P6)', () => {
  const stage: WorkflowStageDef = {
    key: 'pedir',
    name: 'Pedir',
    type: 'form',
    assignee: { kind: 'initiator' },
    form: { fields: ['monto'] },
    transitions: [{ on: 'submit', to: 'fin' }],
  };

  it('el paso de IA tiene etiqueta e icono', () => {
    expect(STAGE_TYPE_LABEL.ai).toBe('Paso de IA');
    expect(STAGE_TYPE_ICON.ai).toBe('sparkles');
  });

  it('cambiar a IA deja la configuración por defecto sin responsable ni formulario', () => {
    const next = retypeStage(stage, 'ai', fields);
    expect(next.ai).toEqual({ task: 'classify', instructions: '', inputs: [], outputs: [] });
    expect(next.assignee).toBeUndefined();
    expect(next.form).toBeUndefined();
    expect(next.transitions).toEqual([]);
  });

  it('al salir de IA con revisión se conservan solo las transiciones del nuevo tipo', () => {
    const reviewed: WorkflowStageDef = {
      key: 'ia',
      name: 'IA',
      type: 'ai',
      ai: { task: 'draft', instructions: 'x', inputs: ['a'], outputs: ['b'], review: true },
      assignee: { kind: 'initiator' },
      transitions: [{ on: 'approve', to: 'fin' }, { on: 'reject', to: 'fin' }],
    };
    const approval = retypeStage(reviewed, 'approval', fields);
    expect(approval.ai).toBeUndefined();
    expect(approval.transitions?.length).toBe(2);
    expect(retypeStage(reviewed, 'form', fields).transitions).toEqual([]);
  });

  it('las pestañas del paso de IA: sin formulario ni requisitos, con responsable y plazo solo con revisión', () => {
    const plain = tabsForStage('ai').map((t) => t.id);
    expect(plain).toContain('config');
    expect(plain).toContain('transitions');
    expect(plain).not.toContain('form');
    expect(plain).not.toContain('requirements');
    expect(plain).not.toContain('assignee');
    expect(plain).not.toContain('due');
    const reviewed = tabsForStage('ai', true).map((t) => t.id);
    expect(reviewed).toContain('assignee');
    expect(reviewed).toContain('due');
  });

  it('los errores del paso de IA llevan a la pestaña Configuración', () => {
    expect(tabForIssue({ code: 'AI_STEP_INVALID', path: 'stages[0].ai.outputs', message: '' })).toBe('config');
  });

  it('los campos de un paso de IA con revisión son sus salidas', () => {
    const def = {
      fields: [{ key: 'respuesta', type: 'textarea', label: 'Respuesta' }],
    } as unknown as WorkflowDefinitionV1;
    const aiDef: WorkflowAiDef = { task: 'draft', instructions: 'x', inputs: ['a'], outputs: ['respuesta'], review: true };
    const ai: WorkflowStageDef = { key: 'ia', name: 'IA', type: 'ai', ai: aiDef };
    expect(stageFieldsOf(def, ai).map((f) => f.key)).toEqual(['respuesta']);
    expect(stageFieldsOf(def, { ...ai, ai: { ...aiDef, review: false } })).toEqual([]);
  });
});

describe('workflow-editor.utils — etapas del motor avanzado (P2)', () => {
  const form: WorkflowStageDef = {
    key: 'pedir',
    name: 'Pedir',
    type: 'form',
    assignee: { kind: 'initiator' },
    form: { fields: ['monto'] },
    transitions: [{ on: 'submit', to: 'fin' }],
  };

  it('cambiar a Paralelo quita responsable y formulario y deja dos ramas con unión "todas"', () => {
    const next = retypeStage(form, 'parallel', fields);
    expect(next.type).toBe('parallel');
    expect(next.assignee).toBeUndefined();
    expect(next.form).toBeUndefined();
    expect(next.parallel?.branches.length).toBe(2);
    expect(next.parallel?.join).toBe('all');
    expect(next.transitions).toEqual([]);
  });

  it('cambiar a Bucle pone un límite de vueltas y quita la configuración de otro tipo', () => {
    const wait = retypeStage(form, 'wait', fields);
    expect(wait.wait).toEqual({ kind: 'duration', days: 1 });
    const loop = retypeStage(wait, 'loop', fields);
    expect(loop.wait).toBeUndefined();
    expect(loop.loop?.max_iterations).toBe(3);
  });

  it('volver a Formulario devuelve el responsable por defecto y no deja configuración de motor', () => {
    const back = retypeStage(retypeStage(form, 'subflow', fields), 'form', fields);
    expect(back.subflow).toBeUndefined();
    expect(back.assignee).toEqual({ kind: 'initiator' });
  });

  it('la pestaña Configuración solo existe en los tipos del motor', () => {
    expect(tabsForStage('parallel').some((t) => t.id === 'config')).toBeTrue();
    expect(tabsForStage('form').some((t) => t.id === 'config')).toBeFalse();
    expect(tabsForStage('form').some((t) => t.id === 'guards')).toBeTrue();
    // A parallel stage assigns per branch: no stage assignee, form or deadline.
    expect(tabsForStage('parallel').map((t) => t.id)).not.toContain('assignee');
    expect(tabsForStage('wait').map((t) => t.id)).not.toContain('form');
    expect(tabsForStage('approval').map((t) => t.id)).toContain('assignee');
  });

  it('los errores de guardas y del motor llevan a su pestaña', () => {
    expect(tabForIssue({ code: 'X', path: 'stages[0].guards[0].message', message: '' })).toBe('guards');
    expect(tabForIssue({ code: 'X', path: 'stages[1].loop.max_iterations', message: '' })).toBe('config');
    expect(tabForIssue({ code: 'X', path: 'stages[1].on_submit[0]', message: '' })).toBe('actions');
  });

  it('describe la espera en palabras', () => {
    expect(describeWait({ kind: 'duration', days: 3 }, fields)).toBe('Espera 3 días');
    expect(describeWait({ kind: 'business_days', days: 2, time: '08:00' }, fields)).toContain('2 días hábiles a las 08:00');
    expect(describeWait({ kind: 'day_of_month', day: 5 }, fields)).toContain('día 5 del mes');
  });
});

describe('workflow-editor.utils — selector de campos de la condición (P5.3)', () => {
  it('agrupa los campos del formulario y los calculados con su tipo legible', () => {
    const options = conditionFieldOptions([
      { key: 'monto', type: 'money', label: 'Monto' },
      { key: 'iva', type: 'money', label: 'IVA', compute: 'monto * 0.19' },
      { key: 'urgente', type: 'boolean', label: 'Urgente' },
    ]);
    expect(options.map((o) => o.label)).toEqual([
      '— Formulario —',
      'Monto · Dinero',
      'Urgente · Sí / no',
      '— Calculados —',
      'IVA · Dinero',
    ]);
    expect(options.filter((o) => o.disabled).map((o) => o.value)).toEqual(['__group__form', '__group__computed']);
  });

  it('omite el grupo que no tiene campos', () => {
    expect(conditionFieldOptions([])).toEqual([]);
    expect(conditionFieldOptions([{ key: 'a', type: 'text', label: 'A' }]).length).toBe(2);
  });
});

describe('workflow-editor.utils — posiciones del lienzo (P5.1)', () => {
  const stages: WorkflowStageDef[] = [
    { key: 'a', name: 'A', type: 'form', start: true, assignee: { kind: 'initiator' }, transitions: [{ on: 'submit', to: 'b' }] },
    { key: 'b', name: 'B', type: 'end', outcome: 'completed' },
  ];

  it('guarda solo x e y en ui, aunque la posición traiga otras claves (arrastre de un paso)', () => {
    const dragged = { key: 'a', x: 232, y: 256 };
    const out = withStagePositions(stages, { a: dragged });
    expect(out[0].ui).toEqual({ x: 232, y: 256 });
    expect(out[1]).toBe(stages[1]);
    expect(validateWorkflowDefinition({
      schema: 'vendix.workflow/v1',
      key: 'k',
      name: 'K',
      fields: [],
      stages: out,
    }).valid).toBeTrue();
  });
});
