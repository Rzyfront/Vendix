import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors';
import { IssuedDocumentsService } from './issued-documents.service';
import { TemplateDataService } from './template-data.service';
import { tokenSchemaOfBlocks, validateBlocksBody } from './template-body';

const STORE = 7;
const body = validateBlocksBody({
  page: { size: 'A4' },
  signature_slots: [{ key: 'empleado', role_label: 'Empleado' }],
  blocks: [
    { type: 'paragraph', text: "{{ fields.nombre }} · {{ fields.salario | money }} · {{ fields.salario | words }} · {{ now | date:'largo' }}" },
    { type: 'signature', slot_key: 'empleado' },
  ],
});

const definition = {
  fields: [
    { key: 'nombre', label: 'Nombre', type: 'text' },
    { key: 'salario', label: 'Salario', type: 'money' },
  ],
  stages: [
    {
      key: 'contrato',
      name: 'Contrato',
      type: 'automatic',
      requirements: [{ kind: 'issued_document', key: 'contrato', label: 'Contrato', template_key: 'contrato-laboral', auto_issue_on_enter: true }],
    },
  ],
};

function setup(overrides: { data?: Record<string, unknown>; template?: unknown; previous?: unknown; instance?: unknown } = {}) {
  const instance =
    overrides.instance === undefined
      ? {
          id: 11,
          organization_id: 3,
          store_id: STORE,
          status: 'active',
          reference: 'SOL-000011',
          title: 'Ingreso de Ana',
          current_stage_key: 'contrato',
          created_at: new Date('2026-11-01T10:00:00Z'),
          subject_type: 'employee',
          subject_id: 4,
          version_id: 5,
          data: overrides.data ?? { nombre: 'Ana', salario: 2500000 },
        }
      : overrides.instance;
  const template =
    overrides.template === undefined
      ? {
          id: 21,
          key: 'contrato-laboral',
          name: 'Contrato laboral',
          status: 'published',
          published_version: { id: 31, version: 2, kind: 'blocks', body, token_schema: tokenSchemaOfBlocks(body), base_file_id: null },
        }
      : overrides.template;
  const calls: string[] = [];
  const created = jest.fn(async ({ data }) => ({
    id: 99,
    created_at: new Date(),
    file_id: null,
    pdf_sha256: null,
    error: null,
    void_reason: null,
    issued_at: null,
    ...data,
  }));
  const tx = {
    $queryRaw: jest.fn(async (sql: TemplateStringsArray, ...values: unknown[]) => {
      calls.push(`raw:${sql.join('?')}|${values.join(',')}`);
      return sql.join('?').includes('MAX(') ? [{ n: 1 }] : [];
    }),
    issued_documents: {
      findFirst: jest.fn(async () => {
        calls.push('previous');
        return overrides.previous ?? null;
      }),
      create: created,
    },
    dossiers: { findFirst: jest.fn().mockResolvedValue({ id: 61 }) },
  };
  const prisma = {
    stores: { findFirst: jest.fn().mockResolvedValue({ name: 'Tienda Demo', legal_name: null, tax_id: '900123', tax_id_dv: '4', logo_url: null, timezone: 'America/Bogota' }) },
    store_settings: { findFirst: jest.fn().mockResolvedValue({ settings: { general: { currency: 'COP' } } }) },
    workflow_instances: { findFirst: jest.fn().mockResolvedValue(instance) },
    workflow_versions: { findFirst: jest.fn().mockResolvedValue({ definition }) },
    document_templates: { findFirst: jest.fn().mockResolvedValue(template) },
    withoutScope: () => ({
      addresses: { findFirst: jest.fn().mockResolvedValue(null) },
      users: { findFirst: jest.fn().mockResolvedValue({ first_name: 'Rosa', last_name: 'Gómez', email: 'r@x.co' }) },
    }),
    $transaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
  };
  const dossiers = { getByInstance: jest.fn().mockResolvedValue({ id: 61 }) };
  const queue = { kick: jest.fn(), appendEvent: jest.fn() };
  const service = new IssuedDocumentsService(
    prisma as never,
    new TemplateDataService(prisma as never),
    dossiers as never,
    queue as never,
  );
  const run = <T>(fn: () => Promise<T>) =>
    RequestContextService.runIsolated(
      { store_id: STORE, organization_id: 3, user_id: 9, is_super_admin: false, is_owner: false },
      fn,
    );
  return { service, prisma, tx, queue, created, run, calls };
}

