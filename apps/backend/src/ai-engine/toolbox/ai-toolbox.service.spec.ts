/**
 * ia-cargas F5a — Vexi's `ai_extract_document` prepares the attachment with
 * the shared ai-ingest preparation (EXIF + 1536 px JPEG for photos, PDF by
 * pages with native text first) instead of its private sharp copy, and the
 * ai-engine module does not import `AiIngestModule` (no DI cycle).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { AiToolboxService } from './ai-toolbox.service';
import { DocumentPagesService } from '../../common/ai-ingest/documents/document-pages.service';
import { VendixHttpException, ErrorCodes } from '../../common/errors';

const sharp: typeof import('sharp').default = require('sharp'); // eslint-disable-line @typescript-eslint/no-require-imports

const toDataUri = (buffer: Buffer, mime: string) =>
  `data:${mime};base64,${buffer.toString('base64')}`;

function build(options: { dataUri: string; mimeType: string; pages?: any; content?: string }) {
  const ai = {
    run: jest.fn().mockResolvedValue({
      success: true,
      content: options.content ?? '{"total": 1000}',
    }),
  };
  const attachments = {
    dataUri: jest.fn().mockResolvedValue({
      dataUri: options.dataUri,
      mimeType: options.mimeType,
      originalName: 'factura',
    }),
    markConsumed: jest.fn().mockResolvedValue(undefined),
  };
  const pages = options.pages ?? new DocumentPagesService();
  const service = new AiToolboxService(ai as any, attachments as any, {} as any, pages);
  return { service, ai, attachments, pages };
}

describe('AiToolboxService.extractDocument — shared preparation (F5a)', () => {
  it('a photo is straightened and reduced to a 1536 px JPEG by the common image-prep', async () => {
    const png = await sharp({
      create: { width: 3000, height: 2000, channels: 3, background: { r: 240, g: 240, b: 240 } },
    })
      .png()
      .toBuffer();
    const { service, ai, attachments } = build({ dataUri: toDataUri(png, 'image/png'), mimeType: 'image/png' });

    const out = await service.extractDocument({ attachmentId: 'a1', documentKind: 'factura_gasto' });

    expect(ai.run.mock.calls[0][0]).toBe('expense_invoice_ocr');
    const content = ai.run.mock.calls[0][2][0].content as any[];
    expect(content[0].text).toContain('Extrae todos los datos');
    const image = content.find((p) => p.type === 'image_url');
    expect(image.image_url.url.startsWith('data:image/jpeg;base64,')).toBe(true);
    const meta = await sharp(Buffer.from(image.image_url.url.split(',')[1], 'base64')).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(1536);
    expect(out).toEqual(expect.objectContaining({ app_key: 'expense_invoice_ocr', data: { total: 1000 } }));
    expect(attachments.markConsumed).toHaveBeenCalledWith('a1', 'expense_invoice_ocr');
  });

  it('a PDF travels by pages (native text first) in ONE call, never as a raw PDF', async () => {
    const pdf = Buffer.from('%PDF-1.7 factura');
    const pages = {
      prepareForAi: jest.fn().mockResolvedValue({
        source: 'pdf',
        pages: [
          { page_number: 1, mode: 'text', text: 'FACTURA 1 ' + 'x'.repeat(220) },
          { page_number: 2, mode: 'image', text: '', image: 'data:image/jpeg;base64,/9j/AAAA' },
        ],
        page_count: 2,
        unreadable_pages: [],
      }),
    };
    const { service, ai } = build({ dataUri: toDataUri(pdf, 'application/pdf'), mimeType: 'application/pdf', pages });

    await service.extractDocument({ attachmentId: 'a1', documentKind: 'factura_compra', retryHint: 'el total no cuadra' });

    expect(pages.prepareForAi).toHaveBeenCalledWith(
      expect.objectContaining({ buffer: pdf, mimetype: 'application/pdf' }),
      expect.objectContaining({ maxPages: 10, splitTallImages: false }),
    );
    expect(ai.run).toHaveBeenCalledTimes(1);
    const content = ai.run.mock.calls[0][2][0].content as any[];
    expect(content[0].text).toContain('el total no cuadra');
    const sent = JSON.stringify(content);
    expect(sent).toContain('FACTURA 1');
    expect(sent).not.toContain('application/pdf');
    expect(content.filter((p) => p.type === 'image_url')).toHaveLength(1);
  });

  it('an attachment that is not a PDF/photo fails as a document problem without calling the model', async () => {
    const { service, ai } = build({ dataUri: toDataUri(Buffer.from('hola'), 'image/png'), mimeType: 'image/png' });
    await expect(
      service.extractDocument({ attachmentId: 'a1', documentKind: 'factura_gasto' }),
    ).rejects.toMatchObject({ errorCode: ErrorCodes.AI_INGEST_INVALID_FILE.code });
    expect(ai.run).not.toHaveBeenCalled();
  });

  it('page problems of the common reader reach Vexi as AI_INGEST_* (too many pages)', async () => {
    const pages = {
      prepareForAi: jest
        .fn()
        .mockRejectedValue(new VendixHttpException(ErrorCodes.AI_INGEST_TOO_MANY_PAGES, 'El PDF excede el máximo de 10 páginas.')),
    };
    const { service } = build({
      dataUri: toDataUri(Buffer.from('%PDF-1.7 x'), 'application/pdf'),
      mimeType: 'application/pdf',
      pages,
    });
    await expect(
      service.extractDocument({ attachmentId: 'a1', documentKind: 'factura_compra' }),
    ).rejects.toMatchObject({ errorCode: 'AI_INGEST_TOO_MANY_PAGES' });
  });

  it('no private sharp copy left and no AiIngestModule import in the @Global ai-engine module (no DI cycle)', () => {
    const toolbox = fs.readFileSync(path.join(__dirname, 'ai-toolbox.service.ts'), 'utf8');
    expect(toolbox).not.toMatch(/require\('sharp'\)/);
    const moduleSource = fs.readFileSync(path.join(__dirname, '..', 'ai-engine.module.ts'), 'utf8');
    expect(moduleSource).not.toMatch(/ai-ingest\.module/);
    expect(moduleSource).not.toMatch(/forwardRef\(\(\) => AiIngestModule/);
    // The page service it provides has no injected dependencies.
    expect(DocumentPagesService.length).toBe(0);
  });
});
