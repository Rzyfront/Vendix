/**
 * ia-cargas F5b (#12, #13, #14) — RUT, DIAN resolution and DIAN habilitación
 * read through the shared document reader: pages (PDF native text + the page
 * image, photos straightened), schema + repair, never the raw PDF. For the same
 * model answer every fiscal field is IDENTICAL to the old single call.
 *
 * Nothing here sends, signs or registers anything with the DIAN: these
 * scanners only pre-fill forms the user reviews.
 */
import { ErrorCodes } from '@common/errors';
import { AiScanFile } from '@common/ai-scan-jobs/interfaces/ai-scan-job.interface';
import { AiExtractionService } from '@common/ai-ingest/extraction/ai-extraction.service';
import { DocumentPagesService } from '@common/ai-ingest/documents/document-pages.service';
import { parseAiJson } from '../../../ai-engine/utils/ai-json.util';
import { RutScannerService } from '../settings/rut-scanner.service';
import { RUT_SCAN_INSTRUCTION } from '../settings/rut-ingest.profile';
import { ResolutionScannerService } from './resolutions/resolution-scanner.service';
import { RESOLUTION_SCAN_INSTRUCTION } from './resolutions/resolution-ingest.profile';
import { DianHabilitationScannerService } from './dian-config/dian-habilitation-scanner.service';

const sharp: typeof import('sharp').default = require('sharp'); // eslint-disable-line @typescript-eslint/no-require-imports

const PDF = Buffer.from('%PDF-1.7 formulario');
const pdf = (name: string): AiScanFile => ({
  buffer: PDF,
  mimeType: 'application/pdf',
  originalName: name,
  size: PDF.length,
});

type FakePage = { page_number: number; mode: 'text' | 'image' | 'text+image'; text: string; image?: string };
const formPages = (n: number, tag: string): FakePage[] =>
  Array.from({ length: n }, (_, i) => ({
    page_number: i + 1,
    mode: 'text+image' as const,
    text: `${tag} hoja ${i + 1} ` + 'x'.repeat(220),
    image: 'data:image/jpeg;base64,AAAA',
  }));

function harness(options: {
  answers?: Array<string | Record<string, unknown>>;
  pagesByFile?: FakePage[][];
  realPages?: boolean;
}) {
  const queue = [...(options.answers ?? [])];
  const aiEngine = {
    assertVisionModelLinked: jest.fn().mockResolvedValue(undefined),
    run: jest.fn(async (_app: string, _vars: unknown, _messages: any[]) => {
      const a = queue.shift() ?? '{}';
      return typeof a === 'string' ? { success: true, content: a, finish_reason: 'stop' } : a;
    }),
  };
  let call = 0;
  const pages = options.realPages
    ? new DocumentPagesService()
    : {
        prepareForAi: jest.fn(async () => {
          const list = options.pagesByFile?.[call++] ?? formPages(1, 'DIAN');
          return { source: 'pdf', pages: list, page_count: list.length, unreadable_pages: [] };
        }),
      };
  const extraction = new AiExtractionService(aiEngine as any);
  return {
    aiEngine,
    pages,
    rut: new RutScannerService(aiEngine as any, extraction, pages as any),
    resolution: new ResolutionScannerService(aiEngine as any, extraction, pages as any),
    habilitation: new DianHabilitationScannerService(aiEngine as any, extraction, pages as any),
  };
}

async function photo(): Promise<AiScanFile> {
  const buffer = await sharp({ create: { width: 1200, height: 1700, channels: 3, background: '#fff' } })
    .jpeg()
    .toBuffer();
  return { buffer, mimeType: 'image/jpeg', originalName: 'foto.jpg', size: buffer.length };
}

/** Strip the optional ai-ingest additions to compare with the old result. */
function fields<T extends Record<string, any>>(result: T) {
  const { warnings, scan_source, ...rest } = result;
  return rest;
}

// ── Fixed answers (numbers as strings, nulls, a DV, responsibilities) ──
const RUT_ANSWER = JSON.stringify({
  nit: ' 900123456 ',
  nit_dv: 8,
  nit_type: 'NIT',
  legal_name: 'Constructora Andina S.A.S.',
  person_type: 'juridica',
  tax_regime: 'COMUN',
  ciiu: 4111,
  fiscal_address: 'Cra 7 # 71-21',
  country: null,
  department: 'Cundinamarca',
  city: 'Bogotá',
  tax_responsibilities: ['05', '7', 'O-14', null, 'R-99-PN'],
  tax_scheme: '48',
  confidence: '93',
  extraction_notes: null,
});

