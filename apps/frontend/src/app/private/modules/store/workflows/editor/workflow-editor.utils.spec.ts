import { WorkflowFieldDef, WorkflowStageDef } from '../../../../../shared/workflows/contract/workflow-contract';
import { describeWait, retypeStage, tabForIssue, tabsForStage } from './workflow-editor.utils';

const fields: WorkflowFieldDef[] = [{ key: 'monto', type: 'money', label: 'Monto' }];

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
