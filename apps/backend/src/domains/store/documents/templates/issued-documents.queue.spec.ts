import { RequestContextService } from '@common/context/request-context.service';
import { IssuedDocumentsRenderQueue, MAX_RENDER_ATTEMPTS } from './issued-documents.queue';
import { MissingTokenError } from './template-tokens';

const STORE = 7;

function setup(opts: { attempts?: number; stageType?: string; claim?: number; renderError?: Error } = {}) {
  const doc = {
    id: 99,
    store_id: STORE,
    organization_id: 3,
    reference: 'DOC-000001',
    title: 'Contrato laboral',
    status: 'rendering',
    render_attempts: opts.attempts ?? 0,
    requirement_key: 'contrato',
    stage_key: 'contrato',
    dossier_id: 61,
    workflow_instance_id: 11,
    supersedes_id: 50,
    data_snapshot: { timezone: 'America/Bogota', currency: 'COP', values: {} },
    template_version: { kind: 'blocks', body: {}, base_file_id: null },
  };
  const tx = {
    issued_documents: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    workflow_instances: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findFirst: jest.fn().mockResolvedValue({
        id: 11, status: 'active', current_stage_key: 'contrato', stage_entry_seq: 4, version_id: 5,
      }),
    },
    workflow_instance_events: {
      findFirst: jest.fn().mockResolvedValue({ seq: 6 }),
      create: jest.fn().mockResolvedValue({}),
    },
    workflow_versions: {
      findFirst: jest.fn().mockResolvedValue({
        definition: { fields: [], stages: [{ key: 'contrato', name: 'Contrato', type: opts.stageType ?? 'automatic' }] },
      }),
    },
    workflow_outbox: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    issued_documents: {
      findFirst: jest.fn().mockResolvedValue(doc),
      updateMany: jest.fn().mockResolvedValue({ count: opts.claim ?? 1 }),
    },
    $transaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
  };
  const renderer = {
    render: opts.renderError
      ? jest.fn().mockRejectedValue(opts.renderError)
      : jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake')),
  };
  const files = {
    upload: jest.fn().mockResolvedValue({ id: 70, sha256: 'a'.repeat(64), s3_key: 'k/70.pdf' }),
    discardObject: jest.fn(),
  };
  const dossiers = { addDocumentItem: jest.fn().mockResolvedValue({}) };
  const queue = new IssuedDocumentsRenderQueue(prisma as never, renderer as never, files as never, dossiers as never);
  const run = <T>(fn: () => Promise<T>) =>
    RequestContextService.runIsolated(
      { store_id: STORE, organization_id: 3, is_super_admin: false, is_owner: false },
      fn,
    );
  return { queue, prisma, tx, renderer, files, dossiers, run };
}

describe('IssuedDocumentsRenderQueue.renderById', () => {
  it('uploads the generated PDF, issues the document, files it and wakes the automatic stage', async () => {
    const { queue, tx, files, dossiers, run } = setup();
    expect(await run(() => queue.renderById(99))).toBe('issued');

    expect(files.upload).toHaveBeenCalledWith(
      expect.objectContaining({ mimeType: 'application/pdf', source: 'generated', originalName: 'DOC-000001 Contrato laboral.pdf' }),
    );
    expect(tx.issued_documents.updateMany).toHaveBeenCalledWith({
      where: { id: 99, store_id: STORE, status: 'rendering' },
      data: expect.objectContaining({ status: 'issued', file_id: 70, pdf_sha256: 'a'.repeat(64), error: null }),
    });
    // The previous document of the chain is superseded.
    expect(tx.issued_documents.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 50 }), data: { status: 'superseded' } }),
    );
    expect(dossiers.addDocumentItem).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ dossier_id: 61, kind: 'issued_document', issued_document_id: 99, file_id: 70, requirement_key: 'contrato' }),
    );
    expect(tx.workflow_instance_events.create.mock.calls[0][0].data).toMatchObject({
      type: 'document_issued', seq: 7, instance_id: 11, store_id: STORE, actor_type: 'system',
    });
    expect(tx.workflow_outbox.create.mock.calls[0][0].data).toMatchObject({
      kind: 'advance',
      payload: { instance_id: 11, stage_key: 'contrato', stage_entry_seq: 4 },
    });
  });

  it('does not queue an advance for a stage a person completes', async () => {
    const { queue, tx, run } = setup({ stageType: 'form' });
    await run(() => queue.renderById(99));
    expect(tx.workflow_outbox.create).not.toHaveBeenCalled();
  });

  it('claims by compare-and-swap on the attempt counter: a lost claim renders nothing', async () => {
    const { queue, renderer, prisma, run } = setup({ attempts: 1, claim: 0 });
    expect(await run(() => queue.renderById(99))).toBe('skipped');
    expect(prisma.issued_documents.updateMany).toHaveBeenCalledWith({
      where: { id: 99, store_id: STORE, status: 'rendering', render_attempts: 1 },
      data: { render_attempts: { increment: 1 } },
    });
    expect(renderer.render).not.toHaveBeenCalled();
  });

  it('keeps the document rendering for a retry after a transient failure', async () => {
    const { queue, tx, run } = setup({ renderError: new Error('S3 timeout') });
    expect(await run(() => queue.renderById(99))).toBe('retry');
    expect(tx.issued_documents.updateMany).not.toHaveBeenCalled();
  });

  it('after the last attempt it fails with a readable reason and a timeline event', async () => {
    const { queue, tx, run } = setup({ attempts: MAX_RENDER_ATTEMPTS - 1, renderError: new Error('S3 timeout') });
    expect(await run(() => queue.renderById(99))).toBe('failed');
    const patch = tx.issued_documents.updateMany.mock.calls[0][0];
    expect(patch.data.status).toBe('failed');
    expect(patch.data.error).toContain('No se pudo generar el PDF');
    expect(patch.data.error).not.toContain('S3');
    expect(tx.workflow_instance_events.create.mock.calls[0][0].data).toMatchObject({ type: 'document_failed' });
  });

  it('a missing value fails at once, without retries, naming the data', async () => {
    const { queue, tx, run } = setup({ renderError: new MissingTokenError('fields.salario') });
    expect(await run(() => queue.renderById(99))).toBe('failed');
    expect(tx.issued_documents.updateMany.mock.calls[0][0].data.error).toBe(
      "Falta el dato 'fields.salario' para emitir 'Contrato laboral'",
    );
  });

  it('discards the uploaded object when the issue transaction fails', async () => {
    const { queue, prisma, files, run } = setup();
    prisma.$transaction.mockRejectedValueOnce(new Error('db down'));
    expect(await run(() => queue.renderById(99))).toBe('retry');
    expect(files.discardObject).toHaveBeenCalledWith('k/70.pdf');
  });

  it('skips a document that is no longer rendering', async () => {
    const { queue, prisma, renderer, run } = setup();
    prisma.issued_documents.findFirst.mockResolvedValueOnce({ id: 99, status: 'voided' });
    expect(await run(() => queue.renderById(99))).toBe('skipped');
    expect(renderer.render).not.toHaveBeenCalled();
  });
});
