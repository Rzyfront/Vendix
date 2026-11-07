import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { VendixHttpException } from '@common/errors';
import { WorkflowDefinitionV1 } from '@common/workflows/contract';
import {
  buildWorkflowKit,
  purchaseDefinition,
  seedDefinition,
  seedPeople,
} from '../../../../testing/workflows/workflow-test-kit';
import { WorkflowCollectionsService } from './workflow-collections.service';
import { CreateWorkflowCollectionDto, UpdateWorkflowCollectionDto } from './workflow-records.dto';

async function failure(p: Promise<unknown>) {
  try {
    await p;
    return undefined;
  } catch (e) {
    return e instanceof VendixHttpException
      ? { code: e.errorCode, message: e.message, details: (e.getResponse() as any)?.details }
      : { code: `OTHER:${(e as Error).message}` };
  }
}

const FIELDS = [
  { key: 'cliente', label: 'Cliente', type: 'text', required: true },
  { key: 'valor', label: 'Valor', type: 'money' },
  { key: 'vence', label: 'Vence', type: 'date' },
];
const base = (over: Record<string, unknown> = {}) =>
  ({ name: 'Contratos', item_name: 'Contrato', key: 'contratos', fields: FIELDS, ...over }) as any;

function renewalFlow(map: Record<string, string>, field = 'vence'): WorkflowDefinitionV1 {
  return purchaseDefinition({
    key: 'renovacion',
    name: 'Renovación de contrato',
    subject: { type: 'custom_record', collection: 'contratos' },
    triggers: [{ kind: 'record_date', field, days_before: 30, map }],
  } as Partial<WorkflowDefinitionV1>);
}

