import { DebugEvent } from '../../interfaces/workflow-debug.interfaces';
import { actorLabel, formatValue, hasCapture, stageText, variableRows } from './instance-debugger.utils';

const event = (patch: Partial<DebugEvent> = {}): DebugEvent => ({
  seq: 1,
  type: 'transitioned',
  from_stage_key: 'a',
  to_stage_key: 'b',
  actor_type: 'user',
  actor_id: 4,
  occurred_at: '2026-11-07T10:00:00Z',
  payload: {},
  data_snapshot: null,
  changes: [],
  ...patch,
});

describe('instance debugger utils', () => {
  it('formatValue: vacíos, booleanos y objetos', () => {
    expect(formatValue(null)).toBe('—');
    expect(formatValue('')).toBe('—');
    expect(formatValue(true)).toBe('Sí');
    expect(formatValue(0)).toBe('0');
    expect(formatValue({ a: 1 })).toBe('{"a":1}');
  });

  it('variableRows marca lo que cambió con su valor anterior y ordena por clave', () => {
    const rows = variableRows(
      event({
        data_snapshot: { monto: 30, nota: 'ok', aprobado: false },
        changes: [
          { key: 'monto', before: 10, after: 30 },
          { key: 'nota', before: null, after: 'ok' },
        ],
      }),
    );
    expect(rows).toEqual([
      { key: 'aprobado', value: 'No', changed: false, before: null },
      { key: 'monto', value: '30', changed: true, before: '10' },
      { key: 'nota', value: 'ok', changed: true, before: '—' },
    ]);
  });

  it('variableRows incluye las claves que el evento quitó', () => {
    const rows = variableRows(
      event({ data_snapshot: { a: 1 }, changes: [{ key: 'b', before: 2, after: null }] }),
    );
    expect(rows.find((r) => r.key === 'b')).toEqual({ key: 'b', value: '—', changed: true, before: '2' });
  });

  it('un evento antiguo no tiene captura ni filas', () => {
    expect(hasCapture(event())).toBe(false);
    expect(variableRows(event())).toEqual([]);
    expect(hasCapture(event({ data_snapshot: {} }))).toBe(true);
  });

  it('actorLabel y stageText', () => {
    expect(actorLabel(event({ actor_type: 'system', actor_id: null }))).toBe('Sistema');
    expect(actorLabel(event())).toBe('Usuario #4');
    expect(actorLabel(event({ actor_name: 'Ana Ruiz' }))).toBe('Ana Ruiz');
    expect(actorLabel(event({ actor_type: 'public', actor_id: null }))).toBe('Solicitante externo');
    expect(stageText(event(), { a: 'Solicitud', b: 'Jefe' })).toBe('Solicitud → Jefe');
    expect(stageText(event({ from_stage_key: 'b' }), {})).toBe('b');
    expect(stageText(event({ from_stage_key: null, to_stage_key: null }), {})).toBe('—');
  });
});
