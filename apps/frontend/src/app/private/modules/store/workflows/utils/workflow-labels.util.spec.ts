import { countdownText, eventDescription, eventLabel, outcomeLabel } from './workflow-labels.util';

describe('workflow-labels.util — motor avanzado (P2)', () => {
  it('rotula los resultados nuevos en español', () => {
    expect(outcomeLabel('joined')).toBe('Unir ramas');
    expect(outcomeLabel('elapsed')).toBe('Espera cumplida');
    expect(outcomeLabel('continue')).toBe('Otra vuelta');
    expect(outcomeLabel('done')).toBe('Terminado');
  });

  it('rotula cada evento nuevo de la línea de tiempo', () => {
    for (const type of [
      'branch_completed', 'joined', 'subflow_started', 'subflow_closed', 'subflow_failed', 'waiting',
      'loop_iteration', 'loop_done', 'guard_redirected', 'guard_blocked', 'action_failed',
      'action_executed', 'action_retried', 'error_routed', 'migrated',
    ]) {
      expect(eventLabel(type)).not.toBe(type);
    }
  });

  it('describe la vuelta, la rama, el subflujo y la migración con sus datos', () => {
    expect(eventDescription('loop_iteration', { iteration: 1, max: 3 })).toBe('Vuelta 1 de 3');
    expect(eventDescription('branch_completed', { branch_name: 'TI', done: 2, total: 3 })).toBe(
      'Rama completada: TI (2 de 3)',
    );
    expect(eventDescription('subflow_started', { child_reference: 'FLU-12', flow_key: 'alta' })).toContain('FLU-12');
    expect(eventDescription('migrated', { from_version: 1, to_version: 2 })).toBe('Migrada de v1 a v2');
    // A manual retry only re-queues the action: it is not "executed" yet.
    expect(eventDescription('action_retried', { action: 'vendix.crm_task.create' })).toBe(
      'Acción reenviada: vendix.crm_task.create',
    );
    expect(eventDescription('guard_redirected', { message: 'Excede el presupuesto' })).toBe(
      'Redirigida por guarda: Excede el presupuesto',
    );
    expect(eventDescription('started', { via: 'schedule' })).toContain('Programación');
  });

  it('la cuenta regresiva dice días y horas, y "Ya venció" al llegar a cero', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    expect(countdownText('2026-01-03T23:30:00Z', now)).toBe('2 d 23 h');
    expect(countdownText('2026-01-01T05:10:00Z', now)).toBe('5 h 10 min');
    expect(countdownText('2025-12-31T23:59:00Z', now)).toBe('Ya venció');
  });
});

describe('workflow-labels.util — paso de IA (P6)', () => {
  it('rotula los dos eventos del paso de IA', () => {
    expect(eventLabel('ai_step_completed')).toBe('Paso de IA completado');
    expect(eventLabel('ai_step_failed')).toBe('Paso de IA fallido');
  });

  it('un paso completado dice la tarea y la confianza en porcentaje', () => {
    expect(eventDescription('ai_step_completed', { task: 'classify', confidence: 0.824 })).toBe(
      'Paso de IA completado: clasificó (confianza 82 %)',
    );
    expect(eventDescription('ai_step_completed', { task: 'draft', confidence: null })).toBe(
      'Paso de IA completado: redactó',
    );
    expect(eventDescription('ai_step_completed', null)).toBe('Paso de IA completado');
  });

  it('un paso fallido dice el motivo', () => {
    expect(
      eventDescription('ai_step_failed', { task: 'classify', reason_code: 'quota', reason: 'La IA no se ejecutó: el plan no tiene cupo de IA' }),
    ).toBe('Paso de IA fallido: La IA no se ejecutó: el plan no tiene cupo de IA');
    expect(eventDescription('ai_step_failed', {})).toBe('Paso de IA fallido');
  });
});
