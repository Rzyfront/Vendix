import { monitorEventLoopDelay } from 'node:perf_hooks';
import * as zlib from 'node:zlib';
import * as AdmZip from 'adm-zip';
import * as XLSX from 'xlsx';
import {
  AttachmentUnreadableError,
  DOCX_UNREADABLE_MESSAGE,
  extractAttachmentContent,
  parseXlsxInWorker,
  PDF_UNREADABLE_MESSAGE,
  PdfJsLib,
  readDocxText,
  readPdfText,
  spreadsheetLimitProblem,
} from './attachment-text-extractor';

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

describe('extractAttachmentContent', () => {
  it('parses CSV with BOM, quoted fields and a ; delimiter', async () => {
    const csv = '﻿nombre;nota\r\n"Ana; María";"dijo ""hola"""\r\nLuis;ok\r\n';
    const out = await extractAttachmentContent(
      Buffer.from(csv),
      'text/csv',
      'a.csv',
    );
    expect(out).toMatchObject({ kind: 'table' });
    if (out.kind !== 'table') throw new Error('table expected');
    expect(out.sheets).toHaveLength(1);
    expect(out.sheets[0].columns).toEqual(['nombre', 'nota']);
    expect(out.sheets[0].rows).toEqual([
      ['Ana; María', 'dijo "hola"'],
      ['Luis', 'ok'],
    ]);
  });

  it('resolves CSV by extension when the browser sends an Excel MIME', async () => {
    const out = await extractAttachmentContent(
      Buffer.from('a,b\n1,2\n'),
      'application/vnd.ms-excel',
      'a.csv',
    );
    expect(out.kind).toBe('table');
  });

  it('reads one table per XLSX sheet', async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([['sku', 'qty'], ['A1', 3]]),
      'Stock',
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([['x'], ['y']]),
      'Otra',
    );
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const out = await extractAttachmentContent(buffer, XLSX_MIME, 'a.xlsx');
    if (out.kind !== 'table') throw new Error('table expected');
    expect(out.sheets.map((s) => s.name)).toEqual(['Stock', 'Otra']);
    expect(out.sheets[0].columns).toEqual(['sku', 'qty']);
    expect(out.sheets[0].rows).toEqual([['A1', '3']]);
  });

  it('extracts DOCX paragraphs and decodes XML entities', async () => {
    const zip = new AdmZip();
    zip.addFile(
      'word/document.xml',
      Buffer.from(
        '<w:document><w:body><w:p><w:r><w:t>Hola &amp; adiós</w:t></w:r></w:p>' +
          '<w:p><w:r><w:t xml:space="preserve">Línea </w:t></w:r><w:r><w:t>dos</w:t></w:r></w:p></w:body></w:document>',
      ),
    );
    const out = await extractAttachmentContent(
      zip.toBuffer(),
      DOCX_MIME,
      'a.docx',
    );
    expect(out).toMatchObject({ kind: 'text', text: 'Hola & adiós\nLínea dos' });
  });

  it('returns TXT as text and images as kind image', async () => {
    expect(
      await extractAttachmentContent(Buffer.from('hola'), 'text/plain', 'a.txt'),
    ).toMatchObject({ kind: 'text', text: 'hola' });
    expect(
      await extractAttachmentContent(Buffer.from([1]), 'image/png', 'a.png'),
    ).toEqual({ kind: 'image', original_name: 'a.png', mime_type: 'image/png' });
  });

  it('never throws on a malformed file: empty content instead', async () => {
    const xlsx = await extractAttachmentContent(
      Buffer.from('not a zip'),
      XLSX_MIME,
      'a.xlsx',
    );
    expect(xlsx.kind).toBe('table');
    const docx = await extractAttachmentContent(
      Buffer.from('not a zip'),
      DOCX_MIME,
      'a.docx',
    );
    expect(docx).toMatchObject({ kind: 'text', text: '' });
    const pdf = await extractAttachmentContent(
      Buffer.from('%PDF-broken'),
      'application/pdf',
      'a.pdf',
    );
    expect(pdf).toMatchObject({ kind: 'text', text: '' });
  });
});