const emitInput = { instance_id: 11, requirement_key: 'contrato', actor: { type: 'user' as const, id: 9 } };

describe('IssuedDocumentsService.emit', () => {
  it('freezes the real data, numbers the document per store and queues the render', async () => {
    const { service, queue, created, run } = setup();
    const doc = await run(() => service.emit(emitInput));

    expect(doc).toMatchObject({
      reference: 'DOC-000001',
      status: 'rendering',
      title: 'Contrato laboral',
      requirement_key: 'contrato',
      workflow_instance_id: 11,
      template: { key: 'contrato-laboral' },
      template_version: 2,
    });
    const data = created.mock.calls[0][0].data;
    expect(data.template_version_id).toBe(31);
    expect(data.dossier_id).toBe(61);
    expect(data.data_snapshot.values).toMatchObject({ 'fields.nombre': 'Ana', 'fields.salario': 2500000 });
    expect(data.data_snapshot.timezone).toBe('America/Bogota');
    expect(data.data_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(queue.kick).toHaveBeenCalledWith({ id: 99, store_id: STORE, organization_id: 3 });
  });

  it("stops with \"Falta el dato 'Salario' para emitir 'Contrato laboral'\" and creates nothing", async () => {
    const { service, queue, created, run } = setup({ data: { nombre: 'Ana' } });
    const error = await run(() => service.emit(emitInput)).catch((e) => e);
    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.getResponse()).toMatchObject({
      error_code: 'DOCISSUE_DATA_MISSING',
      message: "Falta el dato 'Salario' para emitir 'Contrato laboral'",
      details: { missing: [{ path: 'fields.salario', label: 'Salario' }] },
    });
    expect(created).not.toHaveBeenCalled();
    expect(queue.kick).not.toHaveBeenCalled();
  });

  it('rejects a value the filter cannot format instead of printing it wrong', async () => {
    const { service, created, run } = setup({ data: { nombre: 'Ana', salario: 'mucho' } });
    await expect(run(() => service.emit(emitInput))).rejects.toThrow(
      "El dato 'Salario' no es válido para emitir 'Contrato laboral': no es un número",
    );
    expect(created).not.toHaveBeenCalled();
  });

  it('reissue chain: the new document points at the previous one', async () => {
    const { service, created, run } = setup({ previous: { id: 50, status: 'issued' } });
    await run(() => service.emit(emitInput));
    expect(created.mock.calls[0][0].data.supersedes_id).toBe(50);
  });

  it('locks the request row before looking for the previous document (no two active documents for one requirement)', async () => {
    const { service, run, calls } = setup();
    await run(() => service.emit(emitInput));
    const lock = calls.findIndex((c) => c.startsWith('raw:') && c.includes('FROM workflow_instances') && c.includes('FOR NO KEY UPDATE'));
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(calls[lock]).toContain(`|11,${STORE}`);
    expect(lock).toBeLessThan(calls.indexOf('previous'));
  });

  it('does not reissue while the previous document is rendering or waiting for signatures', async () => {
    for (const status of ['rendering', 'pending_signature']) {
      const { service, created, run } = setup({ previous: { id: 50, status } });
      await expect(run(() => service.emit(emitInput))).rejects.toMatchObject({ errorCode: 'DOCISSUE_STATE' });
      expect(created).not.toHaveBeenCalled();
    }
  });

  it('refuses a template that is archived or has no published version', async () => {
    const archived = setup({ template: { id: 1, key: 'x', name: 'X', status: 'archived', published_version: null } });
    await expect(archived.run(() => archived.service.emit(emitInput))).rejects.toMatchObject({ errorCode: 'DOCTPL_ARCHIVED' });
    const draft = setup({ template: { id: 1, key: 'x', name: 'X', status: 'draft', published_version: null } });
    await expect(draft.run(() => draft.service.emit(emitInput))).rejects.toMatchObject({ errorCode: 'DOCTPL_NOT_PUBLISHED' });
  });

  it('is isolated by store: another store template or request is a 404, always queried with the store of the context', async () => {
    const noTemplate = setup({ template: null });
    await expect(noTemplate.run(() => noTemplate.service.emit(emitInput))).rejects.toMatchObject({ errorCode: 'DOCTPL_NOT_FOUND' });
    expect(noTemplate.prisma.document_templates.findFirst.mock.calls[0][0].where).toMatchObject({ store_id: STORE });

    const noInstance = setup({ instance: null });
    await expect(noInstance.run(() => noInstance.service.emit(emitInput))).rejects.toMatchObject({ errorCode: 'WORKFLOW_NOT_FOUND' });
    expect(noInstance.prisma.workflow_instances.findFirst.mock.calls[0][0].where).toMatchObject({ store_id: STORE });
  });

  it('refuses a closed request and a requirement that is not of the current stage', async () => {
    const closed = setup({ instance: { id: 11, store_id: STORE, status: 'completed', current_stage_key: 'contrato', version_id: 5, data: {}, created_at: new Date() } });
    await expect(closed.run(() => closed.service.emit(emitInput))).rejects.toMatchObject({ errorCode: 'DOCISSUE_INSTANCE_CLOSED' });
    const wrong = setup();
    await expect(wrong.run(() => wrong.service.emit({ ...emitInput, requirement_key: 'otro' }))).rejects.toMatchObject({ errorCode: 'DOCUMENT_TARGET_INVALID' });
  });
});

