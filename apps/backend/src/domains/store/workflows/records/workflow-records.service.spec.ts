import { ErrorCodes, VendixHttpException } from '@common/errors';
import { WorkflowDefinitionV1 } from '@common/workflows/contract';
import {
  buildWorkflowKit,
  purchaseDefinition,
  seedDefinition,
  seedPeople,
} from '../../../../testing/workflows/workflow-test-kit';
import { WorkflowAuditRow, WorkflowAuditService } from '../audit/workflow-audit.service';
import { WorkflowCollectionsService } from './workflow-collections.service';
import { WorkflowRecordsService } from './workflow-records.service';
import {
  prefillFlowFields,
  validateRecordValues,
  zonedDatePlus,
} from './workflow-record-fields';

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

const PDF = Buffer.from('%PDF-1.4\nbody');
const pdf = (name = 'a.pdf') => ({ buffer: PDF, originalname: name, mimetype: 'application/pdf' });

const FIELDS = [
  { key: 'cliente', label: 'Cliente', type: 'text', required: true },
  { key: 'valor', label: 'Valor', type: 'money' },
  { key: 'vence', label: 'Vence', type: 'date' },
  { key: 'estado', label: 'Estado', type: 'select', options: [{ value: 'a', label: 'Activo' }] },
  { key: 'activo', label: 'Activo', type: 'boolean' },
  { key: 'correo', label: 'Correo', type: 'email' },
];

