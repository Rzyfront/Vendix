import { VendixHttpException } from '@common/errors';
import { WorkflowDefinitionV1, WorkflowTriggerDef } from '@common/workflows/contract';
import {
  buildWorkflowKit,
  purchaseDefinition,
  seedDefinition,
  seedPeople,
} from '../../../../testing/workflows/workflow-test-kit';

const failure = async (p: Promise<unknown>) => {
  try {
    await p;
    return undefined;
  } catch (e) {
    return e instanceof VendixHttpException
      ? { code: e.errorCode, details: (e.getResponse() as any)?.details ?? (e as any).details }
      : { code: `OTHER:${(e as Error).message}` };
  }
};

function externalDefinition(
  triggers: WorkflowTriggerDef[],
  startAssignee: any = { kind: 'role', role_key: 'manager' },
  key = 'externo',
) {
  const def = purchaseDefinition({ key, name: 'Solicitud externa', triggers } as Partial<WorkflowDefinitionV1>);
  def.stages[0].assignee = startAssignee;
  return def;
}

describe('WorkflowEngineService.startExternal (P3.1, P3.3)', () => {
  let kit: ReturnType<typeof buildWorkflowKit>;

  beforeEach(() => {
    kit = buildWorkflowKit();
    seedPeople(kit.db);
    kit.as({ user_id: undefined });
  });
  afterEach(() => jest.restoreAllMocks());

  it('webhook: starts as system with the values checked and coerced like a form, waiting at the start stage', async () => {
    const { definitionId } = seedDefinition(kit.db, externalDefinition([{ kind: 'webhook' }]));
    const r = await kit.engine.startExternal({
      definitionId,
      kind: 'webhook',
      values: { amount: '1500', reason: 'Desde la web' },
      idempotencyKey: 'hook-1:abc',
      started: { hook_id: 7 },
    });
    expect(r.instance).toMatchObject({
      status: 'active',
      current_stage_key: 'request',
      started_by_type: 'system',
      data: { amount: 1500, reason: 'Desde la web' },
    });
    const started = kit.db.table('workflow_instance_events').find((e: any) => e.type === 'started');
    expect(started.payload).toMatchObject({ via: 'webhook', hook_id: 7 });
  });

  it('webhook: wrong values answer 422 with the field errors and create nothing', async () => {
    const { definitionId } = seedDefinition(kit.db, externalDefinition([{ kind: 'webhook' }]));
    const f = await failure(
      kit.engine.startExternal({
        definitionId,
        kind: 'webhook',
        values: { amount: 'mucho', invoice: 'x', unknown: 1 },
        idempotencyKey: 'k',
      }),
    );
    expect(f?.code).toBe('WORKFLOW_FORM_INVALID');
    expect(kit.db.table('workflow_instances')).toHaveLength(0);
  });

  it('webhook: the same key returns the first request (replayed) without a duplicate', async () => {
    const { definitionId } = seedDefinition(kit.db, externalDefinition([{ kind: 'webhook' }]));
    const input = { definitionId, kind: 'webhook' as const, values: { amount: 10 }, idempotencyKey: 'same' };
    const a = await kit.engine.startExternal(input);
    const b = await kit.engine.startExternal(input);
    expect(b.replayed).toBe(true);
    expect(b.instance.id).toBe(a.instance.id);
    expect(kit.db.table('workflow_instances')).toHaveLength(1);
  });

  it('email: fills fields only through the trigger map with {{email.*}} tokens', async () => {
    const { definitionId } = seedDefinition(
      kit.db,
      externalDefinition([{ kind: 'email', map: { reason: '{{email.subject}} — {{email.from}}' } }]),
    );
    const r = await kit.engine.startExternal({
      definitionId,
      kind: 'email',
      context: { subject: 'Cotización', from: 'ana@proveedor.co', from_name: 'Ana', text: 'Hola' },
      idempotencyKey: 'msg-1',
    });
    expect(r.instance.data).toEqual({ reason: 'Cotización — ana@proveedor.co' });
  });

  it('rejects a flow without that trigger, a switched-off flow and a start stage of "the initiator"', async () => {
    const noHook = seedDefinition(kit.db, externalDefinition([{ kind: 'manual' }]));
    expect(
      (await failure(kit.engine.startExternal({ definitionId: noHook.definitionId, kind: 'webhook', values: {}, idempotencyKey: 'a' })))?.code,
    ).toBe('WORKFLOW_NOT_ACTIVE');

    const initiator = seedDefinition(kit.db, externalDefinition([{ kind: 'webhook' }], { kind: 'initiator' }, 'otro'));
    expect(
      (await failure(kit.engine.startExternal({ definitionId: initiator.definitionId, kind: 'webhook', values: {}, idempotencyKey: 'b' })))?.code,
    ).toBe('WORKFLOW_NOT_ACTIVE');

    const off = seedDefinition(kit.db, externalDefinition([{ kind: 'webhook' }], undefined, 'apagado'));
    kit.db.table('workflow_definitions').find((d: any) => d.id === off.definitionId).is_enabled = false;
    expect(
      (await failure(kit.engine.startExternal({ definitionId: off.definitionId, kind: 'webhook', values: {}, idempotencyKey: 'c' })))?.code,
    ).toBe('WORKFLOW_DISABLED');
  });
});
