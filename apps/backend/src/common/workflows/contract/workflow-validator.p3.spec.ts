import {
  WORKFLOW_ACTION_CATALOG,
  WORKFLOW_CONNECTOR_CATALOG,
  WORKFLOW_SCHEMA_V1,
  validateWorkflowDefinition,
} from './index';

const role = { kind: 'role', role_key: 'admin' };

/** Minimal valid flow whose start stage a role fills (system starts allowed). */
const flow = (extra: Record<string, unknown> = {}, startExtra: Record<string, unknown> = {}): any => ({
  schema: WORKFLOW_SCHEMA_V1,
  key: 'renovacion',
  name: 'Renovación',
  fields: [
    { key: 'nombre', type: 'text', label: 'Nombre' },
    { key: 'monto', type: 'money', label: 'Monto' },
    { key: 'soporte', type: 'file', label: 'Soporte' },
  ],
  stages: [
    {
      key: 'inicio',
      name: 'Inicio',
      type: 'form',
      start: true,
      assignee: role,
      form: { fields: ['nombre', 'monto'] },
      transitions: [{ to: 'fin', on: 'submit' }],
      ...startExtra,
    },
    { key: 'fin', name: 'Fin', type: 'end', outcome: 'completed' },
  ],
  ...extra,
});
const codes = (d: any, ctx?: any) => validateWorkflowDefinition(d, ctx).errors.map((e) => e.code);
const collections = { contratos: [{ key: 'vence', type: 'date' }, { key: 'cliente', type: 'text' }] };

