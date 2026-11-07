import {
  WORKFLOW_EXAMPLE_PURCHASE_APPROVAL,
  WorkflowDefinitionV1,
  validateWorkflowDefinition,
} from '@common/workflows/contract';
import {
  buildWorkflowKit,
  purchaseDefinition,
  seedDefinition,
  seedPeople,
  seedWorkGroup,
} from '../../../../testing/workflows/workflow-test-kit';
import { WorkflowDefinitionsController } from './workflow-definitions.controller';
import {
  WorkflowSimulatorService,
  simulateWorkflow,
} from './workflow-simulator.service';
import { PERMISSIONS_KEY } from '../../../auth/decorators/permissions.decorator';

const EX = WORKFLOW_EXAMPLE_PURCHASE_APPROVAL;

describe('simulateWorkflow', () => {
  it('start: etapa inicial y su tarea', () => {
    const r = simulateWorkflow(EX);
    expect(r).toMatchObject({
      valid: true,
      from_stage: { key: 'solicitud', name: 'Solicitud' },
      to_stage: { key: 'solicitud', type: 'form' },
      path: ['solicitud'],
      tasks: [{ stage_key: 'solicitud', kind: 'form', assignee: { kind: 'initiator', label: 'Quien inició' } }],
      ended: null,
      watermark: 'SIMULACIÓN',
    });
  });

  it('aprobar con ramas por monto: ambos lados', () => {
    const state = (monto: number) => ({ stage_key: 'jefe', data: { monto } });
    const big = simulateWorkflow(EX, { state: state(3_000_000), outcome: 'approve' });
    expect(big.to_stage).toMatchObject({ key: 'gerente', type: 'approval' });
    expect(big.transition).toMatchObject({ on: 'approve' });
    expect(big.transition?.when_text).toContain('monto');
    expect(big.tasks).toEqual([
      { stage_key: 'gerente', kind: 'approval', assignee: { kind: 'group', label: 'Grupo: gerencia' } },
    ]);
    const small = simulateWorkflow(EX, { state: state(1000), outcome: 'approve' });
    expect(small.to_stage).toMatchObject({ key: 'aprobada', type: 'end' });
    expect(small.ended).toEqual({ outcome: 'completed' });
    expect(small.tasks).toEqual([]);
  });

  it('requisito pendiente bloquea; satisfecho (o file_field con dato) deja pasar', () => {
    const base = { stage_key: 'gerente', data: { monto: 1 }, };
    const pending = simulateWorkflow(EX, { state: base, outcome: 'approve' });
    expect(pending.pending_requirements).toEqual([
      { key: 'cotizacion_adjunta', label: 'Cotización adjunta' },
    ]);
    expect(pending.to_stage).toBeNull();
    const byKey = simulateWorkflow(EX, {
      state: base,
      outcome: 'approve',
      satisfied_requirements: ['cotizacion_adjunta'],
    });
    expect(byKey.pending_requirements).toEqual([]);
    expect(byKey.to_stage?.key).toBe('aprobada');
    const byField = simulateWorkflow(EX, {
      state: { stage_key: 'gerente', data: { monto: 1, cotizacion: [5] } },
      outcome: 'approve',
    });
    expect(byField.to_stage?.key).toBe('aprobada');
    // reject is never blocked by requirements
    expect(
      simulateWorkflow(EX, { state: base, outcome: 'reject' }).to_stage?.key,
    ).toBe('rechazada');
  });

  it('error de formulario: devuelve form_errors y no avanza', () => {
    const r = simulateWorkflow(EX, { state: { stage_key: 'solicitud', data: {} }, outcome: 'submit', values: {} });
    expect(r.form_errors.map((e) => e.field)).toContain('monto');
    expect(r.to_stage).toBeNull();
  });

  it('formulario válido: mezcla los valores y avanza', () => {
    const r = simulateWorkflow(EX, {
      state: { stage_key: 'solicitud', data: {} },
      outcome: 'submit',
      values: { monto: 500 },
    });
    expect(r.to_stage?.key).toBe('jefe');
    expect(r.data).toMatchObject({ monto: 500 });
    expect(r.tasks[0].assignee).toEqual({ kind: 'role', label: 'Rol: store_manager' });
  });

  it('rechazar exige comentario; con comentario avanza y notifica', () => {
    const state = { stage_key: 'jefe', data: { monto: 1 } };
    const no = simulateWorkflow(EX, { state, outcome: 'reject' });
    expect(no.comment_required).toBe(true);
    expect(no.to_stage).toBeNull();
    const ok = simulateWorkflow(EX, { state, outcome: 'reject', comment: 'no' });
    expect(ok.comment_required).toBe(false);
    expect(ok.ended).toEqual({ outcome: 'rejected' });
    expect(ok.notifications).toEqual([
      { to: 'Quien inició', message: 'Tu solicitud de compra fue rechazada.' },
    ]);
  });

  it('resultado inexistente: no_transition', () => {
    const r = simulateWorkflow(EX, { state: { stage_key: 'jefe', data: {} }, outcome: 'submit' });
    expect(r.no_transition).toBe(true);
    const r2 = simulateWorkflow(purchaseDefinition(), {
      state: { stage_key: 'manager', data: {} },
      outcome: 'approve',
    });
    expect(r2.to_stage?.key).toBe('done');
  });

  const auto = (extra: Partial<WorkflowDefinitionV1> = {}): WorkflowDefinitionV1 =>
    ({
      schema: 'vendix.workflow/v1',
      key: 'auto',
      name: 'Auto',
      fields: [{ key: 'flag', type: 'text', label: 'Flag' }],
      stages: [
        { key: 'a', name: 'A', type: 'form', start: true, assignee: { kind: 'initiator' }, transitions: [{ on: 'submit', to: 'auto1' }] },
        {
          key: 'auto1',
          name: 'Auto 1',
          type: 'automatic',
          on_enter: [{ action: 'set_field', field: 'flag', value: 'visto' }],
          on_exit: [{ action: 'notify', to: { kind: 'user', user_id: 9 }, message: 'hola' }],
          transitions: [{ on: 'auto', to: 'fin' }],
        },
        { key: 'fin', name: 'Fin', type: 'end', outcome: 'completed' },
      ],
      ...extra,
    }) as WorkflowDefinitionV1;

  it('set_field + notify a través de una etapa automática hasta el fin', () => {
    const r = simulateWorkflow(auto(), { state: { stage_key: 'a', data: {} }, outcome: 'submit' });
    expect(r.path).toEqual(['a', 'auto1', 'fin']);
    expect(r.data).toEqual({ flag: 'visto' });
    expect(r.notifications).toEqual([{ to: 'Usuario #9', message: 'hola' }]);
    expect(r.ended).toEqual({ outcome: 'completed' });
    expect(r.loop_guard).toBe(false);
  });

  it('el validador rechaza ciclos automáticos y el simulador igual se detiene (loop_guard)', () => {
    const cyc = auto({
      stages: [
        { key: 'a', name: 'A', type: 'form', start: true, assignee: { kind: 'initiator' }, transitions: [{ on: 'submit', to: 'x' }] },
        { key: 'x', name: 'X', type: 'automatic', transitions: [{ on: 'auto', to: 'y' }] },
        { key: 'y', name: 'Y', type: 'automatic', transitions: [{ on: 'auto', to: 'x' }] },
        { key: 'fin', name: 'Fin', type: 'end', outcome: 'completed' },
      ] as any,
    });
    expect(validateWorkflowDefinition(cyc).valid).toBe(false);
    const r = simulateWorkflow(cyc, { state: { stage_key: 'a', data: {} }, outcome: 'submit' });
    expect(r.loop_guard).toBe(true);
    expect(r.path.length).toBe(22);
  });

  it('misma función que el motor: mismo to_stage_key para el mismo ejemplo', async () => {
    const kit = buildWorkflowKit();
    seedPeople(kit.db);
    seedWorkGroup(kit.db, 'board', [4, 5, 6]);
    seedDefinition(kit.db, purchaseDefinition());
    const def = purchaseDefinition();
    for (const amount of [0, 5000, 20000]) {
      const started = await kit.engine.start({ definitionKey: 'purchase', idempotencyKey: `s-${amount}` });
      const task = kit.db.table('workflow_tasks').find((t) => t.instance_id === started.instance.id && t.status === 'open')!;
      const real = await kit.engine.completeTask({
        taskId: task.id,
        outcome: 'submit',
        values: { amount, reason: 'x' },
        expectedRowVersion: started.instance.row_version,
      });
      const sim = simulateWorkflow(def, {
        state: { stage_key: 'request', data: {} },
        outcome: 'submit',
        values: { amount, reason: 'x' },
      });
      expect(sim.to_stage?.key).toBe(real.to_stage_key);
    }
    jest.restoreAllMocks();
  });

  it('misma función que el motor con WORKFLOW_EXAMPLE_PURCHASE_APPROVAL (envío y aprobación por monto)', async () => {
    const kit = buildWorkflowKit();
    seedPeople(kit.db);
    seedDefinition(kit.db, EX);
    kit.as({ is_owner: true });
    for (const monto of [1000, 3_000_000]) {
      const started = await kit.engine.start({ definitionKey: EX.key, idempotencyKey: `e-${monto}` });
      const open = () =>
        kit.db.table('workflow_tasks').find((t) => t.instance_id === started.instance.id && t.status === 'open')!;
      const sent = await kit.engine.completeTask({
        taskId: open().id,
        outcome: 'submit',
        values: { monto },
        expectedRowVersion: started.instance.row_version,
      });
      const simSent = simulateWorkflow(EX, {
        state: { stage_key: 'solicitud', data: {} },
        outcome: 'submit',
        values: { monto },
      });
      expect(simSent.to_stage?.key).toBe(sent.to_stage_key);
      const approved = await kit.engine.completeTask({
        taskId: open().id,
        outcome: 'approve',
        expectedRowVersion: sent.instance.row_version,
      });
      const simApproved = simulateWorkflow(EX, {
        state: { stage_key: 'jefe', data: { monto } },
        outcome: 'approve',
      });
      expect(simApproved.to_stage?.key).toBe(approved.to_stage_key);
    }
    jest.restoreAllMocks();
  });
});

