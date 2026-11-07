import { WorkflowDefinitionV1 } from '@common/workflows/contract';
import {
  buildWorkflowKit,
  purchaseDefinition,
  seedDefinition,
  seedPeople,
} from '../../../../testing/workflows/workflow-test-kit';
import { WorkflowRecordDateCron } from './workflow-record-date.cron';

const NOW = new Date('2026-11-07T15:00:00Z'); // 10:00 in Bogota
const IN_30_DAYS = '2026-12-07';

function renewalDefinition(
  overrides: { days_before?: number; collection?: string; key?: string; field?: string } = {},
): WorkflowDefinitionV1 {
  const def = purchaseDefinition({
    key: overrides.key ?? 'renovacion',
    name: 'Renovación de contrato',
    subject: { type: 'custom_record', collection: overrides.collection ?? 'contratos' },
    triggers: [
      {
        kind: 'record_date',
        field: overrides.field ?? 'vence',
        days_before: overrides.days_before ?? 30,
        map: { reason: '{{record.cliente}} · {{record.reference}}' },
      },
    ],
  } as Partial<WorkflowDefinitionV1>);
  def.stages[0].assignee = { kind: 'role', role_key: 'manager' };
  return def;
}

describe('WorkflowRecordDateCron (P3.6)', () => {
  let kit: ReturnType<typeof buildWorkflowKit>;
  let cron: WorkflowRecordDateCron;

  const addCollection = (id: number, key: string, storeId = 1) =>
    kit.db.insert('workflow_collections', {
      id,
      organization_id: 1,
      store_id: storeId,
      key,
      name: key,
      is_archived: false,
      fields: [],
    });
  const addRecord = (
    id: number,
    collectionId: number,
    collectionKey: string,
    data: Record<string, unknown>,
    extra: Record<string, unknown> = {},
    storeId = 1,
  ) =>
    kit.db.insert('workflow_records', {
      id,
      organization_id: 1,
      store_id: storeId,
      collection_id: collectionId,
      reference: `REG-00000${id}`,
      title: String(data['cliente'] ?? 'x'),
      data,
      archived_at: null,
      // The engine's subject check filters through this relation.
      collection: { key: collectionKey, store_id: storeId },
      ...extra,
    });
  const instances = () => kit.db.table('workflow_instances');

  beforeEach(() => {
    kit = buildWorkflowKit();
    seedPeople(kit.db);
    kit.as({ user_id: undefined });
    // Emulates the cron's cross-store lookup of published flows with a record_date trigger.
    kit.db.rawHandlers.push((text) => {
      if (!text.includes('record_date')) return undefined;
      return kit.db
        .table('workflow_definitions')
        .filter((d) => d.status === 'active' && d.is_enabled === true && d.published_version_id)
        .map((d) => {
          const v = kit.db.table('workflow_versions').find((x) => x.id === d.published_version_id)!;
          const store = kit.db.table('stores').find((s) => s.id === d.store_id)!;
          return {
            id: d.id,
            store_id: d.store_id,
            organization_id: d.organization_id,
            triggers: v.definition.triggers ?? [],
            collection: v.definition.subject?.collection ?? null,
            timezone: store.timezone ?? null,
          };
        })
        .filter((r) => (r.triggers as any[]).some((t) => t.kind === 'record_date'));
    });
    // Emulates the window query over the records of one collection.
    kit.db.rawHandlers.push((text, values) => {
      if (!text.includes('FROM workflow_records')) return undefined;
      const [field, storeId, collectionId, lastId, from, until, limit] = values as [
        string, number, number, number, string, string, number,
      ];
      return kit.db
        .table('workflow_records')
        .filter((r) => r.store_id === storeId && r.collection_id === collectionId)
        .filter((r) => r.archived_at === null && r.id > lastId)
        // Object.assign keeps the row's index signature (a spread would drop it).
        .map((r) => Object.assign({}, r, { date: r.data?.[field] }))
        .filter((r) => typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date))
        .filter((r) => r.date >= from && r.date <= until)
        .sort((a, b) => a.id - b.id)
        .slice(0, limit);
    });
    addCollection(1, 'contratos');
    cron = new WorkflowRecordDateCron(kit.prisma, kit.engine);
  });
  afterEach(() => jest.restoreAllMocks());

  it('starts one request per record whose date is today + days_before, with the record as subject and its fields in the map', async () => {
    seedDefinition(kit.db, renewalDefinition());
    addRecord(1, 1, 'contratos', { cliente: 'Acme', vence: IN_30_DAYS });

    expect(await cron.runOnce(NOW)).toBe(1);

    expect(instances()).toHaveLength(1);
    expect(instances()[0]).toMatchObject({
      started_by_type: 'system',
      subject_type: 'custom_record',
      subject_id: 1,
      data: { reason: 'Acme · REG-000001' },
    });
    const started = kit.db.table('workflow_instance_events').find((e: any) => e.type === 'started')!;
    expect(started.payload).toMatchObject({
      via: 'record_date',
      record_id: 1,
      field: 'vence',
      date: IN_30_DAYS,
    });
  });

  it('starts exactly once per record and date: the second run replays', async () => {
    seedDefinition(kit.db, renewalDefinition());
    addRecord(1, 1, 'contratos', { cliente: 'Acme', vence: IN_30_DAYS });

    expect(await cron.runOnce(NOW)).toBe(1);
    expect(await cron.runOnce(new Date(NOW.getTime() + 3_600_000))).toBe(0);

    expect(instances()).toHaveLength(1);
  });

  it('honors days_before as a window: 31 days away and past dates do not start, 0 days starts on the same day', async () => {
    seedDefinition(kit.db, renewalDefinition({ days_before: 0, key: 'hoy' }));
    addRecord(1, 1, 'contratos', { cliente: 'A', vence: '2026-11-08' });
    addRecord(2, 1, 'contratos', { cliente: 'B', vence: '2026-11-07' });
    addRecord(3, 1, 'contratos', { cliente: 'C', vence: '2026-11-06' });

    expect(await cron.runOnce(NOW)).toBe(1);
    expect(instances().map((i) => i.subject_id)).toEqual([2]);

    seedDefinition(kit.db, renewalDefinition({ days_before: 30, key: 'mes' }));
    addRecord(4, 1, 'contratos', { cliente: 'D', vence: '2026-12-08' });
    addRecord(5, 1, 'contratos', { cliente: 'E', vence: 'pronto' });
    // 30-day flow: today (2) .. 2026-12-07; 1 (tomorrow) also falls inside.
    expect(await cron.runOnce(NOW)).toBe(2);
    expect(instances().map((i) => i.subject_id).sort()).toEqual([1, 2, 2]);
  });

  it('a record created inside the window (20 days away on a 30-day flow) starts once, keyed by its date', async () => {
    seedDefinition(kit.db, renewalDefinition({ days_before: 30 }));
    addRecord(1, 1, 'contratos', { cliente: 'Tarde', vence: '2026-11-27' });

    expect(await cron.runOnce(NOW)).toBe(1);
    expect(await cron.runOnce(new Date(NOW.getTime() + 86_400_000))).toBe(0);

    expect(instances()).toHaveLength(1);
    const started = kit.db.table('workflow_instance_events').find((e: any) => e.type === 'started')!;
    expect(started.payload).toMatchObject({ record_id: 1, field: 'vence', date: '2026-11-27' });

    // Moving the date starts a new request for the new date.
    kit.db.table('workflow_records')[0].data.vence = '2026-11-30';
    expect(await cron.runOnce(NOW)).toBe(1);
    expect(instances()).toHaveLength(2);
  });

  it('skips archived records, switched-off flows, flows of another collection and records of other stores', async () => {
    seedDefinition(kit.db, renewalDefinition());
    const off = seedDefinition(kit.db, renewalDefinition({ key: 'apagado' }));
    kit.db.table('workflow_definitions').find((d) => d.id === off.definitionId)!.is_enabled = false;
    seedDefinition(kit.db, renewalDefinition({ key: 'polizas', collection: 'polizas' }));
    addCollection(2, 'polizas');
    addCollection(3, 'contratos', 2);
    addRecord(1, 1, 'contratos', { cliente: 'Archivado', vence: IN_30_DAYS }, { archived_at: new Date() });
    addRecord(2, 3, 'contratos', { cliente: 'Otra tienda', vence: IN_30_DAYS }, {}, 2);
    // Only the contratos flow of store 1 may react to this one; the polizas flow must not.
    addRecord(3, 1, 'contratos', { cliente: 'Vigente', vence: IN_30_DAYS });

    expect(await cron.runOnce(NOW)).toBe(1);

    expect(instances()).toHaveLength(1);
    expect(instances()[0]).toMatchObject({ subject_id: 3 });
  });

  it('skips the records of an archived collection', async () => {
    seedDefinition(kit.db, renewalDefinition());
    kit.db.table('workflow_collections')[0].is_archived = true;
    addRecord(1, 1, 'contratos', { cliente: 'Acme', vence: IN_30_DAYS });

    expect(await cron.runOnce(NOW)).toBe(0);
    expect(instances()).toHaveLength(0);
  });

  it('uses the time zone of the store to decide what today is', async () => {
    seedDefinition(kit.db, renewalDefinition());
    addRecord(1, 1, 'contratos', { cliente: 'Acme', vence: '2026-12-08' });
    // 2026-11-08T03:00Z is Nov 7 22:00 in Bogota (today = Nov 7) and Nov 8 16:00 in Auckland.
    const lateNight = new Date('2026-11-08T03:00:00Z');
    kit.db.table('stores')[0].timezone = 'America/Bogota';
    expect(await cron.runOnce(lateNight)).toBe(0);

    kit.db.table('stores')[0].timezone = 'Pacific/Auckland';
    expect(await cron.runOnce(lateNight)).toBe(1);
    expect(instances()).toHaveLength(1);
  });

  it('logs and continues when one record fails', async () => {
    seedDefinition(kit.db, renewalDefinition());
    addRecord(1, 1, 'contratos', { cliente: 'Falla', vence: IN_30_DAYS });
    addRecord(2, 1, 'contratos', { cliente: 'Sigue', vence: IN_30_DAYS });
    const real = kit.engine.startExternal.bind(kit.engine);
    jest.spyOn(kit.engine, 'startExternal').mockImplementation((input) => {
      if (input.subject?.id === 1) return Promise.reject(new Error('boom'));
      return real(input);
    });
    const warn = jest.spyOn((cron as any).logger, 'warn').mockImplementation(() => undefined);

    expect(await cron.runOnce(NOW)).toBe(1);

    expect(instances()).toHaveLength(1);
    expect(instances()[0]).toMatchObject({ subject_id: 2 });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('record 1'));
  });
});