describe('XLSX limits (B3)', () => {
  const workbook = (sheets: number) => {
    const wb = XLSX.utils.book_new();
    for (let i = 0; i < sheets; i++) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['a'], [String(i)]]), `S${i}`);
    }
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  };

  it('a workbook declaring 60 MB is refused from its ZIP directory, without parsing', async () => {
    const zip = new AdmZip(workbook(1));
    zip.addFile('xl/worksheets/sheet9.xml', Buffer.alloc(60 * 1024 * 1024, 0x61));
    const bomb = zip.toBuffer();

    const started = Date.now();
    expect(spreadsheetLimitProblem(bomb)).toMatch(
      /^El Excel ocupa \d+ MB al abrirlo y el máximo son 50 MB/,
    );
    const out = await extractAttachmentContent(bomb, XLSX_MIME, 'bomba.xlsx');
    expect(Date.now() - started).toBeLessThan(1500);
    expect(out).toEqual({
      kind: 'table',
      original_name: 'bomba.xlsx',
      mime_type: XLSX_MIME,
      sheets: [],
    });
  });

  it('more than 20 sheets is refused with the count', () => {
    expect(spreadsheetLimitProblem(workbook(21))).toBe(
      'El Excel tiene 21 hojas y el máximo son 20. Guarda solo las hojas que necesitas e inténtalo otra vez.',
    );
    expect(spreadsheetLimitProblem(workbook(20))).toBeNull();
  });

  it('the worker parse is killed past its time limit', async () => {
    await expect(parseXlsxInWorker(workbook(1), 1)).rejects.toThrow(
      /XLSX parse exceeded 1 ms/,
    );
  });

  it('a normal workbook still parses through the worker', async () => {
    await expect(parseXlsxInWorker(workbook(2))).resolves.toEqual([
      { name: 'S0', matrix: [['a'], ['0']] },
      { name: 'S1', matrix: [['a'], ['1']] },
    ]);
  });
});