const RESOLUTION_ANSWER = JSON.stringify({
  prefix: 'fe',
  document_type: 'sales_invoice',
  resolution_number: '18764000001234',
  resolution_date: '2026-01-15',
  range_from: '1',
  range_to: 5000,
  valid_from: '2026-01-15',
  valid_to: '2028-01-15',
  technical_key: 'fc8eac422eba16e22ffd8c6f94b3f40a6e38162c',
  environment: 'production',
  field_confidence: { prefix: 95, range_from: 90, range_to: 90, technical_key: 55 },
  confidence: 90,
  extraction_notes: '',
});

const HABILITATION_ANSWER = JSON.stringify({
  name: 'Facturación tienda',
  nit: '900123456',
  nit_dv: '8',
  environment: 'test',
  software_id: '123E4567-E89B-12D3-A456-426614174000',
  software_pin: 12345,
  test_set_id: '123e4567-e89b-12d3-a456-426614174001',
  resolution_number: '18760000001',
  resolution_prefix: 'SETP',
  resolution_range_from: 990000000,
  resolution_range_to: '995000000',
  resolution_valid_from: '2019-01-19',
  resolution_valid_to: '2030-01-19',
  resolution_date: '2019-01-19',
  resolution_technical_key: 'fc8eac422eba16e22ffd8c6f94b3f40a6e38162c',
  field_confidence: { software_id: 95, software_pin: 92, test_set_id: 95, nit: 98 },
  confidence: 92,
  extraction_notes: null,
});

describe('RUT scanner — ai-ingest (F5b #12)', () => {
  it('fixed case: NIT, DV, razón social, responsibilities and regime are IDENTICAL to the old path', async () => {
    const h = harness({ answers: [RUT_ANSWER] });
    const out = await h.rut.scanRutFromFiles([pdf('rut.pdf')]);
    const before = (h.rut as any).normalizeRutResponse(parseAiJson(RUT_ANSWER));
    expect(fields(out)).toEqual(before);
    expect(out).toMatchObject({
      nit: '900123456',
      nit_dv: '8',
      legal_name: 'Constructora Andina S.A.S.',
      person_type: 'JURIDICA',
      tax_regime: 'COMUN',
      country: 'CO',
    });
    expect(out.tax_responsibilities).toEqual(before.tax_responsibilities);
  });

  it('a PDF RUT goes as native text + page image (form boxes kept), all pages in ONE call, never the raw PDF', async () => {
    const h = harness({ answers: [RUT_ANSWER], pagesByFile: [formPages(3, 'RUT')] });
    const out = await h.rut.scanRutFromFiles([pdf('rut.pdf')]);
    expect(h.aiEngine.run).toHaveBeenCalledTimes(1);
    expect(h.aiEngine.run.mock.calls[0][0]).toBe('rut_scanner');
    expect((h.pages as any).prepareForAi.mock.calls[0][1]).toMatchObject({
      renderTextPages: true,
      splitTallImages: false,
      maxPages: 10,
      maxBytes: 15 * 1024 * 1024,
    });
    const parts = h.aiEngine.run.mock.calls[0][2][0].content as any[];
    expect(JSON.stringify(parts)).not.toContain('application/pdf');
    expect(parts.filter((p) => p.type === 'image_url')).toHaveLength(3);
    expect(parts[0].text.startsWith(RUT_SCAN_INSTRUCTION)).toBe(true);
    expect(out.scan_source).toEqual({ pages: 3, text_pages: 0, batches: 1 });
  });

  it('a phone photo goes straightened as ONE JPEG with the exact old request', async () => {
    const h = harness({ answers: [RUT_ANSWER], realPages: true });
    const out = await h.rut.scanRutFromFiles([await photo()]);
    const parts = h.aiEngine.run.mock.calls[0][2][0].content as any[];
    expect(parts[0]).toEqual({ type: 'text', text: RUT_SCAN_INSTRUCTION });
    const images = parts.filter((p) => p.type === 'image_url');
    expect(images).toHaveLength(1);
    expect(images[0].image_url.url).toMatch(/^data:image\/jpeg;base64,/);
    const jpeg = Buffer.from(images[0].image_url.url.split(',')[1], 'base64');
    const meta = await sharp(jpeg).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(1536);
    expect(out.nit).toBe('900123456');
  });

  it('errors keep the RUT contract: provider failure carries its message; broken JSON after repair is RUT_SCAN_PARSE_FAIL', async () => {
    const failing = harness({ answers: [{ success: false, error: 'model does not accept images' }] });
    const err = await failing.rut.scanRutFromFiles([pdf('rut.pdf')]).catch((e) => e);
    expect(err.errorCode).toBe(ErrorCodes.RUT_SCAN_AI_FAIL.code);
    expect(err.message).toContain('La IA no pudo leer el RUT: model does not accept images');

    const broken = harness({ answers: ['no json', '[1]'] });
    await expect(broken.rut.scanRutFromFiles([pdf('rut.pdf')])).rejects.toMatchObject({
      errorCode: ErrorCodes.RUT_SCAN_PARSE_FAIL.code,
    });
    expect(broken.aiEngine.run).toHaveBeenCalledTimes(2);
  });

  it('a file that is not a PDF nor a photo is AI_INGEST_INVALID_FILE and the model is never called', async () => {
    const h = harness({});
    await expect(
      h.rut.scanRutFromFiles([{ buffer: Buffer.from('hola'), mimeType: 'application/pdf', originalName: 'x.pdf', size: 4 }]),
    ).rejects.toMatchObject({ errorCode: ErrorCodes.AI_INGEST_INVALID_FILE.code });
    expect(h.aiEngine.run).not.toHaveBeenCalled();
  });
});

