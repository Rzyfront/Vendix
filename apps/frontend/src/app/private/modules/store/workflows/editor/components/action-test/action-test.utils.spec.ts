import { WorkflowActionDef } from '../../../../../../../shared/workflows/contract/workflow-contract';
import { previewValue, referencedFieldKeys, runsForReal } from './action-test.utils';

describe('action test utils', () => {
  it('referencedFieldKeys lee los campos del map sin repetir y en orden', () => {
    const action = {
      action: 'vendix.customer.create',
      map: {
        first_name: '{{fields.nombre}}',
        email: '{{ fields.correo }}',
        last_name: '{{fields.nombre}} {{instance.reference}}',
        phone: 3000,
      },
    } as WorkflowActionDef;
    expect(referencedFieldKeys(action)).toEqual(['nombre', 'correo']);
  });

  it('referencedFieldKeys cubre notificar y asignar campo', () => {
    expect(
      referencedFieldKeys({ action: 'notify', to: { kind: 'initiator' }, message: 'Hola {{fields.a}}' }),
    ).toEqual(['a']);
    expect(referencedFieldKeys({ action: 'set_field', field: 'x', value: '{{fields.b}}' })).toEqual(['b']);
    expect(referencedFieldKeys({ action: 'set_field', field: 'x', value: 4 })).toEqual([]);
  });

  it('runsForReal: solo HTTP y conectores de salida', () => {
    expect(runsForReal({ action: 'vendix.http.request', map: {} })).toBeTrue();
    expect(runsForReal({ action: 'vendix.whatsapp.send', map: {} })).toBeTrue();
    expect(runsForReal({ action: 'vendix.customer.create', map: {} })).toBeFalse();
    expect(runsForReal({ action: 'notify', to: { kind: 'initiator' }, message: 'x' })).toBeFalse();
  });

  it('previewValue formatea vacíos y objetos', () => {
    expect(previewValue('')).toBe('—');
    expect(previewValue({ kind: 'role' })).toBe('{"kind":"role"}');
    expect(previewValue('7')).toBe('7');
  });
});
