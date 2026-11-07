import { applyActionList } from './workflow-rules';

describe('applyActionList', () => {
  const to = { kind: 'initiator' } as const;

  it('resolves {{fields.*}} and {{instance.*}} tokens in notify messages', () => {
    const out = applyActionList(
      [
        { action: 'notify', to, message: 'Solicitud {{instance.reference}} por {{fields.monto}}' },
      ],
      { monto: 3000000 },
      { reference: 'FLU-000001', title: 'Compra' },
    );
    expect(out.notifies).toEqual([{ message: 'Solicitud FLU-000001 por 3000000', to }]);
  });

  it('keeps plain messages unchanged and sees fields set earlier in the list', () => {
    const out = applyActionList(
      [
        { action: 'set_field', field: 'estado', value: 'ok' },
        { action: 'notify', to, message: 'Sin variables' },
        { action: 'notify', to, message: 'Estado {{fields.estado}}' },
      ],
      {},
    );
    expect(out.data).toEqual({ estado: 'ok' });
    expect(out.notifies.map((n) => n.message)).toEqual(['Sin variables', 'Estado ok']);
  });
});