describe('DIAN resolution scanner — ai-ingest (F5b #13)', () => {
  it('fixed case: prefix, ranges, resolution number and dates are IDENTICAL to the old path', async () => {
    const h = harness({ answers: [RESOLUTION_ANSWER] });
    const out = await h.resolution.scanResolutionFromFiles([pdf('resolucion.pdf')]);
    const before = (h.resolution as any).normalizeResponse(parseAiJson(RESOLUTION_ANSWER));
    expect(fields(out)).toEqual(before);
    expect(out.prefix.value).toBe('FE');
    expect(out.range_from.value).toBe(1);
    expect(out.range_to.value).toBe(5000);
    expect(out.resolution_number.value).toBe('18764000001234');
    expect(out.valid_to.value).toBe('2028-01-15');
  });

  it('a PDF goes as text + image of each page in ONE call; a photo as one JPEG with the old request', async () => {
    const h = harness({ answers: [RESOLUTION_ANSWER], pagesByFile: [formPages(2, 'RESOLUCION')] });
    await h.resolution.scanResolutionFromFiles([pdf('resolucion.pdf')]);
    expect(h.aiEngine.run).toHaveBeenCalledTimes(1);
    expect(h.aiEngine.run.mock.calls[0][0]).toBe('dian_resolution_scanner');
    const parts = h.aiEngine.run.mock.calls[0][2][0].content as any[];
    expect(parts.filter((p) => p.type === 'image_url')).toHaveLength(2);
    expect(JSON.stringify(parts)).not.toContain('application/pdf');

    const real = harness({ answers: [RESOLUTION_ANSWER], realPages: true });
    await real.resolution.scanResolutionFromFiles([await photo()]);
    const photoParts = real.aiEngine.run.mock.calls[0][2][0].content as any[];
    expect(photoParts[0]).toEqual({ type: 'text', text: RESOLUTION_SCAN_INSTRUCTION });
    expect(photoParts.filter((p) => p.type === 'image_url')).toHaveLength(1);
  });

  it('no credits is AI_PROVIDER_003; a provider failure keeps RESOLUTION_SCAN_AI_FAIL with its message', async () => {
    const credits = harness({ answers: [{ success: false, error: 'no credits', failure_reason: 'credits' }] });
    await expect(credits.resolution.scanResolutionFromFiles([pdf('r.pdf')])).rejects.toMatchObject({
      errorCode: ErrorCodes.AI_PROVIDER_003.code,
    });
    const failing = harness({ answers: [{ success: false, error: 'timeout' }] });
    const err = await failing.resolution.scanResolutionFromFiles([pdf('r.pdf')]).catch((e) => e);
    expect(err.errorCode).toBe(ErrorCodes.RESOLUTION_SCAN_AI_FAIL.code);
    expect(err.message).toContain('La IA no pudo leer la resolución: timeout');
  });
});

