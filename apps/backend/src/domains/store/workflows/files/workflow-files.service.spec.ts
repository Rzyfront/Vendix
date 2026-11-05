import { VendixHttpException } from '@common/errors';
import { WorkflowDefinitionV1 } from '@common/workflows/contract';
import {
  buildWorkflowKit,
  seedDefinition,
  seedPeople,
} from '../../../../testing/workflows/workflow-test-kit';

const PDF = Buffer.from('%PDF-1.4\nbody');
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('x'),
]);
const pdf = (name = 'a.pdf') => ({ buffer: PDF, originalname: name, mimetype: 'application/pdf' });

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    return e instanceof VendixHttpException ? e.errorCode : `OTHER:${(e as Error).message}`;
  }
}

/** intake(form, initiator) → review(approval, manager) → done. */
function docsDefinition(): WorkflowDefinitionV1 {
  return {
    schema: 'vendix.workflow/v1',
    key: 'docs',
    name: 'Trámite',
    fields: [
      { key: 'title', type: 'text', label: 'Asunto' },
      { key: 'invoice', type: 'file', label: 'Factura', accept: ['application/pdf'], max_size_mb: 1 },
      { key: 'photo', type: 'file', label: 'Foto', accept: ['image/*'] },
    ],
    stages: [
      {
        key: 'intake',
        name: 'Radicación',
        type: 'form',
        start: true,
        assignee: { kind: 'initiator' },
        form: { fields: ['title', 'invoice'] },
        requirements: [
          { kind: 'upload', key: 'rut', label: 'RUT', accept: ['application/pdf'] },
          { kind: 'upload', key: 'extra', label: 'Anexo opcional', blocks_exit: false },
          { kind: 'file_field', key: 'inv', label: 'Factura', field: 'invoice' },
        ],
        transitions: [{ on: 'submit', to: 'review' }],
      },
      {
        key: 'review',
        name: 'Revisión',
        type: 'approval',
        assignee: { kind: 'role', role_key: 'manager' },
        requirements: [{ kind: 'upload', key: 'acta', label: 'Acta' }],
        transitions: [
          { on: 'approve', to: 'done' },
          { on: 'reject', to: 'done' },
        ],
      },
      { key: 'done', name: 'Fin', type: 'end', outcome: 'completed' },
    ],
  } as unknown as WorkflowDefinitionV1;
}

