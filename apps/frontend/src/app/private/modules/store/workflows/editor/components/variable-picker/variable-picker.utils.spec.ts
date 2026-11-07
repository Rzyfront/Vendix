import { WorkflowFieldDef } from '../../../../../../../shared/workflows/contract/workflow-contract';
import { buildVariableGroups, filterVariableGroups, insertAtCursor } from './variable-picker.utils';

const fields: WorkflowFieldDef[] = [
  { key: 'monto', type: 'money', label: 'Monto' },
  { key: 'iva', type: 'money', label: 'IVA', compute: 'monto * 0.19' },
  { key: 'adjunto', type: 'file', label: 'Soporte' },
  { key: 'areas', type: 'multiselect', label: 'Áreas', options: [{ value: 'a', label: 'A' }] },
];

describe('variable-picker.utils', () => {
  describe('buildVariableGroups', () => {
    it('groups form fields, computed fields and request tokens', () => {
      const groups = buildVariableGroups(fields);
      expect(groups.map((g) => g.label)).toEqual(['Formulario', 'Calculados', 'Solicitud']);
      expect(groups[0].options).toEqual([{ token: '{{fields.monto}}', label: 'Monto', hint: 'Dinero' }]);
      expect(groups[1].options[0].hint).toBe('Calculado · Dinero');
      expect(groups[2].options.map((o) => o.token)).toContain('{{instance.reference}}');
      expect(groups[2].options.find((o) => o.token === '{{instance.reference}}')?.label).toBe(
        'Referencia de la solicitud',
      );
    });

    it('does not offer file or multi-select fields (they never resolve)', () => {
      const tokens = buildVariableGroups(fields).flatMap((g) => g.options.map((o) => o.token));
      expect(tokens).not.toContain('{{fields.adjunto}}');
      expect(tokens).not.toContain('{{fields.areas}}');
    });

    it('adds the Evento group only when events are given, without duplicates', () => {
      expect(buildVariableGroups(fields).some((g) => g.id === 'event')).toBeFalse();
      const groups = buildVariableGroups(fields, ['order.created', 'order.created']);
      const event = groups.find((g) => g.id === 'event');
      expect(event).toBeDefined();
      const tokens = event?.options.map((o) => o.token) ?? [];
      expect(tokens.length).toBeGreaterThan(0);
      expect(tokens.every((t) => t.startsWith('{{event.'))).toBeTrue();
      expect(new Set(tokens).size).toBe(tokens.length);
    });

    it('drops empty groups', () => {
      expect(buildVariableGroups([]).map((g) => g.id)).toEqual(['instance']);
    });
  });

  it('filterVariableGroups matches label, hint and token', () => {
    const groups = buildVariableGroups(fields);
    expect(filterVariableGroups(groups, 'monto').flatMap((g) => g.options.map((o) => o.token))).toEqual(['{{fields.monto}}']);
    expect(filterVariableGroups(groups, 'calculado')[0].options[0].token).toBe('{{fields.iva}}');
    expect(filterVariableGroups(groups, 'zzz')).toEqual([]);
    expect(filterVariableGroups(groups, '  ').length).toBe(groups.length);
  });

  describe('insertAtCursor', () => {
    it('inserts at the caret', () => {
      expect(insertAtCursor('Hola , listo', '{{instance.reference}}', 5, 5)).toEqual({
        text: 'Hola {{instance.reference}}, listo',
        caret: 5 + '{{instance.reference}}'.length,
      });
    });

    it('replaces the selection', () => {
      expect(insertAtCursor('Hola XXX', '{{a}}', 5, 8).text).toBe('Hola {{a}}');
    });

    it('appends when the position is missing or out of range', () => {
      expect(insertAtCursor('abc', '{{a}}', null, null)).toEqual({ text: 'abc{{a}}', caret: 8 });
      expect(insertAtCursor('abc', '{{a}}', 99, 120).text).toBe('abc{{a}}');
      expect(insertAtCursor('', '{{a}}', undefined, undefined).text).toBe('{{a}}');
    });

    it('handles an inverted selection by collapsing it to the start', () => {
      expect(insertAtCursor('abcdef', 'X', 4, 2).text).toBe('abcdXef');
    });
  });
});