describe('WorkflowRecordsService (P3.6)', () => {
  let kit: ReturnType<typeof buildWorkflowKit>;
  let collections: WorkflowCollectionsService;
  let svc: WorkflowRecordsService;
  let collectionId: number;

  beforeEach(async () => {
    kit = buildWorkflowKit();
    seedPeople(kit.db);
    kit.db.table('stores').forEach((st) => (st.slug = 'tienda'));
    kit.db.insert('organizations', { id: 1, slug: 'acme' });
    // Emulates the atomic `UPDATE ... RETURNING next_number - 1`.
    kit.db.rawHandlers.push((text, values) => {
      if (!text.includes('UPDATE workflow_collections')) return undefined;
      const row = kit.db
        .table('workflow_collections')
        .find((c) => c.id === values[0] && c.store_id === values[1]);
      if (!row) return [];
      row.next_number += 1;
      return [{ n: row.next_number - 1 }];
    });
    collections = new WorkflowCollectionsService(kit.prisma);
    svc = new WorkflowRecordsService(
      kit.prisma,
      collections,
      kit.dossiers,
      kit.storedFiles,
      kit.engine,
      kit.workflowAudit,
    );
    kit.as({ is_owner: true, permissions: [] });
    collectionId = (
      await collections.create({
        name: 'Contratos',
        item_name: 'Contrato',
        key: 'contratos',
        fields: FIELDS as any,
        title_field: 'cliente',
      })
    ).id;
  });
  afterEach(() => jest.restoreAllMocks());

  it('creates a record validating types and required, and numbers references sequentially', async () => {
    const bad = await failure(svc.create({ collection_id: collectionId, values: { valor: 'mucho', vence: '2026-02-31', correo: 'x', desconocido: 1 } }));
    expect(bad?.code).toBe('WORKFLOW_RECORD_INVALID');
    expect(bad?.details.errors.map((e: any) => e.field).sort()).toEqual([
      'cliente', // required
      'correo',
      'desconocido',
      'valor',
      'vence',
    ]);
    expect(kit.db.table('workflow_records')).toHaveLength(0);

    const a = await svc.create({ collection_id: collectionId, values: { cliente: 'Acme', valor: '1500', vence: '2026-12-07', estado: 'a', activo: false } });
    const b = await svc.create({ collection_id: collectionId, values: { cliente: 'Beta' } });
    expect(a).toMatchObject({
      reference: 'CON-000001',
      title: 'Acme',
      values: { cliente: 'Acme', valor: 1500, vence: '2026-12-07', estado: 'a', activo: false },
    });
    expect(b).toMatchObject({ reference: 'CON-000002', title: 'Beta' });
  });

  it('the title falls back to the reference when the collection has no title field', async () => {
    const other = await collections.create({
      name: 'Pólizas',
      item_name: 'Póliza',
      key: 'polizas',
      fields: [{ key: 'numero', label: 'Número', type: 'text' }] as any,
    });
    const r = await svc.create({ collection_id: other.id, values: {} });
    expect(r).toMatchObject({ reference: 'POL-000001', title: 'POL-000001' });
  });

  it('update merges values, null clears an optional one, and the title follows the title field', async () => {
    const r = await svc.create({ collection_id: collectionId, values: { cliente: 'Acme', valor: 10 } });
    const updated = await svc.update(r.id, { values: { cliente: 'Acme SAS', valor: null } });
    expect(updated).toMatchObject({ title: 'Acme SAS', reference: r.reference, values: { cliente: 'Acme SAS' } });
    expect((await failure(svc.update(r.id, { values: { cliente: null } })))?.code).toBe('WORKFLOW_RECORD_INVALID');
  });

  it('a record keeps being editable after a field is removed from the collection', async () => {
    const r = await svc.create({
      collection_id: collectionId,
      values: { cliente: 'Acme', correo: 'ana@acme.co' },
    });
    await collections.update(collectionId, {
      fields: FIELDS.filter((f) => f.key !== 'correo') as any,
    });
    const updated = await svc.update(r.id, { values: { cliente: 'Acme SAS' } });
    expect(updated).toMatchObject({ title: 'Acme SAS', values: { cliente: 'Acme SAS' } });
    // The removed field's value is kept (not validated, not lost).
    expect(updated.values).toMatchObject({ correo: 'ana@acme.co' });
    // A value for a field that is not declared is still rejected.
    const bad = await failure(svc.update(r.id, { values: { correo: 'otro@acme.co' } }));
    expect(bad?.code).toBe('WORKFLOW_RECORD_INVALID');
    // Null clears the retired value.
    const cleared = await svc.update(r.id, { values: { correo: null } });
    expect(cleared.values).not.toHaveProperty('correo');
  });

  it('lists with case-insensitive search by title or reference, pagination and sort', async () => {
    for (const cliente of ['Alfa', 'Beta', 'Gamma alfa']) {
      await svc.create({ collection_id: collectionId, values: { cliente } });
    }
    const found = await svc.list({ collection_id: collectionId, search: 'ALFA', sort_by: 'title', sort_order: 'asc' });
    expect(found.data.map((r) => r.title)).toEqual(['Alfa', 'Gamma alfa']);
    expect(found.total).toBe(2);
    const byRef = await svc.list({ collection_id: collectionId, search: 'con-000002' });
    expect(byRef.data.map((r) => r.title)).toEqual(['Beta']);
    const page = await svc.list({ collection_id: collectionId, sort_by: 'title', sort_order: 'desc', page: 2, limit: 2 });
    expect(page.data.map((r) => r.title)).toEqual(['Alfa']);
    expect(page.total).toBe(3);
  });

  it('archives instead of deleting: the record leaves the list and cannot be read as active', async () => {
    const r = await svc.create({ collection_id: collectionId, values: { cliente: 'Acme' } });
    await svc.archive(r.id);
    expect(kit.db.table('workflow_records')).toHaveLength(1);
    expect((await svc.list({ collection_id: collectionId })).data).toHaveLength(0);
    expect((await svc.list({ collection_id: collectionId, include_archived: true })).data).toHaveLength(1);
    expect((await failure(svc.get(r.id)))?.code).toBe('WORKFLOW_RECORD_NOT_FOUND');
    expect((await failure(svc.create({ collection_id: collectionId + 99, values: {} })))?.code).toBe('WORKFLOW_COLLECTION_NOT_FOUND');
  });

  it('an archived record listed with include_archived can be opened read-only with the same flag', async () => {
    const r = await svc.create({ collection_id: collectionId, values: { cliente: 'Acme' } });
    await svc.archive(r.id);
    const detail = await svc.get(r.id, { include_archived: true });
    expect(detail).toMatchObject({ id: r.id, title: 'Acme', archived_at: expect.any(Date) });
    expect((await failure(svc.update(r.id, { values: { cliente: 'Otra' } })))?.code).toBe('WORKFLOW_RECORD_NOT_FOUND');
  });

  it('refuses to create records in an archived collection', async () => {
    await collections.archive(collectionId);
    const f = await failure(svc.create({ collection_id: collectionId, values: { cliente: 'Acme' } }));
    expect(f?.code).toBe('WORKFLOW_COLLECTION_ARCHIVED');
  });

  it('isolates stores: a foreign collection or record is a 404 on every operation', async () => {
    const r = await svc.create({ collection_id: collectionId, values: { cliente: 'Acme' } });
    kit.as({ store_id: 2 });
    const code = async (p: Promise<unknown>) => (await failure(p))?.code;
    expect(await code(svc.list({ collection_id: collectionId }))).toBe('WORKFLOW_COLLECTION_NOT_FOUND');
    expect(await code(svc.create({ collection_id: collectionId, values: { cliente: 'x' } }))).toBe('WORKFLOW_COLLECTION_NOT_FOUND');
    expect(await code(svc.get(r.id))).toBe('WORKFLOW_RECORD_NOT_FOUND');
    expect(await code(svc.update(r.id, { values: { cliente: 'x' } }))).toBe('WORKFLOW_RECORD_NOT_FOUND');
    expect(await code(svc.archive(r.id))).toBe('WORKFLOW_RECORD_NOT_FOUND');
    expect(await code(svc.uploadFile(r.id, pdf()))).toBe('WORKFLOW_RECORD_NOT_FOUND');
    expect(await code(svc.downloadFile(r.id, 1))).toBe('WORKFLOW_RECORD_NOT_FOUND');
    expect(await code(svc.startFlow(r.id, 1))).toBe('WORKFLOW_RECORD_NOT_FOUND');
    expect(kit.db.table('workflow_records')[0].title).toBe('Acme');
  });

  describe('dossier', () => {
    it('uploads files to the record dossier (created with the first file) without superseding earlier ones', async () => {
      const r = await svc.create({ collection_id: collectionId, values: { cliente: 'Acme' } });
      expect((await svc.get(r.id)).dossier).toBeNull();

      // Each upload locks the record row before looking up its dossier, so two
      // first uploads at once wait for each other instead of creating two dossiers.
      const locks: unknown[][] = [];
      kit.db.rawHandlers.push((text, values) => {
        if (!(text.includes('FROM workflow_records') && text.includes('FOR NO KEY UPDATE'))) return undefined;
        locks.push(values);
        return [{ id: values[0] }];
      });
      const first = await svc.uploadFile(r.id, pdf('contrato.pdf'));
      const second = await svc.uploadFile(r.id, pdf('anexo.pdf'));
      expect(locks).toEqual([
        [r.id, 1],
        [r.id, 1],
      ]);

      const dossiers = kit.db.table('dossiers');
      expect(dossiers).toHaveLength(1);
      expect(dossiers[0]).toMatchObject({
        subject_type: 'custom_record',
        subject_id: r.id,
        workflow_instance_id: null,
        reference: 'EXP-000001',
      });
      const detail = await svc.get(r.id);
      expect(detail.dossier?.items.map((i: any) => [i.file?.original_name, i.status])).toEqual([
        ['contrato.pdf', 'received'],
        ['anexo.pdf', 'received'],
      ]);
      expect(first.file_id).not.toBe(second.file_id);
    });

    it('requires a file and discards the stored object when the dossier write fails', async () => {
      const r = await svc.create({ collection_id: collectionId, values: { cliente: 'Acme' } });
      expect((await failure(svc.uploadFile(r.id, undefined)))?.code).toBe('DOCUMENT_FILE_REQUIRED');
      jest.spyOn(kit.dossiers, 'addFileItem').mockRejectedValueOnce(new Error('db down'));
      expect((await failure(svc.uploadFile(r.id, pdf())))?.code).toBe('OTHER:db down');
      expect(kit.s3.deleteFile).toHaveBeenCalled();
    });

    it('downloads only files of the record dossier', async () => {
      const a = await svc.create({ collection_id: collectionId, values: { cliente: 'A' } });
      const b = await svc.create({ collection_id: collectionId, values: { cliente: 'B' } });
      const fa = await svc.uploadFile(a.id, pdf());
      const fb = await svc.uploadFile(b.id, pdf());
      expect((await svc.downloadFile(a.id, fa.file_id)).url).toContain('https://signed.example/');
      expect((await failure(svc.downloadFile(a.id, fb.file_id)))?.code).toBe('DOCUMENT_NOT_FOUND');
      expect((await failure(svc.downloadFile(a.id, 9999)))?.code).toBe('DOCUMENT_NOT_FOUND');
    });

    describe('download audit (P7.2)', () => {
      let audit: WorkflowAuditService;
      let audited: WorkflowRecordsService;
      const rows = () => kit.db.table('workflow_audit_log') as WorkflowAuditRow[];

      beforeEach(() => {
        audit = new WorkflowAuditService(kit.prisma);
        audited = new WorkflowRecordsService(kit.prisma, collections, kit.dossiers, kit.storedFiles, kit.engine, audit);
      });

      it('writes document.file_downloaded before the signed URL exists', async () => {
        const r = await audited.create({ collection_id: collectionId, values: { cliente: 'A' } });
        const f = await audited.uploadFile(r.id, pdf('contrato.pdf'));
        const order: string[] = [];
        const record = audit.recordNow.bind(audit);
        jest.spyOn(audit, 'recordNow').mockImplementation(async (input) => {
          order.push('audit');
          return record(input);
        });
        kit.s3.getPresignedUrl.mockImplementation(async (key: string) => {
          order.push('url');
          return `https://signed.example/${key}`;
        });

        await audited.downloadFile(r.id, f.file_id);

        expect(order).toEqual(['audit', 'url']);
        expect(rows()).toHaveLength(1);
        expect(rows()[0]).toMatchObject({
          action: 'document.file_downloaded',
          category: 'document',
          target_type: 'file',
          target_id: String(f.file_id),
          summary: `Descargó el archivo «contrato.pdf» del expediente del registro ${r.id}`,
        });
        expect(rows()[0].details).toMatchObject({ record_id: r.id, file_name: 'contrato.pdf' });
        expect(JSON.stringify(rows()[0].details)).not.toContain('signed.example');
      });

      it('returns no URL when the access cannot be audited', async () => {
        const r = await audited.create({ collection_id: collectionId, values: { cliente: 'A' } });
        const f = await audited.uploadFile(r.id, pdf());
        kit.s3.getPresignedUrl.mockClear();
        jest.spyOn(audit, 'recordNow').mockRejectedValue(new VendixHttpException(ErrorCodes.WORKFLOW_AUDIT_UNAVAILABLE));

        expect((await failure(audited.downloadFile(r.id, f.file_id)))?.code).toBe('WORKFLOW_AUDIT_UNAVAILABLE');
        expect(kit.s3.getPresignedUrl).not.toHaveBeenCalled();
      });

      it('a file outside the record dossier is a 404 with no audit row', async () => {
        const a = await audited.create({ collection_id: collectionId, values: { cliente: 'A' } });
        const b = await audited.create({ collection_id: collectionId, values: { cliente: 'B' } });
        const fb = await audited.uploadFile(b.id, pdf());
        expect((await failure(audited.downloadFile(a.id, fb.file_id)))?.code).toBe('DOCUMENT_NOT_FOUND');
        expect(rows()).toHaveLength(0);
      });
    });
  });

  describe('flows on a record', () => {
    const flow = (collection: string, key = 'renovacion'): WorkflowDefinitionV1 =>
      purchaseDefinition({
        key,
        name: 'Renovación de contrato',
        subject: { type: 'custom_record', collection },
      } as Partial<WorkflowDefinitionV1>);

    // The engine filters custom-record subjects through this relation.
    const seedRelation = () => {
      for (const row of kit.db.table('workflow_records')) {
        row.collection = { key: 'contratos', store_id: row.store_id };
      }
    };

    it('starts the flow with the record as subject and pre-fills same-key compatible fields', async () => {
      const other = await collections.create({
        name: 'Convenios',
        item_name: 'Convenio',
        key: 'convenios',
        fields: [
          { key: 'amount', label: 'Monto', type: 'money' },
          { key: 'reason', label: 'Motivo', type: 'text' },
          { key: 'invoice', label: 'Factura', type: 'text' },
          { key: 'fecha', label: 'Fecha', type: 'date' },
        ] as any,
      });
      const r = await svc.create({ collection_id: other.id, values: { amount: 1500, reason: 'Renovar', invoice: 'F-1', fecha: '2026-12-07' } });
      kit.db.table('workflow_records')[0].collection = { key: 'convenios', store_id: 1 };
      const { definitionId } = seedDefinition(kit.db, flow('convenios'));

      const result = await svc.startFlow(r.id, definitionId, 'k1');

      expect(result.instance).toMatchObject({
        subject_type: 'custom_record',
        subject_id: r.id,
        // `invoice` is a file in the flow: a text value is not copied; `fecha` has no same-key flow field.
        data: { amount: 1500, reason: 'Renovar' },
      });
      expect(result.instance.data).not.toHaveProperty('invoice');
    });

    it('rejects a flow of another collection and creates nothing', async () => {
      const r = await svc.create({ collection_id: collectionId, values: { cliente: 'Acme' } });
      seedRelation();
      const { definitionId } = seedDefinition(kit.db, flow('polizas'));
      const f = await failure(svc.startFlow(r.id, definitionId));
      expect(f?.code).toBe('WORKFLOW_SUBJECT_NOT_FOUND');
      expect(kit.db.table('workflow_instances')).toHaveLength(0);
    });

    it('rejects a flow without a custom-record subject, an unknown flow and a foreign flow', async () => {
      const r = await svc.create({ collection_id: collectionId, values: { cliente: 'Acme' } });
      seedRelation();
      const plain = seedDefinition(kit.db, purchaseDefinition({ key: 'plain' }));
      const foreign = seedDefinition(kit.db, flow('contratos', 'ajena'), 2);
      expect((await failure(svc.startFlow(r.id, plain.definitionId)))?.code).toBe('WORKFLOW_SUBJECT_NOT_FOUND');
      expect((await failure(svc.startFlow(r.id, 9999)))?.code).toBe('WORKFLOW_DEFINITION_NOT_FOUND');
      expect((await failure(svc.startFlow(r.id, foreign.definitionId)))?.code).toBe('WORKFLOW_DEFINITION_NOT_FOUND');
    });

    it('the detail lists the requests that have the record as subject', async () => {
      const r = await svc.create({ collection_id: collectionId, values: { cliente: 'Acme' } });
      seedRelation();
      const { definitionId } = seedDefinition(kit.db, flow('contratos'));
      const started = await svc.startFlow(r.id, definitionId, 'k2');
      await svc.uploadFile(r.id, pdf('contrato.pdf'));

      const detail = await svc.get(r.id);

      expect(detail.instances).toEqual([
        expect.objectContaining({
          id: started.instance.id,
          reference: started.instance.reference,
          status: 'active',
          definition_name: 'Renovación de contrato',
        }),
      ]);
      expect(detail.dossier?.items).toHaveLength(1);
      expect(detail.collection).toMatchObject({ key: 'contratos', title_field: 'cliente' });
      expect(detail.values).toEqual({ cliente: 'Acme' });
      // Only published, switched-on flows of this collection can be started from the record.
      const off = seedDefinition(kit.db, flow('contratos', 'apagado'));
      kit.db.table('workflow_definitions').find((d) => d.id === off.definitionId)!.is_enabled = false;
      seedDefinition(kit.db, flow('polizas', 'polizas'));
      expect((await svc.get(r.id)).flows).toEqual([
        expect.objectContaining({ id: definitionId, key: 'renovacion' }),
      ]);
    });
  });
});

