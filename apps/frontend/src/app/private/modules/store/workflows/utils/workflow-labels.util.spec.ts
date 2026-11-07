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
      'action_retried', 'error_routed', 'migrated',
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
