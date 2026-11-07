import { WorkflowDefinitionV1 } from '@common/workflows/contract';
import {
  buildWorkflowKit,
  seedDefinition,
  seedPeople,
} from '../../../../testing/workflows/workflow-test-kit';

/**
 * P4.1: entering a stage with an `issued_document` requirement that issues on
 * enter queues `vendix.document.issue`; an automatic stage waits for its
 * documents and leaves once one is issued.
 */
describe('Etapas con documentos emitidos', () => {
  let kit: ReturnType<typeof buildWorkflowKit>;

  const definition = (autoIssue: boolean, stageType: 'automatic' | 'form' = 'automatic') =>
    ({
      schema: 'vendix.workflow/v1',
      key: 'contratacion',
      name: 'Contratación',
      fields: [],
      stages: [
        {
          key: 'inicio',
          name: 'Inicio',
          type: 'form',
          start: true,
          assignee: { kind: 'initiator' },
          form: { fields: [] },
          transitions: [{ on: 'submit', to: 'contrato' }],
        },
        {
          key: 'contrato',
          name: 'Contrato',
          type: stageType,
          ...(stageType === 'form' ? { assignee: { kind: 'initiator' }, form: { fields: [] } } : {}),
          requirements: [
            {
              kind: 'issued_document',
              key: 'contrato',
              label: 'Contrato laboral',
              template_key: 'contrato-laboral',
              ...(autoIssue ? { auto_issue_on_enter: true } : {}),
            },
          ],
          transitions: [{ on: stageType === 'automatic' ? 'auto' : 'submit', to: 'fin' }],
        },
        { key: 'fin', name: 'Fin', type: 'end', outcome: 'completed' },
      ],
    }) as unknown as WorkflowDefinitionV1;

  async function enterContractStage() {
    const started = await kit.engine.start({ definitionKey: 'contratacion' });
    const task = kit.db.table('workflow_tasks').find((t) => t.instance_id === started.instance.id && t.status === 'open')!;
    await kit.engine.completeTask({ taskId: task.id, outcome: 'submit', expectedRowVersion: 0 });
    return started.instance.id as number;
  }

  beforeEach(() => {
    kit = buildWorkflowKit();
    seedPeople(kit.db);
  });
  afterEach(() => jest.restoreAllMocks());

  it('auto_issue_on_enter queues one vendix.document.issue action for the stage', async () => {
    seedDefinition(kit.db, definition(true));
    await enterContractStage();
    const actions = kit.db.table('workflow_outbox').filter((o) => o.kind === 'action');
    expect(actions).toHaveLength(1);
    expect(actions[0].payload).toMatchObject({
      action: 'vendix.document.issue',
      map_resolved: { template_key: 'contrato-laboral', requirement_key: 'contrato' },
      stage_key: 'contrato',
    });
  });

  it('without auto_issue_on_enter nothing is queued', async () => {
    seedDefinition(kit.db, definition(false));
    await enterContractStage();
    expect(kit.db.table('workflow_outbox').filter((o) => o.kind === 'action')).toHaveLength(0);
  });

  it('an automatic stage waits while its document is missing or rendering, and leaves once it is issued', async () => {
    seedDefinition(kit.db, definition(true));
    const id = await enterContractStage();
    const advance = () => kit.db.table('workflow_outbox').find((o) => o.kind === 'advance' && o.payload.instance_id === id)!;

    expect((await kit.engine.tick(id, { expectStageEntrySeq: advance().payload.stage_entry_seq })).action).toBe('blocked');
    kit.db.insert('issued_documents', {
      store_id: 1, workflow_instance_id: id, requirement_key: 'contrato', status: 'rendering',
    });
    expect((await kit.engine.tick(id)).action).toBe('blocked');
    expect(kit.db.table('workflow_instances').find((i) => i.id === id)).toMatchObject({ current_stage_key: 'contrato' });

    kit.db.table('issued_documents')[0].status = 'issued';
    expect((await kit.engine.tick(id)).action).toBe('advanced');
    expect(kit.db.table('workflow_instances').find((i) => i.id === id)).toMatchObject({ status: 'completed', current_stage_key: 'fin' });
  });

  it('an automatic stage without document requirements is not held back', async () => {
    const def = definition(false);
    (def.stages[1] as { requirements?: unknown }).requirements = undefined;
    seedDefinition(kit.db, def);
    const id = await enterContractStage();
    expect((await kit.engine.tick(id)).action).toBe('advanced');
  });

  it('a human stage is completed by a person only when the document is issued', async () => {
    seedDefinition(kit.db, definition(true, 'form'));
    const id = await enterContractStage();
    const task = kit.db.table('workflow_tasks').find((t) => t.instance_id === id && t.status === 'open')!;
    const instance = kit.db.table('workflow_instances').find((i) => i.id === id)!;
    await expect(
      kit.engine.completeTask({ taskId: task.id, outcome: 'submit', expectedRowVersion: instance.row_version }),
    ).rejects.toMatchObject({ errorCode: 'WORKFLOW_REQUIREMENT_PENDING' });
    kit.db.insert('issued_documents', { store_id: 1, workflow_instance_id: id, requirement_key: 'contrato', status: 'issued' });
    const done = await kit.engine.completeTask({ taskId: task.id, outcome: 'submit', expectedRowVersion: instance.row_version });
    expect(done.instance.current_stage_key).toBe('fin');
  });
});