describe('DOCX limits (B4)', () => {
  const docx = (documentXml: string) => {
    const zip = new AdmZip();
    zip.addFile('word/document.xml', Buffer.from(documentXml));
    return zip.toBuffer();
  };

  /**
   * The regex extraction this replaced, kept as the oracle for valid files:
   * the new linear walk must return the same text for them.
   */
  const previousDocxText = (xml: string): string => {
    const decode = (v: string) =>
      v
        .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
    const lines: string[] = [];
    for (const paragraph of xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []) {
      const withBreaks = paragraph
        .replace(/<w:tab\s*\/>/g, '<w:t>\t</w:t>')
        .replace(/<w:br\s*\/>/g, '<w:t>\n</w:t>');
      let line = '';
      for (const m of withBreaks.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)) {
        line += decode(m[1]);
      }
      lines.push(line);
    }
    return lines.join('\n').trim();
  };

  it('2 MB of unclosed `<w:p ` (a ~3 KB upload) answers in under 2 s instead of blocking the API', async () => {
    const bomb = docx('<w:p '.repeat((2 * 1024 * 1024) / 5));
    expect(bomb.length).toBeLessThan(4096);

    let beats = 0;
    const heartbeat = setInterval(() => beats++, 50);
    const started = Date.now();
    const out = await extractAttachmentContent(bomb, DOCX_MIME, 'malo.docx');
    const elapsed = Date.now() - started;
    clearInterval(heartbeat);

    expect(elapsed).toBeLessThan(2000);
    expect(out).toEqual({
      kind: 'text',
      original_name: 'malo.docx',
      mime_type: DOCX_MIME,
      text: '',
    });
    // The event loop kept running while the file was read (half the
    // expected beats, to absorb timer drift on a busy CI runner).
    expect(beats).toBeGreaterThanOrEqual(Math.floor(elapsed / 50 / 2));
  });

  it('keeps the closed paragraphs before an unclosed flood (partial text, fast)', async () => {
    const xml =
      '<w:body><w:p><w:r><w:t>Factura 12</w:t></w:r></w:p>' +
      '<w:p ><w:r><w:t>Total 5.000</w:t></w:r></w:p>' +
      '<w:p '.repeat(400_000);
    const started = Date.now();
    const out = await extractAttachmentContent(docx(xml), DOCX_MIME, 'a.docx');
    expect(Date.now() - started).toBeLessThan(2000);
    expect(out).toMatchObject({ text: 'Factura 12\nTotal 5.000' });
  });

  it('unclosed `<w:t>` runs inside one paragraph stay linear too', async () => {
    const xml = '<w:p><w:r>' + '<w:t>x'.repeat(400_000) + '</w:r></w:p>';
    const started = Date.now();
    const out = await extractAttachmentContent(docx(xml), DOCX_MIME, 'a.docx');
    expect(Date.now() - started).toBeLessThan(2000);
    expect(out).toMatchObject({ kind: 'text', text: '' });
  });

  it('returns the same text as the previous extraction for valid documents', async () => {
    const valid = [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
        '<w:p w:rsidR="00A1"><w:pPr><w:pStyle w:val="Title"/><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr>' +
        '<w:r><w:t>Cotización</w:t></w:r></w:p>' +
        '<w:p><w:proofErr w:type="spellStart"/><w:r><w:t xml:space="preserve">Cliente: </w:t></w:r>' +
        '<w:r><w:rPr><w:b/></w:rPr><w:t>Pérez &amp; Hijos &lt;SAS&gt;</w:t></w:r><w:proofErr w:type="spellEnd"/></w:p>' +
        '<w:p><w:r><w:t>Ítem</w:t><w:tab/><w:t>Valor</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>Línea uno</w:t><w:br/><w:t>Línea dos</w:t><w:br w:type="page"/></w:r></w:p>' +
        '<w:p/>' +
        '<w:p></w:p>' +
        '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Celda &#233; &#x00F1; &quot;x&quot; &apos;y&apos;</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
        '<w:p><w:r><w:t>Fin</w:t></w:r></w:p>' +
        '<w:sectPr/></w:body></w:document>',
      '<w:document><w:body><w:p><w:r><w:t>Hola &amp; adiós</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t xml:space="preserve">Línea </w:t></w:r><w:r><w:t>dos</w:t></w:r></w:p></w:body></w:document>',
    ];
    for (const xml of valid) {
      const out = await extractAttachmentContent(docx(xml), DOCX_MIME, 'a.docx');
      expect(out).toMatchObject({ kind: 'text', text: previousDocxText(xml) });
    }
    const first = await extractAttachmentContent(docx(valid[0]), DOCX_MIME, 'a.docx');
    expect(first).toMatchObject({
      text: 'Cotización\nCliente: Pérez & Hijos <SAS>\nÍtem\tValor\nLínea uno\nLínea dos\n\nCelda é ñ "x" \'y\'\nFin',
    });
  });

  it('a Word read past its time limit is refused with a message for the person', async () => {
    const valid = docx('<w:p><w:r><w:t>Hola</w:t></w:r></w:p>');
    const read = readDocxText(valid, 1);
    await expect(read).rejects.toBeInstanceOf(AttachmentUnreadableError);
    await expect(read).rejects.toThrow(DOCX_UNREADABLE_MESSAGE);
    expect(DOCX_UNREADABLE_MESSAGE).toMatch(
      /^No pudimos leer el Word \(tarda demasiado o está dañado\)/,
    );
  });

  it('a document.xml declared over 20 MB is skipped without inflating it', async () => {
    const zip = new AdmZip();
    zip.addFile('word/document.xml', Buffer.alloc(21 * 1024 * 1024, 0x20));
    const started = Date.now();
    const out = await extractAttachmentContent(zip.toBuffer(), DOCX_MIME, 'a.docx');
    expect(Date.now() - started).toBeLessThan(2000);
    expect(out).toMatchObject({ kind: 'text', text: '' });
  });
});

