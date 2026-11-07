import { RequestContextService } from '@common/context/request-context.service';
import { WorkflowDefinitionV1 } from '@common/workflows/contract';
import {
  buildWorkflowKit,
  seedDefinition,
  seedPeople,
} from '../../../../testing/workflows/workflow-test-kit';
import { ActionOutboxRow, WorkflowActionsExecutor } from './workflow-actions.executor';
import { WorkflowHttpActions } from './actions/http.actions';
import { coerceOutputFields } from './workflow-http-output';

// The connectors group pulls the SNS SDK, which this spec does not need.
jest.mock('./actions/connectors.actions', () => ({ WorkflowConnectorsActions: class {} }));
jest.mock('../../../../common/utils/user-store-permissions.util', () => ({
  resolveUserStorePermissions: async () => ['store:workflows:manage'],
}));

const SECRET = 'sk_live_super_secret_value';
const HTTP = {
  action: 'vendix.http.request',
  map: {
    method: 'POST',
    url: 'https://api.example.com/{{fields.cliente}}',
    headers: 'Authorization: Bearer {{secrets.CRM_TOKEN}}\nX-Ref: {{instance.reference}}',
    body: '{"who":"{{fields.cliente}}","key":"{{ secrets.CRM_TOKEN }}"}',
  },
  output: {
    crm_id: 'body.id',
    monto: 'body.amount',
    activo: 'body.active',
    vence: 'body.expires',
    estado: 'body.state',
    total_calc: 'body.total',
    nope: 'body.id',
  },
};

const flow = (): WorkflowDefinitionV1 =>
  ({
    schema: 'vendix.workflow/v1',
    key: 'http',
    name: 'Integración',
    fields: [
      { key: 'cliente', type: 'text', label: 'Cliente' },
      { key: 'crm_id', type: 'text', label: 'ID CRM' },
      { key: 'monto', type: 'money', label: 'Monto' },
      { key: 'activo', type: 'boolean', label: 'Activo' },
      { key: 'vence', type: 'date', label: 'Vence' },
      {
        key: 'estado',
        type: 'select',
        label: 'Estado',
        options: [{ value: 'open', label: 'Abierto' }],
      },
      { key: 'total_calc', type: 'number', label: 'Total', compute: '1 + 1' },
    ],
    stages: [
      {
        key: 'solicitud',
        name: 'Solicitud',
        type: 'form',
        start: true,
        assignee: { kind: 'initiator' },
        form: { fields: ['cliente'] },
        transitions: [{ on: 'submit', to: 'llamar' }],
      },
      {
        key: 'llamar',
        name: 'Llamar',
        type: 'automatic',
        on_enter: [HTTP as never],
        transitions: [{ on: 'auto', to: 'fin' }],
      },
      { key: 'fin', name: 'Fin', type: 'end', outcome: 'completed' },
    ],
  }) as WorkflowDefinitionV1;

const inStore = <T>(fn: () => Promise<T>) =>
  RequestContextService.runIsolated(
    { store_id: 1, organization_id: 1, is_super_admin: false, is_owner: false },
    fn,
  );