describe('WorkflowSimulatorService', () => {
  const make = (draft: unknown, valid: boolean, errors: any[] = []) => {
    const definitions = {
      getDraft: jest.fn().mockResolvedValue({ definition: draft }),
      validateDefinition: jest.fn().mockResolvedValue({ valid, errors, warnings: [] }),
    };
    return { definitions, svc: new WorkflowSimulatorService(definitions as any) };
  };

  it('usa el borrador guardado cuando no llega definición', async () => {
    const { svc, definitions } = make(EX, true);
    const r = await svc.simulate(3, {});
    expect(definitions.getDraft).toHaveBeenCalledWith(3);
    expect(r.valid).toBe(true);
    expect(r.to_stage?.key).toBe('solicitud');
  });

  it('definición inválida: devuelve issues y no simula', async () => {
    const issue = { code: 'SHAPE_INVALID', path: '', message: 'mala' };
    const { svc, definitions } = make({}, false, [issue]);
    const r = await svc.simulate(3, { definition: { x: 1 } });
    expect(definitions.getDraft).not.toHaveBeenCalled();
    expect(r).toMatchObject({ valid: false, issues: [issue], path: [], tasks: [], to_stage: null });
  });
});

describe('controlador simulate', () => {
  const fn = WorkflowDefinitionsController.prototype.simulate;
  it('POST :id/simulate con permiso de diseño', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, fn)).toEqual(['store:workflows:design']);
    expect(Reflect.getMetadata('path', fn)).toBe(':id/simulate');
    expect(Reflect.getMetadata('method', fn)).toBe(1);
  });
});