describe('DIAN habilitación scanner — ai-ingest (F5b #14)', () => {
  it('fixed case: Test set id, Software id, PIN, NIT and test numbering are IDENTICAL to the old path', async () => {
    const h = harness({ answers: [HABILITATION_ANSWER] });
    const out = await h.habilitation.scanHabilitationFromFiles([pdf('software.pdf')]);
    const before = (h.habilitation as any).normalizeResponse(parseAiJson(HABILITATION_ANSWER), 1);
    expect(fields(out)).toEqual(before);
    expect(out.software_id.value).toBe(before.software_id.value);
    expect(out.test_set_id.value).toBe('123e4567-e89b-12d3-a456-426614174001');
    expect(out.software_pin.value).toBe('12345');
    expect(out.resolution_range_to.value).toBe(995000000);
  });

  it('2 files (software + test numbering) combine as before: ONE call with both, labelled by document, one result', async () => {
    const h = harness({
      answers: [HABILITATION_ANSWER],
      pagesByFile: [formPages(1, 'SOFTWARE'), formPages(2, 'RESOLUCION PRUEBAS')],
    });
    const out = await h.habilitation.scanHabilitationFromFiles([pdf('software.pdf'), pdf('rango.pdf')]);

    expect(h.aiEngine.run).toHaveBeenCalledTimes(1);
    expect(h.aiEngine.run.mock.calls[0][0]).toBe('dian_habilitation_scanner');
    const parts = h.aiEngine.run.mock.calls[0][2][0].content as any[];
    expect(parts[0].text).toContain('from these 2 Colombian DIAN documents');
    expect(parts[0].text).toContain('merge them into a single JSON object');
    const labels = parts.filter((p) => p.type === 'text').map((p) => p.text as string);
    expect(labels.filter((t) => t.startsWith('--- Document 1 of 2, page'))).toHaveLength(1);
    expect(labels.filter((t) => t.startsWith('--- Document 2 of 2, page'))).toHaveLength(2);
    expect(parts.filter((p) => p.type === 'image_url')).toHaveLength(3);

    const before = (h.habilitation as any).normalizeResponse(parseAiJson(HABILITATION_ANSWER), 2);
    expect(fields(out)).toEqual(before);
    expect(out.documents_scanned).toBe(2);
    expect(out.scan_source).toEqual({ documents: 2, pages: 3, text_pages: 0, batches: 1 });
  });

  it('a photo + a PDF: the photo is a JPEG page of document 1, the PDF never travels raw', async () => {
    const h = harness({ answers: [HABILITATION_ANSWER] });
    const real = new DocumentPagesService();
    const image = await photo();
    (h.pages as any).prepareForAi = jest.fn(async (file: any, opts: any) =>
      file.mimetype === 'application/pdf'
        ? { source: 'pdf', pages: formPages(1, 'RANGO'), page_count: 1, unreadable_pages: [] }
        : real.prepareForAi(file, opts),
    );
    await h.habilitation.scanHabilitationFromFiles([image, pdf('rango.pdf')]);
    const parts = h.aiEngine.run.mock.calls[0][2][0].content as any[];
    expect(parts.some((p) => p.type === 'text' && p.text === '--- Document 1 of 2, page 1 ---')).toBe(true);
    expect(JSON.stringify(parts)).not.toContain('application/pdf');
  });

  it('a habilitación PDF of more than 5 pages is AI_INGEST_TOO_MANY_PAGES from the pages service (a document problem)', async () => {
    const h = harness({});
    const { VendixHttpException } = await import('@common/errors');
    (h.pages as any).prepareForAi = jest
      .fn()
      .mockRejectedValue(new VendixHttpException(ErrorCodes.AI_INGEST_TOO_MANY_PAGES, 'El PDF excede el máximo de 5 páginas.'));
    await expect(h.habilitation.scanHabilitationFromFiles([pdf('largo.pdf')])).rejects.toMatchObject({
      errorCode: ErrorCodes.AI_INGEST_TOO_MANY_PAGES.code,
    });
    expect(h.aiEngine.run).not.toHaveBeenCalled();
  });
});