describe('PDF time limit (P1)', () => {
  type FakeDoc = Awaited<ReturnType<PdfJsLib['getDocument']>['promise']>;
  const never = <T>() => new Promise<T>(() => undefined);
  const page = (str: string) =>
    Promise.resolve({
      getTextContent: async () => ({ items: [{ str, hasEOL: false }] }),
    });
  const fakePdfJs = (doc: Promise<FakeDoc>) => {
    const destroy = jest.fn(async () => undefined);
    const lib: PdfJsLib = { getDocument: () => ({ promise: doc, destroy }) };
    return { lib, destroy };
  };

  it('a PDF that never opens is refused at the time limit with a message for the person', async () => {
    const { lib, destroy } = fakePdfJs(never<FakeDoc>());
    const started = Date.now();
    const read = readPdfText(Buffer.from('%PDF-1.7'), 50, lib);
    await expect(read).rejects.toBeInstanceOf(AttachmentUnreadableError);
    await expect(read).rejects.toThrow(PDF_UNREADABLE_MESSAGE);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(PDF_UNREADABLE_MESSAGE).toMatch(
      /^No pudimos leer el PDF \(tarda demasiado o está dañado\)/,
    );
  });

  it('keeps the pages read before the limit and says how many (pages_read)', async () => {
    const { lib, destroy } = fakePdfJs(
      Promise.resolve({
        numPages: 3,
        getPage: (n: number) => (n === 1 ? page('Factura 12') : never()),
      }),
    );
    await expect(
      readPdfText(Buffer.from('%PDF-1.7'), 50, lib),
    ).resolves.toEqual({ text: 'Factura 12', pages: 3, pages_read: 1 });
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('a PDF read in time returns every page and no pages_read', async () => {
    const { lib, destroy } = fakePdfJs(
      Promise.resolve({
        numPages: 2,
        getPage: (n: number) => page(n === 1 ? 'Uno' : 'Dos'),
      }),
    );
    await expect(readPdfText(Buffer.from('%PDF-1.7'), 1000, lib)).resolves.toEqual(
      { text: 'Uno\n\nDos', pages: 2 },
    );
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});

describe('PDF limits in worker (B5)', () => {
  /** Builds a real PDF with FlateDecode page content streams and a valid xref. */
  const buildPdf = (pageStreams: string[]): Buffer => {
    const pageCount = pageStreams.length;
    const kids = Array.from(
      { length: pageCount },
      (_, i) => `${4 + i * 2} 0 R`,
    ).join(' ');
    const header = Buffer.from('%PDF-1.4\n', 'latin1');
    const parts: Buffer[] = [header];
    const offsets: number[] = [0];
    let pos = header.length;

    const pushObj = (id: number, body: Buffer | string) => {
      offsets[id] = pos;
      const head = Buffer.from(`${id} 0 obj\n`, 'latin1');
      const mid = typeof body === 'string' ? Buffer.from(body, 'latin1') : body;
      const tail = Buffer.from('\nendobj\n', 'latin1');
      parts.push(head, mid, tail);
      pos += head.length + mid.length + tail.length;
    };

    pushObj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    pushObj(2, `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`);
    pushObj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

    pageStreams.forEach((raw, idx) => {
      const pageId = 4 + idx * 2;
      const streamId = pageId + 1;
      pushObj(
        pageId,
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamId} 0 R >>`,
      );
      const compressed = zlib.deflateSync(Buffer.from(raw, 'latin1'));
      pushObj(
        streamId,
        Buffer.concat([
          Buffer.from(
            `<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`,
            'latin1',
          ),
          compressed,
          Buffer.from('\nendstream', 'latin1'),
        ]),
      );
    });

    const totalObjs = 4 + pageCount * 2;
    const xrefPos = pos;
    let xref = `xref\n0 ${totalObjs}\n0000000000 65535 f \n`;
    for (let i = 1; i < totalObjs; i++) {
      xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    }
    xref += `trailer\n<< /Size ${totalObjs} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
    parts.push(Buffer.from(xref, 'latin1'));
    return Buffer.concat(parts);
  };

  const heavyPageStream = (reps: number) =>
    'BT /F1 12 Tf (hola mundo) Tj ET\n'.repeat(reps);

  it('extracts text from a valid multi-page PDF inside the worker with no pages_read', async () => {
    const pdf = buildPdf([
      'BT /F1 12 Tf (Factura 12) Tj ET\n',
      'BT /F1 12 Tf (Total 5000) Tj ET\n',
    ]);
    const out = await extractAttachmentContent(
      pdf,
      'application/pdf',
      'factura.pdf',
    );
    expect(out).toEqual({
      kind: 'text',
      original_name: 'factura.pdf',
      mime_type: 'application/pdf',
      text: 'Factura 12\n\nTotal 5000',
      pages: 2,
    });
  });

  it('a real ~228 KB PDF with 3M text operators finishes within the time cap without blocking the event loop', async () => {
    const heavyPdf = buildPdf([heavyPageStream(3_000_000)]);
    expect(heavyPdf.length).toBeGreaterThan(70 * 1024);
    expect(heavyPdf.length).toBeLessThan(300 * 1024);

    const delay = monitorEventLoopDelay({ resolution: 10 });
    delay.enable();
    const started = Date.now();
    let outcome:
      | { ok: true; value: Awaited<ReturnType<typeof extractAttachmentContent>> }
      | { ok: false; error: unknown };
    try {
      outcome = {
        ok: true,
        value: await extractAttachmentContent(
          heavyPdf,
          'application/pdf',
          'pesado.pdf',
        ),
      };
    } catch (error) {
      outcome = { ok: false, error };
    }
    const elapsed = Date.now() - started;
    delay.disable();
    const maxLagMs = delay.max / 1e6;

    // (a) Bounded wall-clock time (5 s worker cap, never the 10-27 s hang).
    expect(elapsed).toBeLessThan(7_500);
    // (b) Main thread event loop stays free while pdfjs works in the worker.
    expect(maxLagMs).toBeLessThan(200);
    // (c) Clear AttachmentUnreadableError (or bounded partial text), never a hang.
    if (outcome.ok) {
      expect(outcome.value.kind).toBe('text');
    } else {
      expect(outcome.error).toBeInstanceOf(AttachmentUnreadableError);
      expect((outcome.error as Error).message).toBe(PDF_UNREADABLE_MESSAGE);
    }
  }, 15_000);

  it('keeps pages read before the worker timeout and reports pages_read on a real multi-page PDF', async () => {
    const partialPdf = buildPdf([
      'BT /F1 12 Tf (Pagina uno) Tj ET\n',
      heavyPageStream(3_000_000),
    ]);
    const delay = monitorEventLoopDelay({ resolution: 10 });
    delay.enable();
    const started = Date.now();
    const result = await readPdfText(partialPdf, 1_500);
    const elapsed = Date.now() - started;
    delay.disable();

    expect(elapsed).toBeLessThan(3_500);
    expect(delay.max / 1e6).toBeLessThan(200);
    expect(result).toEqual({
      text: 'Pagina uno',
      pages: 2,
      pages_read: 1,
    });
  }, 10_000);

  it('refuses a PDF buffer larger than 20 MB without spawning a worker', async () => {
    const oversized = Buffer.alloc(20 * 1024 * 1024 + 1, 0x20);
    const read = readPdfText(oversized);
    await expect(read).rejects.toBeInstanceOf(AttachmentUnreadableError);
    await expect(read).rejects.toThrow(PDF_UNREADABLE_MESSAGE);
  });
});
