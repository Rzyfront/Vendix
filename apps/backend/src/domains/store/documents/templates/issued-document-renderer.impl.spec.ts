import { RequestContextService } from '@common/context/request-context.service';
import { BasePdfPagesService } from './base-pdf-pages.service';
import { FrozenIssuedDocumentRenderer } from './issued-document-renderer.impl';
import { TemplateRenderService } from './template-render.service';
import { pdfText } from './pdf-text.testutil';

const sharp: typeof import('sharp').default = require('sharp'); // eslint-disable-line @typescript-eslint/no-require-imports

const body = {
  page: { size: 'LETTER' },
  signature_slots: [{ key: 'empleado', role_label: 'Empleado' }],
  blocks: [
    { type: 'paragraph', text: 'Contrato de {{ fields.nombre }} por {{ fields.salario | money }}' },
    { type: 'signature', slot_key: 'empleado' },
  ],
};

function setup(doc: unknown) {
  const prisma = { issued_documents: { findFirst: jest.fn().mockResolvedValue(doc) } };
  const render = new TemplateRenderService(prisma as never, {} as never, {} as BasePdfPagesService);
  const renderer = new FrozenIssuedDocumentRenderer(prisma as never, render);
  const run = <T>(fn: () => Promise<T>, store = 7) =>
    RequestContextService.runIsolated(
      { store_id: store, organization_id: 3, is_super_admin: false, is_owner: false },
      fn,
    );
  return { prisma, renderer, run };
}

const issued = {
  id: 5,
  reference: 'DOC-000005',
  title: 'Contrato',
  data_snapshot: { timezone: 'America/Bogota', currency: 'COP', values: { 'fields.nombre': 'Ana', 'fields.salario': 2500000 } },
  template_version: { kind: 'blocks', body, base_file_id: null },
};

describe('FrozenIssuedDocumentRenderer', () => {
  it('draws the frozen version with the frozen snapshot, in the box of the signature slot', async () => {
    const { renderer, run, prisma } = setup(issued);
    const plain = pdfText(await run(() => renderer.render(5)));
    expect(plain).toContain('Contrato de Ana por $2.500.000');
    expect(plain).toContain('Pendiente de firma');

    const image = await sharp({ create: { width: 30, height: 10, channels: 3, background: '#123' } }).png().toBuffer();
    const sealed = pdfText(
      await run(() =>
        renderer.render(5, {
          signatures: [{ slot_key: 'empleado', role_label: 'Empleado', name: 'Ana Pérez', document_number: '123', image, signed_at: new Date('2026-11-07T15:00:00Z') }],
          appendPages: (doc) => {
            doc.addPage();
            doc.text('Hoja de evidencia');
          },
        }),
      ),
    );
    expect(sealed).toContain('Ana Pérez');
    expect(sealed).not.toContain('Pendiente de firma');
    expect(sealed).toContain('Hoja de evidencia');
    expect(prisma.issued_documents.findFirst.mock.calls[0][0].where).toEqual({ id: 5, store_id: 7 });
  });

  it('a document of another store does not exist', async () => {
    const { renderer, run } = setup(null);
    await expect(run(() => renderer.render(5, undefined), 99)).rejects.toMatchObject({ errorCode: 'DOCISSUE_NOT_FOUND' });
  });
});
