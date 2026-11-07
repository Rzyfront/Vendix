import { VendixHttpException } from '@common/errors';
import { WorkflowDefinitionV1 } from '@common/workflows/contract';
import {
  buildWorkflowKit,
  purchaseDefinition,
  seedDefinition,
  seedPeople,
} from '../../../../testing/workflows/workflow-test-kit';

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return undefined;
  } catch (e) {
    return e instanceof VendixHttpException
      ? e.errorCode
      : `OTHER:${(e as Error).message}`;
  }
};

function eventDefinition(
  over: Record<string, unknown> = {},
  startAssignee: any = { kind: 'role', role_key: 'manager' },
) {
  const def = purchaseDefinition({
    key: 'on-order',
    name: 'Pedido nuevo',
    subject: { type: 'order' },
    triggers: [
      {
        kind: 'event',
        event: 'order.created',
        map: {
          reason: 'Pedido {{event.order_number}} ({{event.channel}})',
          amount: '{{event.grand_total}}',
        },
      },
    ],
    ...over,
  } as Partial<WorkflowDefinitionV1>) as WorkflowDefinitionV1;
  def.stages[0].assignee = startAssignee;
  return def;
}

describe('WorkflowEngineService.startSystem', () => {
  let kit: ReturnType<typeof buildWorkflowKit>;
  const input = (definitionId: number, over: Record<string, unknown> = {}) => ({
    definitionId,
    event: 'order.created',
    eventContext: {
      order_id: 9,
      order_number: 'ORD-9',
      grand_total: 2500,
      currency: 'COP',
      channel: 'pos',
    },
    idempotencyKey: 'key-1',
    ...over,
  });

  beforeEach(() => {
    kit = buildWorkflowKit();
    seedPeople(kit.db);
  });
  afterEach(() => jest.restoreAllMocks());

  it('arranca como actor system, queda EN la etapa inicial con su tarea (el formulario no se envía solo)', async () => {
    const { definitionId } = seedDefinition(kit.db, eventDefinition());
    kit.as({ user_id: undefined });
    const r = await kit.engine.startSystem(input(definitionId));
    expect(r.instance).toMatchObject({
      status: 'active',
      current_stage_key: 'request',
      started_by_type: 'system',
      started_by_id: null,
      store_id: 1,
      reference: 'FLU-000001',
      subject_type: 'order',
      subject_id: 9,
    });
    const tasks = kit.db
      .table('workflow_tasks')
      .filter((t) => t.instance_id === r.instance.id);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      stage_key: 'request',
      status: 'open',
      kind: 'form',
    });
    expect(tasks[0].assignee_role_id).toBe(2); // rol manager, no una persona
    const events = kit.db
      .table('workflow_instance_events')
      .filter((e) => e.instance_id === r.instance.id);
    expect(events.map((e) => [e.type, e.actor_type, e.actor_id])).toEqual([
      ['started', 'system', null],
    ]);
    expect(events[0].payload).toMatchObject({
      via: 'event',
      event: 'order.created',
    });
  });

  it('llena los campos desde el map con los tokens del evento y los convierte al tipo del campo', async () => {
    const { definitionId } = seedDefinition(kit.db, eventDefinition());
    const r = await kit.engine.startSystem(input(definitionId));
    expect(r.instance.data).toEqual({
      reason: 'Pedido ORD-9 (pos)',
      amount: 2500,
    });
  });

  it('los tokens fuera del catálogo del evento no resuelven (defensa si una versión vieja los trae)', async () => {
    const def = eventDefinition();
    (def.triggers as any)[0].map = {
      reason: '{{event.password}}-{{event.email}}',
      amount: '{{event.order_id}}',
    };
    const { definitionId } = seedDefinition(kit.db, def);
    const r = await kit.engine.startSystem(
      input(definitionId, {
        eventContext: { order_id: 9, password: 'p', email: 'e' },
      }),
    );
    expect(r.instance.data).toEqual({ reason: '-', amount: 9 });
  });

  it('valores que no sirven para el tipo del campo se descartan (monto no numérico)', async () => {
    const { definitionId } = seedDefinition(kit.db, eventDefinition());
    const r = await kit.engine.startSystem(
      input(definitionId, {
        eventContext: { grand_total: 'abc', order_number: 'X', channel: 'c' },
      }),
    );
    expect(r.instance.data).toEqual({ reason: 'Pedido X (c)' });
  });

  it('es idempotente: el mismo evento no crea otra instancia y devuelve la original', async () => {
    const { definitionId } = seedDefinition(kit.db, eventDefinition());
    const a = await kit.engine.startSystem(input(definitionId));
    const b = await kit.engine.startSystem(input(definitionId));
    expect(b.replayed).toBe(true);
    expect(b.instance.id).toBe(a.instance.id);
    expect(kit.db.table('workflow_instances')).toHaveLength(1);
    expect(kit.db.table('workflow_tasks')).toHaveLength(1);
  });

  it('otro evento de negocio (otra clave) crea otra instancia', async () => {
    const { definitionId } = seedDefinition(kit.db, eventDefinition());
    await kit.engine.startSystem(input(definitionId));
    const b = await kit.engine.startSystem(
      input(definitionId, { idempotencyKey: 'key-2' }),
    );
    expect(b.instance.reference).toBe('FLU-000002');
  });

  it('rechaza el evento si la versión publicada no tiene ese disparador', async () => {
    const { definitionId } = seedDefinition(kit.db, eventDefinition());
    expect(
      await code(
        kit.engine.startSystem(
          input(definitionId, { event: 'customer.created' }),
        ),
      ),
    ).toBe('WORKFLOW_NOT_ACTIVE');
    const manual = seedDefinition(
      kit.db,
      eventDefinition({ key: 'm', triggers: [{ kind: 'manual' }] }),
    );
    expect(
      await code(
        kit.engine.startSystem(
          input(manual.definitionId, { idempotencyKey: 'z' }),
        ),
      ),
    ).toBe('WORKFLOW_NOT_ACTIVE');
    expect(kit.db.table('workflow_instances')).toHaveLength(0);
  });

  it('rechaza una etapa inicial asignada a quien inicia (nadie inicia un arranque del sistema)', async () => {
    const { definitionId } = seedDefinition(
      kit.db,
      eventDefinition({}, { kind: 'initiator' }),
    );
    expect(await code(kit.engine.startSystem(input(definitionId)))).toBe(
      'WORKFLOW_NOT_ACTIVE',
    );
    expect(kit.db.table('workflow_instances')).toHaveLength(0);
  });

  it('definición inactiva o de otra tienda: no arranca', async () => {
    const mine = seedDefinition(kit.db, eventDefinition());
    kit.db
      .table('workflow_definitions')
      .find((d) => d.id === mine.definitionId)!.status = 'paused';
    expect(await code(kit.engine.startSystem(input(mine.definitionId)))).toBe(
      'WORKFLOW_NOT_ACTIVE',
    );

    const theirs = seedDefinition(
      kit.db,
      eventDefinition({ key: 'theirs' }),
      2,
    );
    expect(
      await code(
        kit.engine.startSystem(
          input(theirs.definitionId, { idempotencyKey: 'q' }),
        ),
      ),
    ).toBe('WORKFLOW_DEFINITION_NOT_FOUND');
    expect(kit.db.table('workflow_instances')).toHaveLength(0);
  });

  it('con un evento que no es de negocio de tipo pedido no fija el sujeto', async () => {
    const def = eventDefinition({ subject: { type: 'supplier' } });
    const { definitionId } = seedDefinition(kit.db, def);
    const r = await kit.engine.startSystem(input(definitionId));
    expect(r.instance.subject_type).toBeNull();
  });
});