describe('nodo HTTP en el motor: secretos fuera del outbox y respuesta a campos', () => {
  let kit: ReturnType<typeof buildWorkflowKit>;
  let executor: WorkflowActionsExecutor;
  let httpActions: WorkflowHttpActions;
  const reply = {
    status: 200,
    headers: {},
    truncated: false,
    body: JSON.stringify({
      id: 'crm-9',
      amount: '1500.456',
      active: 'true',
      expires: '2027-03-01T10:00:00Z',
      state: 'closed',
      total: 99,
    }),
  };
  const events = (type: string) =>
    kit.db.table('workflow_instance_events').filter((e) => e.type === type);
  const instance = () => kit.db.table('workflow_instances')[0];

  async function enqueue(): Promise<ActionOutboxRow> {
    seedDefinition(kit.db, flow());
    const started = await kit.engine.start({ definitionKey: 'http', idempotencyKey: 'k1' });
    const task = kit.db.table('workflow_tasks').find((t) => t.status === 'open')!;
    await kit.engine.completeTask({
      taskId: task.id,
      outcome: 'submit',
      values: { cliente: 'acme' },
      expectedRowVersion: started.instance.row_version,
    });
    return kit.db.table('workflow_outbox').find((o) => o.kind === 'action') as ActionOutboxRow;
  }

  beforeEach(() => {
    kit = buildWorkflowKit();
    seedPeople(kit.db);
    const secrets = {
      resolveMany: jest.fn(async (_s: number, names: readonly string[]) =>
        new Map(names.filter((n) => n === 'CRM_TOKEN').map((n) => [n, SECRET])),
      ),
    };
    httpActions = new WorkflowHttpActions(secrets as never);
    httpActions.transport = jest.fn(async () => ({ ...reply }));
    httpActions.resolver = async () => [{ address: '93.184.216.34', family: 4 }];
    executor = new WorkflowActionsExecutor(
      kit.prisma,
      (kit.engine as any).events,
      { handlers: {} } as any,
      { handlers: {} } as any,
      { handlers: {} } as any,
      { handlers: {} } as any,
      httpActions,
    );
  });
  afterEach(() => jest.restoreAllMocks());

  it('{{secrets.X}} sobrevive intacto al outbox; {{fields.*}} e {{instance.*}} sí se resuelven', async () => {
    const row = await enqueue();
    expect(row.payload.map_resolved).toEqual({
      method: 'POST',
      url: 'https://api.example.com/acme',
      headers: 'Authorization: Bearer {{secrets.CRM_TOKEN}}\nX-Ref: FLU-000001',
      body: '{"who":"acme","key":"{{secrets.CRM_TOKEN}}"}',
    });
    expect(row.payload.output).toEqual(HTTP.output);
    expect(JSON.stringify(row.payload)).not.toContain(SECRET);
  });

  it('un valor de campo no puede colarse como secreto ni como encabezado nuevo', async () => {
    const def = flow();
    seedDefinition(kit.db, def);
    const started = await kit.engine.start({ definitionKey: 'http', idempotencyKey: 'k1' });
    const task = kit.db.table('workflow_tasks').find((t) => t.status === 'open')!;
    await kit.engine.completeTask({
      taskId: task.id,
      outcome: 'submit',
      values: { cliente: '{{secrets.CRM_TOKEN}}\nHost: evil' },
      expectedRowVersion: started.instance.row_version,
    });
    const row = kit.db.table('workflow_outbox').find((o) => o.kind === 'action')!;
    const m = row.payload.map_resolved as Record<string, string>;
    expect(m.body).not.toMatch(/\{\{secrets\.CRM_TOKEN\}\}","key"/);
    expect(m.body).toContain('{​{secrets.CRM_TOKEN}}');
    expect(m.headers.split('\n')).toHaveLength(2);
  });

  it('al ejecutar: resuelve el secreto, mapea la respuesta a los campos con su tipo y registra solo las claves', async () => {
    const row = await enqueue();
    await inStore(() => executor.execute(row));
    const sent = (httpActions.transport as jest.Mock).mock.calls[0][0];
    expect(sent.headers.Authorization).toBe(`Bearer ${SECRET}`);
    expect(sent.body).toContain(SECRET);

    expect(instance().data).toMatchObject({
      cliente: 'acme',
      crm_id: 'crm-9',
      monto: 1500.46,
      activo: true,
      vence: '2027-03-01',
    });
    // select outside its options and a calculated field are dropped; computed value is recomputed.
    expect(instance().data.estado).toBeUndefined();
    expect(instance().data.total_calc).toBe(2);
    expect(instance().data.nope).toBeUndefined();

    const ev = events('action_executed');
    expect(ev).toHaveLength(1);
    expect(ev[0].payload.fields.sort()).toEqual(['activo', 'crm_id', 'monto', 'vence']);
    expect(ev[0].payload.fields_dropped.sort()).toEqual(['estado', 'nope', 'total_calc']);
    const blob = JSON.stringify(ev) + JSON.stringify(kit.db.table('workflow_outbox'));
    expect(blob).not.toContain(SECRET);
    expect(blob).not.toContain('crm-9');
  });

  it('un reintento tras escribir no repite la llamada ni los campos', async () => {
    const row = await enqueue();
    await inStore(() => executor.execute(row));
    const version = instance().row_version;
    const saved = kit.db.table('workflow_outbox').find((o) => o.id === row.id) as ActionOutboxRow;
    await inStore(() => executor.execute(saved));
    expect(httpActions.transport).toHaveBeenCalledTimes(1);
    expect(instance().row_version).toBe(version);
  });

  it('una respuesta que falla (4xx) no toca los datos de la instancia', async () => {
    (httpActions.transport as jest.Mock).mockResolvedValue({ ...reply, status: 400 });
    const row = await enqueue();
    const before = JSON.stringify(instance().data);
    await expect(inStore(() => executor.execute(row))).rejects.toThrow(/rechazó la llamada con 400/);
    expect(JSON.stringify(instance().data)).toBe(before);
    expect(events('action_executed')).toHaveLength(0);
  });
});

describe('coerceOutputFields', () => {
  const def = {
    fields: [
      { key: 'n', type: 'number', label: 'N' },
      { key: 'e', type: 'email', label: 'E' },
      { key: 't', type: 'text', label: 'T' },
      { key: 'f', type: 'file', label: 'F' },
    ],
  } as never;

  it('coacciona al tipo declarado y descarta lo inválido', () => {
    const r = coerceOutputFields(def, {
      n: '12',
      e: 'no-es-correo',
      t: { a: 1 },
      f: 3,
      desconocido: 'x',
    });
    expect(r.coerced).toEqual({ n: 12, t: '{"a":1}' });
    expect(r.dropped.sort()).toEqual(['desconocido', 'e', 'f']);
    expect(coerceOutputFields(def, { n: 'abc' }).coerced).toEqual({});
  });
});