describe.each([
  ['tx con scope', false],
  ['tx sin scope (solo predicados explícitos)', true],
])('Documentos de una solicitud · %s', (_label, unscopedTx) => {
  let kit: ReturnType<typeof buildWorkflowKit>;
  let instanceId: number;

  const intakeTask = () =>
    kit.db.table('workflow_tasks').find((t) => t.instance_id === instanceId && t.stage_key === 'intake')!;
  const submit = (values: Record<string, unknown> = {}) =>
    kit.engine.completeTask({
      taskId: intakeTask().id,
      outcome: 'submit',
      values,
      expectedRowVersion: kit.db.table('workflow_instances')[0].row_version,
    });
  const req = (key = 'rut') => ({ requirement_key: key });
  const field = (key = 'invoice') => ({ field_key: key });

  beforeEach(async () => {
    kit = buildWorkflowKit({ unscopedTx });
    seedPeople(kit.db);
    kit.db.table('stores').forEach((s) => (s.slug = 'tienda'));
    kit.db.insert('organizations', { id: 1, slug: 'acme' });
    seedDefinition(kit.db, docsDefinition());
    kit.as({ user_id: 4 });
    instanceId = (await kit.engine.start({ definitionKey: 'docs' })).instance.id;
  });
  afterEach(() => jest.restoreAllMocks());

  describe('expediente', () => {
    it('start crea un expediente EXP- atado a la solicitud, en la misma transacción', async () => {
      expect(kit.db.table('dossiers')).toHaveLength(1);
      expect(kit.db.table('dossiers')[0]).toMatchObject({
        reference: 'EXP-000001',
        workflow_instance_id: instanceId,
        store_id: 1,
      });
    });

    it('si el start falla, no queda expediente huérfano', async () => {
      kit.db.table('workflow_definitions')[0].status = 'draft';
      kit.as({ user_id: 4 });
      expect(await codeOf(kit.engine.start({ definitionKey: 'docs' }))).toBe('WORKFLOW_NOT_ACTIVE');
      expect(kit.db.table('dossiers')).toHaveLength(1);
    });

    it('el detalle de la solicitud trae el expediente, los requisitos de la etapa y los pendientes', async () => {
      await kit.workflowFiles.upload(instanceId, pdf(), req());
      const detail = await kit.instances.get(instanceId);
      expect(detail.dossier).toMatchObject({ reference: 'EXP-000001' });
      expect(detail.dossier!.items).toHaveLength(1);
      expect(detail.dossier!.items[0]).toMatchObject({
        requirement_key: 'rut',
        status: 'received',
        file: { original_name: 'a.pdf', mime_type: 'application/pdf' },
      });
      expect(detail.pending_requirements).toEqual([{ key: 'inv', label: 'Factura' }]);
      expect(detail.stage!.requirements.map((r: any) => [r.key, r.blocks_exit])).toEqual([
        ['rut', true],
        ['extra', false],
        ['inv', true],
      ]);
    });
  });

  describe('requisito upload conectado al motor', () => {
    it('pendiente → WORKFLOW_REQUIREMENT_PENDING; al subir el archivo el avance sí ocurre', async () => {
      const f = await kit.workflowFiles.upload(instanceId, pdf(), field());
      const blocked: any = await submit({ invoice: f.file_id }).catch((e) => e);
      expect(blocked.errorCode).toBe('WORKFLOW_REQUIREMENT_PENDING');
      expect(blocked.getResponse().details.pending).toEqual([{ key: 'rut', label: 'RUT' }]);
      expect(kit.db.table('workflow_instances')[0].current_stage_key).toBe('intake');

      await kit.workflowFiles.upload(instanceId, pdf('rut.pdf'), req());
      const done = await submit({ invoice: f.file_id });
      expect(done.instance.current_stage_key).toBe('review');
    });

    it('blocks_exit:false no bloquea y no se reporta como pendiente', async () => {
      const detail = await kit.instances.get(instanceId);
      expect(detail.pending_requirements.map((p: any) => p.key)).not.toContain('extra');
    });

    it('un archivo reemplazado sigue cumpliendo el requisito con el nuevo', async () => {
      const a = await kit.workflowFiles.upload(instanceId, pdf('1.pdf'), req());
      const b = await kit.workflowFiles.upload(instanceId, pdf('2.pdf'), req());
      const items = kit.db.table('dossier_items');
      expect(items.find((i) => i.id === a.item_id)!.status).toBe('superseded');
      expect(items.find((i) => i.id === b.item_id)).toMatchObject({
        status: 'received',
        supersedes_id: a.item_id,
      });
      expect(await kit.dossiers.hasActiveItem(kit.db.table('dossiers')[0].id, 'rut')).toBe(true);
    });

    it('file_field: el id debe ser un archivo de esta tienda dentro del expediente de la solicitud', async () => {
      await kit.workflowFiles.upload(instanceId, pdf('rut.pdf'), req());
      const foreign = kit.db.insert('stored_files', { store_id: 2, organization_id: 1, s3_key: 'k/foreign' });
      const loose = kit.db.insert('stored_files', { store_id: 1, organization_id: 1, s3_key: 'k/loose' });
      for (const id of [foreign.id, loose.id, 9999]) {
        const err: any = await submit({ invoice: id }).catch((e) => e);
        expect(err.errorCode).toBe('WORKFLOW_REQUIREMENT_PENDING');
        expect(err.getResponse().details.pending).toEqual([{ key: 'inv', label: 'Factura' }]);
      }
      const ok = await kit.workflowFiles.upload(instanceId, pdf('f.pdf'), field());
      expect((await submit({ invoice: ok.file_id })).instance.current_stage_key).toBe('review');
    });

    it('file_field con un archivo del expediente de OTRA solicitud también se rechaza', async () => {
      kit.as({ user_id: 5 });
      const other = (await kit.engine.start({ definitionKey: 'docs' })).instance.id;
      const theirs = await kit.workflowFiles.upload(other, pdf('x.pdf'), field());
      kit.as({ user_id: 4 });
      await kit.workflowFiles.upload(instanceId, pdf('rut.pdf'), req());
      const err: any = await submit({ invoice: theirs.file_id }).catch((e) => e);
      expect(err.errorCode).toBe('WORKFLOW_REQUIREMENT_PENDING');
    });
  });

  describe('POST files · validación del destino', () => {
    it('guarda bajo workflows/<id>/ y sin escribir instance.data', async () => {
      const r = await kit.workflowFiles.upload(instanceId, pdf(), field());
      expect(r).toMatchObject({
        field_key: 'invoice',
        requirement_key: null,
        stage_key: 'intake',
        mime_type: 'application/pdf',
      });
      expect(kit.db.table('stored_files')[0].s3_key).toContain(`/workflows/${instanceId}/`);
      expect(kit.db.table('workflow_instances')[0].data).not.toHaveProperty('invoice');
    });

    it('requirement_key XOR field_key', async () => {
      expect(await codeOf(kit.workflowFiles.upload(instanceId, pdf(), {}))).toBe('DOCUMENT_TARGET_INVALID');
      expect(
        await codeOf(kit.workflowFiles.upload(instanceId, pdf(), { requirement_key: 'rut', field_key: 'invoice' })),
      ).toBe('DOCUMENT_TARGET_INVALID');
      expect(await codeOf(kit.workflowFiles.upload(instanceId, undefined, req()))).toBe('DOCUMENT_FILE_REQUIRED');
      expect(kit.s3.uploadFile).not.toHaveBeenCalled();
    });

    it('un requisito de OTRA etapa se rechaza', async () => {
      expect(await codeOf(kit.workflowFiles.upload(instanceId, pdf(), req('acta')))).toBe('DOCUMENT_TARGET_INVALID');
      expect(await codeOf(kit.workflowFiles.upload(instanceId, pdf(), req('nope')))).toBe('DOCUMENT_TARGET_INVALID');
      // `inv` es un requisito file_field, no upload.
      expect(await codeOf(kit.workflowFiles.upload(instanceId, pdf(), req('inv')))).toBe('DOCUMENT_TARGET_INVALID');
      expect(kit.s3.uploadFile).not.toHaveBeenCalled();
    });

    it('field_key: debe ser un campo file del formulario de la etapa actual', async () => {
      // `title` no es file; `photo` es file pero no está en el formulario de la etapa.
      expect(await codeOf(kit.workflowFiles.upload(instanceId, pdf(), field('title')))).toBe('DOCUMENT_TARGET_INVALID');
      expect(await codeOf(kit.workflowFiles.upload(instanceId, pdf(), field('photo')))).toBe('DOCUMENT_TARGET_INVALID');
      expect(await codeOf(kit.workflowFiles.upload(instanceId, pdf(), field('zzz')))).toBe('DOCUMENT_TARGET_INVALID');
    });

    it('usa accept y max_size_mb del requisito/campo', async () => {
      expect(
        await codeOf(
          kit.workflowFiles.upload(instanceId, { buffer: PNG, originalname: 'a.png', mimetype: 'image/png' }, req()),
        ),
      ).toBe('DOCUMENT_TYPE_NOT_ALLOWED');
      const big = Buffer.concat([PDF, Buffer.alloc(1024 * 1024)]);
      expect(
        await codeOf(
          kit.workflowFiles.upload(instanceId, { buffer: big, originalname: 'big.pdf', mimetype: 'application/pdf' }, field()),
        ),
      ).toBe('DOCUMENT_TOO_LARGE');
      expect(await codeOf(kit.workflowFiles.upload(instanceId, { ...pdf(), buffer: PNG }, req()))).toBe(
        'DOCUMENT_TYPE_MISMATCH',
      );
    });

    it('una solicitud cerrada no recibe archivos', async () => {
      kit.as({ user_id: 1, is_owner: true } as any);
      await kit.engine.cancel({ instanceId, reason: 'x' });
      expect(await codeOf(kit.workflowFiles.upload(instanceId, pdf(), req()))).toBe('WORKFLOW_INSTANCE_CLOSED');
    });

    it('si el expediente falla tras subir, se compensa: fila y objeto borrados', async () => {
      jest.spyOn(kit.dossiers, 'addFileItem').mockRejectedValueOnce(new Error('boom'));
      await expect(kit.workflowFiles.upload(instanceId, pdf(), req())).rejects.toThrow('boom');
      expect(kit.db.table('stored_files')).toHaveLength(0);
      expect(kit.s3.deleteFile).toHaveBeenCalledTimes(1);
      expect(kit.db.table('dossier_items')).toHaveLength(0);
    });

    it('una solicitud de otra tienda no existe (404)', async () => {
      kit.as({ store_id: 2, user_id: 7 });
      expect(await codeOf(kit.workflowFiles.upload(instanceId, pdf(), req()))).toBe('WORKFLOW_NOT_FOUND');
    });
  });

  describe('POST files · quién puede subir', () => {
    it('quien puede actuar en la tarea de la etapa actual sube; otro participante sin manage no', async () => {
      expect(await codeOf(kit.workflowFiles.upload(instanceId, pdf(), req()))).toBeUndefined();
      kit.as({ user_id: 5 });
      expect(await codeOf(kit.workflowFiles.upload(instanceId, pdf(), req()))).toBe('WORKFLOW_TASK_FORBIDDEN');
    });

    it('store:workflows:manage u owner pueden subir sin ser responsables', async () => {
      kit.as({ user_id: 5, permissions: ['store:workflows:manage'] });
      expect(await codeOf(kit.workflowFiles.upload(instanceId, pdf(), req()))).toBeUndefined();
      kit.as({ user_id: 1, permissions: [], is_owner: true } as any);
      expect(await codeOf(kit.workflowFiles.upload(instanceId, pdf(), req()))).toBeUndefined();
    });

    it('con la tarea ya completada el responsable anterior ya no puede subir a la etapa nueva', async () => {
      const f = await kit.workflowFiles.upload(instanceId, pdf(), field());
      await kit.workflowFiles.upload(instanceId, pdf(), req());
      await submit({ invoice: f.file_id });
      // Etapa `review`: asignada al rol manager (usuarios 2 y 3), no a 4.
      expect(await codeOf(kit.workflowFiles.upload(instanceId, pdf(), req('acta')))).toBe('WORKFLOW_TASK_FORBIDDEN');
      kit.as({ user_id: 2 });
      expect(await codeOf(kit.workflowFiles.upload(instanceId, pdf(), req('acta')))).toBeUndefined();
      // y el requisito de la etapa anterior ya no es válido
      expect(await codeOf(kit.workflowFiles.upload(instanceId, pdf(), req('rut')))).toBe('DOCUMENT_TARGET_INVALID');
    });

    it('el requisito `acta` conectado: aprobar sin acta → pendiente; con acta → completa', async () => {
      const f = await kit.workflowFiles.upload(instanceId, pdf(), field());
      await kit.workflowFiles.upload(instanceId, pdf(), req());
      await submit({ invoice: f.file_id });
      kit.as({ user_id: 2 });
      const task = kit.db.table('workflow_tasks').find((t) => t.stage_key === 'review')!;
      const row_version = kit.db.table('workflow_instances')[0].row_version;
      const err: any = await kit.engine
        .completeTask({ taskId: task.id, outcome: 'approve', expectedRowVersion: row_version })
        .catch((e) => e);
      expect(err.errorCode).toBe('WORKFLOW_REQUIREMENT_PENDING');
      await kit.workflowFiles.upload(instanceId, pdf('acta.pdf'), req('acta'));
      const r = await kit.engine.completeTask({ taskId: task.id, outcome: 'approve', expectedRowVersion: row_version });
      expect(r.instance.status).toBe('completed');
    });
  });

  describe('GET files/:id/download · permiso', () => {
    let fileId: number;
    beforeEach(async () => {
      fileId = (await kit.workflowFiles.upload(instanceId, pdf(), req())).file_id;
    });

    it('un participante (quien inició la solicitud) descarga sin documents:read', async () => {
      kit.as({ user_id: 4, permissions: ['store:workflows:read'] });
      const out = await kit.workflowFiles.download(fileId);
      expect(out.expires_in).toBeLessThanOrEqual(300);
      expect(out.original_name).toBe('a.pdf');
    });

    it('quien no participa y no tiene documents:read no ve ni que el archivo existe (404)', async () => {
      kit.as({ user_id: 6, permissions: ['store:workflows:read'] });
      expect(await codeOf(kit.workflowFiles.download(fileId))).toBe('DOCUMENT_NOT_FOUND');
      expect(kit.s3.getPresignedUrl).not.toHaveBeenCalled();
    });

    it('documents:read u owner descargan cualquier archivo de la tienda', async () => {
      kit.as({ user_id: 6, permissions: ['store:documents:read'] });
      expect((await kit.workflowFiles.download(fileId)).sha256).toHaveLength(64);
      kit.as({ user_id: 6, permissions: [], is_owner: true } as any);
      expect((await kit.workflowFiles.download(fileId)).sha256).toHaveLength(64);
    });

    it('con documents:read, un archivo de otra tienda sigue siendo inexistente', async () => {
      const foreign = kit.db.insert('stored_files', { store_id: 2, organization_id: 1, s3_key: 'k/foreign' });
      kit.as({ user_id: 6, permissions: ['store:documents:read'] });
      expect(await codeOf(kit.workflowFiles.download(foreign.id))).toBe('DOCUMENT_NOT_FOUND');
    });

    it('un archivo sin expediente (suelto) solo lo descarga quien tiene documents:read', async () => {
      const loose = kit.db.insert('stored_files', { store_id: 1, organization_id: 1, s3_key: 'k/loose' });
      kit.as({ user_id: 4, permissions: ['store:workflows:read'] });
      expect(await codeOf(kit.workflowFiles.download(loose.id))).toBe('DOCUMENT_NOT_FOUND');
    });
  });
});
