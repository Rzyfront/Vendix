import {
  ReceivedDocumentPagesService,
  type PreparedReceivedDocumentPages,
  type ReceivedDocumentSourceFile,
} from './received-document-pages.service';
import { DocumentPagesService } from '../../../common/ai-ingest/documents/document-pages.service';

/**
 * ia-cargas F2 moved the service to `common/ai-ingest/documents`. Its
 * behaviour is covered there; this spec guards the old import path used by
 * Documentos recibidos, "Leer con IA" of workflows, base PDF pages and the
 * data-collection drafts.
 */
describe('received-document-pages (re-export of the ai-ingest core)', () => {
  it('is the SAME class, so Nest modules keep one DI token for both names', () => {
    expect(ReceivedDocumentPagesService).toBe(DocumentPagesService);
    expect(new ReceivedDocumentPagesService()).toBeInstanceOf(DocumentPagesService);
  });

  it('keeps the old contract: prepare(file) with the old type names', async () => {
    const service = new ReceivedDocumentPagesService();
    const file: ReceivedDocumentSourceFile = {
      buffer: Buffer.from('not a pdf'),
      mimetype: 'application/pdf',
      size: 9,
      originalname: 'x.pdf',
    };
    const result: Promise<PreparedReceivedDocumentPages> = service.prepare(file);
    await expect(result).rejects.toMatchObject({
      response: expect.objectContaining({
        message: 'El contenido no corresponde a un PDF válido.',
      }),
    });
  });
});