describe('IssuedDocumentsService.voidDocument', () => {
  it('voids with a reason, rejects its dossier item and leaves a timeline event', async () => {
    const doc = { id: 5, reference: 'DOC-000005', status: 'issued', workflow_instance_id: 11, requirement_key: 'contrato' };
    const { service, prisma, queue, run } = setup();
    const row = { ...doc, title: 'T', error: null, template: { id: 1, key: 'k', name: 'N' }, template_version: { version: 1 }, stage_key: 's', dossier_id: 1, file_id: 2, pdf_sha256: null, supersedes_id: null, void_reason: null, issued_by_type: 'user', issued_by_id: 9, issued_at: null, created_at: new Date() };
    (prisma as any).issued_documents = { findFirst: jest.fn().mockResolvedValue(row) };
    const txDocs = { updateMany: jest.fn().mockResolvedValue({ count: 1 }) };
    const txItems = { updateMany: jest.fn().mockResolvedValue({ count: 1 }) };
    prisma.$transaction.mockImplementationOnce(async (fn: any) => fn({ issued_documents: txDocs, dossier_items: txItems }));
    await run(() => service.voidDocument(5, '  Datos errados  ', { type: 'user', id: 9 }));
    expect(txDocs.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: 5, store_id: STORE }, data: { status: 'voided', void_reason: 'Datos errados' } });
    expect(txItems.updateMany.mock.calls[0][0].data).toEqual({ status: 'rejected', note: 'Anulado: Datos errados' });
    expect(queue.appendEvent).toHaveBeenCalledWith(expect.anything(), STORE, 11, 'document_voided', expect.objectContaining({ reason: 'Datos errados' }));
  });

  it('cannot void a document that is still rendering or has a signature in progress', async () => {
    for (const status of ['rendering', 'pending_signature', 'superseded']) {
      const { service, prisma, run } = setup();
      (prisma as any).issued_documents = { findFirst: jest.fn().mockResolvedValue({ id: 5, status, reference: 'D', workflow_instance_id: 1 }) };
      await expect(run(() => service.voidDocument(5, 'motivo', { type: 'user', id: 1 }))).rejects.toMatchObject({ errorCode: 'DOCISSUE_STATE' });
    }
  });
});