describe('record field helpers (P3.6)', () => {
  it('validateRecordValues keeps false for a required boolean and drops blank optionals', () => {
    const r = validateRecordValues(
      [
        { key: 'ok', label: 'Ok', type: 'boolean', required: true },
        { key: 'nota', label: 'Nota', type: 'textarea' },
      ],
      { ok: false, nota: '  ' },
    );
    expect(r).toEqual({ ok: true, values: { ok: false } });
  });

  it('prefillFlowFields copies same-key compatible values only', () => {
    const out = prefillFlowFields(
      [
        { key: 'a', label: 'A', type: 'text' },
        { key: 'b', label: 'B', type: 'date' },
        { key: 'c', label: 'C', type: 'select', options: [{ value: 'x', label: 'X' }] },
        { key: 'd', label: 'D', type: 'money' },
      ],
      { a: 'hola', b: '2026-01-01', c: 'x', d: 5 },
      [
        { key: 'a', type: 'textarea' },
        { key: 'b', type: 'text' },
        { key: 'c', type: 'select', options: [{ value: 'y' }] },
        { key: 'd', type: 'number' },
      ],
    );
    expect(out).toEqual({ a: 'hola', d: 5 });
  });

  it('zonedDatePlus uses the calendar day of the zone', () => {
    const at = new Date('2026-11-08T03:00:00Z');
    expect(zonedDatePlus(at, 'America/Bogota', 30)).toBe('2026-12-07');
    expect(zonedDatePlus(at, 'Pacific/Auckland', 0)).toBe('2026-11-08');
  });
});