describe('simulateWorkflow · acciones Vendix', () => {
  const def = (): WorkflowDefinitionV1 =>
    ({
      schema: 'vendix.workflow/v1',
      key: 'oc',
      name: 'Compra',
      fields: [
        { key: 'proveedor', type: 'number', label: 'Proveedor' },
        { key: 'motivo', type: 'text', label: 'Motivo' },
      ],
      stages: [
        {
          key: 'solicitud', name: 'Solicitud', type: 'form', start: true,
          assignee: { kind: 'initiator' }, form: { fields: ['proveedor', 'motivo'] },
          transitions: [{ on: 'submit', to: 'crear' }],
        },
        {
          key: 'crear', name: 'Crear', type: 'automatic',
          on_enter: [
            { action: 'vendix.crm_task.create', map: { title: 'Revisar {{fields.motivo}}', due_in_days: 2, assignee: { kind: 'user', user_id: 3 } } },
            { action: 'vendix.purchase_order.create_draft', map: { supplier_id: '{{fields.proveedor}}', location_id: 1, product_id: 2, quantity: 3, unit_price: 10, notes: '{{instance.reference}}' } },
          ],
          transitions: [{ on: 'auto', to: 'fin' }],
        },
        { key: 'fin', name: 'Fin', type: 'end', outcome: 'completed' },
      ],
    }) as WorkflowDefinitionV1;

  it('lista las acciones con el map resuelto y no ejecuta nada', () => {
    const r = simulateWorkflow(def(), {
      state: { stage_key: 'solicitud', data: {} },
      outcome: 'submit',
      values: { proveedor: 7, motivo: 'Tóner' },
    });
    expect(r.actions).toEqual([
      {
        action: 'vendix.crm_task.create',
        map_resolved: { title: 'Revisar Tóner', due_in_days: '2', assignee: { kind: 'user', user_id: 3 } },
      },
      {
        action: 'vendix.purchase_order.create_draft',
        map_resolved: { supplier_id: '7', location_id: '1', product_id: '2', quantity: '3', unit_price: '10', notes: 'SIM-0001' },
      },
    ]);
    expect(r.ended).toEqual({ outcome: 'completed' });
    expect(r.watermark).toBe('SIMULACIÓN');
  });

  it('sin acciones devuelve actions: [] (forma estable) y no cambia el resto del resultado', () => {
    expect(simulateWorkflow(EX).actions).toEqual([]);
  });

  it('el servicio de simulación valida y expone actions', async () => {
    const kit = buildWorkflowKit();
    seedPeople(kit.db);
    const definitions = { getDraft: jest.fn(), validateDefinition: jest.fn().mockResolvedValue({ valid: true, errors: [], warnings: [] }) };
    const service = new WorkflowSimulatorService(definitions as any);
    const r = await service.simulate(1, {
      definition: def() as any,
      state: { stage_key: 'solicitud', data: {} },
      outcome: 'submit',
      values: { proveedor: 7, motivo: 'x' },
    });
    expect(r.actions).toHaveLength(2);
    const invalid = new WorkflowSimulatorService({
      getDraft: jest.fn(),
      validateDefinition: jest.fn().mockResolvedValue({ valid: false, errors: [{ code: 'TOKEN_UNKNOWN' }], warnings: [] }),
    } as any);
    expect((await invalid.simulate(1, { definition: def() as any })).actions).toEqual([]);
  });
});