describe('WorkflowCollectionsService (P3.6)', () => {
  let kit: ReturnType<typeof buildWorkflowKit>;
  let svc: WorkflowCollectionsService;

  beforeEach(() => {
    kit = buildWorkflowKit();
    seedPeople(kit.db);
    svc = new WorkflowCollectionsService(kit.prisma);
  });
  afterEach(() => jest.restoreAllMocks());

  it('creates a collection with a default prefix from its name and reads it back', async () => {
    const created = await svc.create(base());
    expect(created).toMatchObject({
      key: 'contratos',
      reference_prefix: 'CON',
      next_number: 1,
      store_id: 1,
      is_archived: false,
    });
    expect((await svc.get(created.id)).fields).toHaveLength(3);
    expect(await svc.list()).toEqual([expect.objectContaining({ key: 'contratos', records_count: 0 })]);
  });

  it('rejects a duplicate field key, a select without options and more than 50 fields', async () => {
    const dup = await failure(
      svc.create(base({ fields: [FIELDS[0], { ...FIELDS[1], key: 'cliente' }] })),
    );
    expect(dup?.code).toBe('WORKFLOW_COLLECTION_INVALID');
    expect(dup?.details.errors[0].field).toBe('fields[1].key');

    const select = await failure(
      svc.create(base({ fields: [{ key: 'estado', label: 'Estado', type: 'select' }] })),
    );
    expect(select?.details.errors[0].field).toBe('fields[0].options');

    const many = Array.from({ length: 51 }, (_, i) => ({ key: `f${i}`, label: `F${i}`, type: 'text' }));
    expect((await failure(svc.create(base({ fields: many }))))?.code).toBe('WORKFLOW_COLLECTION_INVALID');
    expect(kit.db.table('workflow_collections')).toHaveLength(0);
  });

  it('requires the title field to be a text field of the collection', async () => {
    expect((await failure(svc.create(base({ title_field: 'valor' }))))?.code).toBe('WORKFLOW_COLLECTION_INVALID');
    expect((await failure(svc.create(base({ title_field: 'nope' }))))?.code).toBe('WORKFLOW_COLLECTION_INVALID');
    expect(await svc.create(base({ title_field: 'cliente' }))).toMatchObject({ title_field: 'cliente' });
  });

  it('a key already used in the store answers 409', async () => {
    await svc.create(base());
    expect((await failure(svc.create(base())))?.code).toBe('WORKFLOW_COLLECTION_KEY_TAKEN');
  });

  it('validates the key and the prefix in the DTO, and the key cannot be updated', async () => {
    const bad = plainToInstance(CreateWorkflowCollectionDto, base({ key: 'Mal Clave', reference_prefix: 'a' }));
    const errors = await validate(bad);
    expect(errors.map((e) => e.property).sort()).toEqual(['key', 'reference_prefix']);

    const created = await svc.create(base());
    // `key` is not a property of the update DTO: the global whitelist pipe drops it.
    const dto = plainToInstance(UpdateWorkflowCollectionDto, { name: 'Contratos 2' });
    expect(await svc.update(created.id, dto)).toMatchObject({ key: 'contratos', name: 'Contratos 2' });
    expect('key' in new UpdateWorkflowCollectionDto()).toBe(false);
  });

  it('removing a field that a published flow reads answers 409 naming the flows; an unused field can go', async () => {
    const created = await svc.create(base());
    seedDefinition(kit.db, renewalFlow({ reason: '{{record.cliente}}' }));

    const usedByDate = await failure(
      svc.update(created.id, { fields: FIELDS.filter((f) => f.key !== 'vence') } as any),
    );
    expect(usedByDate).toMatchObject({ code: 'WORKFLOW_COLLECTION_FIELD_IN_USE' });
    expect(usedByDate?.message).toContain('Renovación de contrato');
    expect(usedByDate?.details.fields).toEqual(['vence']);

    const usedByMap = await failure(
      svc.update(created.id, { fields: FIELDS.filter((f) => f.key !== 'cliente') } as any),
    );
    expect(usedByMap?.code).toBe('WORKFLOW_COLLECTION_FIELD_IN_USE');
    expect(usedByMap?.details.flows).toEqual([expect.objectContaining({ key: 'renovacion' })]);

    const typeChange = await failure(
      svc.update(created.id, { fields: FIELDS.map((f) => (f.key === 'vence' ? { ...f, type: 'text' } : f)) } as any),
    );
    expect(typeChange?.code).toBe('WORKFLOW_COLLECTION_FIELD_IN_USE');

    const ok = await svc.update(created.id, { fields: FIELDS.filter((f) => f.key !== 'valor') } as any);
    expect(ok.fields.map((f) => f.key)).toEqual(['cliente', 'vence']);
  });

  it('a flow of another collection does not block removing a field', async () => {
    const created = await svc.create(base());
    const other = renewalFlow({ reason: '{{record.cliente}}' });
    other.subject = { type: 'custom_record', collection: 'polizas' };
    seedDefinition(kit.db, other);
    const r = await svc.update(created.id, { fields: FIELDS.filter((f) => f.key !== 'vence') } as any);
    expect(r.fields).toHaveLength(2);
  });

  it('archives instead of deleting, and hides archived collections unless asked', async () => {
    const created = await svc.create(base());
    const archived = await svc.archive(created.id);
    expect(archived.is_archived).toBe(true);
    expect(kit.db.table('workflow_collections')).toHaveLength(1);
    expect(await svc.list()).toHaveLength(0);
    expect(await svc.list({ include_archived: true })).toHaveLength(1);
  });

  it('a collection of another store is a 404 for get, update and archive', async () => {
    const created = await svc.create(base());
    kit.as({ store_id: 2 });
    expect((await failure(svc.get(created.id)))?.code).toBe('WORKFLOW_COLLECTION_NOT_FOUND');
    expect((await failure(svc.update(created.id, { name: 'x' })))?.code).toBe('WORKFLOW_COLLECTION_NOT_FOUND');
    expect((await failure(svc.archive(created.id)))?.code).toBe('WORKFLOW_COLLECTION_NOT_FOUND');
    expect(await svc.list()).toHaveLength(0);
  });
});