describe('P3 validator — webhook and email triggers (P3.1, P3.3)', () => {
  it('accepts one webhook and one email trigger with email tokens', () => {
    expect(
      codes(
        flow({
          triggers: [
            { kind: 'webhook' },
            { kind: 'email', map: { nombre: '{{email.from_name}} <{{email.from}}>' } },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it('rejects two webhooks, extra keys, unknown email tokens and an initiator start', () => {
    expect(codes(flow({ triggers: [{ kind: 'webhook' }, { kind: 'webhook' }] }))).toContain('SHAPE_INVALID');
    expect(codes(flow({ triggers: [{ kind: 'webhook', secret: 'x' }] }))).toContain('SHAPE_INVALID');
    expect(codes(flow({ triggers: [{ kind: 'email', map: { nombre: '{{email.cc}}' } }] }))).toContain(
      'TOKEN_UNKNOWN',
    );
    expect(
      codes(flow({ triggers: [{ kind: 'webhook' }] }, { assignee: { kind: 'initiator' } })),
    ).toContain('ASSIGNEE_NOT_ALLOWED');
  });
});

describe('P3 validator — record-date trigger and custom subject (P3.6)', () => {
  const subject = { type: 'custom_record', collection: 'contratos' };
  const trigger = { kind: 'record_date', field: 'vence', days_before: 30, map: { nombre: '{{record.cliente}} {{record.reference}}' } };

  it('accepts a date field of the collection with record tokens', () => {
    expect(codes(flow({ subject, triggers: [trigger] }), { collections })).toEqual([]);
    // Without the store context, shape-only.
    expect(codes(flow({ subject, triggers: [trigger] }))).toEqual([]);
  });

  it('rejects a non-date field, an unknown collection, days out of range and a flow without a collection', () => {
    expect(codes(flow({ subject, triggers: [{ ...trigger, field: 'cliente' }] }), { collections })).toContain(
      'TRIGGER_INVALID',
    );
    expect(
      codes(flow({ subject: { type: 'custom_record', collection: 'polizas' }, triggers: [trigger] }), { collections }),
    ).toContain('COLLECTION_UNKNOWN');
    expect(codes(flow({ subject, triggers: [{ ...trigger, days_before: 400 }] }))).toContain('TRIGGER_INVALID');
    expect(codes(flow({ triggers: [trigger] }))).toContain('TRIGGER_INVALID');
    expect(codes(flow({ subject: { type: 'supplier', collection: 'contratos' } }))).toContain('SHAPE_INVALID');
    expect(
      codes(flow({ subject, triggers: [{ ...trigger, map: { nombre: '{{record.otro}}' } }] }), { collections }),
    ).toContain('TOKEN_UNKNOWN');
  });

  it('rejects a second record-date trigger on the same field (one request per date)', () => {
    const twice = flow({ subject, triggers: [trigger, { ...trigger, days_before: 7 }] });
    const errors = validateWorkflowDefinition(twice, { collections }).errors;
    expect(errors).toEqual([
      expect.objectContaining({ code: 'TRIGGER_INVALID', path: 'triggers[1].field' }),
    ]);
    // Without the store context too.
    expect(codes(twice)).toEqual(['TRIGGER_INVALID']);
  });
});

describe('P3 validator — HTTP node, secrets and output (P3.2)', () => {
  const http = (over: Record<string, unknown> = {}) =>
    flow({}, {
      on_enter: [
        {
          action: 'vendix.http.request',
          map: {
            method: 'POST',
            url: 'https://api.example.com/v1/{{fields.nombre}}',
            headers: 'Authorization: Bearer {{secrets.CRM_TOKEN}}',
            body: '{"monto": "{{fields.monto}}"}',
            timeout_seconds: 10,
          },
          output: { nombre: 'body.data.name', monto: 'status' },
          ...over,
        },
      ],
    });

  it('accepts secrets in url/headers/body and a valid output', () => {
    expect(codes(http())).toEqual([]);
    expect(codes(http(), { secretNames: ['CRM_TOKEN'] })).toEqual([]);
  });

  it('rejects an unknown secret, a secret outside the HTTP inputs, bad output paths and fields, and a timeout above 30', () => {
    expect(codes(http(), { secretNames: [] })).toContain('SECRET_UNKNOWN');
    expect(
      codes(
        flow({}, {
          on_enter: [
            {
              action: 'vendix.email.send',
              map: { to: 'a@b.co', subject: 'Hola', body: '{{secrets.CRM_TOKEN}}' },
            },
          ],
        }),
      ),
    ).toContain('TOKEN_UNKNOWN');
    expect(codes(http({ output: { nombre: 'body..x' } }))).toContain('HTTP_OUTPUT_INVALID');
    expect(codes(http({ output: { soporte: 'body' } }))).toContain('FIELD_UNKNOWN');
    expect(
      codes(
        flow({}, {
          on_enter: [
            { action: 'vendix.email.send', map: { to: 'a@b.co', subject: 'x', body: 'y' }, output: { nombre: 'status' } },
          ],
        }),
      ),
    ).toContain('HTTP_OUTPUT_INVALID');
    expect(
      codes(
        http({
          map: { method: 'GET', url: 'https://x.co', timeout_seconds: 31 },
        }),
      ),
    ).toContain('MAP_INVALID');
  });
});

describe('P3 validator — multi-step form, file size and external requirements (P3.4, P3.5)', () => {
  it('accepts steps that cover the form in order and files up to 100 MB', () => {
    const d = flow({}, {
      form: {
        fields: ['nombre', 'monto'],
        steps: [
          { title: 'Datos', fields: ['nombre'] },
          { title: 'Valor', fields: ['monto'] },
        ],
      },
      requirements: [{ kind: 'upload', key: 'rut', label: 'RUT actualizado', external: true, max_size_mb: 50 }],
    });
    d.fields[2].max_size_mb = 100;
    expect(codes(d)).toEqual([]);
  });

  it('rejects steps out of order, missing fields, empty steps and files above 100 MB', () => {
    const stepsOf = (steps: unknown) => flow({}, { form: { fields: ['nombre', 'monto'], steps } });
    expect(codes(stepsOf([{ title: 'A', fields: ['monto'] }, { title: 'B', fields: ['nombre'] }]))).toContain(
      'FORM_STEPS_INVALID',
    );
    expect(codes(stepsOf([{ title: 'A', fields: ['nombre'] }]))).toContain('FORM_STEPS_INVALID');
    expect(codes(stepsOf([{ title: 'A', fields: [] }]))).toContain('FORM_STEPS_INVALID');
    const big = flow();
    big.fields[2].max_size_mb = 101;
    expect(codes(big)).toContain('SHAPE_INVALID');
    expect(
      codes(flow({}, { requirements: [{ kind: 'upload', key: 'rut', label: 'RUT', external: 'si' }] })),
    ).toContain('REQUIREMENT_INVALID');
  });
});

describe('P3 connector registry (R6)', () => {
  it('every connector action exists in the action registry', () => {
    for (const spec of Object.values(WORKFLOW_CONNECTOR_CATALOG)) {
      for (const action of spec.actions) {
        expect(WORKFLOW_ACTION_CATALOG[action]).toBeDefined();
      }
    }
  });
});
