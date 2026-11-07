import {
  WorkflowAssigneeDef,
  WorkflowDefinitionV1,
} from '@common/workflows/contract';
import {
  buildWorkflowKit,
  seedDefinition,
  seedPeople,
  seedWorkGroup,
} from '../../../../testing/workflows/workflow-test-kit';

const def = (
  assignee: WorkflowAssigneeDef,
  extra: Record<string, unknown> = {},
): WorkflowDefinitionV1 =>
  ({
    schema: 'vendix.workflow/v1',
    key: 'asg',
    name: 'Asignación',
    fields: [{ key: 'responsable', type: 'user', label: 'Responsable' }],
    stages: [
      {
        key: 'work',
        name: 'Trabajo',
        type: 'form',
        start: true,
        assignee,
        form: { fields: [] },
        transitions: [{ on: 'submit', to: 'end' }],
        ...extra,
      },
      { key: 'end', name: 'Fin', type: 'end', outcome: 'completed' },
    ],
  }) as WorkflowDefinitionV1;

describe('WorkflowAssignmentService (vía start)', () => {
  let kit: ReturnType<typeof buildWorkflowKit>;
  const lastTask = () => kit.db.table('workflow_tasks').slice(-1)[0];
  const start = (data?: Record<string, unknown>) =>
    kit.engine.start({ definitionKey: 'asg', data });

  beforeEach(() => {
    kit = buildWorkflowKit();
    seedPeople(kit.db);
  });
  afterEach(() => jest.restoreAllMocks());

  it('round_robin: el siguiente miembro disponible después del último asignado, con vuelta', async () => {
    seedWorkGroup(kit.db, 'ops', [4, 5, 6]);
    seedDefinition(kit.db, def({ kind: 'group', group_key: 'ops', strategy: 'round_robin' }));
    const order: number[] = [];
    for (let i = 0; i < 5; i++) {
      await start();
      order.push(lastTask().assignee_user_id);
    }
    expect(order).toEqual([4, 5, 6, 4, 5]);
    expect(lastTask().assignee_group_id).toBe(1);
  });

  it('round_robin salta a quien no está disponible', async () => {
    seedWorkGroup(kit.db, 'ops', [4, 5, 6], { unavailable: [5] });
    seedDefinition(kit.db, def({ kind: 'group', group_key: 'ops', strategy: 'round_robin' }));
    const order: number[] = [];
    for (let i = 0; i < 4; i++) {
      await start();
      order.push(lastTask().assignee_user_id);
    }
    expect(order).toEqual([4, 6, 4, 6]);
  });

  it('least_load: el miembro con menos tareas open|claimed (empate → menor id)', async () => {
    seedWorkGroup(kit.db, 'ops', [4, 5, 6]);
    seedDefinition(kit.db, def({ kind: 'group', group_key: 'ops', strategy: 'least_load' }));
    const busy = (user: number, status: string) =>
      kit.db.insert('workflow_tasks', {
        store_id: 1, organization_id: 1, instance_id: 99, stage_key: 'x',
        stage_entry_seq: 1, kind: 'form', status, assignee_user_id: user,
      });
    busy(4, 'open'); busy(4, 'claimed'); busy(5, 'open'); busy(6, 'done');
    await start();
    expect(lastTask().assignee_user_id).toBe(6);
    await start(); // 6 ya tiene 1, 5 tiene 1 → empate → 5
    expect(lastTask().assignee_user_id).toBe(5);
  });

  it('group + any: la tarea queda del grupo para que un miembro la tome', async () => {
    seedWorkGroup(kit.db, 'ops', [4, 5]);
    seedDefinition(kit.db, def({ kind: 'group', group_key: 'ops' }));
    await start();
    expect(lastTask()).toMatchObject({ assignee_group_id: 1, assignee_user_id: null, assignee_role_id: null });
    kit.as({ user_id: 5 });
    const claimed = await kit.engine.claimTask(lastTask().id);
    expect(claimed).toMatchObject({ status: 'claimed', assignee_user_id: 5 });
  });

  it('user y field: solo si la persona es de la tienda', async () => {
    seedDefinition(kit.db, def({ kind: 'user', user_id: 3 }));
    await start();
    expect(lastTask().assignee_user_id).toBe(3);

    kit.db.table('workflow_definitions')[0].key = 'old';
    seedDefinition(kit.db, def({ kind: 'field', field: 'responsable' }));
    await start({ responsable: 4 });
    expect(lastTask().assignee_user_id).toBe(4);
    expect(kit.db.table('workflow_instance_events').filter((e) => e.type === 'unassigned')).toHaveLength(0);
  });

  it('nadie disponible → rol de escalamiento y evento unassigned', async () => {
    seedWorkGroup(kit.db, 'vacio', [4], { unavailable: [4] });
    seedDefinition(
      kit.db,
      def(
        { kind: 'group', group_key: 'vacio', strategy: 'round_robin' },
        { due: { hours: 24, on_overdue: { escalate_to: { kind: 'role', role_key: 'manager' } } } },
      ),
    );
    await start();
    expect(lastTask()).toMatchObject({ assignee_role_id: 2, assignee_user_id: null });
    const ev = kit.db.table('workflow_instance_events').find((e) => e.type === 'unassigned')!;
    expect(ev.payload).toMatchObject({ reason: 'group_without_available_members', fallback: 'escalate_to' });
  });

  it('sin escalate_to cae al rol owner de la tienda', async () => {
    seedDefinition(kit.db, def({ kind: 'user', user_id: 7 })); // 7 es de la tienda 2
    await start();
    expect(lastTask()).toMatchObject({ assignee_role_id: 1, assignee_user_id: null });
    const ev = kit.db.table('workflow_instance_events').find((e) => e.type === 'unassigned')!;
    expect(ev.payload).toMatchObject({ reason: 'user_not_in_store', fallback: 'owner' });
  });

  it('role sin titulares no se asigna (queda en el fallback)', async () => {
    kit.db.insert('roles', { id: 9, name: 'auditor', organization_id: null, store_id: null });
    seedDefinition(kit.db, def({ kind: 'role', role_key: 'auditor' }));
    await start();
    expect(lastTask().assignee_role_id).toBe(1);
  });

  it('aislamiento: un grupo que solo existe en la tienda B queda sin asignar en la A', async () => {
    seedWorkGroup(kit.db, 'solo-b', [7], { storeId: 2 });
    seedDefinition(kit.db, def({ kind: 'group', group_key: 'solo-b', strategy: 'round_robin' }));
    await start();
    expect(lastTask()).toMatchObject({ assignee_user_id: null, assignee_group_id: null, assignee_role_id: 1 });
    const ev = kit.db.table('workflow_instance_events').find((e) => e.type === 'unassigned')!;
    expect(ev.payload).toMatchObject({ reason: 'group_not_found' });
  });

  it('aislamiento: quien es miembro solo de la tienda B no es un assignee user válido en la A', async () => {
    seedDefinition(kit.db, def({ kind: 'user', user_id: 7 }));
    await start();
    expect(lastTask().assignee_user_id).toBeNull();
    expect(
      kit.db.table('workflow_instance_events').find((e) => e.type === 'unassigned')!.payload,
    ).toMatchObject({ reason: 'user_not_in_store' });
  });

  it('aislamiento: un rol de otra organización no cuenta como titular', async () => {
    kit.db.insert('roles', { id: 20, name: 'jefe', organization_id: 99, store_id: null });
    kit.db.insert('user_roles', { user_id: 4, role_id: 20, store_id: 1 });
    seedDefinition(kit.db, def({ kind: 'role', role_key: 'jefe' }));
    await start();
    expect(lastTask().assignee_role_id).toBe(1); // cae al owner: el rol 'jefe' no es visible
  });
});
